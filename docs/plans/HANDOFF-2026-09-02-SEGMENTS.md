# Handoff — the remaining fuel + Samsara work, split into segments for parallel chats

**Read `HANDOFF-2026-09-02.md` first** for what shipped and the traps. This file is only the **split**:
which segments exist, what each owns, what they must not touch, and the order they have to run in.

**Why segments.** A fresh chat with a narrow brief outperforms a long one carrying everything. Each
segment below is sized to be one chat: a coherent goal, its own file territory, and a done-when that
does not depend on another chat finishing mid-flight.

---

## 0. The rules that make parallel chats safe

These are not style preferences. Every one of them was paid for on 2026-09-02.

### 0.1 ⚠ Migration numbers are the sharp edge

Two chats took `0290` on the same day. One had to close its PR and renumber. **Before writing a
migration:**

```
git fetch origin && git ls-tree --name-only origin/main supabase/migrations/ | tail -3
```

…and take the next number **only if you are about to commit within the hour**. If you are not, do the
non-migration part of your segment first. A claimed-but-unpushed number is not claimed.

~~**Highest at the time of writing: `0295`.**~~ **`0297` as of 2026-09-02** (`fuel_range_totals`
gaining `fills_with_vehicle`; `0296` was `org_role_surface_access`, the permissions chat). Segment D's
is spent — the two that remain are marked below, and **only one of them should be in flight at a
time.** Re-run the command above rather than trusting this line.

### 0.2 Files more than one segment will reach for

| File | Who else touches it | Rule |
|---|---|---|
| `supabase/schema.generated.sql` | every migration | regenerate + `git add` it, never hand-edit (`lint:table-writers` hides that check) |
| `scripts/table-writers.json`, `scripts/table-modules.json` | every new table/writer | append only your rows; conflicts here are trivial to resolve, do not rebase around them |
| `packages/shared/src/index.ts` | the permissions work | **do not add to it.** Export through a subpath barrel (`fuelSpend/index.ts`) as `rollupFreshness` and `feedFreshness` did |
| `apps/web/src/router/routes/fuel.ts` | segments B and D | only B and D touch it, and B lands first |
| `apps/web/src/lib/nav.ts` + its snapshot | segment B | B owns the Fuel group's shrink; nobody else edits it |
| `packages/shared/src/auth.ts`, `apps/web/src/pages/Settings*`, `router/routes/settings.ts` | **the permissions chat** | **out of bounds.** Read `SECTION_ACCESS`, never edit it |

### 0.3 Non-negotiable method (from `HANDOFF-2026-09-02.md` §8)

- Branch from `origin/main` **explicitly**; check `git branch --show-current` **and `pwd`** before every
  commit. (I built on an already-merged branch once today and had to move the work.)
- **Mutate the subject of every new test and confirm it fails.** Ten assertions passed proving nothing on
  2026-09-02; the cause is always a fixture too uniform to discriminate. If a mutation does not fail the
  test, the test is the problem — fix the fixture, or delete the assertion and say why.
- Hold a reader PR until its column **or function** exists in production (`information_schema.columns`,
  `pg_proc`). `lint:migration-ordering` does not see functions.
- `pnpm --filter @silvicom/shared build:rn` after pulling — a stale `dist` produces typecheck errors in
  files you never touched.
- Mark the step **DONE** in its plan with "What shipped" and "Verified by:" naming real test titles.

---

## 1. ⚠ One sequencing finding that changes the plan's order

**Do C2 before P1.** The plan lists Phase P before Phase C and does not order them against each other.
But **P1 adds multi-select to Fuel Log, Transactions and Rejections — and C2 merges those three pages
into one.** Doing P first means building the same control three times and then deleting two of them.

So: **Segment B (consolidation) runs before Segment C (parity)**, and P1 is then one control on one page.

---

## 2. The segments

### Segment A — finish the Samsara collector · **S5, S6**

**Independent of every fuel segment. Start it any time, in parallel with anything.**

| | |
|---|---|
| **Steps** | SAM-S5 (freshness as a number with a threshold), SAM-S6 (retrain, re-score, measure) |
| **Owns** | `apps/api/src/modules/samsara/**`, `apps/api/src/modules/org/notifications` path, the Dashboard coverage tile, Settings → Data & sync |
| **Migration?** | **Probably not** — S5 reads the `jobs` ledger and `samsara_feed_cursors` (0288). Confirm before assuming. |
| **Blocked by** | Q-SAM1 for the *targets* only. **Ship the mechanism with provisional numbers and no alert firing on a guess** — that is the plan's own fallback. S6 wants the backlog drained first (Q-SAM6). |
| **Done when** | "Is our data fresh?" is answerable by looking; a stalled feed pages somebody. S6's before/after is **written into the plan**, and is allowed to conclude the backfill did not help. |

**Start here:** `SAMSARA-COLLECTION-PLAN.md` §5 S5. The patterns to copy are already in the tree —
`readSamsaraWebhookStatus` (all-time denominator), the **Telematics history** card (#454), and
`describeFeedFreshness` (#481), which is the same shape S5 needs per feed.

⚠ **D-SAM7 is part of S5:** the Dashboard's "Telematics coverage" tile computes over the *selected
window* and reads ~95% while 76.8% of history had nothing. It gains an all-time denominator beside the
windowed one. That tile is the last surviving instance of the bug #454 fixed elsewhere.

---

### Segment B — the fuel section stops being organised by where data came from · **C2 → C3 → C4 → C5**

**The biggest segment, and strictly sequential. One chat, four PRs.**

**✅ C2, C3 AND C4 ARE DONE** — C2 2026-09-02 (`claude/fuel-log-tabs`), C3 2026-09-03
(`claude/fuel-filters-in-url`), C4 2026-09-03 (`claude/fuel-retire-import`). **C5 is the last one,
and it MUST land before C6** so the three policy tabs are removed by the step that replaces them.

**C4 in one line:** `/import` is a redirect, `ImportPage.vue` is deleted, and its three capabilities
are drawers — EFS backfill on the Fuel Log, prices and locations on Truck Stops, Repair fuel data on
Settings → Data & sync. Fuel is five nav items. Three things it learnt:

1. ⚠ **C2's permission finding arrived a second time.** `/import` was `manage("fuel")` and its EFS
   half now opens from a page catalogued `always`, so the button and the drawer are both behind
   `can("fuel")` — MANAGE, not view, because it writes. Every relocation in C5 should be checked the
   same way; **C5 itself does not have the shape** (Fuel Spend is one page behind one gate), but the
   habit is what matters.
2. **A gate on a moved capability is DERIVED, not chosen.** Truck Stops takes `can("dispatch")`
   because `/api/fueling/prices`' `requireRole("admin","fleet_manager","dispatcher")` EQUALS
   `dispatch: manage` in the shipped matrix. Repair keeps `can("fuel")` rather than inheriting Data &
   sync's `manage("settings")` — the same two roles today, separately overridable per org tomorrow.
3. **A retired page leaves nothing behind to notice**, so the "no capability is lost" done-when is
   asserted as three findings, one per new home. If any had simply not been reconnected, every test
   in the repo would still have passed.

**⚠ Two test-harness notes for C5, which also mounts pages with drawers:** Headless UI's `Dialog`
needs a `ResizeObserver` stub in jsdom (`BaseModal.test.ts` has the one to copy) or the assertions
pass and the RUN fails on unhandled rejections; and a page that instantiates a drawer holding a
vue-query mutation needs `VueQueryPlugin` in `global.plugins`.

**C3's note, unchanged:**

**C3 in one line:** every filter on Fuel Log, Cards and Alerts is a URL parameter now, `?vehicle=` on
Alerts is written as well as read, and `useQueryState` gained `param(key, allowed?)` with
`@/composables/useUrlSort` beside it. Three things it learnt:

1. ⚠ **A `ref` could only hold what its dropdown offered; a parameter holds whatever somebody typed.**
   Every facet that moves into the URL needs a vocabulary, and a SORT KEY is the one that does not
   fail safe — it is a column name reaching PostgREST's `.order()`, so another table's column is a
   query that errors rather than a filter that matches nothing.
2. **An absent parameter can already mean two things.** On Alerts, no `status` means the work queue —
   unless the URL names a truck, in which case it means that truck's whole history. So "the reader
   chose All" needed its own spelling (`status=all`). Look for this before moving any defaulted filter
   into a URL.
3. **Two assertions in the new suites were VACUOUS and the mutation pass is what found them** — one
   passed either way because the page tolerates junk regardless (now asserted on the CHIP), one
   because the fixture's two sort orders were identical (the fixture now differs by a row).

**C2's note, unchanged:**

**✅ C2 IS DONE, 2026-09-02 (`claude/fuel-log-tabs`).** Fuel Log is `?tab=fills|declines|source`,
`FuelLogPage.vue` is a 143-line shell over three extracted tab components, `/transactions` and
`/rejections` are function redirects that carry the query **and** name the tab, and Fuel is six nav
items. C3 is next and starts from a page whose window, truck and tab are already in the URL.

**Three things C2 learnt that the next three steps inherit:**

1. ⚠ **The merge crossed a permission boundary and the plan did not say so.** `/fuel-log` is catalogued
   `always`; `/transactions` and `/rejections` were `section("fuel")`. `recruiter` and `technician`
   carry `fuel: "none"` and both reach `/fuel-log`, so absorbing the two pages without a check would
   have handed a fraud signal to a recruiter. The two absorbed tabs are gated on `canView("fuel")`.
   **C4 has the same shape**: `/import` is `manage("fuel")` and becomes a drawer on this `always` page,
   so the drawer needs the manage check the route was carrying. **C5 does not** — Fuel Spend is one
   page whose tabs all sit behind one gate.
2. **`lint:boundaries` bites when a page body moves into `features/`.** A tab under `features/fuel/`
   may not import `features/reports/` or `features/fueling/`, and the gate's own comment says promote,
   never allow-list. `useEfsData.ts` + its test moved to `features/fuel/`, `useCardAssignments.ts` to
   `@/composables/`, and `check-table-access.mjs`'s two grandfathered entries were repathed. **C4 moves
   `PriceUploadCard` and `StationDataCard` — both `features/fueling/` — onto Truck Stops, so check the
   destination's feature before assuming the move is free.**
3. **`useQueryState` buffers per instance, so the URL owner is called ONCE and passed down.**
   `useFuelLogFilters()` lives in the shell; the tabs take it as a prop and write through named setters
   (`setFrom`/`setUnit`), because `vue/no-mutating-props` refuses `props.shared.unit.value = x` — an
   ESLint error, not a warning, and it is the first thing that will bite C3.

~~**And one thing C2 deliberately left for C3**~~ — **done.** C3 gave each tab its own facets in the
URL and made the tab change CLEAR them, derived by exclusion from `SHARED_FUEL_LOG_KEYS` rather than
from a per-tab list of keys. Neither a namespace nor three names was needed: nothing crosses, so
nothing can collide.

| | |
|---|---|
| **Steps** | ~~C2~~ **DONE**, ~~C3~~ **DONE**, ~~C4 (retire `/import`)~~ **DONE**, C5 (Fuel Spend, eight tabs to three) |
| **Owns** | `apps/web/src/pages/{FuelLogPage,TransactionsPage,RejectionsPage,FuelCardsPage,ImportPage}.vue`, `apps/web/src/features/fuel/**`, `router/routes/fuel.ts`, `lib/nav.ts` + snapshots |
| **Migration?** | **No.** Entirely web. |
| **Blocked by** | Nothing. C1 and T1 are done. |
| **Done when** | ~~Fuel is five nav items; `/transactions`, `/rejections` and `/import` are query-preserving redirects~~ **all true as of C4**; Fuel Spend has three tabs (C5, the only one left). |

**Order is forced:** C3 needs C2 (do it once, on the merged page); C4 needs C2; C5 needs C4 and **must
land before C6** so the policy tabs are removed by the step that replaces them.

⚠ ~~**The three pages C2 merges have no tests today**~~ — they do now: `pages/FuelLogTabs.test.ts`
mounts all three tabs. Both predicted traps fired, plus a **third** worth adding to the list for any
future page-mount suite: `DataTable` renders its EMPTY STATE instead of the table when the fixture has
zero rows, so a column assertion against `rows: []` passes by finding no headers at all. Give every
list fixture at least one row. (The other two: `DataTable` renders as **cards** under jsdom — stub
`useMediaQuery` — and a spy inside a hoisted `vi.mock` factory must be `vi.hoisted`.)

⚠ **C5 keeps the three policy tab bodies in the tree, unmounted**, until C6 files their findings. A
report deleted before its replacement exists is a capability gap, however brief.

---

### Segment C — parity across the merged section · **P1 → P2 → P3**

**Runs AFTER Segment B.** See §1.

| | |
|---|---|
| **Steps** | P1 (multi-select + data-derived facets), P2 (a scoped export on every list page), P3 (the ledger scopable by truck) |
| **Owns** | the merged Fuel Log tabs, `useEfsFacets`, `apps/api/src/modules/fuel-spend/routes/**` (export routes), `ReportExportButton` |
| **Migration?** | **No.** |
| **Blocked by** | Segment B landing. P2 needs T3 (done) and P1; P3 needs P2. ⚠ **P1 starts from a page whose facets are already in the URL (C3), so multi-select is a change to `param` → a list, not a new home for the state.** |
| **Done when** | "Truck 654's fuel for August, as a file" is answerable from every list page, and `?trucks=` either scopes the ledger or is absent from its URL. |

⚠ **P2 has exactly one acceptable shape (D-FUI15):** `spend-report.pdf`'s. Server-rendered from the same
pure functions the screen uses, filters honoured, UUIDs validated before a service-role query, one audit
row per export, and the scope line printed on the artefact. **Do not invent a second export shape.**

⚠ **P1's facet fix is the point, not the multi-select.** The unit list is built from
`vehicles.unit_number`; the four EFS units with no vehicle row are unfilterable while their rows still
appear. Derive the facet from `efs_transactions.unit` (D-FUI16).

---

### Segment D — finish T5 · **the attribution half**

**Small, self-contained, and the only fuel segment that needs a migration.**

**✅ SEGMENT D IS COMPLETE, 2026-09-02, in three PRs.** Transactions, Rejections and Cards
(`claude/fuel-row-coverage`), then migration `0297` alone (`claude/fuel-range-totals-attribution`),
then the Fuel Log's line one merge behind it (`claude/fuel-log-coverage-line`). **Only the Fuel Log
needed the migration** — see the correction below. Nothing here is left to do; the notes stay because
the correction and the deploy-window handling are the parts worth reading again.

| | |
|---|---|
| **Steps** | ~~"share attributed to a vehicle" on the fuel list pages~~ → **the Fuel Log's line only**: rows in window, share attributed, and the posted feed's last delivery |
| **Owns** | one migration, `apps/web/src/features/fuel/useFuelLog.ts`, `FuelLogPage.vue`'s header lines |
| **Migration?** | **YES — see §0.1.** `fuel_range_totals` (0289) returns `fills` but not "fills naming a truck". `create or replace` **cannot** change a `returns table` shape: it is `drop function` + `create` in one transaction (safe — an extra column is ignored by the old reader). |
| **Blocked by** | **Nothing — Q-FUI14 answered 2026-09-02: Cards DROPS the attribution fact.** It has no denominator there (a card is issued to a driver or truck as setup, not attributed per row), so Cards carries rows-in-window and last-feed-poll only. The remaining constraint is the migration protocol in §0.1. |
| **Done when** | No figure in the section reads as a claim about everything without saying what it covers. |

**⚠ THE MIGRATION NOTE ABOVE WAS RIGHT ABOUT ONE TABLE AND WRONG ABOUT TWO.** T5 says Transactions and
Rejections "key on a text `unit` rather than a `vehicle_id`, so both need a migration".
`declined_transactions` has carried `vehicle_id` since its scoring work — measured 2026-09-02, 2,749
declines carry one and they are exactly the 2,749 whose `unit` matches a vehicle — so Rejections
needed no schema change. Transactions has no vehicle column, but its attribution is a match against
the fleet's own unit numbers, which the page already holds for its Unit filter; a second SQL function
would have restated seven filters beside the seven the list applies, which is the drift
`fuelSpendReport.ts` carries a scar about. **`fuel_range_totals` is the only function that still needs
changing, and only the Fuel Log reads it.**

**Already done and not to be redone:** the rollup build-age line on Fuel Spend and the spend PDF (#479),
the EFS feed-freshness line on Transactions and Rejections (#481), and the attribution line on
Transactions, Rejections and Cards (`claude/fuel-row-coverage`). If Segment B has merged those two
pages by then, the `FeedFreshnessLine` and the `RowCoverageLine` move to the relevant tab — the first
takes a `feed` prop and the second a plain `coverage` object, for exactly that reason.

**Two measurements the Fuel Log half rests on, both taken 2026-09-02 in production, so neither has to
be re-derived:** every canonical fill is `source = 'fuel_card'` (14,868 of 14,868), so the posted
feed's freshness IS the Fuel Log's freshness and no manual-entry caveat is owed; and no fill is
unscored (0 of 14,868 with a null `case_level`), so the Flagged tile needs no scoring-backlog caveat
either — **despite 46 imports whose `efs_processing_runs` row has been stuck at `running` since
2026-08-09**, holding 3,055 fills that are all scored regardless. That stuck-run count is a real
operational oddity and belongs to nobody's segment yet; it is recorded here rather than acted on.

---

### Segment E — findings and the inbox · **C6 → C7 → C8 → C9**

**Blocked on rulings. Do not start without them.**

| | |
|---|---|
| **Steps** | C6 (policy detectors file findings), C7 (one Findings inbox), C8 (targets beside the policy), C9 (the Dashboard's fuel strip earns its links) |
| **Migration?** | **Likely, for C6/C8.** Coordinate per §0.1. |
| **Blocked by** | **Q-FUI3** (the unit of work for a policy finding) blocks C6. **Q-FUI11** (fix order for the three alert root causes) and **Q-FUI1** (where a fuel-card theft alert sits in the capability matrix) block C7. **SAM-S6 gates anything anomaly-related** — including C7 — because the current queue is measured at 2.9% precision. |
| **Prerequisite** | C5 must land first (Segment B). |

**C9 is the exception and can be done alone**: the Dashboard's fuel strip links to pages that no longer
exist after Segment B. ~~Whoever finishes B should check it.~~ **Checked twice, and it is settled.**
At C2 (2026-09-02) the only tile pointing at a retired path was "Declined attempts" → `/rejections`,
now `/fuel-log?tab=declines`; every other fuel tile already pointed at `/fuel-log`, `/coverage` or
`/reefer-coverage`. At C4 (2026-09-03) no Dashboard tile pointed at `/import` at all — the one in-app
link to it was `DiscountCaptureTab`'s "uploaded on Import", now pointing at Truck Stops.

---

## 3. Suggested running order

```
now, in parallel:   Segment A (Samsara)        Segment B (consolidation, 4 PRs)
then:                                          Segment C (parity, 3 PRs)
(done)              Segment D (T5) — COMPLETE 2026-09-02, three PRs, migration 0297
last:               Segment E — once Q-FUI3 / Q-FUI11 / Q-FUI1 are answered and S6 has measured
```

**A and B are the only two that should run at the same time.** They share no files. Adding a third
concurrent chat puts two of them in `apps/web/src/pages/` at once, which is where the merge pain is.

---

## 4. Owner actions still outstanding

Unchanged, and each one blocks something above.

1. **Upload `~/Downloads/db139445F.pdf`** through *Fuel Spend → Reconcile a file*. `fuel_statements`,
   `fuel_recon_runs` and `fuel_exceptions` are **still 0 rows** — the whole reason the Exceptions page
   reads as pointless, and a precondition for C6/C7 meaning anything.
2. **Fix the Samsara webhook** in the vendor console (the path the Data & sync card prints; subscribe to
   the fuel-drop alert, not the five `RouteStop*` events).
3. **Set `SAMSARA_WEBHOOK_SECRET`** in Railway. **SAM-S1 stays open until 2 and 3 are done.**

### Rulings, by what they unblock

| Question | Blocks | Fallback if unanswered |
|---|---|---|
| **Q-SAM6** — raise `SAMSARA_RECON_BATCH`? | S6's timing | stays 250; drains in ~43 h not ~11 |
| ~~**Cards' third fact**~~ | ~~Segment D~~ | **ANSWERED 2026-09-02 — dropped. Q-FUI14.** Segment D is unblocked. |
| **Q-FUI3** | C6 | C6 does not ship; policy views stay unmounted |
| **Q-FUI11**, **Q-FUI1** | C7 | C7 does not ship; two inboxes remain |
| **Q-SAM1** | S5's targets only | provisional numbers, no alert on a guess |
| **Q-FUI9** | nothing — `REBUILD_DAYS` policy | unchanged; the label now says how old the figures are |
| **Q-FUI10** | P2's owner-facing report | row-level CSV only |
| **Q-SAM2**, **Q-SAM3** | nothing | unsubscribe / leave alone |
