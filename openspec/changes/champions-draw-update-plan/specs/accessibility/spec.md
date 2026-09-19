# Accessibility Specification

## Purpose

WCAG AA in both themes, keyboard-complete interaction, ≥44px targets, labelled inputs and non-color status.

## Requirements

### Requirement: 44px minimum touch targets

Every interactive control MUST expose at least a 44×44 CSS px hit area. Current offenders MUST be raised: `.md-dot` 32, `button`/`select` 38, `.view-tabs` 32, `.score-input` 34, knockout `ScoreInput` 22, `.hub-open-match` 28, `.picked-chip` ~26.

#### Scenario: Target audit at mobile width

- GIVEN every interactive element in each view
- WHEN measured at a 390px viewport
- THEN each is ≥44×44
- AND no control is reachable only by its text glyph box

### Requirement: Labelled form controls

Every input MUST have a programmatic accessible name (Design.md §10). `ScoreInput.jsx` inputs, which have none today, MUST gain one; `.md-dot` MUST NOT rely on `title` alone.

#### Scenario: Score input name

- GIVEN a `ScoreInput` rendered for a fixture
- WHEN its accessible name is queried
- THEN it names the team and match
- AND the label is visible or visually hidden but present

### Requirement: Status is never color-only

Status MUST carry a text or icon cue in addition to color (Design.md §2, §7.7). `.status-dot` in `PlayersRuns`, a bare colored dot today, MUST gain a cue.

#### Scenario: Status dot

- GIVEN a player row with a non-default status
- WHEN the row renders
- THEN text or icon states the status
- AND it stays distinguishable in monochrome

### Requirement: AA contrast in both themes

Body text MUST meet 4.5:1 and large text 3:1 in light and dark, including the estimated failures: `--muted #718096` on white ≈4.0:1, white on `--warning #f4a340` ≈2.1:1, white on `--green-primary #20b26b` ≈2.8:1 at 11px pills. Status pill text MUST meet 4.5:1 and pill UI 3:1; verification MUST be computed, not estimated.

#### Scenario: Both-theme contrast pass

- GIVEN the token pairings used by text, pills and controls
- WHEN contrast is computed per theme
- THEN each meets its threshold
- AND none passes in only one theme

### Requirement: Keyboard reachability and visible focus

Every interactive element MUST be reachable and operable by keyboard with no trap, and a token-based visible focus indicator MUST remain everywhere — the global `:focus-visible` rule (styles.css:1843) MUST survive. `tabIndex=0` click handlers such as `HomeMatchCard` (main.jsx:169) MUST become real buttons/links with an accessible name.

#### Scenario: Full keyboard pass

- GIVEN a keyboard-only user on each view
- WHEN every control is tabbed to
- THEN focus is always visible
- AND activation works with Enter/Space

#### Scenario: Card behaves as a control

- GIVEN the home match card
- WHEN focused
- THEN it reports as a button/link with a name
- AND Enter opens the match detail

### Requirement: Skip link and landmark structure

The first focusable element MUST be a skip link to main content (absent today), and the shell MUST expose navigation and main landmarks with one `h1`-leading heading order per view.

#### Scenario: Skip link

- GIVEN the app loaded at the top
- WHEN the user presses Tab once
- THEN the skip link appears
- AND activating it moves focus into main content

### Requirement: Dialog semantics and focus return

The match-detail overlay MUST be a named dialog, close on Escape, keep background content non-focusable while open, and return focus to the opening element on close (invariant 6: `detailReturnFocusRef` and the `hidden` app wrapper, main.jsx:1138, MUST keep working inside the new shell).

#### Scenario: Focus returns and background is sealed

- GIVEN focus on a match row
- WHEN the overlay opens, the user tabs, then closes it with Escape
- THEN focus never leaves the overlay while open
- AND it returns to that row on close

### Requirement: Reduced motion and existing baseline preserved

New motion — drawers, theme transition, reveals — MUST have a `prefers-reduced-motion: reduce` alternative (Design.md §13; existing block styles.css:3657), and existing `aria-pressed` / `role="status"` / `aria-busy` usage MUST NOT regress.

#### Scenario: Reduced motion

- GIVEN `prefers-reduced-motion: reduce`
- WHEN the mobile navigation opens
- THEN it appears without a motion transition
- AND the baseline aria attributes still reflect real state

## Open Questions

- Focus-indicator visual treatment and contrast against each surface — Design.md §12; MUST be decided in design.
