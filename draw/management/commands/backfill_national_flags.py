"""Give national teams a flag crest.

The Promiedos sync creates every team with an empty `logo_url`, so the Nations
League and the international friendlies rendered with no badge at all. Clubs get
their crest from the checked-in UCL seed file; national teams have no such file,
but they do carry an ISO-3 association code and a flag is what a national team
wants anyway.

Scoped to the national-team competitions on purpose. CONMEBOL clubs carry country
association codes too (`BRA`, `ARG`), so keying off the association alone would
stamp the Brazil flag on a Brazilian club.

Only the codes in FLAG_CODE_BY_ISO3 are handled. Anything else is reported and
left alone rather than guessed at: a wrong flag is worse than no flag.

    python manage.py backfill_national_flags [--dry-run]
"""
from django.core.management.base import BaseCommand
from django.db.models import Q

from draw.models import Team

NATIONAL_TEAM_COMPETITIONS = ('UNL', 'FRN')

FLAG_BASE_URL = 'https://flagcdn.com/w80'

# ISO-3 -> flagcdn path segment. The UK home nations are subdivisions rather than
# countries, so they use flagcdn's gb-* segments; Kosovo is the user-assigned xk.
# `MAD` is deliberately absent: it is not an ISO-3166 alpha-3 code and its meaning
# here is unconfirmed, so those teams are reported rather than guessed.
FLAG_CODE_BY_ISO3 = {
    'ALB': 'al', 'ALG': 'dz', 'AND': 'ad', 'ARM': 'am', 'ARU': 'aw', 'AUS': 'au',
    'AUT': 'at', 'AZE': 'az', 'BAN': 'bd', 'BDI': 'bi', 'BEL': 'be', 'BEN': 'bj',
    'BER': 'bm', 'BFA': 'bf', 'BIH': 'ba', 'BLR': 'by', 'BUL': 'bg', 'CAN': 'ca',
    'CIV': 'ci', 'COD': 'cd', 'CPV': 'cv', 'CRC': 'cr', 'CRO': 'hr', 'CUW': 'cw',
    'CYP': 'cy', 'CZE': 'cz', 'DEN': 'dk', 'EGY': 'eg', 'ENG': 'gb-eng', 'ESP': 'es',
    'EST': 'ee', 'FIN': 'fi', 'FRA': 'fr', 'FRO': 'fo', 'GEO': 'ge', 'GER': 'de',
    'GHA': 'gh', 'GIB': 'gi', 'GRE': 'gr', 'GUA': 'gt', 'HAI': 'ht', 'HON': 'hn',
    'HUN': 'hu', 'IND': 'in', 'IRL': 'ie', 'IRQ': 'iq', 'ISL': 'is', 'ISR': 'il',
    'ITA': 'it', 'JOR': 'jo', 'JPN': 'jp', 'KAZ': 'kz', 'KOR': 'kr', 'KOS': 'xk',
    'KSA': 'sa', 'LIE': 'li', 'LTU': 'lt', 'LUX': 'lu', 'LVA': 'lv', 'MAR': 'ma',
    'MDA': 'md', 'MEX': 'mx', 'MKD': 'mk', 'MLT': 'mt', 'MNE': 'me', 'MTN': 'mr',
    'NCA': 'ni', 'NED': 'nl', 'NGA': 'ng', 'NIR': 'gb-nir', 'NOR': 'no', 'NZL': 'nz',
    'PAN': 'pa', 'POL': 'pl', 'POR': 'pt', 'PSE': 'ps', 'PUR': 'pr', 'QAT': 'qa', 'ROU': 'ro',
    'SCO': 'gb-sct', 'SDN': 'sd', 'SEN': 'sn', 'SIN': 'sg', 'SLV': 'sv', 'SMR': 'sm',
    'SRB': 'rs', 'SUI': 'ch', 'SVK': 'sk', 'SVN': 'si', 'SWE': 'se', 'TRI': 'tt',
    'TUN': 'tn', 'TUR': 'tr', 'UAE': 'ae', 'UKR': 'ua', 'USA': 'us', 'UZB': 'uz',
    'WAL': 'gb-wls', 'ZAM': 'zm',
    # CONMEBOL nations. Safe to map even though CONMEBOL *club* associations share
    # these codes, because the query below is scoped to the national-team
    # competitions -- a Brazilian club is never selected.
    'ARG': 'ar', 'BOL': 'bo', 'BRA': 'br', 'CHI': 'cl', 'COL': 'co',
    'ECU': 'ec', 'PAR': 'py', 'PER': 'pe', 'URU': 'uy', 'VEN': 've',
}


def flag_url_for(iso3):
    """Flag image URL for an ISO-3 code, or None when it is not mapped."""
    segment = FLAG_CODE_BY_ISO3.get((iso3 or '').strip().upper())
    return f'{FLAG_BASE_URL}/{segment}.png' if segment else None


class Command(BaseCommand):
    help = 'Set a flag logo_url on national teams that have none.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Report what would change without writing.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        teams = (
            Team.objects.select_related('association')
            .filter(season_entries__season__competition__in=NATIONAL_TEAM_COMPETITIONS)
            .filter(Q(logo_url='') | Q(logo_url__isnull=True))
            .distinct()
            .order_by('name')
        )

        updated = 0
        unmapped = {}
        for team in teams:
            code = team.association.code if team.association else None
            url = flag_url_for(code)
            if url is None:
                unmapped.setdefault(code or '(none)', []).append(team.name)
                continue
            if not dry_run:
                team.logo_url = url
                team.save(update_fields=['logo_url'])
            updated += 1

        verb = 'would update' if dry_run else 'updated'
        self.stdout.write(self.style.SUCCESS(
            f'{verb} {updated} national team(s) with a flag crest.'
        ))

        if unmapped:
            self.stderr.write(self.style.WARNING(
                f'left {sum(len(v) for v in unmapped.values())} team(s) alone '
                f'across {len(unmapped)} unmapped code(s):'
            ))
            for code in sorted(unmapped):
                names = ', '.join(sorted(unmapped[code])[:4])
                more = '' if len(unmapped[code]) <= 4 else f' (+{len(unmapped[code]) - 4} more)'
                self.stderr.write(f'  {code}: {names}{more}')
