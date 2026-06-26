# Champions Draw

Django/DRF backend for importing UEFA Champions League league-phase teams, seeding them into pots, and generating league-phase matchups.

## What it does

- Stores associations, teams, seasons, seeded season entries, and matchups.
- Imports seed-input JSON into the database.
- Seeds 36 teams into 4 pots of 9, with the title holder first.
- Generates a deterministic 144-match league-phase draw:
  - 8 matches per team.
  - 2 opponents from each pot.
  - No same-association matchups.
  - No duplicate or reverse duplicate pairings.
  - 4 home and 4 away matches per team.

## Local setup

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python manage.py migrate
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

Useful API flow:

```text
GET  /api/seasons/
GET  /api/teams/overview/
POST /api/seasons/<season_id>/seed/
POST /api/seasons/<season_id>/draw/
GET  /api/seasons/<season_id>/matchups/
```

Generate a reproducible draw:

```json
{
  "seed": "demo-draw-1"
}
```

Regenerate an existing draw:

```json
{
  "seed": "demo-draw-2",
  "reset": true
}
```

## Docker

```powershell
docker compose up
```

The container installs requirements, runs migrations, and serves the app on port `8001`.

## Tests

```powershell
.\.venv\Scripts\python manage.py test
.\.venv\Scripts\python manage.py check
```
