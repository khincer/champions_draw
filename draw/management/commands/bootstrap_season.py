from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from draw.models import Season

DEFAULT_SEASON = '2026-27'
DEFAULT_SEED_FILE = 'draw/data/ucl_league_phase_seed_input_2026_27.json'


class Command(BaseCommand):
    help = (
        'Ensure the served season is bootstrapped and active. Imports the seed '
        'file (with seeding) only when the season is missing, then makes that '
        'season the single active one. Safe to run on every deploy.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--season',
            default=DEFAULT_SEASON,
            help=f'Season name to ensure active (default: {DEFAULT_SEASON}).',
        )
        parser.add_argument(
            '--seed-file',
            default=DEFAULT_SEED_FILE,
            help=(
                'Seed-input JSON imported when the season is missing '
                f'(default: {DEFAULT_SEED_FILE}).'
            ),
        )

    def handle(self, *args, **options):
        season_name = options['season']
        seed_file = options['seed_file']

        # Idempotency guard: a season row is committed atomically with its
        # SeasonTeam rows by import_seed_input, so its existence means the
        # import and seeding already ran. Skipping keeps redeploys a no-op:
        # no re-import, no re-seed, no pruning of SeasonTeam rows.
        if Season.objects.filter(name=season_name).exists():
            self.stdout.write(f'Season {season_name} already present; skipping import.')
        else:
            self.stdout.write(f'Season {season_name} missing; importing {seed_file}.')
            call_command('import_seed_input', seed_file, '--seed')
            self.stdout.write(self.style.SUCCESS(f'Imported and seeded season {season_name}.'))

        if not Season.objects.filter(name=season_name).exists():
            raise CommandError(
                f'Season {season_name} is still missing after import; aborting bootstrap.'
            )

        Season.objects.exclude(name=season_name).update(is_active=False)
        Season.objects.filter(name=season_name).update(is_active=True)

        self.stdout.write(self.style.SUCCESS(
            f'Season {season_name} is now the only active season.'
        ))
