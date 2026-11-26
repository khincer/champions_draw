from .runtime import run_commands, scheduled_response


COMMANDS = (
    ('sync_real_fixture_results', '--source', 'promiedos'),
    ('sync_promiedos_fixtures', '--competition', 'lib'),
    ('sync_promiedos_fixtures', '--competition', 'sud'),
    ('sync_promiedos_nations_league', '--competition', 'unl'),
    ('sync_promiedos_friendlies',),
    ('backfill_national_flags',),
    ('sync_league_fixtures',),
)


async def main(context):
    return await scheduled_response(context, lambda: run_commands(COMMANDS))
