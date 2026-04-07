from dataclasses import asdict

from django.core.management.base import BaseCommand, CommandError

from draw.services.import_seed_input import import_seed_input_file
from draw.services.seeding import SeedingError, seed_season_entries
from draw.models import Season


class Command(BaseCommand):
    help = 'Import a seed-input JSON file into Association, Team, Season, and SeasonTeam records.'

    def add_arguments(self, parser):
        parser.add_argument('file_path', help='Path to the seed-input JSON file.')
        parser.add_argument(
            '--set-active',
            action='store_true',
            help='Mark the imported season as active and deactivate others.',
        )
        parser.add_argument(
            '--seed',
            action='store_true',
            help='Run the seeding service after importing the season entries.',
        )

    def handle(self, *args, **options):
        try:
            summary = import_seed_input_file(
                options['file_path'],
                set_active=options['set_active'],
            )
        except (OSError, ValueError) as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(self.style.SUCCESS(f'Imported season {summary.season_name}.'))
        for key, value in asdict(summary).items():
            self.stdout.write(f'{key}: {value}')

        if not options['seed']:
            return

        season = Season.objects.get(pk=summary.season_id)
        try:
            seeding_summary = seed_season_entries(season)
        except SeedingError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(self.style.SUCCESS('Seeding completed.'))
        for key, value in asdict(seeding_summary).items():
            self.stdout.write(f'{key}: {value}')