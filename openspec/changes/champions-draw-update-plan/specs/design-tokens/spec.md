# Design Tokens Specification

## Purpose

One token layer is the only source of visual values: a complete light set on `:root` (styles.css:1-30 today) and a complete dark set under `[data-theme="dark"]`, which does not exist yet.

## Requirements

### Requirement: Dual-theme token layer

Every visual value MUST be a CSS custom property defined in both `:root` (light) and `[data-theme="dark"]`, or declared once if theme-invariant. No rule MAY consume a token undefined in either theme. Styling MUST stay plain CSS custom properties — no new styling dependency.

#### Scenario: Dark theme resolves every token

- GIVEN the root element carries `data-theme="dark"`
- WHEN every token referenced in styles.css is read via `getComputedStyle`
- THEN each resolves to a non-empty value
- AND no rule depends on a light-only value

#### Scenario: Light stays the default

- GIVEN no theme has been chosen
- WHEN the app loads
- THEN light tokens render
- AND no dark value leaks in

### Requirement: Theme switch

A user-operable control MUST switch themes, persist the choice across reloads, and apply before first paint so no wrong-theme flash occurs. The persistence key MUST NOT be `champions_draw_prediction_{season}_{player}`, `champions_draw_real_prediction_*` or `champions_draw_career_v1`.

#### Scenario: Persisted theme

- GIVEN the user selects dark
- WHEN the app reloads
- THEN dark tokens apply from first paint
- AND the switch shows dark as selected

#### Scenario: Keyboard-operable

- GIVEN focus reaches the switch
- WHEN activated via keyboard
- THEN the theme toggles and focus stays on the switch

### Requirement: No visual literals outside the token layer

Every color, radius, shadow, spacing, font-size and z-index MUST reference a token. This covers the >100 hex literals outside `:root`, verdict palettes (styles.css:1194-1206, 1421-1423, 1604-1606), live/final badges (1645, 3479-3481), inspector values (755-768, 857-876), hardcoded focus rings `rgba(21,92,255,…)` (113, 1117, 1846, 3610, 3653), inline `style={{}}` values, and the private share palette (sharePredictionsImage.js:17-20), which MUST read token values.

#### Scenario: Literal scan is clean

- GIVEN the styled sources
- WHEN color/radius/shadow literals are scanned outside the token blocks
- THEN zero remain
- AND the share-image palette matches shell tokens

### Requirement: Complete scales

The system MUST define a spacing scale, a radius scale (replacing today's 4→999px spread where cards use 20px against a 12px `--radius`), a shadow scale, a type scale with weights, and a semantic z-index scale with no arbitrary 999/9999. Every such literal MUST be a scale member.

#### Scenario: Primitives consume scale steps

- GIVEN any card, button, table cell or badge
- WHEN its padding, radius and elevation are inspected
- THEN each maps to a declared step

### Requirement: AA contrast in both themes

Every text/status/control token pairing MUST meet WCAG AA in both themes: 4.5:1 body text, 3:1 large text and non-text UI. Known failures MUST be fixed at token level: `--muted #718096` on white ≈4.0:1, white on `--warning #f4a340` ≈2.1:1, white on `--green-primary #20b26b` ≈2.8:1 at 11px pill size.

#### Scenario: Contrast matrix

- GIVEN every foreground/background token pair used in the app
- WHEN contrast is computed in light and dark
- THEN each meets its threshold
- AND no status pill uses a sub-3:1 pair

### Requirement: Dead CSS and banned decoration removed

Every stylesheet rule MUST be reachable from markup or be removed. Explicitly dead: `.homepage-shell`, `.landing*`, `.auth-callout`, `.workspace-home-button`, `.product-hub*`, `.product-grid`, `.product-card*` and their media queries (styles.css:59-64, 117-164, 248-275, 1854-2035, 3023-3095). The `.product-card-career` `repeating-linear-gradient` stripe MUST be removed, not carried.

#### Scenario: Dead selector scan

- GIVEN class names in styles.css
- WHEN cross-referenced against markup and JS
- THEN dead families are gone
- AND no repeating-gradient stripe remains

## Open Questions

- Primary accent color — Design.md §18.
- Fonts and font files — Design.md §18.
- Icon library — Design.md §18.
- Spacing and radius scale values — Design.md §18/§15.
