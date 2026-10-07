# Fleet overview v3 — analysis and redesign proposal

**Status:** PROPOSAL, 2026-10-06. Nothing in the app is changed by this document. It records what
the Fleet overview tab shows today (measured from the code, not from a screenshot), why it reads as
repetitive and flat, what the 2026 field is converging on for pages of this kind, and one concrete
layout — drawn at `prototypes/fleet-overview-v3.html` with the product's own tokens — for the owner
to accept, amend or refuse. Decisions here are `D-FO*`, open questions `Q-FO*`.

**Read first:** `DASHBOARD-TEMPLATE-V2.md` (the incumbent template, D-DT1..21, and Q-DT3/Q-DT4 which
this proposal answers) and `DESIGN-REFRESH-2026-09.md` (D-DR12: the delta pill is split out as DR2b
because its data does not exist). This proposal does not reopen any ruling in those two documents;
it builds on three of them and names which.

---

## 1. What the page is today

`DashboardPage.vue` → `TabWidgets.vue` → nine catalogued widgets (`DASHBOARD_WIDGETS`, `tab: "fleet"`),
rendered in catalogue order as three full-width strips and three rows of paired cards, all scoped
by one 30-day range picker, all drawing from one `/api/dashboard` summary plus three sibling
queries (`useFleetMpgSeries`, `useFuelRangeTotals`, `useFindingsSummaryQuery`).

| # | Widget (`key`) | Span | What it draws |
|---|---|---|---|
| 1 | `fleet.feed-freshness` | full | one line of `text-xs` ("telematics current") — a banner only when stale |
| 2 | `fleet.kpi-hero` | full | 4 hero tiles: Fuel spend · Fleet avg MPG · Idle waste · Active alerts |
| 3 | `fleet.operating-metrics` | full | 10 tiles: Fill-ups · Gallons · Miles · **Fuel spend** · **Avg MPG** · Open findings · Recovered · Telematics coverage · Reefer fuel · Declined attempts |
| 4 | `fleet.spend-trend` | half | daily bars, readout = **sum of spend** |
| 5 | `fleet.mpg-trend` | half | weekly line, readout = **MPG** |
| 6 | `fleet.cost-composition` | half | donut: Moving / **Idle** / **Reefer**, centre = **total spend** |
| 7 | `fleet.severity` | half | donut: critical/high/medium/low, centre = **open cases** |
| 8 | `fleet.top-vehicles` | half | ranked list, badges "N open" |
| 9 | `fleet.top-drivers` | half | ranked list, badges "N open" |

### 1.1 The repetition, counted

Of the ~24 figures on the tab, **nine are restatements of a figure already on it**, and the
window label is restated four times beside the control that set it.

| Figure | Appears in | Times |
|---|---|---|
| Fuel spend (total) | hero tile → operating-metrics tile → spend-trend readout → donut centre | **4** |
| Fleet MPG | hero tile → operating-metrics tile → MPG-trend readout | **3** |
| Open cases | hero "Active alerts" caption → severity donut centre → every risk-list row badge | **3** |
| Idle waste ($) | hero tile → donut slice | 2 |
| Reefer ($) | operating-metrics tile → donut slice | 2 |
| "97% of fuel measured" / coverage | MPG hero caption → MPG trend caption → "Telematics coverage" tile | 3 |
| The window ("Aug 19 – Sep 18") | hero caption · operating-metrics header · spend readout caption · donut subtitle | 4 |

None of this is an accident of sloppiness — each widget fetches for itself so it can be hidden or
reordered independently (LM9/LM10), and the hero strip and the operating strip were each right on
their own. The prototype in `DASHBOARD-TEMPLATE-V2.md` transcribed the same structure from the
comps and so draws `$1.3M` four times too. The repetition is a property of the **composition**, and
the composition was transcribed, never designed (`dashboardEquivalence.test.ts` exists precisely
to prove nothing moved during the LM9 refactor).

### 1.2 Why it reads as flat and uninformative

1. **No number has a reference.** There is no previous period, target or benchmark anywhere on the
   tab. `$1.30M` is a fact; `$1.30M, ↑12% vs the previous 31 days` is information. This is Q-DT4,
   the blocker DASHBOARD-TEMPLATE-V2 already recorded: `useDashboard` never fetches a previous
   window, so the delta pill the comps draw cannot be filled.
2. **Three strips of numbers before any picture.** Feed line (one row), four hero tiles, ten metric
   tiles — roughly 480px of figures at 1440 before the first chart. The two strips share one
   anatomy at two sizes, which is what `OperatingMetricsWidget`'s own header calls "competing as
   hero cards".
3. **Nine equal cards, no question answered first.** The page shows what the numbers are, not
   whether anything is wrong or what to do. "Active alerts" is the nearest thing to an answer and
   it is the fourth tile, in the same weight as the other three.
4. **Mixed time semantics in one row, unmarked.** Three hero tiles are range-scoped; "Active
   alerts" is current state. Nothing tells the reader which is which.
5. **A rank drawn as a ring.** Severity is four ordered buckets; a donut asks the eye to compare arc
   lengths where a bar or a list reads in one pass (Q-DT3 already recommended the list).
6. **Two identical risk cards** with identical anatomy, differing only in noun, side by side — and
   both rank by open anomaly count from a scoring layer whose human verdicts show a high
   false-positive rate (the 2026-10-06 F02/F04 audit: 2,284 open anomalies, 4.6% assigned).
7. **Status as the headline.** The feed-freshness line owns the most prominent full-width row and
   on a healthy day renders as one line of tertiary text — a near-empty first row.
8. **Customize cannot fix it.** LM10 lets a user hide and reorder these nine cards; it cannot merge
   them, so no arrangement removes the duplication.

---

## 2. What the field converged on in 2026 (and what of it applies here)

Read as a set: Samsara's August 2026 Fuel Command Center and Custom Dashboards, Geotab's June–August
2026 Safety / Fuel & Energy / Asset Utilization overview pages, Motive's 2026 Fleet View and alerts
redesign, plus the general SaaS-dashboard roundups and the bento/KPI-card guidance. Sources in §7.

| Pattern | Who ships it | Applies to Fleet overview? |
|---|---|---|
| **Answer-first.** One lead question in the top-left, then drill. "Is everything OK?" before "what are the numbers" | NN/g, every 2026 roundup; Samsara's single "recoverable fuel spend" headline | **Yes.** This is the page's whole defect. |
| **Every KPI carries one comparison** (previous period, target or benchmark) and one visual — not more | KPI-card spec in the bento guidance; Geotab's industry benchmarking | **Yes**, and it is DR2b. |
| **Ranked lists replace tables and rings**; rank by dollars at stake | Samsara Fuel Command Center ("opportunities ranked by the dollars at stake"), Samsara Asset Status redesign, Geotab Safety Overview ("ranked high-risk drivers and assets") | **Yes.** We already have the rows on `FuelCostsPage` (`FuelOpportunitiesStrip`). |
| **Bento, asymmetric, 6–9 tiles, at most two heroes, hero top-left** | Vercel/Linear/Stripe-style analytics; bento guides | **Yes** — nine equal cards → six unequal ones. |
| **One filter row scopes everything**; no per-card period switchers | dataviz interaction rule; Samsara Custom Dashboards | Already true (`DateRangeFilter`). The template's per-card 7D/30D/90D pills should **not** be ported. |
| **One-click actions from the overview** | Samsara ("turn on in-cab idling alerts from the dashboard") | Partly — every tile is already a door (SP5); the rail below makes the doors explicit. |
| **Role-aware layout**, saved per-user arrangement | HubSpot, Datadog, Amplitude | Already built (gates + LM10). Keep. |
| **Container-query KPI grids** (4 → 2 → 1 by the card's width, never the viewport) | Tailwind v4 KPI grid, 2026-10-04 | **Yes**; `OperatingMetricsWidget` measured exactly this trap (D-DR17) and solved it by hand. |
| **Dark-first / quiet chrome** | Linear, Raycast | Tokens are `light-dark()` already; nothing to do here. |
| **AI summaries and natural-language query** | Attio, Hex, Geotab Ace, Samsara assistant | **No**, not now. A sentence generated over figures that have no reference yet would be a workaround for the missing comparison. The one-line "what changed" lead on the greeting (§4, band 0) is derived from DR2b's deltas, not generated. |
| **Glassmorphism / expressive cards** | showcase pieces | **No.** D-DT1 already refused the gradient fill; this page is Operate mode. |

**On chart libraries.** Chart.js 4.5.1 stays. Everything the page draws — bars, one line with an
area wash, a stacked share bar, a ranked bar list — is inside Chart.js's nine types or is plain
HTML, and `chartTheme.ts` (`trendOptions`, `niceScale`, `areaFill`, `lastPointRadius`, the scrub
readout, `lint:chart-colors`) is built on it. Apache ECharts (~300KB) buys sankeys and 100k-point
series the page does not have; Unovis's CSS-variable theming is attractive but `resolve()` already
reads `--viz-*` tokens into Chart.js. Changing the library would be a workaround for a layout
problem. (Weavelinx, LightningChart, FusionCharts 2026 comparisons — §7.)

---

## 3. Decisions proposed

**D-FO1 — Each figure appears once on the tab.** A figure is drawn where it is the subject, and
nowhere else. Total spend lives in the Fuel card; MPG in the Efficiency card; open cases in the
rail. The window is named once, in the control row, and every card's caption says *vs previous*
rather than restating the dates.

**D-FO2 — A card answers one question, and holds that question's number, trend and caveat
together.** The spend trend, the composition donut and the two spend tiles were four views of one
question ("what did fuel cost?"); they become one card. Same for MPG (three views → one).

**D-FO3 — The comparison is the chart.** The spend bars draw the previous period as a grey ghost
behind this period's bar, day for day; the MPG line sits on a quiet band showing where last
period's weeks fell. The delta pill then has a picture to point at. **This requires DR2b** (a
previous-window fetch) and the proposal does not ship without it — see Q-FO1.

**D-FO4 — Severity is a stacked bar, not a ring.** Accepts Q-DT3's recommendation. Four ordered
buckets read as one bar with the existing `--viz-severity-*` tokens, under the open-cases count in
the rail. The `DonutBreakdown` component stays for genuine part-to-whole uses elsewhere.

**D-FO5 — One ranked list with a Vehicles | Drivers switch, drawn as bars.** Replaces two identical
cards. Bar length is open cases; the critical share is a status-red segment at the left. The
"risk" wording goes: the list ranks *open cases*, which is what the data is, and it says so
until the card-fraud plan's incident type gives it something better to rank by.

**D-FO6 — "Needs attention" is a column, current-state, labelled "open now".** Card declines to
review (22 of 309 in the F02 audit), open cases with the severity bar, unassigned findings
(158, $ in dispute), idle hours — each row a count, one line of context and one door. This is the
page's answer to "is everything OK", placed top-right where the eye lands after the hero. It is
the only range-independent card on the tab and its subtitle says so, which closes defect §1.2 (4).

**D-FO7 — The activity strip keeps only the figures that appear nowhere else.** Fill-ups, Gallons,
Miles driven, Telematics coverage — one card subdivided by hairlines (D-DT comps' "operating
metrics" archetype, kept), four cells, container-query columns. Reefer, Recovered and Declined
leave the strip: reefer is a slice of the Fuel card, declines are a rail row, "Recovered" is a
`FuelCostsPage` figure and belongs there.

**D-FO8 — Feed freshness is a status chip in the control row.** `SamsaraFeedLine` already computes
`lead` and `needsAttention`; the chip renders the calm case at 28px beside the range picker and
expands into the existing caution banner above the grid only when something is stale. The
full-width first row goes.

**D-FO9 — The savings list is reused, not rebuilt.** `FuelOpportunitiesStrip` from `FuelCostsPage`
renders the "Biggest savings on the table" card with the same rows, gated as it is there. Deriving
beats restating (root `CLAUDE.md`).

**D-FO10 — Six cards, not nine; no per-card period switchers.** Hero band (3) + activity strip (1)
+ concentration and savings (2). Inside the bento guidance's 6–9 cap, with the two hero cards
anchoring top-left.

---

## 4. The layout (`prototypes/fleet-overview-v3.html`)

Serve the repo root and open it — tokens load from `/packages/ui/src/tokens.generated.css`:

```
python3 -m http.server 8731
open http://127.0.0.1:8731/docs/plans/design-system/prototypes/fleet-overview-v3.html
```

A 1440-wide render is beside it as `fleet-overview-v3.png`. Figures are illustrative.

```
┌ greeting ─────────────────────────────────────────────────────────────────────────┐
│ Good evening, Miki.                                                                │
│ Fuel is running ahead of last month. Two things need a decision today.  ← derived  │
├ control row ──────────────────────────────────────────────────────────────────────┤
│ [Fleet overview | Dispatch]        ● Telematics current · 4 min   [range] [Customize] [Export] │
├ band 1 — 12 cols ─────────────────────────────────────────────────────────────────┤
│ FUEL SPEND (5)                 │ FLEET MPG (4)              │ NEEDS ATTENTION (3)  │
│ $1.30M ↑12% vs previous        │ 7.72 ↑0.3 vs 7.42          │ open now · ranked    │
│ daily bars + previous ghost    │ weekly line + prev band    │ declines to review 22│
│ moving | idle | reefer bar     │ measured-share caveat once │ open cases 68 ▇▇▇▇   │
│                                │                            │ findings unassigned  │
│                                │                            │ idle hours ↑18%      │
├ band 2 — one card, 4 cells, container queries ────────────────────────────────────┤
│ Fill-ups 2,045 ↑6% │ Gallons 235,003 ↑3% │ Miles 1.63M ↑5% │ Coverage 97% —        │
├ band 3 — 6 + 6 ───────────────────────────────────────────────────────────────────┤
│ WHERE OPEN CASES CONCENTRATE   [Vehicles|Drivers] │ BIGGEST SAVINGS ON THE TABLE    │
│ ranked bars, critical segment red                 │ FuelOpportunitiesStrip, by $    │
└───────────────────────────────────────────────────────────────────────────────────┘
```

Band 1's three cards answer, in reading order: *what did it cost* → *how efficiently* → *what needs
me*. Every figure from §1.1's table appears exactly once. At `lg` the hero collapses 5/4/3 → 12/6/6
→ 12/12/12 (D-DT5: breakpoints collapse spans, never restyle widgets).

### 4.1 Component work, mapped to what exists

| Proposal | Builds on | New? |
|---|---|---|
| Delta pill (`↑ 12%`, good/bad/flat, `sr-only` direction text) | DR2b's primitive, D-DT2 (one encoding of movement) | the primitive is specified in DASHBOARD-TEMPLATE-V2 §4.1; its data is DR2b |
| Previous-period ghost bars / band | `trendOptions`, `BAR_GEOMETRY`, `areaFill` — a second dataset in `--ramp-neutral-200` | small: Chart.js already draws grouped bars |
| Stacked share bar (composition) | `COST_COLORS`, legend pattern from `DonutBreakdown` | **new small primitive**, ~60 lines, replaces the donut on this page only |
| Needs-attention rail | `ChartCard` frame + `useOpens` doors; rows from `useDashboard` (`declinedCount`, `anomaliesBySeverity`, `idleHours`) and `useFindingsSummary` | **new widget**, `fleet.attention`, span `half`-sized third column (needs a 12-col span value; see Q-FO3) |
| Ranked bar list | `RiskList` rows + a `track` with two segments | extend `RiskList`, add the Vehicles/Drivers switch (`SegmentedTabs` v2) |
| Status chip for feed freshness | `SamsaraFeedLine` (keeps the banner path) | a second render mode on the same component |
| Savings card | `FuelOpportunitiesStrip` | reuse; a catalogue row with its gate |

Charts stay on Chart.js (§2). The container-query strip is the one place Tailwind utilities need
`@container` — Tailwind 4 ships it.

### 4.2 What this removes from the catalogue

`fleet.kpi-hero`, `fleet.operating-metrics`, `fleet.spend-trend`, `fleet.mpg-trend`,
`fleet.cost-composition`, `fleet.severity`, `fleet.top-vehicles`, `fleet.top-drivers`,
`fleet.feed-freshness` → `fleet.fuel`, `fleet.efficiency`, `fleet.attention`, `fleet.activity`,
`fleet.concentration`, `fleet.savings`. Widget keys are **storable** (LM10 writes them per user), so
this orphans every saved fleet-tab layout — see Q-FO4. `dashboardEquivalence.test.ts` pins the
current tree by design and must be re-captured as a deliberate act, not patched green.

---

## 5. Open questions — blockers, recorded rather than routed around

**Q-FO1 — DR2b first, or ship without deltas?** D-FO3 makes the comparison the chart, and
nothing on the page can compare without a previous-window fetch. `FuelCostsPage` already computes
a previous period for spend (`spendCard.previous`, "comparing …"), so the service pattern exists;
the dashboard summary needs the same for spend, MPG, gallons, miles, fill-ups and idle hours.
Candidates: (a) DR2b lands first, then this layout; (b) this layout lands with the pill slots
empty, DR2b fills them. **Recommendation: (a).** Q-DT4 reached the same answer and (b) ships a hole
in the anatomy with no ticket to close it.

**Q-FO2 — Does the spend trend merge into the hero card, or stay a sibling?** D-FO2 merges it,
which is what removes two of the four `$1.30M`s. The cost is a taller hero card (≈380px) and a
smaller plot than today's 260px. Candidates: (a) merge, as drawn; (b) keep the trend as a half card
in band 3 and let the hero carry the number + composition bar only. **Recommendation: (a).**

**Q-FO3 — A third span value.** `DashboardWidget.span` is `full | half | workspace`; band 1 needs
5/4/3 of twelve. Candidates: (a) add `span: "third"` and let the hero be 4/4/4; (b) replace the
enum with a column count `cols: 1..12`. **Recommendation: (b)** — it is the honest shape, and
`resolveDashboardLayout` only reorders keys, so the editor is unaffected.

**Q-FO4 — Saved layouts.** Six new keys orphan every stored `fleet` arrangement. Candidates: (a) a
migration mapping old keys → new (hero → fuel+efficiency+attention is one-to-many, so it is a
guess); (b) reset the fleet tab to the role default and say so once in the UI. **Recommendation:
(b)** — a reset is honest, a guessed mapping is not. LM10's own header says a renamed key orphans
a layout "exactly as a surface key does for a grant".

**Q-FO5 — Does `FuelOpportunitiesStrip` belong on the overview?** Its rows are the Fuel costs
page's and it carries that page's gate. Candidates: (a) reuse it, gated as there; (b) leave the
overview without a savings card until the card-fraud plan's incident type exists and rank that.
**Recommendation: (a)** — Samsara's "ranked by dollars at stake" is the one 2026 pattern that
maps directly onto rows we already compute.

**Q-FO6 — The greeting's second line.** The prototype writes "Fuel is running ahead of last month.
Two things need a decision today." That sentence is *derived* (largest delta by magnitude, count
of rail rows above zero), not generated, and it is the only "AI-native" gesture the proposal
makes. Candidates: (a) ship it, derived; (b) keep today's static tagline. **Recommendation: (a)**,
after DR2b, since it needs a delta to name.

**Q-FO7 — The rail ranks "by what it costs" but two rows have no dollar figure** (declines, open
cases). Candidates: (a) rank by a fixed editorial order (declines, cases, findings, idle) and drop
the "ranked" claim from the subtitle; (b) wait for the card-fraud plan to price declines.
**Recommendation: (a)** now, with the subtitle reading "open now", and revisit when CF lands.

---

## 6. What this does NOT propose

- No change to the gate model: every new widget takes a `SurfaceGate` and the money inside it goes
  through `applyMoneyGate` exactly as today (Q-LM-F1). A `fleet_manager` sees the Fuel card with
  the dollars removed and the composition bar in shares only.
- No change to the Dispatch tab or the live map (D-DR24).
- No new chart library, no gradients, no glass, no per-card period switchers, no generated prose.
- No change to the hero plate, the greeting, or the control row's position (D-DT18, D-DT20).

---

## 7. Sources

Fleet platforms, 2026: [Samsara — August 2026 product updates (Fuel Command Center, Custom
Dashboards)](https://www.samsara.com/blog/august-product-updates-2026) · [Geotab — What's new in
MyGeotab, June 2026 (Safety Overview, Fuel & Energy Overview, Asset
Utilization)](https://support.geotab.com/product-updates/release-notes/mygeotab-updates-june-2026)
· [Geotab — July 2026](https://support.geotab.com/product-updates/release-notes/whats-new-july-2026)
· [Motive review 2026 (Fleet View, alerts redesign)](https://tech.co/fleet-management/motive-review)
· [Samsara — Meet the new platform experience](https://www.samsara.com/blog/meet-the-new-samsara-platform-experience).

Dashboard patterns, 2026: [925 Studios — 35 SaaS dashboard design examples, trends and
patterns](https://www.925studios.co/blog/saas-dashboard-design-examples-2026) · [The Frontend
Company — UI trends 2026](https://www.thefrontendcompany.com/posts/ui-trends) · [AdminLTE — SaaS
dashboard examples & trends](https://adminlte.io/blog/saas-dashboard-design-examples/) · [Flowmaze
— SaaS dashboard UX frameworks](https://flowmazeux.com/saas-dashboard-design-best-practices/) ·
[Orbix — Bento grid dashboard design](https://www.orbix.studio/blogs/bento-grid-dashboard-design-aesthetics)
· [Setproduct — Dashboard UI design, KPIs to layouts](https://www.setproduct.com/blog/dashboard-ui-design)
· [Datawireframe — 12 dashboard layout patterns](https://www.datawirefra.me/blog/dashboard-layout-patterns)
· [Codefronts — Tailwind v4 container-query KPI grid](https://codefronts.com/layouts/tailwind-css-dashboard-layouts/tailwind-css-dashboard-kpi-stat-cards-grid/).

Chart libraries, 2026: [Weavelinx — Best chart libraries for Vue 2026](https://weavelinx.com/blog/best-chart-libraries-for-vue-projects-in-2026/)
· [LightningChart — JavaScript charting library comparison 2026](https://lightningchart.com/blog/the-ultimate-javascript-charting-library-comparison-2026/)
· [FusionCharts — Best Vue chart library 2026](https://www.fusioncharts.com/blog/best-vue-chart-library)
· [tech-insider — Recharts vs vue-chartjs 2026](https://tech-insider.org/react-vs-vue-charts-setup-2026/).

---

**D-FO11 — DR2b is a second client fetch, not a server aggregate.** D-DR12 named the choice;
`useDashboardComparison` takes the round trip: the endpoint already answers any window, so there
is nothing to hold behind a release, and the previous window is history and is cached for ten
minutes with no polling. The cost — `/api/dashboard` called twice per range change — is recorded on
the composable, with the server aggregate (reading `previousWindow` from `@silvicom/shared`) named
as the fix if the request metrics ever show it.

## 8. Progress log

- **2026-10-06 (later)** — Owner: "proceed as recommended", which rules Q-FO1 (a), Q-FO2 (a),
  Q-FO3 (b), Q-FO4 (b), Q-FO5 (a), Q-FO6 (a), Q-FO7 (a). **DR2b built** on
  `claude/fleet-overview-dr2b`: `dashboardComparison.ts` in shared (`previousWindow`, `periodDelta`,
  `deltaTone`, `deltaLabel`), `AppDelta` in `@silvicom/ui`, `useDashboardComparison` beside
  `useDashboard`, `StatCard` grew a head-row `delta` prop (D-DT6), and the three period tiles of
  `KpiHeroWidget` carry it — Active alerts does not (D-DR12). Proved by mutation: a pill on the
  alerts tile, a flipped spend verdict, and a pill shown while loading each turn a test red. The
  six-card layout is the next PR.
- **2026-10-06** — Proposal written. Duplication counted from `DASHBOARD_WIDGETS` and the nine
  widget sources (§1.1); 2026 patterns read from the vendor release notes and roundups in §7;
  layout drawn at `prototypes/fleet-overview-v3.html` on the product's tokens and rendered at
  1440. Awaiting the owner's rulings on Q-FO1..7. Nothing in `apps/` changed.
