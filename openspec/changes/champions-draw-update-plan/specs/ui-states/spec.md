# UI States Specification

## Purpose

Every network-backed surface exposes loading, empty, error and success. No fetch failure stays swallowed.

## Requirements

### Requirement: Four-state contract per data surface

Every surface below MUST render loading, empty, error and success (Design.md §11).
| Surface | Fetch site | Today |
|---|---|---|
| Home live-score hub | main.jsx:949, 957, 965 | no loading; 953, 973 swallowed |
| Leagues, per-league standings/fixtures | main.jsx:984, 357, 697, 358, 706 | no first-load skeleton; 699, 708 swallowed |
| Seasons, workspace state | main.jsx:1022, 1039, 671 | 367, 984 swallowed |
| Group standings | main.jsx:672 | StateMessage present |
| Match detail | MatchDetailView.jsx:45, 68 | skeleton 96-103; error collapsed |
| Real fixtures/predictions | RealDrawView.jsx:80, 98, 126, 172 | static "unavailable", no retry (263-264) |
| Prediction create/sync | PredictionApp.jsx:92, 148, 172 | no POST loading; 120 swallowed |
| Draw generate | main.jsx:1066 | reveal states only; no failure copy |
| Interactive pick | main.jsx:1607 | error swallowed |

#### Scenario: State matrix coverage

- GIVEN each surface above
- WHEN its request is pending, empty, failing and succeeding
- THEN all four states render
- AND each state has a test

### Requirement: No silent failure

Every currently swallowing `catch` MUST render an error state naming what failed and offering retry when retryable (Design.md §11): `main.jsx:367, 699, 708, 953, 973, 984` and `PredictionApp.jsx:120`, plus `RealDrawView.jsx:263-264`, which MUST stop collapsing errors into a static label.

#### Scenario: Fixtures request fails

- GIVEN `/ui/seasons/{id}/real-fixtures/` returns 500
- WHEN the real view settles
- THEN copy states fixtures could not load
- AND a retry control re-issues only that request

#### Scenario: Retry succeeds without duplicates

- GIVEN the failing fixtures request
- WHEN the user retries and it succeeds
- THEN fixtures render once
- AND the error state clears

### Requirement: Loading preserves layout, never a full-page spinner

Loading MUST use skeletons/placeholders at settled dimensions (Design.md §11) and set `aria-busy` on the loading region. The homepage (renders empty state mid-fetch), `TeamsBrowser` initial fetch and the `PredictionApp` POST MUST gain loading states.

#### Scenario: Homepage skeleton

- GIVEN the homepage matches request is pending
- WHEN the surface renders
- THEN a placeholder occupies the final row dimensions
- AND no "empty" copy shows

### Requirement: Empty states explain and offer a next action

Empty MUST state why there is no data and provide a useful action (Design.md §11); a blank region MUST NOT be the empty state.

#### Scenario: No leagues imported

- GIVEN `/leagues/` returns an empty list
- WHEN the surface renders
- THEN copy explains nothing is imported yet
- AND an action leads to the next step

### Requirement: Error writing and in-flight controls

Errors MUST follow what-failed / retryable / safe-reference (Design.md §11); entered values MUST survive a failed submit (Design.md §10); controls that would duplicate an in-flight write MUST be disabled meanwhile.

#### Scenario: Sync fails after typing

- GIVEN the user entered match scores
- WHEN a sync request fails
- THEN scores remain in the inputs
- AND the error copy allows retry

### Requirement: Success and live refresh do not disturb the user

Settled data MUST replace the placeholder without layout jump, and the live-score cadence (60s hub, main.jsx:957-961; 30s poll, 965-980) MUST NOT reset scroll, close the match-detail overlay, or move focus.

#### Scenario: Live poll during scroll

- GIVEN the user is scrolled on the hub, overlay closed
- WHEN the 30s poll returns new scores
- THEN scores update in place
- AND scroll position and focus are unchanged

### Requirement: Polling preserves the 502 contract

A live-score 502 MUST keep its existing handling and surface only as the live-score error state; it MUST NOT be swallowed or escalated to a blocking page error.

#### Scenario: Live scores 502

- GIVEN `/ui/seasons/{id}/live-scores/` returns 502
- WHEN the poll settles
- THEN the live region shows its error state
- AND the rest of the page stays usable
### Requirement: Async updates are announced

Async status transitions MUST use `aria-live` (Design.md §12) so loading→error and loading→success are announced.

#### Scenario: Screen-reader announcement

- GIVEN a pending request inside a live region
- WHEN it fails
- THEN the error is announced
- AND existing `role="status"` usage is preserved

## Open Questions

- Per-surface skeleton vs spinner vocabulary and component states — Design.md §11/§18.