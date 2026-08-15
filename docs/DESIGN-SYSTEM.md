# FuelGuard Design System

Vue 3 + Tailwind CSS v4. Cross-application tokens live in
`packages/ui/src/tokens.css`; shared primitives live in `packages/ui/src/components/`.
The web and admin applications import that canonical source. Run
`pnpm lint:tokens-parity` and `pnpm --filter @fuelguard/web lint:tokens` to catch violations.

## 1. Color tokens

Templates never use raw palette utilities (`gray-*`, `indigo-*`, `red-*`, …),
hex values, or inline `style` colors. They use semantic tokens:

### Neutral roles (theme-aware — a future dark mode re-points these)

| Token | Utility examples | Use for |
|---|---|---|
| `canvas` | `bg-canvas` | app background behind cards |
| `surface` | `bg-surface` | cards, tables, inputs, popovers |
| `surface-subtle` | `bg-surface-subtle`, `hover:bg-surface-subtle` | table heads, hover rows |
| `surface-muted` | `bg-surface-muted` | soft buttons, wells |
| `surface-navigation` | `bg-surface-navigation` | persistent navigation, visually separate from the page canvas |
| `surface-inverse` | `bg-surface-inverse` | code blocks, tooltips |
| `ink` | `text-ink` | headings, primary values |
| `ink-secondary` | `text-ink-secondary` | body copy, labels, cell text |
| `ink-muted` | `text-ink-muted` | descriptions, captions, table heads |
| `ink-subtle` | `text-ink-subtle` | placeholders, disabled, em-dashes |
| `ink-inverse` | `text-ink-inverse` | text on brand/danger/inverse fills |
| `edge-subtle` | `divide-edge-subtle`, `ring-edge-subtle` | row dividers, card and overlay perimeters |
| `edge` | `ring-edge`, `border-edge`, `divide-edge` | quiet interactive boundaries and grouped surfaces |
| `edge-control` | `ring-edge-control` | essential input/control boundaries; preserves 3:1 contrast |

The page canvas and persistent navigation are separate surface roles. Keep the
canvas near-white and use `surface-navigation` for the sidebar; do not make both
areas the same color or recreate the distinction with a dark border.

### Brand & status ramps (50–800, like a palette hue)

`brand` (warm FuelGuard gold), `danger` (red),
`caution` (orange, severity-high), `warning` (amber), `success` (green), `info` (blue).

Gold is identity, not the default action color. Primary actions use
`bg-action-primary text-action-primary-foreground`; links and focus use their
dedicated blue `link` and `focus-ring` roles. Soft status panels use pale surfaces,
dark text, and restrained edges; badges use the shared badge tones.

`neutral-*` is the gray ramp escape hatch (skeletons and scrims such as
`bg-neutral-900/60`). Prefer roles. `white`/`black`/`transparent` literals are allowed
where they are truly theme-independent (e.g. text on a photo, the logo droplet).

### Charts (canvas)

Canvas can't read CSS vars — `features/dashboard/chartTheme.ts` resolves the
`--viz-*` tokens at runtime. Use `viz.brand`, `viz.spend`, `viz.severity.*`,
`viz.reference`, `viz.grid`, `viz.tick`; never hex in chart configs.

## 2. Components (`@/components/ui/`)

| Component | Replaces | Notes |
|---|---|---|
| `BaseButton` | every hand-rolled `<button>`/link-button | `variant` primary·secondary·danger·soft·ghost, `size` sm·md, `block`, `to` |
| `BaseInput` | raw `<input>` + local `inputCls` | attrs fall through; `invalid` prop; `text-base sm:text-sm` (no iOS zoom) |
| `BaseCheckbox` | raw checkboxes | slot = inline label |
| `BaseSwitch` | hand-rolled feature toggles | accessible immediate on/off settings; pass an `aria-label` when needed |
| `FormField` | ad-hoc label/error markup | `label`, `error`, `hint`, `required`; exposes `id` to slot |
| `BaseCard` | hand-rolled white/ring/shadow surfaces | `padding` none·sm·md; `variant` flat·bordered·raised |
| `PageHeader` | ad-hoc description/actions rows | `description` + `#actions` |
| `FilterBar` | loose filter rows above tables | the standard toolbar — see §3 |
| `FileDropzone` | bare `<input type=file>` uploads | drag & drop + browse; `accept`, `multiple`, `busy`, emits `files` |
| `DataTable` | raw table + skeleton/error/empty plumbing | column-definition API — see below |

Existing shared components (`AppSelect`, `SearchInput`, `TableToolbar`,
`TablePagination`, `SortableTh`, `SlideOver`, `KebabMenu`, `StatusBadge`,
`DateRangeFilter`, `VehicleSelect`, `ToastContainer`, `ErrorState`) are already
tokenized — use them, don't fork them.

## 3. Page layout standards

- Page root: `<div class="space-y-6">`. Narrow single-column pages add
  `mx-auto max-w-2xl` (settings/forms) or `max-w-3xl` (content). The AppShell
  provides the outer container — full width with small gutters
  (`w-full px-4 sm:px-6 lg:px-8 py-8`), so tables use the whole screen.
- First row: `PageHeader` (description left, actions right; stacks below `sm`).
- Tables: always inside `DataTable`, driven by a `columns` array
  (`{ key, label, sortable?, numeric?, align?, headerClass?, cellClass? }`)
  plus `rows` + `row-key`. The component owns alignment (text left; `numeric`
  right + tabular-nums; headers follow their column), cell padding
  (px-4 py-3, px-6 edge gutters), sort indicators (`:sort` + `@sort`),
  the sticky header (max-h-[70vh] scroll area), horizontal overflow, hover,
  loading/error/empty states, and the `#footer` pagination slot.
  Cell content: `#cell-<key>="{ row, value }"`; blank values render an
  ink-subtle "—" automatically. Links in cells:
  `text-brand-600 hover:text-brand-500` + `font-medium`.
  Selection (`selectable` + `v-model:selected` Set) ONLY on tables with bulk
  actions — never render checkboxes that have nothing to act on.
  Row actions: `#actions="{ row }"` slot with `KebabMenu` items — the
  standard trailing ⋮ column. Widths: fixed-ish columns get
  `headerClass: "min-w-[6rem]"`-style hints; text columns flex.
- Filtering: every table page uses `FilterBar` directly above its DataTable.
  Layout: search (w-72, debounced) → 2–4 PRIMARY filter controls inline
  (AppSelect w-32/w-44, DateRangeFilter) → a "Filters" popover (`#more`) for
  secondary dimensions with a count badge → result count ("1,204 transactions")
  and `#actions` on the right. Every active filter renders as a removable
  chip in a second row with a ghost "Clear all". Filters apply live
  (per-filter), page resets to 1 on change. Primary = what users reach for
  daily; secondary = occasionally useful. Never ship a filter no query uses.
- Dropdowns: one popover recipe everywhere —
  `rounded-control bg-surface py-1 text-sm shadow-overlay ring-1 ring-edge-subtle`
  (KebabMenu, AppSelect, and any Headless UI Menu panels). Menu items use
  the global `.kebab-item` classes. KebabMenu accepts a `#trigger` slot
  for non-⋮ triggers so toolbar dropdowns share the exact same panel.
- Stat/KPI grids: `grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4`
  (2-up variant: `sm:grid-cols-2`). Filter rows stack: `flex flex-col gap-3
  sm:flex-row sm:items-center`.
- Forms: `FormField` + `BaseInput`/`AppSelect`/`BaseCheckbox`; two-column
  groups use `grid grid-cols-1 gap-4 sm:grid-cols-2`.
- Radius: `rounded-md` controls, `rounded-lg` cards/panels. Card padding p-4/p-5
  via `BaseCard`. Vertical rhythm between sections: `space-y-6`.

## 4. Elevation

Depth is semantic; components never choose generic `shadow-sm`/`shadow-lg` values.

| Token | Utility | Use for |
|---|---|---|
| `elevation-card` | `shadow-card` | default card separation from the canvas |
| `elevation-card-raised` | `shadow-card-raised` | emphasized cards only |
| `elevation-overlay` | `shadow-overlay` | menus, comboboxes, toasts, floating banners |
| `elevation-dialog` | `shadow-dialog` | drawers and modal surfaces |

Cards and overlays pair elevation with `ring-edge-subtle`. Filter triggers use
`ring-edge`; actual text fields retain `ring-edge-control` because their boundary
must remain identifiable. Active filters communicate state with surface and text,
not a saturated colored perimeter.

## 5. Dark mode (future)

Roles are plain CSS custom properties. To ship dark mode: add
`@custom-variant dark` and a `.dark { --canvas: …; }` block in style.css,
re-point the roles + `--viz-*`, and audit ramp *tints* (`*-50` fills). No
template changes should be required.
