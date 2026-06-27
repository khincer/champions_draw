from dataclasses import asdict

from django.core.management.base import BaseCommand, CommandError

from draw.models import Season
from draw.services.draw import DrawError, generate_season_draw


class Command(BaseCommand):
    help = 'Generate Champions League league-phase matchups for a seeded season.'

    def add_arguments(self, parser):
        parser.add_argument('season', help='Season name, for example 2025-26.')
        parser.add_argument(
            '--seed',
            dest='draw_seed',
            help='Optional deterministic draw seed.',
        )
        parser.add_argument(
            '--reset',
            action='store_true',
            help='Replace existing matchups for the season.',
        )
        parser.add_argument(
            '--player-name',
            default='',
            help='Optional player name to store with the draw metadata.',
        )
        parser.add_argument(
            '--max-attempts',
            type=int,
            default=100,
            help='Maximum generation attempts before failing.',
        )

    def handle(self, *args, **options):
        try:
            season = Season.objects.get(name=options['season'])
        except Season.DoesNotExist as exc:
            raise CommandError(f"Season not found: {options['season']}") from exc

        try:
            summary = generate_season_draw(
                season,
                draw_seed=options['draw_seed'],
                player_name=options['player_name'],
                reset=options['reset'],
                max_attempts=options['max_attempts'],
            )
        except DrawError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(self.style.SUCCESS(f'Generated draw for season {season.name}.'))
        for key, value in asdict(summary).items():
            self.stdout.write(f'{key}: {value}')
