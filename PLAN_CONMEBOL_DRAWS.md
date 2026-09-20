# Plan: Copa Libertadores & Copa Sudamericana Draw System

## Goal

Extend the existing Champions League draw system to support Copa Libertadores and Copa Sudamericana group-stage draws, which have fundamentally different formats from UEFA's league phase.

---

## Current System (Champions League) — Reference

| Property | Value |
|----------|-------|
| Teams | 36 |
| Pots | 4 pots of 9 |
| Matches per team | 8 (4 home, 4 away) |
| Opponents per pot | 2 |
| Max opponents per association | 2 |
| Seeding | UEFA club coefficient (descending) |
| Title holder | Pot 1, position 1 (fixed) |
| Matchday assignment | z3 SAT solver (complex graph problem) |
| Group structure | **None** — single league phase, all 36 teams in one table |

---

## Copa Libertadores — Draw System (2026 format)

### Structure

| Property | Value |
|----------|-------|
| Teams | 32 |
| Pots | 4 pots of 8 |
| Groups | 8 groups (A–H) of 4 teams |
| Matches per team | 6 (3 home, 3 away — round-robin within group) |
| Seeding basis | CONMEBOL Club Ranking (Dec 15, 2025) |

### Pot Composition

| Pot | Size | Seeding criteria |
|-----|------|-----------------|
| Pot 1 | 8 | 2025 Libertadores champion (fixed in Group A) + next 7 highest-ranked by CONMEBOL ranking |
| Pot 2 | 8 | 2025 Sudamericana champion + next 7 highest-ranked by CONMEBOL ranking |
| Pot 3 | 8 | Next 8 teams by CONMEBOL ranking |
| Pot 4 | 8 | 4 Libertadores Q3 losers + next 4 by CONMEBOL ranking |

### CONMEBOL Ranking Factors

1. Performance in last 10 years (Libertadores + Sudamericana results, 2016–2025)
2. Historical coefficient (Libertadores 1960–2015, Sudamericana 2002–2015)
3. Local tournament champion bonus (domestic league champions of last 10 years)

### Draw Procedure

1. **Pot 1** drawn first → teams occupy position 1 in Groups B–H (Libertadores champion auto-placed in Group A)
2. **Pot 2** drawn → fills position 2 in Groups A–H in order
3. **Pot 3** drawn → fills position 3 in Groups A–H in order
4. **Pot 4** drawn → fills position 4 in Groups A–H in order

### Country Restriction

- **No two teams from the same association can be in the same group**
- Exception: teams that came through the preliminary rounds (Q3 losers in Pot 4) CAN be drawn into a group with another team from the same country

### Key Differences from Champions League

1. **Groups exist** — 8 groups of 4, not a single 36-team league
2. **Simpler draw** — sequential pot draw into fixed group slots (no SAT solver needed)
3. **No matchday scheduling** — round-robin is deterministic (MD1: A→B, MD2: A→C, MD3: A→D at home, then reverse)
4. **Seeding is CONMEBOL ranking** — not UEFA coefficient
5. **Country restriction** — same-country avoidance (like UEFA's association limit but stricter: zero same-country in a group)
6. **Title holder placement** — Libertadores champion auto-placed in Group A, position 1

---

## Copa Sudamericana — Draw System (2026 format)

### Structure

| Property | Value |
|----------|-------|
| Teams | 32 |
| Pots | 4 pots of 8 |
| Groups | 8 groups (A–H) of 4 teams |
| Matches per team | 6 (3 home, 3 away — round-robin within group) |
| Seeding basis | CONMEBOL Club Ranking (Dec 15, 2025) |

### Pot Composition

| Pot | Size | Seeding criteria |
|-----|------|-----------------|
| Pot 1 | 8 | Highest-ranked teams by CONMEBOL ranking (direct group stage entries from Argentina/Brazil) |
| Pot 2 | 8 | Next tier by CONMEBOL ranking |
| Pot 3 | 8 | Next tier by CONMEBOL ranking |
| Pot 4 | 8 | Lowest-ranked direct entries + Libertadores Q3 losers |

### Draw Procedure

Same as Libertadores: sequential pot draw into group slots.

### Country Restriction

Same as Libertadores: no two teams from the same association in one group.

### Key Differences from Libertadores

1. **No title holder auto-placement** — no defending champion gets a fixed slot
2. **Pot composition** — based purely on CONMEBOL ranking (no champion bonus for Pot 1 beyond ranking)
3. **Otherwise identical draw mechanics** — same 4-pot, 8-group sequential draw

---

## What Needs to Change in the Codebase

### 1. Models (`draw/models.py`)

**`CompetitionChoices`** — add:
```python
LIBERTADORES = 'LIB', 'CONMEBOL Libertadores'
SUDAMERICANA = 'SUD', 'CONMEBOL Sudamericana'
```

**`QualifiedViaChoices`** — add CONMEBOL-specific options:
```python
CONMEBOL_RANKING = 'CONMEBOL_RANKING', 'CONMEBOL ranking'
DOMESTIC_CHAMPION = 'DOMESTIC_CHAMPION', 'Domestic champion'
LIBERTADORES_Q3_LOSER = 'LIB_Q3_LOSER', 'Libertadores Q3 loser'
```

**`Season` model** — already flexible enough (`pot_count`, `teams_per_pot`, `total_matches`). The defaults (4/9/8) are UCL-specific; CONMEBOL seasons would use (4, 8, 6).

**`SeasonTeam` model** — `uefa_club_coefficient` field name is UCL-specific but functionally serves as "ranking coefficient". Options:
- **Option A (lazy)**: Keep the field name, just treat it as CONMEBOL ranking for CONMEBOL seasons
- **Option B (clean)**: Rename to `club_coefficient` (migration needed, breaks admin column)

**Recommendation**: Option A (lazy). The field stores a decimal number — the label doesn't matter functionally.

### 2. Seeding (`draw/services/seeding.py`)

**Current**: Hardcoded for UCL — 36 teams, 4 pots of 9, title holder gets Pot 1.

**Needed**: Competition-aware seeding:
- **UCL**: Current behavior (36 teams, coefficient-descending, title holder → Pot 1)
- **Libertadores/Sudamericana**: 32 teams, CONMEBOL ranking-descending, 4 pots of 8
  - Libertadores: title holder auto → Pot 1 position 1 (Group A), then next 7 by ranking → Pot 1
  - Sudamericana: no title holder auto-placement, just ranking-based

**Approach**: Make seeding competition-aware. Either:
- **Option A**: Separate `seed_conmebol_entries()` function alongside existing `seed_season_entries()`
- **Option B**: Parameterize existing function with competition type

**Recommendation**: Option A — separate function is cleaner, different logic is genuinely different.

### 3. Draw Solver (`draw/services/draw.py`)

**Current**: z3 SAT solver for UCL league phase — solves graph coloring + matchday assignment. Very complex.

**Needed for CONMEBOL**: **No SAT solver needed.** The draw is a simple sequential pot draw:
1. Draw Pot 1 teams into group slots (position 1 of each group)
2. Draw Pot 2 teams into group slots (position 2)
3. Draw Pot 3 teams into group slots (position 3)
4. Draw Pot 4 teams into group slots (position 4)
5. Enforce country restriction: if a drawn team would create a same-group conflict, skip to next available group

This is a **much simpler algorithm** — essentially a constrained random assignment. A simple backtracking or iterative redraw approach works. No z3 needed.

**New service needed**: `draw/services/conmebol_draw.py`

```python
def generate_conmebol_group_draw(
    season: Season,
    *,
    draw_seed: str | int | None = None,
) -> DrawSummary:
    """Simple sequential pot draw for CONMEBOL group stage."""
    # 1. Load seeded entries by pot
    # 2. Shuffle each pot using seed
    # 3. Assign Pot 1 to group positions (Libertadores: group A fixed for champion)
    # 4. For each subsequent pot, assign to next available group slot
    #    that doesn't violate country restriction
    # 5. If assignment fails, reshuffle and retry (up to max_attempts)
    # 6. Return group assignments as SeasonMatchup records
```

**SeasonMatchup model change**: Currently stores `home_team`, `away_team`, `matchday`. For CONMEBOL, we need `group` (A–H) and `position` (1–4) instead of/in addition to matchday. Options:
- **Option A**: Add `group` and `position` fields to SeasonMatchup (nullable, UCL leaves them null)
- **Option B**: Use a new `SeasonGroupAssignment` model for CONMEBOL
- **Option C**: Store group info in `matchday` field (hacky — group A = matchday 1, etc.)

**Recommendation**: Option A — extend SeasonMatchup with nullable `group` and `position` fields. The round-robin fixture generation (home/away pairings within a group) can be derived from the group assignments.

### 4. Round-Robin Fixture Generation — IN SCOPE (user confirmed: auto-generate)

For CONMEBOL, once groups are assigned, the 6 fixtures per group are deterministic:
- Group of 4 teams: A, B, C, D
- MD1: A vs D, B vs C (home teams from pot 1 & 2)
- MD2: A vs C, D vs B
- MD3: A vs B, C vs D
- MD4: D vs A, C vs B (reverse)
- MD5: C vs A, B vs D
- MD6: B vs A, D vs C

This is a pure function: `generate_round_robin_fixtures(group_teams) -> list[Fixture]`.

### 5. Data Import

**Seed input JSON**: The current `import_seed_input` command is UCL-specific (expects 36 teams with UEFA coefficients).

**Data source — INVESTIGATION RESULT**: 
- **football-data.org** (the provider behind the existing `sync_match_history` / `sync_league_fixtures` / `sync_match_results` commands): **does NOT cover CONMEBOL**. Verified against the official league-code table — only European competitions + World Cup are listed. It cannot be used for Libertadores/Sudamericana.
- **API-Football v3** (the provider already used by `build_seed_input.py` / `enrich_seed_input.py`): **covers both tournaments**. Known league IDs: Libertadores ≈ 13, Sudamericana ≈ 11 (verify with one `GET /leagues?id=` call during Phase 3). Can provide team names, countries, and fixture/round structure for cross-check.
- **FBref** (`fbref.com/en/comps/14/Copa-Libertadores-Stats`, `/en/comps/205/Copa-Sudamericana-Stats`): free manual reference for verifying entries and for the POTS/group results (not needed for automation — the draw is ours).
- **CONMEBOL Club Ranking**: no public API found. Manual seed JSON is the path (same as the current UCL seed input approach).

**Needed**: A CONMEBOL seed input format:
```json
{
  "season": "2026",
  "competition": "LIB",
  "teams": [
    {
      "name": "Flamengo",
      "short_name": "FLA",
      "association": "BRA",
      "conmebol_ranking": 1,
      "is_title_holder": true,
      "qualified_via": "TITLE_HOLDER"
    },
    ...
  ]
}
```

**Approach**: Either extend `import_seed_input` to be competition-aware, or create a separate `import_conmebol_seed_input` command. The existing command is already long — a separate command is cleaner.

### 6. Frontend Changes

**Current**: UCL-specific draw UI (PotBoard with 4 pots of 9, league table view).

**Needed for CONMEBOL**:
- Group-based view (8 groups, 4 teams each)
- Interactive draw that reveals group assignments pot-by-pot
- Group stage standings table (per group, then combined)
- Country flag display

**Scope**: This plan focuses on the **backend draw system**. Frontend is a separate work unit.

### 7. Management Commands

- `generate_draw` command needs to accept competition type and dispatch accordingly
- New `import_conmebol_seed_input` command (or extend existing)
- New `sync_conmebol_rankings` command to fetch CONMEBOL club rankings (if available via API)

---

## Implementation Phases

> Decisions locked as of 2026-09-15: (1) **interactive ceremony-style draw** for CONMEBOL (the sequential pot draw is naturally ceremony-like), (2) **auto-generate round-robin fixtures** from group assignments, (3) **auto-generate playoff fixtures** (Sudamericana knockout playoffs Round of 16 → Final, fed by Libertadores group 3rd-place teams; Libertadores knockout R16 → Final).

### Phase 1: Model & Seeding Foundation
1. Add `LIBERTADORES` and `SUDAMERICANA` to `CompetitionChoices`
2. Add CONMEBOL-specific `QualifiedViaChoices`
3. Add nullable `group` (CharField, max 1) and `position` (PositiveSmallIntegerField) to `SeasonMatchup`
4. Create `draw/services/conmebol_seeding.py` — seeding logic for CONMEBOL ranking-based pots
5. Create seed input JSON for 2026 Libertadores (32 teams)
6. Write tests for CONMEBOL seeding

### Phase 2: Draw Algorithm
1. Create `draw/services/conmebol_draw.py` — sequential pot draw with country restriction
2. Implement group assignment algorithm (shuffled sequential with conflict avoidance)
3. Implement `generate_round_robin_fixtures()` — deterministic 6-matchday round-robin per group
4. Implement `generate_playoff_fixtures()` — knockout bracket from group results:
   - Libertadores: Top-2 per group → R16, third-placed teams → Sudamericana playoffs
   - Sudamericana: Round of 16 playoffs (group winners + runners-up + Libertadores 3rds) → knockout bracket through Final
   - Pairings deterministic per the official matching tables; auto-generation only, results entered later (same pattern as the existing Predictions flow)
5. Integrate with `generate_season_draw` dispatch (competition-aware routing)
6. Write tests for draw generation (including country restriction edge cases)

### Phase 3: Data Pipeline
1. Create `import_conmebol_seed_input` management command
2. Seed input JSON for 2026 Sudamericana (32 teams)
3. Optional `--verify` flag: cross-check imported entries against API-Football v3 (league 13 / 11) and FBref
4. Update `generate_draw` command to accept `--competition` flag and an interactive mode
5. Write tests for import and end-to-end draw generation

### Phase 4: API & Frontend (separate work unit)
1. API endpoints for group view, group standings
2. Frontend group draw UI
3. Frontend group standings view

---

## Open Questions

1. ~~**CONMEBOL ranking data source**: Is there an API for CONMEBOL club rankings, or is it manual data entry?~~ **RESOLVED**: No public ranking API found; manual seed input JSON (same as current UCL approach). API-Football v3 (league 13/11) and FBref used only to cross-check team entries.
2. ~~**SeasonMatchup reuse**: Should CONMEBOL group assignments live in the same `SeasonMatchup` model, or a new model?~~ **RESOLVED**: Extend existing `SeasonMatchup` with nullable `group` + `position` fields. UCL data unaffected.
3. ~~**Interactive draw**: Does the user want an interactive ceremony-style draw for CONMEBOL too?~~ **RESOLVED**: YES — interactive ceremony-style draw.
4. ~~**Matchday fixture generation**: Should the 6 round-robin fixtures be auto-generated from group assignments, or stored separately?~~ **RESOLVED**: Auto-generated from group assignments.
5. ~~**Playoff rounds**: Is this in scope, or just the group stage draw?~~ **RESOLVED**: Playoff fixture generation IS in scope (auto-generate bracket structure); user-entered results follow the existing Predictions flow.

Remaining (implementation detail, no user decision needed):
6. **Exact API-Football league IDs**: verify 13/11 with a real `GET /leagues?id=` call in Phase 3.

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| SeasonMatchup schema change breaks existing UCL data | High | New fields are nullable; no existing data affected |
| Country restriction algorithm can't find valid assignment | Medium | Retry with reshuffle (up to 100 attempts, same as UCL solver) |
| CONMEBOL ranking data unavailable programmatically | Low | Manual seed input JSON, same as current UCL approach |
| z3 solver is overkill for CONMEBOL but code expects it | Low | New `conmebol_draw.py` bypasses z3 entirely |
| football-data.org has no CONMEBOL coverage | Low | Confirmed during investigation — backend stays UCL-only for `sync_*` commands; CONMEBOL entries come from manual seed JSON (cross-checked via API-Football/FBref) |
