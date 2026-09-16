"""Backfill missing logos for CONMEBOL (Libertadores/Sudamericana) 2026 teams.

Finds every Team with an empty logo_url that appears in a SeasonTeam row of a
LIB/SUD 2026 season, looks it up via API-Football v3 `GET /teams?search=<name>`
and stores the first result's logo. Teams the API cannot resolve are left
untouched; the command always exits successfully when the API key is missing.
"""

import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.core.management.base import BaseCommand

from draw.models import SeasonTeam

API_BASE = 'https://v3.football.api-sports.io'
API_TIMEOUT = 15
RATE_LIMIT_WAIT_SECONDS = 65
MAX_RATE_LIMIT_RETRIES = 5


class Command(BaseCommand):
    help = (
        'Backfill missing logos for CONMEBOL (LIB/SUD) 2026 season teams '
        'from API-Football v3.'
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
        api_key = os.environ.get('API_FOOTBALL_KEY')
        if not api_key:
            self.stderr.write(self.style.ERROR(
                'Error: API_FOOTBALL_KEY environment variable not set. '
                'No logos backfilled.'
            ))
            return

        entries = SeasonTeam.objects.select_related('season', 'team').filter(
            season__competition__in=['LIB', 'SUD'],
            season__name__endswith='2026',
            team__logo_url='',
        )
        teams = sorted({entry.team for entry in entries}, key=lambda team: team.name)
        if not teams:
            self.stdout.write('[logos] No CONMEBOL teams are missing logos.')
            return

        backfilled = 0
        skipped = 0
        failed = 0
        for team in teams:
            try:
                payload = self.api_get('teams', {'search': team.name}, api_key)
            except Exception as exc:
                failed += 1
                self.stderr.write(self.style.WARNING(f'[logos] Failed lookup for {team.name}: {exc}'))
                continue

            logo = ''
            for result in payload.get('response') or []:
                info = result.get('team') or result
                if info.get('logo'):
                    logo = info['logo']
                    break
            if not logo:
                skipped += 1
                self.stderr.write(self.style.WARNING(f'[logos] No logo match for {team.name}'))
                continue

            team.logo_url = logo
            team.save(update_fields=['logo_url'])
            backfilled += 1
            self.stdout.write(f'[logos] Backfilled {team.name}')

        self.stdout.write(self.style.SUCCESS(
            f'[logos] Done: {backfilled} backfilled, {skipped} skipped, {failed} failed.'
        ))