"""Sync international friendlies from Promiedos into a 'Friendlies <year>' season.

Source: Promiedos league `fha` ("Amistoso Internacional"). That league has no
working page -- `/league/<slug>/fha` 404s for every slug -- so discovery via
`get_filters` is impossible; this command walks the date endpoint
`GET {PROMIEDOS_API}/games/DD-MM-YYYY` instead and selects the `fha` league.

Subclasses `sync_promiedos_fixtures.Command` to inherit the whole persistence
chain (`fetch`, `fetch_json`, `upsert_team`, `upsert_entry`,
`upsert_association`, `parse_promiedos_kickoff`, `map_status`) and overrides
only the argument surface, `handle` and association resolution. The CONMEBOL
(Libertadores/Sudamericana) command is left byte-for-byte untouched.

Unresolved nations are skipped, never fatal: one newly-appearing nation must
not break the unattended daily cron on a plain data gap. Each skip is named on
stderr (team + country_id) and every run prints an imported-vs-skipped summary,
so a zero-import window stays observable. A transport failure is different:
the inherited `fetch` exhausts its retries and raises, which under the cron's
`set -e` fails the run visibly -- that distinction is preserved on purpose.

WARNING: do NOT add `--set-active`, and do NOT flip this season's `is_active`
to fix visibility. `active_season()`/`bootstrap_season` order seasons by
`-name`, and `'Friendlies 2026'` sorts ahead of `'2026-27'`, so activating it
would silently deactivate the served UCL season. This season is created
inactive on purpose; the read surfaces select it by competition, not by
`is_active`.
"""
import time
from datetime import date, timedelta

from django.core.exceptions import ValidationError
from django.db import transaction

from draw.management.commands.sync_promiedos_fixtures import (
    PROMIEDOS_API,
    REQUEST_PAUSE_SECONDS,
    Command as PromiedosFixturesCommand,
    map_status,
    parse_promiedos_kickoff,
)
from draw.models import CompetitionChoices, Season, SeasonMatchup
from draw.services.conmebol_naming import (
    NATIONAL_TEAM_COUNTRY_BY_NAME,
    PROMIEDOS_NATIONAL_TEAM_ID_MAP,
    normalize_text,
)

# Promiedos' id for "Amistoso Internacional". Only reachable via the date
# endpoint; the league-filter route 404s for it.
FRIENDLIES_LEAGUE_ID = 'fha'


class Command(PromiedosFixturesCommand):
    help = 'Sync international friendlies from Promiedos into a "Friendlies <year>" season (free, no API key).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--days-back',
            type=int,
            default=7,
            help='Days before today to refresh (default: 7); catches recently played games.',
        )
        parser.add_argument(
            '--days-ahead',
            type=int,
            default=21,
            help='Days after today to pull (default: 21).',
        )
        parser.add_argument(
            '--season',
            type=int,
            default=date.today().year,
            help='Season year to ingest into (default: the current year).',
        )

    def resolve_association_code(self, team_info):
        """National id map first, then the national name map, then the parent.

        The parent's chain (CONMEBOL club id map + club name map) stays the
        last resort, so the club path is preserved unduplicated.
        """
        code = PROMIEDOS_NATIONAL_TEAM_ID_MAP.get(team_info.get('country_id'))
        if code:
            return code
        code = NATIONAL_TEAM_COUNTRY_BY_NAME.get(normalize_text(team_info.get('name')))
        if code:
            return code
        return super().resolve_association_code(team_info)

    def unresolved_teams(self, *team_infos):
        """[(name, country_id)] for the given teams whose nation cannot resolve."""
        misses = []
        for info in team_infos:
            name = (info.get('name') or '').strip()
            if not name or not self.resolve_association_code(info):
                misses.append((name or '?', info.get('country_id')))
        return misses

    def write_summary(self, season_name, imported, skipped_unresolved, skipped_outside):
        summary = (
            f'[promiedos-friendlies] Summary for {season_name}: imported {imported}, '
            f'skipped {skipped_unresolved} (unresolved nation), '
            f'{skipped_outside} outside season.'
        )
        self.stdout.write(summary)
        # A zero-import or skip-bearing run is the monitoring signal (design
        # T12): make sure it lands in the cron log's stderr too.
        if imported == 0 or skipped_unresolved:
            self.stderr.write(self.style.WARNING(summary))

    def handle(self, *args, **options):
        season_year = options['season']
        season_name = f'Friendlies {season_year}'
        today = date.today()
        days = [
            today + timedelta(days=offset)
            for offset in range(-options['days_back'], options['days_ahead'] + 1)
        ]

        self.stdout.write(
            f'[promiedos-friendlies] Scanning {len(days)} days for {season_name} '
            f'(league {FRIENDLIES_LEAGUE_ID}).'
        )

        # Network first, writes later: fetch every window day before opening the
        # transaction, so a slow source never holds a write lock and a transport
        # failure raises before any row is written.
        games_by_id = {}
        for day in days:
            url = f'{PROMIEDOS_API}/games/{day:%d-%m-%Y}'
            payload = self.fetch_json(url)
            day_games = 0
            for league in payload.get('leagues') or []:
                if league.get('id') != FRIENDLIES_LEAGUE_ID:
                    continue
                for game in league.get('games') or []:
                    game_id = game.get('id')
                    if game_id is not None:
                        games_by_id[game_id] = (day, game)
                        day_games += 1
            self.stdout.write(
                f'[promiedos-friendlies] {day:%d-%m-%Y}: {day_games} friendlies.'
            )
            time.sleep(REQUEST_PAUSE_SECONDS)

        # The window can straddle a year boundary; a game's fetch day decides its
        # bucket, so the January runs pick up what December leaves behind.
        games = [game for day, game in games_by_id.values() if day.year == season_year]
        skipped_outside = len(games_by_id) - len(games)
        if skipped_outside:
            self.stdout.write(
                f'[promiedos-friendlies] Skipped {skipped_outside} friendlies outside '
                f'{season_year} (the next season window picks them up).'
            )
        if not games:
            self.stdout.write(
                f'[promiedos-friendlies] No friendlies in {season_name}; nothing to import.'
            )
            self.write_summary(season_name, 0, 0, skipped_outside)
            return

        with transaction.atomic():
            season, _ = Season.objects.get_or_create(
                name=season_name,
                defaults={'competition': CompetitionChoices.FRIENDLIES},
            )
            if season.competition != CompetitionChoices.FRIENDLIES:
                self.stderr.write(self.style.ERROR(
                    f'[promiedos-friendlies] Season "{season_name}" already exists as '
                    f'{season.get_competition_display()}.'
                ))
                return

            associations = {}
            teams = {}
            entries = {}
            # Keyed by (country_id, name), not country_id alone: two distinct
            # unresolvable teams can share an id (commonly both None), and spec
            # R10 wants every one of them named, not collapsed to a single line.
            unresolved = set()
            imported = 0
            skipped_unresolved = 0
            skipped_invalid = 0

            for game in games:
                teams_info = game.get('teams') or []
                if len(teams_info) < 2:
                    skipped_invalid += 1
                    continue
                home_info, away_info = teams_info[0], teams_info[1]

                misses = self.unresolved_teams(home_info, away_info)
                if misses:
                    for name, country_id in misses:
                        unresolved.add((country_id, name))
                    skipped_unresolved += 1
                    continue

                home = self.upsert_team(home_info, associations, teams)
                away = self.upsert_team(away_info, associations, teams)
                if home is None or away is None or home.pk == away.pk:
                    skipped_invalid += 1
                    continue
                home_entry = self.upsert_entry(season, home, entries)
                away_entry = self.upsert_entry(season, away, entries)

                status = map_status(game)
                finished = status == 'FINISHED'
                scores = game.get('scores') or []
                defaults = {
                    # Friendlies have no matchday semantics; the column is nullable.
                    'matchday': None,
                    'external_id': 'promiedos:' + (game.get('id') or ''),
                    'kickoff': parse_promiedos_kickoff(game.get('start_time')),
                    'status': status,
                    'home_goals': int(scores[0]) if finished and len(scores) > 0 else None,
                    'away_goals': int(scores[1]) if finished and len(scores) > 1 else None,
                }

                # QuerySet.update() skips Model.full_clean().
                if SeasonMatchup.objects.filter(
                    season=season, home_team=home_entry, away_team=away_entry
                ).update(**defaults):
                    imported += 1
                    continue

                try:
                    SeasonMatchup.objects.create(
                        season=season, home_team=home_entry, away_team=away_entry, **defaults
                    )
                except ValidationError:
                    # Same reverse-leg workaround as the CONMEBOL sync: the
                    # model's draw-oriented guard rejects the return leg, but
                    # the DB unique constraint on (season, home, away) allows
                    # both directions.
                    SeasonMatchup.objects.bulk_create(
                        [SeasonMatchup(
                            season=season, home_team=home_entry, away_team=away_entry, **defaults
                        )],
                        ignore_conflicts=True,
                    )
                imported += 1

            if unresolved:
                self.stderr.write(self.style.WARNING(
                    '[promiedos-friendlies] Unresolved nation codes '
                    f'({len(unresolved)}): '
                    + ', '.join(
                        f'{cid}={name}'
                        for cid, name in sorted(unresolved, key=lambda miss: (str(miss[0]), miss[1]))
                    )
                ))
            if skipped_invalid:
                self.stderr.write(self.style.WARNING(
                    f'[promiedos-friendlies] Skipped {skipped_invalid} matchups '
                    '(missing or duplicate team data).'
                ))

            self.stdout.write(
                f'[promiedos-friendlies] Season: {season_name} ({season.competition})'
            )
            self.stdout.write(
                f'[promiedos-friendlies] Upserted {len(teams)} teams, '
                f'{len(associations)} associations, {imported} matchups'
            )

        self.write_summary(season_name, imported, skipped_unresolved, skipped_outside)
