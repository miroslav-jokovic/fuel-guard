# Small screens: record cards, dashboard cards, Operations

**Status:** owner approved the direction 2026-11-14 ("I like your solutions… do it properly, without
any assumptions, update the proper components"). Build in progress — see §8.
**Pictures:** `prototypes/small-screens-2026-11-14/` (`mockups.html`, and `A-record-card.png`,
`B-charts.png`, `C-operations.png`). They are the approved DIRECTION; where a measured fact below
disagrees with a picture, the fact wins and §3 says so.

## 1. The ask

The owner, 2026-11-14: on phone and mid widths, from the moment tables become cards —

1. cards have no visible, precise form;
2. they look messy and unorganised;
3. some elements leave the screen;
4. some texts and titles are squeezed onto many rows;
5. some buttons are deformed the same way;
6. the graphs on the fuel dashboard tab are squeezed;
7. the Operations tab is badly laid out, on big screens too.

## 2. Measured, 2026-11-14

A read-only pass on staging (`staging-api.360.silvicominc.com`, the staging admin test member):
the three Dashboard tabs at 390 / 768 / 1024 / 1440 px, and 34 list pages at 390 / 700 / 1024 px,
full-page screenshots plus two measurements per page (the document's `scrollWidth`, and every
element whose box leaves the viewport outside a scroller).

| # | Finding | Measurement | Cause, at the call site |
|---|---|---|---|
| M1 | Cards have no edges | Every list is one white slab with hairlines between rows | `DataTableCards.vue` draws `<ul class="divide-y">` inside the workspace's single `AppCard` |
| M2 | The unmarked card carries every column | Drivers: 12 stacked fields, ~385 px a row, under 2 rows a screen. Fuel log: 6 figures in a wrapping row, the sixth alone on a second line; 4 rows a screen | The "full card" branch: numerics in `flex flex-wrap`, text columns in a `grid-cols-[auto_1fr]` whose label column is as wide as the longest label ON THAT CARD, so values start at a different x on every list |
| M3 | Only 25 of 125 table files mark their card facts | `grep 'card: "'` — the shop's files (contract §9 rule 3). The other 100 fall to M2 | §9 holds for phone-first sections only; the office lists were never marked |
| M4 | One page scrolls sideways | Fleet overview at 390 px: document is 541 px wide. None of the 34 list pages does, at any of the three widths | A chart's `table.sr-only` (the accessible data table) is not clipped by its card |
| M5 | Dashboard cards are squeezed at laptop width | 1024 px with the sidebar open leaves ~690 px of content; `fleet.efficiency` (span 4) is ~210 px wide: its subtitle breaks one word a line and its header link prints over its title. `fleet.attention` (span 3) is ~150 px | `TabWidgets.vue` `SPAN_CLASS` collapses spans on VIEWPORT breakpoints (`md:` / `lg:`); the sidebar's 270 px are not in the arithmetic |
| M6 | Chart axes collide | Fleet MPG at 1024: "10/15 10/19 10/26 11/02 11/09" run together; an empty series still draws 240 px of blank grid | Tick count is not bounded by the plot's width; no empty state in the two trend widgets |
| M7 | Card titles wrap beside their own controls | "Where open cases concentrate" takes 3 lines beside its Vehicles/Drivers switch at 390, 768 and 1024 | `ChartCard`'s header is one `flex justify-between` row at every width |
| M8 | Toolbars wrap | Drivers at 390: four filter triggers, two clear buttons, Views and Columns on three lines, then a full-width SORT bar | `FilterBar` stacks its groups below `lg` but each group still wraps; the card view's sort control is a bar of its own |
| M9 | The Ask AI launcher covers content | Over a card title on Operations (768, 1440), over the Fuel-spend split bar (390), over "204 trucks" on Idling (1024) | To verify against `bottomChrome.ts` before touching — it already lifts above bottom bars |
| M10 | Tab strips are cut | Idling at 390: "Truck capability" is clipped with no hint that the strip scrolls | To verify in `AppTabs.vue` |
| M11 | Operations is 37 equal rows | Nine `span: 4` cards, 37 `CountList` rows, 28 of them `0` on staging; cards in a grid row stretch to the tallest (Seats ends 250 px above its own bottom edge); 4,454 px at 390 | Every row is label + caption + figure + door at one weight; the grid row sets the height |
| M12 | KPI tiles break mid-figure at laptop width | Idling at 1024: "49,947.5 engine-" / "on h"; four tiles in a row of ~165 px each, stretched to the tallest's 360 px | Tile grids use viewport breakpoints, the same arithmetic as M5 |

**Not found, and so not planned:** a list page that scrolls sideways; a button whose LABEL wraps
(the automatic count was wrong — it read a 44 px button as two lines of text; the screenshots show
none). What the owner saw as deformed buttons is M8: rows of controls wrapping.

## 3. What already exists, and what that changes

Read before the build, and each one changed the design:

- **Contract §9 "Phone and tablet" (Maintenance M4, 2026-10-28)** already sets the small-screen
  rules: a 48 px touch floor provided once by the shell (`provideTouchTargets`) and read by every
  primitive, a bottom verb bar, one way back, and **rule 3 — the three-fact card**:
  `DataTableColumn.card: "title" | "sentence" | "meta" | "none"`. So the record card is an EXTENSION
  of that marker and that file, not a second card.
- **`DataTableCards.vue` has two branches** — the three-fact card (marked tables) and the full card
  (unmarked). They are two templates of one idea and already drifted once (the full card swallowed
  `row-click` until 2026-11-02). One anatomy with two ways of deriving it replaces both.
- **jsdom has no `matchMedia`**, so every page test in the repo renders the CARD view. A card that
  removes text from the DOM changes what those tests see; the details below stay in the DOM.
- **Tables do not get crushed at laptop width** — they scroll sideways inside their own box, by
  design (`ColumnWidth` rounds up). The picture's caption "the table/card switch follows the list's
  width" is therefore WITHDRAWN: the switch stays where it is (below `md`, or under the touch floor).
  Only the two-up card grid follows the list's own width.
- **The dashboard is a catalogue** (`DASHBOARD_WIDGETS`, per-widget gate, per-user arrangement,
  D-DT5 "a narrower screen collapses SPANS, never restyles a widget", D-FM4/D-FM8/D-FM9). Direction
  C must be expressed as catalogue entries and spans, not as a hand-laid page.
- **FLEET-MANAGER-HOME-PLAN §4 card 2:** "a row whose answer is zero still renders — seeing that
  nothing is late is the point of looking." The Operations picture folds zero rows into "✓ 4 clear".
  That is a recorded ruling against an approved picture: Q-SM1.

## 4. Decisions

- **D-SM1: one card anatomy, drawn by `DataTableCards.vue`.** Top line: identifier, then the row's
  one date or amount (`meta`), its status, its controls, its menu. Under it: the sentence(s). Under
  that: up to three FIGURES in a fixed three-column grid, label over value. Last: a "More details"
  disclosure holding the rest as label/value pairs with a FIXED label column. The three-fact card is
  this anatomy with no figures and no details, so the shop's 25 files render as they do today.
- **D-SM2: the marker grows by three words** — `card: "title" | "sentence" | "meta" | "status" |
  "figure" | "detail" | "none"`. A marked table is drawn from its marks (an unmarked column of a
  marked table stays `none`, as §9 has it). At most three `figure` columns are drawn as figures; a
  fourth is drawn as a detail (pinned by "reads a page's own marks instead of its column order, and
  holds a fourth figure back"), so a page that marks too many loses nothing and breaks nothing.
- **D-SM3: an unmarked table is DERIVED, not left behind.** Title = the first labelled column;
  status = the `STATUS_KEYS` column; label-less columns are controls (F25); figures = the first three
  remaining columns in the page's own order; everything after is a detail. Column order is the only
  statement of importance a page has made, so it is the one read. This lifts all 100 unmarked files
  at once; the busiest are then marked by hand (phase A3), because "first three" is Odometer, Miles
  and Gallons on the Fuel log where the reader wants Amount, Gallons and MPG.
- **D-SM4: details are collapsed and stay in the DOM** (`hidden`, with `aria-expanded` on the
  button). Collapsed because twelve fields a row is M2. In the DOM because find-in-page, the page
  tests and a screen reader's virtual cursor all read it there, and the row count on a phone page is
  20. The disclosure stops its own click, as the menu and the checkbox do, so it never opens the row.
- **D-SM5: a card has an edge when nothing else is drawing one.** Inside a `DataWorkspace`, or as a
  table with its own card, the narrow view drops the outer surface and each row is an `AppCard` on
  the canvas, 8 px apart; everything else the page put in the workspace — the toolbar, a note, a stat
  strip, the bulk bar — is handed a surface by ONE rule (`.workspace-cards`, tokens' `epilogue.css`). A table that is
  `embedded` in somebody else's card (40 files: a drawer, a detail page's section, a widget) keeps
  flat divided rows — a card inside a card is the defect §5.2 already names. The workspace tells the
  toolbar through the record they already share (`workspaceTable.ts`).
- **D-SM6: cards go two-up when the LIST is at least 40rem wide** — a container query on the list,
  so it is true at 700 px of phone-landscape and on the bay tablet (touch floor, any width), and
  false in a 390 px phone or a narrow drawer.
- **D-SM7: the card view's sort control is one compact control on the toolbar's line of the list,
  not a bar.** Same options, same emit; 48 px under the touch floor.
- **D-SM8: below `md` the toolbar is the search and ONE "Filters" button.** The button opens a sheet
  holding the page's `#filters` and `#more` slots stacked full-width, with "Clear filters" and the
  count on its closing button. The button carries the active count. Above `md` nothing changes.
  (Phase A2; the sheet reuses `SlideOver`'s scrim, focus trap and Escape — to verify it can dock to
  the bottom before building, else Q-SM2.)
- **D-SM9: the dashboard grid collapses spans on its OWN width** — `TabWidgets`' grid becomes a
  container and `SPAN_CLASS` reads container breakpoints. D-DT5 stands as written (spans collapse,
  widgets are not restyled); only the ruler changes, from the window to the room the grid has.
  The same holds for KPI tile grids (M12).
- **D-SM10: a card header stacks before it squeezes.** `ChartCard` (and `CountList`'s host cards)
  put the header's control under the title when the card is under 22rem; a title never shares a line
  it does not fit on.
- **D-SM11: a chart has a floor and an honest empty state.** A plot is never under 18rem wide (the
  span collapses first, D-SM9); x ticks are capped by the plot's width; a series with no points
  draws one sentence in the plot's place, not axes. The accessible data table is clipped (M4).
- **D-SM12: Operations keeps every figure and every door (D-FM9) and gains an order.** A full-width
  strip of the board's four figures first; then a "Needs action" card listing the non-zero ALARM
  rows of every card the reader may see, largest first; then the area cards, packed by their own
  height instead of stretched. How zero rows are drawn waits on Q-SM1.

## 5. Open questions

- **Q-SM1 — zero rows on Operations.** FLEET-MANAGER-HOME-PLAN §4 rules that a zero row renders.
  (a) Keep every zero row, drawn quiet: one line, no caption, figure in the tertiary ink.
  (b) Fold a card's zero rows into one line that still names them ("✓ 4 clear: late risk, HOS low,
  no next load, uncovered"), one tap to expand — the picture. **Recommendation: (a)** until the
  owner rules otherwise in words; it is the written ruling, it is one line a row instead of three,
  and it loses nothing. Blocks phase C only.
- **Q-SM2 — the Filters sheet's host.** If `SlideOver` cannot dock to the bottom without a variant,
  either (a) add a `side="bottom"` variant to it, or (b) open it as the existing right-hand drawer,
  which on a phone is already full-width. **Recommendation: (b)** if (a) costs a second focus-trap
  path; decide on reading `SlideOver.vue` at A2.
- **Q-SM3 — "Needs action" across features.** D-FM8 keeps each Operations card in the feature that
  owns its data, and `lint:boundaries` refuses a dashboard file importing them. The aggregate card
  needs each card's rows, so each feature exports its rows as a composable and the registry in
  `lib/` (which may import features) composes them. To verify against `check-feature-boundaries`
  at C1; if `lib/` may not, this is a blocker to bring back, not to route around.

- **Q-SM4 — four verbs in a page header on a phone.** Drivers carries Audit binders, Reconcile with
  Samsara, Upload scanned files and New driver; at 390 px they take two lines. (a) Leave them: two
  lines of whole, unwrapped buttons is legible. (b) Keep the primary verb and fold the rest into one
  "More" menu below `md`, drawn by `PageHeader` for every page. **Recommendation: (b)**, as its own
  small PR after B — it touches every page's header and deserves its own browser pass.

## 6. Phases

Each phase is one PR to `main`, lands on staging on merge, and ends with a browser pass at 390,
700/768, 1024 and 1440 on the three fixtures (failed, empty, real staging data).

| Phase | What | Files |
|---|---|---|
| **A1** | The record card: D-SM1…D-SM7. Contract §5.2 + §9 rule 3 rewritten to the one anatomy; `check-phone-rules` and `ui-system-inventory` learn the three new marks and the three-figure limit | `packages/ui`: `DataTableCards.vue`, `DataTable.vue`, `DataWorkspace.vue`, `FilterBar.vue`, `lists/workspaceTable.ts`, their tests; `scripts/check-phone-rules.mjs`; the contract |
| **A2** | The phone toolbar: D-SM8, and M10's tab strip | `FilterBar.vue`, `AppTabs.vue`, `PageHeader` actions if M8 shows there |
| **A3** | Marks by hand on the busiest office lists: Drivers, Vehicles, Trailers, Fuel log (fills, declines), Transactions, Fuel cards, Loads, Idling, Recruitment — each chosen with the page's own columns open, three figures a reader compares | the pages' column arrays only |
| **B** | Dashboard cards and charts: D-SM9…D-SM11, M9 | `TabWidgets.vue`, `ChartCard.vue`, `BaseChart.vue` + the chart option builder, `EfficiencyWidget`, `FuelWidget`, `ConcentrationWidget`, `StatCard` grids named in M12 |
| **C** | Operations: D-SM12 after Q-SM1 and Q-SM3 | `packages/shared` catalogue, `lib/dashboardWidgets.ts`, `CountList.vue`, the ten `ops.*` widgets |

## 7. Not in scope

The driver app (React Native). The applicant's page (`/apply`, its own layout and its own bar).
Table layout at desk widths. New data on any card.

## 8. Progress log

- **2026-11-14** — audit, pictures, owner's go. Plan written from the components as they are on
  `main` at `0461c1f`; three captions of the pictures corrected in §3. A1 started on
  `claude/record-card-small-screens`.
- **2026-11-14, A1 built** (branch `claude/record-card-small-screens`) with the first four lists of
  A3 in it — Drivers, Vehicles, Trailers, Fuel log — because the derived card alone opened Vehicles
  on "File / Notes / Vehicle". Remaining A3 lists: Transactions, Fuel cards, Loads, Recruitment.
  Idling's three tables are left derived on purpose: their columns are already in the order a reader
  compares them.
  - Seen in a browser, not only tested: the working tree built with staging's two public build
    variables and served to Chromium over staging's own API (the staging admin test member), at
    390 / 700 / 1024. Three things only the browser showed, all fixed here:
    1. the Fuel log's stat strip sits in the workspace and lost its surface with it — hence ONE
       rule for everything in a workspace (`.workspace-cards`) instead of teaching each component;
    2. beside a checkbox and a row menu the figure grid lost a quarter of the card and clipped a
       "Not recorded" badge — figures and details now run the card's full width;
    3. "Medical expires" does not fit a third of 390 px — labels fill one grid row and values the
       next, so a two-line label cannot push its value below its neighbours'.
  - Withdrawn from D-SM2: the gate refusing a fourth figure. The component draws it as a detail
    and a test pins that, so nothing is lost by marking too many.
  - Mutants, each caught by the new tests: four figures instead of three; boxing a table embedded
    in another card; details never hidden.
  - Not changed, measured: the table at 1024 px (Vehicles) renders as before.
  - Left as it reads, noted: a context line whose parts are blank prints "— · —" (a parked driver
    with no truck and no position). The dashes are the page's own cells; whether a blank part
    should drop out is a wording decision for A3's remaining lists, not a layout one.
- **2026-11-14, A2 built** (branch `claude/phone-filter-sheet`, stacked on A1).
  - **Q-SM2 answered, by the import direction:** neither candidate. `SlideOver` lives in `apps/web`
    and `FilterBar` in `@silvicom/ui`, which cannot import an app. The sheet is the bar's own filter
    group, docked to the bottom by `max-md:` classes.
  - **Decided in CSS, not in script, and that is load-bearing.** jsdom has no `matchMedia`, so a
    script branch would have handed every page test the phone toolbar — its filters inside a closed
    sheet. The filters stay in ONE place in the document at every width; closed, the bar's DOM is
    the desk's plus one button. `#more` joins the sheet only while it is open, because the desk
    popover is that slot's other home.
  - `provideFilterStack` / `useFilterStack` (`lists/filterStack.ts`): the bar says "stacked" once and
    `FilterSelect` and `DateRangeFilter` fill the line — 140 controls in 54 pages' slots, none of
    which had to change.
  - M10: a tab strip fades the edge it continues past (`AppTabs`), and only that edge.
  - Seen in a browser at 390 px on Drivers, Fuel log, Fuel costs and Idling (closed and open). The
    Ask AI launcher sits under the sheet's scrim while it is open.
  - Not done here: `PageHeader`'s action buttons still wrap to two lines on Drivers at 390 px (four
    buttons). That is a page with four header verbs, which contract §9 rule 2 answers for the shop
    with a bottom bar; whether the office pages take the same rule is a product question — Q-SM4.
- **2026-11-14, B built** (branch `claude/dashboard-cards-own-width`, stacked on A2).
  - D-SM9: `TabWidgets`' grid is a container; spans collapse at 42rem and 64rem of GRID. Measured
    after, on staging's data: at a 1024 px window (690 px of grid) Fuel spend is the full row and
    Fleet MPG and Needs attention are two halves of 328 px — they were 210 and 150; at 1440 the
    catalogue's 5 / 4 / 3 is back. No test pinned the old `md:` / `lg:` strings.
  - D-SM10: `ChartCard`'s header stacks its control under the title below 24rem of card (the plan
    said 22; 24 is Tailwind's `@sm`, and no card sits between the two).
  - D-SM11: Fleet MPG says "No week in these dates has enough measured distance for an MPG." in the
    plot's place, only once the read has answered (mutant caught: dropping that condition); x ticks
    keep 16 px between them. The chart's floor is met by D-SM9 rather than by a minimum of its own:
    the narrowest a chart card now gets is 308 px.
  - M4: the two charts' accessible tables are clipped by an `sr-only` WRAPPER — a table ignores the
    class's 1 px box. Fleet overview at 390 px: document 390 px wide, was 541.
  - M12: Idling's four tiles pair up until their row has 72rem. The contract's tile grid
    (`sm:grid-cols-2 xl:grid-cols-4`) has the same window-not-room arithmetic; Idling was the one
    page measured breaking a figure, so it is the one changed, and the contract's line stays until
    a second page shows the fault.
  - M9, not changed, on purpose: the Ask AI launcher floats, and `--assistant-clearance` already
    keeps it off a page's LAST control. Over the middle of a page it will always be over something;
    moving it is the assistant's own plan, not this one.
  - Checked and not a fault: the Fuel-spend plot's canvas is exactly its parent's width at 390, 1024
    and 1440 (318 / 648 / 406 px), 20 px inside the card.
- **2026-11-14, C1 built** (branch `claude/operations-quiet-rows`, stacked on B) — the three parts of
  D-SM12 that need nothing from another feature.
  - **Q-SM1 built as (a)**, the written ruling: a zero row still renders, on one line, figure in the
    tertiary ink, its door kept as the arrow (`CountList`). The folded "✓ 4 clear" of the picture is
    NOT built. A rate of nothing (value 0, printed "—") is an unknown and keeps its sentence.
  - **Packing** (`features/dashboard/packing.ts`): a tab whose cards all take one span flows down
    columns, each card as tall as its content. Decided from the spans, so Fleet overview is untouched.
  - **Truck paperwork** is one 4 × 2 grid, its row names derived from `VEHICLE_CHECK_LABELS`
    (`truckPapersGrid.ts`); each of the eight figures is still its own door.
  - Measured on staging's data: Operations is 1,399 px tall at 1440 (was 2,219) and 3,619 at
    390 (was 4,454). The paperwork grid is the shared `DataTable`, embedded — `lint:ui-adoption`
    refuses a hand-written table — so on a phone it is four flat card rows. The picture's "about 1,150 px on a phone" assumed folded zeros.
  - **C2, not built: the fleet strip and the "Needs action" card.** Q-SM3 is half answered —
    `lib/dashboardWidgets.ts` already imports every feature's widget, so `lib/` may compose them —
    but each of the ten cards computes its rows inside its own `.vue`. C2 first moves each card's
    rows into a composable beside it (ten small moves, no behaviour change), then adds one catalogue
    entry that reads them. Its own PR, with its own gate (`ops.needs-action` must respect each
    source card's section gate, D-FM4).
