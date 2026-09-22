"""Shared CONMEBOL naming data for the fixture syncs.

Lives outside any management command because two syncs need it: the Promiedos
scraper (the one that actually runs) and, historically, the API-Football
command that was retired when its free plan started returning 403 for the
current season.

Neither source's payload carries a usable country for a team, so association
codes are resolved from this name map. Both sources spell clubs differently
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


def normalize_text(value):
    """Lowercase, accent-stripped lookup key."""
    normalized = unicodedata.normalize('NFKD', value or '')
    ascii_only = normalized.encode('ascii', 'ignore').decode('ascii')
    return ' '.join(ascii_only.lower().split())
