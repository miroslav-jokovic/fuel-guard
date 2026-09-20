# Dashboard template v2 — card, tab, trend and donut redesign

> **Status: PROPOSAL, except where marked SHIPPED.** The artifact is
> `prototypes/dashboard-v2.html`, which is interactive and built against the product's own token
> sheet; this document is its decision log. Decision IDs are **D-DT1…D-DT19** and are not ratified —
> they exist so the port plan in §7 can cite them.
>
> Read first: `docs/DESIGN-SYSTEM-CONTRACT.md` (canonical), `apps/web/CLAUDE.md`,
> `docs/plans/design-system/DESIGN-REFRESH-2026-09.md` (D-DR1…D-DR25, which this continues).
>
> **SHIPPED so far:** F1/F3 (PR #920), then F2, F4, T4, T10 and T12 — the shared segmented
> surface and its de-grey, the chip's gradient with its per-scheme ramp steps, the sliding pill with
> brand selection, and the page backdrop. **§10 is the progress log**, with the measurements and the
> two places this document turned out to be wrong (D-DT16's `--action-primary` fails 4.5:1 in dark;
> the chip's shipped sizes are not §4.2b's). Everything else here is still a proposal.
>
> Where the work stopped: `HANDOFF-2026-09-20-DASHBOARD-TEMPLATE.md` beside this file.

## 0. How to look at it

```bash
npx http-server -p 8080 .          # from the REPO ROOT, not from this directory
open http://localhost:8080/docs/plans/design-system/prototypes/dashboard-v2.html
```

It must be served from the repo root because it links `/packages/ui/src/tokens.generated.css` —
the real sheet, not a copy — and that sheet's `@font-face` rules resolve to
`apps/web/public/fonts/`. Every colour, radius, elevation and the Hanken Grotesk face in the
prototype are therefore the product's own values, so a screenshot of it is evidence about Silvicom
360 rather than about a mood board. The one console 404 (`…/tailwindcss`) is the token sheet's first
line failing to resolve a bare specifier in a plain browser, and is expected.

Verified 2026-09-20 in Chromium at 1440×1200 and 860×1000, light and dark. The four behaviours
were asserted rather than eyeballed — see §6.

---

## 1. What the reference comps actually agree on

Eleven comps in `docs/design examples/`, read as a set rather than one at a time. The structure they
converge on is already most of what `DashboardPage.vue` renders, which is the useful finding: **this
is a refinement of an incumbent world, not a redesign.** The parts they agree on:

| Band | Every comp draws it as |
|---|---|
| Hero | photographic plate, greeting by name, tagline right |
| Tabs | a segmented pill on a muted well, not underlined tabs |
| KPI row | four tiles: tinted icon chip, label, large bold value, delta chip, caption, sparkline |
| Operating metrics | **one** card subdivided by hairlines — never N separate cards |
| Trends | bars for spend + smooth line with an area wash for MPG, each with a period switcher |
| Composition | a donut with a centre total and a legend carrying value **and** share |

## 2. What I took from them, and what I refused

This is the part that matters, because three of the comps are gorgeous and would damage this
surface. The dashboard's mode is **Operate**: the reader completes a task, forty times a day.

### D-DT1 — The tile keeps ONE colour surface. Rejected: the gradient fill.

`card 4.png`, `card1.png` and the Sep-18 set fill each tile with a saturated gradient keyed to its
metric — green for spend, orange for idle, red for alerts. As a card gallery it is the best work in
the folder. On this surface it breaks two things:

1. **A KPI row exists so four numbers can be compared.** Four different background washes are four
   different reading grounds, and the comparison stops being free.
2. **This product already spends colour on meaning.** `lib/badges.ts` is the status vocabulary and
   `scripts/check-chart-colors.mjs` validates the viz palette for protan/deutan/tritan separation.
   A tile that is green because it is *about fuel* cannot also be green because it is *healthy*.

What ships instead is an **edge-light**: a 1px hairline across the top of the card, tinted with that
tile's own hue, fading out at both ends, as if the card were catching light from above. It reads as
material (Apple's translucency/depth idiom) at roughly 6% of the ink a fill spends, and it leaves
the tile's one semantic colour surface — the icon chip — doing its job alone.

### D-DT2 — One encoding of movement, never two.

Comps (4) and (5) carry a delta chip **and** a status pill ("On track", "Needs attention") on the
same tile. Both say the same thing in two vocabularies, and the second teaches the badge system a
meaning it does not have. The delta stays; the status pill does not ship.

### D-DT3 — No chevron on a read-only cell.

`dashboard 5.png` puts a `›` on all eleven operating-metric cells, making eleven figures look like
eleven buttons. Affordances are promises. Dropped.

### D-DT4 — The flat delta is a dash, alone.

`— 0%` says the same thing twice and puts a number on a tile with no movement to report.

---

## 3. The grid template

Twelve columns · 20px gutter · 24px page padding · 1600px ceiling.

Every band is expressed **only** as a column span. That is the property `useDashboardLayout` needs:
a widget can move between bands without re-deriving its width, which a bespoke flex row per band
loses.

```
R0  hero                                                      12
R1  tabs ─────────────────────────── range · customize · export   12
R2  Fuel spend │ Fleet avg MPG │ Idle waste │ Active alerts    3 · 3 · 3 · 3
R3  Operating metrics (one card, 4 × N hairline-divided cells) 12
R4  Fuel spend (bars)             │ Fleet MPG trend (line)     7 · 5
R5  Where fuel dollars go │ Open cases by severity │ Fleet efficiency   5 · 4 · 3
```

### D-DT5 — Breakpoints collapse SPANS, never restyle widgets.

| Width | Rule |
|---|---|
| ≤1200 | `.col-3` → 6 · everything else → 12 · metrics grid 4→2 · hero tagline hidden |
| ≤820 | `.col-3` → 12 · page padding 24→16 · gutter 20→16 |
| ≤640 | metrics grid → 1 |

The KPI tile is the **only** widget that stays two-up at tablet: four short numbers pair well, and a
stack of four full-width tiles is three screens of scrolling for one glance. Every content card goes
full width, `.col-3--full` (Fleet efficiency) included — a lone half-width card at the foot of a
band whose siblings went full width reads as a layout that ran out, not one that adapted.

---

## 4. Component anatomies

### 4.0 Hero — a page backdrop, not a band (D-DT15, revised → D-DT18)

**D-DT15 removed the frame. D-DT18 is the correction to it, and the first revision was still wrong.**

v1 drew the hero as a card — surface, ring, `--elevation-card`, 16px radius. D-DT15 stripped all of
it, which was right as far as it went: the card made a photograph look like a widget, put a ring
around the one element on the page that is not a control, and stopped the plate 24px short of the
edge so the image read as cropped.

But the photograph still lived INSIDE the hero band, so it still had to END where the band ended,
and the only tool left was a fade that dissolved it into empty canvas a few pixels above the tab
strip. **That is the same mistake in softer clothing** — the fade was doing the job the frame used
to do, and an image that dissolves into nothing reads as a picture that ran out.

**D-DT18: the plate is a layer of the PAGE.** It starts at the top, bleeds past the right gutter,
and descends through the tab row and into the KPI row, where the opaque cards occlude it and it
survives only in the 20px gutters between them before fading out. Nothing about it ends — the
content covers it up, which is what depth actually looks like.

```
.backdrop          position absolute · top 0 · right calc(var(--page-pad) * -1)
                   height var(--backdrop-h, 400px) · z-index 0 · pointer-events none
.page > .band      position relative · z-index 1      ← one rule; no band knows the backdrop exists
plate inset        0 0 0 28%
vertical mask      solid → 46% → .62 @68% → .24 @86% → 0
horizontal veil    --canvas → transparent, finished by 88%
tablet (≤1200)     --backdrop-h 330px · plate inset 44%
```

`--backdrop-h` is where "a certain point" gets decided. 400px puts the last visible trace level with
the top of the operating-metrics band on a 1440 desktop; the tablet override is not cosmetic, since
that breakpoint makes the KPI row two-up and twice as tall, and a 400px layer would still be
showing under the second row of tiles.

**D-DT19 — the plate is not `cover`, and the reason is arithmetic.** The source is 1920×822 (2.34:1)
and the box is now ~975×400 (2.44:1) — near-identical aspects, so `cover` crops almost nothing and
renders the entire frame, sky and all. The subject sits at x 62–98%, y 44–82% of that frame
(measured off a 10% grid overlay, 2026-09-20), which `cover` parks at y 176–328 — below the greeting
it is meant to sit beside. At 136px tall the old band cropped so hard that `center 60%` happened to
land on the subject; at 400px that accident stops working. `background-size: auto 132%` with
`right bottom` crops the sky off the top instead and puts the truck at roughly y 105–310.

⚠ Four mask stops, not two. A straight linear ramp reads as a mechanical wipe and the eye finds its
midpoint.

### 4.1 `StatTile` v2 — measured

```
padding            20
chip               40 × 40, radius --radius-surface, icon 20
label              text-sm / 500 / --ink-muted, truncates
delta pill         20 tall, radius 999, text-2xs / 600  ← on the HEAD row, right-aligned
value              text-3xl / 700 / tracking −0.022em / tabular-nums
caption            text-xs / --ink-tertiary
sparkline          112 × 40, wraps under the figures when the TILE is < 260 wide
hover              translateY(−1px) + --elevation-card-raised, 120ms
press              scale(0.995), 90ms, on pointer-DOWN
```

**D-DT6 — the delta moved to the head row, and it is a measurement not a preference.** Beside the
value it wrapped: at 1440 a four-up tile is 333px, inner column 293, spark takes 112 + 16 of gap →
165px for the figures, where `$151.9K` at 30px is ~130 and the pill ~58. Two of four tiles broke to
a second line and the row went ragged — exactly the fault a KPI row cannot have. On the head row the
movement also sits beside the thing it qualifies, and the value line can never wrap whatever the
figure is.

**D-DT7 — the spark wrap is a `@container` query, not a viewport breakpoint.** This was paid for
once already (D-DR17): the same tile is 410px wide in the two-up grid at 900px and 220px in the
four-up at 1280px, so a viewport rule enables the inline spark exactly where it does not fit.
`@container (max-width: 260px)` asks the only question that matters and needs no breakpoint to know
which grid the tile is in. This is a straight upgrade on the shipped `flex-wrap` + `min-w-32` fix.

**D-DT8 — `good` is the caller's verdict, never derived from the arrow.** Spend up is bad, MPG up is
good. A component that decides from the sign is wrong on half of any real KPI row. (The shipped
`StatCard` already knows this — `subTone` is a class, not an enum. v2 keeps the rule and moves it
into the pill.)

### 4.2 `SegmentedTabs` v2 — one sliding pill, spring-driven

The incumbent `AppTabs` colours four backgrounds and swaps which one is lit. That cannot be
interrupted, carries no velocity, and gives no sense that the selection *moved* — it teleports.

v2 keeps **every** accessibility property of `AppTabs` (`role="tablist"`, roving tabindex,
Left/Right/Home/End, follow-focus — the properties that argument was won on) and changes only the
rendering: **one** pill element positioned by `transform: translateX()` + `width`, integrated by a
critically-damped spring in JS.

**D-DT9 — damping 1.0, response 0.34.** Apple's two designer-facing parameters rather than
mass/stiffness/damping. Damping `1.0` = no overshoot, which is right because a tab click is a
discrete command and did not follow a gesture; bounce is reserved for motion a flick preceded.
Response `0.34` sits in the 0.3–0.4 band Apple ships for repositioning.

**D-DT10 — integrate from the LIVE value.** Click tab 1 then tab 3 mid-flight and the pill continues
from where it is on screen, carrying the velocity it already had. Re-targeting from the logical
value is what produces the visible jump; re-targeting with velocity zeroed is the "brick wall" on a
reversal. Measured in §6.

The same primitive at `--sm` is the chart period switcher (`7D / 30D / 90D`). A second control for
that job would be the workaround `CLAUDE.md` names by example.

**D-DT16 — selection is brand, not a grey well.** The two comps disagree here and the better one
wins. `card 4` draws the incumbent treatment — a flat `--surface-muted` well with a white pill in
it. `dashboard 1` draws a barely tinted near-white ground, a plain surface pill, and carries
selection in **brand-coloured text and a brand-coloured icon**. A grey well spends a solid block of
ink saying "these three belong together", which proximity already said for free, and it spends the
page's only large neutral field on a control rather than on data.

```
ground     color-mix(in oklab, --ramp-brand-100 58%, --surface)
ring       inset 1px, color-mix(--ramp-brand-200 50%, transparent)
pill       --surface + --edge-subtle ring + --elevation-card
active     --action-primary  (label AND icon AND count)
idle       --ink-muted, hover --ink-secondary
count      --ramp-brand-200 @42% idle → --ramp-brand-100 + --action-primary when selected
```

⚠ `--ramp-brand-50` alone is **not** enough: at chroma 0.0061 it is technically brand and visually
grey, which was the original complaint. brand-100 is chroma 0.0205, and the mix is what puts a
readable lavender under the pill in light and a warm graphite in dark.

⚠ The `--sm` variant keeps its active label in `--ink`. The strip is navigation, where brand means
"you are here"; the period switcher is a local control, and three brand-tinted pills in one band
would each claim to be the thing you are looking at.

### 4.2b Chip — solid gradient, white glyph (D-DT17)

The flat pale tint with a coloured glyph was the `dashboard 3` treatment. This is the `card 4` /
`card1` one, and it is a complete change of style rather than a tuning of the old one:

```
background   linear-gradient(140deg, --ramp-<hue>-500, --ramp-<hue>-700)
glyph        --ink-inverse (white), stroke 2.2
top edge     inset 0 1px 0 0 white @28%        ← light catching the top of a solid object
glow         0 5px 12px -4px <hue>-700 @55%    ← the chip's own colour cast on the card beneath
radius       --radius-surface (12px on a 40px chip — the measured 30% of the comps)
size         40px chip / 21px glyph  ·  --sm: 32px / 17.5px, glow at -3px
```

⚠ **This does not reopen D-DT1.** That decision was about the CARD: four saturated card grounds make
four reading grounds and the four KPI numbers stop being comparable. The chip is 40px, it was
already the tile's one colour surface, and the figures still sit on plain `--surface`. Concentrating
the colour into the chip is what *lets* the card stay neutral — it is D-DT1 pushed further, not
reversed.

⚠ **Both stops come from one hue's ramp** — 500 → 700, never across two hues. A green→blue chip
invents a colour relationship the token system does not have, and that is how a palette stops
meaning anything.

⚠ **The glyph goes 1.95 → 2.2.** A white stroke on a saturated ground loses roughly a third of its
apparent weight to the surrounding light: the same glyph that reads as bold in `ramp-700` on
`ramp-100` reads as spidery in white on `ramp-600`.

### 4.2c Chip glyph geometry — duotone

Measured off `card 4.png` and `dashboard 1.png` at 3×: the chip glyphs are **not** solid and not
plain outlines. Each is a stroke outline at ~2 units on a 24 grid — noticeably heavier than v1's
1.7 — carrying exactly **one** solid filled element: the pump's nozzle, the gauge's needle and
pivot. That single fill is what gives them weight in a 40px chip; a uniform hairline at that size
reads as a wireframe.

Every glyph is therefore a pair, `o` (outline) + `f` (one filled accent), and the accent is a
primitive wherever one will do — a rect, a circle, an ellipse. A hand-drawn duotone path is where
icon sets go wrong, and a filled rounded rect inside a pump body reads as a display window at 20px
just as well as a bespoke shape does.

Three glyphs were rejected by measurement rather than by taste, all at the 17px operating-metric
chip: a near-vertical `road` read as three unrelated strokes until its verges were made to converge
(a road is recognised by perspective, not by markings); a circled `$` turned to mush; and a
banknote-with-a-coin read as a **camera**. Money is now three stacked lozenges, which survive the
size because they carry no interior detail at all — the silhouette is the meaning. `Fill-ups` also
stopped sharing the droplet with `Gallons`: a fill-up is a pump event, the gallons are the liquid.

### 4.3 `TrendCard` v2 — the readout is the upgrade, not the chart

Header (icon chip 32 · title · sub · period switcher) → **readout row** → plot.

**D-DT11 — the headline figure IS the tooltip.** At rest the readout shows the period total, its
delta and "vs previous 30 days". While the pointer is over the plot it shows the value under the
pointer and that day's label, in the same slot, in the same type. The number you are pointing at is
the number in the big type — direct manipulation, not a tooltip read sideways. The delta fades out
while scrubbing because a period delta is not a fact about one day.

Geometry is the repo's existing rulings, reused rather than re-derived:

| Thing | Value | Source |
|---|---|---|
| Bar width / radius | 85% of band, 4px radius on the **top** corners only, square on the axis | `BAR_GEOMETRY`, `lib/chartTheme.ts` |
| Area wash | 0.14 at top → 0.045 at 55% → 0 at baseline | `areaFill()` defaults, sampled pixel-by-pixel off comp (3) at DR3 |
| Line dot | last point only, r=4 | `lastPointRadius()` — what reads as a dot per point in an upscaled comp is antialiasing of a 2px stroke |
| Grid | y hairlines at `--viz-grid`, no x grid, no axis line | `trendOptions()` |
| Ticks | `--viz-tick` at 11px, ≤7 on x, never rotated | contract §2.2 — 11px is the floor for a glanced-at label |

**D-DT12 — the viewBox is MEASURED, and the axis steps are "nice".** Two defects the first build
had, both caught by screenshot:

- A fixed viewBox scaled to fit scales the **text** with it. Both plots were drawn at viewBox 760;
  the narrower card rendered into ~530px, so its 11px ticks arrived at **7.7px** while the wider
  card's arrived at 10.6. Two charts on one row, two tick sizes, and the contract's floor breached
  in one of them. Measuring the host and drawing at 1 unit = 1px fixes it at any column width.
- Evenly dividing the data range gave `$15.3K / $30.7K / $46K / $61.3K`. Arithmetically correct;
  nobody can hold those in their head long enough to place a bar against them. Steps are now
  1 / 2 / 2.5 / 5 × 10ⁿ → `$0 / $20K / $40K / $60K / $80K`.

**D-DT13 — the entrance plays once per host, ever.** An entrance says the data has *arrived*.
Replaying it on a resize or a scheme switch says it arrived again, which is false, and it makes a
window drag flicker both charts back to their first keyframe. (The unguarded version is worse than
cosmetic: re-rendering changes the host's height, which re-fires the `ResizeObserver`, which
re-renders — an invisible loop with no error and no jank, whose only symptom is that the bars and
the line sit permanently at frame 0 and the chart renders as an empty grid. That is exactly what the
first screenshot of the prototype showed.)

### 4.4 `DonutBreakdown` v2

Three things the incumbent does not do:

1. **A track ring** behind the arcs at `--edge-subtle`. Without it a donut that is 60% full reads as
   an arc that stopped rather than a ring with a share in it — the commonest misreading of a
   doughnut chart.
2. **The centre trades the total for the part.** Hovering a slice cross-fades the centre to that
   slice's own value and name, in the same slot, and comes back the way it went out. You never lose
   the total; you trade it, reversibly.
3. **Hover is bi-directional.** The legend *is* the accessible reading of the ring, so it has to be
   the same object: pointing at either lights both, and the legend rows are focusable so a keyboard
   gets what a pointer gets.

**D-DT14 — arcs are `stroke-dasharray` segments on one circle, not `<path>` wedges.** That is what
gives rounded caps, a real 4-unit gap between neighbours, and a lift-on-hover that is a
`stroke-width` change rather than a re-layout. `cutout` stays at 74% to match the shipped component.

Colour is never the only cue: every slice is named in the legend with its value and share, and the
severity palette is the one `lint:chart-colors` already validates.

---

## 5. Motion budget

| Interaction | Curve | Duration |
|---|---|---|
| Tab pill | spring, damping 1.0, response 0.34 | ~340ms, interruptible |
| Tile hover / press | `cubic-bezier(.2,.7,.3,1)` | 120 / 90ms |
| Bar entrance | same, 11ms stagger | 460ms, once |
| Line draw | `cubic-bezier(.22,.7,.25,1)` | 700ms, once |
| Donut arcs | fade, 70ms stagger | 520ms, once |
| Centre cross-fade | ease-out | 130ms |
| Crosshair / scrub | none — 1:1 with the pointer | 0 |

`prefers-reduced-motion: reduce` replaces every entrance with an opacity fade, makes the pill jump,
drops the hover lift and press scale, and keeps every colour/opacity change that aids comprehension.
`prefers-reduced-transparency` solidifies the translucent bar; `prefers-contrast: more` swaps
`--edge-subtle` for `--edge-strong` and lifts tertiary ink to secondary.

---

## 6. What was verified, and how

Asserted in the live page rather than eyeballed (Chromium, 1440×1200, 2026-09-20):

| Claim | Evidence |
|---|---|
| The pill travels rather than teleports | mid-flight `translateX(95.03px)`, settles `translateX(257.88px)` |
| It lands exactly on its tab | settled X within 0.6px of the tab's offset from the strip |
| Roving tabindex is intact | `aria-selected` `[false,false,true]`, `tabIndex` `[-1,-1,0]` |
| Scrubbing rewrites the headline | `$1,298,430 / "vs previous 30 days"` → `$57,000 / "Sep 2"` → back |
| The donut centre trades and returns | `$1.30M / Total fuel` → `$151.9K / Idle waste` → back; only arc 2 lit |
| No colour escapes the token sheet | zero `#rrggbb` literals in the rendered DOM |
| Both schemes | full-page captures, light and dark, `color-scheme` on the root only |
| Both widths | full-page captures at 1440 and 860 |

Defects found this way and fixed: the empty-grid render loop (D-DT13), the 7.7px ticks (D-DT12),
the ragged KPI row (D-DT6), an inline `<span class="meter">` whose `height: 6px` did nothing, a
hero tagline colliding with the truck's cab at 860, and a lone half-width card stranding at tablet.

### 6a. The one that screenshots could not catch

**Every radius on this page was 0, and every `text-2xs` label was 14px, from the first build until
2026-09-20.** `tokens.generated.css` declares its roles in two blocks: `:root` (lines 66–289) and
Tailwind's `@theme inline` (291+). A plain browser parses the first and **drops the second as an
unknown at-rule**, so `--radius-detail|control|surface|overlay|dialog` and `--text-2xs` resolved to
nothing. An empty variable makes `border-radius: var(--radius-dialog)` an invalid declaration,
which computes to `0px` and throws nothing at all.

Reading the screenshots did not catch it and was never going to: a 16px radius under a soft
elevation looks rounded at page scale, and a 3px difference in a label looks like the label. One
`getComputedStyle` call caught it, and the general form of the check is worth keeping — enumerate
every `var(--x)` the page's own stylesheets reference, resolve each against `:root`, and list the
empties. Eleven came back; five were real.

⚠ **This was the prototype's fault, not the product's.** The app runs Tailwind, so `@theme` is
processed and those roles are real there. The fix is a bridge block that re-points the names onto
their `:root` sources — the radii **derive** from `--shape-*`, which is how the generated sheet
itself defines them, so the bridge cannot drift. `--text-2xs` has no `:root` source and is the one
value restated (`tokens.generated.css:299`); it is the only duplication in the file and is named
here so it can be found.

Post-fix, asserted: card 16px · chip 12px · control 8px · `text-2xs` 11px · `text-xs` 12px · zero
unresolved tokens.

---

## 7. Port plan — what this costs in the real app

The prototype writes plain CSS against the semantic roles precisely so each anatomy is stated in
numbers that port to Tailwind utilities unchanged. Nothing below needs a new token, a new radius, a
new elevation or a hex.

| # | Change | Files | Gate risk |
|---|---|---|---|
| T1 | Delta pill primitive (`AppDelta`) + move the delta to the head row | `packages/ui/`, `components/ui/StatCard.vue` | `lint:ui-adoption` wants it in the barrel; `StatCard.test.ts` pins both anatomies, so the hero branch assertions change |
| T2 | Edge-light variant on `AppCard` | `packages/ui/src/components/AppCard.vue` | `lint:tokens` — the tint must come from a `--viz-*` role, passed in, never a hue |
| T3 | `@container` replaces `flex-wrap` + `min-w-32` for the inline spark | `components/ui/StatCard.vue` | none; strictly narrows D-DR17's fix |
| T4 | Sliding pill inside `AppTabs` | `packages/ui/src/components/AppTabs.vue` | the ARIA tests must keep passing untouched — that is the acceptance criterion |
| T5 | Readout row + scrub on the trend cards | `features/dashboard/ChartCard.vue`, `lib/chartTheme.ts` | Chart.js gives this via an `external` tooltip handler writing to the header; no new dep |
| T6 | Nice axis steps | `lib/chartTheme.ts` (`trendOptions`) | affects `FleetTrendChart` too — check the finance snapshots |
| T7 | Track ring, centre swap, bi-directional hover | `features/dashboard/DonutBreakdown.vue` | `DonutBreakdown.test.ts` exists; the centre becomes stateful |
| T8 | Grid template as span classes | `features/dashboard/TabWidgets.vue`, `lib/dashboardWidgets.ts` | `tabWidgetsLayout.test.ts` asserts the current layout — it is the thing that has to change |
| T9 | Frameless hero (D-DT15) | `components/ui/PageHeader.vue` | `PageHeader.test.ts` (8.9K) pins the hero; `lint:ui-adoption` requires a `PageHeader` on every routed page, so the *component* stays — only its chrome goes. The page-gutter bleed needs a real value to negate, and `AppShell` owns that padding, not `PageHeader` |
| T10 | Brand tab selection (D-DT16) | `packages/ui/src/components/AppTabs.vue` | ships with T4; `lint:tokens` accepts `color-mix` over ramp roles, but check `lint:ui-contrast` — brand-on-surface at `--action-primary` is already a passing pair elsewhere |
| T11 | Duotone chip glyphs (D-DT17) | `packages/ui/src/icons.ts`, `AppIcon` | **blocked on Q-DT5** — the free icon set has no duotone variant |
| T12 | Page backdrop (D-DT18/19) | `layouts/AppShell.vue`, `components/ui/PageHeader.vue` | the layer must be the SHELL's, not the page's — it has to sit behind bands the page renders, and `AppShell` already owns the gutter the bleed negates. ⚠ `meta.fullBleed` pages (the live map) must not get one |
| T13 | Gradient chip (D-DT17) | `components/ui/StatCard.vue`, `packages/ui/` | `lint:tokens` must accept a two-stop gradient over ramp roles; `lint:ui-contrast` should be pointed at white-on-`ramp-600`, which is a new pair for this codebase |

`ChartCard.vue` is 490 bytes today, so T5 has room under the 500-line budget. `StatCard.vue` is
already 274 lines and grandfathered files may only shrink (`lint:filesize`) — T1 and T3 should be a
net reduction, and if they are not, the delta pill moving into `packages/ui` is what makes them one.

## 8. Open questions — blockers, recorded rather than routed around

**Q-DT1. Does the readout-as-tooltip survive a screen reader?** The scrub readout is a visual
affordance; the accessible reading is still the chart's `aria-label` plus, for the donut, the
legend. A trend chart's legend equivalent is a data table, and this dashboard has none. Candidates:
(a) an `ExplainerPanel`-style disclosure holding the series as a table; (b) accept the summary label
and move on, as today. **Recommendation: (a)**, scoped as its own item, not folded into T5.

**Q-DT2. Does D-DT1 hold for the driver app?** `apps/driver` is Tailwind v3 + nativewind with its
own values by D-DS3, and the comps' expressive card is far more at home on a phone than in a
dispatcher's browser. This proposal deliberately says nothing about it.

**Q-DT6. `lint:tokens` cannot see two whole categories of code, and both were found by feeding it
a violation rather than by reading it.** Neither is caused by this work; both limit what any future
restyle can be trusted to have covered.

- **It scans `apps/web/src` only** (`const SRC = new URL("../src", …)`). Every shared primitive in
  `packages/ui/src` — `AppButton`, `AppBadge`, `AppCard`, the new `AppIconChip` — is outside the
  walk, so a raw hue, an off-scale radius or an unknown colour role in a primitive passes clean. A
  deliberately broken `AppIconChip` was linted green to confirm it.
- **The class-only rules read `class="…"` one LINE at a time.** A multi-line `:class="[ … ]"` array
  — which `StatCard`, `AppButton` and most primitives use — is invisible to the radius, elevation,
  text-size, stacking and colour-role rules, because the opening `:class="` and the closing quote
  are on different lines and the per-line regex never matches. The same two bad gradient stops were
  caught immediately when moved onto a single-line `class`.

Candidates: (a) walk `packages/ui/src` too and join the class binding across lines before matching;
(b) accept it and say so in the contract. **Recommendation: (a)**, as its own change — turning both
on at once will surface existing violations, and that count should be a deliberate piece of work
rather than a surprise inside a restyle.

**Q-DT5. The app cannot render D-DT17's icons today.** `@hugeicons/core-free-icons` ships 13,556
exports and **zero** Duotone, Bulk, Twotone or Solid variants — it is stroke-only. The prototype's
glyphs are hand-drawn to show the treatment and must not be pasted into `packages/ui/src/icons.ts`
as they stand. Candidates: (a) license Hugeicons Pro for the duotone set — one vendor, consistent
with the incumbent, and the whole library arrives; (b) add a small curated duotone set for the ~16
dashboard glyphs only, behind `AppIcon`'s existing API, and leave every other surface on the free
stroke set. **Recommendation: (b)** — the treatment is wanted on chips, which is one component, and
(a) buys 13,000 glyphs to solve a sixteen-glyph problem. Either way `AppIcon` grows a `variant`
prop, and `lint:ui-adoption`'s rule that icons come from `packages/ui/src/icons.ts` is what keeps
the hand-drawn set from spreading.

**Q-DT4 — THE BLOCKER. Three of the four delta pills have no data behind them, and the fourth
cannot have any.** This is not a detail of the port; it is the precondition for §4.1 existing at all.
`useDashboard` runs eight range-scoped queries and never fetches a previous window, so there is no
period-over-period figure on this page today — that is DR2b, still queued. Worse, "Active alerts" is
**current state**, not a period measure, so it cannot carry a delta in any implementation.

The prototype draws all four pills because the comps do and because the anatomy has to be shown
somewhere. **It is therefore drawing a number the product cannot currently produce, and one it can
never produce.** Candidates:

- (a) Ship DR2b first — a second, previous-window fetch in `useDashboard` — and make the delta
  required on the three period metrics, absent on Active alerts. **Recommended.**
- (b) Ship the tile with the pill optional and omit it until DR2b lands. Cheap, and it means the KPI
  row goes to production with a hole in the anatomy that nobody has a ticket to close.
- (c) Put something else in the slot on Active alerts — a count, a severity mix. That is the
  workaround: a second vocabulary in the slot the delta owns, which is exactly D-DT2's objection
  turned inside out.

⚠ Whichever is chosen, **do not derive a delta from the sparkline's own series to fill the gap.**
The spark is 30 points inside the selected range; a previous-period delta is a different window
entirely, and computing one from the other would be a figure that looks right and is not.

**Q-DT3. Two donuts in one band — is `Open cases by severity` a donut at all?** Four ordered
severities are a rank, and a stacked bar or a ranked list reads a rank better than a ring does. The
prototype draws it as a donut to demonstrate the component's compact anatomy, which is not the same
as arguing it belongs there. **Recommendation: keep the donut for cost composition (parts of a
whole) and make severity a ranked list**, which the third card in R5 already shows the treatment for.

---

## 9. Detector findings

`impeccable detect` was run over the prototype (2026-09-20). It reports one finding, and it runs
DEGRADED on this machine — its HTML/CSS parser modules are missing, so it falls back to regex and
says so; custom properties, selector matching and computed contrast are **not** evaluated, which
makes its output an undercount rather than a clean bill of health.

| Finding | Verdict |
|---|---|
| `layout-transition` — "Animating width…" at the donut arc's `transition: stroke-width` | **False positive.** The regex matched `width` inside `stroke-width`, which is an SVG paint property. There is no layout to thrash. |

Suppressed as `layout-transition = *`, scoped to this one prototype file. ⚠ The file-scoped
**wildcard** is the narrowest form the tool supports for this rule, and that is a property of the
detector rather than a choice: `hook-lib.mjs:850` (`extractFindingIgnoreValue`) returns an empty
string for any rule outside `directValueRules`, and `layout-transition` is not in that set — so a
value-scoped entry such as `layout-transition = "transition: width"` silently never matches. One was
written first and did nothing; the finding came back unchanged. Anyone adding an ignore for a
non-`directValueRules` rule needs `--file` and `*`, and should expect the whole rule to go quiet for
that path.

The finding it did **not** report is the real one: the tab pill's `width` is animated per frame from
JS. That is a deliberate exception, reasoned at the call site — the compositor-friendly alternative
is a 1px pill under `scaleX()`, which smears an 8px corner radius into an ellipse and stretches the
1px ring into a visible band. The pill is `position: absolute`, so the reflow is confined to one
out-of-flow node for ~340ms, once per click.

---

## 10. Progress log

Appended, dated, newest last. The tables above are the DESIGN; this is what happened to it. (Rows
are not edited in place — two sessions editing the same table row conflict, and the history of a
decision is worth more than a tidy table.)

**2026-09-20 — F1, F3 shipped.** PR #920, merge `3d4999f`. `AppIconChip` closed the chip tone
vocabulary (22 hand-written pairs across 5 files → one map, seven names identical to `AppBadge`'s),
deliberately a no-op on screen; `lint:tokens` gained the gradient-stop rule. Handoff corrected in
PR #921, merge `ada75ca`.

**2026-09-20 — F2, F4, T4, T10 and T12 shipped together in PR #922, merge `16d3ebb`.**

**F2: one well, de-greyed once.** `packages/ui/src/segmentedSurface.ts` owns
the well-and-pill recipe and both `AppTabs` and `AppSegmentedControl` read it; the copies had
already drifted (`shadow-card` on one pill, absent from the other). D-DT16's ground is two new role
tokens, `--control-well` and `--control-well-edge` — chroma 0.0119 light / 0.0140 dark, confirmed
by `getComputedStyle` on the built page. Idle label contrast goes UP (5.48:1 against 4.82:1 light,
5.67:1 against 5.33:1 dark) and the pill, no longer lighter than its ground (1.076:1), now needs
its ring and elevation.

> ⚠ **Tailwind's `@source` glob was `packages/ui/src/**/*.vue`.** Moving class strings into a `.ts`
> file made them invisible to the scanner: `bg-control-well` emitted nothing, the well rendered
> TRANSPARENT and `ring-1` fell back to `currentColor`. It reads as a design mistake and is a build
> one; no gate can see it. Both apps' globs now cover `{vue,ts}`.

**2026-09-20 — F4 shipped: the chip's gradient, and the elevation its glow needed.** Seven tones ×
(`--chip-<tone>-from|to`, `--chip-<tone>-glow`, `--elevation-chip-<tone>`), plus `--chip-glyph` and
`--chip-top-edge`. Measured, and it settles the handoff's open question about the dark ramp:

| | head → foot | worst white-glyph contrast |
|---|---|---|
| light | 500 → 700 | 3.27:1 (danger) |
| dark | 600 → 300 | 3.29:1 (success) |
| dark, if light's steps were reused | 500 → 700 | **1.78:1** (success) |

`neutral` is the one tone whose dark head is 500, because its ramp turns a step earlier — dark
`neutral-600` (L 45.5%) is DARKER than `neutral-300` (49.9%) and would light the chip from below.
⚠ The glyph is `--chip-glyph` (white in BOTH schemes) and **not** `--ink-inverse`, which flips to
oklch(21.5% 0 0) in dark and would put a near-black glyph on a saturated chip. `lint:ui-contrast`
learned to follow a `var()` chain and now checks all 14 stops plus two structural rules (every tone
declares its full set; both stops stay on one hue's ramp in both schemes).

**2026-09-20 — T4 + T10 shipped: the pill travels, and selection is brand.** One absolutely
positioned element, `transform` + `width`, critically damped spring (ω = 2π/0.34), integrating from
the LIVE value so a mid-flight re-target continues from where the pill is. Measured in the built
page: 77 → 187.23px against a target of 188 over 426ms, monotonic, no overshoot. **`AppTabs.test.ts`
is untouched** — the acceptance criterion — and the pill's own tests are in `AppTabsPill.test.ts`.

> ⚠ **D-DT16 names `--action-primary` for the selected label and that value fails in dark.** On the
> pill's `--surface` it measures 5.29:1 light but **4.37:1 dark**, and a 14px tab label is
> normal-size text (WCAG 1.4.3, 4.5:1). Shipped as `--selected-strong`: the role the system already
> has for "selected, emphatic", identical in light, 5.62:1 in dark. Same for the count's selected
> ground — brand-100 is 4.10:1 in dark, so `--control-count-selected` is brand-100 light /
> brand-50 dark (4.66:1 / 4.92:1).

**2026-09-20 — T12 shipped: the backdrop is the SHELL's.** `meta.hero` / `meta.heroDark` read
through `heroPlate()` in `lib/layout.ts`, which refuses a plate whenever the outlet is full-bleed —
the dashboard is the same route with and without gutters, so the meta alone cannot answer. The
plate left `PageHeader` entirely (T9's frameless hero arrives with it) and its "which photograph"
tests moved to `layout.test.ts`.

> ⚠ **A `z-index: 0` layer drawn FIRST still covers the page.** CSS paints a positioned descendant
> above an in-flow non-positioned one whatever the document order says: probed against the built
> stylesheet, a white KPI card under the plate DISAPPEARED. The shell wraps the page in one
> positioned element — the prototype's `.page > .band { position: relative }` applied once — inside
> the `v-if`, because an extra wrapper would break the live map's `h-full` chain.

Still open from §7: **T1** (delta pill — blocked on Q-DT4), **T2** (card edge-light), **T3**
(`@container` spark), **T5/T6** (trend readout + nice axis steps), **T7** (donut), **T8** (grid
spans), **T11** (duotone glyphs — blocked on Q-DT5), **T13** (the chip's `--sm` geometry, below).

**Q-DT7 (new). The chip's sizes are not the comps'.** Measured in a browser 2026-09-20: `md` is
40px with a 24px glyph and `sm` is 36px with 20px — a glyph at 60% and 56% of its chip, where the
comps sample 50% and §4.2b specifies 40/21 and 32/17.5. The component's own comment claimed the
comps' figures and had never been checked against the code. Resizing is a visible change at every
call site, so it is recorded here rather than folded into a restyle that only touched colour.
Candidates: (a) move to 40/20 and 32/17, matching the comps and `AppBadge`'s density; (b) keep the
incumbent sizes and correct §4.2b. **Recommendation: (a)**, as its own change, with the two call
sites screenshotted before and after.

**2026-09-20 — tranche 3, the owner's four readings.** Driven by the owner's own review of the
shipped page rather than by §7's order: *"our tabs are across the image looking bad"*, *"icons in
cards … are mixed"*, *"in the examples we have redesigned charts and donuts and here we don't have
this"*, *"cards are not in the way I have provided examples"*. Each one is answered below with what
was measured; T5, T6 and most of T7 land as part of it.

**D-DT20 (new) — the control row, and the plate stops above it.** The three controls that scope
this page sat in three places: the range picker and Export were `PageHeader`'s actions (top-right
corner of the photograph), Customize was a right-aligned row `TabWidgets` drew for itself, and the
tab strip ran the full width between them. Measured at 1440 with `getBoundingClientRect`: the
backdrop occupied y 116–516 while the control row sat at y 276–316 and Customize at (1296, 340) —
on the truck's cab, mid-grey on mid-grey. All eleven comps end the plate ABOVE the controls. So:
one row, tabs left and scope right; `--backdrop-h` 400 → **144**, which is where the mask reaches
`transparent` 16px above the row (116 + 144 = 260 against the row's 276); and the plate's crop goes
`auto 132%` → `cover` at `right 70%`, because at 144px the old rule scaled the frame to 445px wide
inside an 864px box — a small photograph with a hard left edge in the corner, which is what the
first build of the shorter band actually showed.

> ⚠ **A `<Teleport>` resolves its target ONCE, at the vnode's first mount, and caches it.** Customize
> is owned by `TabWidgets` (which knows whether there is anything to customize) and belongs in the
> page's row, so it teleports into `#dashboard-actions`. A child's `onMounted` runs before its
> parent's subtree is in the document, so the target resolved to `null`; flipping `:disabled`
> afterwards moved the button to nowhere and it stayed on the photograph, with no warning in a
> production build. `:key` on the flag — remounting the Teleport once the row is really there — is
> the fix. Two builds read as "the teleport silently does nothing" before the cache was the answer.

**D-DT21 (new) — the chip leads in both anatomies.** D-DR2 moved the chip left in the hero and left
the KPI chip on the right so that fourteen surfaces would not reflow. The Dashboard is where that
caution was paid for: four hero tiles leading with a chip, nine operating-metric tiles trailing with
one, eight inches apart, which is what the owner read as "mixed". All eleven comps lead in both
bands. `StatCard` now renders one chip whose SIZE still varies (md/sm) and whose side does not, and
`OperatingMetricsWidget` follows; `StatCard.test.ts`'s "leads with the icon chip in both anatomies"
is the pin, proved by moving the chip back and watching it go red.

**T5/T6 — the readout, and axes a reader can hold.** `ChartCard` grew the anatomy §4.3 measures off
the comps: a 32px chip leading the title, and a **readout row** — the period's own figure in
`text-2xl`, with what it is OF beside it. D-DT11's swap ships with it: `trendOptions({ onScrub })`
hands the point under the pointer to the card's header and turns the floating tooltip OFF, so the
number you are pointing at is the number in the big type. Verified in the browser rather than
asserted: the spend card reads **$840,381 at rest and $43,783 with the pointer on a bar**. The
spend readout is summed from the SAME series the bars draw, not from `s.totalSpend`, so the
headline cannot disagree with the chart under it. T6 is `lib/niceScale.ts` — the 1/2/2.5/5 ladder —
which turns `$15.3K / $30.7K / $46K / $61.3K` into `$0 / $20K / $40K / $60K / $80K`. It is its own
module because it is pure arithmetic and `chartTheme.ts` needs a DOM to be tested at all.

> ⚠ The first draft of `niceScale.test.ts` claimed the 2.5 rung rescued the plot's HEIGHT. It does
> not — it buys the INTERVAL COUNT (a series topping out at 880 takes four intervals with it and
> two without, on the same 1,000 axis). The test and the module's header now say that instead.

**T7 — track, centre swap, and one direction of the hover.** The track is an SVG circle behind the
canvas, not a second dataset (a second doughnut dataset is a second concentric ring, beside the
first rather than behind it); its stroke is the PAINTED band, with the arcs' 3px border subtracted,
because the first build showed 3px of grey outside every arc all the way round and read as a halo.
Hovering an arc trades the centre total for that slice's own value and name, reversibly, and lights
its legend row.

**Q-DT9 (new) — the legend does NOT drive the ring, and the reason is worth recording.** D-DT14 asks
for bi-directional hover. Built, it failed `lint`: a row that answers a pointer must answer a
keyboard (`mouse-events-have-key-events`), a focusable row must do something when activated
(`no-static-element-interactions`), and the only honest "something" is a click that PINS the slice —
a new affordance, on touch as well, that no comp draws and nobody asked for. The rows are plain text
again. Candidates: (a) ship click-to-pin with `aria-pressed`, which also gives touch the per-slice
figure it can never hover for; (b) leave the ring as the only driver and delete the second half of
D-DT14. **Recommendation: (a)**, as its own change.

**A defect found on the way, and the audit that nearly missed it.** `DonutBreakdown` laid its ring
and legend out on `sm:` — a VIEWPORT rule inside a card, the same class of error as D-DR17. At 1024
the dashboard grid is already two-up, so the card body is 300px, and `scrollWidth - clientWidth`
reported **every legend label on both donuts clipped** — "Moving fuel" by 72px — with `truncate`
throwing nothing. It is an `@container` query at 26rem now. ⚠ The first build put `@container` and
`@[26rem]:` on the SAME element, where a container query can never match (it matches descendants),
so both donuts stacked at every width — **and the truncation audit reported "none", because a
stacked legend has the whole card to itself.** A measurement that passes when the layout collapses
is not a measurement of the layout; the audit now reports the resolved column count beside it
(2 at 1440, 1 at 1024).

**Q-DT8 (new) — the comps' KPI chip is a PALE TINT, not the shipped gradient.** Measured off
`card 4.png` and `card1.png` at 3×, 2026-09-20: both draw a pale tinted rounded square with a
COLOURED glyph — `ramp-50`-ish ground, `ramp-600`-ish stroke — and §4.2b's "solid gradient, white
glyph … this is the `card 4` / `card1` treatment" does not describe either of them. The gradient
shipped in F4 with measured contrast and the owner's review called the icons updated rather than
wrong, so nothing is being reverted on this reading alone. Candidates: (a) keep the gradient and
correct §4.2b's provenance; (b) return the chip to the comps' pale tint, which is a change at 22
call sites. **Recommendation: (a)** — with the owner asked directly, because this is taste on a
surface they have now looked at twice.

Still open from §7 after this tranche: **T1** (delta pill — still blocked on Q-DT4, and now the most
visible remaining gap against the comps: every comp carries `↓12% vs. previous 30 days` on all four
KPI tiles and on both trend cards, and `useDashboard` still fetches no previous window. DR2b costs a
SECOND set of the page's eight range-scoped queries, including another month of fills, which is a
product decision rather than a polish one), **T2** (card edge-light), **T3** (`@container` spark —
the incumbent `flex-wrap` + `min-w-32` still works and wraps correctly at 1440), **T8** (grid
spans), **T11** (blocked on Q-DT5), **T13**, and **Q-DT7**.
