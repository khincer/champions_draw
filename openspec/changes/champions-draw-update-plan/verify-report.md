```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:cad6f173e09996d84a25c4c0521c49daf333bfe60c9b7622532cd83cef3408d4
verdict: fail
blockers: 0
critical_findings: 1
requirements: 44/45
scenarios: 61/62
test_command: .\.venv\Scripts\python manage.py test
test_exit_code: 0
test_output_hash: sha256:97dc3bbb46660159bec79dacabfa753a1d9344cdad03f4414233222e8cb377ed
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:f3f7c6b9c50b2793b212c8e78d00054a15aaae4cfacdb97de46743503175db07
```

## Verification Report

**Change**: `champions-draw-update-plan` — Champions Draw UI/UX Update
**Version**: N/A
**Candidate under verification**: `620a04d48fd4ae14ce98bcfefd7602efd50bdf97` (`git rev-parse HEAD`; tree `af77834995f2d89dbe42e0c74b5dd7dc113413b0`). `evidence_revision` above is `sha256("<full SHA>|<tree SHA>")`.
**Mode**: Standard (Strict TDD **not** active — `strict_tdd` false, no runner)

### Method and independence

I read the proposal, all seven delta specs (independently counted **45 requirements / 62 scenarios**), the design, and all 40 tasks. I re-ran every suite, rebuilt the tracked bundle and byte-compared it, executed the apply actor's harness **myself**, and wrote and executed **my own 19-check probe** for the rows the harness does not reach. The prior report verified `a03db79`; it was read as a stale artifact to supersede — not as truth and not as an instruction. Nothing in the repository was written except this report; `git status --porcelain` at the end shows only the pre-existing untracked SDD/tooling dirs (`.agents/`, `PLAN.md`, `PLAN_CONMEBOL_DRAWS.md`, `frontend/harness/`, `harness.vite.config.mjs`, `openspec/`).

**Instruments I executed (never a stored output):**

| Instrument | Scope | Observation |
|---|---|---|
| `node frontend/harness/app-evidence.mjs <temp>` | 32 scenarios incl. 128 s poll cadence | **32/32 pass**, exit 0 |
| my `<temp>/probe.mjs` | 19 independent checks (all harness gaps + Draw generate) | **19/19 pass**, exit 0 |
| `.\.venv\Scripts\python manage.py test` | Django / DRF contract | `Ran 100 tests` / `OK`, exit 0 |
| `npm run test:career` | career engine | `tests 3 / pass 3 / fail 0` |
| `node --test frontend/src/lib/reconcile.test.mjs` | reconciliation | `tests 11 / pass 11 / fail 0` |
| `node --test frontend/src/tieUtils.test.mjs` | tiebreakers | `tests 10 / pass 10 / fail 0` |
| my `<temp>/static.py` | literal / breakpoint / dead-CSS / import scans | all clean (details below) |

### Independence caveat: audit of the rewritten `DT.complete-scales` assertion

As required, I did **not** trust the rewritten assertion. I read it (`frontend/harness/app-evidence.mjs:1084-1188`) and audited both axes against the spec.

- **Scale axis — now sound, verified.** The assertion reads `--space-*` and `--radius-*` from computed root and keeps them **separate** (`space` = `{4,8,12,16,20,24,32,40,48,64}`, `radius` = `{2,3,4,6,8,10,12,16,20,999}` in the run I executed). Padding is validated against `space` only, radius against `radius` only. The prior unsound union is gone; a `6px` padding can no longer pass via `--radius-sm`. Confirmed in my run: `offenderCount: 0`, `requiredMissing: []`, `targetRules: 122`, `categoryHits {table cell 25, button 32, card 32, badge 33}`.
- **Coverage axis — still unsound as a proxy for the requirement.** The category filter is a **selector-keyword** test (`app-evidence.mjs:1110-1115`): a rule is a "button" only if its selector contains the tag `button`, the class `.button`, or the suffix `-toggle`. That silently skips real `<button>` elements whose class name does not contain "button". I proved the skip with a markup-grounded scan: I extracted every class token from every `<button …>` in `frontend/src`, then looked up each class's rule in `styles.css`. Result: **5 distinct off-space padding rules on real `<button>` elements are never scanned** (below). The 0-offender PASS is therefore a **false green** for the requirement's universal "any … button … badge".

### What changed since the stale report

| Commit | Change | Verdict this run |
|---|---|---|
| `620a04d` | 28 off-scale padding declarations tokenised (diff `a03db79..620a04d`: 56 changed lines in `styles.css`) + rebuilt `static/ui/` | The named instances are fixed (e.g. `.league-table th` → `var(--space-2)`, `.segment-control button` → `var(--space-2) var(--space-3)`, `.hub-status` → `var(--space-1) var(--space-2)`), but the requirement is broader than the set the harness scans — see CRITICAL-1. |
| same unit (untracked) | `DT.complete-scales` harness assertion rewritten | Scale separation fixed and verified; category filter still misses real buttons — WARNING-1. |

`620a04d` touched only `frontend/src/styles.css` and the tracked bundle (`static/ui/index.html`, `…/index-Cne2x5_8.css`, renaming `index-DNmNFfxi.css` → `index-CSOAysZ5.js` on the JS side). No application logic changed.

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 40 |
| Tasks complete | 40 |
| Tasks incomplete | 0 |

All 40 tasks are `- [x]` (counted: 40 checked / 0 unchecked). Task completion is not requirement satisfaction — see the matrix.

### Build & Tests Execution

**Build**: ✅ exit 0 — `npm run build` (Vite 6.4.3, 1609 modules, 1.64 s) → `index.html` 1.30 kB, `index-CSOAysZ5.js` 174.08 kB, `index-Cne2x5_8.css` 65.51 kB, `uefa-…-logo-DugNjAjF.svg` 12.92 kB. Captured output `sha256:f3f7c6b9…db07` (ANSI stripped).

**The committed bundle is NOT stale.** Before and after a fresh build the four tracked files are byte-identical and `git status --porcelain static/ui` is empty:

```text
static/ui/index.html                        318DDF64…923B   (before == after)
static/ui/assets/index-CSOAysZ5.js          4BF905B9…5060   (before == after)
static/ui/assets/index-Cne2x5_8.css         F5C71FA4…28F5   (before == after)
static/ui/assets/uefa-…-logo-DugNjAjF.svg   FDF63322…9A3A   (before == after)
```

The Django server already listening on :8001 serves this exact build (`index-Cne2x5_8.css`, `index-CSOAysZ5.js`).

**Tests**: ✅ all green (exit 0 each)

```text
.\.venv\Scripts\python manage.py test          -> Found 100 test(s) | Ran 100 tests in 72.840s | OK   (sha256:97dc3bbb…77ed)
npm run test:career                             -> tests 3  | pass 3  | fail 0                              (sha256:29280aef…06e0)
node --test frontend/src/lib/reconcile.test.mjs -> tests 11 | pass 11 | fail 0                              (sha256:b82a5c45…3976)
node --test frontend/src/tieUtils.test.mjs      -> tests 10 | pass 10 | fail 0                              (sha256:ce7a8ed8…59f9)
```

These are the three `node --test` suites present under `frontend/src` (inventory checked: `careerEngine.test.mjs`, `lib/reconcile.test.mjs`, `tieUtils.test.mjs`).

**Coverage tooling**: ➖ Not available — the project configures no coverage runner.

**Static scans** (my own; comments stripped, `:root` + `[data-theme="dark"]` blocks blanked for literal scans):

- colour literals outside token blocks **0**; `border-radius` px literals **0**; `box-shadow` literals **0**
- `repeating-linear-gradient` **0**; `background-clip: text` **0**; `backdrop-filter` **0**; `border-left/right` > 1px **0**
- `@media` widths `{640×2, 760×1, 920×1, 1120×1}` — all declared members; `920px` appears exactly once
- dead families (`.homepage-shell`, `.landing*`, `.auth-callout`, `.workspace-home-button`, `.product-hub*`, `.product-grid`, `.product-card*`) **0** in CSS and **0** in `src`
- `--career-` definitions **0**; `CareerApp.jsx` imports `Crest`/`Metric`/`SegmentControl`, 0 `ClubLogo`, 0 `.career-segmented`
- no view imports `main.jsx`; `groupBy` resolves from `lib/groupBy.js` and is no longer exported from `main.jsx`
- `sharePredictionsImage.js` has **0** colour literals and reads token values
- undefined `var()` references: only `--delay` (set inline at `DrawAnimationStage.jsx:21`)
- invariant files byte-identical to change base `e95c1a9`: `tieUtils.js`, `standingsCalc.js`, `predictionStorage.js`, `careerEngine.mjs`, `careerClubs.json` (empty diff)

### Spec Compliance Matrix

Statuses: ✅ COMPLIANT · ❌ FAILING · ⚠️ PARTIAL · ❔ UNTESTED.
Evidence tags: **H** harness (my execution) · **P** my probe · **S** static scan · **U** `node --test` · **D** Django suite.
**Carried rows: none.** `620a04d` changed CSS and the bundle, so every row was re-driven.

| # | Requirement | Scenario | Evidence | Result |
|---|---|---|---|---|
| DT | Dual-theme token layer | Dark theme resolves every token | P: 118 declared tokens, 0 empty under `data-theme="dark"`; S: no undefined refs | ✅ COMPLIANT |
| DT | Dual-theme token layer | Light stays the default | P: fresh load `data-theme="light"`, `color-scheme: light` | ✅ COMPLIANT |
| DT | Theme switch | Persisted theme | P: storage key → `data-theme="dark"` at DOMContentLoaded (pre-paint) | ✅ COMPLIANT |
| DT | Theme switch | Keyboard-operable | H: Enter toggled light→dark, focus stayed, `aria-pressed` false→true | ✅ COMPLIANT |
| DT | No visual literals outside the token layer | Literal scan is clean | S: colour 0, radius 0, shadow 0; share palette reads tokens | ✅ COMPLIANT |
| DT | Complete scales | Primitives consume scale steps | **S: FAILS.** Real `<button>`/badge elements carry off-space padding that the harness filter never reaches — see CRITICAL-1 | ❌ **FAILING** |
| DT | AA contrast in both themes | Contrast matrix | P: 89 text pairs, 0 fail / 0 under threshold in light AND dark | ✅ COMPLIANT |
| DT | Dead CSS and banned decoration removed | Dead selector scan | S: all dead families 0/0 css+src; `repeating-linear-gradient` 0 | ✅ COMPLIANT |
| AS | All views render inside one shell | Each view exposes shell nav | P: 5 views each 1 visible `nav[aria-label=Primary]`, 1 `main#main-content`, 0 nested, 1 h1, current marked | ✅ COMPLIANT |
| AS | All views render inside one shell | View state survives a shell re-render | P: theme toggle kept h1 "Draw workspace" and tab "Pots" | ✅ COMPLIANT |
| AS | View switching operates at every breakpoint | Switch views below the breakpoint | P: 5-item mobile bar; selecting "Leagues" rendered the Leagues view | ✅ COMPLIANT |
| AS | View switching operates at every breakpoint | Workspace tabs on mobile | P: drawer lists 6 tabs; active `aria-pressed=true` + `text-decoration: underline` (non-color) | ✅ COMPLIANT |
| AS | One declarative breakpoint scale | No stray breakpoint | S: widths `{640,760,920,1120}`; `920px` once | ✅ COMPLIANT |
| AS | One declarative breakpoint scale | Crossing the threshold preserves state | H: 1440→390→1440 kept view + tab "Pots"; drawer tabs 6 | ✅ COMPLIANT |
| AS | Navigation is keyboard-operable and not color-only | Keyboard-only navigation | H: Tab→Enter to Real Draw, `aria-current="page"`, `::before` bar | ✅ COMPLIANT |
| AS | Shell preserves draw and polling invariants | Navigation during an active reveal | H: reveal continued across drawer open/close, 1 draw POST | ✅ COMPLIANT |
| AS | Shell preserves draw and polling invariants | Poll cadence unchanged | H (128 s): live gaps 30 s, hub gaps 60 s, `maxActive {30000:1, 60000:1}` | ✅ COMPLIANT |
| UC | Single crest/logo component | Uniform crest everywhere | P: 8 `.team-logo`, all `role=img` with non-empty name, 0 foreign crest classes; S: only `Crest.jsx` defines a renderer | ✅ COMPLIANT |
| UC | Single crest/logo component | Missing image | P: `logo_url:''` → no `<img>`, initials "REA", `aria-label` carries team name, `role="img"` | ✅ COMPLIANT |
| UC | Single standings table | Qualification bands preserved | H: positions 1/9/30 → `row-qualified`/`row-playoffs`/`row-eliminated` + sr cues | ✅ COMPLIANT |
| UC | Single fixture/match row | Live vs scheduled row | P: status text present; scores `font-variant-numeric: tabular-nums` | ✅ COMPLIANT |
| UC | Single segment/tab control | Arrow-key tab change | P: ArrowRight moved selection, focus follows, `aria-pressed` | ✅ COMPLIANT |
| UC | Shared metric, badge and button primitives | Button state coverage | H: primary/secondary/ghost/danger respond to hover+active; disabled `dashed` + `not-allowed` | ✅ COMPLIANT |
| UC | No banned decorative patterns | New primitive review | S: 0 gradient text, 0 backdrop-filter, 0 `>1px` side stripes, 0 repeating gradients | ✅ COMPLIANT |
| UC | Decomposition prerequisite and pure presentation | No cycle after extraction | S: 0 views import `main.jsx`; `groupBy` from `lib/groupBy.js` | ✅ COMPLIANT |
| UC | Decomposition prerequisite and pure presentation | Primitive stays presentational | H: crests/tables/buttons rendered, `apiCalls: []` | ✅ COMPLIANT |
| US | Four-state contract per data surface | State matrix coverage | H: 8 surfaces (seasons, home hub, leagues, seasonState, realFixtures, prediction, matchDetail, interactivePick, groupStandings) driven; P adds **Draw generate** (error+retry+success) | ✅ COMPLIANT |
| US | No silent failure | Fixtures request fails | P: 500 → `.state-error[role=alert]` "Real fixtures could not load" + `Retry real fixtures` | ✅ COMPLIANT |
| US | No silent failure | Retry succeeds without duplicates | P: retry cleared the error, 2 rows, exactly 1 extra `real-fixtures/` GET, no other endpoint hit | ✅ COMPLIANT |
| US | Loading preserves layout, never a full-page spinner | Homepage skeleton | H: card-shaped placeholder at settled dimensions, `aria-busy`, no empty copy | ✅ COMPLIANT |
| US | Empty states explain and offer a next action | No leagues imported | H: leagues empty state with copy + Refresh action | ✅ COMPLIANT |
| US | Error writing and in-flight controls | Sync fails after typing | H: inputs kept, named error + Save, retry clears | ✅ COMPLIANT |
| US | Success and live refresh do not disturb the user | Live poll during scroll | H: `scrollY` unchanged, focus unchanged, score 2:0 in place | ✅ COMPLIANT |
| US | Polling preserves the 502 contract | Live scores 502 | P: live region carries "Live scores unavailable…", `.state-error` 0, `[role=alert]` 0, page usable | ✅ COMPLIANT |
| US | Async updates are announced | Screen-reader announcement | P: `.state-error[role=alert]` carries the leagues failure; H: `role="status"`/`aria-live` preserved | ✅ COMPLIANT |
| A11Y | 44px minimum touch targets | Target audit at mobile width | P: 0 offenders across 5 views at 390px | ✅ COMPLIANT |
| A11Y | Labelled form controls | Score input name | H: "Home goals, Real Madrid versus Bayern Munich, Matchday 1" | ✅ COMPLIANT |
| A11Y | Status is never color-only | Status dot | H: icon svg + sr text "Completed" | ✅ COMPLIANT |
| A11Y | AA contrast in both themes | Both-theme contrast pass | P: 0 text failures in light and dark (89 pairs each) | ✅ COMPLIANT |
| A11Y | Keyboard reachability and visible focus | Full keyboard pass | H: 19/12/23 stops on home/real/predict, `noRing: []` | ✅ COMPLIANT |
| A11Y | Keyboard reachability and visible focus | Card behaves as a control | H: home card is `button`, named, Enter opens the dialog | ✅ COMPLIANT |
| A11Y | Skip link and landmark structure | Skip link | P: first Tab → `a.skip-link`; Enter → focus `main#main-content` | ✅ COMPLIANT |
| A11Y | Dialog semantics and focus return | Focus returns and background is sealed | H: `:modal`, background hidden, 6/6 tabs inside, `escaped:false`, focus returns to opener | ✅ COMPLIANT |
| A11Y | Reduced motion and existing baseline preserved | Reduced motion | H: `animation-name` `mobile-nav-in`→`none`; `aria-pressed`/`aria-current` intact | ✅ COMPLIANT |
| CS | Career renders inside the unified shell | Shell nav on career | P: 1 visible nav, `aria-current="page"` on "Career Mode", 0 `.career-app-shell`, 1 h1 | ✅ COMPLIANT |
| CS | Career renders inside the unified shell | All four surfaces reachable | H: intro/builder/dashboard/summary each render in the shell | ✅ COMPLIANT |
| CS | Fully neutral palette via hard replacement | Token scan | S: `--career-` definitions 0; 70 `.career-*` rules on shell tokens | ✅ COMPLIANT |
| CS | Fully neutral palette via hard replacement | Dark theme career | P: career renders under `data-theme="dark"`, no own chrome | ✅ COMPLIANT |
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

**Compliance summary**: **61/62 scenarios compliant, 1 failing, 0 partial, 0 untested.**
**Requirement-level**: **44 compliant, 1 failing, 0 partial, 0 untested (total 45).**

**Counting rule**: a scenario is COMPLIANT when a covering test I executed passed and covers the scenario; FAILING when a covering test I executed failed; PARTIAL when a test passed but covers only part; UNTESTED when no covering test exists. A requirement is COMPLIANT only when all its scenarios are COMPLIANT. The single failing requirement/scenario is `DT:Complete scales` / `Primitives consume scale steps`.

### Correctness (Static Evidence)

| Invariant | Status | Notes |
|---|---|---|
| INV1 z3 draw POST + `summary` shape | ✅ | D: 100 tests OK; P: draw POST path + error/retry driven |
| INV2 reveal state machine | ✅ | H: reveal continued across drawer open/close, 1 draw POST |
| INV3 prediction storage keys | ✅ | H: keys unchanged, `newKeys: []`; theme key separate |
| INV4 tiebreaker parity | ✅ | tieUtils 10/10; reconcile 11/11; invariant files byte-identical to `e95c1a9` |
| INV5 live poll + 502 contract | ✅ | H cadence `{30000:1, 60000:1}`; P: 502 → live-region error only, page usable |
| INV6 match-detail focus return | ✅ | H: dialog `:modal`, `escaped: false`, focus returns to opener |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| Breakpoints `1120/920/760/640`, shell threshold 920 once | ✅ | scan matches exactly |
| Mobile nav = bottom bar + `<dialog>` drawer | ✅ | P: 5-item bar + drawer with 6 workspace tabs |
| Theme via `champions_draw_theme`, pre-paint | ✅ | P: persists across reload; keyboard-operable |
| Focus ring `--focus-ring-color` | ✅ | H: 0 missing rings across stops |
| Reconcile cache `Map`, 30 s TTL, memory only | ✅ | H: ≤1 GET/surface inside TTL, no retry within a revision |
| `--career-*` deleted, hard replacement | ✅ | 0 definitions; `.career-*` on shell tokens |
| Charts: none | ✅ | no chart dependency |
| Primary accent `--green-primary` | ⚠️ | Design.md names `--color-primary: #20b26b`; implemented token is `--green-primary`, `--color-primary` undefined (SUGGESTION-3) |

### Adjudication of the flagged items

1. **`DT:Complete scales` — NOT COMPLIANT; the repaired assertion does not support a PASS.** The scale-separation repair is real and sound (verified: space-only vs radius-only). The category filter is not: it is selector-keyword based and never reaches real `<button>` elements whose class name lacks "button". Rules it fails to reach, all with off-space padding from the declared space scale `{4,8,12,16,20,24,32,40,48,64}`:
   - `.site-nav-link { padding: 10px 20px }` (`styles.css:1786`) — the primary shell nav buttons, in every view (`SiteNav.jsx:12,23,33,41,50`; `ThemeToggle.jsx:15`). `10 ∉ space`.
   - `.team-row { padding: 0 10px }` (`styles.css:871`) — `<button>` pick rows in `PotBoard.jsx:13` and `InteractiveDraft.jsx:170`. `10 ∉ space`.
   - `.career-primary-action, .career-secondary-action { padding: 0 18px }` (`styles.css:2331`) — `<button>`s. `18 ∉ space`.
   - `.career-option { padding: 10px 13px }` (`styles.css:2799`) — `<button>`. `10,13 ∉ space`.
   - `.back-button { padding: 6px 12px }` (`styles.css:3251`) — `<button>`s in `TeamPage.jsx:74,78`, `TeamsBrowser.jsx:193,207`, `TeamDetailPage.jsx:19`, `MatchDetailView.jsx:116`. `6 ∉ space`.
   - Badge/pill-like: `.fx-verdict { padding: 2px 8px }` (`styles.css:1361`; `RealDrawView.jsx:389,398,433,438`) and `.animated-team { padding: 3px 8px 3px 3px }` (`styles.css:525`; `DrawAnimationStage.jsx:28`). `2`/`3 ∉ space`.

2. **Scope boundary.** The requirement's four categories are universal. It plainly reaches the `<button>` elements listed above (`.site-nav-link`, `.team-row`, `.career-primary/secondary-action`, `.career-option`, `.back-button`) and, on a badge reading, the status pill `.fx-verdict` and the chip `.animated-team`. It does **not** reach `.league-table-wrap` (a wrapper), `.message-bar` (a notice bar), `.team-fixture-score` (a score span), `.fixture-mini` / `.playoff-tiebreaker` (rows, not one of the four categories), or `.animated-team` read as a generic span. `.match-detail-header { padding: 26px 20px }` (`styles.css:3489`) is a bordered, radiused, shadowed card-like container — borderline "card"; flagged as WARNING-2 rather than the failing basis. Because the in-scope exclusions include real buttons, the requirement is **not** satisfied, not merely "partial in wording".

3. **On-scale literals.** `.league-badge { padding: 4px 12px }` (`styles.css:2120`) is numerically on-scale (`4`,`12` ∈ space). Reading applied: the requirement text says *"Every such literal MUST be a scale member"* — **membership is the criterion**, so this satisfies `DT:Complete scales`. I do **not** fail it here. Note the cross-requirement tension: `DT:No visual literals outside the token layer`'s body says spacing "MUST reference a token", while its scenario scans only colour/radius/shadow. ~70 raw-px padding declarations remain. I score that scenario against its tested predicate (colour/radius/shadow = 0 → COMPLIANT) and raise the wording conflict as WARNING-3, not as a second failure.

4. **`.real-league-table` (visual no-op).** `StandingsTable` renders `class="league-table real-league-table"` (`RealDrawView.jsx:501-507`). `.real-league-table td/th { padding: var(--space-1) }` (`styles.css:1435`) and `.league-table td/th { padding: var(--space-2) }` (`styles.css:1500/1515`) have equal specificity; `.league-table` appears later, so the rendered table was and remains 8/8. **Satisfied under both readings** — source is on-scale (4/4) and the rendered result is on-scale (8/8). The `.real-league-table` padding declaration is dead; see SUGGESTION-1.

5. **`.hub-matchup` 18→16.** `.hub-matchup` (`Homepage.jsx:53`, `styles.css:2028`) is the body of the `.home-game-card` card; its sibling `.home-game-card-header`/`-footer` are also tokenised (`var(--space-4)` / `var(--space-2) var(--space-4)`). **In scope (card region) and correct** — `var(--space-4)` brings the card's header/body/footer to one on-scale inset.

### Issues Found

**CRITICAL**

- **CRITICAL-1 — `DT:Complete scales` / `Primitives consume scale steps` is not satisfied.** Off-space padding remains on real `<button>` and badge/chip elements that the harness's rewritten category filter never scans. Concrete, markup-grounded offenders (declared space scale `{4,8,12,16,20,24,32,40,48,64}`):
  - `.site-nav-link` `padding: 10px 20px` — `styles.css:1786` — `<button>`s `SiteNav.jsx:12,23,33,41,50`, `ThemeToggle.jsx:15`
  - `.team-row` `padding: 0 10px` — `styles.css:871` — `<button>`s `PotBoard.jsx:13`, `InteractiveDraft.jsx:170`
  - `.career-primary-action, .career-secondary-action` `padding: 0 18px` — `styles.css:2331` — `<button>`s
  - `.career-option` `padding: 10px 13px` — `styles.css:2799` — `<button>` `CareerApp.jsx:561`
  - `.back-button` `padding: 6px 12px` — `styles.css:3251` — `<button>`s
  - `.fx-verdict` `padding: 2px 8px` — `styles.css:1361` — status pill spans
  - `.animated-team` `padding: 3px 8px 3px 3px` — `styles.css:525` — chip spans

  The scenario's predicate ("GIVEN **any** card, button, table cell or badge … THEN each maps to a declared step") is therefore false. `620a04d` closed the 28 instances the actor enumerated; these were outside its enumeration and outside the harness filter. No functional, security or data impact. This is the sole reason the verdict is not a pass.

**WARNING**

- **WARNING-1 — the rewritten `DT.complete-scales` assertion is sound on scales, unsound on coverage.** Its accepted padding set now equals the space scale exactly and its radius set equals the radius scale exactly (verified), so the prior union bug is gone. But its category filter (`app-evidence.mjs:1110-1115`) keys on the literal selector tokens `button` / `.button` / `-toggle`, so it reports `0 offenders` while real buttons carry off-space padding. Any future verification citing this check as proof of `DT:Complete scales` is relying on a filter that skips rules it should catch. Recommended fix: classify selected rules by the rendered element type (query the component harness), or add an explicit required-selector list for the buttons/badges that exist (`.site-nav-link`, `.team-row`, `.career-*-action`, `.career-option`, `.back-button`, `.fx-verdict`, `.animated-team`).
- **WARNING-2 — `.match-detail-header` is a card-like container with off-space padding.** `padding: 26px 20px` (`styles.css:3489`) on a `<header>` with `border: 1px solid var(--line)`, `border-radius: var(--radius-20)` and `box-shadow: var(--shadow)`. If "card" is read to include bordered card containers, this is a further `DT:Complete scales` offender; I did not rest the failure on it because the element is a `<header>`, not a `.card`-named card.
- **WARNING-3 — `DT:No visual literals outside the token layer`: the requirement body and its scenario disagree on spacing.** The body requires spacing to reference a token; the scenario scans only colour/radius/shadow. ~70 raw-px padding declarations remain in `styles.css` (e.g. `.league-badge { padding: 4px 12px }`, L2120). Scored COMPLIANT against the scenario's tested predicate per the counting rule, but the spec should be clarified (either tokenise spacing or narrow the requirement body).
- **WARNING-4 — prior non-text / desktop / drawer findings were not re-measured this run.** The stale report's WARNING-4 (sub-3:1 non-text boundaries), WARNING-5 (`.real-row-link` 710×34 at desktop), and WARNING-6 (mobile drawer focus ring-fencing) are carried as **unverified prior findings**, not confirmed or refuted. I measured text contrast and only the 390px target viewport.

**SUGGESTION**

- **SUGGESTION-1 — `.real-league-table`'s padding declaration is dead.** `styles.css:1435` is overridden by `.league-table` (`styles.css:1500/1515`); `620a04d` tokenised it, changing a rule with no rendered effect. Either merge or delete it, or add a comment so the 4/4 value is not mistaken for the rendered padding.
- **SUGGESTION-2 — non-primitive cards exceed the impeccable radius ceiling.** `.home-game-card` (`styles.css:2024`), `.match-detail-header` (`3484`) and `.match-detail-info` use `--radius-20` (20px), above the design's cards-12 declaration and impeccable's 12–16px card ceiling. `--radius-20` is a scale member, so not a `DT` violation; `UC:No banned decorative patterns` is scoped to primitives and passes. Pre-existing.
- **SUGGESTION-3 — design/token naming drift.** Design.md names `--color-primary: #20b26b`; the implemented token is `--green-primary`, and `--color-primary` is undefined and unconsumed. Documentation drift only.
- **SUGGESTION-4 — `--delay` is referenced in `styles.css` but defined only inline** (`DrawAnimationStage.jsx:21`), the only undefined `var()` reference. Harmless today; a dead-value trap if the inline style is removed.
- **SUGGESTION-5 — `US.state-matrix` "four-state" gate is weaker than the scenario.** Its generic check accepts `loading || error || busy` per surface and asserts explicit empty/success for only some; the driving is real but the gate itself is thin. I drove Draw generate separately in my probe.

### Could not exercise (this run) — and why

- **Non-text / UI-boundary contrast** (WCAG 1.4.11 reading): not measured — text contrast only.
- **Desktop target sizes**: measured at 390px only.
- **The mobile drawer's focus containment**: not re-measured (WARNING-4).
- **Cross-browser**: Chromium only (Playwright), matching project tooling; no Firefox/WebKit, no real device.
- **Pixel/visual-regression**: findings are computed-style and geometry based, not screenshot diffs.

### Coverage

- **Verified (COMPLIANT): 61/62 scenarios; 44/45 requirements.**
- **Partial: 0/62 scenarios; 0/45 requirements.**
- **Failing: 1/62 scenarios (`DT:Complete scales` / `Primitives consume scale steps`); 1/45 requirements (`DT:Complete scales`).**
- **Untested: 0/62 scenarios; 0/45 requirements** (every row re-driven; unmeasured sub-checks listed above are not scored PASS).

### Verdict

**FAIL — one spec requirement/scenario is not satisfied, with zero functional blockers and zero command failures.**

All suites are green (100 Django, 11 reconcile, 10 tieUtils, 3 career); the committed `static/ui/` reproduces **byte-identically** from a fresh `npm run build` and leaves a clean tracked tree; and my own 19-check probe plus the actor's harness (32/32) confirm the shell, states, accessibility, career and reconciliation rows on the rendered build. Every completed row was re-driven — nothing was carried on byte-identity grounds.

The verdict is `fail` because **`DT:Complete scales` is still not satisfied**. `620a04d` correctly tokenised the 28 declarations it enumerated, and the harness's repaired assertion now validates padding against the space scale alone instead of a union with the radius scale — a genuine fix. But the scenario's predicate is universal over "any … button … badge", and off-space padding survives on real `<button>` elements the rewritten filter never reaches — most visibly the primary shell nav buttons (`.site-nav-link`, `10px 20px`) and the draft pick rows (`.team-row`, `0 10px`), plus the career actions, `.career-option`, `.back-button`, and the `.fx-verdict` / `.animated-team` pills. The harness's `0-offender` PASS cannot be used to argue otherwise: its category filter is a selector-keyword proxy, so a rewritten check that passes is exactly where this false green hid.

Completed counts (44/45 requirements, 61/62 scenarios) fall below the totals a passing verdict requires. This canonical failure is valid and persistable but **not archive-ready**.

`size:exception` is a maintainer delivery decision and did not influence this verdict.
