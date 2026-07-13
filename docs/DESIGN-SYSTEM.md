# FuelGuard Design System

Vue 3 + Tailwind CSS v4. Tokens live in `apps/web/src/style.css`; primitives in
`apps/web/src/components/ui/`. Run `pnpm lint:tokens` to catch violations.

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
| `surface-inverse` | `bg-surface-inverse` | code blocks, tooltips |
| `ink` | `text-ink` | headings, primary values |
| `ink-secondary` | `text-ink-secondary` | body copy, labels, cell text |
| `ink-muted` | `text-ink-muted` | descriptions, captions, table heads |
| `ink-subtle` | `text-ink-subtle` | placeholders, disabled, em-dashes |
| `ink-inverse` | `text-ink-inverse` | text on brand/danger/inverse fills |
| `edge-subtle` | `divide-edge-subtle` | row dividers |
| `edge` | `ring-edge`, `border-edge`, `divide-edge` | card rings, hairlines |
| `edge-strong` | `ring-edge-strong` | input/control borders |

### Brand & status ramps (50–800, like a palette hue)

`brand` (indigo today — swap one ramp in style.css to re-brand), `danger` (red),
`caution` (orange, severity-high), `warning` (amber), `success` (green), `info` (blue).

Conventions: solid CTA `bg-brand-600 hover:bg-brand-500 text-ink-inverse`; links
`text-brand-600 hover:text-brand-500`; focus `focus:ring-brand-600` /
`focus-visible:outline-brand-600`; soft tint panels `bg-warning-50 text-warning-800
ring-warning-200`; badges via `lib/badges.ts` tones only.

`neutral-*` is the gray ramp escape hatch (skeletons, scrims `bg-neutral-900/60`,
the dark sidebar). Prefer roles. `white`/`black`/`transparent` literals are allowed
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
| `FormField` | ad-hoc label/error markup | `label`, `error`, `hint`, `required`; exposes `id` to slot |
| `BaseCard` | `rounded-lg bg-white shadow-sm ring-1 ring-gray-200` divs | `padding` none·sm·md |
| `PageHeader` | ad-hoc description/actions rows | `description` + `#actions` |
| `DataTable` | raw table + skeleton/error/empty plumbing | `loading/error/empty/emptyText/skeletonCols/dense`, slots `head`/default/`footer`/`empty`, `@retry` |

Existing shared components (`AppSelect`, `SearchInput`, `TableToolbar`,
`TablePagination`, `SortableTh`, `SlideOver`, `KebabMenu`, `StatusBadge`,
`DateRangeFilter`, `VehicleSelect`, `ToastContainer`, `ErrorState`) are already
tokenized — use them, don't fork them.

## 3. Page layout standards

- Page root: `<div class="space-y-6">`. Narrow single-column pages add
  `mx-auto max-w-2xl` (settings/forms) or `max-w-3xl` (content). The AppShell
  provides the outer container (`max-w-[1600px] px-4 sm:px-6 lg:px-8 py-8`).
- First row: `PageHeader` (description left, actions right; stacks below `sm`).
- Tables: always inside `DataTable` (gives `overflow-x-auto` for small screens).
  Cells: `px-6 py-3`, `th` adds `font-medium`; alignment/min-width per cell.
  Row hover: `hover:bg-surface-subtle`. Links in cells:
  `text-brand-600 hover:text-brand-500`.
- Stat/KPI grids: `grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4`
  (2-up variant: `sm:grid-cols-2`). Filter rows stack: `flex flex-col gap-3
  sm:flex-row sm:items-center`.
- Forms: `FormField` + `BaseInput`/`AppSelect`/`BaseCheckbox`; two-column
  groups use `grid grid-cols-1 gap-4 sm:grid-cols-2`.
- Radius: `rounded-md` controls, `rounded-lg` cards/panels. Card padding p-4/p-5
  via `BaseCard`. Vertical rhythm between sections: `space-y-6`.

## 4. Dark mode (future)

Roles are plain CSS custom properties. To ship dark mode: add
`@custom-variant dark` and a `.dark { --canvas: …; }` block in style.css,
re-point the roles + `--viz-*`, and audit ramp *tints* (`*-50` fills). No
template changes should be required.
