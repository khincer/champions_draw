# Champions Draw

Django/DRF backend and Preact UI for importing UEFA Champions League league-phase teams, seeding them into pots, generating draws, and **predicting match results** through the full tournament — league phase, playoffs, and knockout rounds all the way to the final.

## What it does

- Stores associations, teams, seasons, seeded season entries, and matchups.
- Imports seed-input JSON into the database.
- Seeds 36 teams into 4 pots of 9, with the title holder first.
- Generates a deterministic 144-match league-phase draw via a z3 SAT solver.
- Lets players **predict every match result** — league phase scores, playoff two-legged ties, and knockout brackets through to the final.
- Computes live standings with UEFA tiebreakers as scores are entered.
- Randomizes match results with coefficient-weighted probability for quick simulation.
- Syncs predictions to both localStorage and the backend.
- Persists player prediction state across sessions.

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

## Algorithms

### 1. Draw Solver (z3 SAT)

The league-phase draw is the core algorithmic piece. It generates 144 directed fixtures (36 teams × 8 matches each) respecting all UEFA constraints using a **z3 SAT solver** with four stages:

#### Stage 1: Input Validation

Ensures exactly 36 teams exist with assigned pots (1–4, 9 per pot) and seeding positions (1–36). Each team must have at least 2 eligible opponents in every pot (eligible = different association). If matchups already exist and `reset` is not true, the draw is rejected.

#### Stage 2: Constraint Graph (z3)

Creates a Boolean variable for every possible undirected edge between teams of different associations. The solver enforces four constraints:

| Constraint | Description |
|-----------|-------------|
| **1. Exactly 8 opponents** | Every team must have exactly 8 incident edges in the solution |
| **2. 2 per pot** | Exactly 2 opponents must come from each of the 4 pots |
| **3. ≤2 per association** | No team can face more than 2 opponents from the same national association |
| **4. No self/duplicate pairs** | No team faces itself; no duplicate or reversed pairings |

The possible edges are shuffled using a seeded RNG (`draw_seed:{attempt}`) so the solver explores different orderings each run, producing varied results while staying deterministic for the same seed.

If the solver fails to find a solution (returns `unsat`), the entire pipeline retries up to **100 times** with different RNG seeds, incrementing the attempt counter each time.

#### Stage 3: Edge Orientation (Home/Away)

Each pot-pair subgraph (e.g., Pot 1 vs Pot 3) forms a collection of disjoint cycles (every node has degree exactly 2). The algorithm:

1. Detects all cycle components using DFS.
2. Randomly reverses each cycle with 50% probability (seeded).
3. Orients edges along the cycle direction to assign home/away.
4. Validates every team ends up with exactly 4 home and 4 away matches.

#### Stage 4: Matchday Scheduling

Uses **backtracking with maximum bipartite matching** to assign the 144 fixtures across 8 matchdays:

- Each matchday must be a **perfect matching** (every team plays exactly once).
- A cache of seen matchings prevents repeating the same set of fixtures.
- For each matchday slot, the algorithm tries up to 50 random perfect matchings before backtracking to the previous matchday.
- Backtracking continues until all 8 matchdays are scheduled or all possibilities are exhausted.

### 2. Pot Seeding

Teams are assigned to pots based on their **UEFA club coefficient** (descending):

```
Pot 1: Positions 1–9  (highest coefficients + title holder at #1)
Pot 2: Positions 10–18
Pot 3: Positions 19–27
Pot 4: Positions 28–36
```

The title holder is always placed at seeding position 1 in Pot 1, regardless of coefficient. All other teams are sorted by coefficient descending, then assigned sequentially.

### 3. League Table Standings Sorting

The league table is computed from user-entered match predictions. For each completed fixture:

- **Win**: 3 points to winner, 0 to loser
- **Draw**: 1 point each
- **Goals For/Against**: Added per team

Teams are sorted by a **4-tier tiebreaker**:

| Priority | Criterion | Direction |
|----------|-----------|-----------|
| 1st | Total points | Descending |
| 2nd | Goal difference (GF − GA) | Descending |
| 3rd | Goals scored (GF) | Descending |
| 4th | Wins total | Descending |

**Zone classification** from the sorted table:

| Positions | Outcome |
|-----------|---------|
| 1–8 | Qualify directly to Round of 16 |
| 9–24 | Enter two-legged playoff round |
| 25–36 | Eliminated |

This is computed both **client-side** (instant `useMemo` recalculation on every score change) and **server-side** (via the standings API endpoint for persistence).

### 4. Goal Randomization (Coefficient-Weighted)

The "Randomize" button fills all fixtures in a matchday with plausibly realistic scores. Instead of equal odds for both teams, the distribution is biased by the **UEFA club coefficient ratio**:

```
P(goals)   Weight
─────────  ──────
  0 goals   7/20  (35%)
  1 goal    6/20  (30%)
  2 goals   4/20  (20%)
  3 goals   2/20  (10%)
  4 goals   1/20  (5%)
```

**Shift computation per team:**

```
ratio = teamCoeff / opponentCoeff
capped = clamp(ratio, 0.25, 4.0)
shift = round(log2(capped))
```

| Ratio | Shift | Effect on weak team | Effect on strong team |
|-------|-------|---------------------|-----------------------|
| 1.0 (equal) | 0 | Base distribution (P(0)=35%) | Same |
| 2.0 (2× stronger) | +1 | P(0) drops to ~20% | P(2+) rises |
| 0.5 (2× weaker) | −1 | P(0) rises to ~50% | P(2+) drops |
| 4.0 (max) | +2 | Rare to score 0 | Avg ~2-3 goals |
| 0.25 (min) | −2 | Very likely 0 goals | Avg ~0-1 goals |

Each team's shift is applied independently, so a strong team getting shift +1 paired with a weak team getting shift −1 produces realistic scorelines like:
- **3–0**, **2–0**, **4–1** (expected)
- **1–1**, **0–0** (possible, less likely)
- **0–2**, **1–2** (upset, rare but possible)

This ensures that randomization produces plausible results where higher-ranked teams generally outperform lower-ranked ones, without being perfectly deterministic.

### 5. Playoff Bracket Pairing

The league standings determine which teams enter the two-legged playoff round. Pairings are fixed by position:

| Matchup | Higher seed (leg 2 home) | Lower seed |
|---------|-------------------------|------------|
| 1 | 9th place | 24th place |
| 2 | 10th place | 23rd place |
| 3 | 11th place | 22nd place |
| 4 | 12th place | 21st place |
| 5 | 13th place | 20th place |
| 6 | 14th place | 19th place |
| 7 | 15th place | 18th place |
| 8 | 16th place | 17th place |

**Winner determination** (two-legged aggregate):

```
aggHome = leg1_away + leg2_home    (higher seed's total)
aggAway = leg1_home + leg2_away    (lower seed's total)

If aggHome > aggAway → higher seed wins
If aggAway > aggHome → lower seed wins
If equal → away goals in leg 2 break the tie
If still equal → higher seed wins (simplified)
```

### 6. Knockout Bracket Structure

The knockout bracket progresses deterministically from playoff winners and the top 8 league-phase teams.

```
ROUND OF 16 (8 matches)
  [1st]      vs  PW(16v17)
  [2nd]      vs  PW(15v18)
  [3rd]      vs  PW(14v19)
  [4th]      vs  PW(13v20)
  [5th]      vs  PW(12v21)
  [6th]      vs  PW(11v22)
  [7th]      vs  PW(10v23)
  [8th]      vs  PW(9v24)

QUARTER-FINALS (4 matches)
  R16W1 vs R16W2    │    R16W3 vs R16W4
  R16W5 vs R16W6    │    R16W7 vs R16W8

SEMI-FINALS (2 matches)
  QFW1 vs QFW2      │    QFW3 vs QFW4

FINAL (1 match)
  SFW1 vs SFW2
```

Each knockout round is a single match. The winner is determined by the higher score; draws default to the home team (simplified — no extra time/penalties in the current implementation, though the `KnockoutPrediction` model supports `extra_time` and `penalties` flags for future use).

The bracket is computed **entirely client-side** as a `useMemo` chain that resolves each round's teams from the previous round's winners, providing instant feedback as the user enters scores.

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
