# AGENTS.md

## Project

Django 6 / DRF backend + Preact frontend. Single Django app: `draw`. Generates deterministic UEFA Champions League league-phase draws using a z3 SAT solver.

## Stack

- Python 3.13, Django 6.0.3, DRF 3.17, z3-solver 4.16, whitenoise, gunicorn
- Preact 10 + Vite 6 (frontend in `frontend/`, built to `static/ui/`)
- SQLite locally, PostgreSQL in production (via `dj-database-url`)
- No linter, formatter, or type checker configured

## Commands

All Python commands assume the venv is active (`.venv\Scripts\python` on Windows).

```powershell
# Setup
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python manage.py migrate
npm install

# Frontend build (required before Django serves UI)
npm run build

# Dev servers (run in separate terminals)
.\.venv\Scripts\python manage.py runserver 8001
npm run dev                         # Vite on :5173, proxies /api -> :8001

# Tests
.\.venv\Scripts\python manage.py test
.\.venv\Scripts\python manage.py check

# Import seed data
.\.venv\Scripts\python manage.py import_seed_input draw\data\ucl_league_phase_seed_input_2025_26.json --set-active --seed

# Generate draw
.\.venv\Scripts\python manage.py generate_draw 2025-26 --seed prediction-1 --player-name "Ada"
```

## Architecture

- `champions_draw/` — Django project config (settings, root URLs, WSGI)
- `draw/` — the only Django app: models, views, serializers, management commands
- `draw/services/draw.py` — z3-based draw solver (the core algorithm)
- `draw/services/seeding.py` — pot assignment logic
- `draw/services/import_seed_input.py` — JSON import/upsert
- `draw/services/standings.py` — league table computation from match predictions
- `draw/services/playoffs.py` — playoff bracket generation (9-24 positions)
- `draw/services/bracket.py` — knockout bracket generation (R16 through Final)
- `draw/data/` — checked-in seed input JSON
- `draw/predictions_views.py` — API views for prediction flow
- `draw/predictions_serializers.py` — serializers for prediction models
- `frontend/` — Preact SPA, root is `frontend/src/main.jsx`
- `frontend/src/PredictionApp.jsx` — main prediction orchestrator
- `frontend/src/MatchdayScoreBoard.jsx` — league phase score input grid
- `frontend/src/LeagueTable.jsx` — live standings table
- `frontend/src/PlayoffBracket.jsx` — two-legged playoff tie inputs
- `frontend/src/KnockoutBracket.jsx` — R16 through Final bracket
- `frontend/src/ScoreInput.jsx` — reusable goal score input
- `frontend/src/predictionStorage.js` — localStorage + backend sync
- `frontend/src/standingsCalc.js` — client-side standings calculation
- `build_seed_input.py` — standalone script to fetch team data from API-Football (requires `API_FOOTBALL_KEY`)

## Prediction System

Users can predict match results after generating a draw. The flow:
1. **League Phase**: Enter scores for all 144 fixtures (matchday-by-matchday). Standings update live.
2. **Standings**: Full UEFA table (Pts > GD > GF > Wins). Top 8 → R16, 9-24 → Playoffs, 25-36 → Eliminated.
3. **Playoffs**: 8 two-legged ties (9v24, 10v23, ... 16v17). Aggregate score determines winner.
4. **Knockout**: R16 → QF → SF → Final. Each round's teams are derived from previous round results.
- Scores saved to both localStorage (instant) and backend (periodic sync, every 30s).
- All predictions are anonymous (player name only, no auth).

## Prediction API Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| POST | `/api/predictions/` | Create/get prediction for season+player |
| GET/PATCH | `/api/predictions/<id>/` | Get/update prediction state |
| PUT | `/api/predictions/<id>/matches/<matchup_id>/` | Update single match score |
| POST | `/api/predictions/<id>/sync/` | Bulk sync league predictions |
| GET | `/api/predictions/<id>/standings/` | Compute league standings |
| GET | `/api/predictions/<id>/playoffs/` | Get playoff bracket + user predictions |
| POST | `/api/predictions/<id>/playoffs/sync/` | Sync playoff predictions |
| GET | `/api/predictions/<id>/knockout/` | Get knockout bracket |

## Gotchas

- The draw solver uses z3 (SAT solver). If you see `z3` import errors, run `pip install z3-solver==4.16.0.0` — the pinned version matters.
- Frontend build output goes to `static/ui/` (served by whitenoise). Run `npm run build` after any frontend change for Django to pick it up.
- Vite dev server proxies `/api` to `http://127.0.0.1:8001`. Django must be running separately.
- `db.sqlite3` and `staticfiles/` are gitignored. Run migrations after fresh clone.
- The `/console/` route redirects to `/`. No admin URLs are mounted.
- Tests create an in-memory SQLite database; no external services needed.
- Season requires exactly 36 teams seeded into 4 pots of 9 before a draw can run.
- Draws are deterministic: same seed + same attempt order = same result. The solver retries internally up to 100 times with different RNG states.
- Predictions are computed client-side for instant feedback. Backend only stores/retrieves raw scores.
- The Predict tab appears after a draw has been generated (needs matchups in seasonState).

## CodeGraph

When answering structural or codebase questions, use CodeGraph before broad filesystem searches. This is a hard ordering rule for repo maps, architecture, call flow, dependencies, symbol references, impact analysis, and "how does X work" questions.

CodeGraph-aware worktree placement:

- Create Git worktrees that may need CodeGraph under the user's home directory, preferably as a sibling such as `<repo-parent>/<repo-name>-worktrees/<worktree-name>`. Never place a CodeGraph-dependent worktree under `/tmp`, `/var/tmp`, or `/tmp/opencode`; generic temporary-work guidance does not override this rule.
- Every worktree needs its own `.codegraph/` index. Never copy, symlink, or reuse another checkout's index because its root and checked-out bytes may differ.

CodeGraph intelligence surface:

- Prefer the `codegraph_explore` MCP tool when it is available; it returns relevant source, call paths, and blast-radius context in one call.
- If the MCP tool is unavailable, invoke the upstream CLI directly. Agents may use its read-only intelligence commands: `codegraph status`, `codegraph query`, `codegraph explore`, `codegraph node`, `codegraph files`, `codegraph callers`, `codegraph callees`, `codegraph impact`, and `codegraph affected`.
- Do not use `gentle-ai codegraph` as a general proxy. Its `init` command exists only to validate the project root before initialization; intelligence queries belong to the upstream CLI.
- Never run or recommend destructive or administrative lifecycle commands: `codegraph uninit`, `codegraph install`, `codegraph uninstall`, or `codegraph upgrade`. Reserve `codegraph index` for explicit index-corruption recovery, never routine use.

Required order for structural/codebase questions:

1. Resolve the project root with `git rev-parse --show-toplevel || pwd`.
2. Confirm the root is a real project/workspace. Do not ask the user before initializing CodeGraph in a real project. Do not initialize CodeGraph in `$HOME`, temporary directories, or non-project folders.
3. Check for `<project-root>/.codegraph/` before any broad Read/Glob/Grep filesystem exploration.
4. If `.codegraph/` is missing and CodeGraph is enabled/available, immediately run `gentle-ai codegraph init --cwd <project-root>` once.
5. Missing .codegraph/ is the trigger to initialize, not a reason to skip CodeGraph. Do not fall back just because `.codegraph/` is missing; a missing index is the trigger to lazy-initialize, not a reason to skip CodeGraph.
6. Use `codegraph_explore` after initialization, or the read-only upstream CLI commands when MCP tools are absent.
7. After edits, rely on watcher auto-sync by default. Run `codegraph sync` only when the watcher is disabled or CodeGraph reports stale files that do not refresh normally.
8. Only fall back to normal filesystem tools after CodeGraph initialization or use fails, and briefly explain the fallback.

Broad Read/Glob/Grep exploration before this CodeGraph check is explicitly discouraged for structural/codebase questions.

## Deployment

Railway via Nixpacks + `Procfile`. The Procfile runs migrations, import_seed_input, collectstatic, then gunicorn. Requires `DJANGO_SECRET_KEY`, `DATABASE_URL` (auto from Railway Postgres), and `DJANGO_ALLOWED_HOSTS`.
