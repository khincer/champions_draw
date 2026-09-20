# Proposal: Champions Draw — UI/UX Update

## Intent

A 1,926-line `main.jsx`, 3,666-line stylesheet (~30–40% dead CSS), ~7 crest renderers, 5 standings tables, 5 fixture rows, 4 segment controls, >100 hardcoded hex values, silently swallowed fetch errors, sub-44px targets, likely contrast failures on status pills. `.site-nav` is `display:none` below 760px: mobile navigation is impossible.

## Scope

**In**
- Token scale (light + dark); literals replaced by tokens; dead CSS removed.
- A working theme switch delivering both themes.
- Unified app shell; mobile navigation model.
- Shared UI primitives replacing duplicated markup.
- Loading/empty/error/success states; errors surfaced.
- Accessibility: contrast, 44px targets, labels, focus, non-color status.
- Career in the unified shell (fully neutral); `champions_draw_career_v1` untouched.
- Reconciliation of client standings/playoffs/knockout against existing endpoints (silent to users, logged).

**Non-goals**
- Career engine, rules, storage contract.
- Prediction calc, tiebreakers, z3 solver.
- API changes (endpoints stay read-only); i18n.
- Dead API surface (endpoints with no frontend caller) — tracked as a separate cleanup change.

## Capabilities

New (no existing specs): `app-shell`, `design-tokens`, `ui-components`, `ui-states`, `accessibility`, `career-shell-integration`, `prediction-reconciliation`. Modified: None.

## Approach

Foundations first:

1. `:root` token scale (light + dark) and the theme switch; shell; mobile navigation model replacing dead `.site-nav`; dead-CSS removal.
2. Move `groupBy` out of `main.jsx` (breaks decomposition), then collapse duplicated markup into primitives.
3. State contract applied; swallowed fetch errors surfaced.
4. `--career-*` tokens replaced by shell tokens (fully neutral: no retained career accent).
5. Reconciliation check added.

Tokens stay CSS custom properties (no new styling dependency). Reconciliation never gates rendering: the client stays the source of truth; endpoints only confirm, and mismatches are logged without any user-facing indicator.

## Invariants

| # | Invariant |
|---|---|
| 1 | z3 draw POST + reveal `summary` shape |
| 2 | Reveal state machine (`revealStart`/`revealSession`/`pendingFinalize`) |
| 3 | Prediction storage keys/shapes; rename needs migration |
| 4 | Tiebreaker parity with `services/playoffs.py`/`bracket.py` |
| 5 | Live-score polling + 502 contract |
| 6 | Match-detail focus return |

## Assumptions & Open Questions

- **Theme — RESOLVED**: ship light **and** dark with a working switch. Both Design.md §3.1 (dark foundation) and §3.2 (light tokens) are honored; the contradiction is settled as "both", not "either".
- **Reconciliation — RESOLVED (visibility)**: mismatches are silent to users and logged only, with no indicator. Trigger frequency and offline degradation remain spec-phase decisions.
- **Career identity — RESOLVED**: fully neutral shell, no retained career accent. The `--career-*` migration path remains a spec-phase decision.
- **Dead API surface — RESOLVED**: out of scope here; tracked as a separate cleanup change.
- Design.md §18's remaining unresolved items MUST be flagged in specs (accent, fonts, sidebar labels, dashboard composition, charts, mobile nav, component states, icons, spacing/radius).
- Storage keys assumed unchanged: no migration here.
- `static/ui/` is checked build output; UI changes stay invisible until `npm run build`.
- No `openspec/config.yaml`, so no project proposal rules applied.

**Size**: exceeds the 400-line budget, and shipping both themes widens it further; split vs `size:exception` decided at `sdd-tasks`.

## Affected Areas

`frontend/src/{main.jsx,styles.css,*.jsx}` Modified; `frontend/src/lib/**` New; `draw/predictions_views.py` Read-only; `standingsCalc.js`/`tieUtils.js` Unchanged.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `groupBy` cycle breaks extraction | High | Move it first |
| Client/API divergence | Med | One source; report only |
| Surfaced errors read as regressions | Med | Intended |
| Design.md ambiguity leaks values | High | Specs flag them |
| Dark theme widens token + verification surface | Med | Single token definition; contrast verified in both themes |

## Rollback Plan

Revert the commits. No schema, storage-key, or API change is in scope: no data-migration component; predictions and career data stay loadable.

## Success Criteria

- [ ] No duplicated implementations, no color literals outside tokens, dead CSS removed.
- [ ] Light and dark themes both render correctly via a working switch, with AA contrast in both.
- [ ] Navigation works at every breakpoint, including below 760px.
- [ ] Every data surface has loading/empty/error states; no silent failure.
- [ ] Touch targets ≥44px; status contrast meets WCAG AA.
- [ ] Career renders in the shell with engine/storage untouched.
- [ ] All six invariants verified unchanged.
