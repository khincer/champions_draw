# Design: Champions Draw — UI/UX Update

## Technical Approach

Foundations-first: tokens + theme + shell + mobile nav → `groupBy` → primitives → state contract → career re-host → reconciliation. No new dependency; tokens stay CSS custom properties.

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Breakpoints | `1120 / 920 / 760 / 640`; shell nav threshold **920**; sidebar **240px** | All four are existing `@media` members — no rule retunes; 920 ≈ §5.2's "~900px"; 240px is inside §5.1's range; CSS-driven, so crossing cannot remount a view. |
| Mobile nav | **Bottom bar (5 views) + `<dialog>` drawer (5 views + 6 workspace tabs)** | §5.2 allows both; a bar cannot hold six tabs at 44px; `<dialog>` gives trap, Escape and backdrop. Rejected: bar-only, drawer-only. |
| Primary accent | `--color-primary: #20b26b`, fills carry **ink `#142033`**; `#4d7cff` = info | §3.1/§3.2; white on green ≈2.8:1, ink 5.95:1. |
| Type and icons | Inter 400/500/600/700: display 32 / h1 28 / h2 22 / h3 17 / body 15 / small 13 / label 11, tabular numerals; `lucide-preact@0.468` | §4 scale already linked; lucide is already a dependency with three importers. |
| Scales | space `4/8/12/16/20/24/32/40/48/64`; radius `4/6/8/12/16/pill` (cards 12); shadow `--sh-1..3`; z `0/10/40/50/60/70/80/90` | §5.1 card radius; no arbitrary z, no border+wide-shadow pairs. |
| Theme | `<head>` script writes `data-theme` from **`champions_draw_theme`** pre-paint; light default; sets `color-scheme` | Persisted and flash-free; key collides with no protected key. |
| Focus | `outline: 2px solid var(--focus-ring-color)` + 2px offset (`--info`) | Replaces five hardcoded rings; 3.7:1 light, 4.8:1 dark; offset clears the green fill. |
| Charts | **None** — tables and proportional bars are the viz | YAGNI. **ESCALATE**. |
| Reconcile cache | Module `Map<surface,{response,at}>`, 30s TTL, cleared on bulk sync, memory only | Collapses tab-switch mount churn; never post-sync stale. |
| Career treatment | No accent, **no distinct surface treatment** | "Fully neutral" is settled. |

## Data Flow

Tokens drive every rule and the share canvas from the head script's `data-theme`. Reconciliation is observe-only: silent on agreement, one warning otherwise, never in the render path or disabling a control.

## File Changes

| File | Action | Description |
|---|---|---|
| `frontend/index.html` | Modify | Pre-paint theme script. |
| `frontend/src/styles.css` | Modify | Light `:root` + `[data-theme="dark"]`; all scales; ink-on-pill status colors; `--focus-ring-color`; `--career-*` (2039-2048) deleted; dead CSS removed. |
| `frontend/src/main.jsx` | Modify | Keeps `App` (900) + `render` (1926). |
| `frontend/src/lib/{groupBy,api,format,teams,theme,reconcile}.js` | Create | `groupBy` verbatim first; helpers (43-65, 76-101, 311-317, 536). |
| `frontend/src/components/**` | Create | Crest, Button, Badge, Metric, SegmentControl, StandingsTable, FixtureRow, states. |
| `frontend/src/views/**` | Create | Homepage, TeamsBrowser, TeamPage, workspace panels, InteractiveDraft. |
| `frontend/src/*.jsx` (9 views) | Modify | Adopt primitives, tokens, labels, states. |
| `frontend/src/sharePredictionsImage.js` | Modify | Palette (17-20) reads tokens. |
| `standingsCalc.js`, `tieUtils.js`, `predictionStorage.js`, `careerEngine.mjs`, `careerClubs.json` | Unchanged | Invariants 3, 4. |

**Decomposition order (prerequisite):** (1) `groupBy` (main.jsx:67) → `lib/`, repointing `RealDrawView.jsx:3`, `MatchdayScoreBoard.jsx:1`, `main.jsx:1131` — cycle broken; (2) remaining helpers; (3) primitives in dependency order (Crest → Button/Badge/Metric → SegmentControl → StandingsTable/FixtureRow → states); (4) views leaf-most first; (5) `main.jsx` as composition root. No view imports from `main.jsx`.

## Interfaces / Contracts

- `lib/reconcile.js` (pure): `compareStandings|Playoffs|Knockout(client, server) → {ok, mismatches:[{key, clientValue, serverValue}]}`; keys = team id, tie pair, round+slot; order- and format-insensitive.
- `lib/theme.js`: `getTheme/setTheme/applyTheme` over `champions_draw_theme`.
- `useReconciliation(surface, {predictionId, endpoint, clientValue, revision})`: mount-once + post-sync triggers, 30s per-surface limit, no-op without `predictionId`, one `console.warn` per mismatch, no retry within a revision.
- State contract: each fetch site owns `{status, error, retry}` and renders via the state primitives — skeletons at settled dimensions (`aria-busy`), errors naming the failure + per-request retry, empties with a next action, success without layout jump, poll updates in place.

## Testing Strategy

UI verification requires `npm run build` (Django serves `static/ui/`).

| Layer | How |
|---|---|
| Unit | `node --test frontend/src/lib/reconcile.test.mjs` — reorder, divergence, missing rows, format drift; `groupBy` unchanged |
| Contract | `python manage.py test` — draw POST + `summary`, endpoints |
| Career | `npm run test:career` — engine untouched |
| Static | Scans + computed styles — token-only literals, `@media` widths in the scale, both-theme contrast, dead selectors |
| Manual | Browser after build — 390/920/1120/1440, keyboard, drawer trap, focus return, themes |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR or process boundary.

## Migration / Rollout

No migration: no schema, storage-key or API change; steps revert independently.

## Open Questions

None — all three escalations were resolved by the human on 2026-09-17:

- [x] Home composition — **CONFIRMED as designed**: greeting + metric cards + live hub + quick actions; no charts, no recent-draw section.
- [x] Mobile navigation — **CONFIRMED as designed**: bottom bar (5 views) + `<dialog>` drawer (5 views + 6 workspace tabs).
- [x] Light `--muted` → `#5b6b82` — **CONFIRMED** (4.0:1 → 5.4:1).

No open questions remain for tasks/apply.

## Correction carried from the design gatekeeper

`package.json` lives at the **repo root** (`package.json`), not `frontend/package.json`; `frontend/` contains only `index.html` and `src/`. `npm run build` and `npm run test:career` run from the repo root (`vite.config.js` is also at the root).

## Confirmed derived values (Phase 1)

Design.md §3.2 defines dark values for only 6 tokens. The six below were derived during Phase 1 and **confirmed by the maintainer on 2026-09-17** — they are binding for the remaining batches, and they are the only values in the change not traceable to a closed design value:

| Token | Dark value |
|---|---|
| `--line-strong` | `#627083` |
| `--blue-dark` | `#9ab5fe` |
| `--soft-blue` | `#131b30` |
| `--soft-green` | `#122a1e` |
| `--soft-red` | `#2b171c` |
| `--sh-color` | `rgba(0,0,0,0.5)` |

Phase 1 also adopted, as required by the AA scenarios: ink `#142033` on status fills via `--status-ink` (consumed by `.button.primary`, `.hub-status`, `.live-dot`), and removed all four `repeating-linear-gradient` stripes (three were inside live `.career-*` rules).
