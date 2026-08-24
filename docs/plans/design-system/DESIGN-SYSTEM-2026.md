# The design system, decided · 2026-08-23

This is an **execution document**. The audit that preceded it surveyed; this one decides. Every
decision below is made — not offered — and carries its evidence, its build, its verification and
its done-when, so a fresh session can execute any one of them without re-deriving anything.

**Scope.** These are the decisions that must be settled *before* a visual redesign starts, because
each one either (a) is a defect a redesign would otherwise re-ship, or (b) determines what a
redesign is even able to change. No decision here changes a colour, a component's look, or a
layout. Those come after.

**Method.** Every claim about the tree is measured (commands in §0). Every claim about outside
practice is sourced (§8) and dated — 2026 practice, not 2022 habit. Where 2026 practice and this
repo's existing gates disagree, the gates win and the decision says so; where they agree, the
decision cites both.

**Supersedes nothing.** `docs/DESIGN-SYSTEM-CONTRACT.md` remains the description of what the system
*is*. This document is what changes about it and in what order. `docs/DESIGN-SYSTEM.md` is stale by
its own successor's admission and is retired by D-DS12.

---

## 0. Ground truth, measured 2026-08-23 at `4bd018c`

| Fact | Measured | Command |
|---|---|---|
| Token source of truth | `packages/ui/src/tokens.css`, 400 lines, 259 shared declarations | `pnpm lint:tokens-parity` |
| Consumers importing it without override | 2 (`apps/web`, `apps/admin`) | same |
| Shared primitives | 25 `App*` exported from `packages/ui/src/index.ts` | `cat packages/ui/src/index.ts` |
| Web-local composites | 9 in `apps/web/src/components/ui/` | `ls apps/web/src/components/ui/` |
| DataTable column definitions | **387** | `grep -rho '{ key: "' apps/web/src --include='*.vue' --include='*.ts' \| wc -l` |
| …of which declare `align` | **11** (9 left, 1 right, 1 center) | `grep -rho 'align: "[a-z]*"' apps/web/src` |
| Arbitrary Tailwind values | **228**, of which **166** are `min-w-[…]` across 17 distinct values, **13** are `z-[…]`, **13** are off-scale text sizes | `grep -rohE '[a-z-]+-\[[^]"]+\]' apps/web/src --include='*.vue'` |
| Off-scale radii | 9 (`rounded-md` ×7, `rounded-lg`, `rounded-t-xl`) | `grep -rohE '\brounded-[a-z0-9-]+' apps/web/src --include='*.vue'` |
| `dark:` variants in `apps/web` | **0** | `grep -rn 'dark:' apps/web/src --include='*.vue'` |
| Driver themes | **4** (light, dark, highContrastLight, highContrastDark) × 33 roles | `pnpm --filter @fuelguard/driver lint:theme` |
| Hex literals outside `chartTheme.ts` | 3 (2 in a test, 1 annotated canvas value) | `grep -rEn '#[0-9a-fA-F]{6}' apps/web/src` |
| Gates, all green | 7 design gates + typecheck + 2,462 unit tests + 22 PGlite matrices | §7 |

**The system is in good health.** Colour discipline is real and enforced; hardcoded styling is
near-zero. Everything decided below is either a *structural* gap the colour linter was never built
to see, or a *cross-surface* gap no gate covers.

---

## 1. The decisions

| ID | Decision | Priority | Blocking a redesign? |
|---|---|---|---|
| **D-DS1** | Data-table columns default to **left**; `numeric` implies **right**; centre only for controls | **P0** | Yes — a redesign would re-ship it |
| **D-DS2** | Ship dark mode **now**, on `light-dark()`, before the redesign — not after | **P0** | Yes — otherwise the redesign is done twice |
| **D-DS3** | Driver and web keep **separate values**; the shared schema is a **14-role neutral core**, gated. Driver emitter deferred — see D-DS3b | P1 | No, but sets the ceiling |
| **D-DS4** | Overlays move to the **Popover API top layer**; every `z-[9999]` is deleted | P1 | Yes for overlay work |
| **D-DS5** | Name the column-width scale; `min-w-[Nrem]` leaves the call sites | P1 | Yes for table work |
| **D-DS6** | Add `text-2xs` (11px); then ban arbitrary text sizes | P1 | Yes |
| **D-DS7** | Extend `check-design-tokens.mjs` to **radius, shadow, text size, alignment** | P1 | No — enables the rest |
| **D-DS8** | ⚠ **Corrected on execution** — the `App*` "twins" are admin's components, not duplicates. Delete the 4 dead exports; gate against new ones | P2 | No |
| **D-DS9** | Sidebar CSS becomes a component + roles; `prefers-reduced-motion` / `forced-colors` go global | P2 | Yes for navigation work |
| **D-DS10** | Contrast stays **WCAG 2.2 AA**. APCA advisory only. WCAG 3 is not adopted | P1 | No |
| **D-DS11** | `@headlessui/vue` → **Reka UI**, during the redesign, not before | P2 | No |
| **D-DS12** | Documentation collapses to **one** contract file; the gates remain the law | P1 | No |
| **D-DS13** | Add `preview:local`; the browser loop is a first-class gate, not a workaround | **P0** | Yes — you cannot redesign what you cannot see |
| **D-DS14** | Keep the gate-first governance model. Do not adopt AI-agent "drift detection" | P1 | No |
| **D-DS15** | **Identity becomes blue + warm soft purple + soft gray.** Gold is retired | P1 | It *is* the redesign's colour half |

---

### D-DS1 — Table columns align left by default. Centre is for checkboxes.

**Decision.** `alignCls` in `apps/web/src/components/ui/DataTable.vue` defaults to `text-left`.
`numeric: true` implies `text-right` **and** `tabular-nums`. `align` remains an explicit override,
and `align: "center"` is reserved for control columns (checkbox, icon, status dot). Headers follow
their column, which they already do.

**Why this is P0 and not a nice-to-have.** 376 of 387 column definitions omit `align`. The current
default is `text-center`:

```ts
// apps/web/src/components/ui/DataTable.vue:136
const alignCls = (col: DataTableColumn): string =>
  col.align === "left" ? "text-left" : col.align === "right" ? "text-right" : "text-center";
```

Verified by mounting the component, not by reading it — a probe rendered three columns and the
classes came back:

```
TH: ["font-medium px-4 py-3 text-center pl-6",
     "font-medium px-4 py-3 text-center tabular-nums",   ← numeric: true
     "font-medium px-4 py-3 text-left pr-6"]             ← align: "left" (the only one)
```

So **every money, gallons, MPG and count column in the product is centre-aligned**, and the app's
own two authorities both describe the opposite:

- `DataTable.vue:29` — *"text columns left-aligned; `numeric: true` → right-aligned + tabular-nums"*. False.
- `apps/web/CLAUDE.md` — *"Omit `align` on DataTable columns; `numeric: true` adds tabular-nums only"*. Half true: it correctly says `numeric` does not right-align, then instructs the omission that centres the column.

2026 enterprise convention is not ambiguous on this: left-align words, right-align quantities,
match header to column, and *"center alignment is not recommended unless it is an element like a
checkbox or star rating… for text or numerical data, doing so makes it harder to scan"*
([Pencil & Paper][pp], [Carbon][carbon], [A List Apart][ala]). For a fleet-fuel product whose
entire job is comparing numbers down a column, this is the single highest-value fix in this
document.

**Build.**
1. Change the default in `alignCls`; make `numeric` contribute `text-right` unless `align` is set.
2. Delete the 9 now-redundant `align: "left"` declarations; keep the 1 `align: "right"` (verify it is not now doubled) and the 1 `align: "center"` (verify it is a control column).
3. Correct the docstring at `DataTable.vue:29` and the bullet in `apps/web/CLAUDE.md`.
4. Add the gate from D-DS7.

**Verification.** A mount test in `apps/web/src/components/ui/` asserting: no `align` → `text-left`;
`numeric` → `text-right tabular-nums`; `align: "center"` → `text-center`. Then a visual pass via
D-DS13 on Fuel Log, Transactions and Anomalies.

**Done-when.** `grep -c 'text-center' ` on a rendered table returns only control columns; the test
above is green; `apps/web/CLAUDE.md` and the docstring agree with the code.

**Risk.** ~376 columns change appearance at once. That is the point, and it is exactly why it must
land *before* a redesign rather than inside one — otherwise nobody can tell which change caused
what. Land it as its own PR with before/after screenshots.

---

### D-DS2 — Dark mode ships now, on `light-dark()`, and the redesign inherits it.

**Decision.** Implement dark mode in the role layer of `packages/ui/src/tokens.css` using
`color-scheme: light dark` on `:root` plus `light-dark()` in every semantic role. A manual toggle
sets `color-scheme: dark` / `light` explicitly on the root element. **No `.dark` class, no
`dark:` Tailwind variants, no component changes.**

**Why now rather than after.** The token file has carried this comment since it was written:

> *Dark theme (not shipped yet): add `@custom-variant dark (&:where(.dark, .dark *));` and a
> `.dark { … }` block here. Templates already reference roles, so no component changes will be
> needed.*

That promise is real and measurable — `apps/web` contains **zero** `dark:` variants, because every
template already uses roles. Dark mode is therefore a ~60-line change to one file, and it is the
cheapest it will ever be. Do it after a redesign and every new surface gets colour-picked twice.
The driver app already ships four themes against the same role vocabulary, which is the proof that
the vocabulary carries.

**Why `light-dark()` and not the `.dark` class the comment proposes.** The comment predates the
platform. `light-dark()` is **Baseline Newly Available across all engines as of May 2026** and
reaches Baseline Widely Available late 2026 ([MDN][mdn-ld], [una.im][una]). It replaces the
duplicated-variable pattern outright, and a manual toggle works by overriding `color-scheme` at any
element — no class plumbing, no `@custom-variant`, and correct `prefers-color-scheme` behaviour by
default. It also fixes form controls, scrollbars and `Highlight` colours for free, which a class
approach does not.

**Deliberately not adopted from the same generation of CSS:** `contrast-color()` (auto-picks
readable foregrounds) and `@container style()` micro-theming. Both are Baseline Newly Available,
both are attractive, and both would put the *choice* of a foreground colour inside the browser
rather than inside `lint:ui-contrast`. We keep the contrast gate authoritative (D-DS10). Revisit
once the gate can evaluate them. `@function` is Chrome-only and is out.

**Build.**
1. In `tokens.css`, add `:root { color-scheme: light dark; }`.
2. Rewrite each semantic role as `light-dark(<current value>, <dark value>)`. Primitive ramps stay single-valued; only roles get a second value.
3. Elevation swaps mechanism, not just value: `--elevation-*` shadows carry depth in light; in dark they become a hairline `inset 0 0 0 1px` glow, per current practice for dark surfaces ([una.im][una]).
4. Charts: `chartTheme.ts` already resolves `--viz-*` at runtime via `getComputedStyle`, so canvas follows automatically — **verify** the jsdom fallbacks in that file do not silently pin light values (`lint:chart-colors` reads them).
5. Toggle: a `useColorScheme` composable writing `color-scheme` on `<html>` + `localStorage`, defaulting to system.
6. `lint:ui-contrast` must run against **both** schemes — see D-DS10.

**Verification.** `pnpm lint:ui-contrast` green for both schemes; D-DS13 screenshots of Dashboard,
a data table, a modal and the sidebar in both; `forced-colors` block from D-DS9 still correct.

**Done-when.** A `color-scheme: dark` root renders the whole app correctly with **zero** changes
under `apps/web/src/components/`, `features/`, or `pages/`. If any component needs a change, the
role layer is incomplete — fix the role, not the component.

**Risk.** The `--prototype-*` block in `apps/web/src/style.css` and `dev/design-system-lab.css`
(493 lines) are single-valued and will look wrong in dark. They are dev-only; either give them
`light-dark()` too or gate the lab to light. Decide when D-DS2 is executed, not now.

---

### D-DS3 — Two surfaces, two value sets, one schema. Driver does *not* adopt the web palette.

**Decision.** Reject unification of values. Adopt **DTCG (Design Tokens Format Module v2025.10)**
JSON as the single *schema* for both surfaces, with separate theme files, and generate both
outputs with **Style Dictionary 5.5.2**:

```
packages/tokens/                       ← new, zero workspace deps
  src/primitives.json                  DTCG, shared ramps where they genuinely are shared
  src/web.light.json  web.dark.json    web/admin role values
  src/driver.{light,dark,hc-light,hc-dark}.json
  build.mjs                            Style Dictionary
→ packages/ui/src/tokens.generated.css        (@theme inline; web + admin)
→ apps/driver/src/theme/theme.roles.generated.json + tokens.generated.ts
```

**Why not merge the values.** The divergence is not drift — it is a documented, deliberate product
decision. `docs/plans/drivers-app/DRIVER-APP-DESIGN-SYSTEM-2.md` (2026-08-07) specifies the driver
app as *"driver mission control, not a mobile dashboard"*, optimised for glanceability, sunlight
and gloves, and every decision there is measured against reducing taps and reading time. That
context earns a blue action colour, a coarser radius scale (10/12/16 vs web's 3–10px), a 44pt touch
floor and four themes including high contrast. Forcing web's gold identity and 4px control radius
onto it would degrade a surface that was designed on purpose. 2026 multi-brand token architecture
says exactly this: share the **semantic layer** (`surface`, `ink`, `edge`, `brand`, `danger`),
specialise the **value layer** per surface ([DTCG][dtcg], [Timothy Graf][graf]).

**Why a pipeline at all, then.** Because today there are two hand-written sources with no
relationship: 400 lines of `oklch()` CSS on one side, a 4×33 RGB-triplet JSON on the other, and
`lint:tokens-parity` covers only web+admin. Nothing detects that driver's `--color-edge-strong`
and web's `--edge-strong` have diverged in meaning, or that a new role added to one is missing
from the other. DTCG is now the settled answer: **first stable spec 2025.10 (28 Oct 2025)**, backed
by 24+ organisations including Adobe, Google, Meta and Figma; 84% of teams ship tokens, up from 56%
a year earlier; Style Dictionary is the reference transpiler ([DTCG][dtcg], [zeroheight via
digitalapplied][da]).

**Why this fits this repo specifically.** It is the pattern the repo already runs: `pnpm gen:rules`
generates `*.generated.ts` from YAML, `lint:codegen` fails the build on drift, and CLAUDE.md
already forbids editing generated output. `packages/tokens` is the same shape with a different
input, and `packages/hazmat-*` is the precedent for a zero-workspace-dep package.

**Build.** Round-trip first: generate `tokens.generated.css` from DTCG JSON and require it to be
**byte-identical** to today's hand-written `tokens.css` before switching the import. Same for the
driver: generated `theme.roles.json` must equal the current file. Only then delete the originals.

**Verification.** `lint:codegen` extended to `packages/tokens` output; `lint:tokens-parity` retargets
at the generated file; driver `lint:theme` (4 themes × 33 roles) still green; a new
`lint:token-schema` asserting both surfaces declare the same **role names**, whatever the values.

**Done-when.** A role added to `primitives.json` appears in both surfaces or fails CI; no token
value is hand-edited anywhere; `git diff --exit-code` on generated output is a gate.

**Sequencing.** After D-DS2. Doing it before means round-tripping the token file twice.

---

### ⚠ D-DS3b as executed — "share the semantic layer" was about 40% true

D-DS3 promised the two surfaces would *"share the semantic layer, specialise the value layer."*
Measured 2026-08-23: of the driver's **33** roles and web's **61**, exactly **14 names appear on
both**.

| | |
|---|---|
| **Shared (14)** | `canvas`, `surface`, `surface-subtle`, `surface-muted`, `surface-inverse`, `ink`, `ink-secondary`, `ink-muted`, `ink-subtle`, `ink-disabled`, `ink-inverse`, `edge-subtle`, `edge`, `edge-strong` |
| **Driver-only (19)** | `operation-current`, `operation-blocked`, `sync-pending`, `brand-fg`, … |
| **Web-only (47)** | `elevation-*`, `shadow-tint-*`, `viz-*`, `link`, `action-primary*`, … |

The divergence is **not drift** — it is the two products being different. A truck app has operation
and sync states; a dashboard does not. A pointer-driven document UI has elevations, chart series and
link colours; a phone in a cab does not. Forcing either vocabulary onto the other would be worse
than leaving them apart.

So `lint:token-schema` pins **the 14**, not all 33 or all 61. The list is written out rather than
computed, because an intersection derived from the two files can never fail — drop a role from both
and the intersection quietly shrinks. Declaring it means a fifteenth shared role is a decision about
the design system rather than a side effect of editing one app.

**The full form — moving the driver's four themes into `packages/tokens` and emitting them through a
second Style Dictionary platform — is deliberately not done.** The gain is one place to look. The
cost is a second emitter and a restructure of theme loading in a shipping React Native app **that
cannot be run or seen from here** — the driver is Expo, and every visual change in this whole plan
has been verified in a browser before shipping. Doing it blind, for a payoff of tidiness, against a
vocabulary that turns out to overlap by 40%, is not a trade worth making. It stays available: the
`platforms` extension point in `build.mjs` is exactly where it would go.

---

### D-DS4 — Overlays go to the top layer. The z-index ladder is deleted.

**Decision.** Every overlay — `KebabMenu`, `VehicleSelect`, `FilterBar`'s more-filters panel,
`FilterSelect`, `SidebarFlyoutSection`, `ToastContainer`, `BaseModal` — moves to the native
**Popover API** (`popover` attribute / `showPopover()`), which places the element in the browser's
top layer. The 13 `z-[…]` literals are deleted along with the 4 hand-rolled full-screen backdrop
`<button>`s that exist only to catch outside clicks. For page chrome that legitimately stacks
(sticky table headers, the app bar, the sidebar) introduce a **small token ladder ending at 5**:
`--layer-base: 0; --layer-sticky: 2; --layer-chrome: 5;`.

**Why.** The current stack is `z-[1]`, `z-[9998]`, `z-[9999]`, `z-[10000]` — hand-tuned in six
files, with the 9998 values existing purely as click-catchers. The Popover API has been Baseline
since 2024 and is stable in every engine, and it gives light-dismiss, Escape handling and focus
management for free — deleting code, not adding it ([MDN/Baseline][popover]). 2026 layering
practice is explicit: *"page chrome uses a small ladder ending at 5; if you think you need a number
above 5, you're building an overlay — promote it to the top layer instead of outbidding"*, and
name the tiers as tokens rather than absolute numbers ([CodePen][cp], [OutSystems][os]).

**What is deliberately *not* adopted yet: CSS Anchor Positioning.** It reached Baseline Newly
Available in early 2026 at ~91% of traffic ([nexgismo][anchor]), and it would let us delete
`@floating-ui/vue` as well. We keep floating-ui for *positioning* and take only the top-layer win,
because 9% of traffic on a carrier-facing product is a real number and the fallback story for
anchor positioning is still manual. Revisit when it is Baseline Widely Available.

**Verification.** `accessibilityPrimitives.test.ts` and `interactionPrimitives.test.ts` already
exist in `apps/web/src/components/ui/` — extend them for Escape/light-dismiss. A gate banning
`z-[` in `apps/web/src` (D-DS7).

**Done-when.** `grep -r 'z-\[' apps/web/src` returns nothing; no component renders a full-screen
backdrop button; Escape and outside-click close every overlay without a keydown listener.

---

### D-DS5 — The column-width scale gets a name.

**Decision.** Add `width?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl"` to `DataTableColumn`, mapped
inside `DataTable.vue` to the existing values. `headerClass` stops being the width channel.

**Why.** 166 `min-w-[…]` occurrences across **17 distinct values** — `1.5, 4, 5, 6, 7, 8, 9, 10, 11,
12, 13, 14, 16, 18, 20, 24, 52rem`. That is a width scale; it simply was never named, so every new
table re-guesses it and no two tables agree. The column contract's own comment already admits the
workaround: *"fixed-ish columns pass width via `headerClass` (e.g. `min-w-[6rem]` / `w-32`)"*.
Naming it is the standard "component token" tier of a 2026 token architecture — component-scoped
values that reference the system rather than raw numbers ([UXPin][uxpin], [Graf][graf]).

**Proposed mapping** (collapse 17 → 6; the long tail is noise, not intent):
`xs 4rem · sm 6rem · md 8rem · lg 11rem · xl 14rem · 2xl 18rem`. The outliers `1.5rem` (a control
column) and `52rem` (a container, not a column) are not column widths and stay as-is.

**Done-when.** No `min-w-[` inside a `DataTableColumn` literal; the six names cover every table;
the gate from D-DS7 enforces it.

---

### D-DS6 — Add `text-2xs`, then ban arbitrary text sizes.

**Decision.** Add one token — `--text-2xs: 0.6875rem` (11px) — to `tokens.css`, then forbid
`text-[…]` outright. `apps/web/CLAUDE.md`'s "six text sizes only" becomes seven.

**Why legitimise rather than delete.** 11px appears **11 times**, all for the same job: dense
secondary metadata (hazmat class chips, cert fingerprints, chart legends, timestamps). That is a
real tier the scale is missing, and forcing those to `text-xs` (12px) is a design regression
disguised as discipline. The other two off-scale values are genuinely accidental and go:
`text-[10px]` in `PlacardDiamond.vue` → `text-2xs`, and `text-[0.9375rem]` (15px) in
`AppShell.vue:73` — navigation type — → `text-sm` or `text-base`, decided visually via D-DS13.

**Caveat to check when executing.** 11px is below the 12px floor several accessibility rubrics use
for body text. It is acceptable here because every instance is non-essential metadata with an
accessible duplicate nearby — confirm that during the build, and if any instance carries unique
information, it moves up a tier instead.

**Done-when.** `grep -r 'text-\[' apps/web/src` returns nothing; `text-2xs` is in the `@theme`
block; the gate enforces the seven names.

---

### D-DS7 — The colour linter becomes the design linter.

**Decision.** Extend `apps/web/scripts/check-design-tokens.mjs` from colour-only to four more
dimensions, reading its vocabulary from `tokens.css` exactly as it already reads colour roles:

| New rule | Bans | Enables |
|---|---|---|
| Radius | any `rounded-*` not in the shape roles (+ `rounded-full`) | D-DS7 fixes the 9 off-scale radii |
| Shadow | already bans generic `shadow-sm/md/…`; add: any `shadow-*` not a named elevation | — |
| Text size | any `text-[…]`; any size not in the seven | D-DS6 |
| Layer | any `z-[…]`; any `z-*` not a layer token | D-DS4 |
| Alignment | `align:` in a `DataTableColumn` without a comment justifying it; `min-w-[` inside a column literal | D-DS1, D-DS5 |

**Why the linter and not review.** This repo's entire quality model is machine-enforced, and the
audit proved why: colour discipline is near-perfect (3 hex literals, all annotated) *because* a gate
watches it, while radius and alignment rotted *because* nothing did — including inside
`BaseModal.vue`, a shared primitive, which uses `rounded-lg` instead of `rounded-dialog`. That is
also the 2026 consensus: automated token linting in CI that fails the build, rather than
documentation ([Supernova][sn], [digitalapplied][da]).

**Precedent already in the file.** Its own header records the `border-line` incident — a misspelt
semantic name that Tailwind silently emitted nothing for, invisible to every gate. Extending the
same "read the vocabulary from `tokens.css`" mechanism to four more properties is a continuation,
not a new idea.

**Done-when.** Each new rule ships with the violations it found already fixed, and CI runs it.

---

### D-DS8 — One primitive per job, for real.

**Decision.**
- **Promote** `DataTable`, `PageHeader`, `FilterBar`, `FilterSelect` from `apps/web/src/components/ui/` into `@fuelguard/ui`. **Delete** `AppTable` and `AppPageHeader`.
- **Delete** `AppNumberField` and `AppInputGroup` (zero call sites outside their own file and the barrel).
- **Delete** the alias-only exports `AppSurface` and `AppTextField`.
- **Keep** `AppBadge` **and** `BADGE_BASE`/`toneClass` — they are not duplicates (see below).

**Why this direction and not the reverse.** Usage decides: `PageHeader` 51 vs `AppPageHeader` 9;
`DataTable` 43 vs `AppTable` 28. The web-local composites won on merit; the shared package holds the
losers. Admin has 6 pages and already imports from `@fuelguard/ui` in 7 files, so promotion serves
it too. 2026 drift guidance names this exact failure — *"snowflake components: unique
implementations that look like existing system components but are technically separate"*
([Supernova][sn]) — and the cure is consolidation before a redesign doubles the surface.

**Why `AppBadge` stays.** `AppBadge` is a component; `toneClass` is a vocabulary map from a domain
status (`"critical"`, `"expiring"`) to a tone. `apps/web/CLAUDE.md` requires the second and the
badges file carries 254 lines of hard-won domain mapping with its casing incident recorded. The
right end state is `AppBadge` *consuming* `toneClass`, not either deleting the other. Verify the 6
`AppBadge` call sites are not bypassing the map.

**Done-when.** `lint:ui-adoption` gains a rule that a component name existing in both
`packages/ui/src/components/` and `apps/web/src/components/ui/` fails the build.

---

### ⚠ D-DS8 as executed — the audit was wrong, and here is the measurement that showed it

The decision above read: *"Usage decides: `PageHeader` 51 vs `AppPageHeader` 9 … The web-local
composites won on merit; the shared package holds the losers."* That was measured across
`apps/web` **and** `apps/admin` together, and splitting the counts destroys the conclusion:

| Export | apps/web | apps/admin | What it actually is |
|---|---|---|---|
| `AppPageHeader` | **0** | 9 | **admin's page header.** Deleting it breaks admin. |
| `AppBadge` | **0** | 6 | **admin's badge.** Same. |
| `AppTable` | 19 | 9 | A **7-line scroll wrapper**, not a rival to the 300-line `DataTable`. |

`AppTable` is the sharpest correction. It is `<div class="overflow-x-auto"><table><slot/></table></div>`
and nothing more. `DataTable` is column-driven with sorting, selection, loading, empty and error
states. They do different jobs — and because `lint:ui-adoption` bans a raw `<table>` in `pages/` and
`features/`, `AppTable` is the **sanctioned escape hatch** for the hand-authored tables in import
previews and detail panels. Deleting it would have forced 19 call sites into either a gate violation
or a misuse of `DataTable`.

**Promotion was also dropped, and not only because the premise failed.** The dependency closure was
never costed: `DataTable` pulls `ErrorState`, `TableSkeleton` and `@/lib/sort` with it, and
`FilterBar`/`FilterSelect` would add `@floating-ui/vue` to the shared package. Admin uses `AppTable`,
not `DataTable`, so promotion would serve no existing consumer — which is the definition of a
speculative architecture change, and the plan forbids those in its own preamble.

**What survived, because it was true:** four exports had no caller anywhere. `AppNumberField` and
`AppInputGroup` were whole components nothing rendered; `AppSurface` and `AppTextField` were aliases
for `AppCard` and `AppInput` that nobody used the second name for. Those are gone, and
`lint:ui-adoption` now fails on any export with no caller — while still counting a component used
only *inside* `packages/ui` as alive, which is why `AppIconButton` correctly stays.

---

### D-DS9 — The sidebar stops being CSS.

**Decision.** The ~130 lines of `@layer components` in `apps/web/src/style.css`
(`.sidebar-glass`, `.sidebar-nav-*`, `.sidebar-account-item`, …) and their 9 `--sidebar-*` aliases
become a real `AppSidebar` / `AppNavItem` primitive with role tokens. Separately and immediately:
**lift the `prefers-reduced-motion` and `forced-colors` blocks out of the sidebar and make them
global**.

**Why the second half is urgent and the first is not.** Those two media blocks are the **only**
reduced-motion and forced-colors handling in the entire web app, and they currently protect exactly
one component. Every other transition in the product ignores a user who asked for less motion, and
every other surface ignores Windows High Contrast. That is an accessibility gap with a legal floor
attached (EAA/WCAG 2.2 AA, D-DS10) and it is a ~20-line fix. The component extraction is a redesign
task and can wait.

**Why the sidebar became CSS in the first place matters.** It is the one surface with visual
treatment the token layer cannot express — an inset brand gradient, an inset selected bar, a
material overlay. A redesign will want to change exactly this and will find it unreachable from the
component layer. Extraction is therefore a prerequisite for navigation redesign specifically.

**Done-when.** `prefers-reduced-motion` and `forced-colors` are declared once, globally; no
`.sidebar-*` class is referenced from a template.

---

### D-DS10 — WCAG 2.2 AA is the gate. APCA is advisory. WCAG 3 is not adopted.

**Decision.** Keep `lint:ui-contrast` on WCAG 2 ratios as the **blocking** gate. Extend it to
evaluate **both colour schemes** once D-DS2 lands. Optionally report an APCA Lc value alongside as
**non-blocking** information. Do not migrate the gate to APCA.

**Why, precisely.** WCAG 3.0 is still a Working Draft in 2026 and is not expected to reach
Recommendation before roughly 2028–2030. APCA is **not in the normative draft** — the AG Working
Group removed it in July 2023 — and the current editor's note says outright that *"the contrast
algorithm used in WCAG 3 is yet to be determined."* WCAG 2.2 AA remains the operative legal
benchmark under the ADA and the European Accessibility Act. The considered position in the field is
a two-layer strategy: *WCAG 2 as the compliance floor, APCA as the readability ceiling*
([Roselli][ros], [accessibility.chat][ac]). That is what this decision adopts, and it is why APCA
appears at all rather than not.

**The real gap to close is not the algorithm.** It is that `lint:ui-contrast` currently checks a
single theme, and D-DS2 is about to double the surface. A dark palette that fails AA is a far more
likely regression than a light one that passes AA and fails APCA.

**Done-when.** The gate names the scheme in its output (today: *"info status / tint: 6.26:1
(minimum 4.5:1)"* — tomorrow, twice, once per scheme).

---

### D-DS11 — Reka UI replaces Headless UI, during the redesign.

**Decision.** Migrate the 4 files using `@headlessui/vue` to **Reka UI** as part of the redesign
work that touches them. Do not do it as a standalone task.

**Why.** `@headlessui/vue`'s latest stable is **1.7.23** — the version installed — and the registry
shows nothing but `0.0.0-insiders.*` builds through 2026 (last: 2026-04-13). It is frozen. Reka UI
(formerly Radix Vue) published **2.10.3 on 2026-08-10**, has ~590k weekly downloads, and is the base
Nuxt UI is built on ([npm registry, checked 2026-08-23]).

**Why not now.** Only 4 files import it — one `Menu` and one `Dialog`. Both are wrapped by our own
`KebabMenu` and `BaseModal`, and both are being rewritten anyway by D-DS4 (top layer). Migrating
first means doing the same work twice. There is a real chance D-DS4 removes the dependency outright,
since the Popover API supplies the behaviour Headless UI was providing.

**Done-when.** `@headlessui/vue` is absent from `apps/web/package.json`.

---

### D-DS12 — One design document, and it is generated from the gates where it can be.

**Decision.** `docs/DESIGN-SYSTEM-CONTRACT.md` is the single written contract. **Retire**
`docs/DESIGN-SYSTEM.md` (stale by its successor's own header). Fold the durable parts of
`docs/UI-COMPONENT-ADOPTION.md` and `docs/UI-UX-AUDIT-2026-08-11.md` into it and mark them
historical. `apps/web/CLAUDE.md` stays as the short "most-often-violated rules" card and must be
corrected where it is wrong (D-DS1).

**Why.** The audit found three documents describing the same system with different content, and the
contract's own header already records the failure mode: *"a session reading only this file wrote
code `lint:ui-adoption` and `lint:tokens` rejected."* The standing project memory says the same:
trust the gates, not the prose. Fewer documents, each with a named authority, is the fix — and where
`pnpm audit:ui:write` can emit a section (it already writes markdown), the document should embed
generated output rather than restate it.

**Done-when.** One contract file; every rule in it names the gate that enforces it or is explicitly
marked "convention, unenforced".

---

### D-DS13 — The browser loop is a gate, not a workaround.

**Decision.** Add to `apps/web/package.json`:

```json
"preview:local": "set -a && . ./.env && set +a && vite build && vite preview --port 4173"
```

and document it in `apps/web/CLAUDE.md` as the way to see a change. Enable the design lab in preview
builds (`VITE_ENABLE_DESIGN_SYSTEM_LAB=true`) so `/__design-system` is reachable without a login.

**Why this is P0.** Every decision above is a visual change, and until 2026-08-23 the standing
belief in this project was that local visual verification was impossible because `vite build`
crashed. **That is false and was measured false today:** `vite dev` crashes in the rolldown
dependency optimiser, but `vite build` completes in **735 ms**, `vite preview` serves it, and
Playwright renders it (HTTP 200, correct type, fonts loaded). The env export is required because
`vite.config.ts:15` reads `process.env` directly rather than Vite's `loadEnv`, so a bare
`vite build` throws *"Production web build is missing: VITE_SUPABASE_*"* despite `apps/web/.env`
existing.

**Known limit, stated rather than assumed.** Both local preview and the deployed app stop at the
login wall; anything behind auth needs credentials. `/__design-system` is the unauthenticated
surface, which is precisely why enabling it in preview matters — and why the lab should be extended
to render the *real* `DataTable` rather than the raw `<table>` it uses today (`DesignSystemLabPage.vue:169`).
Do that as part of D-DS1 so the alignment fix is visible without logging in.

**Done-when.** One command produces a URL; `/__design-system` renders the real primitives; the
`vite dev` crash is documented as environmental in `apps/web/CLAUDE.md` so no future session
re-diagnoses it.

---

### D-DS14 — Keep the gate-first model. Do not buy the 2026 sales pitch.

**Decision.** Governance stays as it is: deterministic Node scripts, run in CI, that read their
vocabulary from the token file. Extend them (D-DS7). Do **not** adopt AI-agent "design drift
detection", Figma-sync tooling, or a hosted design-system platform.

**Why say this out loud.** The 2026 literature is loud about AI agents that *"scan production
codebases for snowflake components… detecting drift as it happens"* and design systems as *"a
dataset that trains local AI agents"* ([Supernova][sn], [digitalapplied][da]). Some of that is real
and some is vendor positioning, and the distinction matters here for a specific reason: this repo
already has the thing those tools approximate. `lint:ui-adoption` counts raw `<button>`/`<input>`/
`<select>`/`<table>` in pages and features and returns **0**. `lint:tokens` returns clean.
`lint:tokens-parity` proves single ownership of 259 declarations. A probabilistic detector would be
a downgrade from a deterministic one that already passes.

**What the outside practice *is* worth taking.** Three things, all adopted above: the DTCG format
(D-DS3), the top-layer/layer-token model (D-DS4), and the component-token tier for things like
column widths (D-DS5). Those are format and architecture decisions where being on the standard has
compounding value. Tooling that watches the code is not, because the code is already watched.

**On the design plugins installed 2026-08-23** (`frontend-design`, `ui-ux-pro-max`, `impeccable`):
treat their output as *proposals*, never as licence. Their advice is generic — palettes, font
pairings, spacing scales — and this system's vocabulary is closed and enforced. A suggestion that
cannot be expressed in `tokens.css` roles is a suggestion to change `tokens.css`, which is a
decision, not an edit.

---

### D-DS15 — Identity: blue primary, warm soft purple accent, soft gray neutrals. Gold is retired.

**Decision, from the owner 2026-08-23:** *"we should go with blue and warm soft purple colors as
main, and also with some soft gray colors."* This answers Q1: the redesign changes identity, not
only its application.

#### The two collisions this creates, and how they resolve

Blue and purple were **both already spoken for** in this system. `tokens.css` states the principle
explicitly — *"identity, interaction, links, selection, and focus are deliberately separate"* — and
that separation exists precisely because gold could not serve as an action colour. A blue identity
removes the reason for the separation, and a purple accent lands on a chart encoding.

| Collision | Today | Resolution |
|---|---|---|
| **Blue is `--link`, `--link-hover`, `--focus-ring`** (hue 255) | separate from gold identity | **Collapse.** Brand blue *becomes* link and focus. This is the normal enterprise pattern; the separation was a workaround for gold. |
| **Blue is `--action-primary`** (graphite, hue 260, chroma 0.055) | "gold is identity, graphite is action" | **Collapse.** Blue is now both. Primary buttons go graphite → blue. |
| **Blue is the whole `info` ramp** (hue 254) | info status | **Move info to teal** (hue 208–215). Keeps info legible as a *status* next to a blue brand, and teal is arguably a better fit for `--viz-cost-reefer` (refrigeration) anyway. |
| **`--viz-cost-reefer` = `info-700`** | blue | **Repoint to `brand-700`**, not to the new teal — otherwise it collides with `--viz-spend` emerald under deuteranopia. Verified: cost palette deutan separation stays 0.159. |
| **Purple is `--viz-severity-high`** — chosen *because* it is CVD-separated from critical red | oklch(49.6% 0.265 301.9) | **Keep purple, move it away from the accent**: hue 302 → **295**, staying a saturated violet against a soft mauve accent at 315. Δ20° plus a 2× chroma difference. |
| **`--viz-brand`** (the MPG line) was gold | gold | → **accent-600 purple**, so the identity still reads as ours in charts without colliding with reefer blue. |

#### The unplanned dividend: the driver app is already this blue

`apps/driver` has shipped `--color-brand: 29 78 216` since Design System 2.0 (2026-08-07). Converted:

```
driver brand rgb(29 78 216) = oklch(48.8% 0.217 264.4)
candidate --ramp-brand-700  = oklch(48.8% 0.217 264.4)   ← snapped to be identical
```

The candidate was independently tuned to `oklch(48.5% 0.188 265.0)` and then snapped to the driver's
exact value once the proximity was noticed — ΔL was 0.3pp and ΔH 0.6° before snapping. **The two
surfaces now share one brand blue,** which is a real argument for D-DS3 that did not exist when
D-DS3 was written: the shared DTCG layer now has a genuinely shared value to hold, not just a shared
vocabulary. Contrast improved slightly on snapping (`link / surface` 6.70 → 6.71, `action foreground`
4.97 → 5.08).

#### The values, validated

Every value below was checked against **the repo's own gate maths**, copied out of
`scripts/check-ui-contrast.mjs` and `scripts/check-chart-colors.mjs` rather than reimplemented:

- **29 contrast pairs pass** — the 22 the gate checks today, plus 7 that a blue/purple identity makes load-bearing (brand tint, accent tint, white-on-accent, link-on-selected, …). Worst margin: `success status / tint` at 4.72:1 against a 4.5 floor.
- **Both CVD chart palettes pass.** Severity: protan 0.122 / deutan 0.118 / tritan 0.113 (floor 0.100). Cost: 0.300 / 0.159 / 0.159.
- **Gamut: 15 of 78 values exceed sRGB, worst overshoot 0.0700.** Today's palette is *worse* — 29 of 99, worst 0.1423 (`--ramp-caution-300`). Out-of-sRGB oklch is deliberate and normal here; browsers gamut-map it.
- One real failure was found and fixed during tuning: `--brand-accent-strong` at L 0.59 carried white text at only **4.37:1**. Solved by darkening to L 0.57 → 4.75:1.

```css
  /* brand = blue — identity, action, link, focus */
  --ramp-brand-50: oklch(97.2% 0.014 258);
  --ramp-brand-100: oklch(93.5% 0.033 258);
  --ramp-brand-200: oklch(88.5% 0.06 259);
  --ramp-brand-300: oklch(81.5% 0.105 260);
  --ramp-brand-400: oklch(71.5% 0.155 262);
  --ramp-brand-500: oklch(63.0% 0.192 263);
  --ramp-brand-600: oklch(55.2% 0.224 264.2);
  --ramp-brand-700: oklch(48.8% 0.217 264.4);
  --ramp-brand-800: oklch(42.4% 0.18 265);

  /* accent = warm soft purple */
  --ramp-accent-50: oklch(97.5% 0.012 322);
  --ramp-accent-100: oklch(94.5% 0.028 322);
  --ramp-accent-200: oklch(90.0% 0.052 321);
  --ramp-accent-300: oklch(83.5% 0.082 320);
  --ramp-accent-400: oklch(75.5% 0.11 318);
  --ramp-accent-500: oklch(67.0% 0.128 316);
  --ramp-accent-600: oklch(57.0% 0.134 315);
  --ramp-accent-700: oklch(50.5% 0.122 314);
  --ramp-accent-800: oklch(43.5% 0.102 313);

  /* neutral = soft gray */
  --ramp-neutral-50: oklch(98.6% 0.002 300);
  --ramp-neutral-100: oklch(96.8% 0.004 300);
  --ramp-neutral-200: oklch(93.0% 0.006 300);
  --ramp-neutral-300: oklch(87.5% 0.009 300);
  --ramp-neutral-400: oklch(71.5% 0.016 300);
  --ramp-neutral-500: oklch(56.0% 0.02 300);
  --ramp-neutral-600: oklch(45.5% 0.022 300);
  --ramp-neutral-700: oklch(38.0% 0.024 300);
  --ramp-neutral-800: oklch(28.5% 0.022 300);
  --ramp-neutral-900: oklch(21.5% 0.02 300);

  /* info moves blue -> teal */
  --ramp-info-50: oklch(97.5% 0.015 215);
  --ramp-info-100: oklch(93.8% 0.035 213);
  --ramp-info-200: oklch(89.0% 0.062 212);
  --ramp-info-300: oklch(82.0% 0.098 211);
  --ramp-info-400: oklch(72.5% 0.128 210);
  --ramp-info-500: oklch(64.5% 0.138 209);
  --ramp-info-600: oklch(56.0% 0.132 208);
  --ramp-info-700: oklch(48.0% 0.115 208);
  --ramp-info-800: oklch(41.0% 0.098 208);

  /* roles */
  --canvas: oklch(98.5% 0.003 300);
  --surface-subtle: oklch(98.2% 0.004 300);
  --surface-muted: oklch(94.5% 0.008 300);
  --surface-navigation: oklch(96.8% 0.007 300);
  --surface-inverse: oklch(23.5% 0.022 300);
  --ink: oklch(29.0% 0.02 295);
  --ink-secondary: oklch(44.0% 0.022 297);
  --ink-muted: oklch(50.5% 0.02 298);
  --ink-tertiary: oklch(51.5% 0.019 298);
  --ink-subtle: oklch(63.0% 0.017 300);
  --edge-subtle: oklch(92.5% 0.006 300);
  --edge: oklch(87.0% 0.009 300);
  --edge-strong: oklch(64.0% 0.017 300);
  --edge-control: oklch(63.5% 0.018 300);
  --brand-accent: oklch(83.5% 0.082 320);
  --brand-accent-soft: oklch(90.0% 0.052 321);
  --brand-accent-strong: oklch(57.0% 0.134 315);
  --action-primary: oklch(55.2% 0.224 264.2);
  --action-primary-hover: oklch(48.8% 0.217 264.4);
  --link: oklch(48.8% 0.217 264.4);
  --link-hover: oklch(42.4% 0.18 265);
  --focus-ring: oklch(55.2% 0.224 264.2);
  --selected-surface: oklch(93.5% 0.033 258);
  --selected-strong: oklch(55.2% 0.224 264.2);

  /* charts that move */
  --viz-brand: oklch(57.0% 0.134 315);
  --viz-severity-high: oklch(49.6% 0.265 295);
  --viz-cost-reefer: oklch(48.8% 0.217 264.4);
```

`--ramp-accent-*` is a **new ramp**; the gold `--ramp-brand-*` values are deleted, not renamed.
`danger`, `caution`, `warning`, `success` are untouched.

#### One thing that does not pass, and why it is not a blocker

The six status badge fills (`danger`/`caution`/`warning`/`success`/`info`/`brand`) score
protan 0.028, deutan 0.011, tritan 0.046 — below the 0.100 the chart gate would demand. **This is
pre-existing and today's set is worse** (protan 0.008, deutan 0.011, tritan 0.041); the candidate
improves all three. It is correctly not gated, because badges are never colour-only: every one
carries a text label, which is what WCAG 1.4.1 asks for. Recorded here so a future session does not
"discover" it and assume the new palette caused it.

#### Deliberately deferred

**Dark values.** D-DS15 specifies the light scheme only. The dark half is D-DS2's job and lands in
the same pass (phase 4) — do not derive it separately.

**Verification.** A specimen was rendered at 1440×1180 in Hanken Grotesk at FuelGuard's real
densities — sidebar, page header, stat cards, a data table with D-DS1's alignment applied, badges,
buttons with a visible focus ring, all three ramps and both chart sets. Reproduce with
`scratchpad/specimen.mjs`; the values live in `scratchpad/palette.mjs` and the gate replica in
`scratchpad/validate.mjs`.

**Done-when.** `pnpm lint:ui-contrast` and `pnpm lint:chart-colors` pass against the new values in
both schemes; no `--ramp-brand-*` value is gold; `grep -r 'gold' packages/ui apps/web/src` returns
only historical comments.

**Risk.** This is the largest single visual change in the document — every surface moves at once.
It is also why it must land in one pass with dark mode (phase 4) rather than being trickled in:
a half-blue, half-gold product is worse than either.

---

## 2. Sequence

Each phase is independently shippable and independently revertable. **One PR per decision** —
these are visual changes and a mixed PR makes a regression untraceable.

| Phase | Decisions | Why this order |
|---|---|---|
| **0 — See it** | D-DS13 | Nothing below can be verified without it. Half a day. |
| **1 — Stop the bleeding** | D-DS1, D-DS9 (the media-query half only) | Two defects shipping today. Independent of everything else. |
| **2 — Widen the gates** | D-DS7, D-DS6, D-DS5, D-DS4 | Each gate ships with its violations already fixed. Order within the phase: radius/shadow → text → layer → width. |
| **3 — Pipeline** | D-DS3 | ⚠ **Moved earlier** — see below. Round-trip **today's** palette byte-identical, before it changes. |
| **4 — Identity + dark, one pass** | D-DS15, D-DS2, D-DS10 | Both are rewrites of the same role layer. Doing them separately means rewriting it twice. |
| **5 — Consolidate** | D-DS8, D-DS12 | Reduces the surface a redesign has to touch. |
| **6 — Redesign** | D-DS11 rides along; D-DS9 (component extraction) | Layout, density, motion. Colour is already done by phase 4. |

**⚠ Revision, 2026-08-23.** The original sequence put the token pipeline *last*, reasoning
"round-trip against a token file that has stopped moving." D-DS15 inverts that argument: the file is
now definitely moving, so the pipeline must exist **before** the identity change, or the same
rewrite gets done twice — once by hand in CSS and again in DTCG. Build the pipeline against today's
gold palette, prove byte-identical output, *then* change the values inside DTCG where both surfaces
see them.

**Do not start phase 6 before phase 4.** A redesign on a single-theme token layer is a redesign that
gets done twice.

---

## 3. What was considered and rejected

| Rejected | Why |
|---|---|
| Unify driver + web token **values** | The divergence is a documented product decision (`DRIVER-APP-DESIGN-SYSTEM-2.md`, 2026-08-07), not drift. Share the schema (D-DS3), not the palette. |
| Migrate contrast gate to **APCA** | Not normative; removed from WCAG 3 in 2023; WCAG 3 ~2030. WCAG 2.2 AA is the legal floor. Advisory only. |
| **CSS Anchor Positioning** now | Baseline Newly Available early 2026, ~91% traffic. Take the top-layer win (D-DS4); keep `@floating-ui/vue` for positioning until Widely Available. |
| **`contrast-color()`** / `@container style()` theming | Moves the foreground choice into the browser and out of `lint:ui-contrast`. Revisit when the gate can evaluate it. |
| **`.dark` class** + `@custom-variant` (what `tokens.css` proposes) | Predates `light-dark()`. The class approach duplicates every variable and does not fix native controls. |
| Delete `text-[11px]` and fold to `text-xs` | 11 consistent uses for one job is a missing tier, not indiscipline. Name it (D-DS6). |
| Delete `BADGE_BASE`/`toneClass` in favour of `AppBadge` | Not duplicates — one is a component, one is a domain vocabulary with 254 lines of mapping. Compose them. |
| Migrate Headless UI → Reka UI **now** | D-DS4 rewrites the same 4 files and may remove the dependency entirely. |
| AI-agent drift detection / design-system platform | The deterministic gates already return 0 violations. A probabilistic detector is a downgrade. (D-DS14) |
| Copy patterns from `TemplatesTailwind/` | 13 MB of vendored Tailwind UI at repo root, gitignored. Its palette and radius vocabulary are not ours and no gate stops a paste from drifting. |

---

## 4. Open questions — with the fallback the code takes until answered

Nothing above is blocked on these. Each has a decided default.

| # | Question | Owner | Fallback until answered |
|---|---|---|---|
| ~~Q1~~ | ~~Does the redesign change the brand identity?~~ | **Answered 2026-08-23** | **It changes.** Owner: *"blue and warm soft purple colors as main, and also with some soft gray colors."* → **D-DS15**. |
| Q2 | Is dark mode a **user preference** or **system-follow only**? | Owner | Ship system-follow + a manual toggle (D-DS2 build step 5). Cheaper to remove the toggle than to add it later. |
| Q3 | Does `apps/admin` get the redesign too? | Owner | Yes by construction — it imports the same tokens. If not, it needs its own theme file in D-DS3. |
| Q4 | 11px floor: does any `text-2xs` instance carry **unique** information? | Verify during D-DS6 | If yes, that instance moves to `text-xs`; the token still ships for the rest. |
| Q5 | Should the `--prototype-*` lab tokens survive at all after D-DS2? | Decide during D-DS2 | Gate the lab to light mode; do not dark-theme a dev surface. |
| Q6 | Driver app: adopt **nativewind 5** (Tailwind v4) to align the two Tailwind majors? | Owner | No. nativewind 5 is preview (`5.0.0-preview.4`); 4.2.6 is stable. D-DS3 makes the Tailwind major irrelevant to token sharing anyway. |

---

## 5. Facts a future session should not re-derive

- **`vite dev` is broken on this machine; `vite build` is not.** Rolldown WASM failure in the dependency optimiser, reproduced on Node 23.6.0, 26.7.0 and again 2026-08-23. `vite build` completes in 735 ms. Use D-DS13's `preview:local`.
- **`vite.config.ts` reads `process.env`, not `loadEnv`.** `apps/web/.env` must be exported into the shell or a production build throws.
- **`pnpm lint` reports ~701 eslint errors that are not yours.** All 32 offending files are under `.claude/worktrees/`, a stale repo copy. Filter the path before believing a lint failure.
- **`numeric: true` does not right-align.** It adds `tabular-nums` only — until D-DS1 lands.
- **The design lab renders a raw `<table>`, not `DataTable`** (`DesignSystemLabPage.vue:169`), so it will not show D-DS1's effect until D-DS13 fixes it.

---

## 6. Files these decisions touch

Listed so a fresh session can scope a PR without searching.

| Decision | Files |
|---|---|
| D-DS1 | `apps/web/src/components/ui/DataTable.vue`, `apps/web/CLAUDE.md`, 11 column-definition sites |
| D-DS2 | `packages/ui/src/tokens.css`, new `apps/web/src/composables/useColorScheme.ts`, `apps/web/src/features/dashboard/chartTheme.ts`, `scripts/check-ui-contrast.mjs` |
| D-DS3 | new `packages/tokens/`, `packages/ui/src/tokens.css`, `apps/driver/src/theme/theme.roles.json`, `apps/driver/src/theme/tokens.ts`, `package.json` (gen + lint) |
| D-DS4 | `components/KebabMenu.vue`, `VehicleSelect.vue`, `ToastContainer.vue`, `components/ui/{FilterBar,FilterSelect,BaseModal}.vue`, `layouts/SidebarFlyoutSection.vue`, 3 pages with `z-[1]` sticky cells |
| D-DS5 | `apps/web/src/components/ui/DataTable.vue` + 26 files passing `headerClass` |
| D-DS6 | `packages/ui/src/tokens.css`, 13 call sites |
| D-DS7 | `apps/web/scripts/check-design-tokens.mjs`, `scripts/ui-system-inventory.mjs` |
| D-DS8 | `packages/ui/src/index.ts`, `packages/ui/src/components/`, `apps/web/src/components/ui/`, ~120 import sites |
| D-DS9 | `apps/web/src/style.css`, `apps/web/src/layouts/AppShell.vue` |
| D-DS10 | `scripts/check-ui-contrast.mjs` |
| D-DS11 | 4 files importing `@headlessui/vue`, `apps/web/package.json` |
| D-DS12 | `docs/DESIGN-SYSTEM-CONTRACT.md`, delete `docs/DESIGN-SYSTEM.md`, `apps/web/CLAUDE.md` |
| D-DS13 | `apps/web/package.json`, `apps/web/src/dev/DesignSystemLabPage.vue`, `apps/web/CLAUDE.md` |

---

## 7. The gate list these decisions must keep green

Measured green 2026-08-23 before any of this: `typecheck`; `test` (web 473, api 1989, 22 PGlite
matrices, 0 failed); `lint:tokens-parity`; `lint:ui-adoption`; `lint:ui-contrast`;
`lint:chart-colors`; web `lint:tokens`; driver `lint:tokens` and `lint:design`; `lint:filesize`;
`lint:funcsize`; `lint:boundaries`. Each decision above adds to this list; none may subtract.

---

## 8. Sources

Repository facts are cited inline with the command that measured them (§0). Outside practice:

- [Design Tokens Community Group — Format Module v2025.10][dtcg] · first stable spec, 28 Oct 2025
- [Design Systems in 2026: Scale UI Without the Chaos][da] · adoption figures, CI linting practice
- [Design Token Architecture 2026 — Timothy Graf][graf] · three-tier token model
- [MDN — `light-dark()`][mdn-ld] · Baseline Newly Available, May 2026
- [una.im — Modern CSS theming with `light-dark()`, `contrast-color()`, style queries][una] · macro/micro theming, elevation in dark
- [MDN / Baseline — Popover API][popover] · Baseline since 2024
- [CSS Anchor Positioning in 2026][anchor] · Baseline Newly Available, ~91% traffic
- [Chris' Corner — Layers of Layers, CodePen 2026-06-29][cp] · the ladder-of-5 rule
- [OutSystems UI Layer System][os] · named layer tiers at scale
- [WCAG 3 Contrast as of April 2026 — Adrian Roselli][ros] · APCA removed 2023; algorithm undetermined
- [The APCA Mirage — accessibility.chat][ac] · WCAG 2.2 AA as the operative benchmark
- [Enterprise data tables — Pencil & Paper][pp] · alignment convention
- [Carbon Design System — number alignment][carbon] · same, from a shipped enterprise system
- [Web Typography: Designing Tables to be Read — A List Apart][ala] · left words, right numbers
- [Supernova — The Future of Enterprise Design Systems: 2026][sn] · snowflake components, agent governance claims
- [UXPin — What Are Design Tokens? (2026)][uxpin] · global / alias / component tiers
- npm registry, checked 2026-08-23: `@headlessui/vue` 1.7.23 stable (insiders-only since), `reka-ui` 2.10.3 (2026-08-10), `style-dictionary` 5.5.2 (2026-08-19), `nativewind` 4.2.6 stable / 5.0.0-preview.4

[dtcg]: https://www.designtokens.org/
[da]: https://www.digitalapplied.com/blog/design-systems-2026-scale-ui-without-chaos-methodology
[graf]: https://timgraf.com/ui/design-token-architecture-2026-the-strategic-blueprint-for-scalable-design-systems/
[mdn-ld]: https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark
[una]: https://una.im/modern-css-theming/
[popover]: https://developer.mozilla.org/en-US/docs/Web/API/Popover_API
[anchor]: https://www.nexgismo.com/blog/css-anchor-positioning-replace-javascript-tooltip-library-2026
[cp]: https://blog.codepen.io/2026/06/29/chris-corner-layers-of-layers/
[os]: https://medium.com/@bernardocardoso/outsystems-ui-layer-system-managing-z-index-at-scale-68dca9e543de
[ros]: https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html
[ac]: https://www.accessibility.chat/articles/the-apca-mirage-why-premature-wcag-3-adoption-creates-legal-risk
[pp]: https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables
[carbon]: https://github.com/carbon-design-system/carbon-website/issues/3831
[ala]: https://alistapart.com/article/web-typography-tables/
[sn]: https://www.supernova.io/blog/the-future-of-enterprise-design-systems-2026-trends-and-tools-for-success
[uxpin]: https://www.uxpin.com/studio/blog/what-are-design-tokens/
