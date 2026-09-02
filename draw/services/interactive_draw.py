"""Interactive (manual pot-by-pot) draw ceremony.

A user picks one team at a time; each pick auto-assigns that team's valid
opponents per UCL rules and persists provisional matchup rows (matchday=NULL)
oriented with exactly 4 home / 4 away games per team at pick time. The 36th
pick finalizes by validating the already-oriented graph and scheduling
matchdays. One-shot sat/sequential paths are untouched.
"""

from __future__ import annotations

import random
from collections import Counter, defaultdict
from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone

from draw.models import (
    DrawMethodChoices,
    DrawStatusChoices,
    Season,
    SeasonDraw,
    SeasonMatchup,
    SeasonTeam,
    InteractiveDrawPick,
)
from draw.services.draw import (
    DrawError,
    POT_COUNT,
    POT_SIZE,
    build_draw_graph,
    compute_forbidden_directions,
    normalize_edge,
    normalize_player_name,
    orient_draw_edges,
    schedule_matchdays,
    validate_directed_draw,
)


@dataclass(frozen=True, slots=True)
class PickResult:
    draw: SeasonDraw
    pick: InteractiveDrawPick
    auto_finalized: bool


def start_or_resume(
    *,
    season: Season,
    draw_seed: str,
    player_name: str = '',
    reset: bool = False,
) -> SeasonDraw:
    """Create or resume the one RUNNING interactive session for a season."""
    normalized_seed = str(draw_seed)
    normalized_player_name = normalize_player_name(player_name)

    with transaction.atomic():
        running = list(
            SeasonDraw.objects.select_for_update().filter(
                season=season,
                method=DrawMethodChoices.INTERACTIVE,
                status=DrawStatusChoices.RUNNING,
            )
        )

        if reset:
            SeasonMatchup.objects.filter(season=season).delete()
            for draw in running:
                draw.delete()
        elif running:
            return running[0]

        _validate_interactive_season(season)

        return SeasonDraw.objects.create(
            season=season,
            draw_seed=normalized_seed,
            player_name=normalized_player_name,
            method=DrawMethodChoices.INTERACTIVE,
            status=DrawStatusChoices.RUNNING,
        )


def cancel_running_sessions(season: Season) -> None:
    """Delete any RUNNING interactive session (picks cascade) for a season."""
    SeasonDraw.objects.filter(
        season=season,
        method=DrawMethodChoices.INTERACTIVE,
        status=DrawStatusChoices.RUNNING,
    ).delete()


def current_pot(draw: SeasonDraw) -> int | None:
    """Smallest pot containing any undrawn team; None when all are drawn."""
    drawn_ids = InteractiveDrawPick.objects.filter(draw=draw).values_list('season_team_id', flat=True)
    pots = list(
        SeasonTeam.objects.filter(season=draw.season)
        .exclude(pk__in=drawn_ids)
        .values_list('pot', flat=True)
    )
    return min(pots) if pots else None


def pick_team(*, season: Season, draw: SeasonDraw, season_team_id: int) -> PickResult:
    """Validate and apply one ceremony pick, auto-finalizing on pick 36."""
    season_team = (
        SeasonTeam.objects.select_related('team', 'team__association')
        .filter(season=season, pk=season_team_id)
        .first()
    )
    if season_team is None:
        raise DrawError('Season team not found.')

    with transaction.atomic():
        draw = SeasonDraw.objects.select_for_update().get(pk=draw.pk)

        opponents = assign_opponents_for_pick(season=season, draw=draw, season_team=season_team)
        if opponents is None:
            raise DrawError(
                f'{season_team.team.name} cannot be assigned valid opponents '
                f'(dead-end in pot {current_pot(draw)}).'
            )

        orientation = interactive_orientation(draw)

        pick_order = InteractiveDrawPick.objects.filter(draw=draw).count() + 1
        pick = InteractiveDrawPick.objects.create(draw=draw, season_team=season_team, pick_order=pick_order)

        for opponent_id in opponents:
            home_id, away_id = orientation[normalize_edge(season_team.pk, opponent_id)]
            SeasonMatchup.objects.create(
                season=season,
                home_team_id=home_id,
                away_team_id=away_id,
            )

        auto_finalized = False
        if pick_order == 36:
            finalize(draw)
            auto_finalized = True

        return PickResult(draw=draw, pick=pick, auto_finalized=auto_finalized)


def _solved_edges(draw: SeasonDraw) -> list[list[int]]:
    """Seeded undirected [a, b] SeasonTeam pk edge list; solved once, persisted.

    The SAT solve is deterministic for a given draw (seed = draw_seed:draw.id),
    so solving on first use and reading the persisted list on later picks
    reveals against the SAME graph without re-running the expensive solver
    (which previously hung >60s per pick on real data). Rule 6 pairs blocked
    in BOTH directions are excluded from the graph, so they are never drawn.
    """
    if draw.interactive_edges:
        return draw.interactive_edges
    entries = list(
        draw.season.entries.select_related('team', 'team__association')
        .order_by('pot', 'seeding_position', 'team__name')
    )
    forbidden_directions = compute_forbidden_directions(draw.season)
    blocked_edges = {
        normalize_edge(home_id, away_id)
        for home_id, away_id in forbidden_directions
        if (away_id, home_id) in forbidden_directions
    }
    rng = random.Random(f'{draw.draw_seed}:{draw.id}')
    edges_by_pair = build_draw_graph(entries, rng, blocked_edges=blocked_edges)
    edges = sorted(
        [min(first_id, second_id), max(first_id, second_id)]
        for pair_edges in edges_by_pair.values()
        for first_id, second_id in pair_edges
    )
    draw.interactive_edges = edges
    draw.save(update_fields=['interactive_edges'])
    return edges


def assign_opponents_for_pick(
    *,
    season: Season,
    draw: SeasonDraw,
    season_team: SeasonTeam,
) -> set[int]:
    """Return the picked team's (not yet persisted) opponent SeasonTeam ids.

    The full undirected draw graph is pre-solved once via the SAT solver
    (`build_draw_graph`, deterministic: seeded by draw_seed + draw id) and
    persisted to `draw.interactive_edges`; a pick reveals that team's edges
    whose matchup has not been persisted yet. Because picks happen pot-by-pot,
    a pot-p team's opponents in lower pots were already persisted when those
    teams were picked, so exactly the 2-per-remaining-pot edges (8/6/4/2 by
    pot) are revealed here, summing to 144 over the ceremony.
    """
    if draw.status != DrawStatusChoices.RUNNING:
        raise DrawError('Interactive draw is not running.')

    drawn_ids = set(InteractiveDrawPick.objects.filter(draw=draw).values_list('season_team_id', flat=True))
    if season_team.pk in drawn_ids:
        raise DrawError(f'{season_team.team.name} has already been drawn.')

    pot = current_pot(draw)
    if season_team.pot != pot:
        raise DrawError(f'{season_team.team.name} is not in the current pot (pot {pot}).')

    existing = {
        (min(home_id, away_id), max(home_id, away_id))
        for home_id, away_id in SeasonMatchup.objects.filter(season=season).values_list(
            'home_team_id', 'away_team_id'
        )
    }

    try:
        solved_edges = _solved_edges(draw)
    except DrawError:
        return None

    opponents = set()
    for first_id, second_id in solved_edges:
        if season_team.pk not in (first_id, second_id):
            continue
        peer = second_id if first_id == season_team.pk else first_id
        pair_undirected = (min(season_team.pk, peer), max(season_team.pk, peer))
        if pair_undirected not in existing:
            opponents.add(peer)
    return opponents


def interactive_orientation(draw: SeasonDraw) -> dict[tuple[int, int], tuple[int, int]]:
    """Deterministic full-graph orientation: exactly 4 home / 4 away per team.

    Reuses the same cycle orientation as the one-shot paths (`orient_draw_edges`),
    which orients every pot-pair cycle forward or backward and therefore yields
    exactly 1 home + 1 away per team per pot-pair (4 + 4 overall), while
    respecting rule 6 direction bans. Seeded identically on every pick, so the
    ceremony always reveals the final home/away identity and never shows an
    unbalanced provisional split. Returns {normalized_edge: (home_id, away_id)}.
    """
    entries = list(
        draw.season.entries.select_related('team', 'team__association')
        .order_by('pot', 'seeding_position', 'team__name')
    )
    entries_by_id = {entry.pk: entry for entry in entries}
    edges_by_pair: dict[tuple[int, int], set[tuple[int, int]]] = defaultdict(set)
    for first_id, second_id in _solved_edges(draw):
        first = entries_by_id[first_id]
        second = entries_by_id[second_id]
        edges_by_pair[tuple(sorted((first.pot, second.pot)))].add(
            tuple(sorted((first_id, second_id)))
        )

    rng = random.Random(f'{draw.draw_seed}:{draw.id}:orient')
    directed_edges = orient_draw_edges(
        entries,
        dict(edges_by_pair),
        rng,
        forbidden_directions=compute_forbidden_directions(draw.season),
    )
    return {
        normalize_edge(home_id, away_id): (home_id, away_id)
        for home_id, away_id in directed_edges
    }


def _validate_interactive_season(season: Season) -> None:
    entries = list(season.entries.all())
    if len(entries) != POT_COUNT * POT_SIZE:
        raise DrawError(f'Season must contain exactly {POT_COUNT * POT_SIZE} teams.')
    if any(entry.pot is None for entry in entries):
        raise DrawError('Season must be seeded before starting an interactive draw.')
    pot_sizes = Counter(entry.pot for entry in entries)
    if dict(pot_sizes) != {pot: POT_SIZE for pot in range(1, POT_COUNT + 1)}:
        raise DrawError(f'Season must contain {POT_SIZE} seeded teams in each of pots 1-{POT_COUNT}.')


def finalize(draw: SeasonDraw) -> SeasonDraw:
    """Validate the pick-time orientation and schedule matchdays in place."""
    if draw.status == DrawStatusChoices.COMPLETED:
        return draw

    pick_count = InteractiveDrawPick.objects.filter(draw=draw).count()
    if pick_count != 36:
        raise DrawError(f'Cannot finalize: {pick_count} of 36 picks completed.')

    matchups = list(
        SeasonMatchup.objects.filter(season=draw.season).select_related('home_team', 'away_team')
    )
    if len(matchups) != 144:
        raise DrawError(f'Cannot finalize: only {len(matchups)} of 144 matchups created.')

    entries = list(
        draw.season.entries.select_related('team', 'team__association')
        .order_by('pot', 'seeding_position', 'team__name')
    )
    directed_edges = [(matchup.home_team_id, matchup.away_team_id) for matchup in matchups]
    validate_directed_draw(entries, directed_edges)  # gate: 144, no dups, 4/4 home/away, caps
    rng = random.Random(f'{draw.draw_seed}:{draw.id}:finalize')
    matchday_assignments = schedule_matchdays(entries, directed_edges, rng)

    with transaction.atomic():
        for matchup in matchups:
            matchday = matchday_assignments[normalize_edge(matchup.home_team_id, matchup.away_team_id)]
            if matchup.matchday == matchday:
                continue
            matchup.matchday = matchday
            matchup.save(update_fields=['matchday'])

        draw.status = DrawStatusChoices.COMPLETED
        draw.matchups_created = 144
        draw.error_message = ''
        draw.completed_at = timezone.now()
        draw.save(update_fields=['status', 'matchups_created', 'error_message', 'completed_at'])

    return draw