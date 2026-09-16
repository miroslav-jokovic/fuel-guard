# Design refresh 2026-09 — the comps, and what it actually takes to reach them

**Status:** DR1 in progress. **Owner:** Miki. **Opened:** 2026-09-16.
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
| **DR4** | Dashboard hero band + greeting; top-bar ⌘K search | `AppShell`, `DashboardPage` | `lint:filesize` |
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

**D-DR5 — the full-bleed page is a shell variant, not a page that fights the shell.** The standard
page is `PageHeader` + `space-y-6` inside a padded container. A page that cancels that with negative
margins is the textbook workaround. `AppShell` gains an explicit `layout: "document" | "canvas"`
route flag; `canvas` drops the padding and the max-width and gives the outlet the full viewport
minus the rail and top bar. Live map is the first consumer; Fuel Planning is the obvious second.

**D-DR6 — panel open/closed state is `user_dashboard_layout`, not a new mechanism.** LM10 already
shipped per-user, per-tab widget layout with a merge function that preserves decisions across tabs
(`mergeTabLayout`). A floating map panel is a widget with a position. Reusing it means the
dispatcher's "I always close the weather card" survives a reload on day one, and we do not get a
second source of truth for "what is on my screen" — the exact failure mode the no-workarounds rule
names. **This is a derivation, not a copy.**

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
