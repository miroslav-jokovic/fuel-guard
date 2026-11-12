# Design refresh 2026-09 — the comps, and what it actually takes to reach them

**Status:** DR1, DR2, DR4, DR6, D-DR17 and DR5 shipped (`main` `96efd06`); **DR3 built** — see §7.
**Next:** DR2b, DR4b, DR7, and DR5's own follow-ups named at the end of §7.
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
| `highway-night.webp` | **the dark-mode plate (D-DR19)** — same highway at night | 21 KB | 16.02:1 | 0.00% |

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

- **Q-DR4 — what do HERE vector tiles cost us, and may we cache them? (blocks D-DR27's build.)**
  D-DR27 reads the `pois` layer of HERE's Vector Tile API. On 2026-11-09 our key answered 200 for
  `vector.hereapi.com/v2/vectortiles/base/mc/{z}/{x}/{y}/omv` at zooms 12–17 (zoom 18 answers 400),
  so access is not the question. Two things are still unknown:
  - **Billing.** Is a vector tile billed like a raster tile, and is there a free tier that we would
    exceed? One level ahead costs 5 HERE vector tiles per map tile and two levels cost 21. A
    900×600 viewport measured 6 map tiles, so 30 vector tiles per view at one level and 126 at two.
  - **Caching.** May the proxy keep POI tiles server-side? Place names change rarely, so a 24-hour
    cache would make the per-view count above a first-view cost only.

  Candidate answers: (a) read the contract or HERE console usage page before building; (b) build
  behind the existing proxy with a server cache and measure a week of staging use. Recommendation:
  (a), because it is a reading task and (b) can't undo a bill.

- **Q-DR29 — ANSWERED 2026-11-10 by the owner ("proceed with next step"): (b), built as D-DR29 without (a), because this session had no AWS credentials.** *Original question:* should map tiles get their own rate-limit bucket? (Q-DR5…Q-DR28 are taken in
  `DOCUMENT-READER-PLAN.md`, hence the jump.) Tiles share the general `/api` per-caller budget,
  2 100 per 15 minutes (`apiRateLimit.ts`), with every poll the dispatcher's board makes. Measured
  2026-11-10: one walk of 18 one-level zooms costs ~410 tile requests after D-DR26, so a dispatcher
  who zooms around for a quarter-hour can spend the budget on tiles alone, and then the WHOLE app
  answers 429, the board's polls included, until the window turns. Not observed in production: this
  session had no AWS credentials to read the API's `[metrics]` lines for 429s on `/map-tiles/`.
  Candidates: (a) read a week of production 429s by route first; (b) give `/map-tiles/` its own
  per-caller bucket (sized from the walk above, e.g. 6 000/15 min) and skip it in the general one, so
  a map can never starve the board; (c) leave it. Recommendation: (a) then (b). (b) is a small change,
  but it moves a security boundary, so it should rest on a number.

- **Q-DR30 — what is our HERE per-second limit, and will HERE raise it?** D-DR30 paces tiles at 80
  a second per API replica (160 fleet-wide on production's two), under the ~200 a second where HERE
  started refusing in the 2026-11-10 burst. HERE does not publish the number. If 40 readers open
  the map in the same few seconds, ~2 400 tiles take ~15 s to fill at that pace. Candidates: (a) ask
  HERE for our limit and a raise, then set `HERE_TILE_PACING` to just under it; (b) leave 160.
  Recommendation: (a). It is one email, and the vector basemap (D-DR31 proposed, below) cuts the
  tile count by two-thirds on top of it.
- **Q-DR31 — separate HERE keys per environment (owner, HERE console).** Local development,
  staging and, very likely, production share one HERE key. The 2026-11-10 burst sent straight to
  HERE from a development machine made staging's next run fail, so it probably cost production
  its rate limit for 10–30 seconds. Separate keys also give separate usage reports and alerts.
  Recommendation: do it before any further load test.

- **Q-DR34 — truck places are thin in HERE's vector data. How do we name them?** Measured 2026-11-10
  (`docs/plans/livemap/HANDOFF-2026-11-10-VECTOR-MAP.md` §4). The vector tiles never carry the
  Browse truck codes. Pilots are `kind=parking` 800-8500-0178 from min_zoom 17, Love's is a
  convenience store from 18, 1 of 8 truck repair shops is present, and 0 of 6 truck parking lots.
  Candidates: (a) accept the vector data; (b) a truck-places layer from HERE Browse, kept at most 30
  days and only as its caching headers allow (headers not yet read); (c) see whether
  `content=advanced_pois` ($0.239/1 000) carries the truck categories, by fetching one tile.
  Recommendation: (c) first, then (a) or (b) on what it shows.
  **(c) measured 2026-11-11 — answered for truck stops and truck parking, see D-DR34.** The
  advanced tile carries both (17 truck stops, 19 truck parking lots, 4 rest areas in 24 zoom-13
  tiles), so they are now drawn from it. ⚠ Still open: truck REPAIR (700-7850-0126) is in neither
  tile (0 of 8 shops HERE's search names, none in the 24 tiles); for repair shops only (b) remains.
  **(b) re-read 2026-11-11:** a shared server cache of Browse results is what Platform Terms §6.4(l)
  forbids (scaling one request to many end users), and per-user caching against 5 000 free searches
  a month across 40 seats is thin. New candidate (d): the carrier's own repair vendors, first-party
  data with no HERE terms. Recommendation: (d).

- **Q-DR35 — self-hosted OpenStreetMap vector tiles instead of HERE's: the cheapest shape for 50
  seats, blocked by two reads.** One PMTiles archive of North America served as a static file with
  range requests, no per-tile API call, no key, no pacer, no vendor rate limit; rough cost $3–5 a
  month against the vector map's $10–127 (`HANDOFF-2026-11-10-VECTOR-MAP.md` §10.5, sizes and
  prices TO BE MEASURED). Blocked by (1) HERE's clause on drawing HERE routes over a non-HERE map,
  not yet quoted, which if it forbids it drags self-hosted truck routing along and shrinks the saving
  to a question; (2) OSM's coverage of truck stops, truck parking and repair shops, to be counted
  against the same 40 Browse places HERE's tiles were. Recommendation: finish the HERE vector
  decision first; open this as a measured spike only on the owner's ask, after both reads.

- **Q-DR36 — how does a dispatcher keep "Map (classic)" for the two weeks, and how do we know who
  used it?** The basemap choice is deliberately not remembered (D-DR6's note in
  `LiveMapWorkspace.vue`), so the escape hatch resets on every page load and its use leaves no trace
  in preferences. Candidates: (a) remember the choice in `localStorage` for the window and reset it
  when "Map (classic)" is removed; (b) leave it unremembered and read raster against vector tile
  route counts from the `[metrics]` line, which needs AWS access. Recommendation: (a) for the
  dispatcher plus (b) for the count; neither alone answers "does anybody need it".

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

- **2026-09-16 — DR7 SCOPED, and it is much smaller than "the other ~60 pages".** Measured before
  proposing anything, because the §3 row ("roll the DR1–DR3 anatomy across the other pages") sizes the
  step by page count and page count is the wrong unit here. There are **83 route records → 77 distinct
  page components** in 13 route files. **67 of the 77 already render `PageHeader`**, and the 10 that do
  not are each already gate-exempt for a reason that survives this programme: five auth/apply screens,
  four public documents, `CountSessionPage` (its body owns the header, D-INV17) and `ScanPage`. DR1 is
  tokens, so it reached all 77 the moment #818 merged, and DR4's chevron did too. **What has not rolled
  out is four specific things touching ~12 pages, not sixty:**
  1. **The KPI tile has three sources of truth.** `StatCard` (38 call sites over 16 files, but only
     **two** files use `size="hero"`, so DR2's anatomy has reached exactly two surfaces);
     `features/fueling/FuelStatTile.vue`, a near-copy with one consumer; and **19 files hand-rolling
     ~47 `<dl>` tiles**. ⚠ Most of those hand-rolls are already `text-2xl font-bold` under an uppercase
     `text-xs` label — i.e. they MATCH `StatCard`'s `kpi` anatomy by coincidence, so converting them is
     de-dup and not a visible change. Said plainly here so a later reader does not budget it as a redesign.
  2. **`ChartCard` is trapped in `features/dashboard/`** and the three charts outside that feature
     (`DriverDetailPage`, `VehicleDetailPage`, `FleetTrendChart`) each hand-roll its header.
  3. **The two MPG detail charts are outside the chart theme's OPTIONS layer entirely** — they take
     `viz.brand` and `areaFill`, so DR3's wash recalibration reached them for free, but they build
     `options: { responsive, maintainAspectRatio }` and get no `trendOptions`: no themed gridline, no
     tick font, no inverse-surface tooltip, and `pointRadius: 0` with no terminal dot. They are the same
     species of chart as `MpgTrendWidget`, which gained all of that in DR3. **This is DR3's one real miss.**
  4. **`StatCard` has no `valueTone`.** `CoveragePage` and `IdlingPage` colour the VALUE by threshold
     (`covTone`), and `tone`/`subTone`/`muted` cannot express it — so those pages cannot convert without
     the variant. DR5's `DataTable fill` reasoning again: the `:class` at the call site is the sign.

  **Q-DR1 RULED by the owner, 2026-09-16: the driver app takes NO change.** The hue rotation stays
  web-only. `apps/driver/src/theme/theme.roles.json` is untouched and no gate couples the two, so this
  is a standing decision rather than a deferral — a later step that rotates it is changing identity and
  should say so.

  **Scope narrowed by the owner to the Dashboard and the Dispatch live map.** The live map was audited
  and is CLEAN: DR5 rebuilt it and left no hand-rolled stat tile, no raw `<h3>` and no un-themed chart
  in any of its seven components. Its remaining DR item is **D-DR8, the dark basemap**, which is an API
  change with its own deploy window. The dashboard has three gaps —`OperatingMetricsWidget` (below),
  `RiskList`'s raw `<h3>` header (a fourth copy of `ChartCard`'s), and nothing else: every other widget
  already goes through `StatCard` or `ChartCard`.

- **2026-09-16 — DR7a SHIPPED (the operating-metrics strip).** The handoff listed this as
  "`OperatingMetricsWidget`'s 1280px truncation · small and self-contained". The truncation was worse
  than recorded and the widget had a second defect nobody had named.

  - **`xl:grid-cols-8` never fitted at ANY width it existed at.** Eight columns switch on at 1280px,
    which is also their worst case: a 116px cell, "Telematics coverage" 27px over and "odometer span in
    range" 44px over. Widening does not rescue it — 1440px still clipped a label and three captions, and
    1512px, the widest laptop this is read on, left two short. The handoff had it as a 1280px defect; it
    was an every-width defect, and only measuring at four widths instead of one showed that.
  - **The strip is up to TEN tiles, not eight.** Five fuel + two ledger + three trust for a caller who
    holds `accounting`. Eight columns therefore also left a two-tile orphan row in the common case. The
    browser check missed this at first because dev-bypass returns no findings summary, so `ledgerTiles`
    returned `[]` and the strip rendered eight — the count only appeared when the component test mounted
    it with real data. ⚠ **A dev-bypass render is not the full surface**, and this is the second way that
    has bitten this programme after the all-zero charts in DR3.
  - **Every tile carried an `icon` and a `tone` and the template drew NEITHER.** Eight glyphs resolved
    on every range change and dropped on the floor. `LedgerTile.icon` was typed `unknown`, which is what
    hid it: `unknown` cannot be handed to `AppIcon`, so drawing one needed a cast, and the absent cast
    read as a deliberate omission rather than an oversight. Typed as `Icon`, the chip is one `v-if` —
    and `useFindingsSummary.test.ts` then failed to compile, because it had been standing in the strings
    `"open-icon"`/`"money-icon"` for a value the strip must be able to render.
  - **The chip re-created the truncation, and the two numbers that fixed it are the point.** A `size-9`
    chip plus its gap reserves 48px, so a four-up capped grid — which had measured clean — started
    clipping at 1024 again. **The four-up cell at a 1024px viewport is 168px; the two-up cell at a 390px
    viewport is 172px.** Nearly the same tile at viewports 634px apart, so "narrow phone" and "roomy
    laptop" are the SAME layout problem here and any viewport rule gets one of them backwards. That is
    **D-DR17's lesson for the third time** in this programme, after `FilterBar` in DR5. The column counts
    are now derived from a measured tile width — caption 128 + chip 48 + padding 32 = a 208px floor — and
    the grid may only take a count that leaves one: 1-up to 700px, 3-up at `md`, 4-up at `xl`.
  - **`sm:grid-cols-3` then clipped at exactly 640px** and nowhere else — a 192px cell, 16px under the
    floor. The second worst-case-at-its-own-breakpoint in the same widget. Every breakpoint is now
    checked AT its boundary rather than in the middle of its range; ten widths measured clean after.
  - **`font-semibold` → `font-bold` on the value**, DESIGN-SYSTEM-CONTRACT.md §2.3 ("`font-bold` is
    reserved for KPI numbers; headings are `font-semibold`") — the identical correction D-DR2 made to
    `StatCard`'s hero value, for the identical reason. ⚠ The SIZE deliberately stays `text-lg` rather
    than following the contract's `text-2xl font-bold` pairing: that pairing describes a KPI row leading
    a page, and this strip sits under four `text-3xl` hero tiles that are meant to outrank it. The weight
    was wrong, the scale was not.

  **What DR7a did NOT do, named so it is a decision.** The strip was not bound to `StatCard`, though it
  would compile — `moneyGate.ts`'s `MoneyGateable` is documented as structurally compatible with it. Doing
  so renders an elevated card per tile, and ten of those directly beneath `KpiHeroWidget`'s four `text-3xl`
  tiles is precisely the "competing as hero cards" this widget's own first paragraph exists to prevent.
  The DR2 anatomy was rolled ONTO the strip instead, each detail derived from `StatCard` rather than
  restated — the chip's `size-9`/`size-5`/`rounded-surface` and its TRAILING position are copied from that
  primitive's `size="kpi"` branch, because D-DR2 moved the chip left in the HERO anatomy only.
  **Q-DR4 — should the strip archetype survive the refresh at all?** It is the one dashboard surface that
  is not a card, and that is either the point of it or the last thing left to convert. Owner's call, not
  a question this step should answer quietly in either direction.

  Three new tests, all three **proved by mutation**: deleting the chip span, re-adding `xl:grid-cols-8`,
  and reverting `font-bold` each fail exactly one assertion — plus a fourth mutation, painting every chip
  one tone, which fails the tone assertion and is what proves the fixture discriminates rather than
  passing on a uniform one. 1,850 web tests (1,847 before); nine gates plus the design-token check and
  both typechecks green; looked at in a browser at 1512, 1440, 1280, 1100, 1024, 900, 800, 768, 700, 640,
  500 and 390.

- **2026-09-16 — D-DR8 SHIPPED (the basemap follows the reader's colour scheme).** The handoff had
  this as "one parameter, but the parameter is hardcoded server-side, so it is an API change with its
  own deploy window". Both halves held; what the plan had NOT recorded is that this was fixing a
  defect already in production rather than only matching comp (7).

  - **Dark mode gave the live map dark markers over a LIGHT basemap.** `LiveMapCanvas` has watched
    `isDark` since LM8 and re-installs the truck icons when the scheme flips, so the markers follow
    the theme and the vendor tiles never did. That watcher's own comment reads "leaves a dark map
    wearing light-mode markers" — a sentence describing a map this product did not have. It was true
    about the markers and wrong about the map, and both halves are true from here.
  - **It is DERIVED, not a new control, and that is the whole design decision.** Comp (7) draws a
    basemap switcher and §4.2 already declined the four-way `Map/Satellite/Traffic/Weather` version
    for want of the overlay layers. A two-way Day/Night toggle was the tempting smaller version of it
    — and it would be a second place where "is this reader in dark mode" gets decided, when D-DS2b
    settled that once and this file already reads the answer. A toggle here asks the dispatcher a
    question the app knows the answer to.
  - **The style allowlist lives in `@silvicom/shared` (`basemap.ts`), not beside either caller.** Two
    processes have to agree on the same two vendor strings, and the failure mode of disagreeing is
    SILENT: the proxy falls back rather than erroring, so a misspelling on the web side produces a
    light map in dark mode and nothing in any log. This is the repo's own "never redefine a contract
    per app" applied to a two-word enum, which felt like ceremony until the failure mode was written
    down.
  - **The proxy FALLS BACK where its neighbour four lines up answers `400`.** `mapProxies.ts` rejects
    an invalid tile coordinate, and copying that strictness here would be wrong: a bad coordinate is
    one broken tile, an unlisted style is every tile in the viewport at once. A basemap in the wrong
    scheme is cosmetic; a grid of failed tiles reads as an outage.
  - **`setTiles`, not a rebuilt map.** `useMapLibre` now accepts `string | Ref<string>` and swaps the
    raster source's tiles in place. Rebuilding would reset the camera, so a dispatcher who had zoomed
    into a corridor would be thrown back to the fleet bounds for changing a colour — the same
    reasoning `flyTo` already applies to selecting a truck. `RouteMapGL` passes a plain string and is
    unchanged. ⚠ That is also the assertion no screenshot can make: with a rebuild everything visible
    is still correct, so the test asserts the constructor ran ONCE.
  - **⚠ THE TWO-MERGE RULE DOES NOT APPLY, and it was checked rather than assumed.** The reflex from
    `lint:migration-ordering` is right to reach for — Railway can serve the two services from
    different commits (`deployed-is-a-per-service-question`) — but neither order breaks here. New web
    against old api: the old proxy has no `style` handling, ignores an unknown query parameter and
    serves `explore.day`, so the map is light until the api catches up. Old web against new api: no
    parameter, and `resolveBasemapStyle(undefined)` returns the same default. Both degrade to exactly
    today's behaviour, and the old-client case is a named test rather than a claim.
  - **`Cache-Control: public, max-age=86400` is unchanged and stays correct** — the style is in the
    query string, so the two basemaps occupy different cache keys and a reader toggling schemes is
    not served yesterday's day tiles in dark mode.

  **Verified in a browser, and the limits of that check are stated.** At 1440px on `/live-map` with a
  three-truck board: the profile menu's radiogroup read `Light checked=true`, clicking **Dark** flipped
  `color-scheme` and issued three fresh `?style=explore.night` tile requests with zero day requests,
  and the canvas measured 1153×499 before and after — the map was not rebuilt. ⚠ Those tiles were
  STUBBED: the local preview has no API and no HERE key, so what the browser proved is the requested
  URL, not the picture. The picture was confirmed separately by fetching one real tile of Michigan at
  both styles straight from HERE — `explore.night` answers `200` with a genuinely dark basemap on this
  plan, looked at rather than assumed. *Satellite* remains Q-DR2 and is a different resource.

  Twelve new tests — six in `shared`, five in `api`, one in `web` — and five **proved by mutation**:
  hardcoding `explore.day` back into the upstream URL, dropping the allowlist check, swapping the
  light/dark strings, deleting the tiles watcher, and replacing `setTiles` with a no-op each fail
  exactly the assertions that pin them. Full `pnpm test` green (api 3,784 · web 1,851 · shared 2,913),
  `pnpm typecheck` and `pnpm lint` green, six UI gates green.

  **Follow-up, named rather than smuggled in:** `RouteMapGL` (Fuel Planning) uses the same tile proxy
  and still passes a plain string, so its basemap stays light in dark mode. One line and the same
  `basemapStyleFor` call — left out because Fuel Planning is not in this step's scope and a second
  consumer is easier to review on its own than bundled into the change that created the seam.

- **2026-09-16 — DR7b SHIPPED (the dashboard's last hand-rolled panel header).** `RiskList` — the
  container behind both `Top vehicles by risk` and `Top drivers by risk` — rendered
  `<h3 class="text-sm font-semibold text-ink">` inside a `BaseCard`, which is `ChartCard`'s header
  spelled out a fourth time. It now goes through `ChartCard`, and with it every titled panel on the
  fleet tab is one component: the dashboard has no hand-rolled tile or panel chrome left.

  **Nothing here is a chart, and that is the finding rather than an objection.** What `ChartCard`
  actually owns is "a titled panel on the dashboard grid" — it is misnamed, not misused, and the two
  risk lists sit in that grid beside the three charts that already use it. Renaming it would touch
  five files for no behaviour and was not done; the mismatch is recorded here instead so the next
  reader does not take the name as a reason to write a fifth header.

  ⚠ **The card's `flex h-full flex-col` now arrives as a FALLTHROUGH attribute**, which works because
  `ChartCard`'s root IS the `BaseCard`. It is load-bearing: the empty state centres itself with
  `flex-1`, and `flex-1` fills nothing without a column to fill. That is also the half no existing
  test could see — `dashboardEquivalence` pins the `h3` text and a populated list looks identical
  either way, so only an EMPTY card beside a full one in the same row would have shown the collapse.
  Hence `RiskList.test.ts`, whose load-bearing assertion is the empty state rather than the title.

  Measured after, in a browser at 1440px: the `h3` of `Open cases by severity`, `Top vehicles by risk`
  and `Top drivers by risk` all sit **20px from their card's top edge at 14px/600** — identical
  geometry, which is what the de-duplication was for. Looked at in both schemes. Three new tests, two
  **proved by mutation**: dropping the fallthrough class fails the empty-state assertion, and
  restoring a hand-rolled header fails the header assertion.

- **2026-09-16 — D-DR19 SHIPPED (dark mode gets a night plate, not the day one dimmed).** Raised by
  the owner looking at the dashboard in dark mode, and the complaint measured out exactly as stated.

  **The defect, measured on the RENDERED band rather than the source.** `highway-dawn.webp` served
  both schemes. In light mode it sits at **1.85:1** against the page it fades into; in dark mode the
  same plate sat at **6.54:1** — the page moved from L≈1.0 to L≈0.014 and the photograph did not
  follow, so a dawn sky became a luminous slab on a near-black page.

  ⚠ **The mean was hiding the real number, and the percentiles are what to quote.** Averaged over
  the plate's right two-thirds the new plate reads 1.01:1, which sounds like it vanished. It has not:
  the median is 1.04:1 and the **brightest 1% — the trailer and the headlights, which is what a
  reader actually sees as glare — went from 14.22:1 against the page to 2.09:1**, landing just beside
  light mode's 1.85:1 band. A mean over a mostly-black frame averages the subject away, which is the
  `higgsfield-image-generation` lesson ("measure the zone the subject occupies") arriving in the
  opposite direction from DR6, where it was the TEXT zone that mattered.

  **A `brightness()` filter was the cheap answer and is the wrong one.** Dimming a dawn sky produces
  a grey dawn sky, not a night: the sky's hue, the headlights, the fall of light on the trailer and
  the stars are a different photograph, not the same one turned down. So `highway-night.webp` is
  generated from DR6's own prompt family (`gpt_image_2_5`, 21:9, quality high, 2k, downscaled to
  1920, `cwebp -q 82`) with the same composition contract — truck in the right third moving left,
  left two-thirds near-empty for the greeting. 21 KB, the smallest of the four, because a night sky
  compresses.

  **The text contrast had to be re-measured, not inherited.** In dark mode `--ink` is
  `oklch(0.944 0.004 286.3)` — near-white — so DR6's figures for dark ink over a pale plate say
  nothing about it. Over the same left-45% × top-62% zone, near-white ink on the night plate measures
  **16.02:1 mean, 17.70:1 worst, 0.00% of the zone below AA** — the best of the four plates.

  ⚠ **And the greeting DOES sit over the plate below 1440px**, which a first measurement at 1512 said
  it did not. Overlap is 0px at 1512, 25px at 1280, 89px at 1024, 134px at 768 and **237px at 390**,
  where the greeting is almost entirely over the image. So the zone figure above is load-bearing on a
  phone rather than theoretical, and "the text never touches the picture" would have been a wrong
  ruling written into a canonical document.

  **D-DR19 — the plate is DERIVED from the colour scheme, like D-DR8's basemap.** `PageHeader` reads
  `useColorScheme().isDark` itself rather than taking a resolved URL, because that composable is the
  one place that answers "is this reader in dark mode" and a prop would make the dashboard the second.
  ⚠ `heroDark` FALLS BACK to `hero` when absent, which is a named compromise and not a feature:
  `prairie-dusk` and `coast-mist` have no night variant and keep the 6.54:1 band in dark mode until
  they get one. Asserted, so it is a decision rather than a surprise.

  Three new tests, two **proved by mutation** (ignoring `isDark`, and dropping the fallback). 1,857
  web tests; seven gates plus the design-token check green; looked at in both schemes at 1440.

- **2026-09-16 — Q-DR2 ANSWERED, and D-DR20/D-DR21 SHIPPED (the basemap switcher, and the corner it
  had to fight for).** The owner asked whether maplibre offers terrain or satellite. maplibre is only
  the renderer — it draws whatever raster it is handed — so the real question was always our HERE
  plan, and it was answered by asking HERE with the production key rather than by reading its docs:

  | style | format | result |
  |---|---|---|
  | `explore.day` · `explore.night` · `lite.day` · `lite.night` · `topo.day` | png | **200** |
  | `satellite.day` | jpeg | **200 — 41 KB** |
  | `satellite.day` | png | 200 — **488 KB** |
  | `hybrid.day` (satellite WITH labels) | either | **400, "not currently supported"** |

  Both tiles were opened and looked at rather than counted: `satellite.day` is real imagery,
  `topo.day` is the terrain style. **So comp (7)'s Map/Satellite switcher is real**; its *Traffic* and
  *Weather* tabs remain overlay layers we do not buy, and a labelled hybrid is not on the plan at all.
  §4.2's ruling stands for the four-way switcher and is now WRONG for the two-way one.

  ⚠ **FORMAT IS A SECOND DIMENSION, and missing it would have cost 12× the bytes.** The proxy
  hardcoded `/png` in the path. A satellite photograph in a lossless format is 488 KB against 41 KB as
  jpeg — on the slowest part of this page. So `BASEMAPS` is a table of `{ style, format }` objects
  rather than strings, and `resolveBasemapFormat` has its own allowlist: the format lands in a URL
  **path**, so an unvalidated one is a path-injection shape rather than a cosmetic bug. Pinned by
  "refuses a format that is not on the allowlist rather than putting it in a URL path".

  **D-DR20 — the switcher offers three basemaps and never a Day/Night button.** `BASEMAP_CHOICES`
  deliberately omits `mapNight`: it is not a fourth choice beside satellite and terrain, it is what
  `map` BECOMES in dark mode. Offering it would put the colour scheme on screen twice and let the two
  disagree — the toggle D-DR8 refused, arriving through a different door. ⚠ Only the road map moves
  with the scheme, and that asymmetry is a vendor fact: HERE publishes no `satellite.night` or
  `topo.night`, and a satellite photograph of the earth at night is a picture of city lights.

- **2026-09-16 — D-DR21: the zoom buttons are OURS now, because DR5 left maplibre nowhere to stand.**
  Reported by the owner, then measured: maplibre's `NavigationControl` sat at 1458,92 (39×68) and
  DR5's Filters panel at 1197,104 (288×142), so **the panel covered the zoom buttons by 27×56px — at
  1512, 1280, 1024 and 768 alike.** Both are pinned to the same edge with fixed insets, so it is a
  constant defect rather than a breakpoint one, and it has been shipping since DR5.

  ⚠ **The overlap check written during DR5 could not have caught it: it compared our floating panels
  to EACH OTHER and never to maplibre's own DOM.** A control a composable adds is still something on
  the screen. The first re-run of that check during this step reported "no overlaps" and was wrong for
  exactly the same reason — the owner saw it before any of our measurements did. When a gate and a
  pair of eyes disagree, the eyes are reporting on the product.

  maplibre knows four corners and this workspace spends all four (fleet status, filters, truck card,
  HERE attribution), so there was no corner to move it to. `useMapLibre` gained `navControl: false`
  and the rail is ours: pinned to the right edge and **vertically centred**, the one placement that
  needs no knowledge of which panels exist, and where comp (7) draws its controls too. It lives inside
  `LiveMapCanvas` rather than the workspace's panel layer so both shapes of the map — the workspace and
  the dashboard widget — get it without either re-declaring it. `RouteMapGL` keeps maplibre's control
  and is untouched. Measured after: **zero real overlaps** at 1512, 1280, 1024 and 768, and the
  native control is gone from the DOM.

  Five new tests on the rail and four on the proxy, four **proved by mutation**: a Night button, the
  rail holding its own choice, hardcoding `/png` back into the path, and dropping the format allowlist
  each fail exactly what pins them. ⚠ Two EXISTING tests had to change rather than be added to — both
  asserted `satellite.day` was refused, which is now the opposite of the shipped behaviour. That is
  the suite doing its job at a deliberate behaviour change, and `hybrid.day` is the honest replacement
  for "a style we do not have". Full `pnpm test` green (web 1,862 · api 3,788 · shared 2,916).

- **2026-09-16 — D-DR22: every basemap is jpeg, and the road map was the one that mattered.** D-DR20
  took the format win on satellite alone and gave a reason — "a photograph does not belong in a
  lossless format" — that turned out to be too narrow. HERE renders the ROAD styles as photographs
  too: anti-aliased type over gradient fills at 512px, which is the worst case png was designed for.
  Measured with the production key across five tiles chosen to span what a dispatcher actually looks
  at — a dense city (Chicago z13), a metro (Dallas z11), an interstate (Iowa z9), the national view
  (z5) and open country (Texas z14):

  | style | png | jpeg | saving |
  |---|---|---|---|
  | `explore.day` (z13) | 286 KB | **47 KB** | 84% |
  | `explore.night` (z13) | 286 KB | **41 KB** | 86% |
  | `topo.day` (z13) | 278 KB | **38 KB** | 86% |
  | `explore.day` (z5) | 270 KB | **29 KB** | 89% |
  | `explore.day` (z14, rural) | 57 KB | **8.6 KB** | 85% |

  A 12-tile viewport at 1512×787 therefore pulls **~0.4 MB where it pulled ~3.2 MB**. HERE was never
  the slow part — round trip 150–210 ms, TTFB 100–170 ms — the payload was.

  ⚠ **The trade was LOOKED AT, because this is exactly where jpeg is meant to be ugly.** These tiles
  carry small road labels and flat colour fields; both renders of the same tile were opened side by
  side at 1:1 in day and night and are indistinguishable. The loss is real and it was measured where
  it lands rather than as one average:

  - **Label legibility does not move.** Contrast ratio over six label runs (3rd vs 97th percentile
    luminance): `Chicago Union Station` **3.44:1 png → 3.48:1 jpeg**, `W Harrison St` 3.21 → 3.39,
    the same two at night 6.89 → 6.97 and 8.08 → 7.94. Every pair is within ±0.2 and the sign goes
    both ways, so it is measurement noise rather than a loss being rounded off.
  - **Where the loss IS: flat colour fields.** Neighbour-to-neighbour luminance noise in the map's
    uniform areas rises from **0.12 (png — genuinely flat) to 2.47 of 255**, jpeg's block mottle, and
    high-contrast edges shift by a mean of 9.1 with a p95 of 25.

  A single mean over the tile reads 8.33 and would have made this sound worse than it is — the D-DR19
  lesson arriving a second time: quote the percentile over the zone the eye picks out, not the mean
  over everything.

  ⚠ **A derived type caught a conflation the moment the table moved.** `BasemapFormat` was
  `Basemap["format"]`, so making all four jpeg made `png` uninhabitable and `resolveBasemapFormat`'s
  fallback stopped compiling. Two different sets were sharing one name: what OUR basemaps ask for, and
  what the proxy will HONOUR off the wire. The second still includes png, because a request with no
  `format` comes from an older web bundle mid deploy window or from `RouteMapGL`, and deriving the
  allowlist from the table would have silently switched both to jpeg. `BasemapFormat` is now written
  out, with the reason.

  ⚠ **Ordered before the theme-switch caching step on purpose.** That step's candidate fix holds both
  schemes' raster sources in memory at once; two sets of tiles is cheap at 33 KB each and not at
  260 KB. `RouteMapGL` (Fuel Planning) still sends no format and keeps png — one line, and it belongs
  with the colour-scheme fix it is already queued for.

  One test rewritten to loop the table rather than name three literals (so a fifth basemap added in
  png fails rather than passing a list it was never on), **proved by mutation**: reverting `map` to
  png fails both it and the table assertion. The four proxy tests are untouched and still right — the
  API's own default is unchanged.

- **2026-09-16 — D-DR23: each basemap keeps its own layer, and the measurement says why the obvious
  fix would have missed.** The owner reported the map being slow to change between light and dark.
  The perf handoff §3.3 read that as a NETWORK cost — D-DR8's `setTiles` discards maplibre's tiles for
  the basemap being left, so every flip refetches the viewport — and the candidate fix was to stop the
  refetch. Measured first, on the live map at 1512×900 (nine tiles in view) against a stand-in API
  serving real HERE bytes with the proxy's own headers:

  | | tile requests | reached the server | bytes on the wire | last repaint |
  |---|---|---|---|---|
  | flip to an unseen scheme | 9 | 9 | 262 KB | 722 ms |
  | flip BACK to a seen scheme | 9 | **0** | **0 KB** | ~400–440 ms |
  | …and again | 9 | **0** | **0 KB** | ~400–440 ms |

  ⚠ **The second row is the finding.** `Cache-Control: public, max-age=86400` on the tile proxy had
  already solved the network half: every one of those nine requests was served by the browser's HTTP
  cache, zero bytes, ~1 ms each. A fix aimed at the bytes would have moved a number that was already
  zero and been declared a success. What actually costs ~0.4 s is maplibre re-requesting, re-decoding
  and re-uploading nine textures it had a moment earlier.

  **So the fix is a layer per basemap and a visibility toggle**, not a cleverer fetch. Measured after,
  same rig: a flip back to a seen basemap issues **zero tile requests** (was nine) and repaints within
  one sample of the click — **107–117 ms against a 94 ms sampling floor**, i.e. at the resolution
  limit, where it was ~400–440 ms. The first flip to an unseen scheme also improved, 722 → 419 ms,
  because the outgoing basemap now stays on screen until the incoming source reports itself loaded
  rather than blanking the canvas while it arrives.

  ⚠ **Nothing is added up front**, which is the difference from the handoff's sketch: a layer is built
  the first time the reader asks for that basemap, so somebody who never opens the switcher never pays
  for satellite. At most four exist (three choices plus the road map's night variant).

  ⚠ **`beforeId` is load-bearing, not politeness.** maplibre appends a layer with no `beforeId` to the
  TOP of the style, so the second basemap would be painted over the truck markers — a defect that
  would be reported as "the trucks disappeared when I changed the theme". Pinned by "puts a new
  basemap under the layers the caller added, not over them".

  ⚠ **D-DR22 had to land first and this is the proof of that ordering**: holding two viewports of
  tiles is cheap at ~260 KB a scheme and would not have been at the ~2.4 MB png was charging.

  Four new tests, **all four proved by mutation** (dropping `beforeId`, always adding a layer instead
  of reusing one, hiding the old basemap before the new one loads, and forgetting to register the
  style-declared first layer). ⚠ The existing `setTiles` test was REWRITTEN rather than added to — it
  asserted the mechanism this replaces — and the invariant it was really protecting, that the map is
  never rebuilt and the dispatcher's camera survives, is asserted in every case that replaced it.

  **Still open and deliberately not done here:** the proxy buffers each whole tile before responding
  (`mapProxies.ts`, `Buffer.from(await upstream.arrayBuffer())`). Streaming it is a separate change
  with its own failure mode — once bytes are flowing, a 502 JSON can no longer be sent — and at
  ~30 KB a jpeg tile it is worth less than it was at 260 KB.

- **2026-09-16 — D-DR24: the two live maps become one, and the Dispatch tab is the survivor.** Owner's
  ruling, and it **overrules D-DW5**, which held that the map was "both a widget and a full page, and
  neither substitutes for the other". Two surfaces onto one board meant two shapes to keep honest and
  two places to fix a defect — and the glance was the weaker half, because nobody glances at a map:
  they look for a truck, which is work. So `/live-map`, `LiveMapPage.vue`, the sidebar entry and
  `LiveMapPanel.vue` (the card-in-a-grid reading) are all deleted, and the workspace shape is what the
  Dashboard's Dispatch tab renders.

  **The design decision §3.4 of the perf handoff named as unsettled — "the tab is a widget in a grid,
  the workspace is full-bleed, something has to give" — is settled as `span: "workspace"`.** A third
  value beside `full` and `half`, in the widget catalogue, meaning *this widget IS its tab*: no card,
  no gutters, no neighbours, the height of the viewport under the tab strip.

  ⚠ **It is declared in the CATALOGUE and not at the render site, because two processes need the
  answer**: `TabWidgets` reads it to decide whether to draw a grid, and the dashboard ROUTE reads it —
  before the page exists — to decide whether the shell drops its gutters. A boolean in the web app
  would have been the copy with the delay fuse the same file already warns about.

  **So `meta.fullBleed` now takes a predicate, and the dashboard keeps `?tab=` in the URL.** The
  dashboard is a document on Fleet and a workspace on Dispatch, which a static boolean cannot say.
  The tab had to be somewhere the ROUTER could read it, and the URL is the only place it already
  belonged — which closes a gap that was there before: a reload used to drop the reader back on their
  role's default tab however long they had been on another one. ⚠ The signal is NOT a store the page
  writes into: the shell decides its outlet while the page is still being constructed, so a page-sent
  signal arrives a frame late and the map is built at the document's width and then resized.

  ⚠ **`defaultFor: ["dispatcher"]` went with the card**, and that is part of the ruling rather than
  tidying. "The dispatcher sees the map first, an admin adds it if they want it" is sensible about one
  card among nine and absurd about a tab whose only content is that map: an admin opening Dispatch got
  an empty state offering a Customize menu of exactly the thing they had come for. A workspace is not
  arrangeable, so a stored layout hiding it is ignored rather than obeyed — there would be no way back.

  **Measured in a browser at 1512×900**, dev-bypass, real tiles: the map canvas is **1240×731, 67% of
  the viewport**, against **71%** for the `/live-map` page it replaces. ⚠ **That is 4 points WORSE on
  the owner's own complaint**, and it is stated rather than buried: the tab strip costs ~60px the page
  did not spend. The answer is §4's — collapse the sidebar on a full-bleed surface, which measured
  83% — and it lands with the left-rail layout rather than here, because a rail and a sidebar have to
  be decided together.

  `lint:surfaces` gained two detectors rather than one: a workspace widget may not SHARE its tab (the
  card would be catalogued, gated, reachable in the permissions preview and never drawn — the silent
  class this gate exists for) and a tab may hold only one. Both proved to fire.

  ⚠ A bookmarked `/live-map` now lands on not-found. Accepted with the ruling; a redirect to
  `/?tab=dispatch` is the two-line answer if bookmarks turn out to matter.

- **2026-09-16 — D-DR25: the fleet moves into a left rail, and three controls become one.** The last
  step of the live-map queue, and the shape is Samsara's rather than ours: their Fleet Overview Map
  was read on 2026-09-16 and it puts search, filters and the asset list in one left rail with the map
  beside it. DR5 had the same three jobs spread over a "Fleet status" panel in one corner, a "Filters"
  panel in another and a fleet dock across the bottom — three positions, three remembered open/closed
  states, one question: *which truck, and where?*

  **What the rail costs the map, measured at 1512×900 and worth stating plainly:**

  | | map canvas | % of viewport | fleet list |
  |---|---|---|---|
  | `/live-map` page, dock shut (DR5) | 1225×787 | 71% | not on screen |
  | Dispatch tab, dock shut (D-DR24) | 1240×731 | 67% | not on screen |
  | **Dispatch tab with the rail** | **1132×780** | **65%** | **always on screen** |
  | …and the old dock OPEN, for the real comparison | ~1240×394 | **~36%** | on screen |

  So the fleet list went from costing **31 points of map to costing 2**. The headline percentage is
  slightly lower than DR5's and that is the wrong number to optimise: a map with no way to find unit
  1207 is not a better map for being 6% larger.

  **D-DR25a — the sidebar collapses on a full-bleed surface and that is NOT written to
  `localStorage`.** 67% → 79% at 1512, for free, and the reader can expand it back. The rule is
  `sidebarIsCollapsed(stored, fullBleed, override)` in `lib/layout.ts`: what is on screen is derived,
  so leaving the workspace restores their own preference with no restore step existing at all. ⚠ If
  the automatic collapse were stored, one visit here would leave every page in the product collapsed
  with nothing the reader did to explain it — a surface rewriting a global preference as a side
  effect. Pinned by "returns to the stored preference the moment the surface stops being a workspace",
  and by a case proving `false` is a real override rather than "no override" (the bug a `||` gives).

  **D-DR25b — the census IS the filter.** DR5 stated the same four counts twice: a Fleet status panel
  listing Moving 24 / Stopped 0 / Parked 0 / Offline 0, and a Status dropdown whose option labels
  repeated them. Now the counts are the buttons. One fact, one control.

  **D-DR25c — what the dock's seven sortable columns became.** A 320px rail cannot carry seven columns
  (D-DR17's lesson, the fourth time this programme has paid it), so a row is unit · status · age ·
  driver · location, and the ORDERINGS survive as a select: unit, status, oldest fix, fastest. That is
  the deliberate part — "which truck has the oldest fix" is the question a dispatcher actually asks
  and it would otherwise have been dropped silently with the columns. Speed, load and the exact fix
  age live on the truck card and `/vehicles/:id`, which is where `LiveMapVehicleFacts` already says
  depth belongs. ⚠ Unit numbers sort NUMERICALLY: this fleet's units are strings, and
  `localeCompare` without `numeric` puts 1207 before 204, which reads as a broken list.

  **D-DR6's panel MEMORY is deleted with the panels it remembered.** Not just unused — `localStorage`
  panel state is what made a "45% of viewport" measurement wrong during this programme (leftover
  clicking from an earlier run), and a stored "closed" outlives its reason: a dispatcher who shut the
  filters once came back to a map with no visible way to search it. The corner TYPE survives, because
  the selected-truck card is still a floating panel.

  ⚠ **D-LM18 needed a second home, and this is the kind of thing a layout change loses.** The scope
  sentence lived in the dock bar, which was always on screen. The rail carries it at `lg`, but below
  `lg` the rail is a shut overlay — so a dispatcher could work a whole shift on a phone without ever
  reading that the board is fleet-wide. It is now beside the map's own Fleet button too, `lg:hidden`,
  and asserted in both places. ⚠ Its old test asserted `closest("[aria-label]") === null` as a proxy
  for "not inside a dismissible panel"; the rail is a labelled landmark, so the proxy failed on
  correct markup. The property is now asserted directly.

  **Overlap re-measured at 1512, 1280 and 390, including the vendor's DOM** (the DR5 trap): none.
  ⚠ The first run of that check reported four, every one a false positive — a `pointer-events-none`
  full-height wrapper and an SVG's `className` object. A check that counts boxes which paint nothing
  is as useless as one that ignores maplibre; it now compares only elements that paint.

  ⚠ The mobile bar is pinned TOP, not bottom, and the second reason is a measurement worth keeping:
  `<main>` is `100dvh-4rem` and the environment banner is a sibling ABOVE the shell, so the document
  scrolls by the banner's height — 28px at 1512 and **64px at 390, where it wraps to two lines** —
  and anything on the bottom edge is under the fold. That is DR5 follow-up 2, still open, and it is
  the banner alone: this tab's strip lives inside `<main>` and takes its height from the same box.

- **2026-11-01 — D-DR16 page half BUILT** by the sidebar redesign (`SIDEBAR-REDESIGN-PLAN.md` D-SB1):
  ⌘K / Ctrl K and a "Search pages" field go to any page the caller can open. Record search stays open
  there as Q-SB1.

- **2026-11-09 — D-DR26: the map is sharp and names a truck stop a zoom earlier.** The owner: "the
  map is a little blurry", and "when I zoom in I don't see place names — I can't tell whether the
  truck is at a truck stop; on Google Maps I can". Both were one setting. Every map asked HERE for a
  512-pixel tile and laid it over 512 CSS pixels, so a Retina screen stretched it 2×. And HERE
  prints a business name only from tile zoom 17, which those tiles reached at map zoom 16.5. Now every
  map asks for a 512 tile at `ppi=200` and lays it over 256 CSS pixels (`TILE_REQUEST`,
  `TILE_CSS_PX` in `@silvicom/shared` basemap.ts, which carries the measurements). In the real app,
  real HERE tiles, a truck parked at the Pilot in Joliet, map zoom 16: before, two bare "P" pins;
  after, "Pilot Travel Center" twice, house numbers and bus stops, on a Retina AND a standard screen.
  ⚠ The first build gave standard screens a 256 tile at ppi 100 ("one pixel per pixel") and it drew
  bare pins there too — HERE decides names by ground resolution per pixel, so only the ppi-200 tile
  names the place; maplibre mipmaps raster textures, so shrinking it 2× on a standard screen is
  clean. ⚠ Cost, measured on the same zoom walk 9→21: **125 → 262 tile requests (DPR 2), 135 → 268
  (DPR 1)** — about 2×. The fleet's monthly HERE tile count is still unmeasured (Q-LM21). ⚠ Found on
  the way: today's map asked for 10 zoom-21 tiles at the deepest zoom, each refused by the proxy
  (HERE stops at 20); the raster sources now carry `maxzoom: 20` and the walk's deepest request is
  20. ⚠ Two more places restated the old tile and moved with it. The `/api` rate limits were sized
  on a busy seat of ~600 a quarter-hour (180 polls + ~420 tiles); doubled tiles make it ~1 020, and
  the 18 000 per-address ceiling would have refused a full 30-seat office at once — C1's outage
  (`LIVE-MAP-CONCURRENCY-PLAN.md`). Per caller 1 200 → 2 100, per address 18 000 → 31 000, the
  derivation in `apiRateLimit.ts`. And the tutorial recorder's HERE stub hardcoded `size=512`; it now
  uses the proxy's resolver. Not in this step: the "At: Pilot Travel Center — truck stop" line on the
  truck card, from HERE Browse (category `700-7900-0132`, confirmed with our key) — the direct answer
  at fleet zoom.

- **2026-11-09 — D-DR27 (PROPOSED, awaiting the owner): the map draws place names itself, from HERE's
  place data.** What the owner asked for, in their words: "when we zoom … display name on map. And not
  just truck stop, all locations we have available names for." That means names on the MAP, like
  Google Maps: every named place, no filter, no card line. (The truck-card "At:" line, D-LM31, was
  the wrong answer to this and is reverted in #2167.) D-DR26 already gained one zoom. What follows
  was measured with our key over the Joliet Pilot (41.4805, −88.0792):
  - ⚠ **One more step of the D-DR26 trick does not work.** It was the plan: lay tiles over 128 CSS
    px at `ppi=400`. HERE was asked directly. A ppi-400 tile names exactly what the ppi-200 tile of
    the same tile zoom names, with type only ~10–15% larger, not 2×. Laid over 128 px it would draw
    names at ~55% of today's size, about 7 px. Raster tiles cannot name a place earlier than they do.
  - **HERE's vector tiles carry the names, with HERE's own threshold.** Layer `pois` holds `name`,
    `kind` and `min_zoom`, and a POI appears one tile zoom before its `min_zoom`: fuel stations
    (min 14) are already in the zoom-13 tile, and the Pilot (min 17) is in the zoom-16 tile. Layer
    `places` holds localities only.
  - **The raster can drop its own pins.** `&features=pois:disabled` returns 200 and keeps streets,
    shields and house numbers. Our layer then never doubles HERE's.
  - ⚠ **maplibre pins a vector source at tileSize 512** and ignores the layer silently when a
    different size is given. So "ask one zoom deeper", which D-DR26 did for rasters, is impossible
    for vectors. The prototype instead folds the POIs of the next one or two zoom levels into each
    tile on the server, unioned with the tile's own: HERE drops some POIs (a school, a courier)
    from its deepest tile, so the deeper level alone LOSES names.
  - **Result, in a browser, real HERE data, standard screen** (comparison sheet in the owner's
    handoff). Map zoom 14: today, no business names; one level ahead, Food-N-Fuel and FedEx; two
    levels ahead, Pilot Travel Center, Food-N-Fuel, a truck repair shop, a café, a school and about
    ten more. Zoom 15: today, two names; one level ahead, eight. A dot and its name are ONE symbol
    (`styleimagemissing` draws the dot), so they cannot separate. Where names collide, fuel and
    parking win, then repair (`symbol-sort-key`). Dots always draw; a name without room is dropped.
  - ⚠ Not solved by the prototype: our names can sit on HERE's baked-in road labels, because
    maplibre cannot see text inside a raster. Measured: one overlap per busy intersection. Only a
    fully vector basemap (option B in the handoff) removes it.
  - **To build it:** glyphs. maplibre renders no text without a `glyphs` URL. The prototype
    borrowed demotiles.maplibre.org; the build serves PBF glyphs generated from LiberationSans
    (already in `apps/api/src/lib/fonts/`) from our own API. The same endpoint is what truck markers
    need to carry unit numbers. Blocked on Q-DR4.
- **2026-11-10 — D-DR28: a zoom no longer waits on two maplibre defaults sized for the old 512 map.**
  The owner, the morning after D-DR26: zooming in and out is slow and tiles load slowly. Measured on
  the staging Dispatch map, signed in (1512×900, devicePixelRatio 2, Chicago, zoom 4 → 17 and back):
  408 tile requests, 170 abandoned mid-zoom, the proxy answering in 191 ms p50 / 262 ms p90, one long
  task, no dropped frames. So the map is slow to FETCH tiles, not to draw them. D-DR26's tile count
  (154 → 410 on the same walk, 2.7×) is what any Retina-sharp raster map costs, and it is not reverted.
  - **A/B in a rig** (maplibre 5.24.0 over HTTP/2 as production serves it, real HERE bytes plus the
    proxy's measured extra hop, cold cache, 18 one-level zooms timed from "zoom finished" to "map
    idle"), p50 over four runs: today 1.35–1.65 s; **no raster fade + 32 parallel requests
    0.69–0.98 s**; a 100 ms fade keeps most of the cost (1.08–1.61 s), because maplibre holds the
    parent tile until the child's fade ends; 32 parallel alone 1.22–1.31 s. Shipped:
    `raster-fade-duration: 0` on every raster layer and `setMaxParallelImageRequests(32)`, both in
    `useMapLibre.ts`, so Fuel Planning's route map gets them too.
  - **Measured and not shipped:** a server-side tile cache cut HERE requests on a repeat walk from
    ~440 to 8–13, but did not shorten the wait (the hop to HERE was not the bottleneck). It saves
    billing, not time, and whether HERE lets us keep tiles is Q-DR4's question. A bigger in-memory
    tile cache (`maxTileCacheZoomLevels`) was within noise, and at 1 MB of texture per 512 tile it
    is not free.
  - ⚠ **For D-DR27:** an overlay that costs 5–21 vector tiles per map tile goes through the same
    16/32-request queue as the basemap. Its build has to be timed on this walk against these numbers,
    not just checked for names.
  - Open: Q-DR29 (tiles share the general rate limit with the board's polls).
- **2026-11-10 — D-DR29: map tiles have their own rate-limit budget, so zooming can no longer stop
  the dispatch board refreshing.** Answers Q-DR29. A tile now counts against a tile pair: per
  caller 4 100 per 15 minutes (ten of the measured 410-tile heavy zoom walks), per address 24 600
  (thirty seats making two such walks each). The general pair skips tiles and is otherwise
  unchanged. Its 2 100 / 31 000 now have more room than polls need; lowering them is a separate
  call. Both pairs read one predicate (`isMapTileRequest`, `apiRateLimit.ts`), so each is the
  other's complement. ⚠ Built on the measured walk, not on production 429 counts (no AWS
  credentials in the session). Reading a week of `[metrics]` 429s by route is still worth doing
  after it ships, to retune both numbers.
- **2026-11-10 — D-DR30: tiles wait for their turn instead of coming back blank when HERE is
  busy.** Measured that afternoon: 40 simulated dispatchers zooming at once through staging drew
  HERE `429 "Rate limit for this service has been reached"` on 17–21% of tiles in two of three runs,
  each one a blank 502 square. Sent straight to HERE, the same burst was refused 34% of the time at
  ~400 a second.
  - **Built:** a pacer in front of HERE (`modules/routing/tilePacer.ts`). A token bucket of 80 a
    second per process with a burst of 100. Waiting tiles are queued per caller and released
    round-robin, so one heavy zoom cannot hold 39 other people behind it. A tile the reader cancels
    while queued is never sent, so it is never billed. A tile HERE still refuses is retried once
    after 250–600 ms (or HERE's `Retry-After`, capped at 2 s), then answered 503 `tile_upstream_busy`.
    Every error tile is `Cache-Control: no-store`. The per-minute `[metrics]` line gains `hereTiles`
    (immediate, queued, longest wait, busy, abandoned, refused429, retried, retriedOk), so
    production's real limit can be read. The tile address ceiling is sized for 40 seats (32 800 per
    15 minutes), up from 30.
  - **Measured on a local rig** (the real app, two replicas as production runs, a stand-in HERE
    refusing past 200 a second with 150 ms latency, 40 readers × 60 tiles at once):

        main's code   415 tiles served · 1 985 blank (83%) · HERE refused 1 985
        this change   2 400 served · 0 blank · HERE refused 4, all retried and served
                      median 6.4 s, slowest 8.6 s for the whole office's first view
        one reader alone: median 163 ms (the stand-in's own 150 ms), so no added wait

    ⚠ The first draft let a tile wait 6 s and 1 234 of the same 2 400 came back "busy". That is a
    blank square by another name, so the wait is 20 s.
  - ⚠ Not measured against HERE itself. Doing so would spend production's limit (Q-DR31). The
    pace is a guess under the measured refusals until HERE answers Q-DR30.
  - **Not built, on purpose:** an in-app monthly tile budget alarm. HERE's own usage alerts count
    what HERE actually bills, across every replica and environment. A count kept here would be a
    second, less accurate copy of the same number. The owner sets those alerts in the HERE console.
  - **Proposed next, D-DR31:** the vector basemap. Measured in the rig on the same 18-zoom walk: 140
    requests against 410, 0 abandoned against 49, 6.2 MB against 11 MB, at $0.088 instead of $0.12
    per 1 000. It also brings place names with no overlay (D-DR27) and nothing modified server-side
    (Q-DR4's terms concern).
- **2026-11-10 — D-DR32: the tile fade is back. D-DR28's "half the wait" was mostly the metric.**
  The owner, the same afternoon: tiles "are loaded in a weird way and look really bad and not
  natural". A video of a zoom on the staging map shows a patchwork. A raster tile has its labels
  baked in, so with no fade each square snaps on its own from the previous zoom's large,
  edge-clipped labels ("Hebrc", "Woodsto", "Ri" beside "Ringwood") to the new small ones. And the
  gain D-DR28 reported for turning the fade off was largely an artefact: the rig timed "zoom
  finished → map `idle`", and `idle` waits for running fades to end, so a 300 ms fade adds ~300 ms
  to that number even when every tile has arrived. ⚠ Lesson: measure when the TILES arrive, and
  look at the motion, not only a timer. The fade is maplibre's default 300 ms again, written out
  with this reason beside it. The 32 parallel requests stay (1.35–1.65 s → 1.22–1.31 s on their
  own, a gain the fade artefact cannot explain, because both arms of that comparison faded). The
  patchwork itself is a property of raster tiles. Removing it is one more reason for the vector
  basemap (D-DR31, proposed in the D-DR30 entry above).
- **2026-11-10 — D-DR31 (BUILT AS A STAGING TRIAL, awaiting the owner): a vector road map, drawn by
  maplibre from HERE's vector tiles.** The owner ruled "proceed as proposed": build it on staging
  behind a switch and compare it with today's map before it replaces anything.
  - **Why.** The raster road map's sharp tiles cost 2.7× the requests (D-DR26). That count made
    zooming slow (D-DR28), made HERE refuse tiles when an office opens the map together (D-DR30), and
    its baked-in labels make a zoom a patchwork (D-DR32). Measured in the rig on the same 18-zoom walk:
    140 vector requests against 410 raster, 0 abandoned against 49, 6.2 MB against 11 MB, $0.088
    against $0.12 per 1 000. Place names come with the data, with no overlay (D-DR27) and nothing
    modified server-side (Q-DR4).
  - **Built.** `GET /api/fueling/map-tiles/vector/:z/:x/:y` (HERE `vector.hereapi.com/v2/vectortiles/base`,
    max zoom 17) and `/map-tiles/glyphs/:fontstack/:range` (HERE's two style fonts only), both through
    the D-DR30 pacer, the tile budget and the sign-in. Our own style (`composables/vectorBasemap.ts`):
    HERE publishes a maplibre style, "berlin", but it is a dark grey demo with no places, no road
    numbers, every traffic light drawn as a dot, and a night variant that answers 404. Colours are 13
    new `--map-*` tokens, sampled from HERE's explore.day and explore.night tiles so the map keeps its
    look, with a theme switch repainting in place. Truck stops, truck repair, rest areas and fuel win
    the room to be named first (HERE `pds_category`). Offered as "Map (vector trial)" in the basemap
    menu only where the build names a non-production environment. That is a labelled workaround for
    the missing per-environment feature flag.
  - **Found on the way.** The "© HERE" credit was missing on satellite and terrain. Only the first
    source carried it, and maplibre credits only sources a visible layer uses (it already dedupes).
    Every source now carries it (HERE Platform Terms §13.1).
  - **Proven so far.** maplibre's own validator passes both schemes with 0 errors. The style loads in
    a browser against real HERE tiles. Day, night and three zooms were compared by eye with the raster
    map. The browser caught a label-size rule maplibre refuses, which blanked the whole style; a
    unit test now pins that rule. Not yet: the side-by-side video on staging, request counts in the
    real app, and drawing cost on a slower office PC. Those follow this merge, on staging.
  - Open: **Q-DR33** — HERE sends no caching header on glyphs, so the browser re-fetches them on
    each map load (~74 KB per character range). Fira GO is an open font (SIL OFL), so a cached build
    of our own is possible. Recommendation: only if the glyph route shows up in `[metrics]`.
- **2026-11-10 — D-DR31 follow-up: the vector trial drew a blank map on staging, and the cause was
  a header, not the style.** HERE gzips its vector tiles; `fetch` decodes them, but the proxy still
  forwarded HERE's `content-length` (the ENCODED size, 72 956 bytes against 107 391 decoded), so the
  browser read every tile short and maplibre could parse none. The unit tests passed because no
  stub sent an encoding; the rig passed because its proxy buffered and set no length. Fixed: the
  length is forwarded only when the bytes are HERE's own, and vector tiles (protobuf, which
  `compression` does not list) are compressed on the way to the browser, so they do not cross at
  full size. ⚠ Lesson: the only test that counts for a proxy is one through the real deployment;
  the staging walk is what found this.
- **2026-11-10 — D-DR31 on staging, measured.** With the length fix (#2202) live, the same
  signed-in zoom walk on the staging Dispatch map, two alternating runs each: **today's map 97–102
  tile requests, the vector trial 32–34** (67% fewer), with no page errors. The first staging look
  showed country roads vanishing: they were white on near-white land at regional zoom. They now
  start in the highway-casing blue-grey and fade to white with a casing once zoomed into a town, the
  way HERE's raster map draws them. Ordinary roads' route numbers appear only from zoom 10, because
  printing them from 6 was far busier than today's map.
  - ⚠ **The cost the owner should weigh: drawing work moves to the reader's computer.** Chrome at
    normal speed and at 4× CPU slowdown (an older office PC), the same 11-step zoom sequence, five
    interleaved runs each, medians: today's map 0 frames over 50 ms at either speed; the vector map
    4 at normal speed and 17–43 at 4× slower, with 0.5–2.7 s of main-thread work across the
    sequence. It still finishes the sequence 1–2 s sooner. Hiding most labels barely changed it
    (13–52 stutters with no labels at all), so the extra work is the vector map itself, not this
    style. A real office PC check is still owed.
- **2026-11-10 — D-DR33: the owner's ruling on the vector map. Polish it, compare it, then switch,
  with an escape hatch. Build without assumptions.** Order: polish on staging (icons, shields per
  network, land colours, regional road density, night check); the owner compares side by side,
  including on the slowest office PC, and the vector map is dropped if it stutters too much there;
  then it becomes the default with "Map (classic)" kept for two weeks. Rebuilding on Google Maps was
  weighed and not chosen. The working rules, the measured facts and the task list with acceptance
  checks are in `docs/plans/livemap/HANDOFF-2026-11-10-VECTOR-MAP.md`. ⚠ The same day showed that
  `TRUCK_PLACE_CATEGORIES` (from HERE Browse) matches nothing in the vector tiles. That is the
  polish step's first item, and Q-DR34.
- **2026-11-11 — D-DR34: truck places come from HERE's advanced tile, fetched at zoom 13 only.**
  Measured with our key, not inferred (Q-DR34 (c)): the default vector tile names the Joliet Pilot
  only as an ordinary "Parking Lot" (800-8500-0178, HERE's category list), so a brand-name match on
  it would have been a heuristic over the wrong category. The same tile with
  `content=default,advanced_pois` adds truck stop 700-7900-0132 and truck parking 700-7900-0131 at
  `min_zoom` 13; across 24 zoom-13 tiles (Joliet, Indianapolis, Dallas) 17 truck stops, 19 truck
  parking lots (Pilot, Flying J, TA, ONE 9, the "Truck & Trailer Parking" lots the default tile
  lacked) and 4 rest areas (Love's, TA). Advanced tiles bill $0.239 per 1 000 against $0.088, so
  the vector map gains ONE second source fetched at `TRUCK_PLACES_ZOOM` = 13 alone and overzoomed
  closer in; the proxy's `/map-tiles/truck-places/` route refuses every other zoom, and the
  `[metrics]` line counts `advancedTiles` so the cost is visible in production. The truck layer
  sits above ordinary places (maplibre places symbol layers top-down, read in the installed 5.24
  bundle) and below towns. Truck repair stays open in Q-DR34. Cost of the extra source to be
  measured on staging, not estimated, before the owner's comparison.
- **2026-11-11 — D-DR34 accepted on staging; a font bug found and fixed.** With #2231 live
  (`f1af060`), `tools/staging-truck-places.mjs` at the Joliet Pilot: at zoom 16 maplibre rendered
  "Pilot" (700-7900-0132) in bold; at 13 the Pilot and two "Truck & Trailer Parking" lots; at 12
  none, as designed. Every `truck-places/` request was zoom 13 (7 on that walk) and answered 200. ⚠
  The same run showed every glyph request refused with a 400 since D-DR31: the style asked for
  `0-255`, the relay and HERE need `0-255.pbf`. maplibre fell back to drawing every label with the
  browser's font on the reader's CPU, warning only in the console. Fixed with one shared rule
  (`VECTOR_GLYPH_RANGE_FILE`). The D-DR31 slow-PC stutter figures were taken in that state, so they
  are re-measured (polish item 7) before the owner's comparison.
- **2026-11-11 — D-DR35: place icons on the vector map, polish item 2.** Artwork: six Maki v8.0.0
  icons and Temaki v5.13.0's truck; both repositories' LICENSE files read, CC0 1.0. Bundled from
  `apps/web/src/assets/map-icons/` (`SOURCES.md` pins the tags), so the content security policy is
  unchanged (`img-src` already allows `data:`). Icons go to the kinds read off real tiles, not guessed:
  `fuel`, `parking`, `car_repair`, `hospital`, `aerodrome` (O'Hare terminals, 400-4000-4582) and
  `station` (Joliet, 400-4100-0035); every truck place (D-DR34) carries the truck. Drawn as a disc in
  `--map-label` with the glyph in `--map-label-halo`, so no new tokens and the night map inverts them.
  Rasterised once per colour scheme while the session is read, handed over on maplibre's
  `styleimagemissing`, replaced in place on a scheme change. All seven decode and draw in Chromium
  (checked before the PR); the style passes maplibre's validator; 7 of 7 mutations caught.
  Acceptance is on staging: icons visible, no 404, CSP or "image could not be loaded" console error.
- **2026-11-11 — D-DR35 accepted on staging.** With #2245 live (`4aef8e1`), the Joliet Pilot at zoom
  16 shows the truck icon beside "Pilot", the parking icon beside "Pilot Travel Center" and the fuel
  pump beside "Food-N-Fuel"; the only console error on the page is the notifications 403 that test
  member's role gets, unrelated to the map.
- **2026-11-11 — D-DR36: route numbers on road signs, one shape per kind of road (polish item 3).**
  Sampled before writing the rule, as the handoff asked: zooms 9 and 12 over Dallas, Houston,
  Indianapolis, Gary, Columbus and Toledo gave `network` values `US:I` 243, `US` 11, a state
  `US:<ST>` (TX 319, OH 175, IN 77, IL 61, MI 12) and a county `US:<ST>:CR` (OH 98, TX 2, IL 1),
  nothing else. So interstate, US route, county (`:CR`) and state (everything else). Signs are our
  own plain outlines drawn on a canvas in the FHWA sign colours, five new `--map-shield-*` tokens
  (`lint:token-gamut` passes; the yellow's chroma came down 0.0005 to fit sRGB), sized per number
  length (1–4 characters, widths chosen by drawing "8", "80", "35E", "1234" in Chromium). The rule
  was evaluated with maplibre's own expression engine against every measured network, all right,
  and the style validates; that check is out of tree (`tools/shield-rule-check.test.ts.txt`)
  because the web app does not declare `@maplibre/maplibre-gl-style-spec`, and declaring it
  re-resolves a lockfile that has already drifted (expo-router and TypeScript peer entries), which
  is not this change's to carry. In-tree tests pin the rule's literals, the image ids and colours;
  7 of 7 mutations caught. Acceptance: a zoom-9 staging still shows the right shapes.
- **2026-11-11 — D-DR36 accepted on staging** (`baffa99`, `tools/staging-map-views.mjs`). Joliet at
  zoom 9: interstate shields on I-80, I-55, I-355, I-57, I-88, I-94 (rendered: `US:I` ×8, nothing
  else, because ordinary roads' numbers start at zoom 10 by design). Columbus at zoom 11: `US:I` ×9,
  state boxes `US:OH` ×12 (33, 23, 315, 104), county pentagons `US:OH:CR` ×7 (3, 11, 258). No map
  console errors.
- **2026-11-11 — D-DR37: land colours for the measured land uses (polish item 4).** Sampled first:
  zooms 11 and 14 over Joliet, O'Hare, Indianapolis, Dallas, Columbus and the Loop gave `landuse`
  kinds park 73, urban_area 11, sports_centre 11, industrial 11, aerodrome 7, commercial 7,
  national_park 6, forest 5, runway 4, zoo 3, university 3, hospital 3, military 2, cemetery 2,
  beach 1. Before this, sports_centre, zoo, aerodrome, runway, university, hospital, military and
  beach were not drawn at all, and industrial was drawn as town. Now sports_centre and zoo join park,
  and a `landuse-detail` fill gives industrial/military, hospital, university, aerodrome, runway
  (sorted above its aerodrome) and beach six new `--map-*` tokens, each in the lightness band of
  the existing land colours in both schemes (`lint:token-gamut` passes). The style validates;
  5 of 5 mutations caught. Acceptance: staging stills over O'Hare and an industrial area.
- **2026-11-11 — D-DR38: regional road density (polish item 5), proposed to the owner with stills.**
  Staging stills of today's map and the vector trial at the same spots, zooms 7–10 around Joliet
  (`tools/staging-map-views.mjs`; the raster needs `WAIT_MS=15000` to settle at regional zoom).
  At 9 and 10 the vector map drew a dense blue-grey grid the raster map does not, and at 10 it put
  25 county numbers on screen. Measured on the tiles behind those stills: the zoom-9 tile's 92
  major-road lines were 71 `tertiary` (HERE starts them at 9), 17 secondary, 4 primary; the zoom-10
  tile's 57 route numbers were 29 county, 24 state, 4 interstate. So tertiary roads and county
  numbers now start at zoom 11 (`REGIONAL_DETAIL_ZOOM`), everything else unchanged. The rule is
  tested by evaluating the filters on features (4 of 4 mutations caught); the style validates.
  Acceptance is the owner looking at the before/after stills.
- **2026-11-11 — D-DR38 after, and the night map checked on staging (polish item 6).** With #2250
  live (`da690d8`), Joliet at zoom 10 shows 18 state and 7 interstate numbers and no county ones, and
  the tertiary grid is gone; county numbers and local roads arrive at 11 (18 county numbers there).
  Night scheme, `tools/staging-map-views.mjs` with `COLOR_SCHEME=dark`: Joliet at 16, O'Hare at 13
  and Columbus at 11 draw dark land and roads, light labels, inverted place icons, airport grounds
  and runways in their night colours, and the road signs in their fixed sign colours. Choosing Dark
  in the account menu repaints the map in place (`SWITCH_VIA_MENU=1`). ⚠ **The OS turning dark while
  the app is open did not** (`SWITCH_TO_DARK=1`): the app went dark and the map stayed light.
  `useColorScheme`'s `isDark` read `matchMedia(...).matches` inside a `computed`, which touches
  nothing reactive, so it was computed once and never followed the OS. That is in production too, for
  today's map (its night tiles) and the truck markers. Fixed in `useColorScheme` with a reactive
  system preference fed by the media query's `change` event; the new test fails on the old code.
- **2026-11-11 — #2254 accepted on staging:** with `a06e40c` live, the OS turning dark mid-session
  (`SWITCH_TO_DARK=1`) now repaints the vector map dark with the page.
- **2026-11-11 — Item 7, the re-measure on staging, after the font fix.** `tools/staging-map-frames.mjs`:
  staging itself (`a06e40c` at start and end, so one build throughout), signed in as the dispatcher
  test member with 236 live trucks, the 11-step zoom sequence of `staging-map-compare.mjs`, Chrome
  at 4× CPU slowdown, 5 alternating runs of each. Ranges:

  | | today's map | vector trial |
  | --- | --- | --- |
  | frames over 50 ms | 9–161 | 21–114 |
  | longest single frame | 83–158 ms | 283–599 ms |
  | main-thread long tasks | 0.1–8.6 s | 0.7–11.1 s |
  | tile requests | 92–93 | 31–35 |
  | sequence time | 12.8–13.3 s | 12.8–13.7 s |

  What this does and does not say. ⚠ The run-to-run spread is wider than the gap between the maps
  on stutter count and long-task time: today's map ran 9 and 161 in two runs a few minutes apart,
  with 8 s of long tasks in two runs and 0.1 s in another. That load is the live app (236 trucks,
  the positions poll), not the basemap, and the rig of D-DR31, which had no trucks, never saw it
  (0 frames over 50 ms for raster there). So five runs cannot rank the two maps on those numbers.
  The one measure that separates them in EVERY run is the longest frame: today's map never froze
  past 158 ms; the vector trial froze 283–599 ms at least once in each run, a pause a reader can
  see. Tiles are a third of today's, as measured before. The font fix did not remove the freeze.
  Next, before the owner's office-PC check: find what that single long frame is (a performance
  trace of one vector run), since it, not the average, is what a dispatcher would call "stutter".
- **2026-11-11 — ⚠ Correction to every speed figure for the vector map so far, including D-DR31's
  and the entry above: they were drawn in SOFTWARE.** Profiling the vector trial's longest freeze
  (`tools/staging-map-freeze-profile.mjs`) found 87–92% of each 0.7–1.0 s stretch in "(program)",
  native work, with maplibre's own JavaScript at 50–90 ms. Headless Chrome on this Mac draws WebGL
  with SwiftShader, a CPU renderer ("SwiftShader Device"), which no office PC with a graphics chip
  uses and which costs a vector map far more than raster images. With `GPU=1` it draws on the Mac's
  M4 Pro instead (`staging-map-frames.mjs` prints the renderer). Same staging build (`20fe457` at
  start and end), same sequence, 4× CPU slowdown, 5 alternating runs:

  | | today's map | vector trial |
  | --- | --- | --- |
  | frames over 50 ms | 0–1 | 0–4 |
  | longest single frame | 50–66 ms | 50–108 ms |
  | main-thread long tasks | 0 s | 0–0.23 s |
  | tile requests | 112–116 | 42–44 |

  The 0.1–8.6 s of long tasks today's map showed above vanished as well, so that noise was the
  software renderer drawing the page, not the live app. The two runs bound the office PC: software
  rendering is a floor no real PC sits at, and an M4 Pro is a ceiling well above an office PC's
  built-in graphics. Between them the vector trial is about as smooth as today's map with a real
  GPU (worst frame up to 108 ms in one run of five) at 38% of the tiles. The deciding check is the
  owner's, on the slowest office PC, now worth doing.
- **2026-11-11 (evening) — the remaining vector-map work re-read against the code; D-DR39 proposed.**
  `HANDOFF-2026-11-10-VECTOR-MAP.md` §10 is the working list from here. The finding: the truck
  source is rewritten with `setData` on every animation frame while any tween runs, and tweens
  outlast the poll by design (D-LM8a/b), so over 236 trucks the loop never stops in working hours.
  maplibre 5.24's `_updatePlacement` (read in the installed copy) marks placement stale on any
  changed symbol bucket and then walks EVERY symbol layer, so the raster map pays for one layer and
  the vector map for six. The two "speed" items were one cause, and it is in production today. A
  65 mph truck needs ~950 frames to move one pixel at zoom 7 and ~7 at zoom 14 (corrected in the M1
  PR from ~1 900 and ~15, which used a 256-pixel world), so the write is
  wasted at every zoom a fleet is watched from. **D-DR39 (proposed): write the truck source only when
  a dot has moved a CSS pixel at the current zoom, both maps, as its own production PR**; the tweens
  stay as D-LM8a/b set them and `updateData` is not the lever (§10.2 has why). Capacity for 50 seats
  from the measured numbers (§10.3): production runs two API replicas, so the pacer's 160 tiles a
  second holds; a 50-seat cold start drains in ~17 s on raster and ~6 s on vector, and only the
  vector map survives a single replica inside the 20 s wait. The poll path (C1–C3) is already sized.
  Ten gaps recorded in §10.4; Q-DR35 (self-hosted OSM tiles) and Q-DR36 (the escape hatch is not
  remembered) opened in §6; Q-DR34 gains candidate (d). PR #2262 merged the same day.
- **2026-11-11 (night) — D-DR39 BUILT: the truck source is written when a dot has moved a pixel.**
  `redrawDue(drawn, sampled, { zoom, latitude, iconRadiusPx }, tolerancePx)` and `metresPerPixel`
  in `liveMapMotion.ts`; `LiveMapCanvas.vue`'s `step()` still samples every tween and moves the
  popover every frame, but writes the map only when some dot has moved more than one CSS pixel on
  the ground or by its arrow's tip (15 px radius, so about 4°), and once more with zero tolerance as
  the motion settles so every dot ends on its fix. Membership, selection and card changes stay
  unconditional writes. Every write dispatches a `livemap:write` event on `window` for a measuring
  page; `staging-map-frames.mjs` counts them over a 10 s still hold at the fitted zoom and over the
  zoom walk. `planFleetFit` moved out of the canvas into `liveMapCamera.ts` (pure, tested) to keep
  the file under the 500-line budget (497). Tests: 13 new in `liveMapMotion.test.ts`, 4 in
  `liveMapCamera.test.ts`; nine mutants (gate always writes, 256-px world, heading ignored, long way
  round the compass, size change ignored, arrow appearing ignored, default tolerance zero, bounds
  inverted, selection ignored) each failed. Not yet measured: the staging write rate and the longest
  frame of both maps after the gate — owed as the first entry after this serves on staging, before
  the owner's office-PC check.
- **2026-11-12 — D-DR39 measured on staging (PR #2273 merged 2026-11-11 22:51 UTC, staging serving
  it from 23:53).** `tools/staging-map-frames.mjs` with `GPU=1`, 4× CPU slowdown, the dispatcher
  test member, two sessions of 5 alternating runs each (the second ended at run 4 of 5 on a login
  timeout). Truck-source writes, which are counts and so survive a busy machine:

  | | today's map | vector trial |
  | --- | --- | --- |
  | writes a second, 10 s still at the fitted zoom (≤ 9), session 1 | 0.7–3.6 | 0.4–2.7 |
  | same, session 2 (08:30 CST, the fleet in motion) | 3.5–4.6 | 4.6–5.6 |
  | writes over the 13 s zoom walk, session 1 | 33–82 | 37–78 |
  | same, session 2 | 70–124 | 96–123 |

  Before the gate every frame was a write: ~60 a second still and ~780 over the walk, on both maps.
  So the gate removes 90–99% of the writes, and the vector map's placement pass now runs a few
  times a second at most instead of sixty. The writes that remain at the fitted zoom are the
  fleet's own: at zoom 9 a pixel is ~114 m, a board arrives every 5 s, and any of 220 trucks turning
  its arrow four degrees is a write — a 220-truck fleet in the morning rush does that a few times a
  second, which is the figure to expect.

  ⚠ **The frame times from both sessions are NOT a measurement of the map and are not recorded as
  one.** Session 1's zoom walks took 913–1 999 s of wall time for a 13 s sequence in six of ten runs
  (the browser was stalled, not slow); session 2 ran at a machine load average of 19–30, from the
  other sessions' builds and tests on this Mac, and gave worst frames of 141–1 142 ms on BOTH maps
  against 50–108 ms the day before on the same tool and build. A frame figure taken under that load
  says nothing about either map. The tool now prints the load average with the renderer, and a
  run is only recorded when it is under about 4. Owed: the frame-time comparison on a quiet
  machine, five alternating runs — then the owner's office-PC check (HANDOFF §10.4 gap 2).
- **2026-11-12 (later) — the office-PC check gets its protocol and its number (HANDOFF-2026-11-10
  §10.4 gap 2; the first two pieces of M3, pulled ahead of M2 because the owner's check needs them
  and neither waits on the glyph licence).** The page is
  `docs/plans/livemap/OFFICE-PC-CHECK-2026-11-12.md`: `chrome://gpu` first (WebGL hardware or
  software, the GL_RENDERER line), Chrome or Edge, a quiet hour while the HERE key is shared
  (Q-DR31), four alternating passes of the rig's sequence (10 s still, 7 double-clicks in, 4 wheel
  notches out, a pan), then one pass per map in the dark scheme, a table with a still and an end
  reading per pass, and how to read it. The number is a long-frame counter under the basemap choices
  on trial builds only (`liveMapLongFrames.ts`, shown by `LiveMapControls.vue`), from the browser's
  `longtask` observer — the same quantity `staging-map-frames.mjs` prints as long-task, so the office
  figure and the rig figure sit in one table — restarting on every basemap change so each figure
  belongs to one map: count, elapsed seconds and the worst task. Firefox and Safari are told they
  cannot count rather than shown a zero. Seven mutants (worst kept as a minimum, no restart on a
  basemap change, observer never disconnected, always observable, count not bumped, interval leaked,
  counter on a production build) each failed their tests. ⚠ Still owed before the owner runs the
  page: the quiet-machine frame-time comparison (this Mac at load average 18–26 all morning). Left
  in M3: remembering the basemap for the window (Q-DR36) and the raster fallback on a style error.
- **2026-11-12 (afternoon) — D-DR40: the vector map's label glyphs are our own static files, and the
  HERE glyph relay is gone (HANDOFF-2026-11-10 §10.4 gap 3, M2). Q-DR33 closed.** The licence was
  read before anything was built: FiraGO's `OFL.txt` (bBoxType/FiraGO, master) is the SIL Open Font
  License 1.1, copyright Carrois Corporate GbR and HERE Europe B.V., with NO reserved font name, so a
  format conversion (a "Modified Version" under the licence's own definition) may be bundled with
  software provided the copyright notice and licence travel with it. They do: `OFL.txt` sits in
  `apps/web/public/fonts/glyphs/` beside the files. The glyphs were built from FiraGO 1.001's
  `FiraGO-Regular.ttf` and `FiraGO-Bold.ttf` with fontnik 0.7.7 (in a scratch directory, not a repo
  dependency: its install script is native), all 256 ranges of 256 codepoints for both weights, 30
  non-empty ranges each, 1.1 MB a weight; `0-255.pbf` came out at exactly HERE's 74 120 bytes and an
  empty range at HERE's 31, so the two builds are the same tool on the same font, and no range can
  404 and trip the style's `error` event. The fonts are now named `FiraGO-Regular` / `FiraGO-Bold`
  (one list, `VECTOR_GLYPH_FONTS`), the style's `GLYPHS_PATH` is `/fonts/glyphs/{fontstack}/{range}.pbf`
  on our own origin, the API's static handler sends `Cache-Control: public, max-age=604800` for that
  directory (a week; not hashed, so not immutable), and the relay route, its ledger entry and its
  test are removed, so a label fetch no longer spends the API's per-caller budget or touches HERE.
  A test reads the public folder and fails on any of the 512 files or the licence missing, or on a
  glyph path back under `/api/`; four mutants (a range deleted, a font renamed to a directory that
  is not there, the path moved back, the licence removed) each failed it. ⚠ Not verified in a
  browser until this serves on staging: the owed check is that labels render in FiraGO (not the
  browser font) with no "Rendering codepoint … locally" warning, done in the browser pass after
  merge. ⚠ The staging rig scripts count `/map-tiles/` requests, which included glyphs; from here
  tile counts are tiles only, so a lower count than yesterday's is partly this.
