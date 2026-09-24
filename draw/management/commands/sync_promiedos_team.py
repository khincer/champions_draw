"""Sync club profile, squad and per-competition leaderboards from Promiedos.

Source: https://www.promiedos.com.ar/team/<slug>/<id>. The id resolves the
page and the slug is cosmetic -- a bogus slug with a correct id returns the
same page (verified live) -- so the slug is generated from ``Team.name``
purely to keep the URL readable.

The page is a Next.js document whose whole state is one ``__NEXT_DATA__``
JSON blob. Everything this command needs lives under
``props.pageProps.data``:

  team_info  [{name, value}]  Apodo / Fundación / Estadio / Club de
  stadium    {name, info:[{name, value}]}  Nombre / Capacidad / Fundación /
            Ciudad / Dirección -- note its 'Fundación' is the *stadium's*
            year, so the club's `founded` is read from team_info instead.
  competitor.colors  {color, text_color}
  squad.groups       [{name, rows:[{entity:{object:{num,name,birthdate,
                     height,...}}}]}] grouped by position
  stats.filters      [{name, tables:[{name, rows:[{num, entity:{object:
                     {name, short_name}}, values:[{value}]}]}]}] -- one
                     scope per competition

Three tables are written, all flat and FK'd to ``Team`` so they read
straight into a pandas DataFrame with no unpacking: TeamProfile,
SquadPlayer and TeamStatLeader.

Re-running is a no-op: rows are only saved when a field actually changed,
and rows the payload no longer lists are deleted (reconciliation), so a
player who left the club does not linger. That delete is skipped when the
payload's section came back empty, so a partial/failed parse can never wipe
good data -- it warns instead.

Teams without a ``promiedos_id`` (UCL teams imported from the seed file have
none) are skipped and listed.

Usage:
  python manage.py sync_promiedos_team [--team <name> ...] [--limit N] [--dry-run]
"""

import json
import re
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.core.management.base import BaseCommand, CommandError

from draw.models import SquadPlayer, Team, TeamProfile, TeamStatLeader

PROMIEDOS_WEB = 'https://www.promiedos.com.ar'
PROMIEDOS_VER = '1.11.7.3'
TEAM_URL = PROMIEDOS_WEB + '/team/{slug}/{team_id}'
REQUEST_TIMEOUT = 30
MAX_ATTEMPTS = 4
BACKOFF_SECONDS = 1.5
REQUEST_PAUSE_SECONDS = 0.2  # polite spacing between team pages

HEADERS = {
    'X-VER': PROMIEDOS_VER,
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    ),
    'Accept': 'application/json, text/plain, */*',
    'Referer': PROMIEDOS_WEB + '/',
}

_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S,
)


def slugify_name(name):
    """A readable URL slug for a team name. Functionally ignored by Promiedos."""
    ascii_name = (
        unicodedata.normalize('NFKD', name or '')
        .encode('ascii', 'ignore')
        .decode('ascii')
    )
    return re.sub(r'[^a-z0-9]+', '-', ascii_name.lower()).strip('-') or 'team'


def team_page_url(team):
    return TEAM_URL.format(slug=slugify_name(team.name), team_id=team.promiedos_id)


def parse_int(value):
    """'78,838' -> 78838, '16' -> 16, '' / None / anything else -> None.

    Only the thousands separator Promiedos actually serves is stripped. Any
    other shape returns None so the caller can log it instead of coercing a
    value it does not understand into a wrong number.
    """
    if value is None:
        return None
    text = str(value).strip().replace(',', '')
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def team_page_data(html_text):
    """Return the ``props.pageProps.data`` dict, or raise ValueError."""
    match = _NEXT_DATA_RE.search(html_text)
    if not match:
        raise ValueError('No __NEXT_DATA__ script found on the page.')
    payload = json.loads(match.group(1))
    data = payload.get('props', {}).get('pageProps', {}).get('data')
    if not isinstance(data, dict):
        raise ValueError('The page carried no data block.')
    return data


def _info_map(entries):
    """[{name, value}] -> {name: value}, swapping any blank value for ''."""
    result = {}
    for entry in entries or []:
        if isinstance(entry, dict) and entry.get('name'):
            result[entry['name']] = entry.get('value')
    return result


def parse_profile(data):
    """Return (TeamProfile field dict, [unparsed field labels])."""
    info = _info_map(data.get('team_info'))
    stadium = data.get('stadium') or {}
    stadium_info = _info_map(stadium.get('info'))
    colors = (data.get('competitor') or {}).get('colors') or {}

    capacity_raw = stadium_info.get('Capacidad')
    founded_raw = info.get('Fundación')
    profile = {
        'nickname': (info.get('Apodo') or '').strip(),
        'founded': parse_int(founded_raw),
        'club_city': (info.get('Club de') or '').strip(),
        'stadium_name': (stadium.get('name') or stadium_info.get('Nombre') or '').strip(),
        'stadium_capacity': parse_int(capacity_raw),
        'stadium_city': (stadium_info.get('Ciudad') or '').strip(),
        'primary_color': (colors.get('color') or '').strip(),
        'text_color': (colors.get('text_color') or '').strip(),
    }

    unparsed = []
    if str(capacity_raw or '').strip() and profile['stadium_capacity'] is None:
        unparsed.append(f'stadium capacity {capacity_raw!r}')
    if str(founded_raw or '').strip() and profile['founded'] is None:
        unparsed.append(f'founded {founded_raw!r}')
    return profile, unparsed


def parse_squad(data):
    """Return SquadPlayer field dicts for every group on the page."""
    players = []
    for group in (data.get('squad') or {}).get('groups') or []:
        group_name = (group.get('name') or '').strip()
        for row in group.get('rows') or []:
            entity = ((row.get('entity') or {}).get('object') or {})
            name = (entity.get('name') or '').strip()
            if not name:
                continue
            players.append({
                'name': name,
                'shirt_number': parse_int(entity.get('num')),
                'birth_date': str(entity.get('birthdate') or '').strip(),
                'height': str(entity.get('height') or '').strip(),
                'group': group_name,
                'promiedos_player_id': str(entity.get('id') or '').strip(),
            })
    return players


def parse_stat_leaders(data):
    """Return (TeamStatLeader field dicts, [skipped row labels]).

    Every metric Promiedos serves is a count, so a row whose value does not
    parse as an integer is skipped and reported rather than truncated.
    """
    leaders = []
    skipped = []
    for filt in (data.get('stats') or {}).get('filters') or []:
        competition = (filt.get('name') or '').strip()
        for table in filt.get('tables') or []:
            metric = (table.get('name') or '').strip()
            for row in table.get('rows') or []:
                entity = ((row.get('entity') or {}).get('object') or {})
                player_name = (entity.get('name') or '').strip()
                values = row.get('values') or []
                raw_value = values[0].get('value') if values else None
                value = parse_int(raw_value)
                if not player_name or not metric or value is None:
                    skipped.append(
                        f'{competition or "?"}/{metric or "?"}: '
                        f'{player_name or "?"} value={raw_value!r}'
                    )
                    continue
                leaders.append({
                    'competition': competition or 'Unknown',
                    'metric': metric,
                    'player_name': player_name,
                    'player_short_name': (entity.get('short_name') or '').strip(),
                    'rank': parse_int(row.get('num')) or 0,
                    'value': value,
                })
    return leaders, skipped


def _squad_key(obj):
    return obj['name'] if isinstance(obj, dict) else obj.name


def _leader_key(obj):
    if isinstance(obj, dict):
        return (obj['competition'], obj['metric'], obj['player_name'])
    return (obj.competition, obj.metric, obj.player_name)


def sync_rows(model, team, rows, key_fn, dry_run=False):
    """Upsert ``team``'s rows for ``model``; drop ones the payload no longer has.

    ``key_fn`` reads the natural key from either a row dict or a model
    instance. A save only happens when a field actually changed, which is what
    keeps a re-run a no-op (and leaves ``synced_at`` alone). Stale rows are
    deleted only when ``rows`` is non-empty, so an empty section from a
    partial parse cannot wipe good data.

    Returns (created, updated, unchanged, deleted).
    """
    existing = {key_fn(obj): obj for obj in model.objects.filter(team=team)}
    seen = set()
    created = updated = unchanged = 0
    for row in rows:
        key = key_fn(row)
        seen.add(key)
        obj = existing.get(key)
        if obj is None:
            if not dry_run:
                model.objects.create(team=team, **row)
            created += 1
            continue
        changed = {field: value for field, value in row.items() if getattr(obj, field) != value}
        if not changed:
            unchanged += 1
            continue
        if not dry_run:
            for field, value in changed.items():
                setattr(obj, field, value)
            obj.save(update_fields=list(changed))
        updated += 1

    stale = [obj for key, obj in existing.items() if key not in seen]
    if stale and rows and not dry_run:
        model.objects.filter(pk__in=[obj.pk for obj in stale]).delete()
    return created, updated, unchanged, len(stale)


class Command(BaseCommand):
    help = 'Sync club profile, squad and per-competition leaderboards from Promiedos team pages.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--team',
            action='append',
            default=None,
            help='Exact team name to sync (repeatable). Default: every team with a promiedos_id.',
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=None,
            help='Sync at most this many teams (useful for a smoke run).',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Fetch and parse but write nothing.',
        )

    def fetch(self, url):
        """GET with retries; raises CommandError on persistent failure."""
        last_error = None
        for attempt in range(MAX_ATTEMPTS):
            request = Request(url, headers=HEADERS)
            try:
                with urlopen(request, timeout=REQUEST_TIMEOUT) as response:
                    return response.read().decode('utf-8', errors='replace')
            except (HTTPError, URLError, OSError) as exc:
                last_error = exc
                if attempt < MAX_ATTEMPTS - 1:
                    self.stderr.write(self.style.WARNING(
                        f'[promiedos] Request failed ({exc}); retrying '
                        f'({attempt + 1}/{MAX_ATTEMPTS}).'
                    ))
                    time.sleep(BACKOFF_SECONDS * (attempt + 1))
        raise CommandError(f'Unable to fetch {url}: {last_error}')

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        requested = options['team']

        # Missing promiedos_id is the expected state for UCL teams (they come
        # from the seed file, not Promiedos), so it is reported, never fatal.
        without_id = list(
            Team.objects.filter(promiedos_id='').order_by('name').values_list('name', flat=True)
        )

        queryset = Team.objects.exclude(promiedos_id='').order_by('name')
        if requested:
            queryset = queryset.filter(name__in=requested)
            missing = set(requested) - set(Team.objects.filter(name__in=requested).values_list('name', flat=True))
            for name in sorted(missing):
                self.stderr.write(self.style.WARNING(f'[promiedos] No such team: {name!r}'))
        teams = list(queryset)
        if options['limit'] is not None:
            teams = teams[:options['limit']]

        if without_id:
            self.stdout.write(
                f'[promiedos] Skipping {len(without_id)} team(s) without a promiedos_id: '
                + ', '.join(without_id)
            )
        self.stdout.write(f'[promiedos] Syncing {len(teams)} team page(s){" (dry run)" if dry_run else ""}.')

        totals = {'profiles': 0, 'players': 0, 'leaders': 0, 'deleted': 0}
        failed = 0

        for index, team in enumerate(teams):
            if index:
                time.sleep(REQUEST_PAUSE_SECONDS)
            url = team_page_url(team)
            try:
                data = team_page_data(self.fetch(url))
            except (CommandError, ValueError) as exc:
                failed += 1
                self.stderr.write(self.style.WARNING(f'[promiedos] {team.name}: {exc}'))
                continue

            profile, unparsed = parse_profile(data)
            squad = parse_squad(data)
            leaders, skipped_leaders = parse_stat_leaders(data)

            for note in unparsed:
                self.stderr.write(self.style.WARNING(f'[promiedos] {team.name}: unparsed {note}'))
            if skipped_leaders:
                # Aggregated: 'Barridas ganadas' is an average on some
                # competitions (values like '0.4'), so it is skipped on every
                # team -- one line per team, not one per dropped row.
                sample = '; '.join(skipped_leaders[:3])
                more = f' (+{len(skipped_leaders) - 3} more)' if len(skipped_leaders) > 3 else ''
                self.stderr.write(self.style.WARNING(
                    f'[promiedos] {team.name}: skipped {len(skipped_leaders)} non-integer '
                    f'leaderboard row(s): {sample}{more}'
                ))
            if not squad and SquadPlayer.objects.filter(team=team).exists():
                self.stderr.write(self.style.WARNING(
                    f'[promiedos] {team.name}: page had no squad; keeping existing rows.'
                ))

            existing_profile = TeamProfile.objects.filter(team=team).first()
            if existing_profile is None:
                if not dry_run:
                    TeamProfile.objects.create(team=team, **profile)
                profile_written = True
            else:
                profile_changes = {
                    field: value for field, value in profile.items()
                    if getattr(existing_profile, field) != value
                }
                profile_written = bool(profile_changes)
                if profile_changes and not dry_run:
                    for field, value in profile_changes.items():
                        setattr(existing_profile, field, value)
                    existing_profile.save(update_fields=list(profile_changes))
            if profile_written:
                totals['profiles'] += 1

            created, updated, _, deleted = sync_rows(
                SquadPlayer, team, squad, _squad_key, dry_run=dry_run
            )
            totals['players'] += created + updated
            totals['deleted'] += deleted

            created, updated, _, deleted = sync_rows(
                TeamStatLeader, team, leaders, _leader_key, dry_run=dry_run
            )
            totals['leaders'] += created + updated
            totals['deleted'] += deleted

            self.stdout.write(
                f'[promiedos] {team.name}: profile {"updated" if profile_written else "unchanged"}, '
                f'squad {len(squad)}, leaders {len(leaders)}'
            )

        verb = 'Would write' if dry_run else 'Wrote'
        self.stdout.write(self.style.SUCCESS(
            f'[promiedos] Done. {verb} {totals["profiles"]} profile change(s), '
            f'{totals["players"]} player row(s), {totals["leaders"]} leader row(s); '
            f'{totals["deleted"]} stale row(s) removed; {failed} team(s) failed.'
        ))
