# Career Shell Integration Specification

## Purpose

Career becomes a view inside the unified shell using shell tokens only. The career engine and its storage stay untouched.

## Requirements

### Requirement: Career renders inside the unified shell

`CareerApp.jsx:123` MUST render as a shell view with the shared navigation, and MUST NOT keep competing `.career-app-shell` chrome (own top bar, sidebar or hero wrapper). All four surfaces MUST stay reachable: intro (238), IdentityBuilder (268), Dashboard (429), Summary (618).

#### Scenario: Shell nav on career

- GIVEN the user is on career
- WHEN the shell renders
- THEN top-level nav is present with career marked active
- AND no career-specific page chrome duplicates it

#### Scenario: All four surfaces reachable

- GIVEN a career flow in progress
- WHEN the user visits intro, IdentityBuilder, Dashboard and Summary
- THEN each renders inside the shell
- AND none becomes unreachable after the redesign

### Requirement: Fully neutral palette via hard replacement

The `--career-*` definitions (styles.css:2039-2048) MUST be removed and every `.career-*` rule MUST consume shell tokens; no compatibility aliases MUST remain. No gold/navy career accent MUST survive on any career surface, including summary or share output. The migration path is hard replacement, not aliasing.

#### Scenario: Token scan

- GIVEN styles.css and career components
- WHEN career-prefixed tokens and gold/navy literals are scanned
- THEN none remain
- AND career visuals resolve from shell tokens

#### Scenario: Dark theme career

- GIVEN `data-theme="dark"`
- WHEN each career surface renders
- THEN it matches the shell's dark tokens
- AND no light-only surface remains

### Requirement: Engine and storage untouched

`careerEngine.mjs`, `careerClubs.json`, the `champions_draw_career_v1` key and all stored career shapes MUST be unchanged (non-goal). No new career persistence key MUST be introduced, and career MUST NOT write to any other key.

#### Scenario: Legacy career loads

- GIVEN localStorage holds a `champions_draw_career_v1` payload written by the current build
- WHEN the app loads the new shell
- THEN the same career state is restored
- AND no migration prompt or data reset occurs

#### Scenario: No writes outside the key

- GIVEN a user plays a career season
- WHEN storage is inspected
- THEN only `champions_draw_career_v1` changes for career
- AND no career value is persisted elsewhere

### Requirement: Career consumes shared primitives

Career MUST use the shared crest component (`ClubLogo`, `CareerApp.jsx:721` retires), the shared segment control (`.career-segmented` retires) and the shared metric/badge/button primitives. `CareerApp`'s live `Metric` (489) MUST NOT be deleted, only re-based on the shared primitive.

#### Scenario: No career-only primitives

- GIVEN career components
- WHEN their imports are inspected
- THEN crest, segment control and metric resolve to shared primitives
- AND career-local duplicates are gone

### Requirement: Career state survives the navigation redesign

Switching views through the shell or mobile navigation MUST NOT reset career state or interrupt an in-progress identity build, and career MUST stay reachable at every breakpoint.

#### Scenario: Cross-view navigation

- GIVEN a half-filled identity build
- WHEN the user navigates to home and back to career
- THEN entered fields are intact
- AND navigation triggered no career write

## Open Questions

- Career dashboard composition and whether it adopts metric cards or charts — Design.md §8.1/§18.
- Whether career keeps a distinguishing surface treatment now that it has no accent — Design.md §3.1/§18; MUST be decided in design.
