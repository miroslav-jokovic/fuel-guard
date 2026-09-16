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
