from __future__ import annotations

import random
from collections import Counter, defaultdict
from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone
from z3 import Bool, If, Solver, Sum, is_true, sat

from draw.models import DrawStatusChoices, Season, SeasonDraw, SeasonMatchup, SeasonTeam


EXPECTED_TEAM_COUNT = 36
POT_COUNT = 4
POT_SIZE = 9
OPPONENTS_PER_POT = 2
HOME_MATCHES = 4
AWAY_MATCHES = 4
MAX_OPPONENTS_PER_ASSOCIATION = 2
MATCHDAY_COUNT = 8
DEFAULT_MAX_ATTEMPTS = 100


class DrawError(ValueError):
    """Raised when a Champions League draw cannot be generated."""


@dataclass(frozen=True, slots=True)
class DrawSummary:
    draw_id: int
    season_id: int
    draw_seed: str
    status: str
    total_matchups: int
    home_matches_per_team: int
    away_matches_per_team: int
    opponents_per_pot: int
    max_opponents_per_association: int
    matchday_count: int
    pot_pair_counts: dict[str, int]


def generate_season_draw(
    season: Season,
    *,
    draw_seed: str | int | None = None,
    reset: bool = False,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
) -> DrawSummary:
    normalized_seed = str(draw_seed if draw_seed is not None else random.SystemRandom().randrange(1, 10**12))
    draw_record = SeasonDraw.objects.create(
        season=season,
        draw_seed=normalized_seed,
        status=DrawStatusChoices.RUNNING,
    )

    try:
        return _generate_season_draw(
            season,
            draw_record=draw_record,
            reset=reset,
            max_attempts=max_attempts,
        )
    except DrawError as exc:
        draw_record.status = DrawStatusChoices.FAILED
        draw_record.error_message = str(exc)
        draw_record.completed_at = timezone.now()
        draw_record.save(update_fields=['status', 'error_message', 'completed_at'])
        raise


def _generate_season_draw(
    season: Season,
    *,
    draw_record: SeasonDraw,
    reset: bool,
    max_attempts: int,
) -> DrawSummary:
    entries = list(
        season.entries.select_related('team', 'team__association')
        .order_by('pot', 'seeding_position', 'team__name')
    )
    validate_draw_inputs(season, entries, reset=reset)

    last_error: DrawError | None = None

    for attempt in range(1, max_attempts + 1):
        rng = random.Random(f'{draw_record.draw_seed}:{attempt}')
        try:
            undirected_edges_by_pair = build_draw_graph(entries, rng)
            directed_edges = orient_draw_edges(entries, undirected_edges_by_pair, rng)
            validate_directed_draw(entries, directed_edges)
            matchday_assignments = schedule_matchdays(entries, directed_edges, rng)
        except DrawError as exc:
            last_error = exc
            continue

        with transaction.atomic():
            if reset:
                SeasonMatchup.objects.filter(season=season).delete()
            elif SeasonMatchup.objects.filter(season=season).exists():
                raise DrawError('Season already has generated matchups. Use reset=true to replace them.')

            SeasonMatchup.objects.bulk_create(
                SeasonMatchup(
                    season=season,
                    home_team_id=home_id,
                    away_team_id=away_id,
                    matchday=matchday_assignments[normalize_edge(home_id, away_id)],
                )
                for home_id, away_id in directed_edges
            )

            draw_record.status = DrawStatusChoices.COMPLETED
            draw_record.matchups_created = len(directed_edges)
            draw_record.error_message = ''
            draw_record.completed_at = timezone.now()
            draw_record.save(update_fields=['status', 'matchups_created', 'error_message', 'completed_at'])

        return build_summary(season, draw_record, entries, directed_edges)

    detail = f' Last error: {last_error}' if last_error else ''
    raise DrawError(f'Unable to generate a valid draw after {max_attempts} attempts for seed {draw_record.draw_seed}.{detail}')


def validate_draw_inputs(season: Season, entries: list[SeasonTeam], *, reset: bool) -> None:
    if len(entries) != EXPECTED_TEAM_COUNT:
        raise DrawError(f'Season must contain exactly {EXPECTED_TEAM_COUNT} teams before drawing.')

    if season.pot_count != POT_COUNT or season.teams_per_pot != POT_SIZE or season.total_matches != 8:
        raise DrawError('Season draw settings must be 4 pots, 9 teams per pot, and 8 total matches.')

    if any(entry.pot is None or entry.seeding_position is None for entry in entries):
        raise DrawError('Season must be seeded before drawing.')

    pot_sizes = Counter(entry.pot for entry in entries)
    expected_pot_sizes = {pot: POT_SIZE for pot in range(1, POT_COUNT + 1)}
    if dict(pot_sizes) != expected_pot_sizes:
        raise DrawError(f'Season must contain {POT_SIZE} seeded teams in each of pots 1-{POT_COUNT}.')

    if SeasonMatchup.objects.filter(season=season).exists() and not reset:
        raise DrawError('Season already has generated matchups. Use reset=true to replace them.')

    entries_by_pot = group_entries_by_pot(entries)
    for pot_a in range(1, POT_COUNT + 1):
        for pot_b in range(pot_a, POT_COUNT + 1):
            for entry in entries_by_pot[pot_a]:
                candidates = [
                    candidate
                    for candidate in entries_by_pot[pot_b]
                    if candidate.pk != entry.pk and associations_differ(entry, candidate)
                ]
                if pot_a == pot_b and len(candidates) < OPPONENTS_PER_POT:
                    raise DrawError(f'{entry.team.name} does not have enough eligible opponents in pot {pot_b}.')
                if pot_a != pot_b and len(candidates) < OPPONENTS_PER_POT:
                    raise DrawError(f'{entry.team.name} does not have enough eligible opponents in pot {pot_b}.')


def build_draw_graph(
    entries: list[SeasonTeam],
    rng: random.Random,
) -> dict[tuple[int, int], set[tuple[int, int]]]:
    entries_by_id = {entry.pk: entry for entry in entries}
    associations = sorted({entry.team.association_id for entry in entries})
    possible_edges = [
        normalize_edge(first.pk, second.pk)
        for index, first in enumerate(entries)
        for second in entries[index + 1:]
        if associations_differ(first, second)
    ]
    rng.shuffle(possible_edges)

    edge_vars = {
        edge: Bool(f'edge_{edge[0]}_{edge[1]}')
        for edge in possible_edges
    }
    solver = Solver()
    solver.set('random_seed', rng.randrange(1, 2**31 - 1))

    for entry in entries:
        incident_edges = [
            edge_vars[edge]
            for edge in possible_edges
            if entry.pk in edge
        ]
        solver.add(Sum([If(edge_var, 1, 0) for edge_var in incident_edges]) == 8)

        for pot in range(1, POT_COUNT + 1):
            pot_edges = [
                edge_vars[edge]
                for edge in possible_edges
                if entry.pk in edge and other_entry_for_edge(edge, entry.pk, entries_by_id).pot == pot
            ]
            solver.add(Sum([If(edge_var, 1, 0) for edge_var in pot_edges]) == OPPONENTS_PER_POT)

        for association_id in associations:
            if association_id == entry.team.association_id:
                continue
            association_edges = [
                edge_vars[edge]
                for edge in possible_edges
                if (
                    entry.pk in edge
                    and other_entry_for_edge(edge, entry.pk, entries_by_id).team.association_id == association_id
                )
            ]
            solver.add(Sum([If(edge_var, 1, 0) for edge_var in association_edges]) <= MAX_OPPONENTS_PER_ASSOCIATION)

    if solver.check() != sat:
        raise DrawError('Unable to solve draw graph with association constraints.')

    model = solver.model()
    selected_edges = {
        edge
        for edge, edge_var in edge_vars.items()
        if is_true(model.evaluate(edge_var))
    }
    edges_by_pair: dict[tuple[int, int], set[tuple[int, int]]] = defaultdict(set)
    for first_id, second_id in selected_edges:
        first_pot = entries_by_id[first_id].pot
        second_pot = entries_by_id[second_id].pot
        edges_by_pair[tuple(sorted((first_pot, second_pot)))].add((first_id, second_id))

    return dict(edges_by_pair)


def orient_draw_edges(
    entries: list[SeasonTeam],
    edges_by_pair: dict[tuple[int, int], set[tuple[int, int]]],
    rng: random.Random,
) -> list[tuple[int, int]]:
    directed_edges: list[tuple[int, int]] = []

    for edges in edges_by_pair.values():
        components = find_cycle_components(entries, edges)
        for component in components:
            if len(component) < 3:
                raise DrawError('Draw graph contains an invalid cycle.')
            if rng.choice([True, False]):
                component = list(reversed(component))
            directed_edges.extend(
                (component[index], component[(index + 1) % len(component)])
                for index in range(len(component))
            )

    return directed_edges


def find_cycle_components(entries: list[SeasonTeam], edges: set[tuple[int, int]]) -> list[list[int]]:
    adjacency: dict[int, list[int]] = defaultdict(list)
    for first_id, second_id in edges:
        adjacency[first_id].append(second_id)
        adjacency[second_id].append(first_id)

    expected_ids = {entry.pk for entry in entries if entry.pk in adjacency}
    if any(len(neighbors) != 2 for neighbors in adjacency.values()):
        raise DrawError('Every team must have exactly two opponents in each pot pairing.')

    components: list[list[int]] = []
    visited: set[int] = set()

    for start_id in sorted(expected_ids):
        if start_id in visited:
            continue

        cycle = [start_id]
        visited.add(start_id)
        previous_id: int | None = None
        current_id = start_id

        while True:
            next_candidates = [
                neighbor_id
                for neighbor_id in adjacency[current_id]
                if neighbor_id != previous_id
            ]
            next_id = next_candidates[0]
            if next_id == start_id:
                break
            if next_id in visited:
                raise DrawError('Draw graph contains a non-cycle component.')
            cycle.append(next_id)
            visited.add(next_id)
            previous_id, current_id = current_id, next_id

        components.append(cycle)

    return components


def validate_directed_draw(entries: list[SeasonTeam], directed_edges: list[tuple[int, int]]) -> None:
    entries_by_id = {entry.pk: entry for entry in entries}
    if len(directed_edges) != 144:
        raise DrawError('Generated draw must contain exactly 144 matchups.')

    undirected_edges = {normalize_edge(home_id, away_id) for home_id, away_id in directed_edges}
    if len(undirected_edges) != len(directed_edges):
        raise DrawError('Generated draw contains duplicate pairings.')

    home_counts = Counter(home_id for home_id, _ in directed_edges)
    away_counts = Counter(away_id for _, away_id in directed_edges)
    opponent_pot_counts: dict[int, Counter[int]] = {
        entry.pk: Counter() for entry in entries
    }
    opponent_association_counts: dict[int, Counter[int]] = {
        entry.pk: Counter() for entry in entries
    }

    for home_id, away_id in directed_edges:
        home_entry = entries_by_id[home_id]
        away_entry = entries_by_id[away_id]
        if home_id == away_id:
            raise DrawError('Generated draw contains a self-matchup.')
        if not associations_differ(home_entry, away_entry):
            raise DrawError('Generated draw contains a same-association matchup.')

        opponent_pot_counts[home_id][away_entry.pot] += 1
        opponent_pot_counts[away_id][home_entry.pot] += 1
        opponent_association_counts[home_id][away_entry.team.association_id] += 1
        opponent_association_counts[away_id][home_entry.team.association_id] += 1

    for entry in entries:
        if home_counts[entry.pk] != HOME_MATCHES or away_counts[entry.pk] != AWAY_MATCHES:
            raise DrawError('Generated draw does not balance home and away matches.')
        for pot in range(1, POT_COUNT + 1):
            if opponent_pot_counts[entry.pk][pot] != OPPONENTS_PER_POT:
                raise DrawError('Generated draw does not assign two opponents from each pot.')
        if any(count > MAX_OPPONENTS_PER_ASSOCIATION for count in opponent_association_counts[entry.pk].values()):
            raise DrawError('Generated draw exceeds the maximum opponents from one association.')


def schedule_matchdays(
    entries: list[SeasonTeam],
    directed_edges: list[tuple[int, int]],
    rng: random.Random,
) -> dict[tuple[int, int], int]:
    remaining_edges = {normalize_edge(home_id, away_id) for home_id, away_id in directed_edges}
    entry_ids = {entry.pk for entry in entries}
    assignments: dict[tuple[int, int], int] = {}

    def build_adjacency(edges: set[tuple[int, int]]) -> dict[int, set[int]]:
        adjacency = {entry_id: set() for entry_id in entry_ids}
        for first_id, second_id in edges:
            adjacency[first_id].add(second_id)
            adjacency[second_id].add(first_id)
        return adjacency

    def find_perfect_matching(edges: set[tuple[int, int]]) -> set[tuple[int, int]] | None:
        adjacency = build_adjacency(edges)
        matched: set[int] = set()
        matching: set[tuple[int, int]] = set()

        def unmatched_ids() -> list[int]:
            return [entry_id for entry_id in entry_ids if entry_id not in matched]

        def backtrack_matching() -> bool:
            remaining_ids = unmatched_ids()
            if not remaining_ids:
                return True

            entry_id = min(
                remaining_ids,
                key=lambda candidate_id: len([opponent_id for opponent_id in adjacency[candidate_id] if opponent_id not in matched]),
            )
            candidates = [
                opponent_id
                for opponent_id in adjacency[entry_id]
                if opponent_id not in matched
            ]
            rng.shuffle(candidates)
            candidates.sort(key=lambda opponent_id: len([next_id for next_id in adjacency[opponent_id] if next_id not in matched]))

            for opponent_id in candidates:
                edge = normalize_edge(entry_id, opponent_id)
                matching.add(edge)
                matched.add(entry_id)
                matched.add(opponent_id)

                if backtrack_matching():
                    return True

                matched.remove(opponent_id)
                matched.remove(entry_id)
                matching.remove(edge)

            return False

        if backtrack_matching():
            return matching
        return None

    def has_feasible_remaining_degree(edges: set[tuple[int, int]], remaining_matchdays: int) -> bool:
        degree_counts = Counter()
        for first_id, second_id in edges:
            degree_counts[first_id] += 1
            degree_counts[second_id] += 1
        return all(degree_counts[entry_id] == remaining_matchdays for entry_id in entry_ids)

    def backtrack_matchdays(matchday: int, edges: set[tuple[int, int]]) -> bool:
        if matchday > MATCHDAY_COUNT:
            return not edges
        if not has_feasible_remaining_degree(edges, MATCHDAY_COUNT - matchday + 1):
            return False

        seen_matchings: set[tuple[tuple[int, int], ...]] = set()
        for _ in range(50):
            matching = find_perfect_matching(edges)
            if matching is None:
                return False
            matching_key = tuple(sorted(matching))
            if matching_key in seen_matchings:
                continue
            seen_matchings.add(matching_key)

            next_edges = edges - matching
            for edge in matching:
                assignments[edge] = matchday

            if backtrack_matchdays(matchday + 1, next_edges):
                return True

            for edge in matching:
                assignments.pop(edge, None)

        return False

    if not backtrack_matchdays(1, remaining_edges):
        raise DrawError('Unable to schedule matchdays so each team plays once per matchday.')

    return assignments


def build_summary(
    season: Season,
    draw_record: SeasonDraw,
    entries: list[SeasonTeam],
    directed_edges: list[tuple[int, int]],
) -> DrawSummary:
    entries_by_id = {entry.pk: entry for entry in entries}
    pot_pair_counts: Counter[str] = Counter()
    for home_id, away_id in directed_edges:
        home_pot = entries_by_id[home_id].pot
        away_pot = entries_by_id[away_id].pot
        pot_pair = '-'.join(str(pot) for pot in sorted((home_pot, away_pot)))
        pot_pair_counts[pot_pair] += 1

    return DrawSummary(
        draw_id=draw_record.pk,
        season_id=season.pk,
        draw_seed=draw_record.draw_seed,
        status=draw_record.status,
        total_matchups=len(directed_edges),
        home_matches_per_team=HOME_MATCHES,
        away_matches_per_team=AWAY_MATCHES,
        opponents_per_pot=OPPONENTS_PER_POT,
        max_opponents_per_association=MAX_OPPONENTS_PER_ASSOCIATION,
        matchday_count=MATCHDAY_COUNT,
        pot_pair_counts=dict(sorted(pot_pair_counts.items())),
    )


def group_entries_by_pot(entries: list[SeasonTeam]) -> dict[int, list[SeasonTeam]]:
    entries_by_pot: dict[int, list[SeasonTeam]] = defaultdict(list)
    for entry in entries:
        entries_by_pot[entry.pot].append(entry)
    return {
        pot: sorted(entries_by_pot[pot], key=lambda entry: (entry.seeding_position, entry.team.name))
        for pot in range(1, POT_COUNT + 1)
    }


def normalize_edge(first_id: int, second_id: int) -> tuple[int, int]:
    return tuple(sorted((first_id, second_id)))


def other_entry_for_edge(edge: tuple[int, int], entry_id: int, entries_by_id: dict[int, SeasonTeam]) -> SeasonTeam:
    first_id, second_id = edge
    return entries_by_id[second_id if first_id == entry_id else first_id]


def associations_differ(first: SeasonTeam, second: SeasonTeam) -> bool:
    return first.team.association_id != second.team.association_id
