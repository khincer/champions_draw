"""Sequential (UEFA-style extraction) draw generation.

Builds the same 144-matchup league-phase contract as the z3 SAT solver, but
constructs the undirected cross graph pot-pair by pot-pair with a greedy
extraction order: first-drawn teams pick freely from the available pool,
late-drawn teams inherit whatever remains. This intentionally replicates the
order-of-extraction bias of real UCL draws. Everything downstream (orientation,
matchday scheduling, validation, persistence) is reused from `draw.py`.
"""

from __future__ import annotations

import random
from collections import Counter, defaultdict
from itertools import combinations

from django.db import transaction
from django.utils import timezone

from draw.models import (
    DrawMethodChoices,
    DrawStatusChoices,
    Season,
    SeasonDraw,
    SeasonMatchup,
)
from draw.services.draw import (
    DrawError,
    DrawSummary,
    MAX_OPPONENTS_PER_ASSOCIATION,
    OPPONENTS_PER_POT,
    POT_COUNT,
    associations_differ,
    build_summary,
    compute_forbidden_directions,
    normalize_edge,
    orient_draw_edges,
    schedule_matchdays,
    validate_directed_draw,
    validate_draw_inputs,
)


def generate_sequential_season_draw(
    season: Season,
    *,
    draw_record: SeasonDraw,
    reset: bool,
    max_attempts: int,
) -> DrawSummary:
    """Mirror `_generate_season_draw` using the sequential graph builder."""
    entries = list(
        season.entries.select_related('team', 'team__association')
        .order_by('pot', 'seeding_position', 'team__name')
    )
    validate_draw_inputs(season, entries, reset=reset)

    forbidden_directions = compute_forbidden_directions(season)

    last_error: DrawError | None = None

    for attempt in range(1, max_attempts + 1):
        rng = random.Random(f'{draw_record.draw_seed}:{attempt}')
        try:
            undirected_edges_by_pair = build_sequential_graph(entries, rng)
            directed_edges = orient_draw_edges(
                entries,
                undirected_edges_by_pair,
                rng,
                forbidden_directions=forbidden_directions,
            )
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
            draw_record.method = DrawMethodChoices.SEQUENTIAL
            draw_record.save(update_fields=['status', 'matchups_created', 'error_message', 'completed_at', 'method'])

        return build_summary(season, draw_record, entries, directed_edges)

    detail = f' Last error: {last_error}' if last_error else ''
    raise DrawError(
        f'Unable to generate a valid draw after {max_attempts} attempts for seed {draw_record.draw_seed}.{detail}'
    )


def build_sequential_graph(entries, rng):
    """Build `edges_by_pair` with UEFA-style sequential extraction.

    Returns the same shape as `build_draw_graph`: a dict keyed by sorted
    pot-pair tuples whose values are sets of normalized undirected edges
    (`tuple(sorted((first_id, second_id)))`).
    """
    edges_by_pair: dict[tuple[int, int], set[tuple[int, int]]] = defaultdict(set)
    # Global per-entry opponent-association usage, accumulated across all pot pairs.
    assoc_counts: dict[int, Counter[int]] = defaultdict(Counter)
    entries_by_pot: dict[int, list] = defaultdict(list)
    for entry in entries:
        entries_by_pot[entry.pot].append(entry)

    for pot_a in range(1, POT_COUNT + 1):
        for pot_b in range(pot_a, POT_COUNT + 1):
            same_pool = pot_a == pot_b
            edges = sequential_pot_matching(
                entries_by_pot[pot_a],
                entries_by_pot[pot_b],
                same_pool=same_pool,
                rng=rng,
                assoc_counts=assoc_counts,
            )
            edges_by_pair[(pot_a, pot_b)].update(edges)

    return dict(edges_by_pair)


def sequential_pot_matching(A, B, *, same_pool, rng, assoc_counts):
    """Assign exactly two partners per entry inside one pot-pair.

    `A` is the extraction pool: its entries pick first, in shuffled order,
    which produces the order-of-extraction bias. A recursive search with
    backtracking guarantees every entry on both sides ends with exactly two
    partners and that the global per-association caps stay within limits.
    """
    edges: set[tuple[int, int]] = set()

    if same_pool:
        # A and B are the same pool: build a 2-regular simple graph (union of cycles).
        nodes = list(A)
        rng.shuffle(nodes)
        adjacency: dict[int, set[int]] = {entry.pk: set() for entry in nodes}

        def backtrack(index: int) -> bool:
            if index == len(nodes):
                return all(len(adjacency[entry.pk]) == OPPONENTS_PER_POT for entry in nodes)

            entry = nodes[index]
            need = OPPONENTS_PER_POT - len(adjacency[entry.pk])
            if need <= 0:
                return backtrack(index + 1)

            candidates = [
                candidate
                for candidate in nodes
                if (
                    candidate.pk != entry.pk
                    and candidate.pk not in adjacency[entry.pk]
                    and len(adjacency[candidate.pk]) < OPPONENTS_PER_POT
                    and associations_differ(entry, candidate)
                    and assoc_counts[entry.pk][candidate.team.association_id] < MAX_OPPONENTS_PER_ASSOCIATION
                    and assoc_counts[candidate.pk][entry.team.association_id] < MAX_OPPONENTS_PER_ASSOCIATION
                )
            ]
            if len(candidates) < need:
                return False

            combos = list(combinations(candidates, need))
            rng.shuffle(combos)
            for combo in combos:
                for candidate in combo:
                    adjacency[entry.pk].add(candidate.pk)
                    adjacency[candidate.pk].add(entry.pk)
                    edges.add(normalize_edge(entry.pk, candidate.pk))
                    assoc_counts[entry.pk][candidate.team.association_id] += 1
                    assoc_counts[candidate.pk][entry.team.association_id] += 1

                if backtrack(index + 1):
                    return True

                for candidate in combo:
                    adjacency[entry.pk].discard(candidate.pk)
                    adjacency[candidate.pk].discard(entry.pk)
                    edges.discard(normalize_edge(entry.pk, candidate.pk))
                    assoc_counts[entry.pk][candidate.team.association_id] -= 1
                    assoc_counts[candidate.pk][entry.team.association_id] -= 1

            return False

        if not backtrack(0):
            raise DrawError(f'Unable to complete a valid within-pot matching for {len(nodes)} teams.')
        return edges

    # Cross-pot: A decides, B provides availability. Both sides end at degree 2.
    a_nodes = list(A)
    b_nodes = list(B)
    rng.shuffle(a_nodes)
    rng.shuffle(b_nodes)
    b_degrees: dict[int, int] = {entry.pk: 0 for entry in b_nodes}

    def backtrack(index: int) -> bool:
        if index == len(a_nodes):
            return all(degree == OPPONENTS_PER_POT for degree in b_degrees.values())

        entry = a_nodes[index]
        candidates = [
            candidate
            for candidate in b_nodes
            if (
                b_degrees[candidate.pk] < OPPONENTS_PER_POT
                and associations_differ(entry, candidate)
                and assoc_counts[entry.pk][candidate.team.association_id] < MAX_OPPONENTS_PER_ASSOCIATION
                and assoc_counts[candidate.pk][entry.team.association_id] < MAX_OPPONENTS_PER_ASSOCIATION
            )
        ]
        if len(candidates) < OPPONENTS_PER_POT:
            return False

        combos = list(combinations(candidates, OPPONENTS_PER_POT))
        rng.shuffle(combos)
        for combo in combos:
            for candidate in combo:
                edge = normalize_edge(entry.pk, candidate.pk)
                edges.add(edge)
                b_degrees[candidate.pk] += 1
                assoc_counts[entry.pk][candidate.team.association_id] += 1
                assoc_counts[candidate.pk][entry.team.association_id] += 1

            if backtrack(index + 1):
                return True

            for candidate in combo:
                edge = normalize_edge(entry.pk, candidate.pk)
                edges.remove(edge)
                b_degrees[candidate.pk] -= 1
                assoc_counts[entry.pk][candidate.team.association_id] -= 1
                assoc_counts[candidate.pk][entry.team.association_id] -= 1

        return False

    if not backtrack(0):
        raise DrawError(
            f'Unable to complete a valid cross-pot matching between {len(a_nodes)} and {len(b_nodes)} teams.'
        )
    return edges