# App Shell Specification

## Purpose

One shell hosts all five top-level views and the workspace tabs, with a navigation model that stays operable at every breakpoint — including below the width where `.site-nav` is `display:none` (styles.css:1760-1763).

## Requirements

### Requirement: All views render inside one shell

`home`, `teams`, `career`, `real` and `workspace` (state-based `view` in `App`, main.jsx:900) MUST render inside a single shell that owns chrome. No view MUST render competing page-level chrome; `CareerApp.jsx:123` MUST become a shell view.

#### Scenario: Each view exposes shell nav

- GIVEN any of the five views is active
- WHEN the shell renders
- THEN top-level nav is present and marks the current view
- AND no view-specific wrapper hides or duplicates it

#### Scenario: View state survives a shell re-render

- GIVEN the user is on `workspace`
- WHEN the shell re-renders for a theme change
- THEN `view` and `activeTab` are unchanged

### Requirement: View switching operates at every breakpoint

Below the shell's navigation breakpoint — where `.site-nav` is hidden with `.app-main{margin-left:0}` and no replacement exists (styles.css:1760-1763) — an operable affordance MUST expose all five top-level views and all six workspace tabs (`ViewTabs`, main.jsx:1443: simulate, predict, matchdays, pots, teams, history).

#### Scenario: Switch views below the breakpoint

- GIVEN a 390px viewport
- WHEN the user opens mobile navigation and selects `teams`
- THEN `TeamsBrowser` renders
- AND dismissing the nav does not change view

#### Scenario: Workspace tabs on mobile

- GIVEN a 390px viewport on `workspace`
- WHEN the user opens navigation
- THEN all six tabs are listed and selectable
- AND the active tab is marked non-color-only

### Requirement: One declarative breakpoint scale

The shell's breakpoints MUST be declared in one place, the shell navigation mode MUST use exactly one threshold, and every `@media` width in styles.css MUST be a member of the declared set (today: inconsistent 1120/920/760/640). Exact values are open.

#### Scenario: No stray breakpoint

- GIVEN the declared breakpoint set
- WHEN every `@media` width in styles.css is extracted
- THEN each value is in the set
- AND the navigation threshold appears once

#### Scenario: Crossing the threshold preserves state

- GIVEN the user is on `workspace` with an active tab, scrolled
- WHEN the viewport shrinks below the threshold
- THEN the same view and tab render
- AND navigation remains operable

### Requirement: Navigation is keyboard-operable and not color-only

Active nav items MUST carry `aria-current` plus a non-color indicator (Design.md §6); items MUST be reachable and activatable by keyboard using the shared focus token.

#### Scenario: Keyboard-only navigation

- GIVEN focus on the first nav item
- WHEN the user tabs to another item and presses Enter
- THEN that view renders and is marked active
- AND the active marker is perceivable without color

### Requirement: Shell preserves draw and polling invariants

The shell MUST NOT alter the z3 draw POST path, the reveal state machine (`revealStart`/`revealSession`/`pendingFinalize`, main.jsx:1553-1582), the live-score cadence (60s hub refresh, main.jsx:957-961; 30s live poll, 965-980) or the 502 contract.

#### Scenario: Navigation during an active reveal

- GIVEN a draw reveal is in progress
- WHEN the user opens and closes mobile navigation
- THEN the reveal continues in the same state
- AND no extra draw request is issued

#### Scenario: Poll cadence unchanged

- GIVEN the live hub is open
- WHEN navigation mode changes across the breakpoint
- THEN the 60s refresh and 30s poll keep their cadence
- AND no duplicate poller starts

## Open Questions

- Mobile navigation visual form (drawer, bottom bar, or both) — Design.md §18. MUST be decided in design; apply MUST NOT invent it.
- Sidebar navigation labels — Design.md §6/§18.
- Dashboard/home composition — Design.md §8.1/§18.
- Exact breakpoint values and sidebar width — Design.md §5.1/§15.
