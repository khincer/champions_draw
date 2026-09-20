# Railway deployment

Operational guide for deploying `champions_draw` to Railway. It complements
[scheduling data syncs on Railway](RAILWAY_SYNC_PROPOSAL.md); the structural
blocker described there (real-fixture results living in an ephemeral JSON file)
is resolved — see "Where live data lives" below.

## Where live data lives

| Data | Store | Written by |
|---|---|---|
| Leagues, standings, league fixtures | Postgres (`League`, `LeagueStanding`, `LeagueMatch`) | `sync_leagues`, `sync_league_fixtures` |
| Real UCL league-phase results | Postgres (`RealFixtureResult`, keyed by `real-{matchday}-{index}`) | `sync_real_fixture_results` |
| Real fixture calendar (matchdays, kickoffs, teams) | Checked-in JSON `draw/data/ucl_league_phase_real_fixtures_2026_27.json` | Nobody at runtime (read-only) |

A Railway service filesystem is ephemeral and is not shared between containers.
Anything a cron service writes must go to Postgres, which all services share by
attaching the **same** Postgres service. `RealFixtureResult` exists for exactly
this reason: the results sync writes there, and the web service reads DB results
over the JSON's static fallback at request time.

## Builder and start command

The repo has both a root `Dockerfile` (whose `CMD` is gunicorn only) and a
`Procfile`. Railway auto-detects a root Dockerfile in preference to Nixpacks, so
without explicit config the deploy-time steps (`migrate`, seed import,
`collectstatic`) would be skipped.

`railway.json` pins the ambiguity:

```json
{
  "build": { "builder": "NIXPACKS" },
  "deploy": { "startCommand": "..." }
}
```

Nixpacks is pinned because it is the setup documented in `AGENTS.md` and because
the root `Dockerfile` is intentionally incomplete for deploy (its `CMD` omits
`migrate`, the seed import and `collectstatic`). The `startCommand` is the same
command as the `web:` line in `Procfile`, so the two stay interchangeable. The
`Dockerfile` is left as a local/dev convenience and is not the deploy builder.

The start command, in order:

```sh
python manage.py migrate
# bootstrap the 2026-27 season only when it does not exist yet; then pin the
# intended active season. Runs import + seeding on a fresh DB, no-ops on redeploy.
python manage.py shell -c "from django.core.management import call_command; from draw.models import Season; call_command('import_seed_input','draw/data/ucl_league_phase_seed_input_2026_27.json','--seed') if not Season.objects.filter(name='2026-27').exists() else None; Season.objects.exclude(name='2026-27').update(is_active=False); Season.objects.filter(name='2026-27').update(is_active=True)"
python manage.py collectstatic --noinput
gunicorn champions_draw.wsgi:application --bind 0.0.0.0:${PORT:-8000}
```

Why the seed import is conditional and pinned:

- The old `Procfile` ran `import_seed_input ... --set-active --seed` on every
  deploy. That deactivated every other season and forced `2025-26` active, while
  the app serves `2026-27` fixtures. Every redeploy flipped the active season
  back, recomputed seeding positions and deleted `SeasonTeam` rows absent from
  the seed file.
- Import runs **only when `2026-27` does not exist**, so a fresh database still
  bootstraps (import + seeding), while a redeploy never re-imports, never
  recomputes seeding and never prunes entries.
- The active season is then set explicitly (`2026-27`), which fixes databases
  that were flipped to `2025-26` by earlier deploys. Change the season name in
  both places when the served season advances.

The frontend build (`static/ui/`) is produced by the Nixpacks Node provider from
`package.json`'s `build` script; `collectstatic` then gathers it.

## Environment variables

Set these on **every** service that boots Django (web and both cron services).
Railway injects service variables into the process environment; no `.env` is
deployed.

| Variable | Value / source | Needed by |
|---|---|---|
| `DJANGO_SECRET_KEY` | A long random string. Must differ from dev. | web + both crons |
| `DATABASE_URL` | Injected automatically when the Postgres service is attached. Attach the same Postgres to every service. | web + both crons |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated custom domains. Optional: `settings.py` auto-adds `RAILWAY_PUBLIC_DOMAIN` and `.up.railway.app`. | web |
| `API_FOOTBALL_DATA_KEY` | football-data.org token. Never commit it. | `cron-leagues` only |

Also recommended, to boot production settings identically everywhere:

| Variable | Value |
|---|---|
| `DJANGO_DEBUG` | `false` |

`DJANGO_DEBUG=false` makes `settings.py` require `DJANGO_SECRET_KEY` and enables
secure cookies / SSL redirect / HSTS. `cron-results` needs no API key.

Do not log or echo `DATABASE_URL`, `DJANGO_SECRET_KEY` or the API key.

## Services

Create three services from this repository, plus one Postgres.

### 1. `web`

- Source: this repo. Builder: Nixpacks (pinned by `railway.json`).
- Start command: from `railway.json` (see above).
- Public networking: enabled.
- Variables: `DJANGO_SECRET_KEY`, `DATABASE_URL`, `DJANGO_ALLOWED_HOSTS`,
  `DJANGO_DEBUG=false`.

### 2. `cron-leagues` (daily, rate-limited)

- Source: this repo. Do **not** run the web start command; override it.
- Start command:

  ```sh
  python manage.py sync_leagues && python manage.py sync_league_fixtures
  ```

- Cron schedule (service Settings → Cron Schedule, UTC): `0 4 * * *`.
- Variables: `DJANGO_SECRET_KEY`, `DATABASE_URL`, `DJANGO_DEBUG=false`,
  `API_FOOTBALL_DATA_KEY`.

The two commands must run **sequentially** (`&&`), never in parallel and never on
the 5-minute cadence: `sync_league_fixtures` reads the `League` rows
`sync_leagues` creates, and both share football-data.org's free tier of
10 req/min (the code sleeps 10 s per call). `sync_leagues` is ~18 requests ≈ 3
min; `sync_league_fixtures` adds ~9 ≈ 1.5 min. Running them concurrently would
trigger HTTP 429.

### 3. `cron-results` (every 5 minutes)

- Source: this repo. Override the start command.
- Start command:

  ```sh
  python manage.py sync_real_fixture_results --source promiedos
  ```

- Cron schedule (UTC): `*/5 * * * *`.
- Variables: `DJANGO_SECRET_KEY`, `DATABASE_URL`, `DJANGO_DEBUG=false`.
  No API key: promiedos is a free scrape.

5 minutes is Railway's minimum cron granularity and the required cadence. If a
run is still executing when the next tick is due, Railway skips that tick; the
following tick catches up, and every sync is an idempotent
`update_or_create`/upsert.

### 4. Postgres

- Railway Postgres plugin. Attach it to `web`, `cron-leagues` and
  `cron-results` so all three receive the same `DATABASE_URL`.

The cron services must **not** run `migrate`, `collectstatic` or `gunicorn`, and
must not run `import_seed_input`: `web` owns migrations and static files, and a
second migrator risks lock contention.

## First-deploy checklist

1. Create the Railway project and add a **Postgres** service.
2. Create the **web** service from this repo; confirm the builder is Nixpacks
   (from `railway.json`) and the start command matches `railway.json`.
3. Attach Postgres to **web** and set its variables (see table above).
4. Deploy **web**. In the build/deploy logs confirm, in order: `migrate` →
   seed import (only on the first, empty database) → `collectstatic` →
   gunicorn. Note the seed import prints `season_created: True` on a fresh DB
   and does not run at all on later deploys.
5. Verify `GET /api/seasons/` lists `2026-27` and that it is the only active
   season.
6. Create **cron-leagues** from this repo. Attach the same Postgres, set its
   variables and start command, set the cron schedule to `0 4 * * *`.
7. Trigger `cron-leagues` once manually (or temporarily set its schedule to
   `*/5 * * * *` for the first tick) so `League` rows exist before the first
   daily run. `sync_league_fixtures` fails without them.
8. Create **cron-results** from this repo. Attach the same Postgres, set its
   variables and start command, set the cron schedule to `*/5 * * * *`.
9. After the first `cron-results` run, confirm results are served:
   `GET /api/ui/seasons/<pk>/real-fixtures/` shows a non-null `result` for a
   finished fixture, and `RealFixtureResult` gains rows.
10. Confirm a redeploy of **web** does not change the active season and does not
    re-import the seed.

## Not verifiable from the repository

The configuration above is authored and syntax-validated only. There is no
Railway CLI or Railway account access in the development environment, so the
builder selection, cron schedules, variable injection and a real deploy are
**not** deploy-tested here. Verify them in the Railway dashboard on first
deploy, starting with the web deploy logs (step 4) and the active-season check
(step 5).
