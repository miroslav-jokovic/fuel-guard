# FuelGuard enterprise UI reconstruction

**Status:** proposed application-wide architecture; no production implementation is approved by this document alone  
**Date:** August 15, 2026  
**Scope:** authenticated web application shell, page templates, tables, forms, overlays, navigation, feedback, and responsive behavior  
**Companion:** [Dashboard visual reconstruction](./DASHBOARD-VISUAL-RECONSTRUCTION.md)

## 1. Executive decision

The new direction is not a palette refresh and it is not limited to the Dashboard. FuelGuard should adopt a different composition model across the authenticated application:

- one quiet workspace canvas instead of a page made from many detached cards;
- layouts selected by the user's task, not one generic page stack;
- continuous data workspaces for tables, filters, bulk actions, and pagination;
- contextual drawers only when page context remains useful;
- full pages for long, high-complexity, multi-section, or multi-step tasks;
- small modal dialogs for short blocking decisions, confirmations, and focused tasks;
- deliberate layers expressed primarily with tonal surface changes and restrained shadows;
- fewer borders, while retaining perceptible boundaries for inputs, focus, selection, and safety-critical states;
- a shared tabs contract, overlay contract, form-section contract, and page-shell contract;
- responsive behavior defined per component family rather than by incidental wrapping.

The reference dashboard's calmness is transferable. Its literal top navigation, extreme corner radii, very faint text, and presentation-style outer frame are not appropriate for FuelGuard's number of destinations or operational density.

The current design system is a strong foundation. The reconstruction should extend it at the **composition and behavior layers**, not replace its tokens, controls, accessibility work, or data components.

## 2. Relationship to the Dashboard specification

The Dashboard document defines the analytical page direction: one dominant story, fewer equal cards, integrated charts, contextual analytical views, and selective high-chroma signals.

This document governs the rest of the application and the shared components the Dashboard also consumes. If the two documents appear to conflict:

1. this document owns shell, overlays, controls, table behavior, responsive behavior, and global surface rules;
2. the Dashboard document owns the content hierarchy and composition of the main analytical page;
3. accessibility and semantic-token contracts in the current design system remain mandatory for both.

The Dashboard may be more spacious than an operational queue. It must still feel like the same product through typography, controls, shell geometry, state language, and layer behavior.

## 3. Verified current state

### 3.1 Repository evidence

The following counts were verified against `apps/web/src` on August 15, 2026:

| Current pattern       |                        Verified footprint | Implication                                                                |
| --------------------- | ----------------------------------------: | -------------------------------------------------------------------------- |
| `DataTable`           | 43 rendered instances across 37 Vue files | A strong shared table foundation already exists.                           |
| `FilterBar`           |          27 instances across 25 Vue files | Filtering is broadly standardized, but not always composed with the table. |
| `DataWorkspace`       |                                   4 pages | The continuous workspace model is only partially adopted.                  |
| `SlideOver`           |          15 instances across 12 Vue files | One generic overlay is carrying many different task types.                 |
| `SlideOver size="lg"` |                                  3 usages | Most drawers use the default 448px maximum width.                          |
| explicit `tablist`    |                                   4 pages | Other tab-like controls are also hand-authored, so behavior is fragmented. |
| shared `BaseCard`     |                                147 usages | Cards are consistent but overused as page structure.                       |
| shared `PageHeader`   |                            49 page usages | Page identity and primary actions are already highly standardized.         |

### 3.2 Existing strengths to preserve

- Semantic color roles live in one canonical token source.
- The sidebar is responsive, role-aware, collapsible, and supports far more destinations than a top navigation safely could.
- Shared inputs, selects, date controls, buttons, cards, badges, tables, and fields already exist.
- `DataTable` owns column alignment, sorting, selection, loading, error, empty, sticky header, horizontal overflow, and pagination integration.
- `FilterBar` owns the established search, primary filters, secondary filters, active chips, result count, and action regions.
- `SlideOver` is based on Headless UI Dialog, giving it a sound modal accessibility base.
- Page routes already distinguish many true detail views from list views.
- Loading, empty, retry, and semantic table fallback patterns already exist.
- Current control edges and focus indicators were deliberately brought to accessible contrast.

### 3.3 Verified composition gaps

#### Data pages

Only Transactions, Vehicles, Drivers, and Trailers currently use `DataWorkspace`. Most list pages render `FilterBar` and `DataTable` as separate cards. This produces repeated outlines and vertical gaps around elements that belong to one task.

The four adopted pages demonstrate the correct structural direction, but the wrapper is currently only an `AppCard` with dividers. It has no first-class slots or state for tabs, bulk actions, table preferences, density, sticky toolbar behavior, or responsive overflow guidance.

#### Drawers

The same `SlideOver` handles:

- quick create/edit forms;
- imports;
- record review;
- card controls;
- compliance requirements;
- driver access;
- exception and anomaly detail.

It supports only `md` and `lg`, mapped to approximately 448px and 512px. It also assumes one scrolling body and an optional footer. That is insufficient as the permanent contract for all of these workflows.

Rendered verification of **New vehicle** shows a long form compressed into a narrow two-column layout with important actions below the initial viewport. This is technically usable, but it is not the desired enterprise task experience.

#### Settings

Settings pages use several width conventions (`max-w-2xl`, `max-w-3xl`, and `max-w-5xl`) and often stack bordered cards. The Driver App settings page has good semantic grouping, but its tabs, card headers, rows, and nested controls create several competing frames.

#### Tabs

Assignments, Compliance, Dispatch Loads, and Driver App Settings explicitly implement tab lists. Import, Fuel Planning, Idling, and anomaly detail also implement tab-like selection locally. Visual styles and ARIA completeness vary, and there is no shared keyboard-navigation contract.

#### Shell and page header

The shell currently provides a 56px sticky global header containing only navigation controls and an optional Back action. The page header below repeats a horizontal boundary and owns title, description, freshness, and page actions.

This creates two stacked header bands without a strong shared content grid. The global header is underused, while page actions can feel detached from the navigation context.

#### Cards and borders

The current system has the right semantic edge tokens, but structural borders are doing too much work. Cards, filter bars, tables, headers, fields, popovers, and section rows can all be visible at once. The result is orderly but visually segmented.

## 4. Target application model

FuelGuard should have three persistent structural layers and seven page families.

### 4.1 Persistent layers

1. **Navigation layer** — sidebar or mobile navigation drawer; visually distinct from the workspace.
2. **Application layer** — global header, breadcrumbs/back navigation, page identity, global context, and account-level utilities.
3. **Task layer** — the active page family: analytical canvas, data workspace, record, settings, queue, or task flow.

Overlays create temporary layers above the task layer. Their elevation, scrim, focus, escape, and stacking rules must come from one overlay system.

### 4.2 Page families

Every authenticated route must be assigned to one primary family before migration.

| Family                 | Best for                                     | Representative current routes                       | Default width                            |
| ---------------------- | -------------------------------------------- | --------------------------------------------------- | ---------------------------------------- |
| Analytical             | Overview, trends, prioritization             | Dashboard, Reports, Driver Performance, Idling      | fluid, bounded chart regions             |
| Data workspace         | Search, compare, filter, select, act         | Transactions, Vehicles, Drivers, Fuel Log, Alerts   | full available width                     |
| Operational queue      | State progression and exception handling     | Loads, Hazmat Review, Compliance queues, Rejections | full width with optional inspector       |
| Record detail          | One entity, history, status, related records | Load, Driver, Vehicle, Fuel Card, Hazmat Load       | fluid two-zone or bounded reading column |
| Settings               | Organization policies and configuration      | Settings, Driver App, Thresholds, Notifications     | bounded 960–1120px                       |
| Task/form              | Create, import, reconcile, calculate         | New Hazmat Load, Import, Reconciliation, calculator | bounded by task complexity               |
| Conversation/workbench | Persistent list + active object              | Messages, Ask AI                                    | full-height split workspace              |

Routes may contain a secondary family inside them—for example, a record detail page can contain a compact related-record table—but its outer composition still follows the primary family.

## 5. Application shell reconstruction

### 5.1 Keep the sidebar

Do not replace the global sidebar with the reference image's horizontal top navigation. FuelGuard has too many permission-dependent destinations. The current expanded and collapsed modes are appropriate.

Update its composition rather than its information architecture:

- preserve the distinct navigation surface;
- retain 15px expanded labels and 20px icons;
- reduce visual separators to the logo boundary and account boundary only;
- use spacing and section labels for grouping;
- keep the selected item tonal, with the brand marker as a small signal;
- treat mobile navigation as its own navigation drawer, not as a content `SlideOver` variant.

### 5.2 Make the global header useful

The global header should become the stable application-context row. It should support:

- sidebar toggle;
- breadcrumb or Back navigation for descendants;
- optional page title at compact sizes;
- global utilities that truly span routes;
- a consistent alignment grid with the page content below.

Do not move every page action into the global header. Destructive, create, export, and workflow actions belong with the page or active data workspace unless they apply globally.

### 5.3 Page identity band

Replace the current universal underlined `PageHeader` with a `PageIntro` contract:

- title and optional concise description;
- optional status/freshness/meta row;
- primary and secondary page actions;
- variants: `default`, `compact`, and `record`;
- no default border;
- spacing below determined by the page family;
- actions collapse into a labeled overflow only when width requires it.

This removes one of the two stacked header lines and allows analytical, list, and record pages to have different but consistent introductions.

## 6. Data workspace and table reconstruction

### 6.1 Target visual structure

Search, filters, selection, table, and pagination form one operational surface:

```text
Page intro                                            Page actions

┌──────────────────── continuous data workspace ─────────────────────┐
│ optional views/tabs                                                │
│ search · primary filters · more filters        count · utilities   │
│ active filters / saved view / freshness                           │
│ selection bar, replacing toolbar when rows are selected            │
│────────────────────────────────────────────────────────────────────│
│ sticky column header                                               │
│ rows                                                               │
│ rows                                                               │
│────────────────────────────────────────────────────────────────────│
│ result range · page size                         pagination         │
└────────────────────────────────────────────────────────────────────┘
```

The workspace should use one quiet perimeter or one raised surface—not a filter card above a table card. Internal divisions use `edge-subtle`; row rhythm should come primarily from spacing and tonal hover/selection states.

### 6.2 `DataWorkspace` target contract

Extend the current wrapper rather than creating a competing page component.

Recommended API responsibilities:

- `variant`: `standard | queue | embedded`;
- `density`: `comfortable | compact`;
- `stickyTools`: opt-in after measured need;
- slots: `views`, `toolbar`, `active-filters`, `batch-actions`, default table, `footer`;
- shared corner and divider behavior;
- consistent loading shell dimensions;
- no assumption that every workspace needs tabs or table preferences.

Adoption should first combine existing `FilterBar`, bulk action rows, `DataTable`, and `TablePagination`. New capabilities should only be added when a real page requires them.

### 6.3 Table visual rules

- Keep semantic HTML `table` as the default. Do not adopt ARIA `grid` unless cells become spreadsheet-like interactive controls.
- Use one header tint no more than one surface step from the table body.
- Reduce full-width horizontal rules to `edge-subtle`; do not add vertical cell borders.
- Keep standard rows at approximately 44–48px and compact rows at 36–40px.
- Preserve tabular numerals and right alignment for numeric data.
- Use primary ink only for the row's identity or critical value; supporting cells use secondary ink.
- Use badges for categorical state, not for ordinary text or every value.
- Keep row hover and selection visibly distinct without a saturated fill.
- Keep the action column fixed-width and predictable.
- Avoid icons without text in data cells unless the meaning is universally understood and has an accessible label.

### 6.4 Table behaviors

- Sorting remains column-based and announces direction.
- Pagination stays in the workspace footer.
- Selection replaces or transforms the table toolbar into a batch-action bar; it should not insert an unrelated card between filters and rows.
- Clicking a row may open a true record page or a review inspector, but the destination must be consistent within that table.
- Preserve the current table scroll container only where a fixed-height work area is valuable. Long document-style pages should allow document scrolling instead of nested vertical scroll by default.
- Sticky columns, column visibility, density controls, saved views, and virtualization are **not default scope**. Add each only after verified user or data-scale need.
- A table is not a spreadsheet. Inline editing should be rare and follow an explicit editable-grid keyboard model if introduced.

### 6.5 Responsive table rules

No universal mobile card conversion is allowed. Converting a table to cards can hide comparison relationships.

Use this order:

1. preserve the semantic table with horizontal overflow;
2. pin or repeat the record identity where technically justified;
3. hide genuinely secondary columns behind a documented priority rule;
4. offer a separate row-detail view;
5. use cards only for lists whose items are semantically independent rather than comparative.

The toolbar stacks search full-width, then primary filters, then count/actions. It must never produce inaccessible clipped controls.

### 6.6 Table states

Every workspace must define and test:

- initial loading;
- background refresh without losing rows;
- empty account state;
- no matches after filtering;
- error with retry;
- partial or stale data;
- row selection;
- bulk action pending, partial success, and failure;
- horizontal overflow at narrow widths.

## 7. Overlay architecture

### 7.1 Choose the surface by task

| Surface              | Use when                                                                               | Do not use when                                                         |
| -------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Popover/menu         | A short selection, compact filter, or action list                                      | The user must enter substantial data or review structured content       |
| Modal dialog         | A short blocking decision, confirmation, or focused task of roughly one to four fields | The task needs page context, substantial scrolling, or several sections |
| Context drawer       | A medium-complexity edit or review benefits from seeing the underlying list/record     | The task is long, multi-step, or changes the user's main context        |
| Full page            | A long form, import/reconciliation flow, multi-step task, or major record creation     | The action is a quick contextual change                                 |
| Persistent inspector | Repeated row review requires fast movement through a queue                             | The panel is a one-off form or blocks all page work                     |

This follows the same task-complexity principle described in Carbon's create-flow guidance: short tasks can be modal, medium contextual tasks can use a side panel, and complex creation flows need larger or full-page surfaces.

### 7.2 Split the current `SlideOver` responsibility

Keep Headless UI Dialog as the accessible behavioral foundation, but introduce separate semantic components:

- `AppDrawer` — modal contextual drawer;
- `AppDialog` — centered modal dialog;
- `AppInspector` — optional persistent or modal review panel for queues;
- `ConfirmDialog` — concise destructive or high-impact confirmation;
- mobile `NavigationDrawer` remains owned by `AppShell`.

Do not expose only pixel-like `md` and `lg` variants. Expose task-oriented sizes:

| Size       |                  Target width | Intended content                          |
| ---------- | ----------------------------: | ----------------------------------------- |
| `narrow`   |                     400–480px | concise detail or quick edit              |
| `standard` |                     560–640px | medium form or structured review          |
| `wide`     | 720–880px, capped by viewport | rich review, comparison, or two-zone task |
| `full`     |     viewport below breakpoint | mobile and explicitly full-screen tasks   |

Exact values remain prototype candidates and must be verified at 1280, 1440, and 1920px widths.

### 7.3 Drawer anatomy

Every drawer uses:

1. header with title, optional description/status, and visible close button;
2. optional local navigation or progress region;
3. one scrolling body with section-level grouping;
4. sticky action footer when the task commits changes;
5. optional metadata rail only in `wide` mode;
6. scrim and tonal surface separation instead of a dark perimeter border.

The header and footer remain visible while the body scrolls. Footer actions use one primary action, one clear secondary/cancel action, and at most one tertiary action.

### 7.4 Drawer behavior

- Initial focus depends on content complexity. Long structured content focuses the title or introductory static element; short forms may focus the first field.
- `Tab` and `Shift+Tab` remain inside a modal drawer.
- `Escape` requests close unless a nested transient popover consumes it first.
- Closing restores focus to the invoking control, or to the logical next row when that control no longer exists.
- Dirty forms prompt before discarding meaningful edits.
- Submission must not close the drawer until success is confirmed.
- Background refresh must not wipe unsaved fields.
- The route should represent the task when refresh, deep link, or browser navigation must preserve it.

### 7.5 Nested overlay policy

- Never open a drawer from a drawer.
- A drawer may contain a popover, select list, date picker, or concise confirmation dialog.
- A modal may not open another general modal.
- If the task requires a second substantial surface, promote the parent task to a page.
- Layer order is semantic and tokenized; components may not use arbitrary `z-[9999]` values.

### 7.6 Immediate workflow classification

The current overlay usages must be individually classified during migration. Preliminary classifications, based on source and rendered behavior, are:

| Current workflow                  | Target candidate               | Verification needed                                        |
| --------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| New/edit Vehicle, Driver, Trailer | standard drawer or full page   | field count, completion time, mobile use                   |
| New Load                          | full page                      | it is a major operational object with several dependencies |
| Import Vehicles                   | task page or wide drawer       | file, mapping, validation, and result complexity           |
| Card controls                     | standard/wide drawer           | amount of live context needed                              |
| Requirement review                | wide drawer or queue inspector | repeated-review navigation and evidence density            |
| Alert/decline detail              | queue inspector                | whether users move sequentially through results            |
| Driver access                     | standard drawer                | field count and permission impact                          |
| Destructive retire/revoke actions | confirmation dialog            | replace native `confirm()` and verify copy                 |

These are candidates, not assumptions. Each workflow needs a measured content inventory before implementation.

## 8. Record detail reconstruction

Record pages should not be generic card stacks. Use a stable record anatomy:

1. record identity: name/reference, status, compact metadata, and actions;
2. summary band: 3–5 high-value facts or readiness indicators;
3. primary work region: current plan, configuration, or risk evidence;
4. secondary navigation: Overview, Activity, Related records, Configuration, as needed;
5. history/activity region with dates, authors, and outcomes.

Large records use a two-zone layout:

- main column for the current task and evidence;
- narrower context rail for status, ownership, lifecycle, and quick actions.

On narrow screens the context rail moves before or after main content according to task priority. It must not become a permanently hidden drawer.

Use a full page when a record has a durable URL, substantial history, cross-linked child records, or multiple major actions. Use an inspector only for rapid review inside a queue.

## 9. Settings reconstruction

### 9.1 Information architecture

Settings should use one of two templates:

- **Settings index:** grouped destination list with descriptions, current-state summaries, and permission visibility.
- **Settings detail:** local navigation or tabs plus a continuous configuration surface.

Do not put each small group into an equally elevated card. Use section headings, tonal bands, and subtle dividers to create rhythm.

### 9.2 Settings detail anatomy

```text
Page intro + save state
Local navigation / tabs

Section title and explanation
Configuration rows
Configuration rows
subtle divider
Section title and explanation
Configuration rows

Sticky save bar only when settings are staged
```

Immediate settings can save per control and show local pending/success/error state. Staged settings use one page-level save action and dirty-state protection. A page must not mix both models without making the boundary explicit.

### 9.3 Configuration rows

A configuration row contains:

- label and explanatory text;
- optional plan or permission metadata;
- the control aligned consistently;
- inline validation/status;
- an optional child configuration region revealed by the parent value.

At narrow widths, the control moves below the explanation. Avoid two-column field layouts when labels or help text become cramped.

## 10. Forms and task flows

### 10.1 Form grouping

- Group fields by user decision, not database model.
- Use section headings and whitespace before adding a card.
- Keep labels visible; placeholders are examples, not labels.
- Use one- or two-column layout based on semantic relationships, not available width alone.
- Long labels, help text, addresses, identifiers, and policy choices stay one column.
- Place field errors adjacent to the field and a focused error summary at the top after failed submission for long forms.
- Preserve entered values after validation failure.

### 10.2 Form actions

- Short drawers: sticky footer.
- Long pages: action bar at the logical end; sticky action bar only if testing shows repeated scrolling cost.
- Multi-step tasks: Back, Continue, Save draft where the domain supports it, and a visible step indicator.
- Destructive actions are separated from ordinary Save actions.
- Pending states lock only the controls necessary to prevent duplicate mutation.

### 10.3 Input surface direction

Inputs may become more tonal, but essential control boundaries must remain perceptible. Do not remove borders from fields merely to imitate the reference.

Recommended direction:

- surface is slightly distinct from its containing layer;
- resting edge is quiet but meets the established control-boundary requirement;
- hover and focus rely on edge/focus tokens, not a dark border;
- invalid state uses message, icon where helpful, and error edge—not color alone;
- dropdown panels use a raised layer token and shadow, not a heavy outline.

## 11. Tabs and contextual navigation

Create one shared `AppTabs` component with:

- line and contained variants;
- complete tab, tablist, and tabpanel associations;
- roving keyboard focus with arrow keys, Home, and End;
- manual activation when panel loading is noticeable; automatic activation only for preloaded content;
- visible selected state using tone plus typography or indicator, not color alone;
- overflow strategy that does not wrap tabs into ambiguous rows;
- optional route or query-string binding for durable state.

Use tabs only for peer views of the same object or workspace. Use local navigation links when destinations are distinct pages. Use a segmented control for changing visualization or a small mutually exclusive mode—not as page navigation.

## 12. Surfaces, borders, radius, and elevation

### 12.1 Layer model

Add semantic surface roles rather than page-specific colors:

- `canvas` — main application background;
- `surface-navigation` — sidebar;
- `surface-base` — primary content plane;
- `surface-subtle` — table headers, hover regions, grouped controls;
- `surface-muted` — wells and contained navigation;
- `surface-raised` — menus, popovers, floating toolbars;
- `surface-overlay` — dialogs and drawers;
- `scrim` — temporary modal separation.

Existing names may be retained where equivalent. The requirement is an explicit layer contract, not renaming for its own sake.

### 12.2 Border policy

- Cards: perimeter only when needed to distinguish from canvas; no perimeter inside an already raised panel.
- Tables: subtle horizontal divisions; no vertical grid.
- Inputs: use `edge-control` because the boundary is functional.
- Menus/popovers: subtle edge plus overlay shadow.
- Drawers/dialogs: shadow and scrim carry separation; avoid a dark frame.
- Section headers: spacing first, divider only between adjacent content groups.
- Focus: dedicated focus ring unaffected by softened decorative edges.

### 12.3 Radius policy

The reference's large radii should not be copied. Preserve a restrained three-level system:

- controls: approximately 6–8px;
- surfaces: approximately 10–12px;
- dialogs/major analytical regions: approximately 12–16px.

Pills remain reserved for badges, compact status, and truly pill-shaped controls. Nested surfaces should generally use equal or smaller radii than their parent.

### 12.4 Shadow tokens

Keep shadows semantic and rare:

- `shadow-surface`: optional quiet lift for a major workspace on canvas;
- `shadow-overlay`: menus, popovers, date pickers;
- `shadow-dialog`: modal dialogs and drawers;
- `shadow-sticky`: sticky toolbars or footers only when content scrolls beneath them.

Each token combines an ambient and a directional layer with low opacity. Do not create page-local shadows. A surface should not have both a strong border and a strong shadow.

## 13. Feedback and state system

The reconstruction needs shared contracts for:

- inline field error;
- form error summary;
- informational/warning/critical banner;
- toast for transient confirmation;
- persistent mutation status;
- empty state;
- loading skeleton;
- partial/stale data notice;
- permission-limited state;
- plan-limited state.

Toasts must not be the only record of a failed or incomplete critical operation. Settings and task flows should retain local failure state until the user resolves or dismisses it.

Skeletons should reflect the target composition. Repeating many generic gray lines is acceptable as a fallback, but analytical pages should preserve the hierarchy of the chart/value region and data workspaces should preserve toolbar/header/row geometry.

## 14. Responsive contracts

### 14.1 Breakpoint behavior is component-owned

Each shared composition component documents behavior at:

- compact mobile;
- large mobile/small tablet;
- tablet/small desktop;
- standard desktop;
- wide desktop.

Do not rely on every page author to rediscover wrapping rules.

### 14.2 Shell

- below desktop: mobile navigation drawer and compact global header;
- desktop: collapsible persistent sidebar;
- content gutters scale but never create an unnecessarily narrow operational table;
- record/settings pages may bound their internal reading width without changing shell alignment.

### 14.3 Overlays

- drawers become full-screen below their safe minimum width;
- sticky actions account for device safe areas;
- forms become one column when related fields no longer have adequate label and input width;
- close, Back, and primary action remain reachable without horizontal scrolling.

### 14.4 Split workspaces

Messages, inspectors, and similar list/detail views use:

- desktop: resizable or fixed-ratio split only if supported by testing;
- tablet: list + modal inspector or route-based detail;
- mobile: separate routes or full-screen panels with explicit Back behavior.

## 15. Shared component roadmap

### 15.1 Extend

- `DataWorkspace`: first-class composition slots and density.
- `DataTable`: workspace-aware perimeter, selection-toolbar integration, scroll mode.
- `FilterBar`: workspace integration and responsive action priority.
- `PageHeader` → `PageIntro`: family variants and no default divider.
- `SlideOver` → `AppDrawer`: semantic sizes, sticky regions, dirty-close hook.
- `SettingsSection`: configuration-row and save-mode contracts.
- elevation and layer tokens: explicit overlay/sticky roles.

### 15.2 Add

- `AppDialog`;
- `ConfirmDialog`;
- `AppInspector` if queue research confirms repeated review;
- `AppTabs`;
- `FormSection`;
- `FormErrorSummary`;
- `RecordHeader` and `RecordSummary`;
- `BulkActionBar` integrated with `DataWorkspace`;
- optional `PageActionsOverflow` for responsive action priority.

### 15.3 Retire or prohibit

- native `confirm()` for product workflows;
- page-local tab implementations;
- arbitrary `z-[...]` values;
- separate FilterBar and DataTable cards where they form one workspace;
- long creation forms in narrow default drawers;
- new page-local border, shadow, radius, or overlay recipes;
- cards used only to create vertical spacing.

## 16. Migration plan

### Phase 0 — inventory and classification

1. Assign every authenticated route to a primary page family.
2. Inventory all 15 `SlideOver` usages by field count, sections, duration, context need, destructive risk, and mobile requirement.
3. Inventory local tab/segmented patterns, including implementations without `role="tablist"`.
4. Record table row/column counts and real overflow behavior for every list page.
5. Identify settings pages that save immediately versus stage changes.

**Gate:** no workflow is moved to a different surface on visual preference alone.

### Phase 1 — reconstruction lab

Build production-like prototypes in `/__design-system` using existing tokens and representative long content:

- standard data workspace;
- queue workspace with batch selection;
- record detail with context rail;
- settings detail with configuration rows;
- standard and wide drawers;
- short modal and destructive confirmation;
- full-page creation flow;
- tabs with overflow and keyboard behavior.

Test at 390, 768, 1024, 1280, 1440, and 1920px viewport widths.

**Gate:** product/design sign-off on composition and task-surface rules before route migration.

### Phase 2 — tokens and shared composition components

1. Add missing layer, scrim, sticky-shadow, and overlay tokens.
2. Implement `PageIntro`, `AppTabs`, `AppDialog`, `ConfirmDialog`, and the new drawer contract.
3. Extend `DataWorkspace` and integrate batch actions.
4. Add form-section and error-summary patterns.
5. Add component documentation and examples.

**Gate:** component unit/accessibility tests, token lint, contrast checks, focus-order tests, and responsive visual review pass.

### Phase 3 — representative vertical slice

Migrate one route from each major family:

- Dashboard — analytical;
- Vehicles or Transactions — data workspace;
- Dispatch Loads — operational queue;
- Vehicle or Load detail — record;
- Driver App Settings — settings;
- a verified complex create flow — task/full page.

Use feature flags or a development-only parallel route where rollback risk is material.

**Gate:** the slice works end-to-end with real data states, not only seeded happy paths.

### Phase 4 — overlay migration

1. Replace native confirmations.
2. Migrate simple dialogs and drawers.
3. Promote verified complex forms to full pages.
4. Introduce queue inspectors only where sequential review is proven.
5. Remove old `SlideOver` APIs after all consumers move.

**Gate:** no nested general overlays; focus return, Escape behavior, unsaved-change handling, and mobile full-screen behavior pass.

### Phase 5 — page-family rollout

Roll out by family rather than isolated page styling:

1. data workspaces;
2. settings;
3. record details;
4. queues;
5. remaining analytical pages;
6. conversation/workbench pages.

This keeps each shared component stable before it is multiplied across routes.

### Phase 6 — removal and governance

- remove deprecated recipes and APIs;
- enforce shared tabs, overlays, and workspace composition through lint/review rules;
- update `DESIGN-SYSTEM.md` only after the target has passed its prototype gates;
- add visual regression coverage for each family and state;
- document allowed exceptions with owner and rationale.

## 17. Verification matrix

### 17.1 Functional

- create/edit/cancel/success/failure;
- dirty-close and browser navigation;
- filter, clear, sort, paginate, select, batch action;
- row-to-detail and Back behavior;
- immediate and staged settings saves;
- refresh and deep-link behavior where routes represent overlay tasks.

### 17.2 Accessibility

- semantic heading and landmark order;
- visible focus and 3:1 essential non-text boundaries;
- dialog accessible name, modal state, initial focus, focus trap, Escape, and focus return;
- tab arrow-key behavior and tabpanel association;
- table headers, sort state, checkbox names, and action-menu names;
- error summary focus and links to invalid fields;
- zoom to 200% and text-only zoom/reflow;
- reduced-motion behavior;
- screen-reader review for one flow in every page family.

### 17.3 Visual

- surface hierarchy remains understandable without dark borders;
- no card-on-card framing unless layers have different interaction roles;
- the selected, hover, focus, disabled, error, and pending states remain distinct;
- typography does not become faint to achieve low contrast;
- long real labels, values, badges, and translated expansion do not break layout;
- overlays preserve action reachability at short viewport heights.

### 17.4 Performance

- no table virtualization without a measured need and accessibility plan;
- overlay open/close does not remount expensive page state unnecessarily;
- tab panels do not preload expensive remote data solely to enable automatic activation;
- sticky regions and shadows do not cause obvious scroll jank;
- skeletons do not produce material layout shift.

## 18. Enterprise acceptance criteria

The reconstruction is complete only when:

- every authenticated route is assigned to and follows a documented page family;
- every current drawer usage has a verified target-surface decision;
- one shared tabs component replaces local tab behavior;
- one overlay system owns focus, layering, scrim, width, sticky regions, and close protection;
- every primary table flow is one continuous data workspace unless an exception is documented;
- complex creations no longer use narrow drawers;
- settings pages declare immediate or staged save behavior;
- borders are quiet but controls, focus, selection, and status remain unambiguous;
- responsive behavior is tested per family, including short viewport heights;
- automated checks and manual assistive-technology review cover representative workflows;
- old APIs and local recipes are removed rather than left as indefinite alternatives.

## 19. Non-goals

- Replacing the sidebar with a horizontal global navigation.
- Rebuilding the working primitive library from scratch.
- Adding table features such as virtualization, pinned columns, saved views, or inline editing without evidence.
- Lowering text or control contrast below accessibility requirements to imitate the reference.
- Turning every page into an oversized analytical canvas.
- Introducing a new component library solely for visual novelty.
- Migrating all routes in one release.

## 20. Research basis

- [W3C WAI-ARIA Authoring Practices: Dialog (Modal) Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) — modal focus containment, Escape behavior, accessible naming, initial focus, and focus restoration.
- [W3C WAI-ARIA Authoring Practices: Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) — tab semantics, associations, arrow-key behavior, and activation guidance.
- [Carbon Design System: Data table usage](https://carbondesignsystem.com/components/data-table/usage/) — integrated table toolbar, batch actions, search, and pagination placement.
- [Carbon Design System: Create flows](https://carbondesignsystem.com/community/patterns/create-flows/) — choosing inline, modal, side-panel, tearsheet, or full-page creation by complexity and context need.
- [Carbon Design System: Color usage and layers](https://carbondesignsystem.com/elements/color/usage/) — explicit layer tokens for components placed on surfaces.
- [Atlassian Design System: Elevation](https://atlassian.design/foundations/elevation/) — pairing surface changes, shadows, and stacking rather than using one elevation signal indiscriminately.
- [GOV.UK Design System: Recover from validation errors](https://design-system.service.gov.uk/patterns/validation/) — preserving entered values and pairing field errors with a focused page-level summary.

These sources inform the contracts; they do not override FuelGuard's verified workflows, data density, or product requirements.
