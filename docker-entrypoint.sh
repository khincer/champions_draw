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
    echo "[entrypoint] SERVICE_ROLE=cron-leagues -> sync_leagues, sync_league_fixtures, sync_promiedos_fixtures"
    # Order matters: sync_league_fixtures refuses to run without League rows,
    # so sync_leagues must succeed first (set -e aborts otherwise).
    python manage.py sync_leagues
    python manage.py sync_league_fixtures
    # CONMEBOL (Libertadores / Sudamericana), a different source from the
    # football-data leagues above: Promiedos carries the current season when
    # API-Football's free plan blocks it, and needs no API key. Without this the
    # homepage's CONMEBOL block has nothing to render -- neither
    # sync_conmebol_fixtures nor sync_promiedos_fixtures was ever scheduled, so
    # production has never had a Libertadores or Sudamericana season at all.
    # --competition is required and accepts one value, so both run.
    python manage.py sync_promiedos_fixtures --competition lib
    python manage.py sync_promiedos_fixtures --competition sud
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
