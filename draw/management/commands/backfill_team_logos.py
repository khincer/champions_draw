"""Backfill missing team logos from API-Football v3.

Every Team with an empty logo_url is looked up via API-Football v3
`GET /teams?search=<name>`; the winning candidate is chosen by an
association post-filter (exact association code, then exact
association name, then legacy first-with-logo) implemented in the pure
`pick_candidate` helper. Teams the API cannot resolve are reported as
unresolved and keep logo_url='' — no DB row is created, merged, or
deleted. Logo URLs are runtime DB data only; seed JSONs are never
touched. `--dry-run` lists the teams that would be searched without any
network call.
"""

import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.core.management.base import BaseCommand

from draw.models import Team

API_BASE = 'https://v3.football.api-sports.io'
API_TIMEOUT = 15
RATE_LIMIT_WAIT_SECONDS = 65
MAX_RATE_LIMIT_RETRIES = 5


def pick_candidate(candidates, code, name):
    """Pick the best candidate logo match without any network access.

    Each candidate is a team-info dict with ``country`` and ``logo``
    keys. Priority: exact association code match (uppercased), then
    exact association name match (case-insensitive, accepting either
    "Peru" or the "Peru (PER)" str form), then legacy first candidate
    with a logo. Returns the winning candidate dict or None when no
    candidate resolves — the caller then leaves logo_url empty and
    reports the team unresolved.
    """
    code_upper = (code or '').upper()
    name_variants = {name.casefold(), f'{name} ({code_upper})'.casefold()} if name else set()
    if name and code_upper and name.upper().endswith(f' ({code_upper})'):
        name_variants.add(name[: -len(f' ({code_upper})')].casefold())

    if code_upper:
        for candidate in candidates:
            if candidate.get('logo') and (candidate.get('country') or '').upper() == code_upper:
                return candidate

    if name_variants:
        for candidate in candidates:
            if candidate.get('logo') and (candidate.get('country') or '').casefold() in name_variants:
                return candidate

    for candidate in candidates:
        if candidate.get('logo'):
            return candidate

    return None


class Command(BaseCommand):
    help = 'Backfill missing team logos from API-Football v3.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='List the teams that would be searched without calling the API.',
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
                raise RuntimeError(f'API-Football returned HTTP {exc.code}: {body}') from exc
            except URLError as exc:
                raise RuntimeError(f'Unable to reach API-Football: {exc.reason}') from exc

            errors = payload.get('errors') or {}
            if isinstance(errors, dict) and errors.get('rateLimit'):
                if attempt == MAX_RATE_LIMIT_RETRIES:
                    raise RuntimeError(
                        f"API-Football rate limit persisted for {endpoint}?{query}: "
                        f"{errors['rateLimit']}"
                    )
                self.stderr.write(self.style.WARNING(
                    f'[logos] Rate limit reached. Waiting {RATE_LIMIT_WAIT_SECONDS}s '
                    f'before retrying (attempt {attempt}/{MAX_RATE_LIMIT_RETRIES}).'
                ))
                time.sleep(RATE_LIMIT_WAIT_SECONDS)
                continue

            return payload

        raise RuntimeError(f'Unable to retrieve {endpoint}?{query} from API-Football.')

    def handle(self, *args, **options):
        teams = list(Team.objects.filter(logo_url='').order_by('name'))
        if not teams:
            self.stdout.write('[logos] No teams are missing logos.')
            return

        if options['dry_run']:
            self.stdout.write(
                f'[logos] Dry run: {len(teams)} team(s) missing logos would be searched:'
            )
            for team in teams:
                self.stdout.write(f'  - {team.name} [{team.association.code}]')
            self.stdout.write(self.style.SUCCESS('[logos] Dry run complete (no API calls).'))
            return

        api_key = os.environ.get('API_FOOTBALL_KEY')
        if not api_key:
            self.stderr.write(self.style.ERROR(
                'Error: API_FOOTBALL_KEY environment variable not set. '
                'No logos backfilled.'
            ))
            return

        backfilled = 0
        unresolved = 0
        failed = 0
        for team in teams:
            try:
                payload = self.api_get('teams', {'search': team.name}, api_key)
            except Exception as exc:
                failed += 1
                self.stderr.write(self.style.WARNING(f'[logos] Failed lookup for {team.name}: {exc}'))
                continue

            candidates = [result.get('team') or result for result in payload.get('response') or []]
            chosen = pick_candidate(
                candidates,
                team.association.code,
                team.association.name,
            )
            if chosen is None:
                unresolved += 1
                self.stderr.write(self.style.WARNING(
                    f'[logos] No match for {team.name} [{team.association.code}]; logo left empty.'
                ))
                continue

            team.logo_url = chosen['logo']
            team.save(update_fields=['logo_url'])
            backfilled += 1
            self.stdout.write(f'[logos] Backfilled {team.name}')

        self.stdout.write(self.style.SUCCESS(
            f'[logos] Done: {backfilled} backfilled, {unresolved} unresolved, {failed} failed.'
        ))