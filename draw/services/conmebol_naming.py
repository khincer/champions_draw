"""Shared naming data for the Promiedos fixture syncs.

Lives outside any management command because the Promiedos syncs need it: the
CONMEBOL club sync (`sync_promiedos_fixtures`) and the international-friendlies
sync (`sync_promiedos_friendlies`). Historically the retired API-Football
command (403 on its free plan for the current season) read it too.

Neither source's payload carries a usable country for a team, so association
codes are resolved from the name map (and, for national teams, the two maps at
the bottom of this file). Both sources spell clubs differently
("Atletico MG" vs "Atletico-MG", "Estudiantes L.P." vs "Estudiantes LP"), so
the aliases below are intentional and each one is commented with the source
that produced it.

ponytail: covers known CONMEBOL clubs; teams not listed fall back to the
league's country and are skipped with a warning if that doesn't resolve either.
Add clubs here as the qualified field grows.
"""

import unicodedata

CONMEBOL_COUNTRY_MAP = {
    'brazil': 'BRA', 'argentina': 'ARG', 'uruguay': 'URU',
    'colombia': 'COL', 'ecuador': 'ECU', 'chile': 'CHI',
    'paraguay': 'PAR', 'peru': 'PER', 'bolivia': 'BOL',
    'venezuela': 'VEN', 'mexico': 'MEX',
}
COUNTRY_NAMES = {code: country for country, code in CONMEBOL_COUNTRY_MAP.items()}

TEAM_COUNTRY_BY_NAME = {
    # Brazil
    'flamengo': 'BRA', 'palmeiras': 'BRA', 'corinthians': 'BRA',
    'sao paulo': 'BRA', 'santos': 'BRA', 'vasco da gama': 'BRA',
    'botafogo': 'BRA', 'fluminense': 'BRA', 'internacional': 'BRA',
    'gremio': 'BRA', 'cruzeiro': 'BRA', 'atletico mineiro': 'BRA',
    'atletico mg': 'BRA',  # API-Football name
    'atletico-mg': 'BRA',  # API-Football name (raw, hyphen kept)
    'fortaleza': 'BRA', 'bahia': 'BRA', 'red bull bragantino': 'BRA',
    'rb bragantino': 'BRA',  # API-Football name
    'juventude': 'BRA', 'ceara': 'BRA', 'sport recife': 'BRA',
    # Argentina
    'river plate': 'ARG', 'boca juniors': 'ARG', 'racing club': 'ARG',
    'estudiantes': 'ARG', 'estudiantes lp': 'ARG',  # API-Football: "Estudiantes L.P."
    'estudiantes l.p.': 'ARG',  # raw with period kept
    'velez sarsfield': 'ARG', 'independiente': 'ARG',
    'rosario central': 'ARG', 'talleres cordoba': 'ARG', 'lanus': 'ARG',
    'defensa y justicia': 'ARG', 'argentinos juniors': 'ARG',
    'godoy cruz': 'ARG', 'union santa fe': 'ARG', 'instituto': 'ARG',
    'huracan': 'ARG', 'tigre': 'ARG', 'banfield': 'ARG',
    'gimnasia la plata': 'ARG', 'central cordoba': 'ARG', 'platense': 'ARG',
    'san lorenzo': 'ARG',
    # Uruguay
    'penarol': 'URU', 'nacional de football': 'URU', 'nacional': 'URU',
    'club nacional': 'URU',  # API-Football: "Club Nacional"
    'liverpool': 'URU', 'liverpool montevideo': 'URU',  # API disambiguates
    'defensor sporting': 'URU', 'boston river': 'URU',
    'racing club de montevideo': 'URU', 'danubio': 'URU',
    'montevideo wanderers': 'URU', 'wanderers': 'URU', 'progreso': 'URU',
    'cerro largo': 'URU',
    # Colombia
    'atletico nacional': 'COL', 'millonarios': 'COL', 'deportes tolima': 'COL',
    'america de cali': 'COL', 'junior': 'COL', 'santa fe': 'COL',
    'once caldas': 'COL', 'deportivo cali': 'COL', 'independiente medellin': 'COL',
    'deportivo pasto': 'COL', 'atletico bucaramanga': 'COL',
    'alianza petrolera': 'COL', 'aguilas doradas': 'COL',
    # Ecuador
    'ldu quito': 'ECU', 'ldu de quito': 'ECU',  # API-Football: "LDU de Quito"
    'independiente del valle': 'ECU', 'barcelona sc': 'ECU',
    'emelec': 'ECU', 'aucas': 'ECU', 'delfin': 'ECU', 'deportivo cuenca': 'ECU',
    'orense': 'ECU', 'mushuc runa': 'ECU',
    'universidad catolica del ecuador': 'ECU',
    'el nacional': 'ECU',
    # Chile
    'colo colo': 'CHI', 'universidad de chile': 'CHI',
    'universidad catolica': 'CHI', 'palestino': 'CHI', 'union espanola': 'CHI',
    'cobresal': 'CHI', 'audax italiano': 'CHI', 'huachipato': 'CHI',
    'everton': 'CHI', 'deportes iquique': 'CHI',
    # Paraguay
    'cerro porteno': 'PAR', 'olimpia': 'PAR', 'libertad': 'PAR',
    'libertad asuncion': 'PAR',  # API-Football: "Libertad Asuncion"
    'nacional asuncion': 'PAR', 'sportivo ameliano': 'PAR', 'guairena': 'PAR',
    'sportivo luqueno': 'PAR', '2 de mayo': 'PAR', 'tacuary': 'PAR',
    'sportivo trinidense': 'PAR',
    # Peru
    'universitario de deportes': 'PER', 'universitario': 'PER',
    'alianza lima': 'PER', 'sporting cristal': 'PER', 'melgar': 'PER',
    'fbc melgar': 'PER',  # API-Football: "FBC Melgar"
    'cusco fc': 'PER', 'deportivo garcilaso': 'PER', 'cienciano': 'PER',
    'adt': 'PER', 'sport boys': 'PER', 'utc cajamarca': 'PER',
    # Bolivia
    'bolivar': 'BOL', 'the strongest': 'BOL', 'always ready': 'BOL',
    'jorge wilstermann': 'BOL', 'aurora': 'BOL', 'nacional potosi': 'BOL',
    'san antonio bulo bulo': 'BOL', 'guabira': 'BOL',
    # Venezuela
    'deportivo tachira': 'VEN', 'deportivo tachira fc': 'VEN',  # API name
    'caracas': 'VEN', 'caracas fc': 'VEN',  # API name
    'zamora': 'VEN', 'academia puerto cabello': 'VEN', 'puerto cabello': 'VEN',
    'metropolitanos': 'VEN', 'portuguesa': 'VEN', 'portuguesa fc': 'VEN',
    'rayo zuliano': 'VEN', 'monagas': 'VEN',
    'carabobo': 'VEN', 'estudiantes de merida': 'VEN',
    'deportivo la guaira': 'VEN',
}

# International friendlies ("Amistoso Internacional", Promiedos league `fha`).
# Promiedos' national-team country_id space is opaque and non-ISO -- prominent
# nations get 1-2 chars ('b' England, 'c' Spain, 'f' France, 'h' Netherlands) --
# so the 87 below were transcribed from a sweep of every day of 2026 (#442:
# 97 distinct ids; the other 10 are the CONMEBOL ids above and resolve via
# super()). Every code is 3 ASCII chars because Association.code is
# max_length=3, unique=True (models.py:35); ENG/SCO/WAL/NIR/KOS are FIFA codes.
# ponytail: exhaustive for the 2026 sweep, not for later cycles -- the name map
# below (and the skip-with-warning policy) covers the rest.
PROMIEDOS_NATIONAL_TEAM_ID_MAP = {
    # UEFA
    'b': 'ENG', 'baa': 'WAL', 'bad': 'AND', 'bae': 'BLR', 'baf': 'KAZ',
    'bag': 'FRO', 'bb': 'POR', 'bc': 'TUR', 'bd': 'GRE', 'bf': 'SUI',
    'bg': 'BEL', 'c': 'ESP', 'ca': 'AUT', 'caf': 'KOS', 'cc': 'CZE',
    'cd': 'DEN', 'ce': 'SWE', 'cf': 'FIN', 'cg': 'UKR', 'ch': 'NOR',
    'cj': 'ROU', 'd': 'ITA', 'da': 'HUN', 'dc': 'ISL', 'dh': 'POL',
    'di': 'CRO', 'dj': 'CYP', 'e': 'GER', 'eg': 'SVN', 'ej': 'ARM',
    'f': 'FRA', 'fg': 'MKD', 'h': 'NED', 'hh': 'AZE', 'i': 'SCO',
    'ie': 'MNE', 'if': 'SRB', 'j': 'IRL', 'jb': 'MDA', 'jc': 'LUX',
    'je': 'SMR', 'jj': 'NIR',
    # Added from the UEFA Nations League (league `habg`) sweep: 12 ids absent
    # from the friendlies sweep, ~10-12 of 52 team instances per matchday.
    'bab': 'LIE', 'bac': 'EST', 'caj': 'GIB', 'dd': 'SVK',
    'ea': 'BUL', 'eb': 'LVA', 'ec': 'LTU', 'fh': 'BIH',
    'g': 'ISR', 'hg': 'ALB', 'hi': 'GEO', 'jd': 'MLT',
    # AFC
    'bbe': 'IRQ', 'bbf': 'QAT', 'bbj': 'JOR', 'bcb': 'UZB', 'bcc': 'KSA',
    'ccg': 'PSE',
    'bce': 'UAE', 'cbj': 'BAN', 'fa': 'SIN', 'ia': 'IND', 'de': 'JPN',
    'dg': 'AUS', 'ig': 'KOR',
    # CAF
    'bch': 'MAR', 'bcj': 'BEN', 'bda': 'SDN', 'bdb': 'EGY', 'bdc': 'ZAM',
    'bdd': 'SEN', 'bdf': 'TUN', 'bdj': 'ALG', 'bef': 'CPV', 'bhe': 'MAD',
    'bjb': 'MTN', 'bjc': 'BDI', 'cdf': 'COD', 'gf': 'GHA', 'he': 'CIV',
    'id': 'NGA', 'bfa': 'BFA',
    # CONCACAF
    'bea': 'GUA', 'beg': 'PAN', 'beh': 'SLV', 'bei': 'TRI', 'bfc': 'HAI',
    'bfd': 'CRC', 'bgj': 'HON', 'bhi': 'PUR', 'bi': 'USA', 'bic': 'NCA',
    'bje': 'BER', 'cdc': 'CUW', 'cfc': 'ARU', 'db': 'MEX', 'gg': 'CAN',
    # OFC
    'bfj': 'NZL',
}

# Name fallback: resolves an unseen country_id for a nation we already know
# (Promiedos renumbers; a national team's name *is* its country, and the name
# survives a code change). Spanish names as Promiedos spells them, normalized
# so lookups are accent-insensitive, mirroring TEAM_COUNTRY_BY_NAME. Listed in
# the same order as the id map above.
NATIONAL_TEAM_COUNTRY_BY_NAME = {
    # UEFA
    'inglaterra': 'ENG', 'gales': 'WAL', 'andorra': 'AND', 'bielorrusia': 'BLR',
    'kazajistan': 'KAZ', 'islas feroe': 'FRO', 'portugal': 'POR', 'turquia': 'TUR',
    'grecia': 'GRE', 'suiza': 'SUI', 'belgica': 'BEL', 'espana': 'ESP',
    'austria': 'AUT', 'kosovo': 'KOS', 'republica checa': 'CZE', 'dinamarca': 'DEN',
    'suecia': 'SWE', 'finlandia': 'FIN', 'ucrania': 'UKR', 'noruega': 'NOR',
    'rumania': 'ROU', 'italia': 'ITA', 'hungria': 'HUN', 'islandia': 'ISL',
    'polonia': 'POL', 'croacia': 'CRO', 'chipre': 'CYP', 'alemania': 'GER',
    'eslovenia': 'SVN', 'armenia': 'ARM', 'francia': 'FRA', 'macedonia del norte': 'MKD',
    'paises bajos': 'NED', 'azerbaiyan': 'AZE', 'escocia': 'SCO', 'montenegro': 'MNE',
    'serbia': 'SRB', 'irlanda': 'IRL', 'moldavia': 'MDA', 'luxemburgo': 'LUX',
    'san marino': 'SMR', 'irlanda del norte': 'NIR',
    'liechtenstein': 'LIE', 'estonia': 'EST', 'gibraltar': 'GIB', 'eslovaquia': 'SVK',
    'bulgaria': 'BUL', 'letonia': 'LVA', 'lituania': 'LTU', 'bosnia herzegovina': 'BIH',
    'israel': 'ISR', 'albania': 'ALB', 'georgia': 'GEO', 'malta': 'MLT',
    # AFC
    'irak': 'IRQ', 'qatar': 'QAT', 'jordania': 'JOR', 'uzbekistan': 'UZB',
    'palestina': 'PSE',
    'arabia saudita': 'KSA', 'emiratos arabes': 'UAE', 'bangladesh': 'BAN',
    'singapur': 'SIN', 'india': 'IND', 'japon': 'JPN', 'australia': 'AUS',
    'corea del sur': 'KOR',
    # CAF
    'marruecos': 'MAR', 'benin': 'BEN', 'sudan': 'SDN', 'egipto': 'EGY',
    'zambia': 'ZAM', 'senegal': 'SEN', 'tunez': 'TUN', 'argelia': 'ALG',
    'cabo verde': 'CPV', 'madagascar': 'MAD', 'mauritania': 'MTN', 'burundi': 'BDI',
    'rd congo': 'COD', 'ghana': 'GHA', 'costa de marfil': 'CIV', 'nigeria': 'NGA',
    'burkina faso': 'BFA',
    # CONCACAF
    'guatemala': 'GUA', 'panama': 'PAN', 'el salvador': 'SLV',
    'trinidad y tobago': 'TRI', 'haiti': 'HAI', 'costa rica': 'CRC',
    'honduras': 'HON', 'puerto rico': 'PUR', 'estados unidos': 'USA',
    'nicaragua': 'NCA', 'bermuda': 'BER', 'curazao': 'CUW', 'aruba': 'ARU',
    'mexico': 'MEX', 'canada': 'CAN',
    # OFC
    'nueva zelanda': 'NZL',
}


def normalize_text(value):
    """Lowercase, accent-stripped lookup key."""
    normalized = unicodedata.normalize('NFKD', value or '')
    ascii_only = normalized.encode('ascii', 'ignore').decode('ascii')
    return ' '.join(ascii_only.lower().split())
