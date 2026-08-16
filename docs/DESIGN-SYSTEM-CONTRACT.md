# FuelGuard Design Contract

Derived from the code at `/sessions/rcw-01qhmrx3kcevgjmhgrqetsvy/mnt/FuelGuard`. Everything below is measured from real files, not from `docs/DESIGN-SYSTEM.md` (which is partly stale — noted where it diverges).

---

## 0. Ground truth files

| Thing | Path |
|---|---|
| Tokens + `@font-face` + `@layer components` | `apps/web/src/style.css` |
| Token linter | `apps/web/scripts/check-design-tokens.mjs` (`pnpm --filter web lint:tokens`) |
| Badge vocabulary | `apps/web/src/lib/badges.ts` |
| Sort helper | `apps/web/src/lib/sort.ts` |
| Page shell | `apps/web/src/layouts/AppShell.vue` |
| Written doc (stale in places) | `docs/DESIGN-SYSTEM.md` |

There is **no `tailwind.config.js`**. This is Tailwind v4; all theme extension happens in `@theme inline` blocks inside `style.css`.

**The linter currently passes clean** (`✓ design tokens clean`). So every deviation below is a *design-system* violation the linter cannot see. That is the point: the linter only catches colour, not structure.

---

## 1. Component inventory

### 1.1 `apps/web/src/components/ui/` — the primitives

| Component | Props (defaults) | Slots / events | What it is FOR |
|---|---|---|---|
| **`PageHeader.vue`** (19 ln) | `description?: string` | default (overrides description), `#actions` | The **first row of every page**. The page *title* is NOT here — it lives in the AppShell top bar from `route.meta.title`. This is only a muted one-line description + right-aligned actions. Renders `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`, description as `<p class="text-sm text-ink-muted">`, actions as `flex shrink-0 flex-wrap items-center gap-2`. |
| **`BaseCard.vue`** (20 ln) | `padding?: "none"\|"sm"\|"md"` (md), `as?: string` (div) | default | The **one raised surface**: `rounded-lg bg-surface shadow-sm ring-1 ring-edge`. `md`→`p-5`, `sm`→`p-4` (filter bars/compact), `none`→`overflow-hidden` (tables/lists that own their padding, and clips to the radius). |
| **`BaseButton.vue`** (53 ln) | `variant` (secondary), `size` (md), `type` (button), `block`, `disabled`, `to?: RouteLocationRaw` | default | The **one button**. Renders `<RouterLink>` when `to` is set and not disabled, else `<button>`. Base: `inline-flex items-center justify-center whitespace-nowrap rounded-md font-semibold transition-colors` + `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600` + `disabled:pointer-events-none disabled:opacity-50`. Variants verbatim: `primary: bg-brand-600 text-ink-inverse shadow-sm hover:bg-brand-500`, `secondary: bg-surface text-ink-secondary ring-1 ring-inset ring-edge-strong hover:bg-surface-subtle`, `danger: bg-danger-600 text-ink-inverse shadow-sm hover:bg-danger-500`, `soft: bg-surface-muted text-ink-secondary hover:bg-neutral-200`, `ghost: text-ink-muted hover:text-ink-secondary`. Sizes: `sm: gap-x-1 px-2.5 py-1.5 text-sm`, `md: gap-x-1.5 px-3 py-2 text-sm`. **Both sizes are `text-sm`** — there is no large button. |
| **`BaseInput.vue`** (25 ln) | `modelValue?: string\|number\|null` (""), `invalid?: boolean` | `inheritAttrs:false`, all native attrs fall through | The one text input. `block w-full rounded-md border-0 bg-surface px-3 py-1.5 text-base text-ink ring-1 ring-inset placeholder:text-ink-subtle focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm`. Ring is `ring-edge-strong focus:ring-brand-600`, or `ring-danger-400 focus:ring-danger-500` when `invalid`. `text-base` on mobile is deliberate (iOS focus-zoom). |
| **`BaseCheckbox.vue`** (27 ln) | `modelValue?: boolean`, `disabled?: boolean` | default = **inline label** | Renders its own `<label class="inline-flex items-center gap-2 text-sm text-ink-secondary">`. Box: `size-4 shrink-0 rounded border-edge-strong accent-brand-600`. **Never wrap this in another `<label>`.** |
| **`BaseSwitch.vue`** (32 ln) | `modelValue?: boolean`, `disabled?: boolean` | — | `role="switch"` toggle for *immediate* settings (not form fields). `h-6 w-11`, on = `bg-brand-600`, off = `bg-ink-subtle`. Label lives at the call site; pass `aria-label` if nothing labels it. |
| **`FormField.vue`** (32 ln) | `label?`, `hint?`, `error?`, `required?`, `id?` | default slot receives `{ id }` | Label + control + error/hint. Label: `block text-sm font-medium text-ink-secondary`, required marker `<span class="text-danger-600"> *</span>`. Control wrapper gets `mt-1` when a label exists. Error: `mt-1 text-sm text-danger-600`. Hint (only when no error): `mt-1 text-xs text-ink-muted`. |
| **`ComboSelect.vue`** (111 ln) | `modelValue: string`, `options: {value,label}[]`, `id?`, `placeholder?` ("Select…"), `disabled?` | — | The **form-field** searchable select — it *is* a `BaseInput` with a droplist. Click shows all options; typing filters; blur discards a half-typed non-match. Use inside `FormField`. **Not** for toolbars. |
| **`FilterSelect.vue`** (156 ln) | `modelValue: string`, `options`, `label: string`, `disabled?`, `block?` | — | The **toolbar** filter. Trigger reads `"Risk ▾"` idle / `"Risk: Review ✕"` active with a brand tint (`bg-brand-50/60 text-brand-800 ring-brand-600/30`). `""` option = "no filter". Auto-adds an inline search box when `options.length > 8`. `block` = full width, for use inside the FilterBar `#more` popover. |
| **`FilterBar.vue`** (146 ln) | `search?`, `searchPlaceholder?` ("Search…"), `count?: number\|null`, `countLabel?` ("results"), `chips?: FilterChip[]`, `moreCount?: number` | `#filters`, `#more`, `#actions`; emits `update:search`, `remove(key)`, `clear-all` | The **one table toolbar**. Full API in §5. |
| **`DataTable.vue`** (240 ln) | see §5.2 | see §5.2 | The **one data table**. |
| **`FileDropzone.vue`** (123 ln) | `accept?`, `multiple?`, `disabled?`, `label?` ("Drag & drop files here"), `hint?`, `busy?`, `busyLabel?` ("Reading…") | emits `files: File[]` | The **only sanctioned uploader**. Drag/drop + click/Enter/Space to browse. Parent owns parsing. |

### 1.2 `apps/web/src/components/` — shared, already tokenized

| Component | Props | For |
|---|---|---|
| **`SlideOver.vue`** (97) | `open: boolean`, `title: string`, `description?`, `size?: "md"\|"lg"` (md) | The one drawer. `md`→`max-w-md`, `lg`→`max-w-lg`. Structure in §6. |
| **`KebabMenu.vue`** (80) | `block?`, `placement?: Placement` (bottom-end), `triggerLabel?`, `tone?: "default"\|"sidebar"` | The one dropdown menu. Default trigger is `⋮`; `#trigger` slot for toolbar dropdowns. Children must be `<button class="kebab-item">`. Panel: `z-[9999] w-48 origin-top-right py-1 rounded-md bg-surface shadow-lg ring-1 ring-edge`, teleported to body with a `z-[9998]` click-catcher. |
| **`StatusBadge.vue`** (25) | `status: string` | Maps `active/resolved`→success, `maintenance/investigating`→warning, `open`→brand, else neutral, and renders `[BADGE_BASE, cls]`. |
| **`TablePagination.vue`** (80) | `page`, `pageSize?` (20), `total`, `loading?`; emits `update:page` | The table `#footer`. `flex items-center justify-between border-t border-edge-subtle px-4 py-3 sm:px-6`. Left: `Showing <b>1</b>–<b>20</b> of <b>1,204</b>` / `No results`. Right: "Page [n] of N" jump input (hidden below `sm`, only when `totalPages > 1`) + Prev/Next `BaseButton size="sm"`. |
| **`TableSkeleton.vue`** (17) | `rows?` (6), `cols?` (5) | Shimmer rows. Only DataTable calls it; you should not. |
| **`ErrorState.vue`** (24) | `message?` ("Something went wrong while loading this data."), `retrying?`; emits `retry` | Warning icon + message + Retry button (`Retrying…` while busy). Only DataTable calls it directly; use it standalone for non-table fetch failures. |
| **`SearchInput.vue`** (58) | `modelValue`, `placeholder?` ("Search…"), `debounce?` (250) | Debounced, `.trim()`-ed search box with magnifier + clear ✕. FilterBar owns it; use directly only outside a table. |
| **`AppSelect.vue`** (119) | `modelValue`, `options: SelectOption[]`, `placeholder?`, `disabled?`, `id?`, `ariaLabel?` | Non-searchable form select. Trigger matches BaseInput metrics (`px-3 py-1.5 text-sm ring-1 ring-inset ring-edge-strong`), panel matches the KebabMenu recipe. Min width `8rem`. |
| **`DateRangeFilter.vue`** (105) | `from?`, `to?`, `presets?` (true), `label?` ("Dates"), `maxDate?` (today) | Toolbar date range on VueDatePicker. Trigger is byte-identical to FilterSelect's trigger classes. Values are `YYYY-MM-DD`; pass `maxDate=null` for future-facing ranges such as DQ deadlines. `partialRange` MUST stay false. |
| **`VehicleSelect.vue`** (204) | `modelValue`, `vehicles: Vehicle[]`, `placeholder?` ("All vehicles"), `disabled?` | Legacy typeahead for vehicles. New code should use `FilterSelect`/`ComboSelect`. |
| **`ToastContainer.vue`** (126) | — | Renders `useToastStore()`. Card: `rounded-lg border-l-4 shadow-lg ring-1 ring-edge`, title `text-sm font-semibold text-ink`, message `mt-0.5 text-sm leading-snug text-ink-muted`, progress bar `h-0.5`. |
| **`UpdateBanner.vue`**, **`AppLogo.vue`**, **`BaseChart.vue`**, **`SparkLine.vue`** | — | App-update prompt; logo; ECharts/canvas wrapper; inline sparkline. |

**There is no `EmptyState` component and no `Skeleton` component.** Empty state = `DataTable`'s `empty-text` prop / `#empty` slot (`px-6 py-10 text-center text-sm text-ink-muted`). Skeleton = `TableSkeleton`, invoked only by DataTable. `SortableTh` and `TableToolbar` are referenced by `docs/DESIGN-SYSTEM.md` but **were deleted** (commit `df8a2c2`) — sorting is inside DataTable, the toolbar is FilterBar. Do not resurrect them.

### 1.3 `packages/ui/src/`

Barrel `@fuelguard/ui` exports `AppButton`, `AppInput`, `AppCard`, `AppIcon`; `@fuelguard/ui/icons` exports the curated icon set (147-line barrel over HugeIcons Stroke Rounded).

- `AppButton.vue` / `AppInput.vue` / `AppCard.vue` are **byte-identical clones** of `BaseButton` / `BaseInput` / `BaseCard`, intentionally, so `apps/admin` and `apps/web` share one look.
- **Rule:** inside `apps/web`, always import the `Base*` versions from `@/components/ui/`. Only `AppIcon` is imported from `@fuelguard/ui` in web code.
- `AppIcon`: `<AppIcon :icon="XIcon" class="size-4" aria-hidden="true" />`. Size comes from Tailwind `size-*` (never the `size` prop), colour from `currentColor` via `text-*`, `strokeWidth` defaults 1.5. **Never import from `@hugeicons/core-free-icons` directly** — add to `packages/ui/src/icons.ts` first.

---

## 2. Typography

### 2.1 Family
One family, set once:

```css
@font-face { font-family: "Hanken Grotesk"; ... }   /* 400, 400i, 500, 500i, 600, 700 */
@theme inline { --font-sans: 'Hanken Grotesk', system-ui, sans-serif; }
body { font-family: theme(--font-sans); }
```

`style.css` is the **only** sanctioned place a `font-family` appears. There is zero `font-sans`/`font-serif` usage in templates — inheriting is the rule. `font-mono` (the browser default mono stack) is sanctioned, and only for **machine identifiers**: card numbers, VINs, rule IDs, UN/HMT refs, TMS references, app usernames, CSV column names, audit `action` values, certificate fingerprints, driver passwords.

### 2.2 Size scale — the whole app uses six sizes

Census across `pages/ features/ components/ layouts/`:

```
454  text-sm      ← the default. body, cells, buttons, labels, inputs, helper links
361  text-xs      ← captions, badges, hints, sub-values, dense tables, chips
 35  text-2xl     ← KPI numbers only
 27  text-base    ← page title (AppShell h1), SlideOver title, card section h3 in settings pages
 16  text-lg      ← section h2 on a few detail/auth pages
  2  text-3xl     ← StatCard value; public marketing page h1
```

There is **no `text-md`, `text-xl`, `text-4xl`, `text-5xl`** anywhere. Adding one is a violation.

### 2.3 Weights

```
267 font-medium    239 font-semibold    41 font-mono    32 font-bold    17 font-normal
```

`font-bold` is reserved for **KPI numbers** (`text-2xl font-bold`). Headings are `font-semibold`. Emphasis inside body text is `font-medium`. `font-normal` only ever appears as a unit-suffix inside a bold KPI (e.g. `text-base font-normal text-ink-subtle` after `$12,431`).

### 2.4 The prescriptive type table

| Role | Exact classes | Where it lives |
|---|---|---|
| Page title | `text-base font-semibold text-ink` | `AppShell.vue:333` — **you never write this.** Set `route.meta.title`. |
| Page description | `text-sm text-ink-muted` | `PageHeader.vue:12` |
| Section heading (page level, h2) | `text-lg font-semibold text-ink` | `DashboardPage.vue:289`, `DriverAppSettingsPage.vue:252` |
| Card/panel heading (h3) | `text-base font-semibold text-ink` | `SettingsUsersPage.vue:199`, `OrgSettingsPage.vue:83`, `ThresholdsPage.vue:88` |
| **Drawer section heading (h3)** | `text-sm font-semibold text-ink` | `DriverAccessModal.vue:298,372`, `CertManager.vue:73,92`, `DqFilePanel.vue:115` |
| Eyebrow / group label | `text-xs font-semibold uppercase tracking-wider text-ink-muted` | `HazmatPage.vue:53` |
| Drawer title | `text-base font-semibold text-ink` | `SlideOver.vue:63` |
| Drawer description | `mt-1 text-sm text-ink-muted` | `SlideOver.vue:66` |
| Table header cell | `font-medium` on `thead.bg-surface-subtle.text-ink-muted` → renders `text-sm font-medium text-ink-muted` (`text-xs` when `dense`) | `DataTable.vue:163,182` |
| Table body cell | inherits `text-sm` (`text-xs` when `dense`); tone via `cellClass` | `DataTable.vue:161` |
| Table primary cell (name/id) | `cellClass: "font-medium text-ink"` | `DriversPage.vue:145`, `TrailersPage.vue:80` |
| Table secondary cell | `cellClass: "text-ink-secondary"` | everywhere |
| In-cell link | `font-medium text-brand-600 hover:text-brand-500` | `DispatchLoadsPage.vue:395`, `CompliancePage.vue:277` |
| Empty cell | `<span class="text-ink-subtle">—</span>` (automatic) | `DataTable.vue:226` |
| Form label | `block text-sm font-medium text-ink-secondary` | `FormField.vue:23` |
| Form hint | `mt-1 text-xs text-ink-muted` | `FormField.vue:30` |
| Form error | `mt-1 text-sm text-danger-600` | `FormField.vue:29` |
| Empty state | `px-6 py-10 text-center text-sm text-ink-muted` | `DataTable.vue:154` |
| Error state | `text-sm text-ink-secondary`, `max-w-md`, centered | `ErrorState.vue:18` |
| KPI label | `text-xs font-medium tracking-wide text-ink-muted uppercase` | `FuelLogPage.vue:254` |
| KPI value | `mt-1 text-2xl font-bold text-ink` | `FuelLogPage.vue:255` |
| KPI sub-caption | `mt-0.5 text-xs text-ink-subtle` | `FuelLogPage.vue:256` |
| Result count | `whitespace-nowrap text-sm text-ink-muted` | `FilterBar.vue:122` |
| Badge | `BADGE_BASE` → `inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium capitalize` | `lib/badges.ts:16` |

### 2.5 Arbitrary values — sanctioned vs not

Arbitrary **font sizes** exist in exactly 7 places, all `text-[11px]` for genuinely sub-caption metadata: `MessagesPage.vue:242`, `DispatchLoadDetailPage.vue:408,435`, `DashboardPage.vue:397`, `EfsClientCertCard.vue:158,189`, `EntityHistory.vue:122`, `AnomalyDetail.vue:58`.
**Contract: `text-[11px]` is grandfathered, not sanctioned. Use `text-xs`.** Any other arbitrary size is a violation.

`leading-*` is almost never set (8× `leading-5`, 1× each `leading-4/6/snug/relaxed`). **Do not set line-height.** The two exceptions worth keeping: `leading-snug` on toast messages and `leading-5` on tight multi-line helper text inside drawer cards.

---

## 3. Spacing and layout

### 3.1 The measured scale

```
128 mt-1     113 gap-3    106 gap-2    102 px-3    81 py-1.5   79 py-2
 74 mt-3      67 mt-0.5    66 mt-2     63 mt-4     61 space-y-6  53 gap-4
 41 px-4      36 px-2      33 gap-1.5  29 py-3     26 space-y-3  22 px-5
 21 space-y-2 21 p-4       21 p-3      19 space-y-4 18 py-4      13 p-5
```

Vocabulary: `0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6`. `gap-7`, `gap-8`, `p-6`, `p-8`, `space-y-8`, `mt-8` do **not** appear. Don't introduce them.

### 3.2 The page shell (you don't write this)

`AppShell.vue:351-354`:
```html
<main class="py-8">
  <div class="w-full px-4 sm:px-6 lg:px-8">
    <slot />
  </div>
</main>
```
Full width with small gutters — tables use the whole screen. There is no `max-w-7xl` container.

### 3.3 The standard page

```html
<template>
  <div class="space-y-6">
    <PageHeader description="…"><template #actions>…</template></PageHeader>
    <FilterBar …>…</FilterBar>
    <DataTable …>…<template #footer><TablePagination … /></template></DataTable>
    <SlideOver …>…</SlideOver>
  </div>
</template>
```

- Page root is **always** `<div class="space-y-6">`. 61 occurrences; every well-built page starts this way.
- Narrow pages add `mx-auto max-w-2xl` (settings/forms) or `max-w-3xl` (content).
- Two-column detail layouts: `grid grid-cols-1 gap-6 lg:grid-cols-[…]` (`HazmatEquipmentPage.vue:120`).
- KPI grids: `grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4`. Divided-KPI strip inside one `BaseCard padding="none"`: `dl.grid grid-cols-2 divide-y divide-edge-subtle sm:grid-cols-3 sm:divide-y-0 sm:divide-x lg:grid-cols-6`, each cell `px-5 py-4` (`FuelLogPage.vue:252`).
- Bulk-action bar (between FilterBar and DataTable, `v-if="selected.size > 0"`): `flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 px-4 py-2.5 ring-1 ring-brand-100`, count as `text-sm font-medium text-brand-800` (`TrailersPage.vue:185-189`, `DispatchLoadsPage.vue:320-324` — identical).
- Tab strip: `flex gap-1 rounded-lg bg-surface-muted p-1 text-sm` with items `rounded-md px-3 py-1.5 font-medium`, active `bg-surface text-ink shadow-sm` (`DispatchLoadsPage.vue:284-291`).

### 3.4 The standard card
`<BaseCard>` = `p-5`. `<BaseCard padding="sm">` = `p-4` (FilterBar). `<BaseCard padding="none">` = table/list host. Never hand-write `rounded-lg bg-surface shadow-sm ring-1 ring-edge`.

Soft tint panel (inline note/alert, *not* a card):
```html
<p class="rounded-lg bg-warning-50 px-4 py-3 text-sm text-warning-800 ring-1 ring-inset ring-warning-200">
```
(`DispatchLoadDetailPage.vue:333`). Note `ring-1 ring-inset`, never `border`.

### 3.5 The standard section inside a drawer

Measured from `DriverAccessModal.vue` (the best drawer in the repo) and `CertManager.vue`:

```html
<div class="space-y-6">            <!-- drawer body: sections separated by space-y-6 -->
  <section aria-labelledby="x-heading">
    <h3 id="x-heading" class="text-sm font-semibold text-ink">Account access</h3>
    <p class="mt-1 text-sm text-ink-muted">One sentence of context.</p>
    <div class="mt-4 space-y-4">   <!-- form fields at space-y-4 -->
      <FormField …><BaseInput … /></FormField>
    </div>
  </section>
</div>
```

- Section heading: `text-sm font-semibold text-ink` (**not** `text-base`).
- Heading→subtext: `mt-1`. Subtext→content: `mt-4` (forms) or `mt-3` (cards/lists).
- Forms: `space-y-4` between fields; two-up groups `grid grid-cols-1 gap-4 sm:grid-cols-2` (or `gap-3` / `grid-cols-2` in the older fleet forms).
- Optional divider between sections: `<div class="border-t border-edge pt-5">`.
- Radius: `rounded-md` for controls, `rounded-lg` for cards/panels. `rounded-full` **only** for the switch knob, avatars and the FilterBar count pill — **not** for badges.

---

## 4. Colour and semantic tokens

### 4.1 What the linter forbids — `apps/web/scripts/check-design-tokens.mjs`

It walks every `.vue|.ts|.css|.html` under `apps/web/src` (skipping `*.test.ts`) and fails the build on three regexes:

```js
BANNED_HUES = "(?:slate|gray|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|
                 sky|blue|indigo|violet|purple|fuchsia|pink|rose)"
UTIL_PREFIX = "(?:bg|text|ring|border|divide|placeholder|outline|decoration|fill|stroke|
                 accent|caret|from|via|to|shadow)"

1. "raw palette utility"    →  /\b{UTIL_PREFIX}-{BANNED_HUES}-\d+(?:\/\d+)?\b/g
2. "hex color"              →  /#[0-9a-fA-F]{3,8}\b/g
3. "inline color style"     →  /style="[^"]*(?:color|background)[^"]*"/g
```

Allow-list is exactly two files: `style.css` (defines the tokens) and `features/dashboard/chartTheme.ts` (jsdom canvas fallbacks). Per-line escape hatch: a trailing `// token-check-disable-line` comment.

**Not caught by the linter, but still forbidden by the contract:** `border-*` where `ring-*` is the idiom; `rounded-full` badges; hand-rolled badge/button/card markup; non-existent tokens like `border-border` (silently renders nothing).

### 4.2 The semantic roles and their rule

Neutrals (a future `.dark {}` re-points these; **always prefer these over `neutral-*`**):

| Token | Utilities | Use it when |
|---|---|---|
| `canvas` | `bg-canvas` | app background behind cards |
| `surface` | `bg-surface` | cards, tables, inputs, popovers, drawer panel |
| `surface-subtle` | `bg-surface-subtle`, `hover:bg-surface-subtle` | table `<thead>`, row hover, wells inside cards |
| `surface-muted` | `bg-surface-muted` | soft buttons, tab strips, kebab hover, chip fill |
| `surface-inverse` | `bg-surface-inverse` | code blocks, tooltips |
| `ink` | `text-ink` | headings, primary cell values, KPI numbers |
| `ink-secondary` | `text-ink-secondary` | body copy, form labels, secondary cell text, kebab items |
| `ink-muted` | `text-ink-muted` | descriptions, captions, table headers, result counts, hints |
| `ink-subtle` | `text-ink-subtle` | placeholders, disabled, icons at rest, the em-dash `—` |
| `ink-inverse` | `text-ink-inverse` | text on brand/danger fills |
| `edge-subtle` | `divide-edge-subtle`, `border-edge-subtle` | row dividers, pagination top border |
| `edge` | `ring-edge`, `border-edge`, `divide-edge` | card rings, drawer header/footer borders, popover rings |
| `edge-strong` | `ring-edge-strong` | input and control borders |

Ramps 50–800: `brand` (indigo), `danger` (red), `caution` (orange = severity *high*), `warning` (muted gold), `success` (green), `info` (blue). Plus `neutral-50…900` as an **escape hatch only** — its legitimate uses in this codebase are exactly three: `bg-neutral-900/60` (SlideOver scrim), `bg-neutral-200` (TableSkeleton shimmer, `hover:bg-neutral-200` on soft buttons/chips), and `ring-neutral-500/20` (neutral badge).

Conventions, verbatim from the code:
- Solid CTA: `bg-brand-600 hover:bg-brand-500 text-ink-inverse`
- Link: `text-brand-600 hover:text-brand-500` (+ `font-medium` in table cells)
- Focus: `focus:ring-brand-600` on inputs, `focus-visible:outline-brand-600` on buttons
- Active filter tint: `bg-brand-50/60 text-brand-800 ring-brand-600/30 hover:bg-brand-50`
- Selected row tint: `bg-brand-50/40` (built into DataTable)
- Selected option in a popover: `bg-brand-50 font-medium text-brand-700`
- Soft tint panel: `bg-{tone}-50 text-{tone}-700|800 ring-1 ring-inset ring-{tone}-200`
- Chart colours: never hex; `viz.brand`, `viz.spend`, `viz.severity.*`, `viz.grid`, `viz.tick` from `features/dashboard/chartTheme.ts`

`--sidebar-*` roles (warm graphite) are consumed only through the `.sidebar-*` classes in `@layer components`. Feature code never touches them.

### 4.3 `apps/web/src/lib/badges.ts` — where every badge must come from

```ts
const SOFT = {
  danger:  "bg-danger-50 text-danger-700 ring-1 ring-inset ring-danger-600/20",
  caution: "bg-caution-50 text-caution-700 ring-1 ring-inset ring-caution-600/20",
  warning: "bg-warning-50 text-warning-700 ring-1 ring-inset ring-warning-600/20",
  success: "bg-success-50 text-success-700 ring-1 ring-inset ring-success-600/20",
  info:    "bg-info-50 text-info-700 ring-1 ring-inset ring-info-600/20",
  brand:   "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/20",
  neutral: "bg-surface-subtle text-ink-muted ring-1 ring-inset ring-neutral-500/20",
} as const;

export const BADGE_BASE =
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium capitalize";

export const toneClass = (key: string): string => SOFT[key as BadgeTone] ?? SOFT.neutral;
```

Plus domain mappers, all returning `toneClass(...)`: `severityTone` (critical→danger, high→caution, medium→warning, else neutral), `statusTone`, `txnStatusTone` (alert→danger, review→warning, verified→success, else neutral), `inviteTone`, `suspicionTone`.

**Contract:**
1. Every badge is `:class="[BADGE_BASE, toneClass('success')]"` or `:class="[BADGE_BASE, severityTone(row.severity)]"`, or `<StatusBadge :status="…" />`.
2. Badges are `rounded-md`, `px-2 py-0.5`, `text-xs font-medium`. **Never `rounded-full`.**
3. Fill is always the `-50` tint with a `-600/20` inset ring. **Never the `-100`/`-700` pair.**
4. A new tone means a new entry in `SOFT` — not a local `Record<string, string>` in a page.

---

## 5. Tables, search and filtering — the pattern

### 5.1 The three best examples

1. **`pages/TrailersPage.vue`** (287 ln) — canonical client-side list: search + 2 `FilterSelect`, client sort, client pagination, bulk selection, `KebabMenu`, `SlideOver` form. The cleanest end-to-end reference.
2. **`pages/DispatchLoadsPage.vue`** (447 ln) — the full toolbar: chips + `#more` popover + `moreCount`, tab queues, two different DataTables (list + exceptions feed), row-click → route, bulk actions.
3. **`pages/FuelLogPage.vue`** (361 ln) — server-side pagination + server-side sort, `DateRangeFilter`, sticky first column, `dense`, `row-class`, `#more` popover with chips, KPI strip.

(`DriversPage.vue` is a good structural example but carries two hand-rolled badge maps — see §8.)

### 5.2 DataTable — exact API

```ts
export interface DataTableColumn {
  key: string;
  label: string;
  sortable?: boolean;
  numeric?: boolean;                       // adds tabular-nums — does NOT right-align
  align?: "left" | "right" | "center";
  headerClass?: string;                    // widths live here: "min-w-[8rem]" / "w-32"
  cellClass?: string;                      // tone/truncation overrides
}
```

Props (defaults in brackets): `columns`, `rows`, `rowKey` `[**"id"**]` (string or `(row)=>string`), `loading` `[false]`, `error` `[null]`, `retrying` `[false]`, `emptyText` `["No results."]`, `selectable` `[false]`, `selected?: Set<string>`, `sort?: SortState` `[null]`, `dense` `[false]`, `nowrap` `[true]`, `stickyHeader` `[true]`, `rowClass?: (row)=>string`.

Emits: `retry`, `sort(key)`, `update:selected(Set)`, `row-click(row)`.

Slots: `#cell-<key>="{ row, value }"`, `#actions="{ row }"`, `#footer`, `#empty`.

Behaviour it owns, so you don't:

- **Wrapper**: `<BaseCard padding="none">`. Never wrap a DataTable in another card.
- **State precedence** (`:150-157`): `loading` → `<TableSkeleton :cols="…">`; else `error` → `<ErrorState :message :retrying @retry>`; else `rows.length === 0` → `<div class="px-6 py-10 text-center text-sm text-ink-muted">{{ emptyText }}</div>`; else the table + `#footer`. **The footer/pagination does not render in any of the three non-happy states.**
- **Alignment** (`:128-129`): `align === "left" → text-left`, `align === "right" → text-right`, **everything else → `text-center`**. This is deliberate (commit `5c5449b` "uniform center-aligned grid"). ⚠️ **Landmine:** `numeric: true` only adds `tabular-nums`; it does **not** right-align. The docblock at `DataTable.vue:29-31` and `docs/DESIGN-SYSTEM.md §3` both still claim "text left, numeric right" and are **stale**.
  **Rule: omit `align` entirely.** 20+ pages do. The four that pass `align: "left"` (CompliancePage, HazmatLoadsPage, HazmatEquipmentPage, HazmatReviewPage) are a visible fork.
- **Padding** (`:131-140`): `px-4 py-3`, or `px-4 py-2` when `dense`. First column gets `pl-6` (unless `selectable`); last gets `pr-6` (unless there's an actions column).
- **Header**: `bg-surface-subtle text-ink-muted shadow-[inset_0_-1px_0_0_var(--edge)]`, `sticky top-0 z-10` inside a `max-h-[70vh] overflow-y-auto` scroller. Sortable headers are a `<button class="group inline-flex items-center gap-1 hover:text-ink-secondary">` with `ChevronUp`/`ChevronDown`/`ChevronUpDown` at `size-3.5`.
- **Body**: `divide-y divide-edge-subtle`; rows `hover:bg-surface-subtle`; selected rows `bg-brand-50/40`.
- **Blank cells**: `<span class="text-ink-subtle">—</span>` automatically. Don't write `|| "—"` in a cell slot unless the fallback is a word ("Unassigned", "N/A").
- **Actions column**: `w-12 pl-2 pr-6 text-right`, `@click.stop`, header is `<span class="sr-only">Actions</span>`. Appears only when you provide `#actions`.
- **Selection**: leading `w-10 pl-6 pr-2` checkbox column, header checkbox toggles the current page with indeterminate state. **Only render `selectable` when the page has bulk actions.**
- **Density**: `dense` is `text-xs` + `px-4 py-2`, for audit/sub-tables. Roster/entity tables are not dense.

### 5.3 Sorting

Client-side (`TrailersPage.vue:63-68`):
```ts
const sort = ref<SortState>({ key: null, dir: "asc" });
function onSort(key: string) { sort.value = toggleSort(sort.value, key); }
const sorted = computed(() => sortRows(filtered.value, sort.value, getVal));
```
`toggleSort` cycles **none → asc → desc → none**. `sortRows` sorts numbers numerically, strings via `localeCompare(…, {numeric:true})`, **nulls last**. Pass a `get` accessor when a column is derived (`DispatchLoadsPage.vue:162-168`).

Server-side (`FuelLogPage.vue:39-42`): same `toggleSort`, then push `sortKey`/`sortDir` into the query filters. Never sort in the template.

### 5.4 Pagination

```ts
const PAGE_SIZE = 20;
const page = ref(1);
watch([search, statusFilter, reeferFilter], () => (page.value = 1));
const pageRows = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
```
Rendered only in the `#footer` slot:
```html
<template #footer>
  <TablePagination :page="page" :page-size="PAGE_SIZE" :total="filtered.length"
                   :loading="isFetching" @update:page="page = $event" />
</template>
```
`:total` is the **filtered** count, not the page length. `PAGE_SIZE = 20` unless a server constant says otherwise (`FUEL_PAGE_SIZE`). Extra hardening in `DispatchLoadsPage.vue:212-215`: clamp `page` down when the filtered set shrinks.

### 5.5 FilterBar — exact API and the required layout order

```
<BaseCard padding="sm">
  flex flex-col gap-3 lg:flex-row lg:items-center
    [search  w-full lg:w-64 lg:shrink-0]   ← SearchInput, 250 ms debounce, trimmed
    [#filters  flex flex-wrap items-center gap-2]   ← 2–4 PRIMARY FilterSelect / DateRangeFilter
    [Filters ⏷ button + popover]           ← only rendered if #more is provided
    [lg:ml-auto: count · #actions]
  [chips row: mt-3 flex flex-wrap items-center gap-2 border-t border-edge-subtle pt-3]
</BaseCard>
```

Props: `search?`, `searchPlaceholder?` (`"Search…"`), `count?: number|null`, `countLabel?` (`"results"`), `chips?: FilterChip[]` (`{key,label,value}`), `moreCount?: number`. Emits `update:search`, `remove(key)`, `clear-all`.

Rules encoded in the component and honoured by the good pages:

1. `v-model:search` + `search-placeholder` naming the searchable fields: `"Search unit, make, model, plate…"`, `"Search load #, driver, unit, commodity…"`, `"Search name, driver ID, employee ID, phone…"`. Ellipsis is `…`, not `...`.
2. `:count="filtered.length"` + `count-label="trailers"` — always a **domain noun**, never "results". Renders `count.toLocaleString()`.
3. `#filters` holds 2–4 **primary** dimensions as `FilterSelect` (the trigger shows its own active value — do **not** also add a chip for these).
4. `#more` holds **secondary** dimensions as `<FilterSelect … block />`. Popover: `w-72 rounded-md bg-surface p-4 text-sm shadow-lg ring-1 ring-edge`, inner `space-y-3`. `:more-count` badges how many are active.
5. `:chips` mirror **only the `#more` filters**, with `@remove` and `@clear-all`:
   ```ts
   const chips = computed<FilterChip[]>(() => {
     const out: FilterChip[] = [];
     if (filters.value.driverId) out.push({ key: "driver", label: "Driver", value: driverName(filters.value.driverId) });
     return out;
   });
   const moreCount = computed(() => (filters.value.driverId ? 1 : 0));
   function removeChip(key: string) { if (key === "driver") filters.value = { ...filters.value, driverId: undefined }; }
   function clearAll() { /* reset every filter, keep sort */ }
   ```
6. Filters apply live, per-filter. No Apply button. `page` resets to 1 via `watch`.
7. Never ship a filter no query consumes.

### 5.6 Row actions

```html
<template #actions="{ row }">
  <KebabMenu v-if="session.canManage">
    <button class="kebab-item" @click="openEdit(row)">Edit</button>
    <button class="kebab-item" @click="toggleReefer(row)">{{ row.is_reefer ? "Unmark reefer" : "Mark as reefer" }}</button>
    <button v-if="row.status !== 'retired'" class="kebab-item kebab-item-danger" @click="onRetire(row)">Retire</button>
  </KebabMenu>
</template>
```
`.kebab-item` / `.kebab-item-danger` are global classes in `style.css` — never re-style menu items locally. Destructive last, `kebab-item-danger`. Gate on `session.canManage`.

> **Corrected 2026-08-16.** The snippet above and §1.2 both said the children must be a bare `button` element. They must NOT be: `lint:ui-adoption` counts raw buttons in `pages/` and `features/` with **zero tolerance**, so a literal element there is a red CI gate. Every real kebab in this codebase uses `<BaseButton class="kebab-item">` — `TrailersPage.vue:254`, `DriverQualificationPage.vue:403`, `PlanHistory.vue:205` — and the doc was the side that had drifted. Two further traps found the same day: `CompliancePage.vue:460` uses a `RouterLink.kebab-item`, which is a third pattern nobody documented, and the gate is a plain regex over file TEXT, so naming the element in a comment trips it too. Single-action rows may use a `<BaseButton variant="ghost" size="sm" @click.stop>` instead (`DispatchLoadsPage.vue:365`).

### 5.7 Row → drawer

Two sanctioned shapes:

**Drawer** (entity CRUD — Trailers, Drivers, Fuel log):
```ts
const drawerOpen = ref(false);
const editing = ref<Trailer | null>(null);
function openEdit(t: Trailer) { editing.value = t; drawerOpen.value = true; }
```
```html
<SlideOver :open="drawerOpen" :title="editing ? 'Edit trailer' : 'New trailer'" @close="drawerOpen = false">
  <TrailerForm :trailer="editing" :vehicles="vehicles ?? []" :submitting="saving"
               @submit="onSubmit" @cancel="drawerOpen = false" />
</SlideOver>
```

**Route** (rich, deep-linkable detail — Loads): `@row-click="openDetail"` → `router.push({ name: "load-detail", params: { id } })`, and the primary cell is *also* a real focusable link/button so keyboard users aren't stuck (`DispatchLoadsPage.vue:394-398`). The reason is documented at `DispatchLoadsPage.vue:190-191`: a drawer over the list cache could not deep-link and went stale.

### 5.8 Mutation feedback

```ts
try {
  await updateTrailer.mutateAsync({ id, input });
  drawerOpen.value = false;
  toast.success("Trailer updated");
} catch (e) {
  toast.error("Could not save trailer", e instanceof Error ? e.message : undefined);
}
```
Always toast; never render an inline "saved!" banner. Title is the human sentence; the raw error message goes in the optional second argument.

---

## 6. Drawers / SlideOver

### 6.1 Internal structure (`components/SlideOver.vue`)

```
TransitionRoot → Dialog (z-50)
  scrim:  fixed inset-0 bg-neutral-900/60          (fade 300ms)
  panel:  right, max-w-md | max-w-lg, translate-x  (slide 300ms)
    flex h-full flex-col bg-surface shadow-xl
    ├ HEADER  flex items-start justify-between gap-4 border-b border-edge px-4 py-4 sm:px-6
    │   DialogTitle       text-base font-semibold text-ink
    │   DialogDescription mt-1 text-sm text-ink-muted        (only when `description`)
    │   close BaseButton  variant="ghost" size="sm" -mr-2 shrink-0 px-2 text-ink-subtle, aria-label="Close drawer"
    ├ BODY    flex-1 overflow-y-auto px-4 py-6 sm:px-6      → <slot />
    └ FOOTER  border-t border-edge bg-surface px-4 py-4 sm:px-6  → <slot name="footer" /> (only if provided)
```

### 6.2 The rules

- Header, padding and the close button are **not yours** — never re-add a title or an ✕ inside the body.
- Body root is `<div class="space-y-6">`; each section is `<section aria-labelledby>` with an `h3.text-sm.font-semibold.text-ink`.
- **Actions belong in `#footer`**, right-aligned, `flex items-center justify-end gap-3`, secondary first then `variant="primary"` last. Use `size` default (`md`) in footers.
- Cross-fields submit via `<form :id="…">` in the body + `<BaseButton :form="…" type="submit">` in the footer, so the footer stays pinned while the body scrolls.
- Destructive confirmations **replace the body**, they do not stack a second modal.
- `size="lg"` when the drawer holds a real form or a two-panel flow; `md` otherwise.

### 6.3 The best example — `features/roster/DriverAccessModal.vue`

Body swaps between three states, footer swaps with them:

```html
<SlideOver :open="open" title="Manage app login" :description="driver?.full_name" size="lg" @close="close">
  <div v-if="driver">
    <!-- Confirmation replaces the drawer body so the decision is focused and reversible. -->
    <div v-if="confirmation" class="flex min-h-[26rem] flex-col items-center justify-center text-center"> … </div>
    <DriverCredentialHandoff v-else-if="issued" v-model:show-password="showIssuedPassword" :credential="issued" @copy="copy" />
    <div v-else class="space-y-6">
      <DriverAccessSummary :driver="driver" :access="access" />
      <form v-if="access === 'none'" id="driver-login-form" aria-labelledby="create-login-heading" @submit.prevent="createLogin">
        <h3 id="create-login-heading" class="text-sm font-semibold text-ink">Login details</h3>
        <p class="mt-1 text-sm text-ink-muted">The suggested username is based on this driver's roster details.</p>
        <div class="mt-4 space-y-4">
          <FormField v-slot="{ id }" label="Username" required :error="usernameProblem ?? undefined"
                     hint="3–32 lowercase letters, numbers, periods, dashes, or underscores."> … </FormField>
        </div>
      </form>
      …
    </div>
  </div>

  <template v-if="driver" #footer>
    <div v-if="confirmation" class="flex items-center justify-end gap-3">
      <BaseButton :disabled="busy" @click="confirmAction = null">Back</BaseButton>
      <BaseButton :variant="confirmation.tone === 'danger' ? 'danger' : 'primary'" :disabled="busy" @click="runConfirmedAction">
        {{ busy ? "Working…" : confirmation.confirmLabel }}
      </BaseButton>
    </div>
    <div v-else-if="access === 'none'" class="flex items-center justify-end gap-3">
      <BaseButton :disabled="busy" @click="close">Cancel</BaseButton>
      <BaseButton form="driver-login-form" type="submit" variant="primary"
                  :disabled="busy || !!usernameProblem || !!passwordProblem">
        <AppIcon :icon="KeyIcon" class="size-4" aria-hidden="true" />
        {{ create.isPending.value ? "Creating…" : "Create app login" }}
      </BaseButton>
    </div>
    …
  </template>
</SlideOver>
```

Note the `<form :id>` + `<BaseButton :form type="submit">` bridge, the busy-label swap, and validation as computed strings fed to `FormField :error`.

---

## 7. Writing tone

### 7.1 The voice, precisely

- **Sentence case.** Only proper nouns and product names capitalise: `Samsara`, `EFS`, `HazmatGuard`, `FuelGuard Driver app`, `TMS`, `MPG`, `HOS`, `ULSR`. Never Title Case, never ALL CAPS (uppercase is a CSS decision on eyebrows/KPI labels, not a content decision).
- **Buttons and toast titles: no terminal period.** `New trailer`, `Reconcile with Samsara`, `Send to driver`, `Trailer updated`, `Password reset`.
- **Full sentences take a period.** Empty states, hints, descriptions, error bodies: `No drivers match these filters.` / `Optional. Leave blank and FuelGuard will generate a strong password.`
- **Length.** Buttons 1–3 words. Toast titles ≤5 words. Empty states 1 sentence (2 if the second is an instruction). Page descriptions 1–2 sentences. Hints ≤1 line.
- **It explains, then instructs.** The house move is *state the fact, then name the next action*: `No trailers yet. Add one, or sync from Samsara.`
- **Failures are "Could not …", never "Error" / "Failed to".** `Could not save trailer`, `Could not clear that exception`, `Could not create login`. The raw exception goes in the toast's second argument, never in the title. Exceptions that read as a state, not a blame, are allowed: `Bulk update failed`, `Mail test failed`.
- **Busy states are gerund + `…`** and replace the label in place: `Saving…`, `Merging…`, `Retrying…`, `Creating…`, `Enabling…`, `Working…`, `Analyzing…`, `Uploading…`. Always the single-character ellipsis `…`.
- **`…` also means "opens something".** Menu items that lead to a drawer/dialog end in it: `Manage app login…`, `Create app login…`, `Manage certifications…`, `Reassign…`.
- **Domain jargon is used freely and never explained inline** — `HOS`, `reefer (ULSR)`, `DQ file`, `§391.51`, `placard`, `odometer regression`. The audience is fleet ops. But *product* jargon is banned: no "entity", "record set", "item", "resource".
- **Second person, present tense, active voice.** `Assign drivers to vehicles from the Vehicles page.` Not "Drivers can be assigned…".
- **Never apologise, never exclaim.** Zero `!` and zero "Oops"/"Sorry" in the codebase.
- **Consequences are stated plainly**, including irreversibility: `The password disappears when you close this drawer and cannot be recovered.`

### 7.2 Ten real strings that are GOOD

1. `"No trailers yet. Add one, or sync from Samsara."` — `TrailersPage.vue:224`. Names the state, then gives *both* real next actions. Two clauses, one sentence.
2. `"No loads yet — create one or wait for a TMS feed."` — `DispatchLoadsPage.vue:173`. An em-dash carries the instruction; "wait" is honoured as a legitimate action rather than pretending the user must act.
3. `"Nothing needs attention right now."` — `DispatchLoadsPage.vue:344`. Empty exceptions queue framed as *good news*, not absence of data.
4. `"No idle data yet — run a Samsara sync from Settings → Data & Sync to populate the idle foundation."` — `IdlingPage.vue`. Empty state that names the exact navigation path. This is the house standard for "you have nothing because a prerequisite is unmet".
5. `"Copy these details now. The password disappears when you close this drawer and cannot be recovered."` — `DriverCredentialHandoff.vue:165-167`. Imperative first, consequence second. No hedging, no "please".
6. `"Optional. Leave blank and FuelGuard will generate a strong password."` — `DriverAccessModal.vue:326`. Optionality stated in one word, then the default behaviour spelled out so the empty field isn't ambiguous.
7. `"Resolve the ✕ items in the checklist below to approve."` — `DispatchLoadDetailPage.vue`. Explains a disabled button by pointing at the exact thing blocking it. Never `"You do not have permission"`-style dead ends.
8. `"Required — the driver and any auditor will see this"` — `DispatchLoadDetailPage.vue` placeholder. A placeholder that changes behaviour: it tells you *who reads this*, which is why the field exists.
9. `"Rescoring started"` / `"Checking each declined attempt against Samsara — refresh in a minute."` — `RejectionsPage.vue`. Title = what happened; body = what the system is doing and the realistic wait. Sets an expectation instead of a spinner.
10. `"Unrecognized report"` / `"Expected a Pilot / Flying J 'All Transactions' export with Authorization_No, Card_No and Quantity columns."` — `usePriceUpload.ts`. The failure title is three words; the body names the exact expected artefact *and* the columns. This is the gold standard for import errors.

Honourable mentions worth copying: `"Certificate staged"` / `"It is not presenting yet — test it against EFS, then activate."`; `"Driver login revoked"` / `"The driver record and history were not changed."`; `"Fuel data verified"` / `"All 412 fuel events match the stored EFS lines — nothing to repair."`

---

## 8. Anti-patterns already present

All of these pass `lint:tokens`. They are structural and typographic violations, and they are the reason a new screen written by copying these files would look wrong.

### 8.1 `features/compliance/DqFilePanel.vue` (183 ln)

| Line(s) | Violation |
|---|---|
| **132–171** | **A hand-rolled `<table>` where `DataTable` exists.** Four columns, a status column, a per-row action — this is exactly what `DataTable` is for. Fix: `DataTable` with `:sticky-header="false"` (like `HazmatEquipmentPage.vue:207`). |
| **133** | Header row is `text-left text-xs uppercase tracking-wide text-ink-subtle`. The system's table header is `bg-surface-subtle text-ink-muted font-medium` with **no uppercase, no tracking, and `text-sm`** (`DataTable.vue:163,182`). Three separate deviations in one class string. |
| **135–138, 143–152** | Cell padding is `py-1 pr-3` / `py-1.5 pr-3`. The system is `px-4 py-3` (or `px-4 py-2` dense). Rows here are ~50 % tighter than every other table in the app and have no left gutter. |
| **142** | `border-t border-edge-subtle` per-row. The system uses `divide-y divide-edge-subtle` on `<tbody>`. |
| **63–68, 148** | `STATE_CLASS` renders status as **bare coloured text** (`text-success-600` / `text-warning-600` / `text-danger-600`) instead of a badge. Every other status in the app is `[BADGE_BASE, toneClass(...)]`. A status column that is just tinted words does not read as a status. |
| **120** | Loading is `<p class="mt-3 text-sm text-ink-muted">Loading…</p>` instead of the `TableSkeleton` that `DataTable` gives free. The panel visibly jumps height on load. |
| **—** | **There is no error state at all.** `useCertificationsQuery` / `useQualificationRecordsQuery` / `useDocumentsQuery` expose `isError`/`refetch` and none is used. A failed fetch renders as a silently empty checklist — for a *compliance* file. `DataTable` would have given `ErrorState` + Retry free. |
| **173–179 + 82–92** | Raw `<input type="file" class="hidden">` driven by a synthetic `.click()`. `FileDropzone` is the sanctioned uploader (`components/ui/FileDropzone.vue`, with `accept`, `busy`, `busyLabel`, drag-and-drop and keyboard support). This hidden-input trick is unreachable by keyboard except through the "Attach" button and gives no drop target. |
| **127–130** | The summary line `"3 on file · 1 due soon · 0 expired · 2 missing"` is a bare `<p>`. Everywhere else in the app a set of counts is either badges or the FilterBar `count`. |
| **113 + 114** | `<div class="space-y-6">` wrapping a single `<div>` child — dead wrapper. |

### 8.2 `pages/CompliancePage.vue` (332 ln)

The script half is exemplary (`FilterBar` with chips + `#more`, `toggleSort`/`sortRows`, `PAGE_SIZE`, page-reset watch). The template forks the visual language.

| Line(s) | Violation |
|---|---|
| **99–103, 281–284** | **`QUAL_BADGE` is a hand-rolled badge map.** `bg-success-100 text-success-700` / `bg-danger-100 text-danger-700` / `bg-surface-muted text-ink-muted`, rendered with `class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"`. Three violations: (a) `rounded-full` where `BADGE_BASE` is `rounded-md`; (b) the `-100/-700` pair where the system is `-50/-700 + ring-{tone}-600/20`; (c) no ring at all. And it sits in the **same row** as a `<StatusBadge>` (line 279), so one table row shows two different badge shapes side by side. Fix: `toneClass('success'|'danger'|'neutral')` + `BADGE_BASE`. |
| **290–293** | `+N more` counter is another hand-rolled pill: `shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-muted`. That is `toneClass('neutral')` re-typed badly, again `rounded-full`. |
| **289** | `max-w-[30rem]` arbitrary width **inside a cell slot**. The contract puts widths in `headerClass` (`min-w-[20rem]` is already on line 225, so this fights its own column). |
| **198–228** | Every column passes `align: "left"`. Only 4 files in the repo do this; the other ~20 table pages let DataTable centre. Compliance's grid therefore does not match Drivers/Trailers/Loads/Fuel log. Remove all four `align` keys. |
| **267** | `dense` on a 4-column driver roster. `DriversPage`, `TrailersPage`, `VehiclesPage` — the peer roster pages — are not dense. `dense` is documented as "text-xs density for audit/sub tables" (`DataTable.vue:66`). A §391.51 roster is a primary table. |
| **312–330** | **Both `SlideOver`s have no `#footer` and default `size="md"`.** They host `CertManager` — a full record-creation form with 7 fields and a submit. Compare `DriverAccessModal.vue:252,453` (`size="lg"` + a real footer). The submit button ends up buried mid-scroll inside the body. |
| **320–324** | The drawer body composes `DqFilePanel` (which itself opens with `space-y-6` and an `h3`) then `<div class="border-t border-edge pt-5">` then `CertManager` (which *also* opens with `space-y-6` and contains its own `border-t border-edge pt-5` at line 91). Result: two nested `space-y-6` stacks and two dividers of different origin in one drawer. The sections should be siblings in one `space-y-6`, with the divider owned by exactly one level. |
| **277** | `<button class="font-medium text-brand-600 hover:text-brand-500">` — correct classes, but no `type="button"`. Every other in-cell button in the repo sets it (`DispatchLoadsPage.vue:395`). |

### 8.3 `features/hazmat/CertManager.vue` (124 ln)

| Line(s) | Violation |
|---|---|
| **76–88** | **Second hand-rolled `<table>`.** Same header string as DqFilePanel (`text-left text-xs uppercase tracking-wide text-ink-subtle`), same `py-1 pr-3` / `py-1.5 pr-3` padding, same per-row `border-t`. Line 78 crams all four `<th>` onto one physical line. Use `DataTable` with `:sticky-header="false"`. |
| **60–67, 85** | `statusOf()` returns bare text colours (`text-danger-600`, `text-warning-600`, `text-success-600`, `text-ink-muted`) — a status column rendered as tinted words instead of `BADGE_BASE + toneClass`. Identical mistake to DqFilePanel, duplicated. |
| **74** | `<p v-if="isLoading" class="mt-2 text-sm text-ink-muted">Loading…</p>` — no skeleton. |
| **75** | `<p v-else-if="!certs || certs.length === 0" class="mt-2 text-sm text-ink-muted">No records on file yet.</p>` — an empty state at `mt-2` left-aligned, where the system's is `px-6 py-10 text-center`. |
| **—** | **No error state.** `useCertificationsQuery` returns `isError`/`refetch`; neither is destructured. Fetch failure renders as "No records on file yet." — i.e. it silently claims a driver has no CDL. |
| **114–116** | `<label class="flex items-center gap-2 text-sm text-ink"><BaseCheckbox v-model="…" /> I certify …</label>` — **a `<label>` wrapping `BaseCheckbox`, which is itself a `<label>`.** Nested labels are invalid HTML and break click-to-toggle. `BaseCheckbox`'s default slot *is* the label: `<BaseCheckbox v-model="form.trainingCertified">I certify this training record is complete (§172.704(d)).</BaseCheckbox>`. Also re-declares `text-sm` and uses `text-ink` where the component's own label tone is `text-ink-secondary`. |
| **117–120** | Submit is `<BaseButton variant="primary" size="sm">` inline in the body, with `saveError` rendered as a sibling `<p class="text-sm text-danger-600">`. Every other form in the app either puts `md`-size actions in the `SlideOver #footer` or uses `toast.error`. This component uses a *third* mechanism (local `saveError` ref) that no other file uses. |
| **91** | `<div class="border-t border-edge pt-5">` duplicates the divider `CompliancePage.vue:322` already wrapped it in. |
| **26, 33, 37, 56, 78** | Multiple statements per line / one-line function bodies throughout — inconsistent with every other `.vue` in `features/`. |

### 8.4 `features/roster/*` — mostly good, with specific breaks

`DriverAccessModal.vue`, `DriverAccessSummary.vue`, `DriverAccountAccessControl.vue` and `DriverCredentialHandoff.vue` are the **best-built drawer code in the repo**: `BaseCard`, `FormField`, `BaseInput`, `BaseButton`, `BADGE_BASE + toneClass`, `#footer` actions, `aria-labelledby`, `aria-live`, real busy labels. Copy their structure. The concrete breaks:

| File:line | Violation |
|---|---|
| `DriverAccessModal.vue:263` | `min-h-[26rem]` — arbitrary magic height to fake vertical centring. Use `flex-1` inside the drawer body, or nothing. |
| `DriverAccessModal.vue:418` | `<div class="mt-3 rounded-lg border border-danger-200 bg-danger-50 p-4">` — a hand-rolled card using **`border`** where the system's soft tint panel is `ring-1 ring-inset ring-danger-200` (cf. `DispatchLoadDetailPage.vue:336`, `DriverCredentialHandoff.vue:156`). Two of the app's three danger panels use `ring`; this one uses `border`. |
| `DriverAccessModal.vue:276, 427, 375` + `DriverAccessSummary.vue:51` + `DriverAccountAccessControl.vue:112` + `DriverCredentialHandoff.vue:165,233` | `leading-6` / `leading-5` hand-set on body copy. 8 of the app's 12 total `leading-*` usages are in these four files. Nothing else in the codebase overrides line-height. Delete them. |
| `DriverAccessModal.vue:342, 400` | `<BaseButton class="absolute inset-y-0 right-1 my-auto px-2">` — overriding the button's own padding to jam it inside an input. If a control needs an in-field adornment, it belongs in the input primitive (as `SearchInput`'s clear ✕ and `ComboSelect`'s chevron do), not as a positioned BaseButton. |
| `DriverAccessSummary.vue:17-32`, `DriverAccountAccessControl.vue:94-107` | The tinted "icon tile" (`flex size-10 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-700`) is re-declared with a ternary in each file, at two different sizes (`size-10` vs `size-9`). The same pattern also exists at `HazmatPage.vue:60` and `HazmatEquipmentPage.vue:123` (both `bg-brand-50 text-brand-700`). Four call sites, three variants, no component. This should be a primitive. |
| `DriverCredentialHandoff.vue:225` | `<div class="flex gap-3 rounded-lg bg-surface-subtle p-4 ring-1 ring-inset ring-edge">` — a re-implementation of `BaseCard` with a `surface-subtle` fill. |
| `DriverAccessSummary.vue:38-49` | The badge is correct (`BADGE_BASE + toneClass`) but the tone is chosen by a **nested ternary inside the template's `:class` array**. Every other file computes this in `<script>`. |

### 8.5 Adjacent files that leak the same anti-patterns (fix while you're there)

| File:line | Violation |
|---|---|
| `pages/DriversPage.vue:28-37, 71-76, 265-289` | **Two hand-rolled badge maps** — `HOS_BADGE` (`bg-info-100 text-info-700`, `bg-warning-100 text-warning-700`, …) and `ACCESS_BADGE` (`bg-success-100 text-success-700`, …), rendered with `rounded` (line 269) and `rounded-full` (line 284) respectively. Three badge shapes in one table row alongside `<StatusBadge>` on line 291. All three should be `BADGE_BASE + toneClass`. |
| `pages/DriversPage.vue:342, 373` | **`divide-border`, `border border-border` — these tokens do not exist.** There is no `--color-border` in `style.css` (the token is `edge`). These classes compile to nothing, so the list at 342 and the `<select>` at 373 render with **no border at all**. The linter can't see it because "border" isn't a banned hue. |
| `pages/DriversPage.vue:371-379` | A raw `<select class="rounded border border-border bg-surface px-2 py-1 text-xs">` inside a drawer. `AppSelect` / `ComboSelect` exist. |
| `pages/AssignmentsPage.vue:118`, `pages/FuelReconciliationPage.vue:222`, `pages/DriverAppSettingsPage.vue:451` | More `rounded-full px-2(.5) py-0.5 text-xs font-medium` hand-rolled badges. |
| `features/hazmat/ReviewPanel.vue:161`, `features/anomalies/AnomalyDetail.vue:297`, `features/settings/EfsClientCertCard.vue:232,242,259` | The full `BaseInput`/textarea class string copy-pasted inline (including `focus:ring-brand-500` at 232/242/259 — the system's focus ring is `brand-600`). |
| `docs/DESIGN-SYSTEM.md` §2, §3 | Stale: lists `TableToolbar` and `SortableTh` (deleted), says DataTable is "text left; `numeric` right" (it centres by default and `numeric` does not right-align), and says FilterBar search is `w-72` (it is `w-full lg:w-64`). `DataTable.vue:29-31` carries the same stale alignment claim. Fix the docs *and* the docblock, or the next engineer will trust them. |

---

## Quick checklist for a new list page

1. Root `<div class="space-y-6">`. Title comes from `route.meta.title` — do not render an `<h1>`.
2. `<PageHeader description="One or two sentences.">` + `#actions` with at most one `variant="primary"`.
3. `<FilterBar v-model:search :count="filtered.length" count-label="<noun>">` — 2–4 `FilterSelect` in `#filters`, secondaries in `#more` with `:more-count` and matching `:chips` + `@remove` + `@clear-all`.
4. `columns: DataTableColumn[]` in `<script>`. **No `align`.** Widths in `headerClass`. Tone in `cellClass` (`font-medium text-ink` for the identity column, `text-ink-secondary` for the rest).
5. `<DataTable :columns :rows="pageRows" row-key="id" :loading :error :retrying :sort :empty-text @sort @retry>` — never hand-roll loading/error/empty.
6. `#actions` → `<KebabMenu v-if="session.canManage">` with `.kebab-item` buttons, destructive last with `.kebab-item-danger`.
7. `#footer` → `<TablePagination :page :page-size="PAGE_SIZE" :total="filtered.length" @update:page>`; `watch` every filter to reset `page` to 1.
8. Badges only via `BADGE_BASE + toneClass` / `StatusBadge`.
9. Drawer via `<SlideOver>`; actions in `#footer`; body sections `space-y-6` with `h3.text-sm.font-semibold.text-ink`.
10. Mutations: `try { await mutateAsync(); toast.success("Thing updated"); } catch (e) { toast.error("Could not save thing", e instanceof Error ? e.message : undefined); }`
11. Run `pnpm --filter web lint:tokens` — but remember it only catches colour. The structural rules above are on you.
