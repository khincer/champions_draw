from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

from django.db import transaction

from draw.models import Association, CompetitionChoices, QualifiedViaChoices, Season, SeasonTeam, Team


VALID_QUALIFIED_VIA_VALUES = {choice for choice, _ in QualifiedViaChoices.choices}


@dataclass(frozen=True, slots=True)
class ImportSeedInputSummary:
    season_id: int
    season_name: str
    season_created: bool
    season_entries_deleted: int
    associations_created: int
    associations_updated: int
    teams_created: int
    teams_updated: int
    entries_created: int
    entries_updated: int


def import_seed_input_file(file_path: str | Path, *, set_active: bool = False) -> ImportSeedInputSummary:
    payload = load_seed_input_payload(file_path)
    return import_seed_input_payload(payload, set_active=set_active)


def load_seed_input_payload(file_path: str | Path) -> dict:
    path = Path(file_path)
    return json.loads(path.read_text(encoding='utf-8'))


def import_seed_input_payload(payload: dict, *, set_active: bool = False) -> ImportSeedInputSummary:
    season_payload = payload.get('season') or {}
    entries_payload = payload.get('entries') or []

    season_name = season_payload.get('name')
    if not season_name:
        raise ValueError('Payload must include season.name.')
    if not isinstance(entries_payload, list) or not entries_payload:
        raise ValueError('Payload must include a non-empty entries list.')

    season_defaults = {
        'competition': season_payload.get('competition', CompetitionChoices.CHAMPIONS_LEAGUE),
    }

    with transaction.atomic():
        season, season_created = Season.objects.get_or_create(
            name=season_name,
            defaults=season_defaults,
        )

        season_updated = False
        desired_competition = season_defaults['competition']
        if season.competition != desired_competition:
            season.competition = desired_competition
            season_updated = True

        if set_active:
            Season.objects.exclude(pk=season.pk).update(is_active=False)
            if not season.is_active:
                season.is_active = True
                season_updated = True

        if season_updated:
            season.save(update_fields=['competition', 'is_active', 'updated_at'])

        associations_created = 0
        associations_updated = 0
        teams_created = 0
        teams_updated = 0
        entries_created = 0
        entries_updated = 0
        imported_team_ids: list[int] = []

        for entry_payload in entries_payload:
            team_payload = entry_payload.get('team') or {}
            association_payload = team_payload.get('association') or {}

            association = get_or_create_association(association_payload)
            if association['created']:
                associations_created += 1
            elif association['updated']:
                associations_updated += 1

            team = get_or_create_team(team_payload, association['instance'])
            if team['created']:
                teams_created += 1
            elif team['updated']:
                teams_updated += 1

            season_entry, created = SeasonTeam.objects.update_or_create(
                season=season,
                team=team['instance'],
                defaults={
                    'uefa_club_coefficient': parse_coefficient(entry_payload.get('uefa_club_coefficient')),
                    'is_title_holder': bool(entry_payload.get('is_title_holder', False)),
                    'qualified_via': parse_qualified_via(entry_payload.get('qualified_via')),
                    'seeding_position': None,
                    'pot': None,
                },
            )

            imported_team_ids.append(season_entry.team_id)
            if created:
                entries_created += 1
            else:
                entries_updated += 1

        deleted_count, _ = SeasonTeam.objects.filter(season=season).exclude(team_id__in=imported_team_ids).delete()

    return ImportSeedInputSummary(
        season_id=season.pk,
        season_name=season.name,
        season_created=season_created,
        season_entries_deleted=deleted_count,
        associations_created=associations_created,
        associations_updated=associations_updated,
        teams_created=teams_created,
        teams_updated=teams_updated,
        entries_created=entries_created,
        entries_updated=entries_updated,
    )


def get_or_create_association(association_payload: dict) -> dict:
    association_code = association_payload.get('code')
    association_name = association_payload.get('name')
    if not association_code or not association_name:
        raise ValueError('Each entry must include team.association.name and team.association.code.')

    association_by_code = Association.objects.filter(code=association_code).first()
    association_by_name = Association.objects.filter(name=association_name).first()

    if (
        association_by_code is not None and
        association_by_name is not None and
        association_by_code.pk != association_by_name.pk
    ):
        raise ValueError(
            f'Association conflict for {association_name} ({association_code}). '
            'Existing records match the name and code separately.'
        )

    association = association_by_code or association_by_name
    created = association is None
    if created:
        association = Association.objects.create(
            code=association_code,
            name=association_name,
        )

    updated = False
    if not created:
        if association.name != association_name:
            association.name = association_name
            updated = True
        if association.code != association_code:
            association.code = association_code
            updated = True
        if updated:
            association.save(update_fields=['name', 'code'])

    return {'instance': association, 'created': created, 'updated': updated}


def get_or_create_team(team_payload: dict, association: Association) -> dict:
    team_name = team_payload.get('name')
    short_name = team_payload.get('short_name')
    uefa_reference_name = team_payload.get('uefa_reference_name', '')
    if not team_name or not short_name:
        raise ValueError('Each entry must include team.name and team.short_name.')

    team = Team.objects.filter(association=association, name=team_name).first()
    if team is None:
        team = Team.objects.filter(association=association, name=uefa_reference_name).first()
    if team is None:
        short_name_candidates = Team.objects.filter(association=association, short_name=short_name)
        team = next(
            (
                candidate
                for candidate in short_name_candidates
                if team_names_are_compatible(candidate.name, team_name, uefa_reference_name)
            ),
            None,
        )

    if team is None:
        return {
            'instance': Team.objects.create(
                association=association,
                name=team_name,
                short_name=short_name,
            ),
            'created': True,
            'updated': False,
        }

    updated = False
    if team.name != team_name:
        team.name = team_name
        updated = True
    if team.short_name != short_name:
        team.short_name = short_name
        updated = True
    if updated:
        team.save(update_fields=['name', 'short_name'])

    return {'instance': team, 'created': False, 'updated': updated}


def team_names_are_compatible(existing_name: str, team_name: str, uefa_reference_name: str) -> bool:
    existing_tokens = significant_name_tokens(existing_name)
    incoming_tokens = significant_name_tokens(team_name)
    reference_tokens = significant_name_tokens(uefa_reference_name)

    return bool(
        existing_tokens
        and (
            existing_tokens == incoming_tokens
            or existing_tokens == reference_tokens
            or existing_tokens.issubset(incoming_tokens)
            or incoming_tokens.issubset(existing_tokens)
            or existing_tokens.issubset(reference_tokens)
            or reference_tokens.issubset(existing_tokens)
        )
    )


def significant_name_tokens(value: str) -> set[str]:
    normalized = unicodedata.normalize('NFKD', value or '')
    ascii_only = normalized.encode('ascii', 'ignore').decode('ascii')
    tokens = {
        token
        for token in ''.join(character.lower() if character.isalnum() else ' ' for character in ascii_only).split()
        if token not in {'ac', 'afc', 'as', 'c', 'cf', 'club', 'fc', 'fk', 'sc'}
    }
    return tokens


def parse_coefficient(value: str | float | int | Decimal | None) -> Decimal:
    if value is None:
        raise ValueError('Each entry must include uefa_club_coefficient.')
    return Decimal(str(value))


def parse_qualified_via(value: str | None) -> str:
    qualified_via = value or QualifiedViaChoices.LEAGUE_POSITION
    if qualified_via not in VALID_QUALIFIED_VIA_VALUES:
        raise ValueError(f'Unsupported qualified_via value: {qualified_via}')
    return qualified_via
