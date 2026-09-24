"""Sync real 2026 Copa Libertadores / Sudamericana fixtures from Promiedos.

Promiedos (https://www.promiedos.com.ar) is a free Next.js site with a JSON
backend at api.promiedos.com.ar. It carries the current season when
API-Football's free plan blocks it. No API key needed; requests send a
browser User-Agent plus the X-VER header the site's frontend uses.

Flow (Promiedos-specific bits only; persistence reuses the API-Football
command's pattern):
  1. GET the league HTML page, extract the __NEXT_DATA__ JSON blob.
  2. Read the game filters dynamically (opaque keys like 102_69_4_1).
  3. GET https://api.promiedos.com.ar/league/games/<leagueId>/<filterKey>
     per filter, ~200ms apart.
  4. Upsert Season / Association / Team / SeasonTeam / SeasonMatchup, including
     the reverse-leg workaround (QuerySet.update() skips full_clean; new reverse
     legs go through bulk_create(ignore_conflicts=True)).
"""
import json
import re
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from draw.services.conmebol_naming import (
    COUNTRY_NAMES,
    TEAM_COUNTRY_BY_NAME,
    normalize_text,
)
from draw.services.result_history import record_result_history
from draw.models import (
    Association,
    CompetitionChoices,
    QualifiedViaChoices,
    Season,
    SeasonMatchup,
    SeasonTeam,
    Team,
)

PROMIEDOS_API = 'https://api.promiedos.com.ar'
PROMIEDOS_WEB = 'https://www.promiedos.com.ar'
PROMIEDOS_VER = '1.11.7.3'
REQUEST_TIMEOUT = 30
MAX_ATTEMPTS = 4
BACKOFF_SECONDS = 1.5
REQUEST_PAUSE_SECONDS = 0.2  # polite spacing between games calls

# competition arg -> (Promiedos league id, league slug, competition choice, season label)
COMPETITIONS = {
    'lib': ('bac', 'conmebol-libertadores', CompetitionChoices.LIBERTADORES, 'Libertadores'),
    'sud': ('dij', 'conmebol-sudamericana', CompetitionChoices.SUDAMERICANA, 'Sudamericana'),
    # The Nations League is a national-team competition: its season must be
    # created by the `sync_promiedos_nations_league` subclass, which supplies
    # national association resolution and national-team season defaults. This
    # entry exists only so that subclass can reuse `get_filters`; running the
    # parent directly (`--competition unl`) resolves club-only and would create
    # the season with CONMEBOL metadata. Loud, low severity; the cron uses the
    # subclass.
    'unl': ('habg', 'uefa-nations-league', CompetitionChoices.NATIONS_LEAGUE, 'Nations League'),
}

# Promiedos team objects carry no country name, only an opaque country_id.
# These codes were discovered by probing every games filter of both the
# Libertadores (bac) and Sudamericana (dij) pages on 2026-09-15; the same 10
# codes cover both competitions. Each code is verified by well-known clubs:
#   'ba'  ARG  Boca Juniors, River Plate, Racing Club, Estudiantes de La Plata
#   'bai' PAR  Cerro Porteño, Olimpia, Libertad, Club Nacional, 2 de Mayo
#   'baj' COL  Deportes Tolima, Junior FC, Millonarios, Atlético Nacional
#   'bba' VEN  Deportivo La Guaira, Deportivo Táchira, Caracas FC, Carabobo
#   'bbb' URU  Peñarol, Nacional, Montevideo City Torque, Defensor Sporting
#   'bbc' PER  Alianza Lima, Universitario, Sporting Cristal, Cienciano
#   'bbd' BOL  Bolívar, The Strongest, Always Ready, Blooming
#   'cb'  BRA  Fluminense, Palmeiras, Flamengo, Corinthians, São Paulo, Grêmio
#   'ci'  CHI  Universidad Católica (Chile), Coquimbo Unido, O'Higgins
#   'fb'  ECU  Barcelona SC, Liga de Quito, Independiente del Valle, Macará
PROMIEDOS_COUNTRY_ID_MAP = {
    'ba': 'ARG',
    'bai': 'PAR',
    'baj': 'COL',
    'bba': 'VEN',
    'bbb': 'URU',
    'bbc': 'PER',
    'bbd': 'BOL',
    'cb': 'BRA',
    'ci': 'CHI',
    'fb': 'ECU',
}

# Opaque filter keys look like <leagueId>_<stageId>_<type>_<round> but the
# <type> semantics DIFFER between competitions (Libertadores group rounds are
# type 4, Sudamericana's are type 2), so filters are selected by NAME instead:
# "Fecha N" -> group-stage matchday N, knockout names -> no matchday.
# 'latest' ("Partidos actuales") is a rolling view that duplicates games of
# whatever stage is current, and the 'Primera/Segunda/Tercera Fase' filters
# are pre-tournament qualifiers whose teams mostly never reach the group
# stage — both are skipped to keep the Season matchups clean.
FECHA_RE = re.compile(r'^Fecha (\d+)$')

HEADERS = {
    'X-VER': PROMIEDOS_VER,
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    ),
    'Accept': 'application/json, text/plain, */*',
    'Referer': PROMIEDOS_WEB + '/',
}


def parse_promiedos_kickoff(value):
    """'DD-MM-YYYY HH:MM' (Argentina, UTC-3) -> aware UTC datetime, or None."""
    if not value:
        return None
    try:
        dt = datetime.strptime(value.strip(), '%d-%m-%Y %H:%M')
    except ValueError:
        return None
    dt = dt.replace(tzinfo=timezone(timedelta(hours=-3)))
    return dt.astimezone(timezone.utc)


def map_status(game):
    """Promiedos display status -> FINISHED / IN_PLAY / SCHEDULED.

    'Por penales' and 'Decisión de la Federación' are completed games (played
    to penalties, or an awarded result) whose scores are real — the task's
    catch-all 'SCHEDULED' would silently drop them.
    """
    short = (game.get('status') or {}).get('short_name') or ''
    name = (game.get('status') or {}).get('name') or ''
    display = game.get('game_time_status_to_display') or ''
    needle = normalize_text(' '.join([short, name, display]))
    if 'final' in needle or 'penales' in needle or 'decisi' in needle:
        return 'FINISHED'
    if 'prog' in needle:
        return 'SCHEDULED'
    if 'juego' in needle or 'tiempo' in needle:
        return 'IN_PLAY'
    return 'SCHEDULED'


class Command(BaseCommand):
    help = 'Sync real Copa Libertadores / Sudamericana fixtures from Promiedos (free, no API key).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--competition',
            required=True,
            choices=sorted(COMPETITIONS),
            help='lib (Copa Libertadores), sud (Copa Sudamericana) or unl (UEFA Nations League -- run unl via sync_promiedos_nations_league, not this command).',
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

    def fetch(self, url, is_html=False):
        """GET with retries; raises CommandError on persistent failure."""
        last_error = None
        for attempt in range(MAX_ATTEMPTS):
            request = Request(url, headers=HEADERS)
            try:
                with urlopen(request, timeout=REQUEST_TIMEOUT) as response:
                    body = response.read().decode('utf-8', errors='replace')
                return body
            except OSError as exc:  # TimeoutError, URLError, HTTPError
                last_error = exc
                if attempt < MAX_ATTEMPTS - 1:
                    self.stderr.write(self.style.WARNING(
                        f'[promiedos] Request failed ({exc}); retrying '
                        f'({attempt + 1}/{MAX_ATTEMPTS}).'
                    ))
                    time.sleep(BACKOFF_SECONDS * (attempt + 1))
        raise CommandError(f'Unable to fetch {url}: {last_error}')

    def fetch_json(self, url):
        return json.loads(self.fetch(url))

    def get_filters(self, league_slug, league_id):
        html = self.fetch(f'{PROMIEDOS_WEB}/league/{league_slug}/{league_id}')
        match = re.search(
            r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
            html,
            re.DOTALL,
        )
        if not match:
            raise CommandError(f'No __NEXT_DATA__ blob found on the {league_slug}/{league_id} page.')
        data = json.loads(match.group(1))
        filters = (
            data.get('props', {}).get('pageProps', {}).get('data', {}).get('games', {}).get('filters')
            or []
        )
        selected = []
        for item in filters:
            key = item.get('key')
            name = item.get('name')
            if not key or key == 'latest':
                continue
            if 'fase' in name.lower():
                continue  # qualifying rounds, not part of the tournament proper
            match = FECHA_RE.search(name or '')
            selected.append((key, name, int(match.group(1)) if match else None))
        # Group-stage games must win the (season, home_team, away_team)
        # upsert: CONMEBOL teams can rematch in the knockout phase (Vasco and
        # Olimpia met in the Sudamericana group AND in the playoffs), and the
        # model's unique constraint allows only one row per directed pair.
        # Processing knockout filters first means a later Fecha update
        # overwrites a knockout row with the group fixture, never the reverse.
        selected.sort(key=lambda item: item[2] is not None)
        return selected

    def resolve_association_code(self, team_info):
        """3-letter association code for a Promiedos team, or None.

        country_id map first: it is site-wide consistent and, unlike the name
        map, disambiguates 'Universidad Católica' (Ecuador 'fb' vs Chile 'ci').
        The name map is the fallback for any country_id we have not seen.
        """
        code = PROMIEDOS_COUNTRY_ID_MAP.get(team_info.get('country_id'))
        if code:
            return code
        return TEAM_COUNTRY_BY_NAME.get(normalize_text(team_info.get('name')))

    def season_defaults(self):
        """Extra Season defaults applied on CREATE, beside `competition`.

        The 4-pots-of-8 / 6-match UCL-CONMEBOL shape is this command's own;
        a national-team competition overrides it (the Nations League subclass
        returns `{}` so the model defaults stand). `get_or_create` applies
        these on CREATE only.
        """
        return {'pot_count': 4, 'teams_per_pot': 8, 'total_matches': 6}

    def unresolved_team_label(self, name, country_id):
        """Label for the 'Skipped teams with unresolvable country' warning.

        Name-only by default, matching this command's output today. The
        Nations League subclass adds the opaque `country_id`, because a
        national team's name alone does not say which map key is missing
        (spec R10/S10b).
        """
        return name

    def upsert_association(self, code, cache):
        if code not in cache:
            cache[code], _ = Association.objects.get_or_create(
                code=code,
                defaults={'name': COUNTRY_NAMES.get(code, code)},
            )
        return cache[code]

    def upsert_team(self, team_info, association_cache, team_cache):
        """Team by (association, name); cached per run by Promiedos team id. None if country unresolved."""
        name = (team_info.get('name') or '').strip()
        if not name:
            return None
        team_id = team_info.get('id')
        if team_id in team_cache:
            return team_cache[team_id]

        code = self.resolve_association_code(team_info)
        if not code:
            return None
        association = self.upsert_association(code, association_cache)

        short_name = (team_info.get('short_name') or name)[:30]
        team, _ = Team.objects.get_or_create(
            association=association,
            name=name,
            defaults={'short_name': short_name, 'logo_url': ''},
        )
        team_cache[team_id] = team
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
        league_id, league_slug, competition_code, competition_label = COMPETITIONS[competition_key]
        season_name = f'{competition_label} {season_year}'

        self.stdout.write(
            f'[promiedos] Fetching {season_name} fixtures from Promiedos (league {league_id}).'
        )
        filters = self.get_filters(league_slug, league_id)
        if not filters:
            self.stderr.write(self.style.WARNING('[promiedos] No filters found on the league page.'))
            return
        self.stdout.write(
            '[promiedos] Filters: '
            f"{len(filters)} ({', '.join(name for _, name, _ in filters)})"
        )

        games = []
        for key, name, matchday in filters:
            payload = self.fetch_json(f'{PROMIEDOS_API}/league/games/{league_id}/{key}')
            stage_games = payload.get('games') or []
            self.stdout.write(f"[promiedos] Got {len(stage_games)} games for '{name}' ({key})")
            games.extend((game, matchday) for game in stage_games)
            time.sleep(REQUEST_PAUSE_SECONDS)
        if not games:
            self.stderr.write(self.style.WARNING('[promiedos] No games returned by any filter.'))
            return

        with transaction.atomic():
            season, _ = Season.objects.get_or_create(
                name=season_name,
                defaults={'competition': competition_code, **self.season_defaults()},
            )
            if season.competition != competition_code:
                self.stderr.write(self.style.ERROR(
                    f'[promiedos] Season "{season_name}" already exists as {season.get_competition_display()}.'
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
            history_observations = []

            for game, filter_matchday in games:
                teams_info = game.get('teams') or []
                if len(teams_info) < 2:
                    skipped_matchups += 1
                    continue
                home_info, away_info = teams_info[0], teams_info[1]
                home = self.upsert_team(home_info, associations, teams)
                away = self.upsert_team(away_info, associations, teams)
                if home is None:
                    skipped_team_names.add(
                        self.unresolved_team_label(
                            home_info.get('name') or '?', home_info.get('country_id')
                        )
                    )
                if away is None:
                    skipped_team_names.add(
                        self.unresolved_team_label(
                            away_info.get('name') or '?', away_info.get('country_id')
                        )
                    )
                if home is None or away is None or home.pk == away.pk:
                    skipped_matchups += 1
                    continue
                home_entry = self.upsert_entry(season, home, entries)
                away_entry = self.upsert_entry(season, away, entries)

                status = map_status(game)
                finished = status == 'FINISHED'
                scores = game.get('scores') or []
                defaults = {
                    'matchday': filter_matchday,
                    'external_id': 'promiedos:' + (game.get('id') or ''),
                    'kickoff': parse_promiedos_kickoff(game.get('start_time')),
                    'status': status,
                    'home_goals': int(scores[0]) if finished and len(scores) > 0 else None,
                    'away_goals': int(scores[1]) if finished and len(scores) > 1 else None,
                }

                # The triple is the model's own (season, home, away) identity;
                # external_id is overwritten when a directed pair recurs (group
                # + knockout), the very case history exists for. Collected for
                # every game whose defaults we build, not only changed ones: the
                # helper dedupes against history, so an unchanged fixture adds
                # nothing and a missed flush is re-collected next run
                # (belt-and-braces on the surrounding transaction).
                history_observations.append({
                    'subject': f'{season.pk}:{home_entry.pk}:{away_entry.pk}',
                    'home_label': home.name,
                    'away_label': away.name,
                    'home_goals': defaults['home_goals'],
                    'away_goals': defaults['away_goals'],
                    'status': defaults['status'],
                })

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

            # Flushed once, before the run summary, inside the existing
            # transaction: the live upsert and the history append commit
            # together, so a crash cannot lose the previous value.
            if history_observations:
                record_result_history(
                    history_observations,
                    source='promiedos',
                    competition=competition_code,
                    season_name=season.name,
                )

            if skipped_team_names:
                self.stderr.write(self.style.WARNING(
                    '[promiedos] Skipped teams with unresolvable country: '
                    + ', '.join(sorted(skipped_team_names))
                ))
            if skipped_matchups:
                self.stderr.write(self.style.WARNING(
                    f'[promiedos] Skipped {skipped_matchups} matchups (missing team data).'
                ))

            self.stdout.write(f'[promiedos] Created Season: {season_name} ({competition_code})')
            self.stdout.write(
                f'[promiedos] Upserted {len(teams)} teams, {len(associations)} associations, {matchups} matchups'
            )
            self.stdout.write(f'[promiedos] Season is active: {season.is_active}')