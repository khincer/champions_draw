"""Sync the UEFA Nations League league phase from Promiedos.

Same Promiedos source and filter route as the CONMEBOL club sync
(`sync_promiedos_fixtures`): the league page `/league/uefa-nations-league/habg`
serves a working filter list, so this subclass inherits the parent's `handle`,
`get_filters` and the whole persistence chain unchanged and only overrides what
differs for a national-team competition.

* `resolve_association_code` chains the national id map, then the national name
  map, then the parent's CONMEBOL club maps as a last resort -- exactly the
  friendlies pattern. The parent's own resolver is deliberately NOT widened:
  that would make currently-skipped club teams on LIB/SUD pages start
  resolving as nations, a silent change to those competitions.
* `season_defaults` returns `{}`, so the Season is created with the model
  defaults rather than the UCL/ConMEBOL 4x8x6 shape, mirroring how the
  friendlies command creates its season with only `competition`.
* `unresolved_team_label` adds the country_id to the skip warning (R10/S10b).

Unresolved nations follow the parent's policy: the matchup is skipped, the
team is named loudly on stderr, and the run still succeeds.
"""
from draw.management.commands.sync_promiedos_fixtures import (
    Command as PromiedosFixturesCommand,
)
from draw.services.conmebol_naming import (
    NATIONAL_TEAM_COUNTRY_BY_NAME,
    PROMIEDOS_NATIONAL_TEAM_ID_MAP,
    normalize_text,
)


class Command(PromiedosFixturesCommand):
    help = 'Sync the UEFA Nations League league phase from Promiedos (free, no API key).'

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

    def season_defaults(self):
        """No UCL/ConMEBOL defaults: let the model defaults stand (like FRN)."""
        return {}

    def unresolved_team_label(self, name, country_id):
        return f'{name} ({country_id})'
