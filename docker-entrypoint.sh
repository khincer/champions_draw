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
    echo "[entrypoint] SERVICE_ROLE=cron-leagues -> sync_leagues, then sync_league_fixtures"
    # Order matters: sync_league_fixtures refuses to run without League rows,
    # so sync_leagues must succeed first (set -e aborts otherwise).
    python manage.py sync_leagues
    python manage.py sync_league_fixtures
    ;;
  cron-results)
    echo "[entrypoint] SERVICE_ROLE=cron-results -> sync_real_fixture_results --source promiedos"
    python manage.py sync_real_fixture_results --source promiedos
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
