"""Fetch UCL 2026/27 league-phase results and write them into the
real fixtures JSON (draw/data/ucl_league_phase_real_fixtures_2026_27.json).

Sources:
  promiedos (default): free, no API key; real-time scores parsed from the
      page's embedded __NEXT_DATA__ JSON. Same source the live-scores
      endpoint uses.
  football-data: https://api.football-data.org/v4/competitions/CL/matches
      Free tier covers the Champions League; requires API_FOOTBALL_DATA_KEY.
      Can lag behind on FINISHED status shortly after a match ends.
  fbref: free and needs no API key, but FBref blocks many networks.

Only each fixture's `result` field is touched; kickoffs, team names, and
structure stay as-is.

Usage:
  python manage.py sync_real_fixture_results [--dry-run] [--source football-data|fbref|promiedos] [--fixtures-json <path>]
"""

import html
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

FBREF_URL = 'https://fbref.com/en/comps/8/schedule/Champions-League-Scores-and-Fixtures'
FOOTBALL_DATA_URL = 'https://api.football-data.org/v4/competitions/CL/matches?season={season}'
PROMIEDOS_URL = 'https://www.promiedos.com.ar/league/uefa-champions-league/fhc'

# Country codes FBref appends after team names on international pages, e.g.
# "RB Leipzig de", "nl PSV". Stripped during normalization.
_COUNTRY_CODES = {
    'al', 'am', 'at', 'az', 'ba', 'be', 'bg', 'by', 'ch', 'cy', 'cz', 'de',
    'dk', 'ee', 'eng', 'es', 'fi', 'fr', 'ge', 'gr', 'hr', 'hu', 'ie', 'il',
    'is', 'it', 'kz', 'lt', 'lu', 'lv', 'md', 'me', 'mk', 'mt', 'nl', 'no',
    'pl', 'pt', 'ro', 'rs', 'ru', 'se', 'si', 'sk', 'tr', 'ua', 'xko',
}

# FBref spelling -> our JSON spelling (both after normalize()).
_ALIASES = {
    'bayern munich': 'bayern munchen',
    'shakhtar d': 'shakhtar donetsk',
    'shakhtar d.': 'shakhtar donetsk',
    'como': 'como 1907',
    'psg': 'paris saint germain',
    'paris saint-germain': 'paris saint germain',
    'slavia prague': 'slavia praha',
    'viking': 'viking fk',
    'club brugge': 'club brugge kv',
    'roma': 'as roma',
    'sporting': 'sporting cp',
    'lens': 'rc lens',
    'psv': 'psv eindhoven',
    'sabah fk': 'sabah',
    # football-data.org spelling -> our JSON spelling.
    'arsenal fc': 'arsenal',
    'aston villa fc': 'aston villa',
    'club atletico de madrid': 'atletico madrid',
    'fc barcelona': 'barcelona',
    'fc bayern munchen': 'bayern munchen',
    'fc internazionale milano': 'inter',
    'fc porto': 'porto',
    'fk bodo/glimt': 'bodo/glimt',
    'fk shakhtar donetsk': 'shakhtar donetsk',
    'fenerbahce sk': 'fenerbahce',
    'feyenoord rotterdam': 'feyenoord',
    'galatasaray sk': 'galatasaray',
    'lask linz': 'lask',
    'lille osc': 'lille',
    'liverpool fc': 'liverpool',
    'manchester city fc': 'manchester city',
    'manchester united fc': 'manchester united',
    'pae aek': 'aek athens',
    'paris saint-germain fc': 'paris saint germain',
    'racing club de lens': 'rc lens',
    'real betis balompie': 'real betis',
    'real madrid cf': 'real madrid',
    'sk slavia praha': 'slavia praha',
    'sk slovan bratislava': 'slovan bratislava',
    'sporting clube de portugal': 'sporting cp',
    'ssc napoli': 'napoli',
    'villarreal cf': 'villarreal',
    # promiedos url_name -> our JSON spelling.
    'bodo glimt': 'bodo/glimt',
    'inter milan': 'inter',
    'stuttgart': 'vfb stuttgart',
}

_SCORE_RE = re.compile(r'(\d+)\s*[–—-]\s*(\d+)')

# Letters with no NFKD decomposition (on some platforms 'ø' stays itself and
# would be dropped entirely by the ascii pass) plus multi-char ligatures.
_TRANSLIT = str.maketrans({
    'ø': 'o', 'Ø': 'O', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE',
    'đ': 'd', 'Đ': 'D', 'ł': 'l', 'Ł': 'L', 'ß': 'ss',
})


def normalize(name):
    """Lowercase, strip accents, collapse spaces, drop a trailing country code."""
    name = unicodedata.normalize('NFKD', name.translate(_TRANSLIT)).encode('ascii', 'ignore').decode('ascii')
    name = re.sub(r'\s+', ' ', name).strip().lower()
    parts = name.split(' ')
    if parts and parts[-1] in _COUNTRY_CODES:
        parts = parts[:-1]
    return ' '.join(parts)


def resolve(name):
    return _ALIASES.get(normalize(name), normalize(name))


def fetch(url, timeout=20, source='FBref'):
    """Fetch a URL with a browser-ish User-Agent and bounded retries."""
    last_exc = None
    for attempt in range(3):
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'champions-draw-sync/1.0 (Mozilla-compatible)'},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode('utf-8', errors='replace')
        except urllib.error.HTTPError as exc:
            last_exc = exc
            if exc.code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(5 * (attempt + 1))
                continue
            break
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_exc = exc
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            break
    raise RuntimeError(f'{source} fetch failed after 3 attempts: {last_exc}')


def fetch_football_data(api_key, season=2026, timeout=20):
    """Fetch UCL league-phase matches from football-data.org's free API."""
    url = FOOTBALL_DATA_URL.format(season=season)
    last_exc = None
    for attempt in range(3):
        req = urllib.request.Request(
            url,
            headers={
                'X-Auth-Token': api_key,
                'User-Agent': 'champions_draw/1.0',
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as exc:
            last_exc = exc
            if exc.code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(5 * (attempt + 1))
                continue
            break
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_exc = exc
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            break
    raise RuntimeError(f'football-data fetch failed after 3 attempts: {last_exc}')


def parse_football_data(payload):
    """Return finished league-phase matches as {home, away, home_goals, away_goals}.

    football-data.org covers the whole season in one response, so we keep only
    LEAGUE_STAGE fixtures (matchdays 1-8) whose status is FINISHED.
    """
    matches = []
    for m in payload.get('matches', []):
        if m.get('stage') != 'LEAGUE_STAGE':
            continue
        if m.get('status') != 'FINISHED':
            continue
        home = m['homeTeam']['name']
        away = m['awayTeam']['name']
        goals = m['score'].get('fullTime') or {}
        if goals.get('home') is None or goals.get('away') is None:
            continue
        matches.append({
            'home': home,
            'away': away,
            'home_goals': goals['home'],
            'away_goals': goals['away'],
        })
    return matches


_PROMIEDOS_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S,
)


def _promiedos_games(html_text):
    """Return the raw games list from promiedos' __NEXT_DATA__ JSON."""
    m = _PROMIEDOS_NEXT_DATA_RE.search(html_text)
    if not m:
        raise ValueError('No __NEXT_DATA__ script found in promiedos HTML')
    payload = json.loads(m.group(1))
    filters = payload['props']['pageProps']['data']['games']['filters']
    games = []
    for group in filters:
        games.extend(group.get('games') or [])
    return games


def _promiedos_match(game):
    """Map one promiedos game dict to {home, away, home_goals, away_goals, status?}."""
    teams = game.get('teams') or []
    scores = game.get('scores') or []
    if len(teams) < 2 or len(scores) < 2:
        return None
    return {
        'home': (teams[0].get('url_name') or teams[0].get('name')).replace('-', ' '),
        'away': (teams[1].get('url_name') or teams[1].get('name')).replace('-', ' '),
        'home_goals': int(scores[0]),
        'away_goals': int(scores[1]),
    }


def parse_promiedos(html_text):
    """Return finished league-phase matches from promiedos' __NEXT_DATA__ JSON.

    Promiedos is a Next.js site, so the whole page state is one JSON blob.
    Games live under games.filters[*].games; only 'Final' ones have scores.
    Team names come from the machine-friendly url_name field, with its url
    hyphens translated to spaces so resolve()/_ALIASES can match fixtures.
    """
    return [
        m for m in (
            _promiedos_match(game)
            for game in _promiedos_games(html_text)
            if game.get('game_time_status_to_display') == 'Final'
        )
        if m
    ]


def parse_promiedos_live(html_text):
    """Return in-play league-phase matches as {home, away, home_goals, away_goals, status}.

    Finished games are marked 'Final' and scheduled ones 'Prog.' (with an
    empty scores array); any other status -- e.g. "28'", "HT" -- is a game in
    play, and its scores array holds the current goals. Used by the live-
    scores API, never for persisting results.
    """
    matches = []
    for game in _promiedos_games(html_text):
        status = game.get('game_time_status_to_display') or ''
        if status == 'Final':
            continue
        m = _promiedos_match(game)
        if m is None:
            continue  # scheduled/suspended: no score line yet
        m['status'] = status
        matches.append(m)
    return matches


class _ScheduleParser(HTMLParser):
    """Collects, per table row: cell texts and squad-link team names."""

    def __init__(self):
        super().__init__()
        self.rows = []
        self._row = None
        self._cell = None
        self._cell_parts = []
        self._team_name = None
        self._team_buf = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'tr':
            self._row = {'cells': [], 'teams': []}
        elif tag == 'td' and self._row is not None:
            self._cell = []
            self._cell_parts = []
        elif tag == 'a' and self._row is not None and '/en/squads/' in attrs.get('href', ''):
            self._team_name = ''
            self._team_buf = []

    def handle_endtag(self, tag):
        if tag == 'td' and self._row is not None and self._cell is not None:
            self._row['cells'].append(''.join(self._cell_parts).strip())
            self._cell = None
        elif tag == 'a' and self._team_name is not None:
            if self._row is not None:
                self._row['teams'].append(''.join(self._team_buf).strip())
            self._team_name = None
        elif tag == 'tr' and self._row is not None:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell_parts.append(data)
        if self._team_name is not None:
            self._team_buf.append(data)


def parse_schedule(html_text):
    """Return played league-phase matches as {home, away, home_goals, away_goals}."""
    parser = _ScheduleParser()
    parser.feed(html.unescape(html_text))

    matches = []
    for row in parser.rows:
        cells = [c for c in row['cells'] if c]
        if 'League phase' not in cells or len(row['teams']) < 2:
            continue
        score = None
        for cell in cells:
            m = _SCORE_RE.fullmatch(cell)
            if m:
                score = (int(m.group(1)), int(m.group(2)))
                break
        if score is None:
            continue  # fixture scheduled, not played yet
        matches.append({
            'home': row['teams'][0],
            'away': row['teams'][1],
            'home_goals': score[0],
            'away_goals': score[1],
        })
    return matches


def match_results(data, matches):
    """Pair each FBref result with its fixture index, by normalized team pair."""
    by_pair = {}
    for i, fixture in enumerate(data['fixtures']):
        by_pair.setdefault((resolve(fixture['home']), resolve(fixture['away'])), []).append(i)

    updates = []
    unmatched = []
    for m in matches:
        key = (resolve(m['home']), resolve(m['away']))
        idxs = by_pair.get(key)
        if not idxs:
            unmatched.append(f"{m['home']} vs {m['away']}")
            continue
        updates.append({'index': idxs.pop(0), **m})

    return updates, unmatched


class Command(BaseCommand):
    help = 'Sync real UCL league-phase results into the fixtures JSON.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--source',
            choices=['football-data', 'fbref', 'promiedos'],
            default='promiedos',
            help='Result provider (default: promiedos — real-time, no API key; football-data lags on FINISHED).',
        )
        parser.add_argument('--season', type=int, default=2026, help='Season year for football-data (default: 2026).')
        parser.add_argument('--url', default=FBREF_URL, help='FBref schedule URL (source=fbref only).')
        parser.add_argument('--dry-run', action='store_true', help='Report results without writing.')
        parser.add_argument(
            '--fixtures-json',
            default=str(Path(__file__).resolve().parents[3] / 'draw' / 'data' / 'ucl_league_phase_real_fixtures_2026_27.json'),
            help='Path to the real fixtures JSON.',
        )

    def handle(self, *args, **options):
        source = options['source']
        dry_run = options['dry_run']
        path = Path(options['fixtures_json'])

        if source == 'fbref':
            url = options['url']
            self.stdout.write(f'Fetching {url} ...')
            html_text = fetch(url)
            matches = parse_schedule(html_text)
            label = f'{len(matches)} played league-phase matches from FBref'
        elif source == 'promiedos':
            self.stdout.write(f'Fetching {PROMIEDOS_URL} ...')
            html_text = fetch(PROMIEDOS_URL, source='Promiedos')
            matches = parse_promiedos(html_text)
            label = f'{len(matches)} finished league-phase matches from promiedos'
        else:
            api_key = os.getenv('API_FOOTBALL_DATA_KEY', '').strip().strip('"\'')
            if not api_key:
                raise CommandError('API_FOOTBALL_DATA_KEY not set in environment.')
            self.stdout.write(f'Fetching football-data season {options["season"]} ...')
            payload = fetch_football_data(api_key, season=options['season'])
            matches = parse_football_data(payload)
            label = f'{len(matches)} finished league-phase matches from football-data'
        self.stdout.write(f'Parsed {label}.')

        with open(path, encoding='utf-8') as f:
            data = json.load(f)

        updates, unmatched = match_results(data, matches)

        updated = 0
        already = 0
        for u in updates:
            fixture = data['fixtures'][u['index']]
            new_result = {'home_goals': u['home_goals'], 'away_goals': u['away_goals']}
            if fixture.get('result') == new_result:
                already += 1
                continue
            updated += 1
            label = 'would update' if dry_run else 'updated'
            self.stdout.write(f'  {label}: {fixture["home"]} {u["home_goals"]}-{u["away_goals"]} {fixture["away"]}')
            if not dry_run:
                fixture['result'] = new_result

        if unmatched:
            self.stdout.write(self.style.WARNING(
                f'{len(unmatched)} source matches did not match our fixtures (name mismatch):'
            ))
            for name in unmatched[:20]:
                self.stdout.write(f'  - {name}')

        if not dry_run and updated:
            # Atomic rewrite, same style (indent=2, no trailing newline).
            tmp = path.with_name(path.name + '.tmp')
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, path)
            self.stdout.write(self.style.SUCCESS(f'Wrote {path}'))

        self.stdout.write(self.style.SUCCESS(
            f'Done. {len(matches)} source matches, {len(updates)} matched, '
            f'{updated} {"would be " if dry_run else ""}updated, {already} already current.'
        ))