# Design refresh 2026-09 — the comps, and what it actually takes to reach them

**Status:** DR1, DR2, DR3, DR4, DR5, DR6 and D-DR17 all shipped (`main` `7e7842c`).
**Next:** DR7, `OperatingMetricsWidget`'s truncation, D-DR8, DR5's three §7 follow-ups; then DR2b
and DR4b, which are blocked on data and on a feature rather than on design.
Handoff: `HANDOFF-2026-09-16-DESIGN-REFRESH.md` — read it, then §7 below.
**Owner:** Miki. **Opened:** 2026-09-16.
**Source of the direction:** seven comps in `docs/design examples/`, commissioned by the owner and
approved as the target on 2026-09-16.

This is a decision-log document, not a checklist. Read §1 before arguing with §3 — most of the
"redesign" turns out to be four tokens and one component's anatomy, and the parts that genuinely are
new work are named in §4 so nobody rediscovers them.

Companion documents, both still canonical and NOT superseded by this one:
`docs/DESIGN-SYSTEM-CONTRACT.md` (the rules a component must satisfy) and
`docs/plans/design-system/DESIGN-SYSTEM-2026.md` (D-DS1..15, the token architecture this rests on).

---

## 0. The comps, and which one is the target

Seven images, all generated 2026-09-15. They are not one design; they are five light dashboards, one
light live-map, and one dark full-bleed live-map. Naming them, because "the mock" is ambiguous and
three of them disagree with each other:

| file (abbrev.) | surface | what it contributes |
|---|---|---|
| `…11_08_54 PM (1)` | Dashboard | hero band + greeting; operating-metrics grid with icon chips |
| `…11_08_54 PM (2)` | Dashboard | right rail — live activity feed + fleet-health donut |
| `…11_08_55 PM (3)` | Dashboard | **the reference for DR1–DR3.** KPI anatomy, donut, chart cards |
| `…11_08_55 PM (4)` | Dashboard | dark theme; gradient chart fills |
| `…11_08_55 PM (5)` | Dashboard | breadcrumbs; "Top fleet issues" ranked list |
| `…11_10_07 PM` | Live map | light; map card + side rail + fleet list beneath |
| `…11_10_15 PM` | Live map | **the reference for DR5.** Full-bleed dark map, floating panels |

**D-DR0 — comp (3) is the canonical light reference and comp (7) the canonical live-map
reference.** The others are read for individual ideas, listed above, and are not implemented as
whole screens. Where two comps disagree (comp 2 puts a rail on the dashboard, comp 3 does not) comp
3 wins, because the rail is a layout decision the LM10 dashboard-layout editor already owns and a
second mechanism for it would be a workaround.

⚠ **The comps are illustrations, not specifications.** They were generated, so their numbers are
decorative: comp (3) shows "312 total vehicles" against a 220+48+24+12+8 = 312 donut that happens to
add up, and comp (7) shows "171 trucks" with 16+17+111+27 = 171. Both are coincidences of a good
generator, not data. Nothing in them is a product commitment — in particular the Ask AI "Beta"
badge, the "Quick Action" button, `Compare`, `Add widget`, the weather card and the fleet-health
score are DRAWN, not decided. Where this plan adopts one it says so; everything else is scenery.

---

## 1. What the gap actually is — measured 2026-09-16

The working belief going in was "the comps are a different design system". They are not. Sampling
comp (3)'s PNG and converting to OKLCH against `packages/tokens/src/roles.light.json`:

| role | ours | comp (3) | delta |
|---|---|---|---|
| `surface` | `oklch(100% 0 0)` | `oklch(100% 0 0)` | none |
| `canvas` | `oklch(97.6% 0.0013 286.4)` | `oklch(97.5% 0.0045 258.3)` | lightness identical |
| `selected-surface` | `oklch(93.5% 0.0312 258)` | `oklch(93.7% 0.0283 292.4)` | L and C identical; **hue +34** |
| `action-primary` | `oklch(55.2% 0.224 264.2)` | `oklch(52.1% 0.2295 285.1)` | C identical; **hue +21** |

**D-DR1 — the entire colour gap is one number: the brand hue, +21°, indigo → violet.** Lightness
and chroma were already right, which is why the comps read as "our product, better" rather than as
someone else's product. This is also why it is safe: a hue rotation at constant L and C cannot
break a contrast ratio, so no WCAG pair that passes today can fail afterwards.

A second, smaller finding falls out of the same measurement: **our neutrals already sit at hue 286**
— `ink`, `canvas`, every `edge`. The brand at 264 was the odd one out. Rotating brand to 285 puts
brand and neutral in the same hue family for the first time.

### 1.1 Radius and elevation — the part that is NOT colour

Corner arcs measured off both PNGs at 10× (`scratchpad/corner_zoom.png`), because a heuristic that
walks pixels gets defeated by the shadow's anti-aliasing — the same lesson as
`measure-packet-coordinates-by-looking`:

- comp (3) card radius ≈ **10–12px**. Ours is **6px** (`shape-surface: 0.375rem`).
- Ours reads as *outlined*: a hard 1px `ring-edge-subtle` over a `0 1px 2px` shadow at 5% ink — the
  line does the work. The comp's card has almost no visible ring and a soft, wide shadow; the
  **shadow** does the work.

**D-DR2 — the whole shape scale roughly doubles, and the card's edge moves from the ring to the
shadow.** Not just `shape-surface`: a 12px card containing 4px buttons looks like a mistake, so the
scale moves together. `shape-detail` 3→6, `shape-control` 4→8, `shape-surface` 6→12,
`shape-overlay` 8→14, `shape-dialog` 10→16.

### 1.2 Sidebar

Ours: `surface-navigation` at 95.6% — **darker** than the 97.6% canvas. Comps (1),(3),(5): the rail
is `#f8fafd` = 98.4%, **lighter** than a slightly tinted page. **D-DR3 — the rail sits above the
canvas, not below it.** One token.

---

## 2. Why tokens only get ~30% of the way

DR1–DR3 were prototyped on 2026-09-16 and rendered against the real app. The before/after/comp strip
is in `scratchpad/kpi_compare.png`. The verdict: softer and on-brand, and still visibly not the comp,
because **comp (3)'s KPI tile is a different anatomy**, not a differently-coloured one:

| | ours today | comp (3) |
|---|---|---|
| icon | top-**right**, 36px, `rounded-surface` | top-**left**, ~40px, `rounded-overlay`, stronger tint |
| label | above the value | beside the icon |
| delta | a coloured `sub` line (`subTone`) | a **pill** — `↓ 6.4%` on a tinted fill |
| sparkline | full width, **below** | inline, **right**, vertically centred |

The good news, and the reason the owner's "we can do this relatively easily" instinct was right:
`StatCard.vue` already carries `icon`, `tone`, `spark`, `sparkColor` and `subTone`. The sparklines
are absent from our screenshots only because dev-bypass data is all zeros, and `SparkLine.vue`
already draws the gradient area fill and the terminal dot the comp shows — that part of the comp is
**positional only**. What is missing is the delta **pill** and the horizontal arrangement.

⚠ **Correction, 2026-09-16 — "one file, five consumers" was wrong. `StatCard` has 17.** Counted:
`size="hero"` is used by exactly **two** (`KpiHeroWidget`, `FleetHeadlines`) and the default
`size="kpi"` by **fourteen**. That is what makes DR2 safe: the comp's anatomy is the *hero* anatomy,
so changing it touches two surfaces, and the fourteen are not in the blast radius at all. Had the
count gone the other way this step would have needed a different shape.

---

## 3. The steps

One step per PR, per this repo's convention. A step is not done until it has been looked at in a
browser — DR1 exists because a unit test cannot see a radius.

| # | step | scope | gate risk |
|---|---|---|---|
| **DR1** | Tokens: brand hue, shape scale, card elevation, sidebar lift | `packages/tokens/src/*.json` + regen | `lint:token-gamut`, `lint:tokens-parity`, `lint:token-schema`, `lint:codegen` |
| **DR2** | `StatCard` hero anatomy — chip left, bold value, optional inline spark | 1 component, 2 hero consumers | `lint:comment-claims`, `lint:ui-adoption` |
| **DR2b** | The delta pill, **and the previous-period data it needs** | `useDashboard` + a new primitive | performance — see below |
| **DR3** | Chart theme: gradient area fills, rounded bars, softer grid | `features/dashboard/chartTheme.ts` | `lint:chart-colors` |
| **DR4** | Sidebar chevron; dashboard greeting + hero band | `SidebarNavSection`, `PageHeader`, `DashboardPage` | `lint:ui-adoption`, design-tokens |
| **DR4b** | Top-bar global search (⌘K) | **a feature, not a style** — see D-DR16 | — |
| **DR5** | **Live map → full-bleed workspace** (§4) | `LiveMapPage`, `LiveMapPanel`, `AppShell` | accessibility, `lint:funcsize` |
| **DR6** | Imagery: hero plates via Higgsfield (§5) | `apps/web/public/` | none |
| **DR7** | Roll the DR1–DR3 anatomy across the other pages | broad | `lint:ui-adoption` |

**D-DR12 — the delta pill is split out as DR2b, because the data it displays does not exist.**
Discovered while building it, 2026-09-16. Every KPI tile in comp (3) carries a delta — `↓ 6.4%`,
`↑ 2.1%` — and **the dashboard has no period comparison of any kind**: `useDashboard` runs eight
range-scoped queries and never fetches a previous window, and `fleetWidgetData.ts` has no
`previous`/`prior`/`delta` anywhere. Shipping a pill against invented or blank values is the same
mistake as D-DR7's always-empty ETA field, so the pill waits for the data rather than the data
waiting for the pill.

Two things make DR2b more than plumbing, and they are why it is not folded back into DR2:

- **Cost.** A previous-period delta means running that eight-query composite a second time, per
  range change. Whether that is one more round trip or a server-side aggregate is DR2b's first
  decision, not an afterthought.
- **"Active alerts" cannot have one at all.** `useDashboard`'s own comment says the alert figures
  are CURRENT-STATE, not range-scoped. A delta on that tile is not a missing feature, it is a
  category error — comp (3) draws one anyway, which is the clearest single proof that these comps
  are illustrations (§0).

`FleetHeadlines` is the only surface today holding real change data (`lib/periodChange.ts`,
`percentChange`/`changeTone`), and it is deliberately **not** being converted: its captions are
sentences — "−47.7% vs June $123,456", plus honest fallbacks for a quarter or a missing month —
written long at D-FRUI3 because that page's reader is a non-native speaker. Flattening those into a
terse chip would throw away the work, not finish it.

**D-DR4 — the delta pill is NOT a badge.** `lib/badges.ts` is the STATUS vocabulary and D-UI5
already ruled that a badge used as something other than a status teaches the badge to mean two
things. A period-over-period delta is a measurement, so it gets its own primitive
(`DeltaPill`/`AppDelta`), and it keeps `StatCard`'s existing `subTone` reasoning: **up is bad for
spend and good for MPG, so only the caller knows which way is which.** The pill takes a direction
and a tone, it does not infer one.

---

### 3.1 DR4's rulings

**D-DR13 — the section chevron trails its label instead of leading it** (owner's ruling,
2026-09-16). Leading, it sat in the same column as the nav items' *icons* one row below — two
different meanings sharing a column, so the eye read it as a section icon rather than as a control.
The collapsed-section badge stays *before* the chevron: when a section is shut the badge is the only
thing still reporting from inside it, and a count that jumps outboard when the section closes is a
moving target. One component serves both the desktop rail and the mobile drawer, so this is one edit.

**D-DR14 — the dashboard greets its reader rather than captioning itself "Dashboard".** The sidebar
already says which page this is and `route.meta.title` still does for the browser tab, so the h1 was
spending the most prominent line on the page repeating the navigation. `lib/greeting.ts` is pure and
separate because it depends on the clock, which is the one thing a rendered test cannot pin without
freezing time. Two details that are decisions rather than defaults: **only the first name** is used
(a greeting that reads "Good morning, Miroslav Jokovic" is addressing a record, not a person), and
**the comma belongs to the name branch** — `session.fullName` is legitimately null before `/api/me`
returns, and "Good morning," with a trailing comma reads as a bug where "Good morning" does not.
Midnight–04:59 counts as evening rather than earning a fourth day-part: dispatch runs overnight and
someone reading this at 02:00 is finishing a day, not starting one.

**D-DR15 — the hero plate is a PROPERTY of `PageHeader`, not a second header component.** The comps
draw breadcrumbs, an h1, a subtitle and right-aligned actions over the plate — which is
`PageHeader`'s exact existing anatomy, already carrying G2's breadcrumb trail. A `HeroBanner`
beside it would re-derive the trail and re-declare the actions slot, and would become a second place
where "what a page header is" gets decided. The plate is a background, so it is a property of the
header rather than a different kind of header.

⚠ The plate is **masked, not overlaid with a gradient**. A gradient needs a *colour*, which would
have to be `--surface` and would be wrong the moment the band sat on anything else; a mask fades the
image to transparent and lets whatever is behind show through. It also means no colour token is
involved, so the band cannot drift from the palette. The `black` inside the mask's gradient is an
alpha stop, not a colour — nothing paints it.

**D-DR17 — the 1280px truncation WAS a DR2 regression, and this entry is the second correction of
it.** Worth reading in full, because the process failure is more instructive than the CSS.

At 1280px `xl:grid-cols-4` makes each KPI tile 220px. DR2's inline sparkline reserved `w-2/5` of the
tile unconditionally, leaving the label 61px to render "Fleet avg MPG", which needs 91 — so it
truncated to "Fleet a…".

What went wrong twice:

1. It was first written up as a regression, correctly, on a hunch about the bigger left chip.
2. It was then **withdrawn** as pre-existing, on the strength of building `main` and seeing the same
   truncation. That comparison was worthless: `main` had contained DR2 since #819 merged, so both
   sides of the "comparison" had the defect. Rebuilding at `8275964` — the commit *before* DR2 —
   settles it: every label reports `scrollWidth - clientWidth === 0` there, and 7px and 30px short
   after. **Comparing against `main` proves nothing once the change you are testing is in `main`.**
3. Only measuring the DOM, rather than reading a screenshot, produced a number anybody could check.

The fix is `flex-wrap` plus a `min-w-32` floor on the label column, **not a viewport breakpoint**.
This is a CONTAINER question and a viewport rule inverts it: the same tile is 410px wide in the
two-up grid at 900px and 220px in the four-up at 1280px, so "inline above `xl`" would switch the
inline layout on exactly where it does not fit and off where it does. Measured after: inline at a
325px tile, wrapped at 220px, no truncation at either.

⚠ `OperatingMetricsWidget`'s own "Telematics co…" truncation at the same width **is** genuinely
pre-existing and is NOT fixed here — that one is an eight-up grid with no sparkline in it, a
different defect that happens to share a viewport. Its own step.

**D-DR16 — the comps' ⌘K search bar is a FEATURE, and is not in DR4.** Checked 2026-09-16: there is
no command palette, no global search component and no search endpoint anywhere in `apps/web`. The
comps put "Search drivers, trucks, loads, or anything…" across the top of every screen, which means
a cross-entity index and a ranking decision — not a header layout. Drawing a search box that opens
nothing would be the same mistake as a delta over data we do not have (D-DR12). It becomes DR4b,
sequenced on its own merits rather than smuggled in behind a design refresh.

---

## 4. DR5 — the live map becomes a workspace, not a document

This is the step that deserves the most design and the least hurry, because it changes a page
*archetype* rather than a page.

**Today** (`LiveMapPanel.vue`): a vertical document — callout, `FilterBar`, a map inside a
`BaseCard`, a `DataTable` of 199 rows beneath it, and a drawer. The map is a figure in a report.

**Comp (7):** the map IS the page. It fills the viewport edge to edge; every other element floats
on top of it as a panel with its own dismiss control — status counts top-left, weather top-right,
vehicle detail bottom-left (tabbed: Details/Driver/Trip/History), recent alerts bottom-right, a
route strip bottom-centre, zoom/layers/locate on a right rail, basemap switcher bottom-right.

### 4.1 The rulings this needs

**D-DR5 — the full-bleed page varies the OUTLET, and must not become a sixth layout.** The standard
page is `PageHeader` + `space-y-6` inside a padded container, and a page that cancels that with
negative margins is the textbook workaround.

⚠ **Amended 2026-09-16, before building.** This first read "`AppShell` gains a `layout: "canvas"`
route flag", which was wrong. `meta.layout` already exists and already means *which shell entirely*
— `auth`, `public`, `apply`, `lab`, `shop`, each resolved by `lib/layout.ts`'s `resolveLayout`, each
REPLACING `AppShell`. The live map still wants the sidebar and the top bar; only the content area
changes. Adding `canvas` to that enum would have forced a sixth layout file duplicating the whole
navigation — a second source of truth for the nav, which is exactly what §"No workarounds" names.

The correct shape is a separate `meta.fullBleed` flag read **inside** `AppShell`. Its outlet today
is `<main class="py-6"><div class="w-full px-4 sm:px-6 lg:px-8">` (`AppShell.vue:370`), so full
bleed is dropping that padding and giving `<main>` a height. One shell, one navigation. Live map is
the first consumer; Fuel Planning is the obvious second.

**D-DR6 — panel open/closed state is remembered per device, and it is NOT `user_dashboard_layout`.**

⚠ **Corrected TWICE, and both corrections are recorded because a wrong ruling left sitting in a
canonical document is worse than no ruling.** As first written this said "a floating map panel is a
widget with a position", reusing LM10's per-user row.

1. **Position was wrong** (found before DR5 started). `StoredDashboardLayout` holds `widgetKeys` and
   `hiddenKeys` and nothing else, and migration 0343 has no column for a position. Comp (7) pins
   every panel to a corner anyway, so panels get FIXED corners and only open/closed is remembered.
2. **The ROW was wrong too** (found while building DR5, 2026-09-16, and the first correction had
   left it standing). `PUT /api/dashboard-layout` refuses any key outside `DASHBOARD_WIDGETS` —
   `unknownKeys` in `apps/api/src/modules/org/routes/dashboardLayout.ts`, a deliberate asymmetry
   with the tolerant read path — and `check-surfaces.mjs` asserts in both directions that every
   catalogue entry names a real `DASHBOARD_TABS` tab and a real component. A `livemap.*` key can
   only get past both by inventing a widget, a tab and a component that nothing renders, and the
   permissions preview page would then list those three fictions as things a role can be granted.
   Three lies to store one boolean.

So: `localStorage`, exactly where the sidebar's own collapsed sections already live. This is chrome
state — "is this panel shut" is the same class of question as "is the sidebar collapsed" — not a
preference about what a person may see, which is what that table holds.

**And the mechanism IS shared, which is the part that keeps this a derivation.**
`useSidebarSections` worked out in phase 6 that a stored set must hold what somebody CHANGED, never
what is open: nothing is stored until a preference is expressed, so an empty set has to mean the
default. That argument had already been transcribed by hand into `useTableColumns` before anybody
noticed it was a mechanism rather than a remark. DR5 extracts it as
`composables/useDeviationSet.ts` and puts the sidebar on it — and the generalisation is FORCED, not
tidy-mindedness: the sidebar's sections all default to open, so "store the closed ones" works there,
while the live map's fleet dock defaults to SHUT and the two corner panels to open. Storing the
deviation is the only form of the rule that reproduces two opposite defaults from one empty set.

⚠ `useTableColumns` is the third caller of the argument and is NOT on the composable — it carries an
ordering and a ruling about which columns a reader may hide. Folding it in is its own step, named at
the end of §7.

**D-DR7 — the fleet list does not disappear; it becomes a panel that opens to a dock.** The table
is load-bearing twice over and `LiveMapPanel`'s own comment says why: markers carry no unit number
(our style declares no `glyphs` endpoint, so maplibre cannot draw a `text-field`), and the table is
"the accessible reading of a canvas that screen readers cannot enter". Comp (7) simply omits it —
that is the comp being an illustration. So: a `Fleet list` panel, collapsed to a pill by default,
expanding to a bottom dock with the existing `DataTable` inside it, unchanged.
⚠ **It must stay in the DOM when collapsed, or the page loses its only keyboard route to a truck.**

**D-DR8 — the dark satellite basemap is one query parameter, and we should confirm it before
promising it.** Comp (7) is dark satellite. Our tiles come from
`apps/api/src/modules/routing/routes/mapProxies.ts`, which hardcodes
`maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png?style=explore.day`. HERE's v3 base service also
documents `explore.night`, `lite.day` and `lite.night` on that same path, so a **dark** basemap is a
parameter. *Satellite* is a different resource (`/v3/base/mc/.../jpeg?style=satellite.day`) and may
carry different licensing on our plan. Open question Q-DR2.

**D-DR9 — floating panels are the one place `backdrop-filter` is allowed.** They sit over a moving,
photographic surface, which is exactly the case the `apple-design` skill §12 describes: build
floating chrome as a translucent layer rather than an opaque strip, and never stack one translucent
surface on another. Two consequences that are easy to get wrong and are therefore written down:
`prefers-reduced-transparency: reduce` must make them solid (§14), and text over them needs the
vibrancy treatment — **higher contrast and slightly heavier weight, not flat grey** — because
`text-ink-muted` over a blurred satellite photograph is unreadable.

**D-DR10 — panels animate from their trigger, and stay interruptible.** `apple-design` §3 and §7:
open/close along the same path, `transform-origin` on the control that opened it, and never lock
input during the transition. A dispatcher closing a panel they just opened must not have to wait.

### 4.2 What DR5 does NOT adopt from comp (7)

Named so they are decisions, not oversights: the **weather card** (no weather provider is
integrated, and inventing one for a comp is scope), the **`Map/Satellite/Traffic/Weather`
switcher** (Traffic and Weather are HERE overlay layers we do not buy today — pending Q-DR2), and
the **"Destination / ETA / Next stop" rows** in the vehicle card. That last one is not a design
decision at all: `loads` holds 0 rows until LM12 and `tms_dispatchers` does not exist in this
database, which `LiveMapPanel`'s comment already records as the reason the dispatcher and
load-status filters are absent. **An ETA field that is always blank reads as broken, not as
pending.** DR5 ships the vehicle card with the four facts we actually have — speed, last fix,
location, heading — and grows when LM12 lands.

---

## 5. DR6 — imagery

Comps (1), (3), (5) and (7) all place a photographic truck plate behind the dashboard greeting. That
is the one asset in the comps we cannot write in CSS, and `higgsfield-generate` is installed in
`Silvicom-360-Videos` with a live account (ultra plan, 5,587 credits, checked 2026-09-16).

**D-DR11 — hero plates are generated once, committed as static assets, and never generated at
runtime.** They are decoration with a brand voice, not content. Requirements, so a regeneration
years from now matches: the truck entering from the right third, a low-contrast background that a
greeting can sit on at the left, and enough empty sky at the top-left that `text-ink` clears WCAG AA
over it without a scrim. Every plate ships as `.webp` with an empty `alt` — it is decorative, and a
screen reader reading "a truck on a highway" before the day's numbers is noise.

**Shipped 2026-09-16** — three plates in `apps/web/public/hero/`, `gpt_image_2_5` at `21:9`,
quality `high`, resolution `2k`, downscaled to 1920 wide:

| plate | mood | size | `--ink` over the text zone | zone below AA |
|---|---|---|---|---|
| `highway-dawn.webp` | dawn, mountains, pine — closest to comps (1)/(3)/(5) | 51 KB | 10.16:1 | 0.00% |
| `prairie-dusk.webp` | golden-hour plains, warm | 84 KB | 9.88:1 | 0.00% |
| `coast-mist.webp` | cool blue-violet haze — sits best beside the rotated brand | 52 KB | 9.22:1 | 0.00% |

⚠ **The contrast figure is measured over the zone the greeting actually occupies** — the left 45% ×
top 62% — not over the left half. The bottom-left of every plate is road surface, and measuring
there produced a misleading 3.11:1 worst-case for text that never lands on it. The generator prompts
are in the DR6 commit message so a fourth plate can match the three.

**21:9 is the widest ratio `gpt_image_2_5` offers** (≈2.33:1) and the comps' band is ≈6.7:1, so the
plate is shipped whole and the band is taken in CSS with `object-fit: cover` + `object-position`.
Cropping to a fixed band at build time would have to be redone at every breakpoint.

---

## 6. Open questions

- **Q-DR1 — does the brand hue rotation apply to the driver app?** `lint:token-schema` pins only the
  14 roles the two products genuinely share (canvas, surfaces, ink, edges) — brand is not among
  them, so the two can diverge without failing a gate. They probably should not. *Recommendation:
  rotate both, in DR1, so the products do not drift; the driver app's own comps are unaffected
  because its brand appears mostly as `operation-*` tones.* **Owner's call — it is identity.**
- **Q-DR2 — is `satellite.day` inside our HERE plan, and do we buy traffic/weather overlays?**
  Determines how much of comp (7)'s basemap switcher is real. *Recommendation: ship DR5 with
  `explore.day` / `explore.night` only, which is certain, and treat satellite as a follow-up once
  the plan is checked.* Blocks nothing.
- **Q-DR3 — does the dashboard get comp (2)'s right rail?** D-DR0 says no for now because LM10's
  layout editor owns that decision. Revisit once DR7 has rolled the new anatomy out and the page can
  be judged on its merits.

---

## 7. Progress log

Dated lines, appended — never a table of ticked rows. Parallel PRs marking adjacent table rows
conflict every time (`plan-progress-log-not-table-rows`).

- **2026-09-16** — Plan opened. Comps read and catalogued (§0). Colour, radius and elevation gap
  measured against the real app rather than estimated (§1): the colour delta is a single +21° brand
  hue rotation at constant L and C. DR1–DR3 prototyped on `claude/design-refresh-proto` and rendered
  in a browser; the prototype confirmed §2 — tokens alone reach roughly a third of comp (3), and
  `StatCard`'s anatomy is the rest. `apple-design` skill installed at `.claude/skills/apple-design/`
  and used for D-DR9/D-DR10.
- **2026-09-16 — DR1 SHIPPED.** Brand hue +21°, shape ladder doubled, `elevation-card` given its
  second layer, `surface-navigation` lifted above the canvas. Web only — the driver app's colours
  come from its own `apps/driver/src/theme/theme.roles.json`, not `packages/tokens`, so Q-DR1 is
  genuinely open rather than silently answered. Eight gates green including `lint:ui-contrast`,
  which is what makes D-DR1's "a rotation at constant L and C cannot break a contrast ratio" a
  measurement rather than a claim; 1,883 web + ui tests pass; rendered and looked at.
  **One thing the prototype got wrong and the gate caught:** the first pass rotated
  `viz-cost-reefer` along with everything else and `lint:chart-colors` failed it. The D-FRUI8 cost
  palette is a validated SET — lightness band, chroma floor, colour-vision separation, 3:1 on
  surface — and a member of it is not a brand colour. Restored, and charts deferred to DR3 on
  purpose.
- **2026-09-16 — DR6 SHIPPED (ahead of DR4, which consumes it).** Three hero plates generated and
  committed (§5). Deliberately landed early: DR4 cannot be judged in a browser without the image
  behind the greeting, and an asset with a measured contrast figure is a smaller thing to review on
  its own than bundled into a layout change.
- **2026-09-16 — DR5 pre-work.** Confirmed at the call site rather than assumed: the basemap in
  comp (7) is reachable. `apps/api/src/modules/routing/routes/mapProxies.ts` hardcodes
  `style=explore.day` on HERE's v3 base path, and `explore.night` is the same path with a different
  parameter, so a **dark** map is a one-line change. *Satellite* is a different resource and stays
  Q-DR2. Also confirmed the live-map page is currently a vertical document (`AppCallout` →
  `FilterBar` → map in a `BaseCard` → `DataTable` → drawer), which is what D-DR5 replaces.
- **2026-09-16 — DR2 SHIPPED (hero anatomy).** Chip leads from the left at `size-11`, hero value
  `font-semibold` → `font-bold`, and a `spark-inline` opt-in that puts the sparkline beside the
  number. The dashboard's four glance tiles opt in; `FleetHeadlines` does not, because its captions
  are sentences and a halved column wraps them — that difference is now asserted rather than left to
  the next person editing the template. Corrected a wrong number in §2 while building: `StatCard`
  has **17** consumers, not five, but only **two** use `size="hero"`, which is what kept the blast
  radius to two surfaces. Two new tests, both **proved by mutation** — forcing `inlineSpark` false
  and moving the hero chip to the right each fail exactly one assertion. `lint:comment-claims`
  caught a "pinned by" claim that named a test file without quoting a scenario, which is the gate
  doing precisely its job. 1,807 tests pass; rendered and looked at.
- **2026-09-16 — DR2b OPENED, not deferred quietly (D-DR12).** The delta pill was built and then
  held back: the dashboard has no previous-period data at all, and "Active alerts" is current-state
  so it cannot have a delta even in principle. Shipping a component with no honest values would have
  been the workaround. The drafted `DeltaPill.vue` and its `changePillTone`/`changeArrow` helpers
  are ready to land with the query that feeds them.
- **2026-09-16 — DR4 SHIPPED (chevron, greeting, hero band).** Reordered ahead of DR5 at the owner's
  prompt, and the prompt was right: after DR1 and DR2 the only changes a person could SEE were the
  active nav tint and some elevation. That is what front-loading the token layer buys — foundation
  first, payoff later — and three merged PRs with no visible payoff is a fair thing to push back on.
  DR4 is where the screen starts looking like the comps: the greeting replaces the "Dashboard" h1,
  the generated plate finally has a consumer (DR6 shipped the files three PRs before anything
  displayed them, which was the sequencing error behind the complaint), and the section chevrons
  move right. `min-h-36` + `object-position: center 62%` were arrived at by looking — the first
  attempt cropped the truck to a thin slice, which no test could have told me. Four new
  `PageHeader` tests and nine `greeting` tests; the two load-bearing ones **proved by mutation**
  (a helpful `alt` on the decorative plate, and dropping `pointer-events-none`, each fail exactly
  one assertion). 1,816 tests pass, six gates plus the design-token gate green.
- **2026-09-16 — DR4b OPENED (D-DR16).** The comps' ⌘K search bar is a feature, not a header
  layout: there is no command palette, no global search component and no search endpoint in the app.
  Drawing a box that opens nothing is D-DR12's mistake in a different costume.
- **2026-09-16 — D-DR5 AMENDED before any of DR5 was built.** The plan had said the live map gets
  `layout: "canvas"`; `meta.layout` turns out to already mean "which shell entirely", so that would
  have forced a sixth layout file duplicating the navigation. Corrected to a `meta.fullBleed` flag
  read inside `AppShell`. Recorded here because a wrong ruling left sitting in a canonical document
  is worse than no ruling.
- **2026-09-16 — DR4 follow-up, found by resizing the browser.** Two defects the first pass missed
  because it was only ever looked at on one wide viewport. (a) The header's actions were
  bottom-aligned, which put "Dates" and "Export" squarely on the truck's cab — the busiest corner of
  every plate — because the cab is bottom-right and so were they. A hero header now aligns its
  actions to the TOP, over the sky, which is also where the comps put them; the plain header keeps
  `items-end`, where actions should sit on the title's baseline. (b) The hero chip went `size-11` →
  `size-10`, matching the comp's ~40px more closely.
  ⚠ **(b) was very nearly shipped with a false justification.** It was written up as fixing a
  truncation regression; `main` turned out to truncate identically at 1280px, in widgets this work
  has never touched. The first comparison that suggested otherwise had been taken at two different
  viewport widths. The truncation is pre-existing and is §3.1's own paragraph now — not this PR's to
  fix, and not this PR's to claim credit for.
- **2026-09-16 — D-DR17 SHIPPED, and a withdrawal withdrawn.** The 1280px label truncation was
  written up as a DR2 regression, then withdrawn as pre-existing, and is a DR2 regression after all.
  The withdrawal rested on building `main` and seeing identical truncation — but `main` had held DR2
  since #819 merged, so both sides of that comparison carried the defect. Rebuilding at `8275964`,
  the commit before DR2, gives `scrollWidth - clientWidth === 0` on every label; after DR2 it is 7px
  and 30px short. **A comparison against `main` is worthless once the change under test is in
  `main`** — and a screenshot was never going to settle it, where reading the DOM did it in one
  call. Fixed by `flex-wrap` + a `min-w-32` floor rather than a viewport breakpoint, because the
  same tile is 410px wide at 900px viewport and 220px at 1280px, so a viewport rule would invert the
  decision. Measured after: inline at a 325px tile, wrapped at 220px, nothing truncated at either.
  `OperatingMetricsWidget`'s truncation at that width is a separate, genuinely pre-existing defect
  and is left for its own step.
- **2026-09-16 — DR5 BUILT (the live map is a workspace).** `meta.fullBleed` read inside `AppShell`,
  `LiveMapWorkspace.vue` as the page, floating panels over the map, the fleet list as a dock. The
  step cost four corrections and one new primitive prop, and each of them is here because none was
  visible from the plan:
  - **D-DR6 was wrong a second time** (§4.1 now carries both corrections). The panels cannot use
    LM10's row at all — the write path refuses a key the widget catalogue does not know. They use
    `localStorage` through a new `useDeviationSet`, which the sidebar now shares. Seven tests, two
    **proved by mutation**: opening the fleet dock by default, and replacing the deviation XOR with
    the sidebar's "store the closed ones", each fail five assertions.
  - **`LiveMapPanel` had to SPLIT, not move.** It is the Dashboard's Dispatch-tab widget as well as
    the page (D-DW5), and floating panels over a card inside a dashboard grid would be a workspace
    in a 400px box. The two shapes now share their STATE (`useLiveMapView`) and their facts
    (`LiveMapVehicleFacts`, extracted out of the drawer) and nothing else. The state is what would
    have drifted: the two different empty sentences, the filters, the selection.
  - **`DataTable` was missing a variant, and it would have clipped the fleet silently.** Its scroll
    area is `max-h-[70vh]` — a VIEWPORT measurement, 630px on a 900px screen — and the dock is a
    fixed 18rem band. Inside it the default puts a 630px scroller in a 288px box, so every row past
    the first 288px is unreachable, sticky header and all, with nothing thrown and nothing warned. A
    `fill` prop, on `AppButton`'s `ghost`/`link` reasoning: an `!important` at the call site is the
    sign that a variant is missing. Three tests, two proved by mutation.
  - **`FilterBar` does not fit in a floating panel, and that is D-DR17's lesson arriving again.** Its
    search is `lg:w-64 lg:shrink-0` beside a wrapping row of triggers — viewport breakpoints, all of
    which fire inside a 288px panel on a 1512px screen, so the bar lays itself out for a full-width
    page inside a fifth of one and grows a horizontal scrollbar (seen, 2026-09-16). The panel
    composes the same two primitives `FilterBar` itself composes, stacked. Not a clone: the toolbar's
    contents at the grain that fits.
  - **The corners do not survive a phone, measured rather than guessed.** At 390px the two top
    panels overlap by 193px at their desktop widths, and no trimming fixes 256 + 288 in 390. Below
    `sm` the panel layer is a single scrolling column and each panel is `static`; at `sm` and up they
    take their corners. Measured after: no overlap at 390, and 57px of clearance at exactly 640,
    which is the worst case above the breakpoint.

  Also settled while building, each with its reason: the **scope sentence (D-LM18) moved to the dock
  bar** — a callout floating over a map is either dismissible, which would let the disclosure be
  switched off, or undismissible, which is a panel lying about being a panel; the **freshness
  sentence (D-LM9b) moved with it** rather than being dropped with the `PageHeader`; the **truck card
  is not a remembered panel** — it is present because a truck is selected, so its dismiss clears the
  selection, and remembering it shut would mean clicking a truck one day and getting nothing back.
  **`bottom-right` does not exist** as a corner: comp (7) puts "Recent alerts" there and this board
  has no alert feed, which is D-DR12's mistake in a third costume.

  `lint:ui-adoption` fired on the missing `PageHeader`, correctly, and the exemption is **derived
  from `meta.fullBleed`** rather than typed into the hand-written list beside it — removing the flag
  from the route brings the failure straight back, which is how it was checked. 1,840 web tests,
  fourteen gates and both typechecks green; looked at in a browser at 1512, 1280, 640 and 390.

- **2026-09-16 — what DR5 did NOT do, named so it is a decision.** **D-DR8's dark basemap** is not in
  it: `explore.night` is one parameter but the parameter is hardcoded server-side in
  `apps/api/src/modules/routing/routes/mapProxies.ts`, so it is an API change with its own deploy
  window and it gets its own step. Satellite stays Q-DR2. The **weather card**, the **basemap
  switcher** and the **ETA rows** are §4.2's existing rulings, unchanged.

- **2026-09-16 — three DR5 follow-ups, each small and each deliberately not smuggled in.**
  1. **`useTableColumns` onto `useDeviationSet`.** The third copy of the stored-preference argument.
     It carries an ordering and a ruling about which columns a reader may hide, so it is not a
     mechanical move.
  2. **A banner and a full-bleed page cost 28px of scroll.** `EnvironmentBanner` and `UpdateBanner`
     are siblings of the whole shell in `App.vue`, so `calc(100dvh - 4rem)` is short by exactly the
     banner's height whenever one is showing — measured 28px on the UAT banner, 2026-09-16. Nothing
     is clipped; the document gains a short scrollbar. The proper fix is a flex chain from `#app`
     down, which restyles the layout container of every page in the product to buy 28px in the two
     environments a banner appears in. Not traded for that.
  3. **Fuel Planning is `fullBleed`'s obvious second consumer** and was left alone on purpose: one
     step per PR, and a shell flag with one consumer is easier to review than with two.

- **2026-09-16 — DR3 BUILT (the chart theme), and two thirds of its description turned out to be
  wrong.** The row in §3 reads "gradient area fills, rounded bars, softer grid". Measured against
  comp (3) before writing anything — by reading the PNG a pixel at a time, not by looking at it:

  - **"Gradient area fills" already existed.** `areaFill` has drawn a three-stop vertical gradient
    since G9, on five charts. What was actually wrong was its STRENGTH: the comp's wash reads 0.047
    directly under the line, 0.047 at 59% of the plot height, 0.026 at 71% and 0.012 at 95%; the old
    defaults compute to 0.128 / 0.077 / 0.052 / 0.009 at the same depths — a little over twice the
    comp everywhere but the very bottom. `top` 0.3 → 0.14 and `mid` 0.08 → 0.045 land within a
    couple of hundredths across the band. `FleetTrendChart` is untouched: all three of its series
    pass an explicit wash, so D-FRUI7's three-wash tuning survives by construction, not by luck.
  - **"Rounded bars" had no subject until the FORM changed.** There is not one Chart.js bar chart in
    `apps/web`. Both dashboard comps draw "Fuel spend · daily total across the fleet" as bars, and
    the data agrees: `spendTrend` is a discrete daily total that `dashboard.ts` ZERO-FILLS
    (`round2(spendByDay.get(date) ?? 0)`, commented "a no-spend day is a real $0 day"), so it can
    never contain a null and a line's implication that Tuesday flows into Wednesday was never true
    of it. That zero-fill is also what makes bars safe: a bar chart cannot tell "no data" from
    "zero", which would be a real objection on a series that could be withheld and is not one here.
    ⚠ The MPG card keeps its line for exactly the opposite reason — `mpgWeeks[].mpg` IS nullable and
    `spanGaps: false` draws the hole.
  - **"Softer grid" had no substance at all.** Our `--viz-grid` is `--ramp-neutral-100`, which
    computes to `rgb(238, 240, 243)` — 17/15/12 below white. The comp's gridline measures
    `rgb(246, 248, 250)`, 9/7/5 below, which looks like ours being twice as heavy. It is not: the
    comp's line occupies TWO adjacent rows at that value, which is a 1px stroke antialiased across a
    half-pixel boundary. Summed, the ink is one row 17 below white — `--ramp-neutral-100` exactly.
    **No change, and that is the finding rather than an omission.**

  **The same antialiasing trap cost a second wrong answer, and it is the one worth remembering.**
  Comp (3)'s MPG line appears to carry a dot on every point at 3× magnification. It does not: the
  line is a uniform 1–3 dark pixels per column for its whole length and 4 only at the final point.
  What reads as dots is a 2px stroke's own edges. So the comp AGREES with D-FRUI7's existing R5
  ruling — "no points along the line; one ringed dot on the last month" — and `MpgTrendWidget`,
  which had no dot at all, gains the terminal one through a shared `lastPointRadius` rather than a
  third copy of `FleetTrendChart`'s inline ternary. **Reading a picture gave the wrong answer twice
  and counting pixels gave the right one both times** — D-DR17's lesson in a different medium.

  **Colour is unchanged, deliberately.** Both comps draw the spend bars violet, like everything else
  on their page, and `--viz-spend` is emerald. DR1 already paid for this: rotating `--viz-cost-reefer`
  to match the comps failed `lint:chart-colors`, because the visualisation palette is a validated set
  — lightness band, chroma floor, colour-vision separation, 3:1 on surface — and a member of it is
  not a brand colour. Measured while deciding: the comp's own bars sit at **1.9:1 against white**, and
  our emerald lightened to the comp's tint ratio would sit at **1.66:1**. The comps are not accessible
  on that mark; ours stays at full strength, which is the only mark on that chart.

  ⚠ **The bars therefore read heavier than the comp**, and that is a visible deviation rather than a
  detail: a card of 30 saturated emerald bars beside the MPG card's airy wash is not the balance
  comp (3) draws. It is the price of a mark that clears 3:1. Flagged for the owner rather than
  traded away quietly.

  1,847 web tests; `lint:chart-colors` and five other gates green; three assertions **proved by
  mutation** (reverting the wash defaults, rounding all four bar corners, and a dot on every point
  each fail exactly one). Rendered and looked at with synthetic data at 1512 and 1280 — the
  dev-bypass dashboard is all zeros, so the browser check ran behind Playwright route mocks of
  `rest/v1/fuel_transactions` and `/api/fueling/fleet-mpg`. Hover verified: the index tooltip reads
  "Aug 29 · Spend: $13,222" and the hovered bar takes `--viz-spend-hover`.
