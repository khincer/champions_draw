from dataclasses import dataclass

from django.db import transaction

from draw.models import Season, SeasonTeam

EXPECTED_TEAM_COUNT = 36
POT_COUNT = 4
POT_SIZE = 9


class SeedingError(ValueError):
    """Raised when season entries cannot be seeded into UEFA pots."""


@dataclass(frozen=True, slots=True)
class SeedingSummary:
    season_id: int
    total_teams: int
    title_holder_entry_id: int
    pot_sizes: dict[int, int]


def seed_season_entries(season: Season) -> SeedingSummary:
    entries = list(
        season.entries.select_related('team', 'team__association').all()
    )
    title_holder = validate_seeding_inputs(entries)

    ordered_entries = [title_holder, *sorted(
        (entry for entry in entries if entry.pk != title_holder.pk),
        key=lambda entry: (-entry.uefa_club_coefficient, entry.team.name),
    )]

    for index, entry in enumerate(ordered_entries, start=1):
        entry.seeding_position = index
        entry.pot = ((index - 1) // POT_SIZE) + 1

    with transaction.atomic():
        SeasonTeam.objects.bulk_update(ordered_entries, ['seeding_position', 'pot'])

    pot_sizes = {
        pot_number: sum(1 for entry in ordered_entries if entry.pot == pot_number)
        for pot_number in range(1, POT_COUNT + 1)
    }

    return SeedingSummary(
        season_id=season.pk,
        total_teams=len(ordered_entries),
        title_holder_entry_id=title_holder.pk,
        pot_sizes=pot_sizes,
    )


def validate_seeding_inputs(entries: list[SeasonTeam]) -> SeasonTeam:
    if len(entries) != EXPECTED_TEAM_COUNT:
        raise SeedingError(
            f'Season must contain exactly {EXPECTED_TEAM_COUNT} teams before seeding.'
        )

    title_holders = [entry for entry in entries if entry.is_title_holder]
    if len(title_holders) != 1:
        raise SeedingError('Season must contain exactly one Champions League title holder.')

    return title_holders[0]