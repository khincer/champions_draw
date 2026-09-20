# Feature Plan: Match Prediction System

## Overview

Add a full prediction system where users guess match results for the Champions League league phase, see live standings, then progress through playoffs and knockout rounds all the way to the final. Anonymous users (name only), scores saved to both localStorage and backend.

---

## User Flow

```
Landing Page
  |
  v
[Run Simulation] --> Draw is generated (existing flow)
  |
  v
New "Predict" tab --> User enters scores for all 144 league phase matches
  |                    (matchday-by-matchday, live table updates)
  v
League Table displayed --> Top 8: qualified for R16
  |                        9th-24th: playoff round
  |                        25th-36th: eliminated
  v
[Playoffs] --> 8 two-legged ties (9v24, 10v23, ..., 16v17)
  |              User predicts both legs, aggregate determines winner
  v
[Round of 16] --> 8 matches seeded from league positions + playoff winners
  v
[Quarter-finals] --> 4 matches
  v
[Semi-finals] --> 2 matches
  v
[Final] --> 1 match --> Champion crowned with animation
```

---

## Phase 1: Backend Models & API

### New Models (`draw/models.py`)

```python
class Prediction(models.Model):
    """A player's complete prediction bracket for a season."""
    season = models.ForeignKey(Season, on_delete=models.CASCADE, related_name='predictions')
    player_name = models.CharField(max_length=80)
    # League phase
    is_league_complete = models.BooleanField(default=False)
    # Playoffs
    is_playoffs_complete = models.BooleanField(default=False)
    # Knockout rounds
    is_knockout_complete = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        constraints = [
            models.UniqueConstraint(
                fields=['season', 'player_name'],
                name='unique_prediction_per_player_per_season',
            ),
        ]


class MatchPrediction(models.Model):
    """A single league phase match prediction."""
    prediction = models.ForeignKey(Prediction, on_delete=models.CASCADE, related_name='match_predictions')
    matchup = models.ForeignKey(SeasonMatchup, on_delete=models.CASCADE, related_name='predictions')
    home_goals = models.PositiveSmallIntegerField(null=True, blank=True)
    away_goals = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['prediction', 'matchup'],
                name='unique_match_prediction',
            ),
        ]


class PlayoffPrediction(models.Model):
    """A playoff round match prediction (two-legged tie)."""
    prediction = models.ForeignKey(Prediction, on_delete=models.CASCADE, related_name='playoff_predictions')
    home_team = models.ForeignKey(SeasonTeam, on_delete=models.CASCADE, related_name='home_playoff_preds')
    away_team = models.ForeignKey(SeasonTeam, on_delete=models.CASCADE, related_name='away_playoff_preds')
    # Leg 1 (at away_team's ground)
    leg1_home_goals = models.PositiveSmallIntegerField(null=True, blank=True)
    leg1_away_goals = models.PositiveSmallIntegerField(null=True, blank=True)
    # Leg 2 (at home_team's ground)
    leg2_home_goals = models.PositiveSmallIntegerField(null=True, blank=True)
    leg2_away_goals = models.PositiveSmallIntegerField(null=True, blank=True)
    # Computed
    winner = models.ForeignKey(SeasonTeam, on_delete=models.CASCADE, null=True, blank=True, related_name='playoff_wins')

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['prediction', 'home_team', 'away_team'],
                name='unique_playoff_prediction',
            ),
        ]


class KnockoutPrediction(models.Model):
    """A knockout round match prediction (single match from R16 onwards)."""
    ROUND_CHOICES = [
        ('R16', 'Round of 16'),
        ('QF', 'Quarter-final'),
        ('SF', 'Semi-final'),
        ('F', 'Final'),
    ]
    prediction = models.ForeignKey(Prediction, on_delete=models.CASCADE, related_name='knockout_predictions')
    round = models.CharField(max_length=3, choices=ROUND_CHOICES)
    bracket_position = models.PositiveSmallIntegerField()  # 1-8 for R16, 1-4 for QF, etc.
    home_team = models.ForeignKey(SeasonTeam, on_delete=models.CASCADE, null=True, blank=True, related_name='home_knockout_preds')
    away_team = models.ForeignKey(SeasonTeam, on_delete=models.CASCADE, null=True, blank=True, related_name='away_knockout_preds')
    home_goals = models.PositiveSmallIntegerField(null=True, blank=True)
    away_goals = models.PositiveSmallIntegerField(null=True, blank=True)
    # For Final: extra time / penalties
    extra_time = models.BooleanField(default=False)
    penalties = models.BooleanField(default=False)
    winner = models.ForeignKey(SeasonTeam, on_delete=models.CASCADE, null=True, blank=True, related_name='knockout_wins')

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['prediction', 'round', 'bracket_position'],
                name='unique_knockout_prediction',
            ),
        ]
```

### New API Endpoints (`draw/urls.py`)

| Method | URL | Purpose |
|--------|-----|---------|
| POST | `/api/predictions/` | Create or get existing prediction for player+season |
| GET | `/api/predictions/<id>/` | Get full prediction state (match predictions, standings) |
| PUT | `/api/predictions/<id>/matches/<matchup_id>/` | Update a single league match prediction |
| GET | `/api/predictions/<id>/standings/` | Compute and return current league table |
| POST | `/api/predictions/<id>/sync/` | Bulk sync all match predictions from localStorage |
| POST | `/api/predictions/<id>/playoffs/` | Save playoff predictions |
| GET | `/api/predictions/<id>/playoffs/` | Get playoff matchups + predictions |
| POST | `/api/predictions/<id>/knockout/` | Save knockout round predictions |
| GET | `/api/predictions/<id>/knockout/` | Get knockout bracket + predictions |

### League Table Computation Service (`draw/services/standings.py`)

Standard UEFA Champions League league phase table:
- Points: W=3, D=1, L=0
- Ranking: Points > GD > GF > Wins > Head-to-head > etc.
- Position classification: 1-8 (R16), 9-24 (Playoffs), 25-36 (Eliminated)

### Playoff Bracket Generation Service (`draw/services/playoffs.py`)

Based on final league positions:
- 9th vs 24th, 10th vs 23rd, 11th vs 22nd, 12th vs 21st
- 13th vs 20th, 14th vs 19th, 15th vs 18th, 16th vs 17th
- Two-legged tie, higher seed plays second leg at home
- Aggregate score determines winner (away goals, then extra time, then penalties if needed)

### Knockout Bracket Service (`draw/services/bracket.py`)

R16 seeding from league positions + playoff winners:
- R16: 1 vs lowest remaining playoff winner, 2 vs next, etc.
- Standard single-elimination bracket through to Final

---

## Phase 2: Frontend Components

### New Tab: "Predict" (`frontend/src/main.jsx`)

Add to the ViewTabs array:
```javascript
['predict', 'Predict']
```

### Sub-tabs within Predict

| Sub-tab | Content |
|---------|---------|
| `matchdays` | Score inputs for all 144 league phase matches, organized by matchday |
| `standings` | Live league table that recalculates per input |
| `playoffs` | 8 two-legged playoff ties with score inputs |
| `bracket` | R16 -> QF -> SF -> Final bracket view |

### Component Breakdown

```
PredictionApp (new root for prediction flow)
  |-- PredictionHeader (sub-tab navigation)
  |-- MatchdayScoreBoard (league phase scoring)
  |     |-- MatchdayColumn (single matchday)
  |           |-- ScoreFixtureRow (fixture with score inputs)
  |-- LeagueTable (live standings)
  |     |-- LeagueTableRow (team row with stats)
  |-- PlayoffBracket (8 two-legged ties)
  |     |-- PlayoffTie (single two-legged tie)
  |           |-- ScoreInput (leg 1 + leg 2)
  |           |-- AggregateDisplay
  |-- KnockoutBracket (R16 -> QF -> SF -> Final)
        |-- KnockoutRound (single round)
              |-- KnockoutMatch (single match with score input)
```

### Score Input Component

```jsx
function ScoreInput({ homeGoals, awayGoals, onChange, disabled }) {
  // Two number inputs side by side
  // onChange fires per input, triggers table recalculation
  // Disabled if teams not yet determined (later knockout rounds)
}
```

### League Table Component

Full UEFA standings table:
| Pos | Team | Pld | W | D | L | GF | GA | GD | Pts |
|-----|------|-----|---|---|---|----|----|-----|-----|
| 1 | ... | 8 | 6 | 1 | 1 | 18 | 5 | +13 | 19 |

- Rows color-coded: green (1-8), yellow (9-24), red (25-36)
- Recalculates on every score change via `useMemo`

### Playoff Tie Component

```
┌─────────────────────────────────────────┐
│  (9) Team A  vs  Team B  (24)          │
│  ┌─────────┐  ┌─────────┐              │
│  │ Leg 1   │  │ Leg 2   │              │
│  │ [2] [1] │  │ [1] [0] │              │
│  └─────────┘  └─────────┘              │
│  Aggregate: 3-1 → Team A advances      │
│  [Animation: Team A badge slides forward]│
└─────────────────────────────────────────┘
```

### Knockout Bracket Component

Visual bracket tree:
```
R16          QF          SF          Final
[1] ─┐
     ├── [?] ─┐
[8] ─┘        │
              ├── [?] ─┐
[4] ─┐        │        │
     ├── [?] ─┘        │
[5] ─┘                 │
                       ├── [?] ─┐
[3] ─┐                 │        │
     ├── [?] ─┐        │        │
[6] ─┘        │        │        │
              ├── [?] ─┘        │
[2] ─┐        │                 │
     ├── [?] ─┘                 │
[7] ─┘                          ├── [CHAMPION]
                                │
```

### Animations

1. **Score entry flash**: Brief highlight when a score is entered
2. **Table row shuffle**: Teams reorder with smooth CSS transitions when positions change
3. **Playoff advancement**: Winner badge slides/pulses forward, loser fades
4. **Knockout advancement**: Winner moves along bracket path to next round
5. **Final champion**: Celebration animation (confetti effect or trophy reveal)

---

## Phase 3: localStorage + Backend Sync Strategy

### localStorage Schema

Key: `champions_draw_prediction_{seasonId}_{playerName}`

```json
{
  "matchPredictions": {
    "<matchupId>": { "home_goals": 2, "away_goals": 1 },
    ...
  },
  "playoffPredictions": {
    "<homeTeamId>_<awayTeamId>": {
      "leg1_home_goals": 1, "leg1_away_goals": 0,
      "leg2_home_goals": 2, "leg2_away_goals": 1
    }
  },
  "knockoutPredictions": {
    "R16_1": { "home_goals": 3, "away_goals": 1 },
    ...
  },
  "lastSynced": "2026-07-14T12:00:00Z"
}
```

### Sync Logic

1. On every score change: save to localStorage immediately
2. On page load: hydrate from localStorage, then fetch from backend
3. On backend fetch: merge - keep whichever is newer (per-match comparison)
4. Periodic sync to backend (every 30 seconds if there are unsynced changes)
5. On sub-tab switch: sync to backend

---

## Phase 4: Implementation Order

### Sprint 1: Backend Foundation
1. Create new models (`Prediction`, `MatchPrediction`, `PlayoffPrediction`, `KnockoutPrediction`)
2. Run migrations
3. Implement standings computation service
4. Implement playoff bracket generation service
5. Implement knockout bracket service
6. Create API endpoints for predictions CRUD
7. Create API endpoints for standings
8. Write tests

### Sprint 2: League Phase Prediction UI
1. Add "Predict" tab to frontend
2. Build `ScoreFixtureRow` component with score inputs
3. Build `MatchdayScoreBoard` with all 8 matchdays
4. Build `LeagueTable` component with live calculation
5. Implement localStorage persistence
6. Implement backend sync
7. Wire up API calls

### Sprint 3: Playoffs UI
1. Build `PlayoffTie` component with two-legged score inputs
2. Build `PlayoffBracket` showing all 8 ties
3. Add advancement animation
4. Implement backend sync for playoff predictions

### Sprint 4: Knockout Rounds UI
1. Build `KnockoutMatch` component
2. Build `KnockoutBracket` with visual bracket tree
3. Implement round progression logic
4. Add advancement animations per round
5. Final champion celebration animation

### Sprint 5: Polish & Testing
1. Responsive design for all new components
2. Error handling and edge cases
3. Integration tests
4. Performance optimization (144 match inputs shouldn't cause jank)

---

## Key Technical Decisions

1. **No user accounts**: Player identified by name + localStorage key. Backend uses `player_name` as identifier.
2. **All computation in frontend**: League table calculated in `useMemo` hooks, no round-trip to backend for table updates.
3. **Backend as persistence layer**: Backend stores predictions for return visits, but the frontend is the source of truth during active prediction.
4. **Existing draw system preserved**: The draw generation (z3 solver) remains unchanged. Predictions are a separate layer on top of generated matchups.
5. **Matchday unlock**: All 8 matchdays are available simultaneously (no progressive unlock based on real dates).

---

## Files to Create/Modify

### New Files
- `draw/models.py` - Add 4 new models
- `draw/services/standings.py` - League table computation
- `draw/services/playoffs.py` - Playoff bracket generation
- `draw/services/bracket.py` - Knockout bracket generation
- `draw/predictions_urls.py` - New URL patterns for prediction endpoints
- `draw/predictions_views.py` - New views for prediction endpoints
- `draw/predictions_serializers.py` - New serializers
- `frontend/src/components/PredictionApp.jsx` - Main prediction wrapper
- `frontend/src/components/MatchdayScoreBoard.jsx` - League phase scoring
- `frontend/src/components/LeagueTable.jsx` - Live standings
- `frontend/src/components/PlayoffBracket.jsx` - Playoff round
- `frontend/src/components/KnockoutBracket.jsx` - R16 through Final
- `frontend/src/components/ScoreInput.jsx` - Reusable score input
- `frontend/src/services/predictionStorage.js` - localStorage management
- `frontend/src/services/standingsCalc.js` - Client-side standings calculation

### Modified Files
- `draw/models.py` - Add new models
- `draw/urls.py` - Include prediction URLs
- `draw/views.py` - Add prediction-related imports
- `frontend/src/main.jsx` - Add Predict tab, new state management
- `frontend/src/styles.css` - New styles for prediction components
- `AGENTS.md` - Update with new commands and architecture
