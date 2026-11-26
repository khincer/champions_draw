from .runtime import run_commands, scheduled_response


COMMANDS = (
    ('sync_leagues',),
    ('sync_promiedos_fixtures', '--competition', 'lib'),
    ('sync_promiedos_fixtures', '--competition', 'sud'),
    ('sync_promiedos_friendlies',),
    ('sync_promiedos_nations_league', '--competition', 'unl'),
    ('sync_match_history',),
)


async def main(context):
    return await scheduled_response(context, lambda: run_commands(COMMANDS))
