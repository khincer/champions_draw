#!/usr/bin/env python3
"""Scrape UEFA club coefficients from kassiesa.net and update seed input JSON.

Fetches the 5-year club ranking from kassiesa.net/uefa/data/method5/trank2027.html
and matches teams to update uefa_club_coefficient values.

Usage:
    python fetch_uefa_coefficients.py <input_file> [--dry-run]

No API key required - scrapes public HTML.
"""

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


RANKING_URL = 'https://kassiesa.net/uefa/data/method5/trank2027.html'
DEFAULT_TIMEOUT = 15


def log(message: str) -> None:
    print(f'[fetch_uefa_coefficients] {message}', flush=True)


def fetch_page(url: str, timeout: int) -> str:
    log(f'Fetching {url}')
    request = Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urlopen(request, timeout=timeout) as response:
            data = response.read()
            charset = response.headers.get_content_charset()
            if charset:
                return data.decode(charset, errors='replace')
            # No charset declared — try UTF-8 first (handles ø, é, etc.)
            try:
                return data.decode('utf-8')
            except UnicodeDecodeError:
                return data.decode('latin-1', errors='replace')
    except URLError as exc:
        raise RuntimeError(f'Unable to fetch {url}: {exc.reason}') from exc


def parse_ranking_table(html: str) -> dict[str, float]:
    """Parse the kassiesa ranking table and return {team_name: coefficient}.

    HTML structure per row:
        <tr class="clubline">
          <td>rank</td>
          <td>...</td>
          <td class="aleft blue">Team Name</td>
          <td>Country</td>
          <td>22/23</td><td>23/24</td><td>24/25</td><td>25/26</td><td>26/27</td>
          <th class="lgray">TotalPoints</th>
          <td>CountryPart</td>
        </tr>
    """
    coefficients = {}

    # Extract each clubline row
    rows = re.findall(r'<tr class="clubline">(.*?)</tr>', html, re.DOTALL)
    for row in rows:
        cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.DOTALL)
        if len(cells) < 8:
            continue
        # cells: rank, arrow, team_name, country, 5 season scores, total, country_part
        team_raw = re.sub(r'<[^>]+>', '', cells[2]).strip()
        total_raw = re.sub(r'<[^>]+>', '', cells[9]).strip()
        try:
            coefficients[team_raw] = float(total_raw)
        except (ValueError, IndexError):
            continue

    return coefficients


def normalize_name(name: str) -> str:
    """Normalize team name for matching."""
    # Transliterate common accented chars before ASCII strip
    TRANSLIT = str.maketrans('øÓóÉéÀàÁáÍíÚúÑñÇç', 'oOoEeAaAaIiUuNnCc')
    name = name.strip()
    name = name.translate(TRANSLIT)
    # Strip common prefixes
    for pfx in ('FC ', 'CF ', 'AC ', 'AS ', 'SS ', 'SC ', 'OS ', 'NK ', 'RC ',
                'FK ', 'KV ', 'IF ', 'SK ', 'OG ', 'US ', '1899 ', '1907 '):
        if name.startswith(pfx):
            name = name[len(pfx):]
    name = name.encode('ascii', 'ignore').decode('ascii')
    name = name.lower().strip()
    return name


def find_matching_coefficient(team_name: str, coefficients: dict[str, float]) -> float | None:
    """Find coefficient for a team by fuzzy matching."""
    normalized = normalize_name(team_name)

    # Direct match
    for coeff_name, coeff_val in coefficients.items():
        if normalize_name(coeff_name) == normalized:
            return coeff_val

    # Partial match
    for coeff_name, coeff_val in coefficients.items():
        norm_coeff = normalize_name(coeff_name)
        if normalized in norm_coeff or norm_coeff in normalized:
            return coeff_val

    # Word overlap match
    team_words = set(normalized.split())
    for coeff_name, coeff_val in coefficients.items():
        coeff_words = set(normalize_name(coeff_name).split())
        if team_words & coeff_words and len(team_words & coeff_words) >= 1:
            # Check if at least one significant word matches
            significant_words = team_words - {'fc', 'cf', 'ac', 'as', 'ss', 'sc', 'os', 'nk', 'rc', 'fk', 'kv', 'if', 'sk', 'og', 'us', 'de', 'la', 'le', 'el', 'the', '1899', '1907'}
            coeff_significant = coeff_words - {'fc', 'cf', 'ac', 'as', 'ss', 'sc', 'os', 'nk', 'rc', 'fk', 'kv', 'if', 'sk', 'og', 'us', 'de', 'la', 'le', 'el', 'the', '1899', '1907'}
            if significant_words and coeff_significant and significant_words & coeff_significant:
                return coeff_val

    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Scrape UEFA coefficients and update seed input JSON.',
    )
    parser.add_argument('input_file', type=Path, help='Input seed JSON file.')
    parser.add_argument('--dry-run', action='store_true', help='Print changes without writing.')
    parser.add_argument('--url', default=RANKING_URL, help='URL to scrape.')
    args = parser.parse_args()

    log(f'Reading seed input from {args.input_file}')
    payload = json.loads(args.input_file.read_text(encoding='utf-8'))
    entries = payload.get('entries', [])

    log(f'Found {len(entries)} entries')

    # Fetch ranking page
    html = fetch_page(args.url, DEFAULT_TIMEOUT)
    log(f'Fetched {len(html)} bytes from {args.url}')

    # Parse coefficients
    coefficients = parse_ranking_table(html)
    log(f'Parsed {len(coefficients)} team coefficients from ranking')

    if coefficients:
        sample = list(coefficients.items())[:5]
        log(f'Sample coefficients: {sample}')

    # Update entries
    updated_count = 0
    missing_count = 0
    for entry in entries:
        team = entry.get('team', {})
        team_name = team.get('name', '')
        current_coeff = entry.get('uefa_club_coefficient')

        # Skip unresolved
        if entry.get('resolution_status') == 'unresolved':
            log(f'Skipping unresolved: {team_name}')
            continue

        # Find matching coefficient
        coeff = find_matching_coefficient(team_name, coefficients)
        if coeff is not None:
            coeff_str = f'{coeff:.3f}'
            if current_coeff != coeff_str:
                log(f'{team_name}: {current_coeff} -> {coeff_str}')
                entry['uefa_club_coefficient'] = coeff_str
                updated_count += 1
            else:
                log(f'{team_name}: already correct ({current_coeff})')
        else:
            log(f'WARNING: No coefficient found for {team_name}')
            missing_count += 1

    log(f'Updated {updated_count} entries, {missing_count} missing')

    # Write output
    if args.dry_run:
        log('Dry run - would write:')
        for entry in entries:
            team = entry.get('team', {})
            log(f"  {entry['rank']}. {team.get('name')}: {entry.get('uefa_club_coefficient')}")
    else:
        args.input_file.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')
        log(f'Wrote updated data to {args.input_file}')

    log('Done!')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
