# FuelGuard dashboard visual reconstruction

**Status:** proposed direction; no production implementation is approved by this document alone  
**Date:** August 15, 2026  
**Scope:** authenticated web application, beginning with the main Dashboard  
**Reference:** user-supplied 1920×1368 WebP dashboard concept (`slika primer .webp`); the image is not stored in this repository

> This document owns the Dashboard's analytical composition. The application shell, page families, data workspaces, tables, forms, tabs, drawers, dialogs, responsive behavior, and migration governance are defined in the companion [enterprise UI reconstruction](./ENTERPRISE-UI-RECONSTRUCTION.md).

## 1. Decision summary

FuelGuard should move toward the reference's **calm, low-contrast analytical workspace**, but it should not copy the reference literally.

The target direction is:

- one dominant analytical story instead of a wall of equally weighted cards;
- softly differentiated tonal surfaces instead of white cards outlined on every side;
- a large, readable primary value paired directly with its trend;
- dashboard-specific navigation that reduces simultaneous information without replacing the global sidebar;
- sparse chart furniture, direct labels, and deliberate FuelGuard accent moments;
- lower text contrast than the current near-black hierarchy, while retaining WCAG AA;
- generous dashboard spacing, with the existing compact density preserved for tables, forms, and operational queues.

This is a **composition reconstruction**, not another global recolor. The first implementation should be a reversible Dashboard prototype in the existing development-only design-system lab.

## 2. Evidence and boundaries

### Verified from the current repository

- There are 56 web page components recursively: 52 top-level pages plus four auth pages.
- Forty-nine pages use the shared page-header pattern.
- There are 147 shared-card usages across web pages and feature components.
- The Dashboard currently contains four priority KPI cards, an eight-cell metric strip, two trend cards, two donut sections, and two risk lists.
- The shell has a responsive, collapsible, role-aware sidebar with more destinations than a horizontal global navigation can safely hold.
- `packages/ui/src/tokens.css` is the canonical token source for both desktop applications.
- `AppCard` already supports `flat`, `bordered`, and `raised` variants.
- Chart.js colors are resolved from semantic `--viz-*` roles and have color-vision checks.
- Dashboard canvas charts have semantic table fallbacks for assistive technology.
- The development-only `/__design-system` route already provides a safe location for A/B prototypes and is excluded from default production builds.
- The current automated contrast gate reports 13.65:1 for primary text on a white surface, 7.44:1 for secondary text, 5.39:1 for tertiary text, and at least 3:1 for essential control boundaries.

### Observed in the rendered current Dashboard at 1280×720

- The sidebar is calm and distinct after the latest token update.
- The page is still read as a sequence of bordered rectangles.
- Four equally shaped KPI cards occupy the first analytical row, but none becomes the page's visual anchor.
- The metric strip is more compact than separate cards, yet its eight equal cells still produce a spreadsheet-like rhythm.
- Trend charts begin below the first viewport on a typical 720px-high display.
- Page title, controls, cards, and charts all use similar visual weight; hierarchy is correct semantically but weak compositionally.
- Placeholder/loading states preserve structure, but the repeated white surfaces make the page feel segmented even before data appears.

### What cannot be inferred from the reference image

- The exact source colors cannot be treated as authoritative because the image may include global tinting, compression, or presentation overlays.
- The reference does not demonstrate keyboard behavior, responsive behavior, loading/error states, dense tables, or long operational labels.
- Its faint text and control boundaries cannot be assumed accessible.
- Its top navigation works for seven destinations; FuelGuard's role-aware navigation has substantially more.
- Its large outer and inner corner radii are part of the concept's presentation, not evidence that the same geometry will work in an all-day fleet product.

Every value below is therefore either a verified current fact or a **prototype candidate** with an explicit validation gate.

## 3. What makes the reference feel different

The reference's calmness comes from six interacting decisions.

### 3.1 One dominant region

The upper analytical region is one large canvas. Identity, user context, primary KPI, secondary values, and the trend chart are composed together rather than placed in separate cards.

### 3.2 Tonal hierarchy

Adjacent regions differ mainly through restrained background tone. Borders are rare and decorative. The interface reads as layers of one material rather than a collection of components.

### 3.3 Variable scale

The primary number is dramatically larger than supporting values. The chart is also visually larger than the controls. The user can determine importance without reading every label.

### 3.4 Selective high-chroma accent

Most of the interface is neutral. A bright yellow-lime signal is reserved for the key action, selected data, and chart emphasis.

### 3.5 Sparse chart furniture

Grid lines, ticks, and labels are faint. The trend, selected point, and tooltip carry the visual emphasis. The chart is integrated into the page rather than framed as a separate widget.

### 3.6 Navigation by level

The concept uses primary navigation at the top and a second horizontal category strip below the hero. The useful transferable idea is **contextual analytical navigation**, not top navigation itself.

## 4. Current FuelGuard strengths to preserve

The reconstruction must preserve the work already completed in the current design system:

- semantic roles instead of raw palette values;
- FuelGuard gold as identity, separate from warning and danger;
- graphite primary actions rather than gold actions everywhere;
- accessible focus indicators and essential control boundaries;
- Hanken Grotesk and tabular numeric presentation;
- one shared input, select, date, filter, card, table, badge, and overlay system;
- the scalable sidebar, collapsed rail, mobile drawer, and account menu;
- explicit loading, empty, error, and retry states;
- keyboard behavior and 36px primary-control sizing;
- reduced-motion and forced-colors rules;
- direct chart labels, accessible tooltips, CVD-tested palettes, and semantic table fallbacks;
- status colors that remain stronger than decorative dashboard color.

The reference should influence **layout, emphasis, surface relationships, and chart presentation**. It should not weaken interaction clarity or semantic status communication.

## 5. Gap analysis

| Area                 | Current FuelGuard                                         | Reference characteristic                                        | Reconstruction decision                                                                         |
| -------------------- | --------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Global navigation    | Deep, grouped, collapsible sidebar                        | Seven-item top navigation                                       | Keep the sidebar; apply the calmer tonal treatment only                                         |
| Page header          | Compact title, subtitle, date, and export above a divider | Large contextual greeting integrated into the analytical region | Create a Dashboard header variant that merges context and primary analysis                      |
| KPI hierarchy        | Four equal cards                                          | One dominant KPI with secondary values                          | Replace equal hero cards with a selectable analytics hero                                       |
| Secondary metrics    | Eight equal divided cells                                 | Values integrated beside the main KPI                           | Use a metric rail with 4–6 decision-relevant values; move the rest into contextual views        |
| Trends               | Two separate chart cards                                  | One large integrated chart                                      | Show one selected metric trend at a time; never combine incompatible units on one axis          |
| Composition/severity | Two carded donut charts                                   | Lower-page analytics use flatter sections                       | Keep the accessible donuts but place them in tonal, border-light sections                       |
| Risk lists           | Two equal cards                                           | Lower modules use a shared grid with quieter containment        | Create one attention section with role-aware queues and optional sub-tabs                       |
| Surfaces             | White card + hairline + shadow repeated                   | Closely related tinted planes                                   | Introduce workspace/panel/tonal surface roles and reserve perimeters for structure              |
| Text                 | Primary text 13.65:1 on white                             | Visually softer text                                            | Lower the primary and secondary contrast deliberately, but never below documented gates         |
| Accent               | Gold identity plus several semantic chart colors          | One neon signal color                                           | Add a narrow signal role derived from FuelGuard gold; do not recolor statuses                   |
| Radius               | 4px controls, 6px surfaces, 10px dialogs                  | Very large shell and hero rounding                              | Keep operational geometry; allow a 10–12px dashboard-hero radius only if the prototype earns it |
| Density              | Compact operational layout everywhere                     | Spacious analytical overview                                    | Add an analytical density mode for Dashboard; preserve operational density elsewhere            |

## 6. Target visual principles

### Principle 1 — content before containers

A section earns a border or separate surface only when containment communicates grouping, interaction, clipping, or elevation. Spacing and typography should do more of the organizational work.

### Principle 2 — one question per analytical region

The first viewport should answer: **How is the fleet performing, and what needs attention now?** It should not ask users to scan 12–15 equally weighted numbers before reaching a trend.

### Principle 3 — quiet by default, strong on exception

Ordinary values use neutral treatments. Danger, caution, and warning remain visually strong only when the data requires attention.

### Principle 4 — low contrast is a hierarchy, not a blanket opacity

Primary, secondary, and supporting text must have intentional contrast bands. Meaningful copy is never faded with arbitrary opacity. Disabled and decorative content are the only roles allowed below normal-text contrast.

### Principle 5 — analytical and operational density are different

The Dashboard may use larger spacing and type. Transaction tables, dispatch workflows, forms, and compliance queues keep compact controls and information density.

### Principle 6 — the accent identifies the active story

FuelGuard's high-chroma signal should identify the selected metric, one primary decision, or an important chart point. It must not decorate every icon or become a substitute for status semantics.

## 7. Proposed Dashboard information architecture

### 7.1 Global shell

Keep the current sidebar and sticky global header. The global header remains intentionally quiet: shell toggle, back navigation when needed, and future global utilities only.

Do not move FuelGuard's full navigation into the top bar.

### 7.2 Dashboard contextual header

The Dashboard content begins with:

- `Fleet overview` as the stable page title;
- a concise operational summary, not a decorative greeting;
- current date range and freshness;
- Date and Export controls;
- an optional single insight sentence generated only from deterministic dashboard data.

Example:

> Fleet overview  
> Fuel spend is 8% above the prior 30 days; idle waste is the largest avoidable increase.

The insight must name its comparison period and must not appear when data is incomplete.

### 7.3 Contextual Dashboard views

Prototype the following view model:

- **Overview:** priority outcome, primary trend, attention summary;
- **Fuel:** spend, gallons, cost composition, declines, reefer;
- **Efficiency:** MPG, miles, idling, driver/vehicle performance;
- **Risk:** severity, active cases, top vehicles, top drivers;
- **Data quality:** telematics coverage, unattributed fills, missing or stale data.

Only `Overview` should ship in the first prototype. Additional tabs become real only after their exact contents and user need are verified; do not ship empty navigation.

Use an accessible tablist or routed query state so the selected view is shareable and Back/Forward behavior remains predictable.

### 7.4 Analytics hero

The hero replaces the current four-card KPI row plus the two separate trend cards.

Desktop composition:

```text
┌────────────────────────────────────────────────────────────────────┐
│ Fleet overview                     [Dates] [Export]                │
│ Fuel, efficiency, and risk · Jul 16–Aug 15                        │
│                                                                    │
│ Fuel spend             change / comparison     selected insight    │
│ $128.4k                +8.2% vs prior period                       │
│                                                                    │
│ [Fuel spend] [MPG] [Idle waste] [Active alerts]                   │
│                                                                    │
│                 large selected-metric trend                        │
│                                                                    │
│ Fill-ups   Gallons   Miles   Coverage   Reefer   Declines          │
└────────────────────────────────────────────────────────────────────┘
```

Behavior:

- The four priority metrics act as a tab/radio selection for the hero chart.
- Selecting a metric updates the big value, comparison, chart, tooltip, and related drill-down link.
- A separate `View details` link preserves navigation semantics; selecting a metric does not unexpectedly navigate.
- Fuel spend is the initial candidate because it is the most broadly relevant business outcome. This default must be confirmed with real users.
- Incompatible units are never plotted together on one axis.
- Date-range changes update the entire Dashboard, as they do today.

### 7.5 Attention section

Below the hero, create one `Needs attention` region instead of treating every risk list as an independent card.

It may contain:

- critical/high cases;
- declined fueling attempts;
- data-quality gaps that make the headline unreliable;
- top vehicles or drivers contributing to current risk.

The region should be role-aware. A dispatcher, safety manager, and owner may see different ordering, but the first implementation must use the existing authorization and dashboard data rather than inventing new personalization logic.

### 7.6 Secondary analytics

Cost composition, severity, and lower-priority lists remain available below the attention region or in contextual views. They use flatter tonal sections, not automatically elevated cards.

## 8. Responsive layout blueprint

### Wide desktop — 1440px and above

- Existing 272px expanded sidebar may remain for the prototype.
- Dashboard content uses a 12-column grid.
- Hero occupies all 12 columns.
- Inside the hero, summary occupies approximately four columns and the chart eight.
- Secondary analytics use 7/5 or 8/4 proportions when the data benefits; avoid automatic 6/6 symmetry.

### Standard desktop — 1024–1439px

- Use an eight-column content grid.
- Hero summary remains above or beside the chart depending on measured label fit.
- Metric rail may wrap to two rows rather than truncating meaningful labels.
- Sidebar collapse remains available.

### Tablet/narrow desktop — 768–1023px

- Use the mobile drawer shell behavior already implemented below `lg`.
- Hero becomes a single vertical region: summary, metric selector, chart, metric rail.
- Contextual tabs may horizontally scroll, with a visible overflow cue.

### Mobile — below 768px

- Single-column analytical flow.
- Primary value remains large but scales down from desktop.
- Metric selector becomes a two-by-two grid, not four tiny pills.
- Chart uses a minimum useful height and fewer x-axis ticks.
- Secondary metrics become a two-column list with full labels.
- No interaction relies on hover.

## 9. Candidate tonal system for the prototype

These values are a **prototype candidate**, not a production token replacement. They are intentionally greener and more atmospheric than the current cool-blue canvas to test the reference direction.

| Role                 | Candidate                | Calculated contrast/use                         |
| -------------------- | ------------------------ | ----------------------------------------------- |
| `workspace-canvas`   | `oklch(0.965 0.012 185)` | soft gray-teal page atmosphere                  |
| `panel-surface`      | `oklch(0.98 0.008 185)`  | primary analytical plane                        |
| `panel-muted`        | `oklch(0.95 0.012 185)`  | metric rail, hover, grouped supporting content  |
| `navigation-surface` | `oklch(0.945 0.015 185)` | distinct but related sidebar plane              |
| `ink-emphasis`       | `oklch(0.37 0.025 250)`  | 9.85:1 on `panel-surface`                       |
| `ink-secondary`      | `oklch(0.48 0.022 250)`  | 6.17:1 on `panel-surface`                       |
| `ink-supporting`     | `oklch(0.53 0.018 250)`  | 4.99:1 on panel; 4.51:1 on navigation           |
| `signal-accent`      | `oklch(0.88 0.17 92)`    | 7.22:1 with `ink-emphasis`; selected story only |

Rules:

- Keep `surface`, `canvas`, and navigation roles semantic. Do not name tokens `teal-1` or `light-green`.
- Keep the current `edge-control` or another verified 3:1 equivalent for essential input boundaries.
- Decorative dividers may be much quieter because their contrast is not carrying control identification.
- Status backgrounds and text remain on the existing danger/caution/warning/success/info roles.
- `signal-accent` is not `warning` and not the default focus ring.
- Meaningful normal text remains at least 4.5:1; large text remains at least 3:1.
- Required graphical control states and boundaries remain at least 3:1.
- The prototype contrast script must include every foreground against every surface on which it appears.

The lower-contrast target is approximately:

- primary text: 9–11:1 instead of the current 13.65:1;
- secondary text: 5.8–7:1 instead of 7.44:1;
- supporting meaningful text: 4.5–5.2:1 instead of 5.39:1.

Do not target the legal minimum for all roles. Monitor quality, font rendering, size, and prolonged use require safety margin.

## 10. Surface, border, elevation, and shape changes

### Surfaces

Extend the shared surface vocabulary deliberately:

- `flat`: no separate background; spacing establishes the section;
- `tonal`: panel or muted surface, no perimeter by default;
- `bordered`: quiet structural perimeter for tables, forms, and bounded interactive regions;
- `raised`: limited emphasis;
- `overlay`: menus, popovers, dialogs, drawers.

`AppCard` may gain a `tonal` variant, or a separate `AppSurface` primitive may become the canonical name. Do not create both without a clear migration contract.

### Borders

- Remove decorative card rings from the Dashboard hero and tonal analytical sections.
- Keep quiet dividers where they improve scan alignment.
- Keep explicit essential boundaries on inputs, selects, dates, filters, and focus states.
- Do not simulate grouping by making every border darker.

### Elevation

- Dashboard hero: no shadow or only the existing lowest card elevation after visual comparison.
- Tonal analytical sections: no shadow.
- Popovers, menus, and dialogs: keep semantic overlay/dialog shadows.
- Hover: use surface change, not lift.

### Radius

- Keep 4px controls and 6px ordinary operational surfaces.
- Test 10–12px only on the Dashboard hero and major analytical regions.
- Do not introduce the reference's 24–40px container rounding into tables, filters, forms, or navigation items.
- Full pills remain limited to counts, avatars, compact selectors, and true pill interactions.

## 11. Typography reconstruction

Retain Hanken Grotesk. The reference's softer, editorial feeling can be created through scale, weight, and spacing without introducing an unverified font dependency.

Prototype roles:

| Role              | Proposed behavior                                                |
| ----------------- | ---------------------------------------------------------------- |
| Dashboard title   | 24–28px, medium or semibold                                      |
| Dashboard summary | 16–18px, regular, secondary ink                                  |
| Primary KPI       | 48–64px desktop; 40–48px mobile; medium weight; tabular numerals |
| KPI comparison    | 14px, medium; status color only when semantically meaningful     |
| Section title     | 16–18px, semibold                                                |
| Metric value      | 20–24px, medium/semibold, tabular numerals                       |
| Body/control      | 14–15px                                                          |
| Supporting label  | 12–13px, supporting ink, never arbitrary opacity                 |

Avoid very thin weights. The reference's thin display text contributes to its look but would become fragile at FuelGuard's smaller sizes and lower contrast.

## 12. Chart reconstruction

Preserve the existing semantic chart infrastructure and accessibility fallbacks. Change presentation, not the data contract.

### Trend hero

- One selected series at a time.
- 2px or 2.5px line with round joins.
- Very restrained area wash or no fill; compare both in the lab.
- Fewer y-axis ticks and faint grid lines.
- Direct unit in the selected KPI and tooltip.
- Visible selected point/crosshair on pointer or keyboard interaction.
- Prior-period comparison may use a muted dashed reference line if the API supplies aligned data; do not fabricate comparison series in the client.

### Donuts

- Retain center total, direct legend labels, exact values, percentages, and semantic table fallback.
- Reduce slice decoration and card containment.
- Do not use the bright signal accent for danger severity.
- Consider replacing a donut with a ranked bar when precise comparison is more important than share-of-whole. This is a per-chart decision, not a global rule.

### Palette

- Use one accent for the selected ordinary series.
- Keep categorical colors separated under protan, deutan, and tritan simulation.
- Keep alerts on the status palette.
- Never use multiple decorative gradients. Carbon's current guidance specifically discourages multiple gradients and recommends deliberate color against rich neutrals.

## 13. Component reconstruction map

| Current component/file                 | Reconstruction responsibility                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/pages/DashboardPage.vue` | Become composition only; move hero/view logic into dashboard feature components                                   |
| `StatCard.vue`                         | Replace on Dashboard with selectable `HeroMetric`; retain only where a standalone KPI card is justified elsewhere |
| `ChartCard.vue`                        | Add flat/tonal integrated presentation or replace with `InsightPanel` composition                                 |
| `DonutBreakdown.vue`                   | Preserve data/ARIA behavior; add compact and integrated layouts                                                   |
| `SeverityBreakdown.vue`                | Become content for the Risk view or attention region rather than always a standalone card                         |
| `RiskList.vue`                         | Support embedded/section presentation without adding another surface                                              |
| `BaseChart.vue`                        | Preserve lifecycle; add no visual policy here                                                                     |
| `chartTheme.ts`                        | Add hero-trend options, selected-point treatment, and optional prior-period reference style                       |
| `AppCard.vue`                          | Evaluate one `tonal` variant; do not turn Dashboard-specific layout into package API                              |
| `PageHeader.vue` / `AppPageHeader.vue` | Add a Dashboard composition variant only if slots cannot express the verified design cleanly                      |
| `AppShell.vue`                         | Keep navigation architecture; only adjust shell spacing/surface tokens after the Dashboard prototype is approved  |
| `tokens.css`                           | Add semantic analytical surface/signal roles only after candidate contrast and rendered validation pass           |

Proposed domain components in `apps/web/src/features/dashboard/`:

- `DashboardViewTabs.vue`;
- `AnalyticsHero.vue`;
- `HeroMetric.vue`;
- `MetricRail.vue`;
- `AttentionSection.vue`;
- `InsightPanel.vue`.

These are domain compositions, not candidates for `@fuelguard/ui` until another product surface demonstrates the same need.

## 14. How the direction propagates beyond Dashboard

The Dashboard is the pilot, but a coherent system eventually needs the following selective migration.

### List pages

- Keep compact density.
- Continue using the integrated filter/table workspace.
- Adopt the tonal canvas and softer default text.
- Avoid removing the table boundary if it is needed to distinguish the scrollable data region.

### Detail pages

- Replace stacks of small cards with two or three named sections on a shared surface.
- Use tabs only when sections are genuinely peer views and users benefit from reduced simultaneous content.

### Settings and forms

- Keep visible labels and essential control boundaries.
- Use tonal section backgrounds to group related settings instead of enclosing every field group in a card.
- Do not apply Dashboard display typography to forms.

### Drawers, menus, and dialogs

- Keep stronger overlay separation, focus management, and semantic elevation.
- Low-contrast decorative treatment must not make floating layers ambiguous.

### Admin application

- Consume any approved shared tonal/text roles.
- Do not reproduce the analytical hero unless the admin page has an equivalent analytical purpose.

## 15. Reconstruction sequence

### Phase 0 — Baseline and prototype contract

1. Capture current Dashboard screenshots at 1440×900, 1280×720, 900×720, and 390×844 with realistic seeded data.
2. Record current first-viewport content, vertical page length, loading state, and keyboard order.
3. Add a new reconstruction mode to `/__design-system`; keep it development-only.
4. Implement the candidate tonal tokens as isolated `--prototype-reconstruction-*` roles.
5. Build two hero alternatives: summary-left/chart-right and summary-above/chart-below.

**Exit gate:** side-by-side rendered prototype with no production token or route changes.

### Phase 1 — Dashboard composition prototype

1. Build Dashboard view tabs with only Overview enabled.
2. Build the selectable analytics hero using static representative data first.
3. Build the metric rail and attention section.
4. Render cost composition, severity, and risk lists in integrated tonal sections.
5. Validate desktop, narrow, mobile, loading, empty, error, and long-label states.

**Exit gate:** stakeholder selects one composition and explicitly confirms the default hero metric and contextual-view labels.

### Phase 2 — Token and component promotion

1. Finalize semantic surface, text, signal, and chart roles from the selected prototype.
2. Extend the contrast matrix for all new surface/foreground pairs.
3. Add the smallest shared surface variant required by the approved design.
4. Keep Dashboard compositions within the dashboard feature folder.
5. Add component tests for keyboard metric selection, tab state, drill-down links, and reduced motion.

**Exit gate:** token, accessibility, unit, type, lint, and production-build gates pass.

### Phase 3 — Production Dashboard migration

1. Connect the selected hero to existing dashboard data.
2. Add prior-period data only if the backend/query contract can provide aligned and trustworthy comparisons.
3. Preserve date scoping, exports, links, loading behavior, and accessible chart tables.
4. Verify no increase in dashboard query count or payload caused purely by presentation.
5. Compare screenshots and keyboard order with the prototype.

**Exit gate:** functional parity plus approved visual comparison with realistic data.

### Phase 4 — Representative system migration

Apply the approved direction to one page from each class:

- Transactions — dense list/data workspace;
- Vehicle Detail — detail/analytical page;
- Driver Performance Settings — form/settings page;
- one drawer and one popover-heavy workflow.

This tests whether the tonal system works outside the spacious Dashboard without weakening control clarity.

**Exit gate:** no regression in table scan speed, form completion, keyboard behavior, or status recognition.

### Phase 5 — Controlled broader rollout

1. Migrate by page template, not by global search-and-replace.
2. Update the component-adoption inventory as each class is completed.
3. Remove obsolete prototype roles only after production roles are stable.
4. Keep a documented exception list for surfaces that require stronger boundaries or density.

## 16. Acceptance criteria

### Visual

- The first desktop viewport contains the primary KPI and its meaningful trend.
- No more than four equal-priority hero metrics are visible.
- The Dashboard no longer reads as a wall of bordered cards.
- One selected analytical story is visibly dominant.
- Ordinary metrics are neutral; semantic color appears only for real state or exception.
- Sidebar, page canvas, hero, muted regions, and overlays are distinguishable without strong colored borders.

### Accessibility

- Meaningful normal text is at least 4.5:1 on every actual surface.
- Large text is at least 3:1, with higher internal targets for primary KPIs.
- Essential controls and states are at least 3:1 against adjacent colors.
- Focus remains visible and unobscured.
- Metric selection and contextual tabs work by keyboard and expose correct semantics.
- Charts retain accessible names, exact tooltip values, direct labels/legends, and semantic table fallbacks.
- Color is never the only cue.
- Reflow at 200% and mobile widths does not clip controls, labels, values, or charts.

### Operational

- Date range, export, drill-down, role visibility, and refresh behavior remain intact.
- The Dashboard does not add client-side aggregation or additional polling solely for presentation.
- Critical/high conditions remain easier to find than ordinary trends.
- Loading, empty, partial-data, stale-data, and query-error states are designed explicitly.
- Users can tell when comparisons are unavailable rather than seeing a misleading zero.

### System

- Shared tokens remain canonical in `packages/ui/src/tokens.css`.
- No raw colors, local card recipes, or new untracked shadows are introduced.
- Dashboard-specific layout remains outside the shared primitive package.
- Existing token, UI-adoption, contrast, chart-CVD, lint, type, test, and build gates pass.

## 17. Validation with representative users

The reconstruction should be tested with at least the roles that keep FuelGuard open for long periods:

- dispatcher or fleet operator;
- safety/compliance user;
- owner or manager.

Use scenario tasks rather than preference alone:

1. Identify the most important change in fleet performance.
2. Find the highest-priority problem requiring action.
3. Determine whether the headline data is trustworthy and current.
4. Navigate from the headline to the relevant detail page.
5. Change the reporting period and explain what changed.

Measure:

- time to first correct answer;
- missed critical items;
- wrong drill-downs;
- comprehension of comparison period;
- perceived visual fatigue after extended realistic use;
- preference only after the task measures are captured.

## 18. Explicit non-goals

- Replacing the sidebar with global top navigation.
- Applying a neon accent to every primary action or status.
- Making every page as spacious as the Dashboard.
- Removing essential input, focus, table, or overlay boundaries.
- Introducing a new font solely to imitate the reference.
- Rewriting Dashboard data queries before a visual prototype proves that new data is required.
- Applying large radii globally.
- Shipping contextual tabs that have no complete content.
- Treating the supplied image as an exact color specification.

## 19. Current-practice references

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — 4.5:1 normal text, 3:1 large text, and 3:1 essential non-text UI contrast.
- [W3C Understanding text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) — low-contrast text disproportionately affects people with reduced contrast sensitivity.
- [Atlassian semantic design tokens](https://atlassian.design/foundations/tokens/design-tokens/) — tokens should describe meaning rather than matching a convenient color value.
- [Atlassian elevation](https://atlassian.design/foundations/elevation/) — use paired surface/elevation roles and avoid excessive raised surfaces.
- [Carbon chart anatomy](https://carbondesignsystem.com/data-visualization/chart-anatomy/) — descriptive titles, direct labels where possible, useful tooltips, and restraint in chart furniture.
- [Carbon data-visualization palettes](https://carbondesignsystem.com/data-visualization/color-palettes/) — deliberate categorical order, accessible separation, and restraint with gradients.

## 20. Recommendation

Proceed with a **Dashboard-only reconstruction prototype** using the existing development design-system lab. The prototype should test the tonal candidate, analytics hero, metric selection, contextual views, attention region, and integrated secondary analytics together. Do not promote individual color values or component variants before the complete composition is rendered.

If the prototype improves scan hierarchy while passing contrast, keyboard, responsive, and role-based validation, promote the minimum required semantic roles and components, migrate the production Dashboard, and then test the direction on one dense list, one detail page, and one settings page before broader rollout.
