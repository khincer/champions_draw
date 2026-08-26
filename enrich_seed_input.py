#!/usr/bin/env python3
"""Enrich seed input JSON with missing API-Football data.

Reads a seed input JSON file, finds entries with missing api_football_id,
and fetches the data from API-Football. Updates the JSON in-place.

Usage:
    python enrich_seed_input.py <input_file> [--dry-run]

Requires API_FOOTBALL_KEY environment variable.
"""

import argparse
import json
import os
import sys
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlencode


DEFAULT_BASE_URL = 'https://v3.football.api-sports.io'
DEFAULT_TIMEOUT = 10
RATE_LIMIT_WAIT_SECONDS = 65
MAX_RATE_LIMIT_RETRIES = 5

CLUB_NAME_STOPWORDS = {
    'ac', 'afc', 'as', 'association', 'c', 'cf', 'club', 'cp', 'de',
    'fc', 'fk', 'foot', 'football', 'kv', 'nk', 'sc', 'sco', 'sk',
}
DISALLOWED_TEAM_MARKERS = {
    'b', 'ii', 'iii', 'iv', 'reserves', 'reserve', 'u17', 'u18', 'u19', 'u20',
    'u21', 'u23', 'women', 'woman', 'w', 'youth',
}

# Search terms for teams that might not match directly
SEARCH_TERMS: dict[str, tuple[str, ...]] = {
    'Bayern Munchen': ('Bayern Munich',),
    'Sporting CP': ('Sporting',),
    'Club Brugge': ('Brugge',),
    'Olympiacos': ('Olympiakos', 'Olympiakos Piraeus'),
    'Monaco': ('AS Monaco',),
    'Villarreal': ('Villarreal',),
    'Eintracht Frankfurt': ('Eintracht Frankfurt', 'Frankfurt'),
    'Bodo/Glimt': ('Bodo Glimt', 'Bodo/Glimt FK'),
    'Como 1907': ('Como', 'Como 1907'),
    'Sabah': ('Sabah FK', 'Sabah Baku'),
    'RB Leipzig': ('Leipzig', 'RB Leipzig'),
    'LASK': ('LASK Linz', 'LASK'),
    'Shakhtar Donetsk': ('Shakhtar', 'Shakhtar Donetsk'),
    'Galatasaray': ('Galatasaray SK', 'Galatasaray'),
    'Feyenoord': ('Feyenoord Rotterdam', 'Feyenoord'),
    'Lille': ('Lille OSC', 'Lille'),
    'Napoli': ('SSC Napoli', 'Napoli'),
    'Villarreal': ('Villarreal CF', 'Villarreal'),
}

COUNTRY_NAMES = {
    'AZE': 'Azerbaijan',
    'AUT': 'Austria',
    'BEL': 'Belgium',
    'CYP': 'Cyprus',
    'CZE': 'Czech-Republic',
    'DEN': 'Denmark',
    'ENG': 'England',
    'ESP': 'Spain',
    'FRA': 'France',
    'GER': 'Germany',
    'GRE': 'Greece',
    'ITA': 'Italy',
    'KAZ': 'Kazakhstan',
    'NED': 'Netherlands',
    'NOR': 'Norway',
    'POR': 'Portugal',
    'TUR': 'Turkey',
    'UKR': 'Ukraine',
}


def log(message: str) -> None:
    print(f'[enrich_seed_input] {message}', flush=True)


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize('NFKD', value)
    ascii_only = normalized.encode('ascii', 'ignore').decode('ascii')
    letters_only = ''.join(character.lower() if character.isalnum() else ' ' for character in ascii_only)
    return ' '.join(letters_only.split())


def canonicalize_club_name(value: str) -> str:
    tokens = [
        token for token in normalize_text(value).split()
        if token not in CLUB_NAME_STOPWORDS
    ]
    return ' '.join(tokens)


def get_search_terms(team_name: str) -> tuple[str, ...]:
    seen: set[str] = set()
    ordered_terms: list[str] = []

    for term in SEARCH_TERMS.get(team_name, (team_name,)):
        normalized_term = normalize_text(term)
        if normalized_term and normalized_term not in seen:
            seen.add(normalized_term)
            ordered_terms.append(term)

    return tuple(ordered_terms)


def load_project_defaults() -> tuple[str, str | None, int]:
    base_url = os.getenv('API_FOOTBALL_BASE_URL') or os.getenv('API_URL') or DEFAULT_BASE_URL
    api_key = os.getenv('API_FOOTBALL_KEY') or os.getenv('API_KEY')
    timeout_raw = os.getenv('API_FOOTBALL_TIMEOUT') or os.getenv('TIMEOUT')

    project_root = Path(__file__).resolve().parent
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    try:
        from champions_draw import settings as project_settings
    except Exception:
        timeout = int(timeout_raw) if timeout_raw else DEFAULT_TIMEOUT
        return base_url, api_key, timeout

    base_url = api_key or getattr(project_settings, 'API_URL', DEFAULT_BASE_URL)
    api_key = api_key or getattr(project_settings, 'API_KEY', None)
    timeout_value = timeout_raw or str(getattr(project_settings, 'TIMEOUT', DEFAULT_TIMEOUT))
    timeout = int(timeout_value)

    return base_url, api_key, timeout


def api_get(base_url: str, api_key: str, timeout: int, endpoint: str, params: dict[str, Any]) -> dict[str, Any]:
    query = urlencode(params)
    for attempt in range(1, MAX_RATE_LIMIT_RETRIES + 1):
        log(f'Requesting {endpoint}?{query} (attempt {attempt}/{MAX_RATE_LIMIT_RETRIES})')
        request = Request(
            url=f"{base_url.rstrip('/')}/{endpoint}?{query}",
            headers={
                'x-apisports-key': api_key,
                'Accept': 'application/json',
            },
        )

        try:
            with urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode('utf-8'))
        except HTTPError as exc:
            body = exc.read().decode('utf-8', errors='replace')
            raise RuntimeError(f'API-football returned HTTP {exc.code}: {body}') from exc
        except URLError as exc:
            raise RuntimeError(f'Unable to reach API-football: {exc.reason}') from exc

        errors = payload.get('errors') or {}
        if isinstance(errors, dict) and errors.get('rateLimit'):
            if attempt == MAX_RATE_LIMIT_RETRIES:
                raise RuntimeError(f"API-football rate limit persisted for {endpoint}?{query}: {errors['rateLimit']}")
            log(f"Rate limit reached. Waiting {RATE_LIMIT_WAIT_SECONDS} seconds before retrying.")
            time.sleep(RATE_LIMIT_WAIT_SECONDS)
            continue

        if errors:
            log(f'API-football returned non-fatal errors: {errors}')

        results = payload.get('results')
        if results is not None:
            log(f'Received {results} results from {endpoint}.')
        else:
            log(f'Received response from {endpoint}.')
        return payload

    raise RuntimeError(f'Unable to retrieve {endpoint}?{query} from API-football.')


def country_matches(association_code: str, candidate_country: str | None) -> bool:
    if not candidate_country:
        return False
    expected_country = COUNTRY_NAMES.get(association_code)
    return normalize_text(candidate_country) == normalize_text(expected_country or association_code)


def is_disallowed_candidate(team_data: dict[str, Any]) -> bool:
    name = normalize_text(team_data.get('name', ''))
    if not name:
        return False

    tokens = name.split()
    if any(marker in tokens for marker in DISALLOWED_TEAM_MARKERS):
        return True

    if name.endswith(' b'):
        return True

    return False


def score_candidate(team_name: str, association_code: str, short_name: str, candidate: dict[str, Any]) -> int:
    team_data = candidate.get('team', {})
    if is_disallowed_candidate(team_data):
        return -1

    candidate_name = normalize_text(team_data.get('name', ''))
    candidate_canonical = canonicalize_club_name(team_data.get('name', ''))
    candidate_code = normalize_text(team_data.get('code') or '')
    candidate_country = team_data.get('country')
    score = 0

    if country_matches(association_code, candidate_country):
        score += 40

    if candidate_code and candidate_code == normalize_text(short_name):
        score += 25

    alias_name = normalize_text(team_name)
    alias_canonical = canonicalize_club_name(team_name)
    if alias_name == candidate_name:
        score += 120
    elif alias_canonical and alias_canonical == candidate_canonical:
        score += 90
    elif alias_canonical and candidate_canonical.startswith(alias_canonical):
        score += 60

    return score


def pick_best_candidate(team_name: str, association_code: str, short_name: str, candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    scored_candidates = [
        (score_candidate(team_name, association_code, short_name, candidate), candidate)
        for candidate in candidates
    ]
    scored_candidates = [entry for entry in scored_candidates if entry[0] > 0]
    if not scored_candidates:
        return None

    scored_candidates.sort(
        key=lambda entry: (
            entry[0],
            bool(entry[1].get('team', {}).get('code')),
        ),
        reverse=True,
    )
    return scored_candidates[0][1]


def search_team(
    team_name: str,
    association_code: str,
    short_name: str,
    broad_candidates: list[dict[str, Any]],
    base_url: str,
    api_key: str,
    timeout: int,
) -> dict[str, Any] | None:
    """Search for a team in API-Football and return the best match."""
    log(f'Searching for: {team_name}')

    # First try broad candidates
    broad_match = pick_best_candidate(team_name, association_code, short_name, broad_candidates)
    if broad_match is not None:
        matched_name = broad_match.get('team', {}).get('name') or team_name
        log(f'Matched {team_name} from league list as {matched_name}.')
        return broad_match

    # Try search fallback
    search_candidates: list[dict[str, Any]] = []
    for alias in get_search_terms(team_name):
        log(f'Searching API-football for alias: {alias}')
        payload = api_get(base_url, api_key, timeout, 'teams', {'search': alias})
        search_candidates.extend(payload.get('response', []))

        unique_candidates: dict[Any, dict[str, Any]] = {}
        for candidate in search_candidates:
            team_id = candidate.get('team', {}).get('id')
            unique_candidates[team_id or id(candidate)] = candidate

        search_match = pick_best_candidate(team_name, association_code, short_name, list(unique_candidates.values()))
        if search_match is not None:
            matched_name = search_match.get('team', {}).get('name') or team_name
            log(f'Matched {team_name} via search fallback as {matched_name}.')
            return search_match

    log(f'WARNING: Unable to resolve {team_name} in API-football.')
    return None


def enrich_entry(entry: dict[str, Any], broad_candidates: list[dict[str, Any]], base_url: str, api_key: str, timeout: int) -> bool:
    """Enrich a single entry with missing API data. Returns True if any data was updated."""
    team = entry.get('team', {})
    team_name = team.get('name', '')
    association = team.get('association', {})
    association_code = association.get('code', '')
    short_name = team.get('short_name', '')

    # Skip unresolved playoff spots
    if entry.get('resolution_status') == 'unresolved':
        log(f'Skipping unresolved playoff spot: {team_name}')
        return False

    # Check what's missing
    needs_api_id = team.get('api_football_id') is None
    needs_logo = team.get('api_football_logo') is None
    needs_api_name = team.get('api_football_name') is None

    if not (needs_api_id or needs_logo or needs_api_name):
        log(f'{team_name} already has all API data.')
        return False

    log(f'{team_name} needs: api_id={needs_api_id}, logo={needs_logo}, api_name={needs_api_name}')

    # Search for the team
    resolved = search_team(team_name, association_code, short_name, broad_candidates, base_url, api_key, timeout)

    if resolved is None:
        log(f'Could not resolve {team_name}')
        return False

    team_data = resolved.get('team', {})
    updated = False

    if needs_api_id and team_data.get('id'):
        team['api_football_id'] = team_data['id']
        updated = True
        log(f'  Updated api_football_id: {team_data["id"]}')

    if needs_api_name and team_data.get('name'):
        team['api_football_name'] = team_data['name']
        updated = True
        log(f'  Updated api_football_name: {team_data["name"]}')

    if needs_logo and team_data.get('logo'):
        team['api_football_logo'] = team_data['logo']
        updated = True
        log(f'  Updated api_football_logo: {team_data["logo"]}')

    return updated


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Enrich seed input JSON with missing API-Football data.',
    )
    parser.add_argument('input_file', type=Path, help='Input seed JSON file.')
    parser.add_argument('--dry-run', action='store_true', help='Print changes without writing.')
    parser.add_argument('--api-season', type=int, default=2026, help='API-football season value.')
    parser.add_argument('--league-id', type=int, default=2, help='API-football league id.')
    args = parser.parse_args()

    log(f'Reading seed input from {args.input_file}')

    payload = json.loads(args.input_file.read_text(encoding='utf-8'))
    entries = payload.get('entries', [])

    log(f'Found {len(entries)} entries')

    # Count entries needing enrichment
    needs_enrichment = [
        e for e in entries
        if e.get('resolution_status') != 'unresolved' and (
            e.get('team', {}).get('api_football_id') is None
            or e.get('team', {}).get('api_football_logo') is None
        )
    ]

    if not needs_enrichment:
        log('All resolved teams already have API data. Nothing to do.')
        return 0

    log(f'{len(needs_enrichment)} teams need API data enrichment')

    # Load API config
    base_url, api_key, timeout = load_project_defaults()
    if not api_key:
        raise RuntimeError('Set API_FOOTBALL_KEY or API_KEY before running this script.')
    log(f'Loaded API configuration')

    # Fetch broad candidates for the league/season
    broad_payload = api_get(
        base_url,
        api_key,
        timeout,
        'teams',
        {
            'league': args.league_id,
            'season': args.api_season,
        },
    )
    broad_candidates = broad_payload.get('response', [])
    log(f'Loaded {len(broad_candidates)} teams from API-football league list')

    # Enrich entries
    updated_count = 0
    for entry in entries:
        if enrich_entry(entry, broad_candidates, base_url, api_key, timeout):
            updated_count += 1

    log(f'Updated {updated_count} entries')

    # Update metadata
    if 'metadata' in payload:
        payload['metadata']['provider'] = 'api-football'
        payload['metadata']['generated_at'] = datetime.now(timezone.utc).isoformat()

    # Write output
    if args.dry_run:
        log('Dry run - would write:')
        log(json.dumps(payload, indent=2, ensure_ascii=False)[:2000] + '...')
    else:
        args.input_file.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')
        log(f'Wrote enriched data to {args.input_file}')

    log('Done!')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
