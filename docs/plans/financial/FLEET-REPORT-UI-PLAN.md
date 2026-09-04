# Finance — the fleet report's surface

**Status:** ACTIVE. **Owner:** Miki. **Written:** 2026-09-04, after the owner approved the
redesign proposal ("I like your solution") and, the same day, asked for its chart components to be
softer and more transparent, then said to build it.

**Scope:** the SURFACE of the Finance section — `/fleet-report`, `/billing`, `/shop` — and the
chart language they share. Nothing here changes a figure, a collector, or the harness.
[FINANCE-FLEET-REPORT-PLAN](./FINANCE-FLEET-REPORT-PLAN.md) stays the queue for what the report
*computes*; this document is the queue for how it *reads*. The two are deliberately separate files
so a UI step and a W-series step never mark the same table row.

**The proposal this executes:** the artifact "Fleet Report Redesign" (v2, 2026-09-04), which
carries the annotated screenshots of the pages as merged, the interactive mockups, and the chart
treatment. Its §1 findings are restated in §1 below so the record survives the artifact.

---

## 0. The rulings this plan is built on

Everything in [FINANCE-FLEET-REPORT-PLAN §0](./FINANCE-FLEET-REPORT-PLAN.md) (D-FLEET1–10) and
D-FIN10 stands unchanged. The surface rulings below are additive.

- **D-FRUI1 — one clock for the whole section.** The period is chosen once, above the tabs, and
  drives every tab, the trend and the export. It opens on the latest month whose ledger the sweep
  has finished, derived from the data (`monthsPartial`, `ledgerReason`), never from the calendar.
  The control is a month stepper with Month · Quarter · Year to date presets, because the
  collectors' grain is the calendar month (D-FLEET6); a day-range picker on a month-grained report
  offered a precision the report cannot honour.
- **D-FRUI2 — trust is a chip, not a sentence.** "Ties to ledger · swept 28 Aug" as a badge beside
  the period, the full provenance sentence as its title and inside the explainer. A period that does
  not tie shows the same chip in the warning tone with the residual. The residual is printed even at
  $0.00 (G8).
- **D-FRUI3 — every number gets a neighbour.** A headline shows this period, the change against the
  previous period, and the year to date. Direction is a word and an arrow; colour only underlines.
  The previous period comes from the trend series the page already fetches — no new read.
- **D-FRUI4 — summary before detail, shape before digits.** Where every dollar went is one bar and
  ten rows on the Overview. The month-by-month table carries inline bars. A share of revenue is a
  bar first and a number second. A rate per dispatcher is a dot against the fleet line.
- **D-FRUI5 — refusals are designed states.** A month without a rate, a month the sweep has not
  reached, a residual that is not zero: one callout each, one sentence, a next action, in the words
  the API already uses (D-FIN10, D-FLEET5, G11). Never a run of grey sentences.
- **D-FRUI6 — one table per tab still holds.** The Overview keeps ONE table (month by month); the
  company/contractor split moves to the Contractors tab, where it is the question being asked.
- **D-FRUI7 — the chart language is soft in the fill and firm in the stroke.** Lines are 2px with a
  gradient wash beneath (the headline series to the baseline, the others fading within a few
  pixels so washes never overlap); bars are one hue at graded opacity over a 9% track of the same
  hue; end-dots carry a surface ring; grid is a solid hairline one step off the surface; there are
  no dashed rules and no interior points. Colour is never the only cue: every series is named in a
  legend and every dot has its number beside it.
- **D-FRUI8 — chart strokes are validated, not judged.** The three money hues were softened and run
  through the palette validator in both themes. Light `#3b6fe0 · #d9603f · #1a9f74`, dark
  `#6386e0 · #de6f52 · #2aa47c`: lightness band, chroma floor, colour-vision separation (worst
  pair ΔE 8.4 light / 8.2 dark), normal-vision floor and 3:1 against the surface all pass.
  Anything softer failed one of the five, which is why the softness lives in the fills. The values
  are authored as `oklch()` in `packages/tokens/src/roles.{light,dark}.json` because
  `check-chart-colors.mjs` refuses any other form, and the `chartTheme.ts` fallbacks are the gate's
  own hex output for the light halves (D-DS15: "the fallbacks must BE the tokens").
- **D-FRUI9 — no new date widget.** The period control is composed from primitives that exist:
  buttons for the stepper, `AppSegmentedControl` for the presets, and the existing
  `DateRangeFilter` for a custom range snapped to whole months. `DatePickerBase.vue` stays the
  single opinion about what a date looks like; a month mode is not added to it.

### What was measured, 2026-09-04

Against `origin/main` `b410140` (after PR #527 and #530), rendered in a real browser with the
plan's July 2026 acceptance figures as fixtures. The proposal's §1 carries the screenshots.

| # | Finding | Where |
|---|---|---|
| 1 | The provenance sentence — the one that makes every number quotable — is 12px tertiary text mid-line | `CpmReportPage.vue:203` |
| 2 | **The Overview and Income statement tabs have no period control.** `DateRangeFilter` lives in the `DataWorkspace` that renders only for Per truck / Contractors. The default `lastFullMonth()` opens on a month the sweep may not have finished | `CpmReportPage.vue:342` |
| 3 | No figure has a neighbour: no previous month, no year to date, although fleet-trend carries both | plan §2 Tab 1 |
| 4 | Every figure is a digit in a table; no bar, share or ranking. The phone render is 2,816px tall | `FleetOverview.vue` |
| 5 | The empty-mile share (plan §1.5.4, "the figure a boss can act on") is the third card row under a footnote; the families are on another tab under three repeated cards | |
| 6 | Refusals read as errors: five grey sentences under the chart, an orange sentence above the families, a yellow box for a withheld month | |
| 7 | Two pages, two clocks: `/billing` opens on a trailing 90 days; the dispatcher rate the plan places on Tab 3 lives there | `BillingPage.vue:22` |
| 8 | `/billing` Per truck prints per-truck expenses and margin from attributed lines — the figure D-FLEET1 retired | `margin-by-truck` |
| 9 | `/shop` lists raw AP vouchers and promises FleetPal detail that §0 of the fleet plan deleted | `MaintenanceSpendPage.vue` |

---

## 1. The owner's decisions, 2026-09-04

The proposal asked four questions and recommended an answer to each. The owner's instruction
was to implement the solution as proposed; the recommendations are therefore taken as the ruling
and recorded here so a later reader knows they were decided, not assumed.

| | Question | Ruling |
|---|---|---|
| Q1 | Does Per dispatcher move onto the fleet report? | **Yes** (R7). `/billing` keeps invoices as a lookup page named "Invoices". |
| Q2 | Does Billing's per-truck margin tab go? | **Yes** (R7). Per-truck revenue stays on the fleet report; no per-truck cost anywhere (D-FLEET1). |
| Q3 | What does `/shop` become? | A monthly total from the maintenance family plus the inspections links (R7). No new collector, no FleetPal. |
| Q4 | Do the three money tokens change to the softer values? | **Yes** (R0), as its own PR, because it recolours the existing trend chart on day one. |

---

## 2. What we build — the R-series

One PR per step, every gate green on its own, no migration anywhere in the series. Each step is
independently shippable; the order is the order the value arrives in and the order the 500-line
file budget permits.

| # | Step | What it is | Done when |
|---|---|---|---|
| **R1** | **The split** | `FleetReportPage.vue` as the shell (period, the three queries, tabs, provenance); `FleetTrucksTab`, `FleetContractorsTab`, `IncomeStatementTab` under `features/accounting/`; `useDispatcherEarnings` moves to `@/composables` so the fleet report can read it without crossing a feature boundary. No visual change. | The page renders identically; `FleetReportPage.test.ts` pins the shell's behaviour; `lint:filesize` and `lint:boundaries` green. |
| **R0** | **The softer money tokens** | `--viz-money-earned/-spent/-kept` to the D-FRUI8 values in both `roles.*.json`, `tokens.generated.css` regenerated, `chartTheme.ts` fallbacks set to the gate's own hex. | `lint:chart-colors`, `lint:codegen`, `lint:token-gamut` green; the existing trend chart draws in the new hues. |
| **R2** | **The period rail** | `FleetPeriodRail` above the tabs: stepper, `AppSegmentedControl` presets (Month · Quarter · Year to date · Custom), custom via `DateRangeFilter` snapped to whole months. Default = latest complete ledger month from the data. The toolbars on Per truck / Contractors lose their date picker. | Every tab reads the same period; the page opens on the latest finished month; a period ending in a partial month is refused with the reason. |
| **R3** | **Trust chip and the four headlines** | `AppBadge` with the provenance sentence as its title; four `StatCard`s (Kept as `size="hero"`), `spark` from the trend, change against the previous month in `sub`/`subTone` using the `SpendTrendTab` idiom, year to date from the report. | The Overview leads with Kept, its change and its year to date; a first month with no predecessor says "no previous month"; a null rate prints a dash with its reason. |
| **R4** | **Where every dollar went, and the miles bar** | `FamilyBridge.vue`: one stacked bar of ten families plus Kept from `families.expense[].pctOfRevenue`, the list beneath; the driven-versus-billed miles bar with the empty share as a translucent overlay. The company/contractor split moves to the Contractors tab (D-FRUI6). | The bar's segments sum to 100% of earned; opacity steps come from `resolveAlpha`; the Overview has one table. |
| **R5** | **Month by month** | The trend chart takes the D-FRUI7 treatment (gradient washes via scriptable `backgroundColor`, no interior points, ringed end-dots, the no-rate band) and gains the table beneath it: money, miles, trucks, the three rates and the empty share per month, the current month highlighted, year to date last. Needs `emptyPct` on each trend point (shared contract + service). | Dashes carry their reason once each; the refusal sentences collapse into one callout with a next action. |
| **R6** | **Income statement: compare, find, print** | Family bars; a compare-to control (previous month · year to date · off) so the statement shows one comparison column; account search that scrolls to the row; sticky section headers; a print stylesheet in McLeod's layout. Needs a `compare` query on `income-statement`. | The statement prints on one page in McLeod's order with codes; the compare column is the one chosen. |
| **R7** | **Consolidation** | Per dispatcher on the fleet report with the dot plot; `/billing` → "Invoices", per-truck margin tab retired; `/shop` header and a monthly maintenance-family total with the inspections links. | `lint:surfaces` green with the new labels; no per-truck cost figure anywhere in Finance. |

**Ordering:** R1 first, because nothing else fits in the file budget until the split lands.
R0 next, because it is one token PR and it changes what the owner sees the same day. Then R2–R7
in order; each depends on the one before only through the shell.

---

## 3. What this plan refuses to do

- **No figure changes.** Every number on every tab still comes out of `computeFleetReport`,
  `computeFleetTrend` and `buildIncomeStatement`. The surface adds a comparison column and a
  percentage share, both of which are arithmetic the harness already exposes or a division of two
  figures it returns — never a new source, never an allocation (D-FLEET8).
- **No per-truck cost column**, on any tab, however the table is redrawn (D-FLEET1).
- **No zero where a measurement is absent.** A null rate is a dash with its reason (D-FIN10).
- **No hex in a template, no dashed grid, no interior points, no ten-hue palette.** D-FRUI7/8.
- **No new date primitive.** D-FRUI9.
- **No second period model.** Once R2 lands, `/billing` and `/shop` read the same month as the
  report or are retired into it (R7).
- **No page the fleet plan deleted comes back.** The trust chip carries the close's guarantee on
  every tab, which is what G8 ruled.
- **No open question in this file.** One appears, it gets a decision here before code moves.

---

## 4. Progress log — append one dated line per step, never edit the §2 table

- 2026-09-04 · plan written from the approved proposal. D-FRUI1–9. Nine findings measured against
  `b410140` in a real browser; four owner decisions recorded in §1.
- 2026-09-04 · **R1 — the split.** `CpmReportPage.vue` (402 lines) becomes `FleetReportPage.vue`
  (the shell) plus `FleetTrucksTab`, `FleetContractorsTab` and `IncomeStatementTab`;
  `useDispatcherEarnings` moves to `@/composables`. Each tab is mounted fresh (`v-if`), which is
  what resets paging on a tab change — the page test pins it by paging to 21–40, leaving, and
  coming back to 1–20. Nothing on screen changed.
- 2026-09-04 · **R0 — the softer money hues.** `--viz-money-earned/-spent/-kept` to the D-FRUI8
  values in both theme files, `tokens.generated.css` regenerated, `chartTheme.ts` fallbacks set
  to the chart-colour gate's own hex for the light halves. Round-trips cleanly: the gate's hex is
  the validated hex. Money-palette separation under the gate: protan 0.288, deutan 0.161, tritan
  0.113. No test pinned a hex; the "three distinct colours" test still holds.
- 2026-09-04 · **R2 — the period rail.** `lib/reportPeriod.ts` (pure: month, quarter, year to
  date, custom snapped to whole months, stepping, the cap, the label, and the latest reportable
  month read from the trend) and `FleetPeriodRail.vue` (two icon buttons, `AppSegmentedControl`,
  the section's own `DateRangeFilter` for a custom run — no new date widget, D-FRUI9). The page
  opens on the latest month the sweep finished, not the calendar's; the three period queries stay
  off until that month is known, so the withheld-August request the old default made is gone. The
  per-tab date pickers are removed — the rail is the only clock. Pinned: the rail reads "July 2026"
  when the trend says August was swept on the 28th, the note says so, stepping back changes the
  month on every tab, and the per-tab picker is gone.
- 2026-09-04 · **R3 — the trust chip and the four headlines.** `fleetTrust` (beside
  `fleetProvenanceLine`: green when the split ties, warning with the residual when it misses,
  neutral when no month could be reported; the full sentence as its title) rendered with
  `BADGE_BASE`/`toneClass` in the rail's slot — not `AppBadge`, whose `capitalize` would title-case
  the sentence. `FleetHeadlines.vue`: Kept, Earned, Spent, Kept per mile as hero `StatCard`s with
  the change against the previous month (`lib/periodChange.ts`, the `SpendTrendTab` idiom made a
  lib), the year to date from the report, and an eight-month sparkline from the trend the page
  already fetches (same query key as the chart, so no second request). `StatCard` gains a `#sub`
  slot so a change in red can sit beside a year-to-date figure in grey on one line. **A
  month-on-month change is offered for a month period only** — a quarter or a year to date would
  need previous-period sums the harness does not expose, so those grains show the year to date and
  say "no month-on-month change" rather than a number nobody can check. The three cards that led
  `FleetOverview` moved here. Pinned: kept leads with "−47.7% vs June $1,473,729"; a rise in
  spending is red and a fall in earnings is red; no previous month says so; a null rate is a dash
  with the coverage reason, never $0.00; the rate's change is in dollars, not a percentage of a rate.
- 2026-09-04 · **R4 — where every dollar went, and the miles bar.** `FamilyBridge.vue`: one bar
  of the ten signed families plus Kept as shares of what was earned, the list beneath with dollars,
  per mile and share. Colour is one hue at graded opacity, largest darkest (D-FRUI7) — brand-ramp
  utilities with alpha, because a segment is CSS and the `--viz-*` roles are not Tailwind colours;
  Kept is the only second hue; an unfiled family wears the warning tone; a period that lost money
  draws no kept slice and says so. `FleetMilesCard.vue`: driven against billed as one bar with the
  empty share overlaid in the caution hue, the two rates labelled by their denominators, the
  coverage reason instead of a bar when there is no empty share (D-FIN10). The company/contractor
  split moves to the Contractors tab as `FleetSplitCard.vue` — a definition list, not a
  `DataTable`, so that tab keeps its one table (D-FRUI6). `FleetOverview` is now the withheld
  callout (`AppCallout`, D-FRUI5), the bridge, the miles card and the source line. Pinned: the
  segments and Kept sum to 100 of earned; ten rows largest first; one hue plus Kept's; the warning
  swatch for "Not yet grouped"; no kept slice for a loss; the miles card refuses with the reason.
- 2026-09-04 · **R5 — month by month, and the chart's soft treatment.** `FleetTrendPoint` gains
  `emptyPct` (shared harness, gated on the same denominator as the rates — a refused month has no
  empty share either; one new mutation-minded test). The chart takes D-FRUI7: `areaFill` learns
  `midAt`/`fadeAt`, Kept washes to the baseline, Earned and Spent fade out within the top third so
  three washes never overlap, no points along the line and one ringed dot on the last month
  (`pointRadius` scriptable), tension .35. `FleetMonthTable.vue` sits in the chart's card, reading
  the same query: newest first, the month on screen highlighted, Kept with an inline bar to the
  span's widest month, dashes carrying the coverage reason for a refused month, the empty share as
  the last column. No year-to-date row: its rates would need sums the page must not make; the
  headlines carry the year-to-date money. The web reads `emptyPct` as optional so the deploy window
  — the old API serving the new page for nine minutes — reads a dash, never a zero.
- 2026-09-04 · **R6 — income statement: compare, find, print.** The API's `income-statement` takes
  `compare=ytd|previous|none` (strict enum, default `ytd`): `previous` reads the period of the same
  length immediately before through the same reader, so a comparative month swept mid-month is
  withheld exactly as a period month would be (G11), and the response says in `comparison` what the
  column holds. Four service tests. The web labels the column by the RESPONSE, not the request —
  the deploy window's old API answers `previous` with the year to date, and the page says so. The
  tab gains the compare control (`AppSegmentedControl`), a find-an-account search that narrows the
  rows and counts them, share bars on the family summary, sticky section headings, and "Print
  statement" in the page header — the browser's print with `.print-target` rules that drop the
  tools row and keep each section with its rows. The default comparison is the previous period for
  a month and the year to date for anything longer. Seven tab tests. No "Expand all": the row
  drill-down stays one click per account.
