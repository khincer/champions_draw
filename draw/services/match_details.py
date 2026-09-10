"""Match-detail service: header from own fixtures, detail from football-data listing."""

import os
import time

from django.http import Http404

from ..management.commands.sync_real_fixture_results import (
    fetch_football_data,
    resolve,
)

# ponytail: module-level dict, single-process only; Redis if multi-worker
_LISTING_CACHE = {'at': 0.0, 'payload': None, 'season': None}
_LISTING_TTL = 3600  # 1 hour


def clear_listing_cache():
    _LISTING_CACHE['payload'] = None
    _LISTING_CACHE['at'] = 0.0
    _LISTING_CACHE['season'] = None


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


def map_detail(match):
    """Map a football-data match dict to the detail envelope shape.

    Returns None when *match* is None.
    """
    if match is None:
        return None

    venue = match.get('venue')
    referees_raw = match.get('referees', [])
    referees = [{'name': r.get('name', ''), 'role': r.get('type', '')} for r in referees_raw]
    odds_raw = match.get('odds', {}) or {}
    odds = {
        'homeWin': odds_raw.get('homeWin'),
        'draw': odds_raw.get('draw'),
        'awayWin': odds_raw.get('awayWin'),
    }

    return {
        'venue': venue,
        'referees': referees,
        'odds': odds,
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
