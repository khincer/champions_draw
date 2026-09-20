# UI Components Specification

## Purpose

One implementation per presentational concept — crest, standings table, fixture row, segment control, metric/badge/button primitives. Components render data; they never fetch or compute it.

## Requirements

### Requirement: Single crest/logo component

Exactly one crest component MUST render every team/competition mark, reusing the existing `TeamLogo` (main.jsx:1508)/`TeamBadge` (1498) base rather than adding a new one, with consistent sizing and an initials fallback (Design.md §7.4). Current renderers MUST collapse into it: `MatchDetailView` `Crest`, the `RealDrawView` local `TeamLogo` and raw span (RealDrawView.jsx:485), raw spans in `MatchdayScoreBoard`, `LeagueTable.jsx`, `PlayoffBracket.jsx`, `KnockoutBracket.jsx`, `PredictionApp.jsx:823`, and `CareerApp` `ClubLogo` (CareerApp.jsx:721).

#### Scenario: Uniform crest everywhere

- GIVEN every view that displays a team
- WHEN crest markup is inspected
- THEN each renders the single component
- AND the fallback is identical across views

#### Scenario: Missing image

- GIVEN a team without a crest URL
- WHEN its row renders
- THEN initials render at the component's size
- AND the accessible name still includes the team name

### Requirement: Single standings table

One component MUST render standings, replacing `LeagueTable.jsx:14-61`, `RealDrawView.jsx:460-506`, `PredictionApp.jsx:805-835`, `main.jsx:568-614` and `main.jsx:409-450/802-846`, and MUST own the row-qualified / row-playoffs / row-eliminated logic once. Ordering and numbers MUST match today's output.

#### Scenario: Qualification bands preserved

- GIVEN a standings set spanning positions 1, 9 and 30
- WHEN the shared table renders
- THEN each row carries its qualified/playoffs/eliminated marker
- AND each marker has a non-color cue

### Requirement: Single fixture/match row

One component MUST replace the five duplicated fixture/match rows, covering competition, kickoff, both teams with crests, score or time, and status (Design.md §7.5).

#### Scenario: Live vs scheduled row

- GIVEN one live and one scheduled fixture
- WHEN rows render
- THEN each shows status text, not color alone
- AND scores use tabular figures

### Requirement: Single segment/tab control

One keyboard-navigable control (Design.md §7.8) MUST replace `ViewTabs` (main.jsx:1443), the `PredictionApp` sub-tabs, `.segment-control` and `CareerApp` `.career-segmented`, and MUST expose selected state to assistive tech.

#### Scenario: Arrow-key tab change

- GIVEN focus inside the control
- WHEN the user presses an arrow key
- THEN selection moves and the panel updates
- AND the selected state is announced

### Requirement: Shared metric, badge and button primitives

Shared primitives MUST cover metric cards (Design.md §7.2), status badges (§7.7) and button variants (§7.9), with no duplicated one-off variants. The dead `Metric` at `main.jsx:1425` MUST be adopted as the primitive or deleted; it MUST NOT remain dead.

#### Scenario: Button state coverage

- GIVEN any primary/secondary/ghost/danger action
- WHEN rendered
- THEN hover, focus, active and disabled come from one definition
- AND disabled never relies on color alone

### Requirement: No banned decorative patterns

Primitives MUST NOT introduce side-stripe borders, gradient text, default glassmorphism, card radius above the radius scale ceiling, repeating-gradient stripe backgrounds, or a 1px border paired with a wide soft shadow (Design.md §3.1; impeccable absolute bans).

#### Scenario: New primitive review

- GIVEN a new primitive's CSS
- WHEN checked against the ban list
- THEN each banned construct is absent

### Requirement: Decomposition prerequisite and pure presentation

`groupBy` (main.jsx:67) MUST move to `frontend/src/lib/**` before any view is extracted, because `RealDrawView.jsx:3` and `MatchdayScoreBoard.jsx:1` import it from `main.jsx` (cycle). Its behavior MUST be unchanged with one exported definition. Primitives MUST NOT fetch, sync or compute standings/playoffs/knockout.

#### Scenario: No cycle after extraction

- GIVEN views imported outside `main.jsx`
- WHEN module dependencies are inspected
- THEN no view imports from `main.jsx`
- AND `groupBy` resolves from `lib/**`

#### Scenario: Primitive stays presentational

- GIVEN a primitive rendered in isolation with fixtures
- WHEN it renders
- THEN no network call is made
- AND it imports no computation module

## Open Questions

- Existing component states (hover/focus/active/disabled specifics) — Design.md §18.
- Icon library — Design.md §18.
