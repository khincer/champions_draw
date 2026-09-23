"""Sync finished and upcoming fixtures for tracked leagues from football-data.org."""

import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta

import json

from django.core.management.base import BaseCommand
from django.utils import timezone

from draw.models import League, LeagueMatch

API_BASE = 'https://api.football-data.org/v4'
TRACKED_LEAGUES = ['PL', 'PD', 'BL1', 'SA', 'FL1', 'CL', 'EL', 'PPL', 'DED']


class Command(BaseCommand):
    help = 'Sync finished + upcoming fixtures for tracked leagues.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--codes',
            nargs='*',
            default=None,
            help='League codes to sync (default: all tracked).',
        )
        parser.add_argument('--days-back', type=int, default=14)
        parser.add_argument('--days-ahead', type=int, default=30)
        parser.add_argument('--dry-run', action='store_true')

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

    @staticmethod
    def _parse_kickoff(utc_date):
        if not utc_date:
            return None
        try:
            return datetime.fromisoformat(utc_date.replace('Z', '+00:00'))
        except ValueError:
            return None

    def handle(self, *args, **options):
        api_key = os.getenv('API_FOOTBALL_DATA_KEY', '')
        if not api_key:
            self.stderr.write(self.style.ERROR('API_FOOTBALL_DATA_KEY not set.'))
            return

        codes = options['codes'] or TRACKED_LEAGUES
        leagues = list(League.objects.filter(code__in=codes, is_active=True))
        if not leagues:
            self.stderr.write(self.style.ERROR('No tracked leagues found in DB; run sync_leagues first.'))
            return

        today = timezone.now().date()
        date_from = today - timedelta(days=options['days_back'])
        date_to = today + timedelta(days=options['days_ahead'])
        dry_run = options['dry_run']

        created = updated = 0
        for league in leagues:
            self.stdout.write(f'\n--- {league.code} ---')
            try:
                data = self._api_get(
                    f'/competitions/{league.code}/matches?dateFrom={date_from}&dateTo={date_to}',
                    api_key,
                )
            except urllib.error.HTTPError as exc:
                self.stdout.write(self.style.WARNING(f'  HTTP {exc.code} — skipping'))
                continue
            time.sleep(10)  # free tier: 10 req/min

            for match in data.get('matches', []):
                home = match.get('homeTeam', {}) or {}
                away = match.get('awayTeam', {}) or {}
                score = match.get('score', {}) or {}
                ft = score.get('fullTime') or {}
                home_goals = ft.get('home') if ft.get('home') is not None else None
                away_goals = ft.get('away') if ft.get('away') is not None else None

                defaults = {
                    'league': league,
                    'home_name': home.get('name') or home.get('shortName') or '?',
                    'away_name': away.get('name') or away.get('shortName') or '?',
                    'home_short': home.get('shortName', ''),
                    'away_short': away.get('shortName', ''),
                    'home_crest': home.get('crest', ''),
                    'away_crest': away.get('crest', ''),
                    'kickoff': self._parse_kickoff(match.get('utcDate')),
                    'status': match.get('status', '') or 'SCHEDULED',
                    'matchday': match.get('matchday'),
                    'home_goals': home_goals,
                    'away_goals': away_goals,
                }

                if dry_run:
                    self.stdout.write(
                        f'  [{match.get("status")}] {defaults["home_name"]} vs {defaults["away_name"]}'
                        f' ({defaults["kickoff"] and defaults["kickoff"].strftime("%Y-%m-%d %H:%M")})'
                    )
                    continue

                obj, was_created = LeagueMatch.objects.update_or_create(
                    match_id=match.get('id'),
                    defaults=defaults,
                )
                if was_created:
                    created += 1
                else:
                    updated += 1

        self.stdout.write(self.style.SUCCESS(f'\nDone: {created} created, {updated} updated.'))