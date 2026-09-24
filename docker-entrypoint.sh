#!/bin/sh
# Entry point for the champions_draw image.
#
# ONE image, THREE Railway services. Railway builds this repo's Dockerfile for
# every service (web, cron-leagues, cron-results) but honours the Dockerfile's
# CMD and IGNORES each service's startCommand, even when the API stores that
# startCommand correctly. Proof: cron-results' container ran the web bootstrap
# ("Imported and seeded season 2026-27") and then started gunicorn instead of
# sync_real_fixture_results -- so no sync has ever run in production.
#
# Until Railway routes the per-service startCommand through to Dockerfile
# builds, this script is the ONLY way to make one image serve all three roles.
# Branch on SERVICE_ROLE (set as a Railway service variable) and do not
# "simplify" this back to a single CMD: that is exactly the bug it fixes.
#
# set -e: a failed sync must exit non-zero, so the cron run is visibly failed
# (and Railway can alert/retry) rather than silently "succeeding".
set -e

case "${SERVICE_ROLE:-}" in
  cron-leagues)
    echo "[entrypoint] SERVICE_ROLE=cron-leagues -> sync_leagues, sync_promiedos_fixtures, sync_promiedos_friendlies, sync_promiedos_nations_league, sync_match_history"
    # Standings and season-level data only. All of it changes slowly, so this
    # stays a daily job. Fixtures and results moved to cron-results because they
    # change constantly: group these by change rate, not by the word "league".
    python manage.py sync_leagues
    # CONMEBOL (Libertadores / Sudamericana), a different source from the
    # football-data leagues above: Promiedos carries the current season when
    # API-Football's free plan blocks it, and needs no API key. Without this the
    # homepage's CONMEBOL block has nothing to render -- nothing ever scheduled
    # these syncs, so production had no Libertadores or Sudamericana season at
    # all until they were run by hand. --competition is required and accepts one
    # value, so both run.
    python manage.py sync_promiedos_fixtures --competition lib
    python manage.py sync_promiedos_fixtures --competition sud
    # International friendlies ("Amistoso Internacional"), same Promiedos source
    # but a date-scoped pull: the league page 404s for `fha`, so this command
    # walks /games/DD-MM-YYYY itself and needs no --competition. It creates an
    # INACTIVE 'Friendlies <year>' season on purpose (see the command's
    # docstring); never --set-active it.
    python manage.py sync_promiedos_friendlies
    # UEFA Nations League: same Promiedos source and filter route as the CONMEBOL
    # syncs above, but a national-team competition. It must run through its own
    # subclass -- never `sync_promiedos_fixtures --competition unl`, which would
    # create the season with CONMEBOL metadata. Placed here beside the friendlies
    # pull by source and change rate. The change-rate comment above says group by
    # change rate, not by the word "league"; a UNL *result*-refresh path would
    # belong in cron-results. That tension is recorded here, not resolved.
    python manage.py sync_promiedos_nations_league --competition unl
    # Rule 6 (no third consecutive season with the same home team in a pairing)
    # reads SeasonMatchupHistory for the two seasons before the active one. If
    # nothing populates that table the constraint is silently a no-op, so this
    # must run: it is the only writer. Runs last because it maps API team names
    # onto Team rows, which the syncs above create. --seasons is derived from
    # the active season, so it stays correct as seasons roll forward.
    python manage.py sync_match_history
    ;;
  cron-results)
    echo "[entrypoint] SERVICE_ROLE=cron-results -> sync_real_fixture_results, sync_promiedos_fixtures, sync_promiedos_nations_league, sync_promiedos_friendlies, sync_league_fixtures"
    # Results and fixtures, in that order. sync_real_fixture_results is seconds
    # and feeds the live product; sync_league_fixtures is minutes (nine leagues
    # with sleeps and rate-limit retries), so it must not delay the fast one if
    # the tick turns out to be short.
    # sync_league_fixtures needs League rows, which cron-leagues' daily
    # sync_leagues creates -- run cron-leagues once after a fresh database.
    python manage.py sync_real_fixture_results --source promiedos
    # The Promiedos competitions belong here, not only on the daily cron-leagues
    # job. Their results change as constantly as the UCL's, and a daily cadence
    # left a finished Libertadores, Sudamericana, Nations League or friendlies
    # match sitting at IN_PLAY with no score until the next day: the live feed
    # stops reporting a game the moment it ends, and nothing else was promoting
    # the final result into the database.
    python manage.py sync_promiedos_fixtures --competition lib
    python manage.py sync_promiedos_fixtures --competition sud
    python manage.py sync_promiedos_nations_league --competition unl
    python manage.py sync_promiedos_friendlies
    python manage.py sync_league_fixtures
    ;;
  *)
    echo "[entrypoint] SERVICE_ROLE='${SERVICE_ROLE:-}' (unset/other) -> web: migrate, bootstrap_season, collectstatic, gunicorn"
    python manage.py migrate --noinput
    python manage.py bootstrap_season
    python manage.py collectstatic --noinput
    # exec so gunicorn gets PID 1's signals directly and Railway's
    # stop/restart works. Never exec before a && chain: exec replaces the
    # shell and the rest of the chain would never run.
    exec gunicorn champions_draw.wsgi:application --bind "0.0.0.0:${PORT:-8000}"
    ;;
esac
