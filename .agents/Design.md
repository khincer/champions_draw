# Champions Draw — Design System

> **Status:** Initial implementation guide
> **Reference:** OneSports — Football Dashboard (Figma Community)
> **Project:** Champions Draw
>
> **Note:** The supplied Figma file could not be inspected directly from this environment. This document defines an implementation-ready football dashboard design direction inspired by the reference title and intended for validation against the actual Figma screens. Replace any inferred values with exact Figma measurements when screenshots or exported assets are available.

## 1. Product direction

Champions Draw is a football tournament and analytics application. The interface should feel like a modern sports platform: energetic, data-focused, readable, and usable on desktop and mobile.

Primary experiences:

1. Explore competitions and teams.
2. Generate and inspect tournament draws.
3. Review fixtures, results, and team form.
4. View football statistics and predictions.
5. Understand how a draw or prediction was generated.

## 2. Design principles

- **Sport-first:** Football context should be immediately visible.
- **Data clarity:** Numbers, labels, status, and trends must be easy to scan.
- **Progressive disclosure:** Show the most important information first; reveal detail on demand.
- **Trust and reproducibility:** Display model versions, timestamps, seeds, and rule sets when relevant.
- **Responsive by default:** Desktop dashboards must collapse into useful mobile layouts.
- **Accessible contrast:** Never rely on color alone to communicate status or outcome.
- **Consistent density:** Use compact data rows, but preserve comfortable touch targets.

## 3. Visual language

### 3.1 Overall style

Use a dark sports-dashboard foundation with light content surfaces where useful. The visual language should combine:

- Deep navy or charcoal backgrounds.
- White and muted gray text.
- A bright green accent associated with the pitch and positive actions.
- Secondary blue/purple accents for analytics and information.
- Rounded cards with restrained shadows.
- Strong numerical typography.
- Small status badges and compact tabs.

Avoid excessive gradients, neon effects, or decorative elements that compete with match data.

### 3.2 Suggested color tokens

These are proposed tokens, not extracted Figma values.

```css
:root {
  --color-bg: #f5f7fb;
  --color-surface: #ffffff;
  --color-surface-muted: #eef2f7;
  --color-sidebar: #101827;
  --color-sidebar-hover: #1b293d;
  --color-text: #142033;
  --color-text-muted: #718096;
  --color-border: #e4e9f0;

  --color-primary: #20b26b;
  --color-primary-hover: #17965a;
  --color-primary-soft: #e4f7ed;

  --color-info: #4d7cff;
  --color-info-soft: #eaf0ff;
  --color-warning: #f4a340;
  --color-warning-soft: #fff4df;
  --color-danger: #e85d75;
  --color-danger-soft: #ffecef;

  --color-dark-text: #f8fafc;
  --color-dark-muted: #9aa8bb;
}
```

Dark theme tokens:

```css
[data-theme="dark"] {
  --color-bg: #0d1420;
  --color-surface: #151f2e;
  --color-surface-muted: #1d2939;
  --color-text: #f5f7fb;
  --color-text-muted: #9aa8bb;
  --color-border: #2b394c;
}
```

## 4. Typography

Use a modern sans-serif font. Recommended options:

- Inter
- Plus Jakarta Sans
- Manrope

Suggested scale:

| Token | Size | Weight | Usage |
|---|---:|---:|---|
| Display | 32–40px | 700 | Main dashboard metric or page title |
| H1 | 28–32px | 700 | Page headings |
| H2 | 22–24px | 700 | Section headings |
| H3 | 16–18px | 700 | Card headings |
| Body | 14–16px | 400 | Main content |
| Small | 12–13px | 400–500 | Metadata and captions |
| Label | 11–12px | 600 | Uppercase labels and badges |

Numerical data should use tabular figures when supported:

```css
.metric,
.score,
.table-number {
  font-variant-numeric: tabular-nums;
}
```

## 5. Layout

### 5.1 Desktop shell

```text
┌──────────────────────────────────────────────────────────────┐
│ Sidebar │ Top bar: search, notifications, profile            │
│         ├────────────────────────────────────────────────────┤
│         │ Page title / breadcrumbs                           │
│         │                                                    │
│         │ Main dashboard content                             │
│         │                                                    │
│         │ Cards, tables, charts, activity                     │
└──────────────────────────────────────────────────────────────┘
```

Suggested dimensions:

- Sidebar: 232–264px.
- Top bar: 64–72px.
- Main content max width: 1440px.
- Page padding: 24–32px desktop, 16px mobile.
- Card gap: 16–24px.
- Card radius: 12–16px.

### 5.2 Responsive behavior

At widths below approximately 900px:

- Collapse the sidebar into a drawer or bottom navigation.
- Convert multi-column metric cards into two columns or a horizontal scroll.
- Turn tables into stacked rows or horizontally scrollable data regions.
- Move filters into a collapsible filter panel.
- Preserve primary actions near the top of the page.

At widths below approximately 640px:

- Use one-column cards.
- Reduce page padding to 16px.
- Stack chart controls.
- Keep buttons at least 44px high.
- Avoid dense multi-column tables unless horizontal scrolling is explicit.

## 6. Navigation

Primary navigation should be organized around user tasks:

- Dashboard
- Competitions
- Teams
- Matches
- Draws
- Statistics
- Predictions
- Settings

Navigation states:

- Default: muted icon and text.
- Hover: subtle surface highlight.
- Active: primary accent, stronger text, and optional left indicator.
- Disabled: reduced opacity and no pointer interaction.

## 7. Core components

### 7.1 App shell

Responsibilities:

- Sidebar navigation.
- Top bar.
- Breadcrumbs.
- Responsive menu behavior.
- Theme preference.
- Global notifications.

### 7.2 Metric card

Use for:

- Matches played.
- Teams.
- Draws generated.
- Prediction accuracy.
- Average goals.

Structure:

```text
[Icon]                       [Period selector]
Label
Large metric value            [Trend badge]
Supporting comparison text
```

Rules:

- One primary number per card.
- Use a short label.
- Use trend color only with text or icon support.
- Keep the value visually dominant.

### 7.3 Competition card

Display:

- Competition logo or placeholder.
- Competition name.
- Country or governing body.
- Season.
- Status.
- Number of teams.
- Primary action.

### 7.4 Team row

Display:

- Crest/avatar.
- Team name.
- Country.
- Form indicator.
- Rating or position.
- Optional action menu.

Use consistent crest sizing and fallback initials when an image is unavailable.

### 7.5 Match row

Display:

- Competition and kickoff time.
- Home team and away team.
- Team crests.
- Score or scheduled time.
- Match status.
- Optional prediction probabilities.

Statuses:

- Scheduled
- Live
- Finished
- Postponed
- Cancelled

### 7.6 Draw result card

Display:

- Competition and season.
- Generated timestamp.
- Random seed.
- Rules version.
- Validation status.
- Pairings or groups.
- Copy/export action.

A draw should visibly communicate whether it passed all constraints.

### 7.7 Status badge

Use concise labels:

- `Live`
- `Finished`
- `Scheduled`
- `Valid`
- `Invalid`
- `Processing`
- `Draft`

Do not communicate status with color alone.

### 7.8 Tabs

Recommended tab groups:

- Overview / Fixtures / Results / Statistics
- Summary / Draw / Rules / History
- Performance / Predictions / Evaluation

Tabs should have a clear active state and support keyboard navigation.

### 7.9 Buttons

Variants:

- Primary: green filled button for the main action.
- Secondary: neutral outlined or soft button.
- Ghost: low-emphasis action.
- Danger: destructive action with confirmation.

Examples:

- Generate draw
- View competition
- Run prediction
- Export results
- Retry import

### 7.10 Data table

Rules:

- Sticky header for long tables.
- Right-align numerical columns.
- Use tabular figures.
- Provide empty, loading, and error states.
- Support sorting only where it is meaningful.
- On mobile, use responsive cards or controlled horizontal scrolling.

## 8. Page designs

### 8.1 Dashboard

Purpose: give users a quick overview of football activity.

Suggested sections:

1. Greeting and date/competition selector.
2. Summary metric cards.
3. Upcoming matches.
4. Recent draw activity.
5. Team or competition performance chart.
6. Quick actions.

Primary actions:

- Generate a draw.
- Browse competitions.
- View statistics.

### 8.2 Competitions page

Features:

- Search.
- Filter by country, season, and status.
- Competition cards or table.
- Create custom competition if supported.

### 8.3 Competition detail page

Sections:

- Competition header.
- Season selector.
- Overview metrics.
- Teams.
- Fixtures.
- Results.
- Draw history.
- Statistics.

### 8.4 Draw page

Flow:

1. Select competition and season.
2. Select teams or seed input.
3. Configure rules.
4. Set optional random seed.
5. Generate draw.
6. Validate result.
7. Display and save result.

Important UI states:

- Ready to generate.
- Validating input.
- Generating.
- Validation failed.
- Draw completed.
- Draw saved.

### 8.5 Statistics page

Suggested sections:

- Team comparison.
- Goals scored and conceded.
- Home/away performance.
- Form over time.
- League table.
- Rating history.
- Model evaluation.

Charts should always show:

- Title.
- Time range or competition.
- Units.
- Legend where necessary.
- Empty state when insufficient data exists.

### 8.6 Prediction page

Display:

- Match context.
- Model name and version.
- Home/draw/away probabilities.
- Expected goals.
- Recent team form.
- Data timestamp.
- Model limitations.

Avoid presenting probabilities as certainty. Use explanatory copy such as “Model estimate” or “Historical-data-based probability.”

## 9. Charts and data visualization

Recommended chart types:

| Use case | Chart |
|---|---|
| Goals over time | Line chart |
| Team comparison | Grouped bar chart |
| Win/draw/loss share | Stacked bar or small donut |
| Rating history | Line chart |
| Prediction calibration | Reliability plot |
| Match score probabilities | Heatmap |
| League position | Line chart or table |

Visualization rules:

- Keep gridlines subtle.
- Use consistent team colors only when meaningful.
- Provide accessible labels and tooltips.
- Avoid pie charts for many categories.
- Never hide exact values behind hover alone on mobile.

## 10. Forms and validation

Form requirements:

- Visible labels.
- Helpful placeholder text only when necessary.
- Inline validation messages.
- Clear required-field indicators.
- Disabled submit state during requests.
- Preserve entered values after validation errors.
- Show server errors in a readable summary.

Draw configuration fields may include:

- Competition.
- Season.
- Teams.
- Draw rules.
- Random seed.
- Number of groups or pairings.

## 11. Loading, empty, and error states

Every data-driven component must support:

### Loading

- Skeleton cards or rows.
- Preserve approximate layout dimensions.
- Avoid unnecessary full-page spinners.

### Empty

Explain why there is no data and provide a useful next action.

Example:

> No matches have been imported for this competition yet.
>
> Import match data to view statistics.

### Error

Show:

- What failed.
- Whether the user can retry.
- A safe technical reference if useful.

Example:

> We could not generate the draw because the selected constraints cannot be satisfied. Review the rules and try again.

## 12. Accessibility

- WCAG AA contrast target.
- Keyboard-accessible navigation and dialogs.
- Visible focus states.
- Semantic headings.
- Accessible names for icon-only buttons.
- Do not rely on color alone.
- Minimum 44px touch targets.
- Respect reduced-motion preferences.
- Use `aria-live` for async status updates.
- Provide text alternatives for charts.

## 13. Motion

Use motion sparingly:

- Short fade/slide for drawers and dialogs.
- Subtle hover transitions.
- Progress indicator during draw generation.
- Avoid continuous animation in data dashboards.
- Respect `prefers-reduced-motion`.

## 14. Frontend implementation guidance

Suggested component structure:

```text
frontend/
├── app/
├── components/
│   ├── layout/
│   ├── navigation/
│   ├── cards/
│   ├── matches/
│   ├── draws/
│   ├── statistics/
│   └── charts/
├── features/
│   ├── competitions/
│   ├── teams/
│   ├── matches/
│   ├── draws/
│   └── predictions/
├── lib/
│   ├── api/
│   ├── formatting/
│   └── validation/
└── styles/
```

Keep domain-specific behavior close to its feature. Reuse presentational components for cards, tables, badges, buttons, and layout.

## 15. Design tokens and implementation checklist

- [ ] Confirm exact colors from Figma.
- [ ] Confirm font family and weights.
- [ ] Confirm sidebar and top-bar dimensions.
- [ ] Confirm card radius and shadows.
- [ ] Confirm desktop/mobile breakpoints.
- [ ] Export logos, icons, and team crest assets.
- [ ] Build app shell.
- [ ] Build buttons, badges, cards, tabs, tables, and form controls.
- [ ] Build dashboard page.
- [ ] Build competition page.
- [ ] Build draw configuration and results pages.
- [ ] Build statistics page.
- [ ] Add loading, empty, and error states.
- [ ] Test keyboard navigation and responsive behavior.

## 16. Product-specific UX requirements

### Draw integrity

The UI must make it clear that a draw is generated from:

- A defined team list.
- A defined rule set.
- A random seed, when applicable.
- A specific algorithm version.

### Statistical transparency

The UI must distinguish:

- Observed statistics.
- Model inputs.
- Model estimates.
- Actual results.
- Evaluation metrics.

### Data freshness

Show when statistics were last updated. If data is incomplete, explain the limitation instead of displaying misleading precision.

## 17. Suggested first implementation slice

Build the following vertical slice before expanding the entire dashboard:

1. App shell and navigation.
2. Competition selector.
3. Draw configuration form.
4. Draw generation request.
5. Draw result card.
6. Validation status.
7. Saved draw history.

This slice proves the core product workflow and gives the design system a concrete use case.

## 18. Open questions for Figma validation

Before treating this document as pixel-perfect, confirm:

- Exact visual theme: light, dark, or both.
- Exact primary accent color.
- Typography and font files.
- Sidebar navigation labels.
- Dashboard card composition.
- Chart types and chart colors.
- Mobile navigation behavior.
- Existing component states.
- Icon library.
- Spacing and radius scale.

---

**Next action:** Compare this guide with exported Figma screenshots or a Figma PDF export, then replace the proposed tokens and page compositions with exact measurements and component states.
