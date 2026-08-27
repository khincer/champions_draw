"""Poll football-data.org for Champions League match results and sync to SeasonMatchup."""

import os
import time
import urllib.error
import urllib.request
import json

from django.core.management.base import BaseCommand
from django.utils.dateparse import parse_datetime

from draw.models import Season, SeasonMatchup


API_BASE = 'https://api.football-data.org/v4'
COMPETITION_CODE = 'CL'


class Command(BaseCommand):
    help = 'Fetch UCL match results from football-data.org and update SeasonMatchup scores.'

    def add_arguments(self, parser):
        parser.add_argument(
            'season_name',
            help='Season name, e.g. "2026-27".',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Fetch and display results without writing to the database.',
        )

    def handle(self, *args, **options):
        api_key = os.getenv('API_FOOTBALL_DATA_KEY', '')
        if not api_key:
            self.stderr.write(self.style.ERROR(
                'API_FOOTBALL_DATA_KEY not set in environment.'
            ))
            return

        season_name = options['season_name']
        dry_run = options['dry_run']

        # football-data.org uses the starting year: "2026-27" -> 2026
        season_year = season_name.split('-')[0]

        season = Season.objects.filter(name=season_name).first()
        if not season:
            self.stderr.write(self.style.ERROR(f'Season "{season_name}" not found.'))
            return

        self.stdout.write(f'Fetching {COMPETITION_CODE} season {season_year}...')

        url = f'{API_BASE}/competitions/{COMPETITION_CODE}/matches?season={season_year}'
        data = None
        for attempt in range(3):
            req = urllib.request.Request(url, headers={'X-Auth-Token': api_key})
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read().decode())
                break
            except urllib.error.HTTPError as exc:
                if exc.code == 429 and attempt < 2:
                    wait = 30 * (attempt + 1)
                    self.stdout.write(self.style.WARNING(f'Rate limited, waiting {wait}s...'))
                    time.sleep(wait)
                    continue
                self.stderr.write(self.style.ERROR(f'API request failed: {exc}'))
                return

        api_matches = data.get('matches', [])
        self.stdout.write(f'Got {len(api_matches)} matches from API.')

        # Build lookup: (team_name_lower, team_name_lower) -> SeasonMatchup
        matchups = list(
            SeasonMatchup.objects.select_related(
                'home_team__team', 'away_team__team',
            ).filter(season=season)
        )
        lookup = {}
        for m in matchups:
            home = m.home_team.team.name.lower().strip()
            away = m.away_team.team.name.lower().strip()
            lookup[(home, away)] = m

        updated = 0
        matched = 0
        unmatched_api = []

        for am in api_matches:
            api_home = am.get('homeTeam', {}).get('name', '').lower().strip()
            api_away = am.get('awayTeam', {}).get('name', '').lower().strip()

            m = lookup.get((api_home, api_away))
            if not m:
                unmatched_api.append(f'{am["homeTeam"]["name"]} vs {am["awayTeam"]["name"]}')
                continue

            matched += 1
            status = am.get('status', '')
            score = am.get('score', {}).get('fullTime', {})
            home_goals = score.get('home')
            away_goals = score.get('away')
            kickoff = parse_datetime(am.get('utcDate', ''))
            ext_id = str(am.get('id', ''))

            changed = (
                m.status != status
                or m.home_goals != home_goals
                or m.away_goals != away_goals
                or m.external_id != ext_id
                or (kickoff and m.kickoff != kickoff)
            )

            if changed and not dry_run:
                m.status = status
                m.home_goals = home_goals
                m.away_goals = away_goals
                m.external_id = ext_id
                if kickoff:
                    m.kickoff = kickoff
                m.save(update_fields=['status', 'home_goals', 'away_goals', 'external_id', 'kickoff', 'updated_at'])

            if changed:
                updated += 1
                score_str = f'{home_goals}-{away_goals}' if home_goals is not None else '?-?'
                label = 'would update' if dry_run else 'updated'
                self.stdout.write(f'  {label}: {m.home_team.team.name} vs {m.away_team.team.name} [{status}] {score_str}')

        self.stdout.write(self.style.SUCCESS(
            f'Done. {matched} matched, {updated} {("would be " if dry_run else "")}updated, '
            f'{len(unmatched_api)} API matches not found in DB.'
        ))

        if unmatched_api:
            self.stdout.write('Unmatched API matches (team name mismatch):')
            for name in unmatched_api[:20]:
                self.stdout.write(f'  - {name}')
