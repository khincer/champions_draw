from __future__ import annotations

import random
from collections import Counter, defaultdict
from dataclasses import dataclass

from django.db import transaction

from draw.models import Season, SeasonMatchup, SeasonTeam


EXPECTED_TEAM_COUNT = 36
POT_COUNT = 4
POT_SIZE = 9
OPPONENTS_PER_POT = 2
HOME_MATCHES = 4
AWAY_MATCHES = 4
DEFAULT_MAX_ATTEMPTS = 100


class DrawError(ValueError):
    """Raised when a Champions League draw cannot be generated."""


@dataclass(frozen=True, slots=True)
class DrawSummary:
    season_id: int
    draw_seed: str
    total_matchups: int
    home_matches_per_team: int
    away_matches_per_team: int
    opponents_per_pot: int
    pot_pair_counts: dict[str, int]


def generate_season_draw(
    season: Season,
    *,
    draw_seed: str | int | None = None,
    reset: bool = False,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
) -> DrawSummary:
    entries = list(
        season.entries.select_related('team', 'team__association')
        .order_by('pot', 'seeding_position', 'team__name')
    )
    validate_draw_inputs(season, entries, reset=reset)

    normalized_seed = str(draw_seed if draw_seed is not None else random.SystemRandom().randrange(1, 10**12))
    last_error: DrawError | None = None

    for attempt in range(1, max_attempts + 1):
        rng = random.Random(f'{normalized_seed}:{attempt}')
        try:
            undirected_edges_by_pair = build_draw_graph(entries, rng)
            directed_edges = orient_draw_edges(entries, undirected_edges_by_pair, rng)
            validate_directed_draw(entries, directed_edges)
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
                )
                for home_id, away_id in directed_edges
            )

        return build_summary(season, normalized_seed, entries, directed_edges)

    detail = f' Last error: {last_error}' if last_error else ''
    raise DrawError(f'Unable to generate a valid draw after {max_attempts} attempts for seed {normalized_seed}.{detail}')


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
    entries_by_pot = group_entries_by_pot(entries)
    edges_by_pair: dict[tuple[int, int], set[tuple[int, int]]] = {}
    global_edges: set[tuple[int, int]] = set()

    for pot_a in range(1, POT_COUNT + 1):
        for pot_b in range(pot_a, POT_COUNT + 1):
            pot_pair = (pot_a, pot_b)
            edges = solve_pot_pair(entries_by_pot[pot_a], entries_by_pot[pot_b], pot_a == pot_b, global_edges, rng)
            edges_by_pair[pot_pair] = edges
            global_edges.update(edges)

    return edges_by_pair


def solve_pot_pair(
    pot_a_entries: list[SeasonTeam],
    pot_b_entries: list[SeasonTeam],
    same_pot: bool,
    global_edges: set[tuple[int, int]],
    rng: random.Random,
) -> set[tuple[int, int]]:
    involved_entries = pot_a_entries if same_pot else [*pot_a_entries, *pot_b_entries]
    entries_by_id = {entry.pk: entry for entry in involved_entries}
    ids_by_side_a = {entry.pk for entry in pot_a_entries}
    ids_by_side_b = ids_by_side_a if same_pot else {entry.pk for entry in pot_b_entries}
    remaining = {entry.pk: OPPONENTS_PER_POT for entry in involved_entries}
    edges: set[tuple[int, int]] = set()

    def is_allowed_pair(first_id: int, second_id: int) -> bool:
        if first_id == second_id:
            return False
        first = entries_by_id[first_id]
        second = entries_by_id[second_id]
        if not associations_differ(first, second):
            return False
        edge = normalize_edge(first_id, second_id)
        if edge in edges or edge in global_edges:
            return False
        if same_pot:
            return True
        return (first_id in ids_by_side_a and second_id in ids_by_side_b) or (
            first_id in ids_by_side_b and second_id in ids_by_side_a
        )

    def available_candidates(entry_id: int) -> list[int]:
        return [
            candidate_id
            for candidate_id, candidate_remaining in remaining.items()
            if candidate_remaining > 0 and is_allowed_pair(entry_id, candidate_id)
        ]

    def choose_next_entry() -> int | None:
        candidates = [entry_id for entry_id, count in remaining.items() if count > 0]
        if not candidates:
            return None
        return min(candidates, key=lambda entry_id: (len(available_candidates(entry_id)), -remaining[entry_id]))

    def can_still_finish() -> bool:
        for entry_id, count in remaining.items():
            if count > 0 and len(available_candidates(entry_id)) < count:
                return False
        if not same_pot:
            side_a_remaining = sum(remaining[entry_id] for entry_id in ids_by_side_a)
            side_b_remaining = sum(remaining[entry_id] for entry_id in ids_by_side_b)
            if side_a_remaining != side_b_remaining:
                return False
        else:
            if sum(remaining.values()) % 2 != 0:
                return False
        return True

    def backtrack() -> bool:
        if all(count == 0 for count in remaining.values()):
            return True
        if not can_still_finish():
            return False

        entry_id = choose_next_entry()
        if entry_id is None:
            return True

        candidates = available_candidates(entry_id)
        rng.shuffle(candidates)
        candidates.sort(key=lambda candidate_id: len(available_candidates(candidate_id)))

        for candidate_id in candidates:
            edge = normalize_edge(entry_id, candidate_id)
            edges.add(edge)
            remaining[entry_id] -= 1
            remaining[candidate_id] -= 1

            if backtrack():
                return True

            remaining[candidate_id] += 1
            remaining[entry_id] += 1
            edges.remove(edge)

        return False

    if not backtrack():
        pot_names = sorted({entry.pot for entry in involved_entries})
        raise DrawError(f'Unable to solve pot pairing {pot_names}.')

    expected_edges = len(involved_entries) if same_pot else len(pot_a_entries) * OPPONENTS_PER_POT
    if len(edges) != expected_edges:
        raise DrawError('Generated pot pairing has an unexpected number of matchups.')

    return edges


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

    for home_id, away_id in directed_edges:
        home_entry = entries_by_id[home_id]
        away_entry = entries_by_id[away_id]
        if home_id == away_id:
            raise DrawError('Generated draw contains a self-matchup.')
        if not associations_differ(home_entry, away_entry):
            raise DrawError('Generated draw contains a same-association matchup.')

        opponent_pot_counts[home_id][away_entry.pot] += 1
        opponent_pot_counts[away_id][home_entry.pot] += 1

    for entry in entries:
        if home_counts[entry.pk] != HOME_MATCHES or away_counts[entry.pk] != AWAY_MATCHES:
            raise DrawError('Generated draw does not balance home and away matches.')
        for pot in range(1, POT_COUNT + 1):
            if opponent_pot_counts[entry.pk][pot] != OPPONENTS_PER_POT:
                raise DrawError('Generated draw does not assign two opponents from each pot.')


def build_summary(
    season: Season,
    draw_seed: str,
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
        season_id=season.pk,
        draw_seed=draw_seed,
        total_matchups=len(directed_edges),
        home_matches_per_team=HOME_MATCHES,
        away_matches_per_team=AWAY_MATCHES,
        opponents_per_pot=OPPONENTS_PER_POT,
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


def associations_differ(first: SeasonTeam, second: SeasonTeam) -> bool:
    return first.team.association_id != second.team.association_id
