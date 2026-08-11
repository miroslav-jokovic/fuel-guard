# FuelGuard UI/UX and design-system audit

**Date:** August 11, 2026

**Scope:** `apps/web`, `apps/admin`, and `packages/ui`
**Primary use case:** dispatch, safety, compliance, and fleet users who may keep the dashboard open throughout the workday

## Executive verdict

FuelGuard already has a better foundation than the rendered interface suggests. The semantic color-token layer is coherent, the web app has useful shared primitives, and the main list pages follow a recognizable pattern. Both token checks pass.

The main problem is not simply “bright colors” or “rounded corners.” It is the combination of:

1. low-contrast tertiary copy used for meaningful information;
2. weak control boundaries and incomplete focus/keyboard behavior;
3. excessive card containment and elevation;
4. too many equally prominent KPI tiles and status colors;
5. a page header split between the sticky shell and page content;
6. shared components that are optional in practice, with many local implementations;
7. a separate admin surface that shares only a small subset of the system.

The best direction is a **calm operational workbench**: the supplied cool-gray canvas and warm-gold identity, stronger readable text, flatter sections, one clear page header, one unified table workspace, color reserved for meaning, and a compact-but-accessible density.

The supplied schema is a useful visual direction, but it is **not safe as a direct token replacement**. Its gold values exactly equal FuelGuard's existing caution ramp, its focus ring is below 3:1, its destructive foreground/background pair is below 3:1, and its control borders are too faint. The implementation plan below therefore separates brand accent, primary action, focus, and status roles before any page migration.

### Priority summary

| Priority | Finding                                                                                                             | Why it matters                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| P0       | `ink-subtle` is 2.60:1 on white but is used for real 11–12px information                                            | WCAG AA risk and daily readability problem                                              |
| P0       | Input/control boundary token is 1.47:1 on white                                                                     | Below the 3:1 non-text contrast requirement when the boundary identifies the control    |
| P0       | Custom select/combobox widgets do not implement the expected keyboard model                                         | Keyboard and assistive-technology users cannot operate them reliably                    |
| P0       | Clear controls are nested inside filter/date buttons                                                                | Invalid nested interaction and inconsistent focus behavior                              |
| P0       | The supplied `primary` is exactly the current `caution-300` and related supplied values reuse the same caution ramp | A direct swap would make brand/action and operational warning states visually ambiguous |
| P1       | 147 `BaseCard` instances and 307 radius utilities create a tiled, visually repetitive UI                            | Slower scanning and a dated “dashboard template” feel                                   |
| P1       | The dashboard presents 15 KPI tiles before its main analytical content                                              | High cognitive load and weak prioritization                                             |
| P1       | Page title, page description, and actions are split between two header levels                                       | Users must scan two regions to understand and act on the page                           |
| P1       | Raw selects, checkboxes, textareas, buttons, and tables remain in feature/page code                                 | Visible inconsistencies and repeated accessibility bugs                                 |
| P1       | Admin uses three hand-written tables across six pages                                                               | The two desktop products do not share a complete system                                 |
| P1       | Web mirrors all shared token declarations instead of importing the canonical stylesheet                             | Every foundation change requires synchronized edits and parity checking                 |
| P2       | No shipped dark/dim theme or user density preference                                                                | Missed comfort and personalization options for all-day use                              |

## Scope and method

This audit used four kinds of evidence:

- static inspection of all Vue pages, feature components, shared primitives, tokens, and layouts;
- rendered inspection of the locally built authenticated dashboard, Transactions, Drivers, and Settings pages at 1280×720;
- automated design-token and parity checks;
- comparison with current W3C accessibility guidance and the current Atlassian, Carbon, and Fluent design systems.

The temporary local build used the existing development bypass and did not modify product source. API-backed pages were evaluated in their empty/loading states, so this report assesses structure, visual language, and interaction implementation rather than the quality of production data.

### Evidence labels used in the revised plan

- **Verified — code:** directly counted or traced in the current repository snapshot.
- **Verified — calculation:** contrast computed from the stated OKLCH values using WCAG relative luminance; translucent colors were composited over their stated surface first.
- **Proposed:** a design recommendation, not a fact about the current product and not approved merely by appearing in this report.
- **Validation gate:** evidence that must be collected from a rendered prototype, automated check, or representative user before rollout.

No proposed token value below should be treated as production-approved until its stated validation gate passes.

## What is already good

Do not replace the system wholesale. Preserve these parts:

- `packages/ui/src/tokens.css` already separates primitive ramps from semantic roles and is documented in code as the canonical shared source.
- The system uses OKLCH, which is a good basis for perceptually controlled ramps.
- The admin app imports the shared token layer directly.
- The web app's mirrored token declarations are protected by a parity check, so drift is detectable even though the duplication should be removed.
- `pnpm --filter @fuelguard/web lint:tokens` passes.
- `pnpm lint:tokens-parity` passes with 197 shared declarations matching.
- The dark graphite sidebar is calmer than a fully saturated brand-colored rail.
- `DataTable`, `FilterBar`, `FormField`, `BaseInput`, `BaseButton`, and `SlideOver` establish useful patterns.
- The shell is responsive and collapsible, and respects reduced-motion preferences for the sidebar transition.
- Most list pages have search, filter, count, empty, error, and pagination concepts in the right general places.
- Hanken Grotesk is legible and appropriate for the web operational product. The admin app currently has no explicit shared font declaration and therefore is not yet typography-consistent.

The right project is therefore **system consolidation and visual recalibration**, not a ground-up rewrite.

## Quantitative inventory

These counts are from the current source snapshot. Some raw elements are legitimate implementation details, but they show how large the exception surface is.

| Measure                                         |                                                                 Current result |
| ----------------------------------------------- | -----------------------------------------------------------------------------: |
| Web page components                             |                                                                             56 |
| Web pages using `PageHeader`                    |                                                                             39 |
| Authenticated pages opting out of `PageHeader`  |                                                                             12 |
| `<BaseCard>` instances across web source        |                                                                            147 |
| Radius utility occurrences across web Vue files |                                                                            307 |
| `text-sm` occurrences                           |                                                                            525 |
| `text-xs` occurrences                           |                                                                            396 |
| Lines combining 11–12px text with `ink-subtle`  |                                                                            100 |
| Total `text-ink-subtle` occurrences             |                                                    267 across 266 source lines |
| Raw web tables                                  | 10: seven visible hand-written tables plus three screen-reader chart fallbacks |
| Raw web buttons in pages/features               |                                                                             66 |
| Raw web selects                                 |                                                                              6 |
| Raw web inputs in pages/features                |                                                                              8 |
| Admin pages                                     |                                                                              6 |
| Hand-written admin tables                       |                                                                              3 |

The seven visible hand-written web tables are in:

- `features/fleet/VehicleSetupImport.vue` (three tables);
- `pages/SettingsUsersPage.vue`;
- `features/compliance/QualificationSeedPanel.vue`;
- `features/anomalies/AnomalyDetail.vue`;
- `pages/RejectionsPage.vue`.

The other three raw tables are intentional screen-reader fallbacks for dashboard canvas charts in `DashboardPage.vue`; they must remain semantic tables and should not be migrated to the visual `DataTable` component.

## 1. Color and visual comfort

### 1.1 Supplied schema: verified verdict

The supplied palette has the right comfort direction: a lightly tinted cool canvas, white working surfaces, dark blue-graphite text, and a restrained warm accent. Its main text pairs are excellent. It must be translated into FuelGuard's semantic roles rather than pasted over the existing variables.

Verified findings from the supplied values:

| Pair or dependency                       |  Result | Consequence                                                                      |
| ---------------------------------------- | ------: | -------------------------------------------------------------------------------- |
| `foreground` / `background`              | 16.28:1 | Pass                                                                             |
| `foreground` / white `card`              | 17.84:1 | Pass                                                                             |
| `primary-foreground` / gold `primary`    | 10.48:1 | Pass; the gold can carry dark labels/icons                                       |
| 70%-alpha `muted-foreground` / white     |  6.64:1 | Pass on this surface, but an explicit solid text role is safer across themes     |
| `destructive-foreground` / `destructive` |  2.48:1 | Fail for normal text and for an essential graphical distinction                  |
| gold `ring` / white                      |  1.70:1 | Fail as the only focus indicator                                                 |
| `primary-ring` / white                   |  2.38:1 | Fail as the only focus indicator                                                 |
| 30%-alpha `border` / white               |  1.29:1 | Decorative only; not enough to identify a control                                |
| 15%-alpha `input` / white                |  1.37:1 | Not enough to identify a control                                                 |
| white `card` / `background`              |  1.10:1 | Requires a deliberate border/layer strategy; color alone will not separate cards |
| `sidebar-ring` / `background`            |  3.28:1 | Pass against the supplied light sidebar background                               |

**Verified semantic collision:** the supplied gold tokens are exact copies of values already present in both `packages/ui/src/tokens.css` and the mirrored `apps/web/src/style.css`:

| Supplied token                             | Exact existing FuelGuard token |
| ------------------------------------------ | ------------------------------ |
| `primary-light: oklch(0.901 0.076 70.697)` | `--ramp-caution-200`           |
| `primary: oklch(0.837 0.128 66.29)`        | `--ramp-caution-300`           |
| `primary-ring: oklch(0.75 0.183 55.934)`   | `--ramp-caution-400`           |
| `sidebar-ring: oklch(0.646 0.222 41.116)`  | `--ramp-caution-600`           |

The current code uses caution for severity `high`, while `brand-*` is also overloaded across actions, links, focus, selected controls, badges, date-picker selection, and charts. There are 208 source lines containing `brand-*` across 74 CSS, Vue, and TypeScript files. Therefore changing the brand ramp globally would change several unrelated meanings at once.

### 1.2 Proposed light-theme candidate based on the supplied schema

This is an implementation candidate, not an approved production theme. It preserves the supplied neutral and gold character while separating operational meanings. Existing FuelGuard names may remain as temporary aliases during migration, but new component work should consume the role names in the first column.

| Semantic role          | Candidate value              | Verified use                                               |
| ---------------------- | ---------------------------- | ---------------------------------------------------------- |
| `canvas`               | `oklch(0.968 0.007 247.896)` | Supplied app background                                    |
| `surface`              | `oklch(1 0 0)`               | Main table, form, popover, and card surface                |
| `surface-subtle`       | `oklch(0.984 0.003 247.858)` | Hover and table-header layer                               |
| `surface-muted`        | `oklch(0.929 0.013 255.508)` | Wells and soft neutral controls                            |
| `text-primary`         | `oklch(0.208 0.042 265.755)` | 17.84:1 on `surface`                                       |
| `text-secondary`       | `oklch(0.38 0.033 260)`      | 10.01:1 on `surface`                                       |
| `text-tertiary`        | `oklch(0.49 0.03 258)`       | 6.26:1 on `surface`; meaningful captions/metadata          |
| `text-disabled`        | `oklch(0.64 0.025 258)`      | Disabled and placeholder only; not meaningful content      |
| `border-subtle`        | `oklch(0.88 0.015 258)`      | Decorative dividers only                                   |
| `border-default`       | `oklch(0.78 0.02 258)`       | Surface grouping where no essential boundary depends on it |
| `border-control`       | `oklch(0.60 0.025 258)`      | 3.94:1 on `surface`, 3.60:1 on `canvas`                    |
| `brand-accent`         | `oklch(0.837 0.128 66.29)`   | Supplied gold; dark text is 10.48:1                        |
| `brand-accent-soft`    | `oklch(0.901 0.076 70.697)`  | Decorative identity wash only                              |
| `brand-accent-strong`  | `oklch(0.65 0.16 55)`        | Icon/border/chart line; 3.41:1 on `surface`                |
| `action-primary`       | `oklch(0.36 0.055 260)`      | Calm graphite action; white text is 10.89:1                |
| `action-primary-hover` | `oklch(0.30 0.05 260)`       | White text is 13.66:1                                      |
| `focus-ring`           | `oklch(0.53 0.18 255)`       | 5.35:1 on `surface`, 4.88:1 on `canvas`                    |
| `danger-solid`         | `oklch(0.53 0.20 27)`        | White text is 5.85:1                                       |
| `danger-surface`       | `oklch(0.96 0.025 20)`       | Soft error background                                      |
| `danger-text`          | `oklch(0.48 0.18 27)`        | 6.29:1 on `danger-surface`                                 |

Why graphite actions instead of gold actions: this keeps the supplied palette's gold as a distinctive FuelGuard identity cue without making a normal Save button look like the existing high-severity state. Gold may still be tested as the primary CTA in the prototype, but that is a product decision gate, not a code assumption.

Do not implement the supplied shadcn-style names (`background`, `foreground`, `card`, `primary`) as a second semantic system. Map the visual values into the existing FuelGuard architecture and add narrower roles where the code currently overloads `brand-*`, `edge-*`, and `ink-subtle`.

### 1.3 Color decision and validation gates

| Gate                    | Question                                                                                 | Evidence required before approval                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| C1 — accent role        | Is gold identity-only, or also the main CTA?                                             | Side-by-side Dashboard, Transactions, and settings-form prototypes; stakeholder choice documented           |
| C2 — status distinction | Can users distinguish brand accent, high severity, and medium warning quickly?           | Status matrix with label/icon, grayscale review, and protan/deutan/tritan simulation                        |
| C3 — focus              | Does the blue focus token remain clearly visible on every interactive surface and state? | Automated contrast matrix plus keyboard walkthrough at 100% and 200% zoom                                   |
| C4 — charts             | Are all series distinguishable under common color-vision deficiencies?                   | Chart palette test, direct labels/legend, and table fallback; do not infer this from hue distance alone     |
| C5 — all-day comfort    | Is the light canvas less fatiguing without reducing scan speed?                          | At least one representative dispatcher/safety-user session using realistic data and normal monitor settings |
| C6 — typography         | Keep Hanken Grotesk or adopt Switzer?                                                    | Rendered type comparison, licensing/asset review, numeric and dense-table legibility test                   |

The repository contains local Hanken Grotesk assets only; no Switzer or Playfair Display assets or declarations were found. Hanken is therefore the verified current font. Playfair Display is not recommended for operational UI; if retained at all, limit it to marketing/editorial surfaces outside the dashboard.

### 1.4 Current measured contrast

The following ratios were calculated from the current OKLCH tokens against the white `surface` using the WCAG relative-luminance formula.

| Token           | Contrast on white | Assessment                                                 |
| --------------- | ----------------: | ---------------------------------------------------------- |
| `ink`           |           17.75:1 | Pass; very strong                                          |
| `ink-secondary` |           10.31:1 | Pass                                                       |
| `ink-muted`     |            4.84:1 | Pass for normal text, but with little margin               |
| `ink-subtle`    |            2.60:1 | Fails for normal text                                      |
| `edge`          |            1.24:1 | Fine only for decorative separation                        |
| `edge-strong`   |            1.47:1 | Fails when it is the visual boundary identifying a control |
| `brand-600`     |            6.44:1 | Pass as text on white                                      |

The code intends `ink-subtle` for placeholders, disabled states, and em dashes, but it is also used for meaningful KPI captions, confidence ranges, dates, costs, MPG context, odometer details, station details, hints, and compliance metadata. Examples include `features/dashboard/StatCard.vue`, `pages/RecallAuditPage.vue`, `pages/ReportsPage.vue`, `pages/IdlingPage.vue`, and `pages/CoveragePage.vue`.

This is the strongest evidence supporting the concern that the interface is hard to use all day. The problem is not excessive contrast everywhere; it is **alternating very dark primary text with large amounts of under-contrast small text**.

### 1.5 Color is too frequent, not just too saturated

The dashboard assigns green, indigo, orange, blue, and neutral icon tiles to ordinary metrics. That makes color decoration compete with actual operational states. The five status ramps are useful, but their presence does not mean every tile needs a different hue.

Recommended rule:

- Neutral or brand color for ordinary navigation, KPIs, and informational icons.
- Red/orange/amber only when the state requires attention or changes a decision.
- Green only for a meaningful confirmed-success state, not for every positive metric.
- Chart colors live in a separate visualization palette and must remain distinguishable without color alone.
- Every status combines color with a label, icon, shape, or pattern.

Carbon's current guidance similarly makes neutral gray dominant, uses the primary action color consistently, and reserves additional colors for purposeful use.

### 1.6 Token changes

Split the present broad roles into roles with accessibility guarantees:

| New role         | Required behavior                                                  |
| ---------------- | ------------------------------------------------------------------ |
| `text-primary`   | Main headings and values; avoid absolute black                     |
| `text-secondary` | Body and table text                                                |
| `text-tertiary`  | Captions and metadata; **minimum 4.5:1** at normal sizes           |
| `text-disabled`  | Disabled/inactive only; never meaningful content                   |
| `border-subtle`  | Decorative dividers only                                           |
| `border-default` | Card/section separation                                            |
| `border-control` | **Minimum 3:1** against the field surface                          |
| `focus-ring`     | Minimum 3:1 against adjacent colors and a consistent 2px indicator |

Do not globally darken `ink-subtle` without separating disabled/decorative use. That would make disabled UI look active. Create a readable tertiary role and migrate meaningful copy to it.

### 1.7 Theme recommendation

Ship three user-selectable modes after the light theme is corrected:

- Light;
- Dim, using warm or neutral dark-gray surfaces rather than pure black;
- System.

Dark mode should be optional, not positioned as a universal eye-strain cure. User preference and ambient lighting differ. The value is choice, reduced glare in low-light environments, and a complete semantic token model.

## 2. Radius, borders, and elevation

The concern about rounded edges is directionally right but needs a precise diagnosis.

Rounded corners are not inherently outdated. Atlassian's current system uses 6px for interactive controls and 8px for cards. FuelGuard's normal `rounded-md` and `rounded-lg` values are in that same range. The dated feeling comes from:

- using a rounded bordered shadowed container for almost every group;
- placing rounded controls inside rounded toolbars inside rounded cards;
- exceptions such as `rounded-xl` on `StatCard`, `rounded-lg` on a one-off Export button, and many hand-written pills;
- using elevation as default grouping instead of whitespace and dividers.

The supplied `--radius: 0.625rem` is 10px. FuelGuard currently has no `--radius` token; templates use Tailwind radius utilities directly. Making 10px the new base would increase rounding rather than address the concern. The current 307 occurrences resolve to 113 `rounded-md`, 87 `rounded-lg`, 64 `rounded-full`, 38 bare `rounded`, four `rounded-xl`, and one `rounded-2xl`. The migration must replace these utilities by semantic shape roles, not run a global numeric substitution.

### Recommended shape system

Use fewer shape roles and a slightly sharper operational profile:

| Role                                   | Target |
| -------------------------------------- | -----: |
| Small detail, checkbox, compact badge  |  2–3px |
| Input, button, select, navigation item |    4px |
| Card, table container, panel           |    6px |
| Popover, drawer-adjacent floating UI   |    8px |
| Dialog                                 |   10px |
| Avatar, progress bar, true pill        |   Full |

The exact values can be tuned in the visual prototype; the important change is semantic usage. Do not apply `rounded-full` to ordinary statuses simply because they are small.

### Recommended elevation model

- Default page and section content: flat surface, no shadow.
- Table workspace and settings section: border or background layer, no shadow.
- Raised card: only for a genuinely emphasized or independently movable unit.
- Overlay: popovers, menus, dialogs, drawers; shadow is appropriate.
- Hover: use a surface-color change first; avoid lifting every card on hover.

`BaseCard` should become a `Surface` primitive with `variant="flat | bordered | raised"`. The current shadowed card should no longer be the only containment option.

## 3. Typography and information hierarchy

The typography scale is very compressed: 524 `text-sm` uses and 396 `text-xs` uses, with only a small number of stronger headings. This makes dense pages look tidy, but the hierarchy depends too heavily on color and card boundaries.

Recommended desktop roles:

| Role                | Target behavior                         |
| ------------------- | --------------------------------------- |
| Page title          | 20px/28px, semibold                     |
| Page description    | 14px/20px, readable tertiary            |
| Section heading     | 16px/24px, semibold                     |
| Card/table heading  | 14px/20px, semibold                     |
| Body/table/control  | 14px/20px                               |
| Metadata/hint/badge | 12px/16px, readable tertiary            |
| KPI value           | 28–32px, semibold with tabular numerals |

Rules:

- `text-xs` may be used for short metadata, not explanatory paragraphs or critical values.
- Remove the 10px and 11px exceptions.
- Reduce uppercase tracked labels; use them only for true section eyebrows.
- Use tabular numerals consistently for money, mileage, gallons, MPG, dates, and counts.
- Keep line length near 60–80 characters on settings and explanatory content.

## 4. Layout and navigation

### 4.1 Keep the sidebar architecture, simplify the chrome

A left navigation rail plus a top bar remains a current, effective pattern for complex operational software. Replacing it with top navigation would make FuelGuard's domain depth harder to manage.

The current shell does have avoidable duplication:

- email and role appear in the top bar;
- email, role, and the account menu appear again at the bottom of the sidebar;
- Sign out appears as a separate top-bar button and as part of account behavior;
- the top bar contains the page title, while the description and actions live lower in page content.

Recommended shell:

- Keep the account menu only at the bottom of the sidebar.
- Remove email, role, and Sign out from the top bar.
- Use the top bar for global search/command access, notifications, sync state, or nothing beyond the shell toggle.
- Put title, description, breadcrumbs/back navigation, freshness, and page actions together in one content `PageHeader`.
- Reduce the expanded rail from 272px toward 240–248px if labels remain readable.
- Preserve the collapsed rail and grouped navigation.
- Consider favorites/recent pages only after observing real navigation behavior; do not add another navigation layer preemptively.

### 4.2 Make one table workspace

Transactions and Drivers are among the strongest current pages, but `FilterBar` and `DataTable` render as two separate floating cards with a large gap. Treat them as one operational workspace:

```text
Page header
┌─────────────────────────────────────────────────────────────┐
│ Search  Primary filters  More filters      Count  Actions  │
├─────────────────────────────────────────────────────────────┤
│ Table header                                                │
│ Rows                                                        │
├─────────────────────────────────────────────────────────────┤
│ Selection / pagination / display density                   │
└─────────────────────────────────────────────────────────────┘
```

This reduces repeated edges, keeps filters visually attached to their result set, and uses vertical space more efficiently.

### 4.3 Use page templates, not conventions only

Create enforced composition templates:

- `ListPage`: `PageHeader + DataWorkspace + optional Drawer`;
- `DetailPage`: `PageHeader + summary + tabbed/section content`;
- `SettingsPage`: `PageHeader + SettingsSection + sticky action footer`;
- `DashboardPage`: priority KPI row + trends + exception queues;
- `TaskPage`: focused form/wizard with progress and a persistent action area.

Twelve authenticated page components currently do not use `PageHeader`. Some are legitimate special cases, but the system should express those cases as templates rather than one-off markup.

## 5. Dashboard-specific redesign

The current dashboard renders:

- 4 hero KPI cards;
- 8 fueling KPI cards;
- 3 trust/leakage KPI cards;
- then trends, cost composition, severity, and risk lists.

That is 15 individual KPI cards before the primary analytical content. At 1280×720, the viewport is dominated by empty or low-information tiles.

Recommended hierarchy:

1. **Priority row:** Fuel spend, active alerts, avoidable idle cost, fleet MPG.
2. **Compact metric strip:** gallons, miles, fill-ups, telematics coverage, reefer cost, declines. Use dividers within one flat surface, not six cards.
3. **Trend area:** spend and MPG, with an explicit comparison to the prior period.
4. **Attention queue:** critical/high alerts, unverified fills, data gaps, and qualification deadlines.
5. **Secondary composition:** cost composition and lower-priority analytics below the fold.

Additional changes:

- Use one neutral icon treatment for ordinary KPIs.
- Use semantic color only when the value is in an attention state.
- Do not animate a card upward on hover; a border/background change is enough.
- Show comparison, trend direction, and data freshness where they help decisions.
- Let role determine priority: dispatcher, safety manager, and owner should not need identical dashboards.

## 6. Forms, inputs, selects, and dates

### 6.1 Current inconsistencies

The visual contract says there is one input system, but the source still contains:

- raw native selects in `DriverPerformanceSettingsPage`, `FuelPlanningSettingsPage`, and `DriversPage`;
- raw checkboxes in `CardControlSettingsPage`, `ThresholdsPage`, and card-approver UI;
- hand-written textarea class strings in Ask AI, anomaly, hazmat, and EFS settings UI;
- both native date/datetime inputs and a custom Vue date-range picker without a shared `DateField` contract;
- file inputs and upload areas outside `FileDropzone`;
- multiple local button styles.

The three raw selects in `DriverPerformanceSettingsPage` visibly differ from `BaseInput`: `border-edge` rather than `ring-edge-strong`, `px-2` rather than `px-3`, and no standard focus treatment. Raw Card Control checkboxes use the browser's default size, color, and focus behavior.

### 6.2 Interaction defects

These are higher priority than visual polish:

- `AppSelect` opens a custom `role="listbox"`, but it has no arrow-key navigation, typeahead, active descendant, focus movement, Enter selection, or Escape handling.
- `ComboSelect` similarly does not implement the complete combobox keyboard contract.
- `FilterSelect` options are custom buttons with listbox roles but no listbox keyboard model.
- `FilterSelect` places a `role="button"` clear control inside its trigger button.
- `DateRangeFilter` places a focusable `role="button"` clear control inside its trigger button.

Use the existing Headless UI dependency for Listbox/Combobox/Menu behavior, or adopt another tested accessible primitive. Do not continue hand-authoring partial ARIA widgets.

### 6.3 Target form component set

Move the following into `@fuelguard/ui` and use them in both desktop apps:

- `Button` and `IconButton`;
- `TextField` and `NumberField`;
- `TextArea`;
- `Select`;
- `Combobox`;
- `Checkbox`, `CheckboxGroup`, `RadioGroup`, and `Switch`;
- `DateField`, `DateTimeField`, and `DateRangePicker`;
- `SearchField`;
- `FileDropzone`;
- `FormField` with generated IDs, hint/error association, required state, and `aria-invalid`;
- `InputGroup` for prefix, suffix, clear, reveal, unit, and copy actions.

Control contract:

- standard desktop height: 36px;
- optional compact height: 32px for dense toolbars only;
- product minimum target: 36×36px, while never falling below WCAG's 24×24px AA minimum;
- one padding, border, focus, disabled, invalid, and read-only treatment;
- persistent visible labels for forms; placeholders are examples, not labels;
- dates display in the user's locale while preserving ISO values internally;
- date picker supports typing, calendar selection, Escape, arrow keys, focus return, minimum/maximum dates, and clear as a separate sibling action.

## 7. Tables, filters, badges, and status

### Tables

- Migrate the seven visible web tables and three admin tables to shared table primitives.
- Make column alignment explicit: text left, numbers right, compact status/action columns centered only when appropriate.
- Add a first-class table density option instead of local `dense` decisions.
- Preserve sticky headers but add visible overflow affordance when horizontal scrolling is available.
- Keep table actions in one overflow-menu component with complete keyboard behavior.
- Use the same loading, empty, error, retry, and pagination behavior everywhere.

### Filters

- Integrate filters into the table workspace.
- Keep two or three frequent filters visible; move uncommon filters into More filters.
- Preserve applied-filter chips only when they add information beyond the visible controls.
- Support saved views only after common operational views are known.
- Show last refresh and data scope near the result count for operational confidence.

### Badges and status

The shared badge vocabulary is widely used, but exceptions remain in Fuel Reconciliation, Drivers, Driver App Settings, Coverage, and other feature-specific UI. Standardize:

- one badge shape;
- one spacing and text size;
- one semantic tone map;
- optional icon;
- never color alone;
- full pills only for counts, people, or intentionally pill-shaped filters.

## 8. Shared system architecture

`@fuelguard/ui` currently exports only `AppButton`, `AppInput`, `AppCard`, and `AppIcon`. The web app keeps separate `BaseButton`, `BaseInput`, and `BaseCard` files that are visually equivalent copies. This is guarded by token parity, but it is still two implementations.

The token source has the same structural issue. `packages/ui/src/tokens.css` is the declared canonical file and `apps/admin/src/style.css` imports it, but `apps/web/src/style.css` contains a complete mirrored copy plus the Hanken font declarations and sidebar extensions. `scripts/check-token-parity.mjs` verifies 197 declarations match; it does not eliminate the need to edit both files. Consolidating this safely requires first proving that Tailwind v4 still generates every web utility when the package stylesheet is imported and scanned. Do not delete the mirror before that build proof.

Verified dependency note: the web package already includes `@headlessui/vue`, `@floating-ui/vue`, and `@vuepic/vue-datepicker`. The select/combobox/menu repair can therefore begin with existing dependencies; a new interaction library is not assumed by this plan.

Target architecture:

```text
@fuelguard/ui
├── foundations: color, type, space, radius, elevation, motion
├── primitives: button, fields, select, date, checkbox, surface, icon
├── feedback: badge, alert, toast, skeleton, empty state
├── overlays: menu, popover, dialog, drawer
└── data: table shell, pagination, filter controls

apps/web
└── domain compositions: FuelTable, DriverPicker, AlertDrawer, HazmatPanel

apps/admin
└── platform compositions using the same primitives and data patterns
```

### Exact foundation change map

| Concern                                                                | Current source/consumer                                                                                              | Required plan change                                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Canonical neutral, brand, status, and visualization roles              | `packages/ui/src/tokens.css`                                                                                         | Add the new semantic roles and compatibility aliases; do not overwrite status ramps with the gold accent           |
| Mirrored web tokens, Hanken font, sidebar roles, date-picker overrides | `apps/web/src/style.css`                                                                                             | Reduce to shared import plus web-only font/sidebar overrides after a Tailwind build proof                          |
| Admin import and missing typography declaration                        | `apps/admin/src/style.css`                                                                                           | Consume the same font role/assets or explicitly choose a platform font in gate C6                                  |
| Token parity                                                           | `scripts/check-token-parity.mjs`                                                                                     | Replace mirror parity with a test that both apps import the canonical token source; retain semantic contrast tests |
| Token policy lint                                                      | `apps/web/scripts/check-design-tokens.mjs`                                                                           | Add bans for deprecated roles in new code and allow controlled migration exceptions                                |
| Button, input, and card duplicates                                     | `packages/ui/src/components/App*.vue` and `apps/web/src/components/ui/Base*.vue`                                     | Build the new variants in the package, migrate imports, then remove clones                                         |
| Focus and control roles                                                | Base/App button and input, `SearchInput`, `AppSelect`, `KebabMenu`, pagination, checkbox/switch, local form controls | Replace `brand-*` focus and `edge-strong` control contracts with `focus-ring` and `border-control`                 |
| Status color mapping                                                   | `apps/web/src/lib/badges.ts` and local status exceptions                                                             | Keep danger/caution/warning/success/info separate from `brand-accent`; add label/icon requirement                  |
| Date-picker color contract                                             | both token stylesheets' `.dp__theme_light` blocks                                                                    | Map selection, range, border, focus, disabled, and error to the new roles and test keyboard states                 |
| Canvas chart colors and test fallbacks                                 | `apps/web/src/features/dashboard/chartTheme.ts`                                                                      | Replace indigo fallbacks and fixed `COST_COLORS`; keep screen-reader table fallbacks                               |
| Sidebar component roles                                                | `apps/web/src/style.css` and `apps/web/src/layouts/*`                                                                | Prototype supplied light-sidebar direction against the current graphite rail; do not assume light wins             |

Add a component catalog or dedicated UI-lab route that demonstrates every state: default, hover, focus, active, disabled, invalid, loading, empty, long text, high zoom, dark/dim, and compact density.

### Enforcement

Extend automation beyond raw-color linting:

- forbid raw `<select>`, `<textarea>`, and visual `<input>` outside an allowlist;
- flag raw `<table>` outside the table component and accessible chart fallbacks;
- flag nested interactive elements;
- flag local `rounded-* + bg-surface + ring/shadow` card recipes;
- flag `text-ink-subtle` on non-disabled visible text;
- add Vue accessibility linting;
- add unit tests for select/combobox/date keyboard behavior;
- add contrast tests for semantic token pairs;
- add Playwright visual snapshots for page templates at desktop, narrow desktop, and mobile widths.

## 9. Page-level migration priorities

| Page/surface                                 | Main issue                                       | Recommended change                                                                      |
| -------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Dashboard                                    | 15 KPI cards and decorative status colors        | Four priority KPIs, one compact metric strip, earlier exceptions/trends                 |
| Settings landing                             | Fourteen large route cards                       | Sectioned navigation list with descriptions and a small icon column; no shadow per link |
| Transactions / Drivers / Vehicles / Trailers | Separate floating filter and table cards         | One data workspace surface                                                              |
| Driver Performance Settings                  | Raw native selects mixed with shared inputs      | Shared Select and unified field sizing/focus                                            |
| Card Control Settings                        | Raw checkboxes and repeated label markup         | Shared Checkbox/Switch with consistent help and disabled state                          |
| Date-heavy compliance/hazmat forms           | Native date inputs beside custom range picker    | Shared DateField/DateTimeField plus accessible DateRangePicker                          |
| Rejections / Anomaly detail                  | Local tables and mixed detail styles             | Shared detail table/list pattern and badge vocabulary                                   |
| Vehicle Setup Import                         | Three local tables and separate upload patterns  | Import template with FileDropzone, preview DataTable, validation summary                |
| Admin Customers / Customer detail            | Hand-written tables and old max-width shell      | Shared PageHeader, DataWorkspace, Surface, Badge, and responsive shell                  |
| Shell                                        | Duplicate account identity and split page header | One content header and one account menu                                                 |

## 10. Recommended delivery plan

The order below is dependency-driven. Later phases must not begin by locally recreating a primitive that an earlier phase is intended to centralize.

### Phase 0 — Evidence freeze and visual decisions (2–4 days)

1. Generate and commit a page/component adoption matrix from the current source. Seed it with the verified baseline in this report: 56 web pages, six admin pages, 39 web `PageHeader` adopters, 12 authenticated page exceptions, 147 `BaseCard` instances, seven visible local web tables, three chart fallback tables, and three admin tables.
2. Capture Dashboard, Transactions, Driver Performance Settings, one detail/drawer workflow, and one admin data page with representative non-empty data at desktop, narrow desktop, mobile, 200% zoom, and forced-colors where applicable.
3. Build two token-only prototypes from the same markup:
   - A: gold is identity accent; graphite is the primary action (the recommended candidate in §1.2).
   - B: gold is the primary action; warnings/high severity use a demonstrably distinct hue and treatment.
4. Prototype both the supplied light-sidebar direction and the existing graphite sidebar. Keep content, density, and labels identical so the comparison isolates the rail treatment.
5. Resolve and document gates C1–C6. Record selected token values, font choice, sidebar choice, and why. No repository-wide color substitution is permitted before this record exists.

**Exit evidence:** approved three-screen prototype, captured decision record, machine-repeatable inventory, and no unresolved brand/status/focus role collision.

### Phase 1 — Canonical accessible foundations (3–6 days)

1. Add `text-tertiary`, `text-disabled`, `border-subtle`, `border-default`, `border-control`, `brand-accent`, `action-primary`, `focus-ring`, and solid/subtle destructive roles to `packages/ui/src/tokens.css` using the approved Phase 0 values.
2. Keep `ink-*`, `edge-*`, and `brand-*` as documented compatibility aliases during migration. Do not silently repoint `brand-*` until the 208 source lines containing it have been classified by meaning.
3. Add an automated contrast matrix covering text/surface, control/surface, focus/surface, solid action/text, destructive, status, sidebar, and selected-state pairs in every shipped theme.
4. Prove a minimal web production build can import `@fuelguard/ui/tokens.css` and still generate package and app Tailwind utilities. Only after that proof, remove the 197 mirrored shared declarations from `apps/web/src/style.css`; keep only fonts, sidebar roles, and web-specific overrides.
5. Define shared font, radius, elevation, control-height, and motion roles. Do not adopt the supplied 10px base radius; use the semantic targets in §2.
6. Update `chartTheme.ts` fallbacks and fixed cost colors only after chart contrast and color-vision validation. Preserve its three semantic table fallbacks.

**Exit evidence:** web/admin builds, existing token lint, revised canonical-import test, full contrast test, and zero unexplained token aliases.

### Phase 2 — Shared interaction primitives (6–10 days)

1. Implement `Button`, `IconButton`, `Surface`, `TextField`, `NumberField`, `TextArea`, `Checkbox`, `RadioGroup`, `Switch`, `Select`, `Combobox`, `SearchField`, `DateField`, `DateTimeField`, `DateRangePicker`, `InputGroup`, and `FormField` in `@fuelguard/ui`.
2. Use the already-installed Headless UI/Floating UI dependencies for applicable behavior; keep VueDatePicker only if its keyboard/focus contract passes the same tests.
3. Fix the nested clear actions in `FilterSelect` and `DateRangeFilter` by making clear a sibling control with its own accessible name and focus order.
4. Replace the incomplete `AppSelect`, `ComboSelect`, and `FilterSelect` interaction models. Test arrows, Home/End where applicable, typeahead, Enter/Space, Escape, Tab, disabled options, focus return, and screen-reader naming.
5. Migrate the package/web `App*`/`Base*` duplicates to one shared implementation. Remove a clone only after all of its imports move and both apps build.

**Exit evidence:** component-state catalog, unit interaction tests, keyboard walkthrough, axe/accessibility smoke test, and both applications consuming the same primitives.

### Phase 3 — Surface, radius, typography, and density migration (4–7 days)

1. Replace default raised-card containment with `Surface variant="flat | bordered | raised"`; reserve raised for emphasized units and overlays.
2. Migrate radius utilities by semantic role. Start with the five `rounded-xl`/`rounded-2xl` exceptions and 64 `rounded-full` uses, then card/panel and control recipes. Verify that full rounding remains only on true pills, avatars, and progress tracks.
3. Migrate all 100 lines combining 11–12px text with `ink-subtle`: meaningful content moves to `text-tertiary`; placeholder/disabled content moves to `text-disabled`.
4. Apply the typography roles in §3 and shared tabular numerals. Verify text truncation and wrapping with long names, currencies, dates, and localized content.

**Exit evidence:** no meaningful `text-ink-subtle`, no local raised-card recipe outside an allowlist, semantic radius adoption report, and screenshot comparison at normal and compact density.

### Phase 4 — Shell and composition templates (5–8 days)

1. Consolidate title, description, back/breadcrumbs, freshness, and actions into one content `PageHeader`.
2. Remove duplicate account identity/sign-out UI from the top bar and retain one account menu in the sidebar.
3. Add `DataWorkspace`, `SettingsSection`, `ListPage`, `DetailPage`, `SettingsPage`, `DashboardPage`, and `TaskPage` compositions.
4. Integrate filters and tables into one workspace and preserve horizontal-overflow, sticky-header, empty/error/loading, selection, and pagination behavior.
5. Validate the selected sidebar prototype with keyboard, mobile drawer, collapsed rail, long labels, and role-based navigation.

**Exit evidence:** template catalog, shell navigation regression suite, and each authenticated page assigned to a template or documented exception.

### Phase 5 — Page migration (12–20 days)

Migrate in verified risk/value order:

1. Dashboard: reduce 15 equal card KPIs to four priority KPIs, one metric strip, trends, and an attention queue.
2. Transactions, Drivers, Vehicles, and Trailers: establish the shared data-workspace pattern.
3. Driver Performance Settings and Card Control Settings: eliminate the three inconsistent selects and raw checkbox group first, then migrate remaining settings.
4. Date-heavy compliance/hazmat workflows and detail/drawer flows.
5. Vehicle Setup Import, Settings Users, Qualification Seed, Anomaly Detail, and Rejections: migrate the seven visible local tables; do not replace the three chart fallback tables.
6. Admin: apply the shared font, header, form, surface, badge, and table system across all six pages and its three local tables.

Each pull request must update the adoption matrix and may not add a new raw visual control, local card recipe, or deprecated semantic role.

### Phase 6 — Release validation and rollout (3–6 days)

- Run keyboard-only and screen-reader workflows, 200% zoom/reflow, forced colors, automated contrast, and color-vision simulation.
- Run visual snapshots for the representative pages at desktop, narrow desktop, and mobile sizes.
- Test with representative all-day users using realistic data; measure task scan time, errors/missed alerts, and perceived fatigue against the baseline rather than asking only which version looks newer.
- Roll out broadly only if functional metrics are not worse and P0 acceptance criteria pass. Use a feature flag for the broad shell/dashboard visual change if the deployment system supports one; this report does not assume that capability exists.

## 11. Acceptance criteria

The redesign is complete when:

- all meaningful normal text meets 4.5:1 contrast;
- all control boundaries and essential graphical states meet 3:1;
- focus is visible, consistent, unobscured, and at least a 2px-equivalent indicator;
- brand accent, primary action, caution/high severity, medium warning, danger, success, information, and focus each have a documented role and are not aliases of the same token;
- every shipped semantic color pair is covered by an automated contrast matrix, while chart/status distinction is also validated under protan, deutan, and tritan simulation;
- every pointer target meets WCAG 2.2 AA and primary controls use the product's 36px minimum;
- every select, combobox, menu, dialog, and date picker works by keyboard and returns focus correctly;
- there are no nested interactive elements;
- there are no raw visual inputs, selects, textareas, or tables outside documented exceptions;
- normal content is no longer styled with `text-ink-subtle`;
- ordinary pages use flat/bordered surfaces and reserve shadow for overlays or explicit emphasis;
- radius is assigned by component role; a single global 10px base is not applied indiscriminately;
- each page has one title/description/action region;
- list pages use one integrated data workspace;
- the dashboard exposes no more than four equal-priority hero KPIs;
- both web and admin consume the same primitive package;
- `packages/ui/src/tokens.css` is the only shared token declaration source, with app styles limited to documented app-specific extensions;
- every shipped theme preserves semantic meaning and contrast; dim/system modes remain a later deliverable unless separately approved;
- representative workflows pass visual regression, keyboard, 200% zoom, and responsive checks.

## 12. Verification ledger and known limits

### Implementation closure — August 11, 2026

The approved implementation was audited against the source rather than closed from the checklist alone. Phases 0–5 are implemented in production code and protected by CI checks. Phase 6's repository-verifiable checks pass; its representative-user fatigue/task study remains an operational rollout measurement because no code or automated tool can truthfully substitute for all-day users.

| Phase | Verified closure evidence                                                                                                                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Repeatable adoption inventory, isolated A/B lab, recorded gold/graphite/light-rail/Hanken decisions, default-build lab exclusion                               |
| 1     | Canonical package tokens, consumer import enforcement, 20-pair contrast matrix, semantic radius/type/motion roles, chart CVD validation                        |
| 2     | Shared package primitive family, deleted local clones, keyboard interaction tests, Vue accessibility lint, axe smoke, both app builds                          |
| 3     | Zero deprecated subtle-text utilities, semantic radius migration, flat/bordered default surfaces, overlay-only shadow exceptions                               |
| 4     | One content header, one account menu, integrated DataWorkspace, SettingsSection, documented exact page-template exceptions                                     |
| 5     | Dashboard/metric-strip, four priority data workspaces, settings/control/date migrations, all visible web/admin table migrations, responsive admin shell        |
| 6     | Full lint/type/test/build suite, automated contrast/CVD checks, desktop/narrow/mobile/reflow render inspection, forced-colors/reduced-motion rule verification |

The named `ListPage`, `DetailPage`, `DashboardPage`, and `TaskPage` ideas were verified against the routed source before adding abstraction. Existing route components already are those page roots; adding unused wrapper-only components would create ceremony without enforcing behavior. Their actual contracts are enforced through shared PageHeader/DataWorkspace/SettingsSection primitives and the adoption allowlist. This is a code-evidenced plan adjustment, not an omitted implementation.

Baseline repository snapshot: commit `5b4b4f0`. Slice 1 implementation and verification are recorded separately in `docs/UI-UX-IMPLEMENTATION-LOG.md`. The following baseline checks were rerun while revising this plan:

| Check                                     | Verified result                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `find apps/web/src/pages -name '*.vue'`   | 56 web page components                                                                                       |
| `find apps/admin/src/pages -name '*.vue'` | Six admin page components                                                                                    |
| `rg` component/utility inventory          | 147 `BaseCard`; 307 radius; 525 `text-sm`; 396 `text-xs`; 267 `text-ink-subtle` occurrences across 266 lines |
| Small subtle-copy inventory               | 100 source lines combine 11–12px text with `text-ink-subtle`                                                 |
| Raw controls in web pages/features        | 66 buttons, six selects, eight inputs                                                                        |
| Raw table inspection                      | Ten web tables: seven visible local tables and three screen-reader chart fallbacks; three admin tables       |
| Page-header inspection                    | 39 adopters; 12 authenticated exceptions after excluding four auth pages and one public page                 |
| Shared token use                          | 197 shared declarations mirrored into web; parity script identifies package tokens as canonical              |
| Brand reference inventory                 | 208 source lines containing `brand-*` across 74 CSS/Vue/TypeScript files                                     |
| Dependency inspection                     | Headless UI, Floating UI, and VueDatePicker are already installed in the web package                         |
| Font asset inspection                     | Hanken Grotesk files found; no Switzer or Playfair Display files/declarations found                          |
| Supplied gold comparison                  | Exact equality with current caution ramp at steps 200, 300, 400, and 600                                     |
| Contrast calculations                     | Supplied and candidate pair results documented in §1.1–1.2                                                   |

The following are deliberately **not claimed as verified**:

- visual performance with representative production data beyond the previously rendered empty/loading and local development states;
- user preference, reduced fatigue, or faster task completion;
- Switzer licensing, loading performance, or superiority over Hanken;
- whether the light or graphite sidebar performs better;
- whether a deployment feature-flag mechanism already exists;
- whether dim/system themes belong in the first release.

Those items are validation gates in the delivery plan, not assumptions hidden inside it.

## Current-practice references

- [WCAG 2.2 — contrast, focus, target size, and other success criteria](https://www.w3.org/TR/WCAG22/)
- [W3C Understanding text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)
- [W3C Understanding non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast)
- [W3C Understanding target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
- [W3C Understanding focus appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance)
- [WAI-ARIA combobox pattern and keyboard contract](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- [WAI-ARIA date-picker dialog example and keyboard contract](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/)
- [Atlassian radius roles](https://atlassian.design/foundations/radius/)
- [Atlassian elevation guidance](https://atlassian.design/foundations/elevation/)
- [Atlassian semantic design-token guidance](https://atlassian.design/foundations/tokens/design-tokens/)
- [Carbon color roles and layering](https://carbondesignsystem.com/elements/color/overview/)
- [Carbon data-table guidance](https://carbondesignsystem.com/components/data-table/usage/)
- [Carbon data-visualization palettes](https://carbondesignsystem.com/data-visualization/color-palettes/)
- [Fluent 2 design tokens and theme support](https://fluent2.microsoft.design/design-tokens)

## Final recommendation

Approve a targeted redesign, not a cosmetic recolor or global `brand-*` swap. First resolve the gold/action/status, sidebar, and font gates on Dashboard, Transactions, and Driver Performance Settings. Then implement the accessible token roles and shared primitives before migrating pages. Those screens cover overview, data operations, and form configuration and will show whether the new system improves real work before it is applied to all 62 desktop pages.
