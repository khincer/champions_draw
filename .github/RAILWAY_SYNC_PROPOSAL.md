# Proposal: Scheduling data syncs on Railway

Status: **implemented** — the recommendation (Option B, Railway Cron Jobs) is applied, together with the Postgres persistence change it depended on. See [RAILWAY_DEPLOY.md](RAILWAY_DEPLOY.md) for the operational guide.

## 0. Implementation status (applied)

The blocker in section 2 was resolved by moving real-fixture results into Postgres, which unblocks scheduling `cron-results` as a separate service. What changed:

- **`RealFixtureResult` model** (`draw/models.py`, migration `draw/migrations/0020_realfixtureresult.py`): one row per fixture id `real-{matchday}-{index}`, with `home_goals`, `away_goals`, `updated_at`.
- **`sync_real_fixture_results`** now reads the checked-in JSON as a static calendar and writes results to `RealFixtureResult`; it no longer mutates the JSON. Its matching/normalisation logic (`normalize`, `resolve`, aliases) and its CLI surface (`--source`, `--dry-run`, `--fixtures-json`, `--url`) are unchanged.
- **`_load_real_fixtures`** (`draw/views.py`) merges the DB result over the JSON's static `result`, preserving the response shape (`result: {home_goals, away_goals}` or `null`).
- **`Procfile`**: the seed import now runs only when `2026-27` does not exist, and the active season is set explicitly to `2026-27`. A redeploy no longer re-imports, recomputes seeding, prunes entries, or flips the active season back to `2025-26`. A fresh database still bootstraps.
- **`railway.json`**: pins the builder to Nixpacks and the start command to `migrate` → conditional seed import → `collectstatic` → gunicorn, so the root `Dockerfile` no longer silently skips the deploy steps.
- **Cron services**: `cron-leagues` (`0 4 * * *`) and `cron-results` (`*/5 * * * *`) as described in sections 4 and 5, configured per service in the Railway dashboard.

The remainder of this document is the original proposal and its rationale; the recommendations in section 4 are now the deployed design.

## 1. Problem

Railway deploys the `web` process from `Procfile`, whose entire command is:

```
python manage.py migrate
&& python manage.py import_seed_input draw/data/ucl_league_phase_seed_input_2025_26.json --set-active --seed
&& python manage.py collectstatic --noinput
&& gunicorn champions_draw.wsgi:application --bind 0.0.0.0:${PORT:-8000}
```

There is **no sync command in that line**. The only place the sync commands are scheduled is the
`cron` service in `docker-compose.yml`, which is local-dev only — Railway does not read compose files.
So in production:

- `sync_leagues` never runs → the `League` / `LeagueStanding` tables are only ever populated by a
  manual run (`sync_league_fixtures` refuses to run without `League` rows: see
  `draw/management/commands/sync_league_fixtures.py:66-68`).
- `sync_league_fixtures` never runs → `LeagueMatch` stays empty.
- `sync_real_fixture_results` never runs → `draw/data/ucl_league_phase_real_fixtures_2026_27.json`
  stays frozen at whatever was committed. It currently holds **6 results out of 144 fixtures**.

The local `cron` service (docker-compose.yml:38-58) defines the intended cadence, which this proposal
preserves:

- `sync_real_fixture_results --source promiedos` — every 5 minutes (288 iterations × 300 s).
- `sync_leagues` then `sync_league_fixtures` — every 24 hours (every 288th iteration).

## 2. What the commands actually touch (critical)

| Command | Writes to | Shared across services? | Needs `API_FOOTBALL_DATA_KEY`? |
|---|---|---|---|
| `sync_leagues` | Postgres: `League`, `LeagueStanding` | Yes (Postgres) | Yes |
| `sync_league_fixtures` | Postgres: `LeagueMatch` | Yes (Postgres) | Yes |
| `sync_real_fixture_results --source promiedos` | **File:** `draw/data/ucl_league_phase_real_fixtures_2026_27.json` | **No — container-local** | No (scrapes promiedos) |

This split drives the whole design. The web process reads real fixtures from that file at request time
(`draw/views.py:287-296`, `_load_real_fixtures`). Railway filesystems are ephemeral and per-container,
and Railway volumes **cannot be shared between two services** (one volume per service; replicas are not
supported with volumes — see docs.railway.com/reference/volumes). Therefore:

> A separate Railway cron service that runs `sync_real_fixture_results` will write a JSON file that the
> web service never reads. Scheduling that command in its own service only "works" for the leagues/
> standings DB syncs, not for real fixture results.

This is the single structural blocker in the current design.

## 3. Options for scheduling

### Option A — Dedicated Railway service with a sleep loop

Port the compose `cron` service to a second long-lived Railway service: custom start command with
`while true; ...; sleep 300`, mirroring docker-compose.yml:38-58.

- **Configure:** one service, same repo, start command overridden to the loop.
- **Failure modes:** a hung HTTP request stalls the entire loop (no per-job isolation); if the process
  exits, the loop is dead until the platform restarts it; overlapping/duplicated work if more than one
  replica. Long-lived worker also holds a DB connection permanently (Railway asks cron-style services to
  close connections and exit).
- **Survives redeploys:** the container is replaced on every deploy and the loop restarts from its
  initial sync — harmless for idempotent `update_or_create` syncs, but it re-fires the heavy
  `sync_leagues` on every redeploy regardless of cadence.
- **Cost:** billed for uptime — ~730 h/month even while sleeping. The most expensive option.

### Option B — Railway Cron Jobs (native scheduled deployments) — *recommended*

Railway's built-in Cron Jobs run a service's start command on a crontab expression, then expect it to
exit. Docs (docs.railway.com/guides/cron-jobs) confirm:

- Schedule lives in service Settings ("Cron Schedule"); standard 5-field crontab, **UTC**.
- **Minimum interval is 5 minutes** — exactly enough for the results cadence.
- If a previous execution is still running when the next tick is due, **the new run is skipped** (not queued).
- Execution times are not guaranteed to the minute; they can slip by a few minutes.
- Cost is runtime-only: the service is not billed while idle.

- **Configure:** two services from the same repo, each with a custom start command and a cron schedule:
  - `cron-results` — `*/5 * * * *` → `python manage.py sync_real_fixture_results --source promiedos`
  - `cron-leagues` — `0 4 * * *` → `python manage.py sync_leagues && python manage.py sync_league_fixtures`
- **Failure modes:** the command must exit cleanly (Django management commands do); if a run exceeds
  its interval the next tick is skipped (acceptable: the following tick catches up, and syncs are
  idempotent); time drift of a few minutes.
- **Survives redeploys:** yes — the schedule is service configuration; each tick launches the current
  image. No always-on loop to lose.
- **Cost:** only per-run duration. Results: ~288 short runs/day (~10-30 s each) ≈ 1.5-2.5 h/day;
  leagues: ~5 min/day. Roughly 2-3 h/day total versus 24 h/day for Option A.

### Option C — External scheduler (e.g. GitHub Actions `schedule:`)

Two sub-variants:

1. **Runner executes the command directly.** A scheduled workflow checks out the repo, installs
   requirements, and runs `python manage.py sync_leagues` against Railway's public Postgres proxy.
   - Needs `DATABASE_URL` (and secrets) duplicated as GitHub Actions secrets; DB credentials now live in
     two systems and must be rotated in both.
   - GitHub-hosted cron is best-effort: runs can be delayed under load, and scheduled workflows are
     disabled after 60 days of repository inactivity.
   - Requires Railway Postgres public networking to be enabled and exposes the database to the public
     internet.
2. **Runner calls an HTTP endpoint on the web app** that triggers the sync.
   - Requires a new authenticated endpoint (code change) and a token stored in GitHub.
   - Heavy syncs (`sync_leagues`) can exceed request/proxy timeouts; the endpoint would need to be async.
   - For real fixtures it writes to the web container's ephemeral FS — the same limitation as Option B,
     with extra attack surface.

- **Cost:** free on public repos (minutes on private), but the hidden cost is a second copy of prod
  credentials and worse reliability. Not recommended.

## 4. Recommendation

**Use Railway Cron Jobs (Option B), not a sleep loop and not GitHub Actions.**

Rationale: it is the only option that keeps production credentials inside Railway, bills only for run
time, and survives redeploys without onboarding a second secret store. The minimum 5-minute granularity
matches the required results cadence exactly.

Two services, one schedule each:

| Service | Cron (UTC) | Start command |
|---|---|---|
| `cron-leagues` | `0 4 * * *` | `python manage.py sync_leagues && python manage.py sync_league_fixtures` |
| `cron-results` | `*/5 * * * *` | `python manage.py sync_real_fixture_results --source promiedos` |

Run the initial `sync_leagues` + `sync_league_fixtures` manually once (or temporarily set `cron-leagues`
to `*/5 * * * *` for the first tick) so the DB is not empty on day one; `sync_league_fixtures` cannot
run before `sync_leagues`.

**Before `cron-results` can be scheduled as a separate service, the real-fixtures output must move from
the JSON file into Postgres.** Until then that cron produces data no web request can read. Options:

- **(Recommended) Persist real-fixture results in a DB table** and change `_load_real_fixtures`
  (`draw/views.py:287`) to read from it. Small change, and it makes the web service and any cron service
  agree through the one store Railway already shares. *(Implemented — see section 0.)*
- **(Interim, no code change) Run the results sync inside the web service** and attach a Railway volume
  to the **web** service at `/app/draw/data`. This persists the file across redeploys and keeps the
  writer/reader on the same filesystem. Constraints: it needs an in-process scheduler or an authenticated
  trigger endpoint (code change), single replica only (volumes forbid replicas), and brief downtime on
  each redeploy while the volume re-attaches.

Because the leagues/standings/fixtures tables live in Postgres, `cron-leagues` can be scheduled
immediately with no code changes.

## 5. Exact commands, order, and cadence

Run in this order, sequentially, never in parallel:

1. **Daily (heavy, rate-limited):**
   ```
   python manage.py sync_leagues
   python manage.py sync_league_fixtures
   ```
   Order is mandatory: `sync_league_fixtures` reads `League` rows that `sync_leagues` creates.
   Both are rate-limited — the code sleeps 10 s between calls against football-data.org's free tier of
   10 req/min (`sync_leagues.py:90,125`; `sync_league_fixtures.py:86`). `sync_leagues` issues 2 requests
   per tracked league × 9 leagues ≈ 18 requests at 10 s spacing ≈ 3 min; `sync_league_fixtures` adds
   ~9 requests ≈ 1.5 min. Running them concurrently would exceed 10 req/min and trigger HTTP 429.

2. **Every 5 minutes (light, no key):**
   ```
   python manage.py sync_real_fixture_results --source promiedos
   ```
   Promiedos is a free scrape with no API key and near-real-time scores; this is why the compose service
   picked it. The `football-data` source for this command lags on `FINISHED` status (documented in the
   command docstring) and would consume the same 10 req/min budget the leagues sync needs.

Keep the two cadences in **separate services** rather than one cron service with counter logic — Railway
skips an overlapping tick, and separate services make each cadence observable and independently retryable.

## 6. Secrets / environment

Railway injects service variables into the process environment; no `.env` file is deployed.

| Variable | Needed by | How Railway supplies it |
|---|---|---|
| `DATABASE_URL` | both cron services + web | Added automatically when the Postgres service is attached to the service. For the cron services, attach the **same** Postgres so they receive the same `DATABASE_URL`. |
| `API_FOOTBALL_DATA_KEY` | `cron-leagues` only | Define as a project-level shared/reference variable (or copy the value) and reference it from the service. Never commit it. |
| `DJANGO_SECRET_KEY` | both cron services | Required because `champions_draw/settings.py:36-40` raises `RuntimeError` when `DJANGO_DEBUG=false` and no key is set. The cron services boot Django, so they must have it too. |
| `DJANGO_DEBUG` | both cron services | Mirror the web service's value so settings boot identically. |

`cron-results --source promiedos` needs **no** API key. Only `sync_leagues` / `sync_league_fixtures`
read `API_FOOTBALL_DATA_KEY` (`sync_leagues.py:65`, `sync_league_fixtures.py:59`).

## 7. What the scheduled job must NOT do

- **Do not run `import_seed_input ... --set-active --seed`.** It is a one-time bootstrap step, not a
  recurring sync (details in section 8). It must never be added to the cron.
- **Do not run `migrate`, `collectstatic`, or `gunicorn`.** The `web` process owns migrations and static
  files; a cron racing `migrate` risks lock contention.
- **Do not run `sync_leagues` every 5 minutes.** It is the heaviest, most rate-limit-consuming job;
  daily is sufficient and already exceeds the local compose cadence.
- **Do not run `sync_leagues` and `sync_league_fixtures` in parallel** (shared 10 req/min budget).
- **Do not schedule `sync_real_fixture_results` into a separate service** until its output is in Postgres
  (section 4); a file written in one service's container is invisible to the web service.
- **Do not log or commit secrets.** Railway supplies them as env vars; do not echo `DATABASE_URL` or the
  API key.
- **Do not assume the process may keep running.** Railway cron requires the command to exit and close
  connections; a `while true` loop would make every subsequent tick be skipped.

## 8. Risk found in the current deploy setup

**8a. `Procfile` re-activates a hardcoded season on every deploy.**

```
python manage.py import_seed_input draw/data/ucl_league_phase_seed_input_2025_26.json --set-active --seed
```

Running on every deploy (and every restart), this:

- **Forces `2025-26` active and deactivates every other season** (`import_seed_input.py:67-71` calls
  `Season.objects.exclude(pk=season.pk).update(is_active=False)`). The repo also ships a `2026-27` seed
  and the real-fixtures JSON targets `2026-27`, so every deploy silently flips the active season back to
  `2025-26`. If `2026-27` is meant to be live, this is a production bug.
- **Nulls and recomputes seeding on every deploy** (`import_seed_input.py:108-109` sets
  `seeding_position`/`pot` to `None`, then `--seed` recomputes them from the seed coefficients). Today
  that is deterministic — same coefficients produce the same pots — but it overwrites any manual seeding
  or pot adjustment on the next deploy.
- **Deletes `SeasonTeam` rows not present in the seed file** (`import_seed_input.py:119`), so any
  season-specific data added out-of-band is removed on deploy.

None of this refreshes live data; it re-imports a static seed file. Recommendation (not applied here):
move `import_seed_input --set-active --seed` to a one-time release step, or make activation explicit
rather than hardcoded to `2025-26`. This belongs to whoever owns deployment config.
*(Implemented — see section 0: the import is now conditional on the season not existing, and the active
season is set explicitly to `2026-27`.)*

**8b. Builder ambiguity: root `Dockerfile` vs `Procfile`.**

The repo has a root `Dockerfile` whose `CMD` is `gunicorn` only — it does **not** run `migrate`,
`import_seed_input`, or `collectstatic`. Railway auto-detects a root `Dockerfile` over Nixpacks when one
is present, and there is no `railway.json`, `railway.toml`, or `nixpacks.toml` in the repo to pin the
builder. This proposal assumes the setup described in `AGENTS.md` (Nixpacks + `Procfile`) is what is
actually configured in the Railway dashboard. **Verify in the dashboard which builder is active:** if
Railway is silently using the `Dockerfile`, none of the deploy-time steps run, and the "sync gap" is the
least of the problems. (A cron service with a custom start command is compatible with either builder.)
*(Implemented — see section 0: the builder and start command are now pinned in `railway.json`.)*

**8c. Real-fixture results are ephemeral on Railway.** As in section 2, the results file is written into
the container filesystem and reset on every redeploy; with no volume it also diverges across replicas.
*(Implemented — see section 0: results are now persisted in the `RealFixtureResult` table, and the JSON
is a read-only calendar.)*

## 9. The one decision needed from the maintainer

*Resolved — see section 0. The recommendation was approved and implemented: results now live in the
`RealFixtureResult` table, and `cron-results` can run as its own service.*

> **Approve moving `sync_real_fixture_results`' output from the tracked JSON file into Postgres (so any
> service can write it and the web service reads it), or keep the file and instead run that sync inside
> the web service with a Railway volume mounted at `/app/draw/data`?**

Once decided, `cron-leagues` (leagues + fixtures, daily) can be scheduled immediately with no code
changes; `cron-results` is blocked on this decision.
