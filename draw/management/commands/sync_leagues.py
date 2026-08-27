"""Sync leagues and standings from football-data.org."""

import os
import json
import time
import urllib.error
import urllib.request

from django.core.management.base import BaseCommand

from draw.models import League, LeagueStanding


API_BASE = 'https://api.football-data.org/v4'

# Leagues to track — free tier covers these
TRACKED_LEAGUES = [
    ('PL', 'Premier League', 'England'),
    ('PD', 'La Liga', 'Spain'),
    ('BL1', 'Bundesliga', 'Germany'),
    ('SA', 'Serie A', 'Italy'),
    ('FL1', 'Ligue 1', 'France'),
    ('CL', 'UEFA Champions League', 'Europe'),
    ('EL', 'UEFA Europa League', 'Europe'),
    ('PPL', 'Primeira Liga', 'Portugal'),
    ('DED', 'Eredivisie', 'Netherlands'),
]


class Command(BaseCommand):
    help = 'Sync leagues and standings from football-data.org.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--league',
            help='Sync only this league code (e.g. PL). Default: all tracked leagues.',
        )
        parser.add_argument(
            '--season',
            type=int,
            help='Season starting year (e.g. 2026). Default: current.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Fetch and display without writing to DB.',
        )

    def _api_get(self, path, api_key, retries=3):
        url = f'{API_BASE}{path}'
        for attempt in range(retries):
            req = urllib.request.Request(url, headers={'X-Auth-Token': api_key})
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    return json.loads(resp.read().decode())
            except urllib.error.HTTPError as exc:
                if exc.code == 429 and attempt < retries - 1:
                    wait = 30 * (attempt + 1)
                    self.stdout.write(self.style.WARNING(f'  Rate limited, waiting {wait}s...'))
                    time.sleep(wait)
                    continue
                raise

    def handle(self, *args, **options):
        api_key = os.getenv('API_FOOTBALL_DATA_KEY', '')
        if not api_key:
            self.stderr.write(self.style.ERROR('API_FOOTBALL_DATA_KEY not set.'))
            return

        dry_run = options['dry_run']
        filter_code = options.get('league')
        season_year = options.get('season')

        leagues_to_sync = TRACKED_LEAGUES
        if filter_code:
            leagues_to_sync = [(c, n, co) for c, n, co in TRACKED_LEAGUES if c == filter_code]
            if not leagues_to_sync:
                self.stderr.write(self.style.ERROR(f'League "{filter_code}" not in tracked list.'))
                return

        for code, name, country in leagues_to_sync:
            self.stdout.write(f'\n--- {name} ({code}) ---')

            # Fetch competition info
            try:
                comp = self._api_get(f'/competitions/{code}', api_key)
            except Exception as exc:
                self.stderr.write(self.style.WARNING(f'  Failed to fetch competition: {exc}'))
                continue
            time.sleep(10)  # free tier: 10 req/min

            emblem = comp.get('emblem', '')
            plan = comp.get('plan', '')

            if not dry_run:
                league, _ = League.objects.update_or_create(
                    code=code,
                    defaults={
                        'name': name,
                        'country': country,
                        'emblem_url': emblem,
                        'plan': plan,
                    },
                )
            else:
                self.stdout.write(f'  League: {name} ({code}) emblem={emblem} plan={plan}')

            # Determine season year
            yr = season_year
            if not yr:
                # Use current season from API
                current = comp.get('currentSeason', {})
                if current and current.get('startDate'):
                    yr = int(current['startDate'][:4])
                else:
                    self.stdout.write(self.style.WARNING('  No current season found, skipping standings.'))
                    continue

            # Fetch standings
            try:
                data = self._api_get(f'/competitions/{code}/standings?season={yr}', api_key)
            except Exception as exc:
                self.stderr.write(self.style.WARNING(f'  Failed to fetch standings: {exc}'))
                continue
            time.sleep(10)  # free tier: 10 req/min

            standings = data.get('standings', [])
            # Find the TOTAL table
            total_table = None
            for s in standings:
                if s.get('type') == 'TOTAL':
                    total_table = s
                    break
            if not total_table:
                self.stdout.write(self.style.WARNING(f'  No TOTAL standings for {yr}, skipping.'))
                continue

            rows = total_table.get('table', [])
            self.stdout.write(f'  Season {yr}: {len(rows)} teams')

            if not dry_run:
                # Clear old standings for this league+season
                LeagueStanding.objects.filter(league=league, season_year=yr).delete()

            for row in rows:
                team = row.get('team', {})
                pos = row.get('position', 0)
                played = row.get('playedGames', 0)
                won = row.get('won', 0)
                draw = row.get('draw', 0)
                lost = row.get('lost', 0)
                gf = row.get('goalsFor', 0)
                ga = row.get('goalsAgainst', 0)
                gd = row.get('goalDifference', 0)
                pts = row.get('points', 0)
                crest = team.get('crest', '')

                label = f'  {pos:>2}. {team.get("name", "?")}  {pts}pts  {played}P  {won}W {draw}D {lost}L  {gf}:{ga}'
                self.stdout.write(label)

                if not dry_run:
                    LeagueStanding.objects.create(
                        league=league,
                        season_year=yr,
                        position=pos,
                        team_name=team.get('name', ''),
                        team_crest=crest,
                        played=played,
                        won=won,
                        draw=draw,
                        lost=lost,
                        goals_for=gf,
                        goals_against=ga,
                        goal_difference=gd,
                        points=pts,
                    )

        self.stdout.write(self.style.SUCCESS('\nDone.'))
