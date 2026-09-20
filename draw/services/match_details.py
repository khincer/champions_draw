"""Match-detail service: header from own fixtures, detail from football-data listing."""

import json
import os
import time
import urllib.error
import urllib.request

from django.http import Http404

from ..management.commands.sync_real_fixture_results import (
    fetch_football_data,
    resolve,
)

# ponytail: module-level dict, single-process only; Redis if multi-worker
_LISTING_CACHE = {'at': 0.0, 'payload': None, 'season': None}
# League listings are keyed by (competition code, season year); one slot per
# competition instead of the single UCL slot above.
_LEAGUE_LISTING_CACHE = {}
_LISTING_TTL = 3600  # 1 hour

_FOOTBALL_DATA_COMPETITION_URL = (
    'https://api.football-data.org/v4/competitions/{code}/matches?season={season}'
)


def clear_listing_cache():
    _LISTING_CACHE['payload'] = None
    _LISTING_CACHE['at'] = 0.0
    _LISTING_CACHE['season'] = None
    _LEAGUE_LISTING_CACHE.clear()


def build_header(fixture, now):
    """Build the header dict from an own-fixture entry.

    Status derivation: result -> FINISHED; else now >= kickoff -> IN_PLAY;
    else SCHEDULED (the endpoint never returns SCHEDULED — 404s before it).
    """
    result = fixture.get('result')
    home_team = fixture['home_team']
    away_team = fixture['away_team']

    if result:
        score = {'home_goals': result['home_goals'], 'away_goals': result['away_goals']}
        status = 'FINISHED'
    else:
        score = None
        from datetime import datetime, timezone as tz
        kickoff_dt = datetime.fromisoformat(fixture['kickoff'].replace('Z', '+00:00'))
        status = 'IN_PLAY' if now >= kickoff_dt else 'SCHEDULED'

    return {
        'home_team': {
            'name': home_team.get('name', ''),
            'logo_url': home_team.get('logo_url'),
        },
        'away_team': {
            'name': away_team.get('name', ''),
            'logo_url': away_team.get('logo_url'),
        },
        'score': score,
        'status': status,
        'kickoff': fixture['kickoff'],
        'matchday': fixture['matchday'],
    }


def _map_referees(match):
    return [
        {'name': r.get('name', ''), 'role': r.get('type', '')}
        for r in match.get('referees', [])
    ]


def _map_half_time(match):
    """Return the half-time score as {home_goals, away_goals}, or None."""
    half = (match.get('score') or {}).get('halfTime') or {}
    if half.get('home') is None or half.get('away') is None:
        return None
    return {'home_goals': half['home'], 'away_goals': half['away']}


def map_detail(match):
    """Map a football-data match dict to the detail envelope shape.

    Returns None when *match* is None.
    """
    if match is None:
        return None

    odds_raw = match.get('odds', {}) or {}
    odds = {
        'homeWin': odds_raw.get('homeWin'),
        'draw': odds_raw.get('draw'),
        'awayWin': odds_raw.get('awayWin'),
    }

    return {
        'venue': match.get('venue'),
        'referees': _map_referees(match),
        'odds': odds,
        'half_time': _map_half_time(match),
        'status': match.get('status'),
        'utcDate': match.get('utcDate'),
    }


def map_league_detail(match):
    """Map a league (PL/BL1/SA/PD) football-data match to the detail envelope.

    Returns None when *match* is None.

    Deliberately omits `venue` and `odds`: the football-data plan carries
    neither for these competitions (venue is null and odds are gated behind
    the Odds-Package), so the UI must not render empty rows for them. The
    frontend treats key presence as "render this block".
    """
    if match is None:
        return None

    return {
        'referees': _map_referees(match),
        'half_time': _map_half_time(match),
        'status': match.get('status'),
        'utcDate': match.get('utcDate'),
    }


def load_football_data_listing(season_name):
    """Return cached or fresh football-data season listing.

    Raises RuntimeError on API key missing or upstream failure so the
    caller can catch and set detail_error.
    """
    now = time.monotonic()
    cache = _LISTING_CACHE

    if cache['payload'] is not None and (now - cache['at']) < _LISTING_TTL and cache['season'] == season_name:
        return cache['payload']

    api_key = os.getenv('API_FOOTBALL_DATA_KEY', '')
    if not api_key:
        raise RuntimeError('API_FOOTBALL_DATA_KEY not set')

    # Extract season year from name like "2025-26" -> 2025
    season_year = int(season_name.split('-')[0])

    payload = fetch_football_data(api_key, season=season_year, timeout=10)

    cache['payload'] = payload
    cache['at'] = time.monotonic()
    cache['season'] = season_name
    return payload


def find_listing_match(listing, home_name, away_name, matchday):
    """Find a match in the football-data listing by resolved names + matchday.

    Returns the match dict or None.
    """
    r_home = resolve(home_name)
    r_away = resolve(away_name)

    for m in listing.get('matches', []):
        m_home = resolve(m['homeTeam']['name'])
        m_away = resolve(m['awayTeam']['name'])
        if m.get('matchday') == matchday and m_home == r_home and m_away == r_away:
            return m
    return None


def fetch_competition_matches(api_key, competition_code, season_year, timeout=10):
    """Fetch one competition's season matches from football-data.org.

    Mirrors the retry loop in `fetch_football_data`, which is hardcoded to the
    CL URL and lives in the sync-command module (not reusable for leagues).
    """
    url = _FOOTBALL_DATA_COMPETITION_URL.format(code=competition_code, season=season_year)
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


def season_year_for(kickoff):
    """Map a fixture kickoff to the football-data season year.

    The four active leagues (PL, BL1, SA, PD) run August-May, so a January-June
    kickoff belongs to the season that started the previous year.
    """
    if kickoff is None:
        from datetime import datetime, timezone as tz
        return datetime.now(tz.utc).year
    return kickoff.year if kickoff.month >= 7 else kickoff.year - 1


def load_football_data_league(competition_code, season_year):
    """Return a cached or fresh football-data listing for one league season.

    Raises RuntimeError on API key missing or upstream failure so the caller
    can catch and set detail_error.
    """
    now = time.monotonic()
    key = (competition_code, season_year)
    cached = _LEAGUE_LISTING_CACHE.get(key)
    if cached is not None and (now - cached['at']) < _LISTING_TTL:
        return cached['payload']

    api_key = os.getenv('API_FOOTBALL_DATA_KEY', '')
    if not api_key:
        raise RuntimeError('API_FOOTBALL_DATA_KEY not set')

    payload = fetch_competition_matches(api_key, competition_code, season_year, timeout=10)
    _LEAGUE_LISTING_CACHE[key] = {'at': time.monotonic(), 'payload': payload}
    return payload


def find_league_listing_match(listing, match_id):
    """Find a football-data match by fixture id.

    `LeagueMatch.match_id` IS the football-data fixture id, so this is an exact
    join — no name resolution or matchday matching required.
    """
    for m in listing.get('matches', []):
        if m.get('id') == match_id:
            return m
    return None


def build_league_header(match):
    """Build the header dict from a LeagueMatch row."""
    score = None
    if match.home_goals is not None and match.away_goals is not None:
        score = {'home_goals': match.home_goals, 'away_goals': match.away_goals}

    return {
        'home_team': {'name': match.home_name, 'logo_url': match.home_crest or None},
        'away_team': {'name': match.away_name, 'logo_url': match.away_crest or None},
        'score': score,
        'status': match.status,
        'kickoff': match.kickoff.isoformat().replace('+00:00', 'Z') if match.kickoff else None,
        'matchday': match.matchday,
    }
