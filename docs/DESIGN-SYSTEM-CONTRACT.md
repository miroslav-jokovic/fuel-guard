# FuelGuard Design Contract

> ⚠ **Reconciled again 2026-08-23** against phases 0–5 of `docs/plans/design-system/DESIGN-SYSTEM-2026.md`.
> The identity is blue + warm soft purple + soft grey (gold is retired), dark mode ships on `light-dark()`,
> and the token values live in DTCG JSON rather than in hand-written CSS. Sections below that predate that
> work describe the gold system; the plan document is the record of what moved. Where this file and a gate
> script disagree, the script is right — that has been true twice now.

Derived from the code. Everything below is measured from real files, not from `docs/DESIGN-SYSTEM.md` (which is partly stale — noted where it diverges).

**Reconciled with the gates 2026-08-20 (recruiting plan R0b).** The primitives had moved into
`@silvicom/ui` and the gates had grown rules this document predated — a session reading only this
file wrote code `lint:ui-adoption` and `lint:tokens` rejected. The gates are the law; when this
document and a gate script disagree, the script has moved again and this file needs another pass.
The two scripts to read: `scripts/ui-system-inventory.mjs` (structure: PageHeader required, zero
raw `<button>/<input>/<select>/<table>` in `pages/` + `features/`, no local primitive clones, no
`text-ink-subtle`) and `apps/web/scripts/check-design-tokens.mjs` (colour: raw palette hues, hex,
inline colour styles, `*-neutral-*` edges, generic `shadow-sm/md/lg/xl/2xl`, and any `bg-*`/`text-*`
role not defined in `packages/ui/src/tokens.css`).

---

## 0. Ground truth files

| Thing | Path |
|---|---|
| Token VALUES (single source) | `packages/tokens/src/{primitives,roles}.{light,dark}.json` — DTCG-shaped |
| Token CSS (generated — never edit) | `packages/ui/src/tokens.generated.css`, via `pnpm gen:tokens` |
| App-level `@font-face` + `@layer components` | `apps/web/src/style.css` |
| Token linter | `apps/web/scripts/check-design-tokens.mjs` (`pnpm --filter web lint:tokens`) |
| Structure linter | `scripts/ui-system-inventory.mjs` (`pnpm lint:ui-adoption`) |
| Badge vocabulary | `apps/web/src/lib/badges.ts` |
| Sort helper | `packages/ui/src/lists/sort.ts` (`sortRows`, `toggleSort` from `@silvicom/ui`) |
| Page shell | `apps/web/src/layouts/AppShell.vue` |
| What changed and why | `docs/plans/design-system/DESIGN-SYSTEM-2026.md` (D-DS1…D-DS16) |

There is **no `tailwind.config.js`** for web or admin. This is Tailwind v4; theme extension happens in the `@theme inline` block of `tokens.generated.css`, which is DERIVED from each token's `silvicom.expose` extension — a role cannot arrive without its utility. (`apps/driver` is the exception: Tailwind v3 + nativewind, its own `tailwind.config.js`, its own values by D-DS3.)

⚠ **That last sentence is no longer true, and the change is the point of §0b.** The linter caught colour only when this was written. It now also fails on radius, elevation, text size, stacking tier and column width (D-DS7a, D-DS6, D-DS4a, D-DS5), so deviations that were once invisible are build failures.

---

## 1. Component inventory

### 1.1 The primitives live in `@silvicom/ui` — `packages/ui/src/components/`

**Moved 2026-08 and enforced by `lint:ui-adoption`:** the form/surface primitives were consolidated
into the shared package so `apps/web`, `apps/admin` and future apps share one look. A local clone in
`apps/web/src/components/ui/` (`BaseButton.vue`, `BaseCard.vue`, `BaseInput.vue`,
`BaseCheckbox.vue`, `BaseSwitch.vue`, `ComboSelect.vue`, `FormField.vue`, `SearchInput.vue`) now
**fails the build**. Import from the barrel; the established idiom keeps the old local names:

```ts
import { AppCard as BaseCard, AppButton as BaseButton, AppDateField } from "@silvicom/ui";
```

The barrel (`packages/ui/src/index.ts`) exports: `AppButton`, `AppInput` (alias `AppTextField`),
`AppCard` (alias `AppSurface`), `AppIcon`, `AppCheckbox`, `AppTextarea`, `AppSelect`, `AppSwitch`,
`AppTable`, `AppPageHeader`, `AppIconButton`, `AppNumberField`, **`AppRadioGroup`**,
`AppSearchField`, `AppDateField`, `AppDateTimeField`, `AppDateRangePicker`, `AppInputGroup`,
`AppFormField`, `AppCombobox`, `AppBadge`. Old-name mapping: `BaseCard→AppCard`,
`BaseButton→AppButton`, `BaseInput→AppInput`, `BaseCheckbox→AppCheckbox`, `BaseSwitch→AppSwitch`,
`FormField→AppFormField`, `ComboSelect→AppCombobox`, `SearchInput→AppSearchField`.

`AppTable` is the ADMIN console's table. In the web app every table is `DataTable` — a small one
inside a drawer or panel is `DataTable embedded dense` — and `lint:ui-adoption` refuses `AppTable`
there, save the published privacy policy (D-US4, `docs/plans/design-system/UI-STANDARDIZATION.md`).

Anatomy is the source file, not this table — the load-bearing token facts as of 2026-08-20:
buttons are `rounded-control`; cards are `rounded-surface bg-surface shadow-card ring-1
ring-edge-subtle` (variants `bordered`/`raised`, paddings `none|sm|md`); shadows come only from the
named elevations (`shadow-card`, `shadow-card-raised`, `shadow-overlay`, `shadow-dialog`); radii
only from the shape roles (`rounded-detail|control|surface|overlay|dialog`). Generic `shadow-sm/md/
lg/xl/2xl` and unknown colour roles fail `lint:tokens`.

### 1.1b The composites — `@silvicom/ui` (the list kit) and `apps/web/src/components/ui/` (web-only)

Since US7 (D-US11, 2026-10-15) the list and read-state composites live in `@silvicom/ui`, and both the
web app and the admin console import them from there: `DataWorkspace`, `FilterBar`, `DataTable`,
`TablePagination`, `BulkActionBar`, `StatCard`, `QueryState` (with `ErrorState`, `ErrorPanel`,
`TableSkeleton`, `NotFoundState`), `FactList`, `BaseModal`, `ConfirmHost` / `useConfirm`, and the helpers
they stand on (`useQueryState`, `useUrlSort`, `sortRows`, `NotFoundError` / `recordOrThrow` /
`QUERY_DEFAULTS`, `countLabelFor`). Rows below marked **(`@silvicom/ui`)** are those; the rest are
web-only. A shared piece that offers a route asks the app whether it opens (`provideRouteOpens`; the web
provides `useOpens` in `App.vue`). The test helper `answerConfirm` is `@silvicom/ui/testing`.

| Component | Props (defaults) | Slots / events | What it is FOR |
|---|---|---|---|
| **`PageHeader.vue`** | `title?: string`, `description?: string` | default (overrides description), `#freshness`, `#actions` | The **first row of every page**. It owns the page `<h1>`: `title` overrides `route.meta.title`, with `"Silvicom 360"` only as a final fallback. Below it are the breadcrumb, optional muted description/freshness, and right-aligned actions. |
| **`DataWorkspace.vue`** (`@silvicom/ui`) | `as?` | default | The **list-page shell** (see §5.2b): one `AppCard padding="none"` with `divide-y divide-edge-subtle`, holding an `embedded` FilterBar row above an `embedded` DataTable. |
| **`BulkActionBar.vue`** (`@silvicom/ui`) | `count: number` | default (actions), `#note`; emits `clear` | The **"N selected" strip** between FilterBar and DataTable once rows are ticked. Renders nothing at zero. See §5 list-page rules. |
| **`StatCard.vue`** (`@silvicom/ui`) | `label`, `value`, `sub?`, `subTone?`, `valueTone?`, `unit?`, `muted?`, `embedded?`, `size?` ("kpi"\|"hero"), `icon?`, `tone?`, `delta?`, `spark?`, `to?`, `pressed?`, `loading?`, `error?`, `retrying?` | default (extra caption lines), `#sub`, `#delta`; emits `toggle`, `retry` | The **one KPI tile**. See §4 KPI rows and the list-page rules. A tile over a read binds `:loading` AND `:error` (the page's sentence): failed, it draws a dash, the sentence and a Retry, and is neither link nor toggle. `lint:ui-adoption` refuses a `:loading` with no `:error`, and a `:value` falling back to `?? 0`, unless the site says `ui-adoption: stat-guarded — <why>` (US6b F1). |
| **`SettingsSection.vue`** | see source | — | Settings-page section wrapper. |
| **`FilterSelect.vue`** (156 ln) | `modelValue: string`, `options`, `label: string`, `disabled?`, `block?` | — | The **toolbar** filter. Trigger reads `"Risk ▾"` idle / `"Risk: Review ✕"` active with a brand tint (`bg-brand-50/60 text-brand-800 ring-brand-600/30`). `""` option = "no filter". Auto-adds an inline search box when `options.length > 8`. `block` = full width, for use inside the FilterBar `#more` popover. An option's optional `count` (a preformatted string, e.g. `"15 · 6 empty"`) is drawn in its own right-hand column that never truncates, and stays out of the trigger and the search — never put a figure inside `label` (the Dispatcher filter did, 2026-10-19, and long names hid it). |
| **`FilterBar.vue`** (`@silvicom/ui`) | `search?`, `searchPlaceholder?` ("Search…"), `count?: number\|null`, `countLabel?` ("results"), `chips?: FilterChip[]`, `moreCount?: number`, `activeCount?: number` | `#filters`, `#more`, `#actions`; emits `update:search`, `remove(key)`, `clear-all` | The **one table toolbar**, and the one owner of "Clear filters". Full API in §5. |
| **`DataTable.vue`** (`@silvicom/ui`) | see §5.2 | see §5.2 | The **one data table**. |
| **`FileDropzone.vue`** (123 ln) | `accept?`, `multiple?`, `disabled?`, `label?` ("Drag & drop files here"), `hint?`, `busy?`, `busyLabel?` ("Reading…") | emits `files: File[]` | The **only sanctioned uploader**. Drag/drop + click/Enter/Space to browse. Parent owns parsing. |
| **`BaseModal.vue`** (`@silvicom/ui`) | `open`, `title`, `description?`, `size?: "md"\|"lg"\|"xl"` (md; `xl` = `max-w-4xl`), `printable?` | default, `#footer`; emits `close` | The **one CENTRED dialog** (added DQF plan B5). The boundary vs `SlideOver`: a drawer keeps the list visible beside a form; a modal takes the middle of the screen for content that needs WIDTH (a scanned card at 28rem is not legible). Same scrim/transitions/header anatomy as SlideOver §6.1; `max-h-[90vh]`, body scrolls. `printable` applies `.print-target`, which the `@media print` rules in `style.css` key on. Never build a bespoke overlay in a feature folder. |

### 1.2 `apps/web/src/components/` — shared, already tokenized

| Component | Props | For |
|---|---|---|
| **`SlideOver.vue`** (97) | `open: boolean`, `title: string`, `description?`, `size?: "md"\|"lg"` (md) | The one drawer. `md`→`max-w-md`, `lg`→`max-w-lg`. Structure in §6. |
| **`KebabMenu.vue`** (80) | `block?`, `placement?: Placement` (bottom-end), `triggerLabel?`, `tone?: "default"\|"sidebar"` | The one dropdown menu. Default trigger is `⋮`; `#trigger` slot for toolbar dropdowns. Children must be `<BaseButton class="kebab-item">` (**not** a raw element — see §5.6's correction; a raw one is a red `lint:ui-adoption` gate). Panel: `z-[9999] w-48 origin-top-right py-1 rounded-control bg-surface shadow-overlay ring-1 ring-edge`, teleported to body with a `z-[9998]` click-catcher. |
| **`StatusBadge.vue`** (25) | `status: string` | Maps `active/resolved`→success, `maintenance/investigating`→warning, `open`→brand, else neutral, and renders `[BADGE_BASE, cls]`. |
| **`TablePagination.vue`** (`@silvicom/ui`) | `page`, `pageSize?` (20), `total`, `loading?`; emits `update:page` · or `log` (`{ span, hasNewer, hasOlder }`); emits `newest` / `newer` / `older` | The table `#footer`. `flex items-center justify-between border-t border-edge-subtle px-4 py-3 sm:px-6`. Left: `Showing <b>1</b>–<b>20</b> of <b>1,204</b>` / `No results`. Right: "Page [n] of N" jump input (hidden below `sm`, only when `totalPages > 1`) + Prev/Next `BaseButton size="sm"`. **`log` mode** is a time-ordered log addressed by its cursor in the URL (D-US12, the Audit log): left is the span of time the rows cover, never a page number or a row count; right is Newest (only when there is a newer side) + Newer/Older. |
| **`TableSkeleton.vue`** (`@silvicom/ui`) | `rows?` (6), `cols?` (5) | Shimmer rows. Only DataTable calls it; you should not. |
| **`ErrorState.vue`** (`@silvicom/ui`) | `message?` ("Something went wrong while loading this data."), `retrying?`; emits `retry` | Warning icon + message + Retry button (`Retrying…` while busy). Only DataTable calls it directly; use it standalone for non-table fetch failures. |
| **`QueryState.vue`** (`@silvicom/ui`) | `loading`, `error?`, `errorText?`, `retrying?`, `loadingText?` ("Loading…"), `compact?`, `notFoundText?`; emits `retry`; default slot = content | Loading → failure WITH retry → content, for anything that fetches and is not a table (D-US5). `compact` = one line, for a panel or a drawer. An `error` that is a `NotFoundError` (`lib/notFound.ts`; a record read throws it through `recordOrThrow`) draws `NotFoundState` instead — the `not-found-text`, no Retry, and "Back to <list>" from the route's `meta.parent` (D-US10). `lint:ui-adoption` refuses a hand-written "Loading…" line, a `QueryState` with an `:error` and no `error-text` (D-US9), and a routed record page (a path with a parameter) whose `QueryState` has no `not-found-text`, unless the page says `ui-adoption: not-a-record — <why>`. |
| *(search box)* | — | `AppSearchField` from `@silvicom/ui` (the local `SearchInput.vue` clone is gate-banned). FilterBar owns it; use directly only outside a table. |
| *(form select)* | — | `AppSelect` from `@silvicom/ui`. Non-searchable form select; trigger matches the input metrics, panel matches the KebabMenu recipe. |
| **`DateRangeFilter.vue`** (105) | `from?`, `to?`, `presets?` (true), `label?` ("Dates"), `maxDate?` (today) | Toolbar date range on VueDatePicker. Trigger is byte-identical to FilterSelect's trigger classes. Values are `YYYY-MM-DD`; pass `maxDate=null` for future-facing ranges such as DQ deadlines. `partialRange` MUST stay false. **v14 regrouped its props** — `time-config`, not `enable-time-picker`; an unknown one is silently accepted as an HTML attribute (D-DS17). |
| *(single date / date-time)* | — | `AppDateField` / `AppDateTimeField` from `@silvicom/ui`. **Also VueDatePicker since 2026-08-31 (D-DS17)** — they were `<input type="date">` and `type="datetime-local"` until then, which is why the calendar used to look like the browser rather than the product. Wire values are unchanged (`YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`); display is `MM/dd/yyyy`. Both are one internal `DatePickerBase.vue` — do not add a third. In a test, drive them by emitting `update:modelValue`, not by typing into `input[type="date"]`, and remember the display value formats a tick AFTER mount. |
| **`VehicleSelect.vue`** (204) | `modelValue`, `vehicles: Vehicle[]`, `placeholder?` ("All vehicles"), `disabled?` | Legacy typeahead for vehicles. New code should use `FilterSelect`/`ComboSelect`. |
| **`DocumentPreview.vue`** (121) | `open`, `label`, `doc: DocumentRow \| null`; emits `close` | The **sanctioned document viewer** (DQF plan B6) — the only place a compliance scan renders full-size. In `BaseModal size="xl" printable`. Images show the `normalized` variant (original only via the server-signed Download); PDFs get the browser's viewer in an iframe and **no Print button** (D-DQ9). Do not build a second viewer. |
| **`ToastContainer.vue`** (126) | — | Renders `useToastStore()`. Card: `rounded-surface border-l-4 shadow-overlay ring-1 ring-edge-subtle`, title `text-sm font-semibold text-ink`, message `mt-0.5 text-sm leading-snug text-ink-muted`, progress bar `h-0.5`. |
| **`UpdateBanner.vue`**, **`AppLogo.vue`**, **`BaseChart.vue`**, **`SparkLine.vue`** | — | App-update prompt; logo; ECharts/canvas wrapper; inline sparkline. |

**A page notice is `AppCallout`** — `lint:ui-adoption` refuses a hand-tinted `bg-<tone>-50 … ring-1`
block (D-US3). A load failure is not a notice: it is `QueryState`'s, and it carries a retry.

**Label/value facts are `ui/FactList.vue`** (D-US6): `facts: { label, value, numeric?, tone?, key? }[]`,
`layout` `grid` (default, `columns` 2|3|4) or `rows`, `#value-<key>` for a badge or link. A blank
value is an em dash, as in a table cell. `lint:ui-adoption` refuses a hand-written `<dl>` unless it
says why it is not a fact list (`ui-adoption: not-a-fact-list — <why>`). A drawer's form puts its
submit in the `#footer` with `form="<form id>"` (D-US5b), and the gate refuses one that does not.

**There is no `EmptyState` component and no `Skeleton` component.** Empty state = `DataTable`'s `empty-text` prop / `#empty` slot (`px-6 py-10 text-center text-sm text-ink-muted`). **Every `DataTable` says what its empty means** (2026-10-14, `lint:ui-adoption`): bind `empty-text` or fill `#empty`, never a paragraph in the table's place and never the bare default "No results."; a table that cannot be empty — inside a `v-if` on its own rows, or a fixed reference list — is marked `ui-adoption: never-empty — <why>` where it stands. Skeleton = `TableSkeleton`, invoked only by DataTable. `SortableTh` and `TableToolbar` are referenced by `docs/DESIGN-SYSTEM.md` but **were deleted** (commit `df8a2c2`) — sorting is inside DataTable, the toolbar is FilterBar. Do not resurrect them.

### 1.3 Icons

`@silvicom/ui/icons` exports the curated icon set (a barrel over HugeIcons Stroke Rounded).
`AppIcon`: `<AppIcon :icon="XIcon" class="size-4" aria-hidden="true" />`. Size comes from Tailwind
`size-*` (never the `size` prop), colour from `currentColor` via `text-*`, `strokeWidth` defaults
1.5. **Never import from `@hugeicons/core-free-icons` directly** — add to `packages/ui/src/icons.ts`
first.

> **Superseded 2026-08-20:** this section used to say "always import the `Base*` versions from
> `@/components/ui/`; only `AppIcon` comes from `@silvicom/ui`". That is now exactly backwards —
> see §1.1. The gate fails local clones; the barrel is the home.

---

## 1.4 Dates — one shape, one definition (D-DS18)

**A date is shown as `MM/DD/YYYY`. Everywhere. From one function.**

| Shape | Function | Where |
|---|---|---|
| `09/20/2026` | `formatDisplayDate` | every date shown as a field, a cell or a sentence |
| `09/20/2026 2:03 PM` | `formatDisplayDateTime` | a date that also needs its moment — audit rows, sync stamps |
| `09/20` | `formatDisplayDayShort` | chart axis ticks and dense rows, where the year is already established |
| `09/20/2026 → 09/26/2026` | `formatDisplayDateRange` | a span of days — a week, a filter window, an export's scope; one day prints once (US6b F27) |

All three live in `packages/shared/src/displayDate.ts` and are re-exported in `apps/web` as
`formatDate` / `formatDateTime` from `@/lib/format`, and in `apps/admin` as `fmtDate` / `fmtDateTime`.
`lint:date-format` fails any `toLocale*String` call that formats a date outside eight named carve-outs.

**Why this section exists, and why D-DS17 was not enough.** D-DS17 pinned `MM/dd/yyyy` on 2026-08-31,
but stated it as a property of `DatePickerBase.vue`. So the two pickers obeyed it and nothing else did
— a rule written about a component cannot be checked against a product. By 2026-09-20 there were 13
near-duplicate `fmtDate` definitions, ~30 inline `toLocaleDateString` calls (most passing `undefined`
as the locale, which hands the ordering to the *viewer's* browser: `2026/09/20` on `ja` or `zh`,
`20/09/2026` on `en-GB`), and raw ISO on screen in a dozen places — including `packetDraw.ts`, which
printed `2026-09-20` into every date box of the 22-page federal DOT application packet.

**A date is a calendar day, not a moment.** `formatDisplayDate` reads the leading `YYYY-MM-DD`
characters and ignores any time part, so no timezone is ever consulted. This is not a detail:
`new Date("2026-09-20").toLocaleDateString(...)` parses UTC midnight and renders it *locally*, printing
**Sep 19** in every US timezone, and four of the 13 deleted copies shipped with exactly that bug.
Rendering a `timestamptz` in the reader's own zone is a **semantic** change to what a date means here,
not a formatting one, and needs its own decision.

**What is deliberately not a date:** a month heading (`July 2026`), a time of day, a weekday, and a
clock pinned to somebody else's timezone (a fuel station's local time, F-H2). Each is a carve-out in
`scripts/check-date-format.mjs` naming the question it answers.

**Known blind spot, stated rather than left to be found:** raw ISO reaching a template —
`{{ row.expires_at }}` — is invisible to the gate, which would have to know that `expires_at` holds a
date, and a name is not a type. Eleven such sites were fixed by hand on 2026-09-20; a twelfth would
pass CI. If you interpolate a column straight into a template, that is on you. (It did: on 2026-10-14 US6b found
six raw `${from} → ${to}` ranges on screen, which is why a range is now a function.)

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

`font-bold` is reserved for **KPI numbers** (`text-2xl font-bold`). Headings are `font-semibold`. Emphasis inside body text is `font-medium`. `font-normal` only ever appears as a unit-suffix inside a bold KPI (e.g. `text-base font-normal text-ink-tertiary` after `$12,431`).

### 2.4 The prescriptive type table

| Role | Exact classes | Where it lives |
|---|---|---|
| Page title | `text-base font-semibold text-ink` | `AppShell.vue:333` — **you never write this.** Set `route.meta.title`. |
| Page description | `text-sm text-ink-muted` | `PageHeader.vue:12` |
| Section heading (page level, h2) | `text-lg font-semibold text-ink` | A section of the page, outside any card — `DashboardPage.vue`, `SettingsUsersPage.vue`. **One of only two heading sizes** (owner ruling 2026-10-12; `lint:ui-adoption` fails any other on an h2/h3, eyebrows aside). |
| Card, panel or drawer title (h2/h3) | `text-sm font-semibold text-ink` | Any heading inside a card, drawer or panel — the other of the two sizes. Until 2026-10-12 this table gave settings cards `text-base` while §5 said `text-sm` "**not** `text-base`"; 155 headings already used `text-sm` against 22 at `text-base`, and the 22 moved. |
| Eyebrow / group label | `text-xs font-semibold uppercase tracking-wider text-ink-muted` | `HazmatPage.vue:53` |
| Drawer title | `text-base font-semibold text-ink` | `SlideOver.vue:63` |
| Drawer description | `mt-1 text-sm text-ink-muted` | `SlideOver.vue:66` |
| Table header cell | `font-medium` on `thead.bg-surface-subtle.text-ink-muted` → renders `text-sm font-medium text-ink-muted` (`text-xs` when `dense`) | `DataTable.vue:163,182` |
| Table body cell | inherits `text-sm` (`text-xs` when `dense`); tone via `cellClass` | `DataTable.vue:161` |
| Table primary cell (name/id) | `cellClass: "font-medium text-ink"` | `DriversPage.vue:145`, `TrailersPage.vue:80` |
| Table secondary cell | `cellClass: "text-ink-secondary"` | everywhere |
| In-cell link | `font-medium text-brand-600 hover:text-brand-500` | `DispatchLoadsPage.vue:395`, `CompliancePage.vue:277` |
| Empty cell | `<span class="text-ink-tertiary">—</span>` (automatic) | `DataTable.vue` |
| Form label | `block text-sm font-medium text-ink-secondary` | `FormField.vue:23` |
| Form hint | `mt-1 text-xs text-ink-muted` | `FormField.vue:30` |
| Form error | `mt-1 text-sm text-danger-600` | `FormField.vue:29` |
| Empty state | `px-6 py-10 text-center text-sm text-ink-muted` | `DataTable.vue:154` |
| Error state | `text-sm text-ink-secondary`, `max-w-md`, centered | `ErrorState.vue:18` |
| KPI label | `text-xs font-medium tracking-wide text-ink-muted uppercase` | `StatCard.vue` |
| KPI value | `mt-1 text-2xl font-bold text-ink` — drawn by **`StatCard`**, never by hand (`lint:ui-adoption` fails a `<dd>` at `text-2xl`/`text-3xl`) | `StatCard.vue` |
| KPI sub-caption | `mt-0.5 text-xs text-ink-tertiary` | `StatCard.vue` |
| Result count | `whitespace-nowrap text-sm text-ink-muted` | `FilterBar.vue:122` |
| Badge | `BADGE_BASE` → `inline-flex items-center gap-1 rounded-detail px-2 py-0.5 text-xs font-medium` — **no case transform**; labels own their sentence-case casing (see §4.3) | `lib/badges.ts` |

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
- Narrow pages add `mx-auto max-w-3xl` (content: a document, a public page). **Settings pages never do** (US6b F28, 2026-10-14): every page in `router/routes/settings.ts` is the full-width root, so the breadcrumb and title sit where every other page puts them. Until then eight settings forms were a centred `max-w-2xl|3xl|5xl` column beside six full-width settings lists, and the header moved 136 px sideways between two entries of one menu. A form keeps its fields readable with its own grid (Planned Fueling, Thresholds), not by narrowing the page. `lint:ui-adoption` refuses a settings page whose root carries `mx-auto` or a `max-w-*`.
- Two-column detail layouts: `grid grid-cols-1 gap-6 lg:grid-cols-[…]` (`HazmatEquipmentPage.vue:120`).
- A figure is an answer: a tile whose read has not answered is a skeleton, one whose read failed is a dash with the failure and its Retry (`:error`), and a share of nothing (a zero denominator) is a dash with the reason in the caption, never a red "0%" or a green "100%" (US6b F14). Likewise a toolbar's count and a tab's badge are printed only once their list has answered — `DataWorkspace` holds its table's state for its `FilterBar` (F15).
- KPI tiles are **`StatCard`**, in a grid `grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4`. The figure's verdict colour is `value-tone` (a class — only the caller knows whether high is good; money takes none, Q-FSV15 ruling 2), a unit after it is `unit`, further caption lines go in the default slot. Tiles that share ONE surface — the divided strip `div.grid grid-cols-2 divide-y divide-edge-subtle sm:grid-cols-3 sm:divide-y-0 sm:divide-x lg:grid-cols-6` inside a `BaseCard padding="none"` (`FillsTab.vue`), or the stat row inside a report card — are `StatCard embedded`, with the caller giving each cell its padding (`px-5 py-4`). Until 2026-10-12 thirty-three tiles in seven files, plus a `FuelStatTile` copy, were drawn by hand: bold beside semibold, three label styles, three ways of tinting a verdict.
- Bulk-action bar: **`<BulkActionBar :count="selected.size" @clear="selected = new Set()">`** between FilterBar and DataTable, inside the `DataWorkspace`. It renders nothing at zero, so wrap it only in a permission `v-if`, never a count one. Actions in the default slot as `size="sm"` buttons, destructive last as `variant="danger"`; a sentence about the selection goes in `#note`; the component draws the ground (`bg-brand-50`, no ring or radius — it is a row of the workspace, not a card), the "N selected" count and the closing Clear (which empties the selection, not the filters). Until 2026-10-12 seven pages drew this strip by hand in six ways; `lint:ui-adoption` now fails a template that writes "{{ … }} selected" itself.
- Tab strip: `AppTabs` from `@silvicom/ui` (U4, D-UI4), which owns the roles, the roving tabindex and the look. A horizontal strip always scrolls rather than squeezing its tabs (the opt-in `scrollable` went in US6b, 2026-10-13: a strip without it broke every label onto three lines at 390 px, and Fleet report's six tabs widened the page by 129 px).

### 3.4 The standard card
`<BaseCard>` (= `AppCard`) = `p-5`. `padding="sm"` = `p-4` (FilterBar). `padding="none"` =
table/list host. Never hand-write the card recipe (`rounded-surface bg-surface shadow-card ring-1
ring-edge-subtle`) — and note `shadow-sm` no longer exists here: generic elevations fail
`lint:tokens`; the named ones are `shadow-card`, `shadow-card-raised`, `shadow-overlay`,
`shadow-dialog`.

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
- Radius comes from the shape roles in `tokens.css`, not raw steps: `rounded-detail` (badges,
  chips), `rounded-control` (buttons, inputs, checkboxes), `rounded-surface` (cards, panels,
  tint notes), `rounded-overlay` / `rounded-dialog` (popovers, modals). `rounded-full` **only**
  for the switch knob, avatars and the FilterBar count pill — **not** for badges.

---

## 4. Colour and semantic tokens

### 4.1 What the linter forbids — `apps/web/scripts/check-design-tokens.mjs`

It walks every `.vue|.ts|.css|.html` under `apps/web/src` (skipping `*.test.ts`) and fails the build on **six** rules (three more than this section used to list — updated 2026-08-20):

```
1. raw palette utility      — {bg|text|ring|border|…}-{slate|red|…}-N
2. raw neutral edge utility — {ring|border|divide|outline}-neutral-N  (use semantic edge tokens)
3. generic elevation        — shadow-{sm|md|lg|xl|2xl}               (use shadow-card/overlay/dialog)
4. unknown colour role      — any {bg|text|ring|…}-<suffix> inside a class binding whose suffix is
                              neither a --color-* role read live from packages/ui/src/tokens.css nor
                              a structural word. This is the `border-line` lesson: Tailwind emits
                              nothing for an unknown role, so the misspelling is invisible on screen
                              and to every hue rule.
5. hex color
6. inline color style
```

Allow-list is exactly two files: `style.css` (defines app-level pieces) and `features/dashboard/chartTheme.ts` (jsdom canvas fallbacks). Per-line escape hatch: a trailing `// token-check-disable-line` comment.

**Enforced by `lint:ui-adoption` rather than here:** `text-ink-subtle` is **banned outright**
(deprecated — use `text-ink-tertiary` for de-emphasized values like the blank-cell em-dash, and
`text-ink-disabled` for disabled states), local primitive clones fail, and raw
`<button>/<input>/<select>` and visible `<table>` elements in `pages/` + `features/` are
zero-tolerance with **no exemption list** (the only exemption list that exists is for missing
`PageHeader` on session-free pages).

**Not caught by either gate, but still forbidden by the contract:** `border-*` where `ring-*` is the idiom; `rounded-full` badges; hand-rolled badge/button/card markup.

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
| `ink-tertiary` | `text-ink-tertiary` | de-emphasized values: the em-dash `—`, sub-captions, icons at rest |
| `ink-disabled` | `text-ink-disabled` | disabled control text |
| ~~`ink-subtle`~~ | *(banned)* | The role still exists in `tokens.css` for legacy CSS, but the **utility is banned by `lint:ui-adoption`** — use `ink-tertiary`/`ink-disabled` |
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
  neutral: "bg-surface-subtle text-ink-muted ring-1 ring-inset ring-edge",
} as const;

export const BADGE_BASE =
  "inline-flex items-center gap-1 rounded-detail px-2 py-0.5 text-xs font-medium";

export const toneClass = (key: string): string => SOFT[key as BadgeTone] ?? SOFT.neutral;
```

**Casing (changed 2026-08-20, R0b):** `BADGE_BASE` no longer carries `capitalize` — it title-cased
every word, so sentence-case labels from the label maps rendered wrong ("No response" →
"No Response"). Labels own their casing. A badge that renders a raw machine token adds
`capitalize` at its own call site; each such site marks a vocabulary that has not been given a
label map yet.

Plus domain mappers, all returning `toneClass(...)`: `severityTone` (critical→danger, high→caution, medium→warning, else neutral), `statusTone`, `txnStatusTone` (alert→danger, review→warning, verified→success, else neutral), `inviteTone`, `suspicionTone`.

**Contract:**
1. Every badge is `:class="[BADGE_BASE, toneClass('success')]"` or `:class="[BADGE_BASE, severityTone(row.severity)]"`, or `<StatusBadge :status="…" />`.
2. Badges are `rounded-detail`, `px-2 py-0.5`, `text-xs font-medium`. **Never `rounded-full`.**
3. Fill is always the `-50` tint with a `-600/20` inset ring. **Never the `-100`/`-700` pair.**
4. A new tone means a new entry in `SOFT` — not a local `Record<string, string>` in a page.

---

## 5. Tables, search and filtering — the pattern

### 5.1 The three best examples

1. **`pages/TrailersPage.vue`** (287 ln) — canonical client-side list: search + 2 `FilterSelect`, client sort, client pagination, bulk selection, `KebabMenu`, `SlideOver` form. The cleanest end-to-end reference.
2. **`pages/AssignmentsPage.vue`** + **`pages/DispatchLoadsPage.vue`** — the queue list, one pattern on two pages (rebuilt 2026-10-10 on the owner's ruling): `DataWorkspace` with an embedded `FilterBar`; queues as `AppTabs` with their counts, and a different feed (History, Exceptions) as the LAST tab — never a second strip; the toolbar stays on every tab; every filter, the queue, the sort (`useUrlSort`) and an open drawer in the URL through `useQueryState`; primary filters only, so no chips; one link shape (`AppButton variant="link" :to`); page notices as `AppCallout`. Until that day the Loads page was listed here while carrying the older two-card shape, chips for its primary filters and a boxed button recoloured as a link — and a reference that drifts is copied with its drift.
3. **`pages/FuelLogPage.vue`** (361 ln) — server-side pagination + server-side sort, `DateRangeFilter`, sticky first column, `dense`, `row-class`, `#more` popover with chips, KPI strip.

(`DriversPage.vue` is a good structural example but carries two hand-rolled badge maps — see §8.)

### 5.2 DataTable — exact API

```ts
export interface DataTableColumn {
  key: string;
  label: string;
  sortable?: boolean;
  numeric?: boolean;                       // right-aligns and adds tabular-nums
  align?: "left" | "right" | "center";
  width?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
  headerClass?: string;                    // non-scale overrides only (for example `w-32`)
  cellClass?: string;                      // tone/truncation overrides
}
```

Props (defaults in brackets): `columns`, `rows`, `rowKey` `[**"id"**]` (string or `(row)=>string`), `loading` `[false]`, `error` `[null]`, `retrying` `[false]`, `emptyText` `["No results."]`, `selectable` `[false]`, `selected?: Set<string>`, `sort?: SortState` `[null]`, `dense` `[false]`, `nowrap` `[true]`, `stickyHeader` `[true]`, `rowClass?: (row)=>string`.

Emits: `retry`, `sort(key)`, `update:selected(Set)`, `row-click(row)`.

Slots: `#cell-<key>="{ row, value }"`, `#actions="{ row }"`, `#footer`, `#empty`.

Behaviour it owns, so you don't:

- **Wrapper**: DataTable renders its **own** `BaseCard padding="none"` unless you pass
  `embedded` (then it renders a bare `div` for use inside `DataWorkspace` — §5.2b). Either way:
  **never wrap a DataTable in another card** — an outer `<BaseCard padding="none">` around a
  non-embedded DataTable draws a card inside a card (this shipped twice in recruitment before R0b
  caught it).
- **State precedence** (`:150-157`): `loading` → `<TableSkeleton :cols="…">`; else `error` → `<ErrorState :message :retrying @retry>`; else `rows.length === 0` → `<div class="px-6 py-10 text-center text-sm text-ink-muted">{{ emptyText }}</div>`; else the table + `#footer`. **The footer/pagination does not render in any of the three non-happy states.**
- **Alignment**: text columns left-align by default. `numeric: true` right-aligns and adds
  `tabular-nums`; headers follow the same alignment as their cells. An explicit `align` overrides
  that inference, and `align: "center"` is reserved for control columns such as a checkbox, icon or
  status dot. **Rule: omit `align` for ordinary text and quantities.**
- **Padding** (`:131-140`): `px-4 py-3`, or `px-4 py-2` when `dense`. First column gets `pl-6` (unless `selectable`); last gets `pr-6` (unless there's an actions column).
- **Header**: `bg-surface-subtle text-ink-muted shadow-[inset_0_-1px_0_0_var(--edge)]`, `sticky top-0 z-10` inside a `max-h-[70vh] overflow-y-auto` scroller. Sortable headers are a `<button class="group inline-flex items-center gap-1 hover:text-ink-secondary">` with `ChevronUp`/`ChevronDown`/`ChevronUpDown` at `size-3.5`.
- **Body**: `divide-y divide-edge-subtle`; rows `hover:bg-surface-subtle`; selected rows `bg-brand-50/40`.
- **Blank cells**: `<span class="text-ink-tertiary">—</span>` automatically. Don't write `|| "—"` in a cell slot unless the fallback is a word ("Unassigned", "N/A").
- **Actions column**: `w-12 pl-2 pr-6 text-right`, `@click.stop`, header is `<span class="sr-only">Actions</span>`. Appears only when you provide `#actions`.
- **Selection**: leading `w-10 pl-6 pr-2` checkbox column, header checkbox toggles the current page with indeterminate state. **Only render `selectable` when the page has bulk actions.**
- **Density**: `dense` is `text-xs` + `px-4 py-2`, for audit/sub-tables. Roster/entity tables are not dense.

### 5.2b DataWorkspace — the standard list-page shell (decision, R0b 2026-08-20)

New list pages compose toolbar and table as **one surface**:

```html
<DataWorkspace>
  <FilterBar v-model:search="search" embedded search-placeholder="Search …"
             :count="filtered.length" count-label="<noun>">
    <template #filters>…</template>
  </FilterBar>
  <DataTable :columns :rows="pageRows" embedded …>
    …
    <template #footer><TablePagination … /></template>
  </DataTable>
</DataWorkspace>
```

`DataWorkspace` is one `AppCard padding="none"` with `divide-y divide-edge-subtle`; the `embedded`
props stop FilterBar and DataTable drawing their own cards. `DriversPage.vue` is the reference.
**Every list with a toolbar uses this shell** (D-US1, `docs/plans/design-system/UI-STANDARDIZATION.md`).
Until 2026-10-12 this paragraph called the older shape — a standalone `FilterBar` card above a
standalone `DataTable` card — "valid on existing pages"; by then no list carried it. A lone table
with no toolbar still uses plain `DataTable` (its own card). A REPORT, where one filter bar governs
several panels, keeps its `FilterBar` standalone above them, and a report whose only choice is the
period uses `ReportScopeBar` (D-US1a).

### 5.2c List state lives in the URL (D-US2)

A filtered list keeps its filters, its sort and its page in the URL, so a reload, a link pasted
into a ticket and Back from a row's detail page all return the same list. `lint:ui-adoption` fails a
file with `<FilterBar` that holds them anywhere else.

```ts
const qs = useQueryState();                       // useQueryState("history") when two lists share a route
const search = qs.param("search");
const status = qs.param("status", VEHICLE_STATUSES, "active");   // vocabulary, and the value it opens on
const retired = qs.flag("retired");
const page = qs.page();
watch([search, status, retired], () => (page.value = 1));
const { sort, onSort } = useUrlSort(
  qs.param("sort", columns.filter((c) => c.sortable).map((c) => c.key)),
  qs.param("dir", SORT_DIRECTIONS),
);
const clearFilters = () => qs.set({ search: undefined, status: undefined, retired: undefined }); // keeps the sort
```

- The default a list opens on is never written; choosing "All" over a default writes `any`.
- A value outside the vocabulary reads as the default. Always pass the vocabulary for a closed set,
  and always for a sort key.
- A list inside a drawer that should reset on close opts out with the comment
  `ui-adoption: list-state-local — <why>`. No reason, no exemption.

`pages/TrailersPage.vue` + `pages/trailersListInUrl.test.ts` are the reference conversion.

### 5.3 Sorting

Client-side: the sort comes from `useUrlSort` (§5.2c), then
```ts
const sorted = computed(() => sortRows(filtered.value, sort.value, getVal));
```
`toggleSort` cycles **none → asc → desc → none**. `sortRows` sorts numbers numerically, strings via `localeCompare(…, {numeric:true})`, **nulls last**. Pass a `get` accessor when a column is derived (`DispatchLoadsPage.vue:162-168`).

**A list of records opens newest first by the row's own event time** — the time the row is about (delivered at, occurred at, when it left the pickup), never `created_at` or the server's insertion order, and never "no sort" (DISPATCH-LOADS-COUNTS-PLAN D-DLC4, owner 2026-10-20: "latest → oldest in every table"). A list whose event is still ahead (Upcoming loads, appointments) opens soonest first. The opening order is a `SortState` the page applies when the URL carries no `sort`, so a header click still overrides it (`features/dispatch/loadListOrder.ts` is the reference). A planning board of subjects, not records (the Dispatch board), keeps its own order and says why.

Server-side (`FuelLogPage.vue:39-42`): same `toggleSort`, then push `sortKey`/`sortDir` into the query filters. Never sort in the template.

### 5.4 Pagination

```ts
const PAGE_SIZE = 20;
const page = qs.page();   // §5.2c — page 1 is absent from the URL
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
**Every list with a toolbar pages** (D-US8): a `DataTable` — or a `*Table` component wrapping one —
inside a `DataWorkspace` renders this in its `#footer`, and `lint:ui-adoption` refuses one that does not
unless it is marked `ui-adoption: unpaged — <why>`. A cursor-paged list uses `:total="null"` with
`:has-next` / `:page-rows`; there is no "Load more".

`:total` is the **filtered** count, not the page length. `PAGE_SIZE = 20` unless a server constant says otherwise (`FUEL_PAGE_SIZE`). Extra hardening in `DispatchLoadsPage.vue:212-215`: clamp `page` down when the filtered set shrinks.

### 5.5 FilterBar — exact API and the required layout order

```
<BaseCard padding="sm">
  flex flex-col gap-3 lg:flex-row lg:items-center
    [search  w-full lg:w-64 lg:shrink-0]   ← SearchInput, 250 ms debounce, trimmed
    [#filters  flex flex-wrap items-center gap-2]   ← 2–4 PRIMARY FilterSelect / DateRangeFilter
    [Filters ⏷ button + popover]           ← only rendered if #more is provided
    [lg:ml-auto: Clear filters (activeCount > 0) · count · #actions]
  [chips row: mt-3 flex flex-wrap items-center gap-2 border-t border-edge-subtle pt-3]
</BaseCard>
```

Props: `search?`, `searchPlaceholder?` (`"Search…"`), `count?: number|null`, `countLabel?` (`"results"`), `chips?: FilterChip[]` (`{key,label,value}`), `moreCount?: number`, `activeCount?: number`. Emits `update:search`, `remove(key)`, `clear-all`.

Rules encoded in the component and honoured by the good pages:

1. `v-model:search` + `search-placeholder` naming the searchable fields, always `"Search <what>…"` (gate-checked when static): `"Search unit, make, model, plate…"`, `"Search load #, driver, unit, commodity…"`, `"Search name, driver ID, employee ID, phone…"`. Ellipsis is `…`, not `...`.
2. `:count="filtered.length"` + `count-label="trailers"` — always a **domain noun**, never "results". Renders `count.toLocaleString()`.
3. `#filters` holds 2–4 **primary** dimensions as `FilterSelect` (`lint:ui-adoption` fails a fifth — Fuel costs' Network and Fuel problems' Owner moved to `#more` on 2026-10-12) (the trigger shows its own active value — do **not** also add a chip for these).
4. `#more` holds **secondary** dimensions as `<FilterSelect … block />`. Popover: `w-72 rounded-control bg-surface p-4 text-sm shadow-overlay ring-1 ring-edge-subtle`, inner `space-y-3`. `:more-count` badges how many are active.
5. `:active-count` + `@clear-all` on **every** bar with `#filters` or `#more` (`lint:ui-adoption`
   fails one without). FilterBar then draws the one ghost "Clear filters" button before the count
   whenever the count is above zero; never draw your own (also gate-checked). The count is how many
   dimensions narrow the list, **the search included**; a filter at its default is not active.
   Clearing resets every filter and the search to its default and **keeps the sort** — the sort
   orders the list, it does not narrow it. A control that switches WHICH list you are looking at (a
   tab, a queue, a scope) is not a filter and is neither counted nor cleared; nor is a date window
   that also drives the page's KPI cards (`useIdlingPage.ts`). Until 2026-10-12 nine pages drew this
   button three different ways and twenty filtered lists had none.
6. `:chips` mirror **only the `#more` filters**, with `@remove`; the chip row has no "Clear all" of
   its own, because the bar's "Clear filters" already covers it:
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
7. Filters apply live, per-filter. No Apply button. `page` resets to 1 via `watch`.
8. Never ship a filter no query consumes.

### 5.6 Row actions

```html
<template #actions="{ row }">
  <KebabMenu v-if="session.canManage">
    <BaseButton class="kebab-item" @click="openEdit(row)">Edit</BaseButton>
    <BaseButton class="kebab-item" @click="toggleReefer(row)">{{ row.is_reefer ? "Unmark reefer" : "Mark as reefer" }}</BaseButton>
    <BaseButton v-if="row.status !== 'retired'" class="kebab-item kebab-item-danger" @click="onRetire(row)">Retire</BaseButton>
  </KebabMenu>
</template>
```
`.kebab-item` / `.kebab-item-danger` are global classes in `style.css` — never re-style menu items locally. Destructive last, `kebab-item-danger`. Gate on `session.canManage`.

> **Corrected 2026-08-16, and applied in place 2026-08-21 (U5).** The snippet above and §1.2's table both *said* the children must be a bare `button` element for five more days, because this note was written BELOW them rather than into them — and a reference table is what a reader consults, so the wrong answer is the one they got. Both now read `BaseButton`; this note stays for the reasoning. They must not be raw elements: `lint:ui-adoption` counts raw buttons in `pages/` and `features/` with **zero tolerance**, so a literal element there is a red CI gate. Every real kebab in this codebase uses `<BaseButton class="kebab-item">` — `TrailersPage.vue:254`, `DriverQualificationPage.vue:403`, `PlanHistory.vue:205` — and the doc was the side that had drifted. Two further traps found the same day: `CompliancePage.vue:460` uses a `RouterLink.kebab-item`, which is a third pattern nobody documented, and the gate is a plain regex over file TEXT, so naming the element in a comment trips it too. Single-action rows may use a `<BaseButton variant="ghost" size="sm" @click.stop>` instead (`DispatchLoadsPage.vue:365`). Two or more actions in a row's `#actions` are a `KebabMenu`, destructive last — `lint:ui-adoption` fails the slot otherwise (2026-10-14: the applicant's invitation table had Review beside Revoke as two equal buttons).

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
- A one-question "are you sure?" is `useConfirm()` (D-US7): `await ask({ title, message, confirmLabel, tone })`.
  The label is the act's verb, never "OK"; `tone: "danger"` for anything that removes or cannot be undone.
  `window.confirm` / `alert` / `prompt` are refused by `lint:ui-adoption`.
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
- **Full sentences take a period.** Empty states, hints, descriptions, error bodies: `No drivers match these filters.` / `Optional. Leave blank and FuelGuard will generate a strong password.` A read state's "Could not …" (a table's `:error`, `QueryState`'s `error-text`, `ErrorState`'s `message`) is an error body, so the gate refuses one without its full stop (2026-10-15).
- **Length.** Buttons 1–3 words. Toast titles ≤5 words. Empty states 1 sentence (2 if the second is an instruction). Page descriptions 1–2 sentences. Hints ≤1 line.
- **It explains, then instructs.** The house move is *state the fact, then name the next action*: `No trailers yet. Add one, or sync from Samsara.`
- **Failures are "Could not …", never "Error" / "Failed to".** `Could not save trailer`, `Could not clear that exception`, `Could not create login`. The raw exception goes in the toast's second argument, never in the title. A READ's failure (a table's `:error`, `QueryState`'s `error-text`, `ErrorState`'s `message`) is the page's own sentence and never `error.message` — the server's text, PostgREST's, or TanStack's `["…"] data is undefined` (D-US9); the gate refuses the binding unless the site says `ui-adoption: server-message — <why>`. "That did not work" is refused too. Exceptions that read as a state, not a blame, are allowed: `Bulk update failed`, `Mail test failed`.
- **Busy states are gerund + `…`** and replace the label in place: `Saving…`, `Merging…`, `Retrying…`, `Creating…`, `Enabling…`, `Working…`, `Analyzing…`, `Uploading…`. Always the single-character ellipsis `…`.
- **`…` also means "opens something".** Menu items that lead to a drawer/dialog end in it: `Manage app login…`, `Create app login…`, `Manage certifications…`, `Reassign…`.
- **Domain jargon is used freely and never explained inline** — `HOS`, `reefer (ULSR)`, `DQ file`, `§391.51`, `placard`, `odometer regression`. The audience is fleet ops. But *product* jargon is banned: no "entity", "record set", "item", "resource".
- **Second person, present tense, active voice.** `Assign drivers to vehicles from the Vehicles page.` Not "Drivers can be assigned…".
- **Never apologise, never exclaim.** Zero `!` and zero "Oops"/"Sorry" in the codebase.
- **Consequences are stated plainly**, including irreversibility: `The password disappears when you close this drawer and cannot be recovered.`

### 7.2 Ten real strings that are GOOD

1. `"No trailers yet. Add one, or sync from Samsara."` — `TrailersPage.vue:224`. Names the state, then gives *both* real next actions. Two clauses, one sentence.
2. `"No loads yet. They arrive from McLeod on its next sync."` — `DispatchLoadsPage.vue`. Waiting is honoured as the legitimate next step rather than pretending the user must act; since LR6 (2026-09-24) there is no "create one" to offer.
3. `"Nothing needs attention right now."` — `DispatchLoadsPage.vue:344`. Empty exceptions queue framed as *good news*, not absence of data.
4. `"No idle data yet — run a Samsara sync from Settings → Data & Sync to populate the idle foundation."` — `IdlingPage.vue`. Empty state that names the exact navigation path. This is the house standard for "you have nothing because a prerequisite is unmet".
5. `"Copy these details now. The password disappears when you close this drawer and cannot be recovered."` — `DriverCredentialHandoff.vue:165-167`. Imperative first, consequence second. No hedging, no "please".
6. `"Optional. Leave blank and FuelGuard will generate a strong password."` — `DriverAccessModal.vue:326`. Optionality stated in one word, then the default behaviour spelled out so the empty field isn't ambiguous.
7. `"Resolve the ✕ items in the checklist below to approve."` — `DispatchLoadDetailPage.vue` until LR6 retired approval (2026-09-24). Kept as the pattern: explain a disabled button by pointing at the exact thing blocking it. Never `"You do not have permission"`-style dead ends.
8. `"Required — the driver and any auditor will see this"` — the reject/cancel reason on `DispatchLoadDetailPage.vue` until LR6 (2026-09-24). Kept as the pattern: a placeholder that changes behaviour tells you *who reads this*, which is why the field exists.
9. `"Rescoring started"` / `"Checking each declined attempt against Samsara — refresh in a minute."` — `RejectionsPage.vue`. Title = what happened; body = what the system is doing and the realistic wait. Sets an expectation instead of a spinner.
10. `"Unrecognized report"` / `"Expected a Pilot / Flying J 'All Transactions' export with Authorization_No, Card_No and Quantity columns."` — `usePriceUpload.ts`. The failure title is three words; the body names the exact expected artefact *and* the columns. This is the gold standard for import errors.

Honourable mentions worth copying: `"Certificate staged"` / `"It is not presenting yet — test it against EFS, then activate."`; `"Driver login revoked"` / `"The driver record and history were not changed."`; `"Fuel data verified"` / `"All 412 fuel events match the stored EFS lines — nothing to repair."`

---

## 8. Anti-patterns already present

All of these pass `lint:tokens`. They are structural and typographic violations, and they are the reason a new screen written by copying these files would look wrong.

**Rewritten 2026-08-19 (plan step D5).** The section previously indicted `DqFilePanel.vue` (deleted), the 332-line `CompliancePage.vue` (rewritten at 210 lines: FleetTable + attention strip, zero `align` keys, no local badge maps), `CertManager.vue`'s hand-rolled table (rebuilt on `DataTable` + `BADGE_BASE`), and `DriversPage.vue`'s two badge maps (moved into `lib/badges.ts` — `hosStatusBadge` / `appAccessBadge` — in D3). Those entries are resolved and removed; what follows is what REMAINS true against the current tree.

### 8.1 `features/roster/*` — mostly good, with specific breaks

`DriverAccessModal.vue`, `DriverAccessSummary.vue`, `DriverAccountAccessControl.vue` and `DriverCredentialHandoff.vue` are the **best-built drawer code in the repo**: `BaseCard`, `FormField`, `BaseInput`, `BaseButton`, `BADGE_BASE + toneClass`, `#footer` actions, `aria-labelledby`, `aria-live`, real busy labels. Copy their structure. The concrete breaks:

| File:line | Violation |
|---|---|
| `DriverAccessModal.vue:263` | `min-h-[26rem]` — arbitrary magic height to fake vertical centring. Use `flex-1` inside the drawer body, or nothing. |
| `DriverAccessModal.vue:418` | A hand-rolled card using **`border border-danger-200`** where the system's soft tint panel is `ring-1 ring-inset ring-danger-200` (cf. `DriverCredentialHandoff.vue:156`). |
| `DriverAccessModal.vue` + siblings | `leading-6` / `leading-5` hand-set on body copy — most of the app's `leading-*` usages live in these four files. Nothing else overrides line-height. Delete them. |
| `DriverAccessModal.vue:342, 400` | `<BaseButton class="absolute inset-y-0 right-1 my-auto px-2">` — overriding button padding to jam it inside an input. In-field adornments belong in the input primitive (as `SearchInput`'s clear ✕ does). |
| `DriverAccessSummary.vue` / `DriverAccountAccessControl.vue` / `HazmatPage.vue` / `HazmatEquipmentPage.vue` | The tinted "icon tile" (`flex size-10 … rounded-lg bg-success-50 text-success-700`) re-declared per file at two sizes. Four call sites, three variants, no component — should be a primitive. |
| `DriverCredentialHandoff.vue:225` | A re-implementation of `BaseCard` with a `surface-subtle` fill. |
| `DriverAccessSummary.vue:38-49` | Badge tone chosen by a nested ternary inside the template's `:class` array; every other file computes it in `<script>`. |

### 8.2 Adjacent files that leak the same anti-patterns (fix while you're there)

| File:line | Violation |
|---|---|
| `pages/FuelReconciliationPage.vue:222`, `pages/DriverAppSettingsPage.vue:451` | Hand-rolled `rounded-full px-2(.5) py-0.5 text-xs font-medium` badges. Badges are `BADGE_BASE + toneClass` and `rounded-detail`, never `rounded-full`. |
| `features/hazmat/ReviewPanel.vue:161`, `features/anomalies/AnomalyDetail.vue:297`, `features/settings/EfsClientCertCard.vue:232,242,259` | The full `BaseInput`/textarea class string copy-pasted inline (including `focus:ring-brand-500` — the system's focus ring is `brand-600`). |
| Legacy table guidance | Do not use the deleted `TableToolbar` or `SortableTh` patterns, or the former `w-72` FilterBar search width. The current FilterBar search is `w-full lg:w-64`; for table alignment use §5.2 above: text defaults left and `numeric` defaults right with tabular figures. |

### 8.3 Vocabulary rule the compliance rewrite established (D4)

Driver-qualification status words come from `lib/badges.ts` — `dqItemBadge` (OK / Expiring / Blocked) and `dqFileBadge` (OK / Blocked / Not started) — and from nowhere else. A `.vue` file carrying its own DQ status string literal is the regression to reject in review; the four-vocabulary drift this replaced is documented in `docs/plans/safety-dqf/DQF-EXECUTION-PLAN.md` D4.

## 9. Phone and tablet

**Added 2026-10-28 (Maintenance M4; proposal `docs/plans/maintenance/MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md` §4.5, owner Q-MX6 "as proposed, with the best solution").** Until this section the contract said one thing about small screens — `DataTable` draws cards below `md` — and the shop is used standing in a bay, on a tablet or a phone, by a maintenance employee, the in-shop workers and the inspector (Q-MX1, D-MX5). M3's pass at 390 px measured twelve targets under 44 px on the truck's page; every one was a SHARED control at its desk size. So the rules below are drawn by the primitives and the shell wherever they can be, and a page states only what only a page can know.

**Where they hold.** A section is phone-first when its catalogue group is in `PHONE_FIRST_GROUPS` (`apps/web/src/lib/phoneFirst.ts`) — today `maintenance`, i.e. every `/shop…` screen. Which screens belong to it is the surface catalogue's answer, never a path prefix. Rules 5 and 8 hold product-wide; rule 9 is the product's own list pattern, written down where the shop broke it.

| # | Rule | Drawn by | Gated by |
|---|---|---|---|
| 1 | **Every target 48 × 48 CSS px, 8 px from its neighbour** — row menus, filter chips and pagination included — while the page is *touched*: a coarse pointer (a tablet, at any width) or a window below `md`. A desk with a mouse keeps its density on the same page. An inline link in a sentence is exempt (WCAG 2.5.8). | The touch floor: `AppShell` calls `usePhoneFirst`, which `provideTouchTargets(getter)`; every primitive reads `useTouchTargets()` and raises its compact size — `AppButton`, inputs, selects, checkboxes, radios, segments, the date field, `FilterSelect`, `KebabMenu`, `TablePagination`, the card view's sort control. ONE floor, 48 (it was 44, `/apply`'s Q-AW20 bar, which 48 still clears); the date picker's calendar keeps 44 px cells because seven 48 px days do not fit a 320 px phone. | `touchTargets.test.ts`, `usePhoneFirst.test.ts`; `check-phone-rules.mjs` refuses a hand-written `<button>`/`<a>`/`<RouterLink>` under 48 px with no touch branch (a desk-only one says `ui-adoption: desk-only — <why>`). |
| 2 | **A page's one or two primary verbs stand in a bottom bar below `md`**, above the safe-area inset; from `md` up they sit in `PageHeader`'s actions. | `components/WalkActions.vue` — one list of `{ label, primary, disabled, onClick }`, rendered twice: `<WalkActions :actions />` in `#actions`, `<WalkActions :actions bar />` at the page's end. Secondary and desk actions (Places, Labels, Types of equipment) stay plain header buttons. | `check-phone-rules.mjs` refuses `variant="primary"` in a shop page's `PageHeader #actions`. |
| 3 | **A card shows three facts**: the row's identifier, ONE sentence that says why the row is in this list, and ONE date or amount. Everything else is on the row's own page. The whole card opens the row. | `DataTableColumn.card: "title" \| "sentence" \| "meta" \| "none"`. Marking any column switches the table's cards to `DataTableCards`' three-fact shape (an unmarked column of a marked table is `none`); the title's link is stretched over the card; under the touch floor the cards are drawn at any width, because a tablet in a bay is above `md`. | `check-phone-rules.mjs` refuses any column of a `DataTableColumn[]` on a shop screen without `card:`; `DataTableCards.facts.test.ts`. |
| 4 | **A list opens filtered to what needs attention**, the rest one tap away. | The page's default filter (`Trucks & trailers`: no `?show=` = attention). | Review. Measured exceptions, 2026-10-28: Annual inspections is a register and stays as it is (proposal §4.6, "Unchanged"); Parts and Equipment open on everything because nothing in them can need attention yet — production has 0 counted shelves and 0 equipment — and switch the day it can. |
| 5 | **One way back below `md`**: the shell's Back, not also a breadcrumb. On a touched shop page the trail goes at any width. | `BreadcrumbTrail` is `max-md:hidden`, and `PageHeader` passes `hideOnTouch` from the touch floor; the shell's Back (`AppShell`, `meta.parent`) is the one kept, 48 px under the floor. | `PageHeader.test.ts` ("PageHeader's one way back"). |
| 6 | **Desk screens stay out of the phone's navigation** — Labels needs a printer or a sheet: reachable from Parts and Equipment, never a tab. | It follows from rule 7: the tab row is the sidebar's rows, and Labels is a child screen, not a row. | `phoneFirst.test.ts`. |
| 7 | **Below `md` a phone-first section's doors stand in a bottom tab row** — the section's own sidebar rows (Shop · Parts · Trucks & trailers · Annual inspections), for a role that holds the section, on that section's pages only. The hamburger stays for the rest of the product. A page's verb bar stands ON the row: verbs above doors. | `layouts/SectionTabBar.vue`, fed by `phoneTabs()` over the sidebar's own `buildNavGroups` — no list, no permission of its own. The active tab is the page's catalogue `parent` chain (`phoneTabFor`), so Equipment lights Trucks & trailers. `bottomChrome.ts` has two layers: the row is the base, a bar stands at its height, and the Ask AI launcher and `<main>`'s padding (`--bottom-chrome`) clear both. | `phoneFirst.test.ts`, `SectionTabBar.test.ts`, `bottomChrome.test.ts`. |
| 8 | **The staging banner is one line below `md`**: the label stays, the sentence truncates and is whole in its `title`. | `EnvironmentBanner.vue`. | `EnvironmentBanner.test.ts`. |
| 9 | **One table per tab, and every table paged** (added 2026-10-28, M6 — the owner's review: the shop was the one section stacking tables, and its tables had no pager). A page with more than one list puts each on its own tab (`AppTabs`, the tab in the URL as `?tab=`, a count in each label); a list never sits inside another list's tab as a second tab row — it becomes a filter. Every `DataTable` has a `TablePagination` in `#footer`, unless it cannot grow and says why. | The Shop page (`?tab=roadside\|defects\|work-orders\|annual\|bills`; the old list addresses redirect, query and all) and the truck's page (`?tab=repairs\|due\|equipment\|inspections\|papers`). | `check-phone-rules.mjs`: a `DataTable` with no pager and no `ui-adoption: never-paged — <why>`; a page with two tables on screen at once — a `DataTable` or an imported component that draws one, drawers excepted — neither under a `v-if`/`v-else`. |

**Measuring it.** A pass at 390 × 844 and 834 × 1194 with a touch context (`hasTouch`, `isMobile`) counts every `button`, `a[href]`, `select`, `input` and `[role=button]` in the shell and the page whose box is under 48 px, treating a link stretched over its card as the card. M4's pass is in the PR; M5 is the owner's, on the real tablet in the bay (proposal §8).

## Quick checklist for a new list page

1. Root `<div class="space-y-6">`. `PageHeader` renders the `<h1>` from `route.meta.title` (or its explicit `title` prop) — do not render a second `<h1>`.
2. `<PageHeader description="One or two sentences.">` + `#actions` with at most one `variant="primary"`.
3. Toolbar + table live in one `<DataWorkspace>` (§5.2b): `<FilterBar embedded v-model:search :count="filtered.length" count-label="<noun>">` — 2–4 `FilterSelect` in `#filters`, secondaries in `#more` with `:more-count` and matching `:chips` + `@remove`; always `:active-count` + `@clear-all`.
4. `columns: DataTableColumn[]` in `<script>`. **No `align`.** Use the named `width` scale; reserve `headerClass` for exceptional fixed-width controls. Tone belongs in `cellClass` (`font-medium text-ink` for the identity column, `text-ink-secondary` for the rest).
5. `<DataTable :columns :rows="pageRows" embedded row-key="id" :loading :error :retrying :sort :empty-text @sort @retry>` — never hand-roll loading/error/empty, and never wrap it in a card of your own.
6. `#actions` → `<KebabMenu v-if="session.canManage">` with `.kebab-item` buttons, destructive last with `.kebab-item-danger`.
7. `#footer` → `<TablePagination :page :page-size="PAGE_SIZE" :total="filtered.length" @update:page>`; `watch` every filter to reset `page` to 1.
8. Badges only via `BADGE_BASE + toneClass` / `StatusBadge`.
9. Drawer via `<SlideOver>`; actions in `#footer`; body sections `space-y-6` with `h3.text-sm.font-semibold.text-ink`.
10. Mutations: `try { await mutateAsync(); toast.success("Thing updated"); } catch (e) { toast.error("Could not save thing", e instanceof Error ? e.message : undefined); }`
11. On a phone-first page (§9): mark every column's `card:`, and put the page's primary verb in `WalkActions`.
12. Run `pnpm --filter web lint:tokens` **and** `pnpm lint:ui-adoption`. They automate colour, elevation, unknown roles, raw elements, missing PageHeader, primitive clones, `text-ink-subtle`, nested non-embedded tables, FilterBar slot placement, FilterBar's `:active-count` and hand-built clear buttons, hand-built "N selected" strips, hand-built KPI tiles, more than four controls in `#filters`, search copy that is not "Search <what>…", pagination ownership and manual action columns. Judgment calls that cannot be derived from structure — filter priority, useful empty copy and whether a control belongs on the page — remain review work.
