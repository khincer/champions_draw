# Prediction Reconciliation Specification

## Purpose

Client-computed standings, playoffs and knockout stay the rendering source of truth; the existing `/standings/`, `/playoffs/` and `/knockout/` endpoints only confirm, silently to users.

## Requirements

### Requirement: Client computation remains the rendering source

Standings (`standingsCalc.js` `computeStandings`), playoff pairings (`PredictionApp.jsx:304`) and the knockout bracket (`PredictionApp.jsx:344-490`) MUST stay the only rendering source. Reconciliation MUST NOT gate, delay, replace or re-render any surface and MUST NOT change tiebreakers (`tieUtils.js` parity with `services/playoffs.py`/`bracket.py` — invariant 4).

#### Scenario: Mismatch does not change pixels

- GIVEN a deliberate client/server standings mismatch
- WHEN the surface settles
- THEN client values are still rendered
- AND no indicator, badge, toast or copy appears

#### Scenario: Slow confirmation never blocks

- GIVEN the confirmation endpoint hangs
- WHEN the user edits scores
- THEN rendering continues at client speed
- AND no control is disabled by reconciliation

### Requirement: Confirmation is read-only with semantic comparison

Only `GET /predictions/{id}/standings/`, `/playoffs/` and `/knockout/` MAY be issued, with no new endpoint and no server write. Comparison MUST normalize ordering and formatting, report a mismatch only when compared positions or values differ semantically, and be a pure function testable without network.

#### Scenario: Reordered-but-equal is not a mismatch

- GIVEN the server returns the same rows in a different order
- WHEN comparison runs
- THEN no mismatch is logged
- AND the client render is untouched

#### Scenario: Real divergence is detected

- GIVEN the server places a team one position lower
- WHEN comparison runs
- THEN a mismatch is logged with both values

### Requirement: Bounded trigger frequency

The check MUST run at most once per surface per mount when a persisted prediction id exists, plus once after each successful bulk sync (`POST /predictions/{id}/sync/`, `POST /predictions/{id}/playoffs/sync/`), rate-limited to one check per surface per 30 seconds. It MUST NOT run per keystroke or per single match edit, MUST NOT poll on a timer, and MUST skip when no persisted prediction id exists.

#### Scenario: Typing does not trigger checks

- GIVEN a prediction under continuous editing
- WHEN 20 score edits occur within 30 seconds
- THEN at most one confirmation request per surface is issued
- AND no request fires per keystroke

#### Scenario: Local-only prediction

- GIVEN no prediction has been persisted, so no id exists
- WHEN the user edits scores
- THEN no confirmation request is made
- AND rendering is unchanged

### Requirement: Mismatches are silent to users, logged once

A detected mismatch MUST produce exactly one `console.warn` per occurrence with surface, endpoint, client value, server value and status, and MUST NOT produce a user-facing indicator, `aria-live` announcement, analytics event, server report or persisted record.

#### Scenario: Log content

- GIVEN a detected standings mismatch
- WHEN the log is inspected
- THEN it names the surface and both values
- AND nothing was written to storage or the server

### Requirement: Offline degradation is a no-op

On network failure, timeout, 502 or any non-2xx, the client MUST keep rendering its own computed results, MUST NOT surface any reconciliation error to users, MUST log at most one warning, and MUST NOT retry within the same computed revision — the next natural trigger retries. No queue, buffer or persistence of reconciliation results is allowed, and this MUST stay independent of the live-score 502 contract (invariant 5).

#### Scenario: 502 during confirmation

- GIVEN `/predictions/{id}/standings/` returns 502
- WHEN the surface settles
- THEN standings render from client values
- AND the only trace is one warning log

#### Scenario: Offline then reconnected

- GIVEN the browser is offline
- WHEN the check fires, then connectivity returns and the next trigger runs
- THEN the offline attempt rendered normally with one warning
- AND the later trigger retries once

### Requirement: Protected storage keys stay untouched

Reconciliation MUST NOT read or write `champions_draw_prediction_{season}_{player}`, `champions_draw_real_prediction_*` or `champions_draw_career_v1`; this change assumes keys unchanged, so no migration is introduced (invariant 3).

#### Scenario: Storage untouched

- GIVEN a completed reconciliation cycle
- WHEN storage is inspected
- THEN the three keys hold their prior shapes
- AND no reconciliation key exists

## Open Questions

- Whether confirmation responses may be cached in memory between mounts — MUST be decided in design; apply MUST NOT invent a caching layer.
