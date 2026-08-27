"""Fetch past UCL league-phase fixtures from football-data.org and record
directed (home, away) crosses to enforce the "no 3 consecutive seasons as
home team in the same pairing" Rule 6.

Only league-phase rounds are recorded (the 8 matchdays of the league phase).
The data lives in SeasonMatchupHistory keyed by season_name, independent of
any Season row, so past seasons need not exist as Season objects here.
"""

import os
import time
import urllib.error
import urllib.request
import json

from django.core.management.base import BaseCommand

from draw.models import SeasonMatchupHistory, Team


API_BASE = 'https://api.football-data.org/v4'
COMPETITION_CODE = 'CL'


class Command(BaseCommand):
    help = 'Fetch past UCL league-phase fixtures and record directed crosses.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--seasons',
            required=True,
            help='Comma-separated season names, e.g. "2024-25,2025-26".',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Fetch and display without writing to the database.',
        )

    def handle(self, *args, **options):
        api_key = os.getenv('API_FOOTBALL_DATA_KEY', '')
        if not api_key:
            self.stderr.write(self.style.ERROR('API_FOOTBALL_DATA_KEY not set in environment.'))
            return

        seasons = [s.strip() for s in options['seasons'].split(',') if s.strip()]
        dry_run = options['dry_run']
        team_by_name = {name_lower: team for name_lower, team in Team.objects.all().values('name')}

        total_created = 0
        for season_name in seasons:
            total_created += self.sync_season(season_name, api_key, team_by_name, dry_run)

        self.stdout.write(self.style.SUCCESS(
            f'Done. {("would record " if dry_run else "recorded ")}{total_created} "
            f"directed crosses across {len(seasons)} season(s).'
        ))

    def sync_season(self, season_name, api_key, team_by_name, dry_run):
        season_year = season_name.split('-')[0]
        self.stdout.write(f'Fetching {COMPETITION_CODE} season {season_year} ({season_name})...')

        data = self.fetch(api_key, season_year)
        matches = data.get('matches', [])
        self.stdout.write(f'  Got {len(matches)} matches.')

        existing = set(
            SeasonMatchupHistory.objects.filter(season_name=season_name)
            .values_list('home_team__name', 'away_team__name')
        )

        created = 0
        for match in matches:
            # Only record league-phase rounds. Matchday = [1..8] in the league phase.
            matchday = match.get('matchday')
            if matchday is None or matchday < 1 or matchday > 8:
                continue

            home_name = match.get('homeTeam', {}).get('name', '').strip()
            away_name = match.get('awayTeam', {}).get('name', '').strip()
            if not home_name or not away_name:
                continue

            home_team = team_by_name.get(home_name.lower())
            away_team = team_by_name.get(away_name.lower())
            if not home_team or not away_team:
                self.stdout.write(self.style.WARNING(
                    f'  Skipping unknown team pairing: {home_name} vs {away_name}'
                ))
                continue

            key = (home_name, away_name)
            if key in existing:
                continue

            existing.add(key)
            if not dry_run:
                SeasonMatchupHistory.objects.create(
                    season_name=season_name,
                    home_team=home_team,
                    away_team=away_team,
                )
            created += 1

        return created

    def fetch(self, api_key, season_year):
        url = f'{API_BASE}/competitions/{COMPETITION_CODE}/matches?season={season_year}'
        for attempt in range(3):
            req = urllib.request.Request(url, headers={'X-Auth-Token': api_key})
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    return json.loads(resp.read().decode())
            except urllib.error.HTTPError as exc:
                if exc.code == 429 and attempt < 2:
                    wait = 30 * (attempt + 1)
                    self.stdout.write(self.style.WARNING(f'Rate limited, waiting {wait}s...'))
                    time.sleep(wait)
                    continue
                self.stderr.write(self.style.ERROR(f'API request failed: {exc}'))
                raise
