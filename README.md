# Champions Draw

Django/DRF backend and Preact UI for importing UEFA Champions League league-phase teams, seeding them into pots, and letting players publish their own draw simulations.

## What it does

- Stores associations, teams, seasons, seeded season entries, and matchups.
- Imports seed-input JSON into the database.
- Seeds 36 teams into 4 pots of 9, with the title holder first.
- Serves a public prediction lab where players can run simulations and compare other players' runs.
- Generates a deterministic 144-match league-phase draw:
  - 8 matches per team.
  - 2 opponents from each pot.
  - No same-association matchups.
  - No more than 2 opponents from any one association.
  - No duplicate or reverse duplicate pairings.
  - 4 home and 4 away matches per team.
  - Matchdays 1-8, with each team playing once per matchday.

## Local setup

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python manage.py migrate
npm install
npm run build
```

Optional environment variables:

```powershell
$env:DJANGO_SECRET_KEY = "local-dev-secret"
$env:DJANGO_DEBUG = "true"
$env:DJANGO_ALLOWED_HOSTS = "localhost,127.0.0.1"
$env:API_FOOTBALL_KEY = "your-api-football-key"
```

SQLite is the default local database.

## Import, seed, and draw

Import the checked-in 2025-26 seed data:

```powershell
.\.venv\Scripts\python manage.py import_seed_input draw\data\ucl_league_phase_seed_input_2025_26.json --set-active --seed
```

Start the API:

```powershell
.\.venv\Scripts\python manage.py runserver 8001
```

For frontend development with Vite:

```powershell
npm run dev
```

The compiled Preact app is served by Django at:

```text
http://127.0.0.1:8001/
```

The public UI invites players to enter a name, choose a deterministic simulation seed, run a persisted draw, inspect matchdays and pots, and review other players' runs. The old `/console/` route redirects back to the public simulator, and Django admin URLs are not mounted.

Useful API flow:

```text
GET  /api/seasons/
GET  /api/teams/overview/
GET  /api/ui/seasons/<season_id>/state/
POST /api/seasons/<season_id>/seed/
POST /api/seasons/<season_id>/draw/
GET  /api/seasons/<season_id>/draws/
GET  /api/seasons/<season_id>/matchups/
```

Generate a reproducible draw:

```json
{
  "seed": "prediction-1",
  "player_name": "Ada"
}
```

Publish a new current simulation when fixtures already exist:

```json
{
  "seed": "prediction-2",
  "player_name": "Marta",
  "reset": true
}
```

The draw response includes a summary with the draw seed, total matchup count, matchday count, pot-pair counts, home/away targets, and association-opponent cap.

Generate a draw from the command line:

```powershell
.\.venv\Scripts\python manage.py generate_draw 2025-26 --seed prediction-1 --player-name "Ada"
```

Replace an existing draw:

```powershell
.\.venv\Scripts\python manage.py generate_draw 2025-26 --seed prediction-2 --player-name "CLI Player" --reset
```

Every draw attempt is stored as metadata with its player name, seed, status, matchup count, error message, and completion time.

## Docker

```powershell
docker compose up
```

The container installs requirements, runs migrations, and serves the app on port `8001`.

## Railway deployment

This project is ready for Railway using Nixpacks and the checked-in `Procfile`.

1. Create a Railway project from this GitHub repo.
2. Add a PostgreSQL database service.
3. Set these variables on the Django service:

```text
DJANGO_DEBUG=false
DJANGO_SECRET_KEY=<long-random-secret>
DJANGO_ALLOWED_HOSTS=<your-service-domain>
```

Railway provides `DATABASE_URL` when the PostgreSQL service is connected. The app also reads
`RAILWAY_PUBLIC_DOMAIN`, and production settings allow Railway-generated `*.up.railway.app`
domains by default. Set `DJANGO_ALLOWED_HOSTS` explicitly if you attach a custom domain.

The start command in `Procfile` runs migrations, collects static files, and starts Gunicorn:

```text
python manage.py migrate && python manage.py collectstatic --noinput && gunicorn champions_draw.wsgi:application --bind 0.0.0.0:${PORT:-8000}
```

After the first deploy, import and seed the checked-in data from a Railway shell:

```bash
python manage.py import_seed_input draw/data/ucl_league_phase_seed_input_2025_26.json --set-active --seed
```

## Tests

```powershell
.\.venv\Scripts\python manage.py test
.\.venv\Scripts\python manage.py check
```
