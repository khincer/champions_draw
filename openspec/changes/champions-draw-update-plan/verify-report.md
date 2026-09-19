```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:504b734dba0e77a4cc5848c02fecf12b06071af72be896e287af0c17a9e96614
verdict: fail
blockers: 0
critical_findings: 1
requirements: 43/45
scenarios: 60/62
test_command: .\.venv\Scripts\python manage.py test
test_exit_code: 0
test_output_hash: sha256:0608e17243128b666181961a2d3b3ee0cbecbfdd14bb0942f04d5293d76e6890
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:ff74f970d99ee290472147732da5719d75c295fdee4a47baf9d75504e078eec9
```

## Verification Report

**Change**: `champions-draw-update-plan` — Champions Draw UI/UX Update
**Version**: N/A
**Candidate under verification**: `dd05eb2609aa6b7928bc10331db8691a64ea3930` (`git rev-parse HEAD`; tree `4d025d2404800196db6df211e986228e9ff048cc`). `evidence_revision` above is `sha256("<full SHA>|<tree SHA>")`. Working tree clean at that commit.
**Mode**: Standard (Strict TDD **not** active — `strict_tdd` false, no runner)

### Method and independence

I read the proposal, all seven delta specs (independently counted **45 requirements / 62 scenarios**), the design, and all 40 tasks. I rebuilt the tracked bundle and byte-compared it, re-ran every suite, **executed the actor's harness driver myself** (`node frontend/harness/app-evidence.mjs <temp>`, observed run — never a stored output), and wrote and executed **my own 24-check probe** plus a markup-grounded button/badge audit and static scans. The prior report verified `620a04d`; it was read as a stale artifact to supersede — not as truth and not as an instruction. Nothing in the repository was written except this report.

**Instruments I executed (never a stored output):**

| Instrument | Scope | Observation |
|---|---|---|
| `node frontend/harness/app-evidence.mjs <temp>` | 32 scenarios incl. 126 s poll cadence | **32/32 pass**, exit 0 (`sha256:cd8bf528…d6867`) |
| my `<temp>/verify-probe.mjs` | 24 independent checks (harness gaps, carried findings, contrast matrix) | **22/24 pass**, exit 1; the 2 failures are the contrast matrix (`sha256:b27cbb97…bade`) |
| my `<temp>/btn-audit.mjs` | every class token on every real `<button>` + every badge/chip/pill, vs the space scale | **0 off-scale** (23 button tokens, 8 badge tokens) |
| my `<temp>/full-pad-scan.mjs` | every rule in `styles.css`, padding resolved | 65 off-scale padding declarations (all outside the four categories — see WARNING-1) |
| my `<temp>/static-scan.mjs` | literal / breakpoint / dead-CSS / import scans | all clean (details below) |
| `.\.venv\Scripts\python manage.py test` | Django / DRF contract | `Ran 100 tests` / `OK`, exit 0 |
| `npm run test:career` | career engine | `tests 3 / pass 3 / fail 0` |
| `node --test frontend/src/lib/reconcile.test.mjs` | reconciliation | `tests 11 / pass 11 / fail 0` |
| `node --test frontend/src/tieUtils.test.mjs` | tiebreakers | `tests 10 / pass 10 / fail 0` |

### Audit of the rewritten `DT.complete-scales` assertion (adversarial)

The prompt asked me to treat the harness's green as a claim and audit it with the technique that exposed the last two false greens: extract every class token from every `<button>` in the JSX, then test that class's rule against the scale.

- **Scale axis — sound.** The assertion reads `--space-*` and `--radius-*` from computed root and keeps them **separate**. In the run I executed: `space = {4,8,12,16,20,24,32,40,48,64}` (exactly the declared set), `radius = {2,3,4,6,8,10,12,16,20,999}`. Padding is validated against `space` only, radius against `radius` only. `offenderCount: 0`, `requiredMissing: []`, `targetRules: 163`, `categoryHits {table cell 25, button 32, card 32, badge 33, named 41}`.
- **Coverage axis — now sound for buttons and badges; I could not find a real `<button>` or badge the filter still misses.** My independent audit (`btn-audit.mjs`) parsed every `<button>` in `frontend/src` (23 distinct class tokens, incl. multi-line renders and template literals), resolved each class's padding rules in `styles.css`, and tested membership in the space scale: **0 off-scale**. It separately tested every element whose class contains `badge|chip|pill` (8 tokens): **0 off-scale**. The `NAMED` set (`.site-nav-link`, `.team-row`, `.career-*-action`, `.career-option`, `.back-button`, `.fx-verdict`, `.animated-team`, `.team-fixture-score`, `.match-detail-header`) now reaches the selectors the prior keyword filter skipped, and the class-token (not substring) matching correctly keeps `.animated-team` from swallowing `.animated-team-list`. **The prior CRITICAL-1 is genuinely closed.**
- **Residual gap — card-like surfaces whose class name lacks `card` are still not scanned** (`.summary-hero` 34px, `.identity-panel` 28px, `.career-event-panel` 26px, `.player-rating` 22px, `.retirement-panel` 42px 24px, `.league-table-wrap` 14px, `.message-bar` 12px 14px, `.match-detail-note` 14px 16px, `.command-band` 18px, `.inspector-head` 18px). See WARNING-1; I did **not** rest a failure on them (see adjudication item 1).

### What changed since the stale report

| Commit | Change | Verdict this run |
|---|---|---|
| `dd05eb2` | Ten off-scale padding declarations tokenised (the seven the prior report named + `.team-fixture-score`, `.animated-team-list`, `.match-detail-header`) + harness `DT.complete-scales` filter repaired + rebuilt `static/ui/` | Buttons/badges/cells/cards now on-scale and independently verified. The prior CRITICAL is closed. |
| `dd05eb2` | `styles.css` diff is 20 lines (10 declarations), `static/ui/index.html` + CSS/JS asset rename; no application logic changed | No invariant impact; the bundle reproduces byte-identically. |

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 40 |
| Tasks complete | 40 |
| Tasks incomplete | 0 |

All 40 tasks are `- [x]` (counted: 40 checked / 0 unchecked). Task completion is not requirement satisfaction — see the matrix.

### Build & Tests Execution

**Build**: ✅ exit 0 — `npm run build` (Vite 6.4.3, 1609 modules, 1.5 s) → `index.html` 1.30 kB, `index-DViqlGAz.js` 174.08 kB, `index-4CRPtfsM.css` 65.70 kB, `uefa-…-logo-DugNjAjF.svg` 12.92 kB. Captured output `sha256:ff74f970…eec9` (ANSI stripped).

**The committed bundle is NOT stale.** Before and after a fresh build the four tracked files are byte-identical and `git status --porcelain static/ui` is empty:

```text
static/ui/index.html                        3C384230… (before == after)
static/ui/assets/index-DViqlGAz.js          4BF905B9… (before == after)
static/ui/assets/index-4CRPtfsM.css         91BECFC6… (before == after)
static/ui/assets/uefa-…-logo-DugNjAjF.svg   FDF63322… (before == after)
```

**Tests**: ✅ all green (exit 0 each)

```text
.\.venv\Scripts\python manage.py test           -> Found 100 test(s) | Ran 100 tests in 37.549s | OK   (sha256:0608e172…6890)
npm run test:career                              -> tests 3  | pass 3  | fail 0
node --test frontend/src/lib/reconcile.test.mjs  -> tests 11 | pass 11 | fail 0
node --test frontend/src/tieUtils.test.mjs       -> tests 10 | pass 10 | fail 0
```

These are the three `node --test` suites present under `frontend/src` (inventory: `careerEngine.test.mjs`, `lib/reconcile.test.mjs`, `tieUtils.test.mjs`).

**Coverage tooling**: ➖ Not available — the project configures no coverage runner.

**Static scans** (my own; comments stripped, `:root` + `[data-theme="dark"]` blocks blanked for literal scans):

- colour literals outside token blocks **0**; `border-radius` px literals **0**; `box-shadow` literals **0**
- `repeating-linear-gradient` **0**; `background-clip: text` **0**; `backdrop-filter` **0**; `border-left/right` > 1px **0**
- `@media` widths `{640×2, 760×1, 920×1, 1120×1}` — all declared members; `920px` appears exactly once
- dead families (`.homepage-shell`, `.landing*`, `.auth-callout`, `.workspace-home-button`, `.product-hub*`, `.product-grid`, `.product-card*`) **0** in CSS and **0** in `src` (the only `landing` hit is the word inside a CSS comment)
- `--career-` definitions **0**; `--career-` references **0**; `CareerApp.jsx` imports `Crest`/`Metric`/`SegmentControl`, 0 `ClubLogo`, 0 `.career-segmented`
- no view imports `main.jsx`; `main.jsx` no longer exports `groupBy`; `groupBy` resolves from `lib/groupBy.js`
- `sharePredictionsImage.js` has **0** colour literals and reads token values
- undefined `var()` references: only `--delay` (set inline at `DrawAnimationStage.jsx:21`; resolves on the consuming `.animated-pot`)
- invariant files byte-identical to change base `e95c1a9`: `tieUtils.js`, `standingsCalc.js`, `predictionStorage.js`, `careerEngine.mjs`, `careerClubs.json`, `draw/services/playoffs.py`, `draw/services/bracket.py` (empty diff)

### Spec Compliance Matrix

Statuses: ✅ COMPLIANT · ❌ FAILING · ⚠️ PARTIAL · ❔ UNTESTED.
Evidence tags: **H** harness (my execution) · **P** my probe · **S** static scan · **U** `node --test` · **D** Django suite.
**Carried rows: none.** `dd05eb2` changed CSS, the harness and the bundle, so every row was re-driven.

| # | Requirement | Scenario | Evidence | Result |
|---|---|---|---|---|
| DT | Dual-theme token layer | Dark theme resolves every token | P: 100+ referenced tokens resolve under `data-theme="dark"`; only inline-scoped `--delay` is root-empty (resolves on its element) | ✅ COMPLIANT |
| DT | Dual-theme token layer | Light stays the default | P: fresh load `data-theme="light"`, `color-scheme: light`, `--bg #f5f7fb` | ✅ COMPLIANT |
| DT | Theme switch | Persisted theme | P: storage key → `data-theme="dark"` at `domcontentloaded` (pre-paint) and after settle | ✅ COMPLIANT |
| DT | Theme switch | Keyboard-operable | H: Enter toggled light→dark, focus stayed, `aria-pressed` false→true | ✅ COMPLIANT |
| DT | No visual literals outside the token layer | Literal scan is clean | S: colour 0, radius 0, shadow 0; share palette 0 literals and reads tokens | ✅ COMPLIANT |
| DT | Complete scales | Primitives consume scale steps | H: 163 rules, space scale exact, 0 offenders; S+P: 23 button tokens + 8 badge tokens all on-scale | ✅ COMPLIANT |
| DT | AA contrast in both themes | Contrast matrix | **P: FAILS.** `--green` on `--qualify-fill` 3.62:1 and `--muted` on `--navy` 3.03:1 — small text under 4.5:1 — see CRITICAL-1 | ❌ **FAILING** |
| DT | Dead CSS and banned decoration removed | Dead selector scan | S: dead families 0/0; `repeating-linear-gradient` 0 | ✅ COMPLIANT |
| AS | All views render inside one shell | Each view exposes shell nav | P: all 5 views → 1 visible `nav[aria-label=Primary]`, 1 `main`, 1 `h1`, `aria-current` matches | ✅ COMPLIANT |
| AS | All views render inside one shell | View state survives a shell re-render | P: theme toggle kept h1 "Draw workspace" and tab "Pots"; theme became dark | ✅ COMPLIANT |
| AS | View switching operates at every breakpoint | Switch views below the breakpoint | P: 5-item bar; drawer "Leagues" rendered the Leagues view; drawer closed | ✅ COMPLIANT |
| AS | View switching operates at every breakpoint | Workspace tabs on mobile | P: drawer lists 6 tabs; 1 active `aria-pressed=true` + `text-decoration: underline` | ✅ COMPLIANT |
| AS | One declarative breakpoint scale | No stray breakpoint | S: widths `{640,760,920,1120}`; `920px` once | ✅ COMPLIANT |
| AS | One declarative breakpoint scale | Crossing the threshold preserves state | H: 1440→390→1440 kept view + tab "Pots"; drawer 6 tabs | ✅ COMPLIANT |
| AS | Navigation is keyboard-operable and not color-only | Keyboard-only navigation | H: Tab→Enter to Real Draw, `aria-current="page"`, `::before` bar | ✅ COMPLIANT |
| AS | Shell preserves draw and polling invariants | Navigation during an active reveal | H: reveal continued across drawer open/close, 1 draw POST, 1 pick POST | ✅ COMPLIANT |
| AS | Shell preserves draw and polling invariants | Poll cadence unchanged | H (126 s): live gaps 30 s, hub gaps 60 s, `maxActive {30000:1, 60000:1}` | ✅ COMPLIANT |
| UC | Single crest/logo component | Uniform crest everywhere | P: all marks are `.team-logo` (`role=img`, named); 0 foreign crest classes | ✅ COMPLIANT |
| UC | Single crest/logo component | Missing image | P: `logo_url:''` → no `<img>`, initials render, `aria-label` carries the name, `role="img"` | ✅ COMPLIANT |
| UC | Single standings table | Qualification bands preserved | H: positions 1/9/30 → `row-qualified`/`row-playoffs`/`row-eliminated` + sr cues | ✅ COMPLIANT |
| UC | Single fixture/match row | Live vs scheduled row | P: status text present; scores `font-variant-numeric: tabular-nums`; 2 crests/row | ✅ COMPLIANT |
| UC | Single segment/tab control | Arrow-key tab change | P: ArrowRight moved selection, focus follows, `aria-pressed` | ✅ COMPLIANT |
| UC | Shared metric, badge and button primitives | Button state coverage | H: primary/secondary/ghost/danger respond to hover+active; disabled `dashed` + `not-allowed` | ✅ COMPLIANT |
| UC | No banned decorative patterns | New primitive review | S: 0 gradient text, 0 backdrop-filter, 0 side stripes, 0 repeating gradients | ✅ COMPLIANT |
| UC | Decomposition prerequisite and pure presentation | No cycle after extraction | S: 0 views import `main.jsx`; `groupBy` from `lib/groupBy.js` | ✅ COMPLIANT |
| UC | Decomposition prerequisite and pure presentation | Primitive stays presentational | H: 13 tables, 333 crests, 10 buttons rendered, `apiCalls: []` | ✅ COMPLIANT |
| US | Four-state contract per data surface | State matrix coverage | H: 9 surfaces (seasons, home, leagues, seasonState, realFixtures, prediction, matchDetail, interactivePick, groupStandings) four states, `surfacesMissingAState: []`; P adds **Draw generate** (error+retry+success) | ✅ COMPLIANT |
| US | No silent failure | Fixtures request fails | P: 500 → `.state-error` "Real fixtures could not load" + retry control | ✅ COMPLIANT |
| US | No silent failure | Retry succeeds without duplicates | P: retry cleared the error, rows rendered, exactly 1 extra `real-fixtures/` GET | ✅ COMPLIANT |
| US | Loading preserves layout, never a full-page spinner | Homepage skeleton | H: card-shaped placeholder at settled dimensions, `aria-busy`, no empty copy | ✅ COMPLIANT |
| US | Empty states explain and offer a next action | No leagues imported | H: leagues empty state with copy + Refresh action | ✅ COMPLIANT |
| US | Error writing and in-flight controls | Sync fails after typing | H: inputs kept, named error + Save, retry clears | ✅ COMPLIANT |
| US | Success and live refresh do not disturb the user | Live poll during scroll | H: `scrollY` unchanged, focus unchanged, score updates in place | ✅ COMPLIANT |
| US | Polling preserves the 502 contract | Live scores 502 | P: live region carries the failure, 0 `.state-error`, 0 `[role=alert]`, page usable | ✅ COMPLIANT |
| US | Async updates are announced | Screen-reader announcement | P: `.state-error[role=alert]` carries the leagues failure; `role="status"` baseline intact on Home | ✅ COMPLIANT |
| A11Y | 44px minimum touch targets | Target audit at mobile width | P: 0 offenders across 5 views at 390px (WARNING-4 covers desktop `.real-row-link`) | ✅ COMPLIANT |
| A11Y | Labelled form controls | Score input name | H: "Home goals, Real Madrid versus Bayern Munich, Matchday 1" | ✅ COMPLIANT |
| A11Y | Status is never color-only | Status dot | H: icon svg + sr text "Completed" | ✅ COMPLIANT |
| A11Y | AA contrast in both themes | Both-theme contrast pass | **P: FAILS.** white on `--blue` 3.72:1 (12 px active dot, both themes) — see CRITICAL-1 | ❌ **FAILING** |
| A11Y | Keyboard reachability and visible focus | Full keyboard pass | H: 19/13/23 stops on home/real/predict, `noRing: []` | ✅ COMPLIANT |
| A11Y | Keyboard reachability and visible focus | Card behaves as a control | H: home card is `button`, named, Enter opens the dialog | ✅ COMPLIANT |
| A11Y | Skip link and landmark structure | Skip link | P: first Tab → skip link; Enter → focus `main` | ✅ COMPLIANT |
| A11Y | Dialog semantics and focus return | Focus returns and background is sealed | H: `:modal`, background hidden, tabs stay inside, focus returns to opener | ✅ COMPLIANT |
| A11Y | Reduced motion and existing baseline preserved | Reduced motion | H: `animation-name` → `none`; `aria-pressed`/`aria-current` intact | ✅ COMPLIANT |
| CS | Career renders inside the unified shell | Shell nav on career | P: 1 visible nav, `aria-current="page"` on "Career Mode", 0 `.career-app-shell`, 1 h1 | ✅ COMPLIANT |
| CS | Career renders inside the unified shell | All four surfaces reachable | H: intro/builder/dashboard/summary each render in the shell | ✅ COMPLIANT |
| CS | Fully neutral palette via hard replacement | Token scan | S: `--career-` definitions 0, references 0; 70 `.career-*` rules on shell tokens | ✅ COMPLIANT |
| CS | Fully neutral palette via hard replacement | Dark theme career | P: career renders under `data-theme="dark"` on dark shell tokens, 0 career tokens | ✅ COMPLIANT |
| CS | Engine and storage untouched | Legacy career loads | H: legacy payload restored, no reset/migration prompt | ✅ COMPLIANT |
| CS | Engine and storage untouched | No writes outside the key | H: only `champions_draw_career_v1` changed | ✅ COMPLIANT |
| CS | Career consumes shared primitives | No career-only primitives | S: `CareerApp.jsx` imports `Crest`/`Metric`/`SegmentControl`; no `ClubLogo`/`.career-segmented` | ✅ COMPLIANT |
| CS | Career state survives the navigation redesign | Cross-view navigation | H: half-filled identity intact after home→career, no write | ✅ COMPLIANT |
| PR | Client computation remains the rendering source | Mismatch does not change pixels | H: deliberate divergence detected, rendered table identical, 0 indicators | ✅ COMPLIANT |
| PR | Client computation remains the rendering source | Slow confirmation never blocks | H: hung standings GET → surface rendered, no disabled control | ✅ COMPLIANT |
| PR | Confirmation is read-only with semantic comparison | Reordered-but-equal is not a mismatch | U: reconcile 11/11 | ✅ COMPLIANT |
| PR | Confirmation is read-only with semantic comparison | Real divergence is detected | U: reconcile 11/11; H: keyed mismatch warn captured | ✅ COMPLIANT |
| PR | Bounded trigger frequency | Typing does not trigger checks | H: baseline 3 → after 20 edits still 3 | ✅ COMPLIANT |
| PR | Bounded trigger frequency | Local-only prediction | H: no persisted id → 0 confirmation requests | ✅ COMPLIANT |
| PR | Mismatches are silent to users, logged once | Log content | H: keyed warns, no storage key | ✅ COMPLIANT |
| PR | Offline degradation is a no-op | 502 during confirmation | H: 1 warn, no user-facing error, page renders | ✅ COMPLIANT |
| PR | Offline degradation is a no-op | Offline then reconnected | H: offline renders + 1 warn; next natural trigger retries | ✅ COMPLIANT |
| PR | Protected storage keys stay untouched | Storage untouched | H: 3 protected keys unchanged, `newKeys: []` | ✅ COMPLIANT |

**Compliance summary**: **60/62 scenarios compliant, 2 failing, 0 partial, 0 untested.**
**Requirement-level**: **43 compliant, 2 failing, 0 partial, 0 untested (total 45).**

**Counting rule**: a scenario is COMPLIANT when a covering test I executed passed and covers the scenario; FAILING when a covering test I executed failed; PARTIAL when a test passed but covers only part; UNTESTED when no covering test exists. A requirement is COMPLIANT only when all its scenarios are COMPLIANT. The two failing rows share one root cause (`DT:AA contrast in both themes` / "Contrast matrix" and `A11Y:AA contrast in both themes` / "Both-theme contrast pass").

### Correctness (Static Evidence)

| Invariant | Status | Notes |
|---|---|---|
| INV1 z3 draw POST + `summary` shape | ✅ | D: 100 tests OK; P: draw POST error/retry re-issues only the draw POST (1→2), success notice "Ada ran prediction-1 with 1 fixtures." |
| INV2 reveal state machine | ✅ | H: reveal continued across drawer open/close, 1 draw POST, 1 pick POST |
| INV3 prediction storage keys | ✅ | H: keys unchanged, `newKeys: []`; theme key separate |
| INV4 tiebreaker parity | ✅ | tieUtils 10/10; reconcile 11/11; invariant files byte-identical to `e95c1a9` |
| INV5 live poll + 502 contract | ✅ | H cadence `{30000:1, 60000:1}`; P: 502 → live-region error only, page usable |
| INV6 match-detail focus return | ✅ | H: dialog `:modal`, focus returns to opener |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| Breakpoints `1120/920/760/640`, shell threshold 920 once | ✅ | scan matches exactly |
| Mobile nav = bottom bar (5 views) + `<dialog>` drawer (5 views + 6 workspace tabs) | ✅ | P: 5-item bar + drawer with 6 workspace tabs; `showModal()` trap |
| Theme via `champions_draw_theme`, pre-paint | ✅ | P: persists across reload; keyboard-operable |
| Focus ring `--focus-ring-color` | ✅ | H: 0 missing rings across stops |
| Reconcile cache `Map`, 30 s TTL, memory only | ✅ | H: ≤1 GET/surface inside TTL, no retry within a revision |
| `--career-*` deleted, hard replacement | ✅ | 0 definitions, 0 references; `.career-*` on shell tokens |
| Charts: none | ✅ | no chart dependency |
| **Fills carry ink `#142033`** | ⚠️ **Not followed everywhere** | `.md-dot.md-active` and `.playoff-num` still use `color: white` on `--blue`; `.md-dot.md-done` uses `--green` on `--qualify-fill` — see CRITICAL-1 |
| Primary accent `--green-primary` | ⚠️ | Design.md names `--color-primary: #20b26b`; implemented token is `--green-primary`, `--color-primary` undefined (SUGGESTION-3) |

### Adjudication of the flagged items

1. **`DT:Complete scales` — COMPLIANT for the tested predicate; the prior CRITICAL is closed, with a documented residual scope gap.** The seven named offenders plus three the prior scan did not name are tokenised, and I independently verified that **no real `<button>` and no badge/chip/pill carries off-scale padding** (23 button tokens, 8 badge tokens, 0 off-scale). The space scale equals the declared set exactly. The filter still does not reach card-*like* surfaces whose class name lacks `card` (`.summary-hero` 34px, `.identity-panel` 28px, `.career-event-panel` 26px, `.player-rating` 22px, `.retirement-panel` 42px 24px, `.league-table-wrap` 14px, `.message-bar` 12px 14px, `.match-detail-note` 14px 16px, `.command-band` 18px, `.inspector-head` 18px). Whether those count as "card" is a genuine spec ambiguity; the prior report scoped non-`card`-named containers out (calling `.league-table-wrap` "a wrapper" and `.message-bar` "a notice bar") and treated `.match-detail-header` as only borderline. I keep that established scope (COMPLIANT) and raise WARNING-1 rather than reversing the counting basis mid-stream.
2. **`.match-detail-header` (`26px 20px` → `var(--space-6) var(--space-5)`): correct and in scope under the "any card" reading.** It is a `<header>` with `border`, `--radius-20` and `box-shadow` — a bordered/radiused surface container, i.e. card-like. The change is harmless (24/20 are both scale members; 26 was not) and consistent with the design's radius/space scales. It does, however, set a standard that leaves the equally card-like `.summary-hero` (34px) off-scale — hence WARNING-1.
3. **`.animated-team-list` (`10px` → `var(--space-2)`): a minor scope extension, acceptable.** It is a flex-wrap container for chips, not itself a chip, so it is outside the four categories strictly read. But the change is a 2 px inset on a wrapping container, on-scale, with no functional or layout risk, and no other rule depends on the old value. Not a defect; noted for transparency.
4. **`.team-fixture-score` (`2px 8px` → `var(--space-1) var(--space-2)`): a genuine miss by the prior scan.** It is a badge-like span (`border: 1px solid var(--line)`, `border-radius: var(--radius-xs)`, `background: var(--surface-soft)`, small). Its class name carries no `badge|chip|pill` keyword and it was not in the prior category filter, so the prior scan could not see it. Tokenising it was correct.
5. **`DT:No visual literals outside the token layer` (WARNING-3): the body and its scenario disagree on spacing, and the spec should be clarified.** The body requires spacing to *reference a token*; the scenario scans only colour/radius/shadow. I measured **65 off-scale padding declarations** (and many more on-scale raw-px paddings) still present outside the token blocks. I scored the scenario against its tested predicate (colour/radius/shadow literals = 0 → COMPLIANT), consistent with the prior report's counting basis and with "membership is the criterion" applied to `.league-badge { padding: 4px 12px }`. My reading: either tokenise the spacing literals or narrow the requirement body; as written the body's universal wording is not satisfied, but the scenario is.
6. **Carried-unverified prior findings — re-measured.**
   - **Non-text contrast (WCAG 1.4.11):** measured — 14 control boundaries under 3:1 (e.g. `.view-tabs`/`.md-dot` border `--line #e4e9f0` on `--bg #f5f7fb` = 1.14:1). These controls are identifiable by their text/fill, so I record this as WARNING-4, not a hard failure.
   - **`.real-row-link` at desktop:** re-measured — **710×34** at 1440px (34 px tall, below 44). It is an `inset: 0` overlay link filling its row, so its hit area equals the row height. At 390px the target audit passes. WARNING-4.
   - **Mobile drawer focus containment:** re-measured — the drawer is a modal `<dialog>` (`matches(':modal') === true`); 20 Tab presses cycle through the drawer's controls only, with a benign `document.body` stop between cycles and **no background control reachable**. No violation.

### Issues Found

**CRITICAL**

- **CRITICAL-1 — `A11Y:AA contrast in both themes` / "Both-theme contrast pass" and `DT:AA contrast in both themes` / "Contrast matrix" are not satisfied.** Small text (12 px / 11 px, not "large") sits on fills below the 4.5:1 AA threshold in both themes. Measured on the rendered build with `getComputedStyle` (not estimated) and independently re-computed with an external tool:
  - `.md-dot.md-active` `{ color: white; background: var(--blue) }` — `styles.css:1180` (and `.md-dot.md-done.md-active`, `:1193`) — white on `#4d7cff` = **3.72:1** at 12 px/800. Runtime: `<button class="md-dot md-active">1</button>`, `color rgb(255,255,255)` on `rgb(77,124,255)`. **Both themes.** Always rendered in the Predict tab.
  - `.md-dot.md-done` `{ color: var(--green); background: var(--qualify-fill) }` — `styles.css:1187` — `#17965a` on `#f0fdf4` = **3.62:1** at 12 px/800. Runtime: `<button class="md-dot md-done">1</button>`, `rgb(23,150,90)` on `rgb(240,253,244)`.
  - `.team-badge span { color: var(--muted) }` — `styles.css:651` — applies to the crest's initials span inside a `TeamBadge`; on a selected row (`.team-row.selected .team-logo { background: var(--navy) }`, `:907`) the initials are `--muted #5b6b82` on `--navy #102033` = **3.03:1** at 10 px.
  - Source-corroborating sibling (not rendered in my fixtures, so not the failure basis): `.playoff-num { background: var(--blue); color: white; font-size: 11px; font-weight: 900 }` — `styles.css:1603` — same **3.72:1**.

  This is the same failure family the change already fixed elsewhere (`.view-tabs`/`.segment-control` active → `--green-ink`; `.gd-pos` → `--green-ink`; `.verdict-exact` → `--green-ink`; `.badge-blue` → `--status-ink`), and it contradicts the design's own decision that "fills carry ink `#142033`" (Design.md §3.1; design.md table). The token-level fix is available and consistent: use `--status-ink` on the `--blue` fills (4.86:1) and `--green-ink` on the `--qualify-fill` fill (as `.gd-pos` already does). No functional, security or data impact. This is the sole reason the verdict is not a pass.

**WARNING**

- **WARNING-1 — the `DT.complete-scales` category filter remains a name/keyword proxy; card-like surfaces without `card` in the class name are still unscanned and off-scale.** Named rules the filter never reaches: `.summary-hero` 34px, `.identity-panel` 28px, `.career-event-panel` 26px, `.player-rating` 22px, `.retirement-panel` 42px 24px, `.league-table-wrap` 14px, `.message-bar` 12px 14px, `.match-detail-note` 14px 16px, `.command-band` 18px, `.inspector-head` 18px (full list in my `full-pad-scan`). Under a broad "any bordered surface is a card" reading (the reading that makes `.match-detail-header` in scope, item 2) the requirement would still fail on `.summary-hero` et al. Recommended: either add these selectors to `NAMED`, or define "card" in the spec. Not scored as the failure basis because the prior report established the narrower scope and the word "card" is genuinely ambiguous.
- **WARNING-2 — `DT:No visual literals outside the token layer`: requirement body vs scenario (spacing).** See adjudication item 5. 65 off-scale padding declarations remain; the scenario (colour/radius/shadow) is clean.
- **WARNING-3 — four `color: white` literals remain in `styles.css`** (`:1019` `.inspector-head`, `:1182` `.md-dot.md-active`, `:1194` `.md-dot.md-done.md-active`, `:1603` `.playoff-num`). `--white` exists as a token, and the body of `DT:No visual literals` requires colours to reference a token; the scenario's literal scan (hex/rgb) does not count the `white` keyword. `:1182`/`:1194`/`:1603` are also the CRITICAL-1 pairs. Recommend tokenising to `--status-ink`.
- **WARNING-4 — carried findings re-measured.** Non-text boundaries: 14 control borders under 3:1 (WCAG 1.4.11 nuance — controls remain identifiable by text/fill). Desktop target: `.real-row-link` is 710×34 at 1440px (below 44 px height); the 390 px audit passes.
- **WARNING-5 — prior verification's contrast claim is contradicted.** Task 7.3 and the stale report asserted "195 unique text pairings, 0 fail / 0 under 4.5". My computed scan finds three sub-4.5 small-text pairs in both themes. The likely cause is that the dot numerals / initials were classified as non-text UI (3:1) or not driven; either way, any future verification citing that matrix as proof of `A11Y:AA contrast` should re-measure the matchday selector and the Pots/playoff badges.

**SUGGESTION**

- **SUGGESTION-1 — `.real-league-table`'s padding declaration is dead.** `styles.css:1435` is overridden by `.league-table` (`:1500/1515`); `dd05eb2` tokenised it, changing a rule with no rendered effect. Merge or delete it.
- **SUGGESTION-2 — non-primitive cards exceed the impeccable radius ceiling.** `.home-game-card` (`:2024`), `.match-detail-header` (`:3484`) and `.match-detail-info` use `--radius-20` (20px), above the design's cards-12 declaration and impeccable's 12–16px card ceiling. `--radius-20` is a scale member, so not a `DT` violation. Pre-existing.
- **SUGGESTION-3 — design/token naming drift.** Design.md names `--color-primary: #20b26b`; the implemented token is `--green-primary`, and `--color-primary` is undefined and unconsumed. Documentation drift only.
- **SUGGESTION-4 — `--delay` is referenced in `styles.css` (`:507`) but defined only inline** (`DrawAnimationStage.jsx:21`), the only root-unresolved `var()` reference. It resolves on the consuming element; harmless today, a dead-value trap if the inline style is removed.
- **SUGGESTION-5 — `US.state-matrix` "four-state" gate is weaker than the scenario.** Its generic check accepts `loading || error || busy` per surface and asserts explicit empty/success for only some; the driving is real but the gate is thin. I drove Draw generate separately.
- **SUGGESTION-6 — `.team-badge span` over-matches.** The rule intended for the association-code span also styles the crest wrapper (`.team-logo` is a `<span>`) and its initials, which is how the initials end up `--muted` (CRITICAL-1 instance 3). Scope it (e.g. `.team-badge > span:last-child` or a dedicated class).

### Could not exercise (this run) — and why

- **Cross-browser**: Chromium only (Playwright), matching project tooling; no Firefox/WebKit, no real device.
- **Pixel/visual-regression**: findings are computed-style and geometry based, not screenshot diffs.
- **`.playoff-num` runtime render**: the playoff bracket did not render in my fixtures (needs a completed league phase); cited as source-level corroboration only.
- **`--delay` root resolution**: intentionally empty on `:root`; verified resolvable on its inline-scoped element.

### Coverage

- **Verified (COMPLIANT): 60/62 scenarios; 43/45 requirements.**
- **Partial: 0/62 scenarios; 0/45 requirements.**
- **Failing: 2/62 scenarios (`DT:AA contrast in both themes` / "Contrast matrix"; `A11Y:AA contrast in both themes` / "Both-theme contrast pass"); 2/45 requirements.**
- **Untested: 0/62 scenarios; 0/45 requirements** (every row re-driven; unmeasured sub-checks listed above are not scored PASS).

### Verdict

**FAIL — two spec requirements/scenarios are not satisfied, with zero functional blockers and zero command failures.**

The change `dd05eb2` does what it claims for `DT:Complete scales`: the ten off-scale declarations are tokenised, the space scale equals the declared set exactly, and I independently confirmed that **no real `<button>` and no badge/chip/pill carries off-scale padding** — the prior CRITICAL-1 is genuinely closed, and the repaired filter's `NAMED`/class-token coverage now reaches the selectors the keyword filter skipped. All suites are green (100 Django, 11 reconcile, 10 tieUtils, 3 career); the committed `static/ui/` reproduces **byte-identically** from a fresh `npm run build` and leaves a clean tracked tree; and my own 24-check probe plus the actor's harness (32/32) confirm the shell, states, accessibility (non-contrast), career and reconciliation rows on the rendered build.

The verdict is `fail` because the **AA contrast requirement is not met in either theme**: small text on fills remains below 4.5:1 — the matchday selector's active dot (white on `--blue` = 3.72:1, both themes), its done dot (`--green` on `--qualify-fill` = 3.62:1), and the crest initials inside a `TeamBadge` on a selected row (`--muted` on `--navy` = 3.03:1). These are the same class of failure the change already fixed for `.view-tabs`, `.gd-pos`, `.verdict-exact` and `.badge-blue`, and they contradict the design's explicit "fills carry ink `#142033`" decision; the token-level fix (`--status-ink` / `--green-ink`) is available. This also contradicts the stale report's claim of a clean 195-pair contrast matrix — a repaired check that goes green is exactly where this false green hid.

Completed counts (43/45 requirements, 60/62 scenarios) fall below the totals a passing verdict requires. This canonical failure is valid and persistable but **not archive-ready**.

`size:exception` is a maintainer delivery decision and did not influence this verdict.
