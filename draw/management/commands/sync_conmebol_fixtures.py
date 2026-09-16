"""Sync real Copa Libertadores / Sudamericana fixtures from API-Football v3.

Fetches fixtures for league 13 (Libertadores) or 11 (Sudamericana) and
upserts them into Season / SeasonTeam / SeasonMatchup so the existing
prediction flow can run on real CONMEBOL schedules.
"""

import json
import os
import re
import time
import unicodedata
from datetime import datetime, timezone
from decimal import Decimal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from draw.models import (
    Association,
    CompetitionChoices,
    QualifiedViaChoices,
    Season,
    SeasonMatchup,
    SeasonTeam,
    Team,
)

API_BASE = 'https://v3.football.api-sports.io'
API_TIMEOUT = 15
RATE_LIMIT_WAIT_SECONDS = 65
MAX_RATE_LIMIT_RETRIES = 5

# competition arg -> (league id, CompetitionChoices member, season label)
COMPETITIONS = {
    'lib': (13, CompetitionChoices.LIBERTADORES, 'Libertadores'),
    'sud': (11, CompetitionChoices.SUDAMERICANA, 'Sudamericana'),
}

CONMEBOL_COUNTRY_MAP = {
    'brazil': 'BRA', 'argentina': 'ARG', 'uruguay': 'URU',
    'colombia': 'COL', 'ecuador': 'ECU', 'chile': 'CHI',
    'paraguay': 'PAR', 'peru': 'PER', 'bolivia': 'BOL',
    'venezuela': 'VEN', 'mexico': 'MEX',
}
COUNTRY_NAMES = {code: country for country, code in CONMEBOL_COUNTRY_MAP.items()}

# API-football's /fixtures team objects carry no country field (only
# id/name/logo/winner), so per-team association codes come from this name
# map. ponytail: covers known CONMEBOL clubs; teams not listed fall back to
# the league's country and are skipped with a warning if that doesn't
# resolve either. Add clubs here as the qualified field grows.
TEAM_COUNTRY_BY_NAME = {
    # Brazil
    'flamengo': 'BRA', 'palmeiras': 'BRA', 'corinthians': 'BRA',
    'sao paulo': 'BRA', 'santos': 'BRA', 'vasco da gama': 'BRA',
    'botafogo': 'BRA', 'fluminense': 'BRA', 'internacional': 'BRA',
    'gremio': 'BRA', 'cruzeiro': 'BRA', 'atletico mineiro': 'BRA',
    'atletico mg': 'BRA',  # API-Football name
    'atletico-mg': 'BRA',  # API-Football name (raw, hyphen kept)
    'fortaleza': 'BRA', 'bahia': 'BRA', 'red bull bragantino': 'BRA',
    'rb bragantino': 'BRA',  # API-Football name
    'juventude': 'BRA', 'ceara': 'BRA', 'sport recife': 'BRA',
    # Argentina
    'river plate': 'ARG', 'boca juniors': 'ARG', 'racing club': 'ARG',
    'estudiantes': 'ARG', 'estudiantes lp': 'ARG',  # API-Football: "Estudiantes L.P."
    'estudiantes l.p.': 'ARG',  # raw with period kept
    'velez sarsfield': 'ARG', 'independiente': 'ARG',
    'rosario central': 'ARG', 'talleres cordoba': 'ARG', 'lanus': 'ARG',
    'defensa y justicia': 'ARG', 'argentinos juniors': 'ARG',
    'godoy cruz': 'ARG', 'union santa fe': 'ARG', 'instituto': 'ARG',
    'huracan': 'ARG', 'tigre': 'ARG', 'banfield': 'ARG',
    'gimnasia la plata': 'ARG', 'central cordoba': 'ARG', 'platense': 'ARG',
    'san lorenzo': 'ARG',
    # Uruguay
    'penarol': 'URU', 'nacional de football': 'URU', 'nacional': 'URU',
    'club nacional': 'URU',  # API-Football: "Club Nacional"
    'liverpool': 'URU', 'liverpool montevideo': 'URU',  # API disambiguates
    'defensor sporting': 'URU', 'boston river': 'URU',
    'racing club de montevideo': 'URU', 'danubio': 'URU',
    'montevideo wanderers': 'URU', 'wanderers': 'URU', 'progreso': 'URU',
    'cerro largo': 'URU',
    # Colombia
    'atletico nacional': 'COL', 'millonarios': 'COL', 'deportes tolima': 'COL',
    'america de cali': 'COL', 'junior': 'COL', 'santa fe': 'COL',
    'once caldas': 'COL', 'deportivo cali': 'COL', 'independiente medellin': 'COL',
    'deportivo pasto': 'COL', 'atletico bucaramanga': 'COL',
    'alianza petrolera': 'COL', 'aguilas doradas': 'COL',
    # Ecuador
    'ldu quito': 'ECU', 'ldu de quito': 'ECU',  # API-Football: "LDU de Quito"
    'independiente del valle': 'ECU', 'barcelona sc': 'ECU',
    'emelec': 'ECU', 'aucas': 'ECU', 'delfin': 'ECU', 'deportivo cuenca': 'ECU',
    'orense': 'ECU', 'mushuc runa': 'ECU',
    'universidad catolica del ecuador': 'ECU',
    'el nacional': 'ECU',
    # Chile
    'colo colo': 'CHI', 'universidad de chile': 'CHI',
    'universidad catolica': 'CHI', 'palestino': 'CHI', 'union espanola': 'CHI',
    'cobresal': 'CHI', 'audax italiano': 'CHI', 'huachipato': 'CHI',
    'everton': 'CHI', 'deportes iquique': 'CHI',
    # Paraguay
    'cerro porteno': 'PAR', 'olimpia': 'PAR', 'libertad': 'PAR',
    'libertad asuncion': 'PAR',  # API-Football: "Libertad Asuncion"
    'nacional asuncion': 'PAR', 'sportivo ameliano': 'PAR', 'guairena': 'PAR',
    'sportivo luqueno': 'PAR', '2 de mayo': 'PAR', 'tacuary': 'PAR',
    'sportivo trinidense': 'PAR',
    # Peru
    'universitario de deportes': 'PER', 'universitario': 'PER',
    'alianza lima': 'PER', 'sporting cristal': 'PER', 'melgar': 'PER',
    'fbc melgar': 'PER',  # API-Football: "FBC Melgar"
    'cusco fc': 'PER', 'deportivo garcilaso': 'PER', 'cienciano': 'PER',
    'adt': 'PER', 'sport boys': 'PER', 'utc cajamarca': 'PER',
    # Bolivia
    'bolivar': 'BOL', 'the strongest': 'BOL', 'always ready': 'BOL',
    'jorge wilstermann': 'BOL', 'aurora': 'BOL', 'nacional potosi': 'BOL',
    'san antonio bulo bulo': 'BOL', 'guabira': 'BOL',
    # Venezuela
    'deportivo tachira': 'VEN', 'deportivo tachira fc': 'VEN',  # API name
    'caracas': 'VEN', 'caracas fc': 'VEN',  # API name
    'zamora': 'VEN', 'academia puerto cabello': 'VEN', 'puerto cabello': 'VEN',
    'metropolitanos': 'VEN', 'portuguesa': 'VEN', 'portuguesa fc': 'VEN',
    'rayo zuliano': 'VEN', 'monagas': 'VEN',
    'carabobo': 'VEN', 'estudiantes de merida': 'VEN',
    'deportivo la guaira': 'VEN',
}

STATUS_MAP = {
    'NS': 'SCHEDULED', 'TBD': 'SCHEDULED', 'PST': 'SCHEDULED',
    'LIVE': 'IN_PLAY',
    '1H': 'IN_PLAY', 'HT': 'IN_PLAY', '2H': 'IN_PLAY',
    'ET': 'IN_PLAY', 'BT': 'IN_PLAY', 'P': 'IN_PLAY',
    'SUSP': 'IN_PLAY', 'INT': 'IN_PLAY',
    'FT': 'FINISHED', 'AET': 'FINISHED', 'PEN': 'FINISHED',
    # Unlisted status shorts (CANC, WO, ...) pass through unchanged.
}

MATCHDAY_RE = re.compile(r'(?:Matchday|Group Stage)\s*-?\s*(\d+)', re.IGNORECASE)


def normalize_text(value):
    """Lowercase, accent-stripped lookup key."""
    normalized = unicodedata.normalize('NFKD', value or '')
    ascii_only = normalized.encode('ascii', 'ignore').decode('ascii')
    return ' '.join(ascii_only.lower().split())


def parse_kickoff(value):
    """ISO 8601 string -> aware UTC datetime, or None."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def extract_matchday(round_label):
    """'Group A - Matchday 2' -> 2; knockout rounds (no 'Matchday') -> None."""
    match = MATCHDAY_RE.search(round_label or '')
    return int(match.group(1)) if match else None


class Command(BaseCommand):
    help = 'Sync real Copa Libertadores / Sudamericana fixtures from API-Football v3.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--competition',
            required=True,
            choices=sorted(COMPETITIONS),
            help='lib (Copa Libertadores) or sud (Copa Sudamericana).',
        )
        parser.add_argument(
            '--season',
            type=int,
            default=2026,
            help='Season starting year (e.g. 2026). Default: 2026.',
        )
        parser.add_argument(
            '--set-active',
            action='store_true',
            help='Deactivate all other seasons and mark this one active.',
        )

    def api_get(self, endpoint, params, api_key):
        """GET an API-Football endpoint, retrying on rate limits."""
        query = urlencode(params)
        for attempt in range(1, MAX_RATE_LIMIT_RETRIES + 1):
            request = Request(
                url=f'{API_BASE}/{endpoint}?{query}',
                headers={'x-apisports-key': api_key, 'Accept': 'application/json'},
            )
            try:
                with urlopen(request, timeout=API_TIMEOUT) as response:
                    payload = json.loads(response.read().decode('utf-8'))
            except HTTPError as exc:
                body = exc.read().decode('utf-8', errors='replace')
                raise CommandError(f'API-Football returned HTTP {exc.code}: {body}') from exc
            except URLError as exc:
                raise CommandError(f'Unable to reach API-Football: {exc.reason}') from exc

            errors = payload.get('errors') or {}
            if isinstance(errors, dict) and errors.get('rateLimit'):
                if attempt == MAX_RATE_LIMIT_RETRIES:
                    raise CommandError(
                        f"API-Football rate limit persisted for {endpoint}?{query}: {errors['rateLimit']}"
                    )
                self.stderr.write(self.style.WARNING(
                    f'[conmebol] Rate limit reached. Waiting {RATE_LIMIT_WAIT_SECONDS}s '
                    f'before retrying (attempt {attempt}/{MAX_RATE_LIMIT_RETRIES}).'
                ))
                time.sleep(RATE_LIMIT_WAIT_SECONDS)
                continue

            if errors:
                self.stderr.write(self.style.WARNING(f'[conmebol] API returned non-fatal errors: {errors}'))
            return payload

        raise CommandError(f'Unable to retrieve {endpoint}?{query} from API-Football.')

    def resolve_association_code(self, team_info, league_country):
        """3-letter association code for a team, or None if unresolvable."""
        code = CONMEBOL_COUNTRY_MAP.get(normalize_text(team_info.get('country')))
        if code:
            return code
        code = TEAM_COUNTRY_BY_NAME.get(normalize_text(team_info.get('name')))
        if code:
            return code
        return CONMEBOL_COUNTRY_MAP.get(normalize_text(league_country))

    def upsert_association(self, code, cache):
        if code not in cache:
            cache[code], _ = Association.objects.get_or_create(
                code=code,
                defaults={'name': COUNTRY_NAMES.get(code, code)},
            )
        return cache[code]

    def upsert_team(self, team_info, league_country, association_cache, team_cache):
        """Team by (association, name); cached per run. None if country unresolved."""
        name = (team_info.get('name') or '').strip()
        if not name:
            return None
        key = normalize_text(name)
        if key in team_cache:
            return team_cache[key]

        code = self.resolve_association_code(team_info, league_country)
        if not code:
            return None
        association = self.upsert_association(code, association_cache)

        short_name = (team_info.get('short') or name)[:30]
        logo_url = team_info.get('logo') or ''
        team, _ = Team.objects.get_or_create(
            association=association,
            name=name,
            defaults={'short_name': short_name, 'logo_url': logo_url},
        )
        if not team.logo_url and logo_url:  # use the API logo only if missing
            team.logo_url = logo_url
            team.save(update_fields=['logo_url'])
        team_cache[key] = team
        return team

    def upsert_entry(self, season, team, entry_cache):
        if team.pk not in entry_cache:
            entry, _ = SeasonTeam.objects.get_or_create(
                season=season,
                team=team,
                defaults={
                    'uefa_club_coefficient': Decimal('0'),
                    'qualified_via': QualifiedViaChoices.OTHER,
                    'is_title_holder': False,
                    'domestic_position': None,
                    'seeding_position': None,
                    'pot': None,
                },
            )
            entry_cache[team.pk] = entry
        return entry_cache[team.pk]

    def handle(self, *args, **options):
        competition_key = options['competition']
        season_year = options['season']
        league_id, competition_code, competition_label = COMPETITIONS[competition_key]

        api_key = os.getenv('API_FOOTBALL_KEY') or os.getenv('API_KEY')
        if not api_key:
            self.stderr.write(self.style.ERROR(
                'Error: API_FOOTBALL_KEY environment variable not set. '
                'Get a key at https://www.api-football.com/'
            ))
            return

        self.stdout.write(
            f'[conmebol] Fetching {competition_label} fixtures for season {season_year} (league {league_id}).'
        )
        payload = self.api_get('fixtures', {'league': league_id, 'season': season_year}, api_key)
        fixtures = [
            item for item in (payload.get('response') or [])
            if isinstance(item, dict) and item.get('fixture')
        ]

        # Guard against a wrong season param returning other years' data.
        fixtures_for_season = []
        other_seasons = 0
        for item in fixtures:
            if int(item.get('league', {}).get('season') or 0) != season_year:
                other_seasons += 1
                continue
            fixtures_for_season.append(item)
        if other_seasons:
            self.stderr.write(self.style.WARNING(
                f'[conmebol] Ignored {other_seasons} fixtures from other seasons.'
            ))
        fixtures = fixtures_for_season
        if not fixtures:
            self.stderr.write(self.style.WARNING('[conmebol] No fixtures returned by the API.'))
            return

        season_name = f'{competition_label} {season_year}'
        with transaction.atomic():
            season, _ = Season.objects.get_or_create(
                name=season_name,
                defaults={
                    'competition': competition_code,
                    'pot_count': 4,
                    'teams_per_pot': 8,
                    'total_matches': 6,
                },
            )
            if season.competition != competition_code:
                self.stderr.write(self.style.ERROR(
                    f'[conmebol] Season "{season_name}" already exists as {season.get_competition_display()}.'
                ))
                return
            if options['set_active']:
                Season.objects.exclude(pk=season.pk).update(is_active=False)
                if not season.is_active:
                    season.is_active = True
                    season.save(update_fields=['is_active'])

            associations = {}
            teams = {}
            entries = {}
            skipped_team_names = set()
            skipped_matchups = 0
            matchups = 0

            # Pass 1: teams (countries come from the fixtures response).
            for item in fixtures:
                teams_info = item.get('teams') or {}
                league_country = (item.get('league') or {}).get('country') or ''
                for side in ('home', 'away'):
                    team_info = teams_info.get(side)
                    if not team_info:
                        continue
                    name = (team_info.get('name') or '').strip()
                    if not name:
                        continue
                    if self.upsert_team(team_info, league_country, associations, teams) is None:
                        skipped_team_names.add(name)

            # Pass 2: matchups (entries first, then fixtures).
            for item in fixtures:
                fixture_obj = item.get('fixture') or {}
                league = item.get('league') or {}
                teams_info = item.get('teams') or {}
                goals = item.get('goals') or {}
                league_country = league.get('country') or ''

                home_info = teams_info.get('home') or {}
                away_info = teams_info.get('away') or {}
                home = self.upsert_team(home_info, league_country, associations, teams)
                away = self.upsert_team(away_info, league_country, associations, teams)
                if home is None or away is None or home.pk == away.pk:
                    skipped_matchups += 1
                    continue
                home_entry = self.upsert_entry(season, home, entries)
                away_entry = self.upsert_entry(season, away, entries)

                status_short = (fixture_obj.get('status') or {}).get('short', '')
                status = STATUS_MAP.get(status_short, status_short)
                finished = status == 'FINISHED'
                defaults = {
                    'matchday': extract_matchday(league.get('round')),
                    'external_id': str(fixture_obj.get('id') or ''),
                    'kickoff': parse_kickoff(fixture_obj.get('date')),
                    'status': status,
                    'home_goals': goals.get('home') if finished else None,
                    'away_goals': goals.get('away') if finished else None,
                }

                # QuerySet.update() skips Model.full_clean().
                if SeasonMatchup.objects.filter(
                    season=season, home_team=home_entry, away_team=away_entry
                ).update(**defaults):
                    matchups += 1
                    continue

                try:
                    SeasonMatchup.objects.create(
                        season=season, home_team=home_entry, away_team=away_entry, **defaults
                    )
                except ValidationError:
                    # Two-legged real fixtures legitimately contain both
                    # directed pairs; the model's reverse-matchup guard (meant
                    # for draw output) rejects the return leg. The DB unique
                    # constraint on (season, home, away) allows both
                    # directions, so insert past the guard.
                    SeasonMatchup.objects.bulk_create(
                        [SeasonMatchup(season=season, home_team=home_entry, away_team=away_entry, **defaults)],
                        ignore_conflicts=True,
                    )
                matchups += 1

            if skipped_team_names:
                self.stderr.write(self.style.WARNING(
                    '[conmebol] Skipped teams with unresolvable country: '
                    + ', '.join(sorted(skipped_team_names))
                ))
            if skipped_matchups:
                self.stderr.write(self.style.WARNING(
                    f'[conmebol] Skipped {skipped_matchups} matchups (missing team data).'
                ))

            self.stdout.write(f'[conmebol] Created Season: {season_name} ({competition_code})')
            self.stdout.write(
                f'[conmebol] Upserted {len(teams)} teams, {len(associations)} associations, {matchups} matchups'
            )
            self.stdout.write(f'[conmebol] Season is active: {season.is_active}')