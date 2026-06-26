from __future__ import annotations

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
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DEFAULT_BASE_URL = 'https://v3.football.api-sports.io'
DEFAULT_TIMEOUT = 10
DEFAULT_LEAGUE_ID = 2
DEFAULT_API_SEASON = 2025
DEFAULT_OUTPUT = Path('draw/data/ucl_league_phase_seed_input_2025_26.json')
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
SEARCH_TERMS: dict[str, tuple[str, ...]] = {
    'Bayern Munchen': ('Bayern Munich',),
    'Sporting CP': ('Sporting',),
    'Club Brugge': ('Brugge',),
    'Olympiacos': ('Olympiakos', 'Olympiakos Piraeus'),
    'Monaco': ('AS Monaco',),
    'Villarreal': ('Villarreal',),
    'Eintracht Frankfurt': ('Eintracht Frankfurt', 'Frankfurt'),
}

COUNTRY_NAMES = {
    'AZE': 'Azerbaijan',
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
}


@dataclass(frozen=True, slots=True)
class OfficialTeam:
    rank: int
    name: str
    short_name: str
    association_code: str
    ranking_coefficient: str
    aliases: tuple[str, ...]


OFFICIAL_TEAMS: tuple[OfficialTeam, ...] = (
    OfficialTeam(1, 'Arsenal', 'ARS', 'ENG', '98.0', ('Arsenal',)),
    OfficialTeam(2, 'Bayern Munchen', 'BAY', 'GER', '135.25', ('Bayern Munich', 'Bayern Munchen', 'Bayern Munchen', 'Bayern')),
    OfficialTeam(3, 'Liverpool', 'LIV', 'ENG', '125.5', ('Liverpool',)),
    OfficialTeam(4, 'Tottenham', 'TOT', 'ENG', '70.25', ('Tottenham', 'Tottenham Hotspur')),
    OfficialTeam(5, 'Barcelona', 'BAR', 'ESP', '103.25', ('Barcelona', 'FC Barcelona')),
    OfficialTeam(6, 'Chelsea', 'CHE', 'ENG', '109.0', ('Chelsea', 'Chelsea FC')),
    OfficialTeam(7, 'Sporting CP', 'SPO', 'POR', '59.0', ('Sporting CP', 'Sporting', 'Sporting Lisbon')),
    OfficialTeam(8, 'Manchester City', 'MCI', 'ENG', '137.75', ('Manchester City', 'Man City')),
    OfficialTeam(9, 'Real Madrid', 'RMA', 'ESP', '143.5', ('Real Madrid',)),
    OfficialTeam(10, 'Inter', 'INT', 'ITA', '116.25', ('Inter', 'Inter Milan')),
    OfficialTeam(11, 'Paris Saint Germain', 'PSG', 'FRA', '118.5', ('Paris Saint Germain', 'Paris SG', 'Paris', 'PSG')),
    OfficialTeam(12, 'Newcastle', 'NEW', 'ENG', '23.039', ('Newcastle', 'Newcastle United')),
    OfficialTeam(13, 'Juventus', 'JUV', 'ITA', '74.25', ('Juventus',)),
    OfficialTeam(14, 'Atletico Madrid', 'ATM', 'ESP', '93.5', ('Atletico Madrid', 'Atleti', 'Atletico')),
    OfficialTeam(15, 'Atalanta', 'ATA', 'ITA', '82.0', ('Atalanta',)),
    OfficialTeam(16, 'Bayer Leverkusen', 'LEV', 'GER', '95.25', ('Bayer Leverkusen', 'Leverkusen')),
    OfficialTeam(17, 'Borussia Dortmund', 'BVB', 'GER', '106.75', ('Borussia Dortmund', 'B. Dortmund', 'Dortmund')),
    OfficialTeam(18, 'Olympiacos', 'OLY', 'GRE', '56.5', ('Olympiacos', 'Olympiakos')),
    OfficialTeam(19, 'Club Brugge', 'BRU', 'BEL', '71.75', ('Club Brugge', 'Club Brugge KV')),
    OfficialTeam(20, 'Galatasaray', 'GAL', 'TUR', '38.25', ('Galatasaray',)),
    OfficialTeam(21, 'Monaco', 'MON', 'FRA', '41.0', ('Monaco', 'AS Monaco')),
    OfficialTeam(22, 'Qarabag', 'QAR', 'AZE', '32.0', ('Qarabag', 'Qarabag FK', 'Qarabag Agdam')),
    OfficialTeam(23, 'Bodo/Glimt', 'BOD', 'NOR', '49.0', ('Bodo/Glimt', 'Bodo Glimt', 'Bodo/Glimt FK')),
    OfficialTeam(24, 'Benfica', 'BEN', 'POR', '87.75', ('Benfica',)),
    OfficialTeam(25, 'Marseille', 'MAR', 'FRA', '48.0', ('Marseille', 'Olympique de Marseille')),
    OfficialTeam(26, 'Pafos', 'PAF', 'CYP', '11.125', ('Pafos', 'Pafos FC')),
    OfficialTeam(27, 'Union SG', 'USG', 'BEL', '36.0', ('Union SG', 'Union St. Gilloise', 'Union Saint-Gilloise')),
    OfficialTeam(28, 'PSV', 'PSV', 'NED', '69.25', ('PSV', 'PSV Eindhoven')),
    OfficialTeam(29, 'Athletic Club', 'ATH', 'ESP', '26.75', ('Athletic Club', 'Athletic Bilbao')),
    OfficialTeam(30, 'Napoli', 'NAP', 'ITA', '61.0', ('Napoli',)),
    OfficialTeam(31, 'Copenhagen', 'CPH', 'DEN', '44.875', ('Copenhagen', 'FC Copenhagen')),
    OfficialTeam(32, 'Ajax', 'AJX', 'NED', '67.25', ('Ajax', 'AFC Ajax')),
    OfficialTeam(33, 'Eintracht Frankfurt', 'FRA', 'GER', '74.0', ('Eintracht Frankfurt', 'Frankfurt')),
    OfficialTeam(34, 'Slavia Praha', 'SLA', 'CZE', '51.0', ('Slavia Praha', 'Slavia Prague')),
    OfficialTeam(35, 'Villarreal', 'VIL', 'ESP', '82.0', ('Villarreal',)),
    OfficialTeam(36, 'Kairat Almaty', 'KAI', 'KAZ', '5.5', ('Kairat Almaty', 'Kairat')),
)


def log(message: str) -> None:
    print(f'[build_seed_input] {message}', flush=True)


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


def get_search_terms(official: OfficialTeam) -> tuple[str, ...]:
    seen: set[str] = set()
    ordered_terms: list[str] = []

    for term in (*official.aliases, *SEARCH_TERMS.get(official.name, ())):
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

    base_url = api_key_or_default(base_url, getattr(project_settings, 'API_URL', DEFAULT_BASE_URL))
    api_key = api_key_or_default(api_key, getattr(project_settings, 'API_KEY', None))
    timeout_value = timeout_raw or str(getattr(project_settings, 'TIMEOUT', DEFAULT_TIMEOUT))
    timeout = int(timeout_value)

    return base_url, api_key, timeout


def api_key_or_default(explicit_value: str | None, project_value: str | None) -> str | None:
    if explicit_value:
        return explicit_value
    if project_value and project_value != 'your_api_key_here':
        return project_value
    return None


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


def country_matches(official: OfficialTeam, candidate_country: str | None) -> bool:
    if not candidate_country:
        return False
    expected_country = COUNTRY_NAMES.get(official.association_code)
    return normalize_text(candidate_country) == normalize_text(expected_country or official.association_code)


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


def score_candidate(official: OfficialTeam, candidate: dict[str, Any]) -> int:
    team_data = candidate.get('team', {})
    if is_disallowed_candidate(team_data):
        return -1

    candidate_name = normalize_text(team_data.get('name', ''))
    candidate_canonical = canonicalize_club_name(team_data.get('name', ''))
    candidate_code = normalize_text(team_data.get('code') or '')
    candidate_country = team_data.get('country')
    score = 0

    if country_matches(official, candidate_country):
        score += 40

    if candidate_code and candidate_code == normalize_text(official.short_name):
        score += 25

    for alias in official.aliases:
        alias_name = normalize_text(alias)
        alias_canonical = canonicalize_club_name(alias)
        if alias_name == candidate_name:
            score += 120
            break
        if alias_canonical and alias_canonical == candidate_canonical:
            score += 90
            break
        if alias_canonical and candidate_canonical.startswith(alias_canonical):
            score += 60
            break

    return score


def pick_best_candidate(official: OfficialTeam, candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    scored_candidates = [
        (score_candidate(official, candidate), candidate)
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


def resolve_team(
    official: OfficialTeam,
    broad_candidates: list[dict[str, Any]],
    *,
    base_url: str,
    api_key: str,
    timeout: int,
) -> dict[str, Any]:
    log(f'Resolving rank {official.rank}: {official.name}')
    broad_match = pick_best_candidate(official, broad_candidates)
    if broad_match is not None:
        matched_name = broad_match.get('team', {}).get('name') or official.name
        log(f'Matched {official.name} from league list as {matched_name}.')
        return broad_match

    search_candidates: list[dict[str, Any]] = []
    log(f'No direct league-list match for {official.name}. Trying search fallback.')
    for alias in get_search_terms(official):
        log(f'Searching API-football for alias: {alias}')
        payload = api_get(base_url, api_key, timeout, 'teams', {'search': alias})
        search_candidates.extend(payload.get('response', []))

        unique_candidates: dict[Any, dict[str, Any]] = {}
        for candidate in search_candidates:
            team_id = candidate.get('team', {}).get('id')
            unique_candidates[team_id or id(candidate)] = candidate

        search_match = pick_best_candidate(official, list(unique_candidates.values()))
        if search_match is not None:
            matched_name = search_match.get('team', {}).get('name') or official.name
            log(f'Matched {official.name} via search fallback as {matched_name}.')
            return search_match

    log(f'WARNING: Unable to resolve {official.name} in API-football. A placeholder entry will be written.')
    return None


def build_entry(official: OfficialTeam, resolved_team: dict[str, Any] | None, title_holder: str) -> dict[str, Any]:
    team_data = resolved_team.get('team', {}) if resolved_team else {}
    normalized_title_holder = normalize_text(title_holder)
    is_title_holder = normalize_text(official.name) == normalized_title_holder
    resolution_status = 'resolved' if resolved_team else 'unresolved'

    return {
        'rank': official.rank,
        'resolution_status': resolution_status,
        'team': {
            'name': team_data.get('name') or official.name,
            'short_name': official.short_name,
            'association': {
                'name': team_data.get('country') or COUNTRY_NAMES.get(official.association_code),
                'code': official.association_code,
            },
            'api_football_id': team_data.get('id'),
            'api_football_name': team_data.get('name'),
            'api_football_logo': team_data.get('logo'),
            'uefa_reference_name': official.name,
        },
        'uefa_club_coefficient': official.ranking_coefficient,
        'is_title_holder': is_title_holder,
        'qualified_via': 'TITLE_HOLDER' if is_title_holder else 'LEAGUE_POSITION',
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Fetch UEFA league-phase clubs from API-football and write seed input JSON.',
    )
    parser.add_argument('--api-season', type=int, default=DEFAULT_API_SEASON, help='API-football season value, e.g. 2025.')
    parser.add_argument('--league-id', type=int, default=DEFAULT_LEAGUE_ID, help='API-football league id. Defaults to UEFA Champions League (2).')
    parser.add_argument('--season-name', default='2025-26', help='Season label written to the output JSON.')
    parser.add_argument('--title-holder', required=True, help='Official title holder name from the 36-team list.')
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT, help='Output JSON path.')
    return parser.parse_args()


def validate_title_holder(title_holder: str) -> None:
    known_names = {normalize_text(team.name) for team in OFFICIAL_TEAMS}
    if normalize_text(title_holder) not in known_names:
        available = ', '.join(team.name for team in OFFICIAL_TEAMS)
        raise RuntimeError(f'Title holder must be one of: {available}')


def main() -> int:
    args = parse_args()
    log('Starting seed input build.')
    validate_title_holder(args.title_holder)
    log(f'Title holder selected: {args.title_holder}')

    base_url, api_key, timeout = load_project_defaults()
    if not api_key:
        raise RuntimeError('Set API_FOOTBALL_KEY or API_KEY before running this script.')
    log(f'Loaded configuration: base_url={base_url}, timeout={timeout}s, league_id={args.league_id}, api_season={args.api_season}')

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
    log(f'Loaded {len(broad_candidates)} broad candidates from API-football.')

    entries = []
    unresolved_teams = []
    for official in OFFICIAL_TEAMS:
        resolved_team = resolve_team(
            official,
            broad_candidates,
            base_url=base_url,
            api_key=api_key,
            timeout=timeout,
        )
        if resolved_team is None:
            unresolved_teams.append(official.name)
        entries.append(build_entry(official, resolved_team, args.title_holder))
        log(f'Prepared entry {official.rank}/36 for {official.name} ({entries[-1]["resolution_status"]}).')

    if sum(1 for entry in entries if entry['is_title_holder']) != 1:
        raise RuntimeError('Exactly one title holder must be set in the generated output.')
    log('Validated title holder count.')

    output_payload = {
        'season': {
            'name': args.season_name,
            'competition': 'UCL',
            'api_football_league_id': args.league_id,
            'api_football_season': args.api_season,
        },
        'metadata': {
            'provider': 'api-football',
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'team_count': len(entries),
            'resolved_count': len(entries) - len(unresolved_teams),
            'unresolved_count': len(unresolved_teams),
            'unresolved_teams': unresolved_teams,
        },
        'entries': entries,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    log(f'Writing output file to {args.output}.')
    args.output.write_text(json.dumps(output_payload, indent=2, ensure_ascii=False), encoding='utf-8')

    if unresolved_teams:
        log(f'Finished with unresolved teams: {", ".join(unresolved_teams)}')
    log(f'Completed successfully. Wrote {len(entries)} entries to {args.output}.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
