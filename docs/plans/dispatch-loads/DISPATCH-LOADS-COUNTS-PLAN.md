# Dispatch board and Loads: what each tab counts, an empty History, how far Delivered reaches, and the order rows open in — audit and plan

**Status: RULED 2026-10-20 — building.** Owner: *"proceed as recommended"*, with two corrections (§11). Written after the owner's report of 2026-10-20 (§0),
on the owner's instruction to *audit, analyse and research first, then fix properly*. Decision IDs
`D-DLC*`, open questions `Q-DLC*`. Extends `DISPATCH-BOARD-V2-PLAN.md` (`D-DBV*`, the three tabs and
the Dispatcher select), `LOADS-ACTIVITY-PLAN.md` (`D-LA*`, the Delivered window) and
`../design-system/FLEET-MANAGER-HOME-PLAN.md` (`D-FM7`, the Operations cards that open the board's
queues). It restates none of them.

---

## 0. The request

The owner, 2026-10-20, after the last round of updates:

1. *"Tab badge numbers are wrong or illogical."* Dispatch board → **Needs a load says 192 trucks**, and
   *"we are 100% sure we don't have 192 trucks that need a load."*
2. *"The History tab is completely empty"*, and it opens on a preset date range.
3. Loads → Delivered shows one to two weeks. Keep **at least six months** of delivery history, or make
   the range explicit and precise.
4. *"Default sorting is wrong and off-standard."* Loads must sort **latest → oldest in every table**.
5. Several tabs and numbers duplicate the same data and give no useful information. Audit them.

## 1. Audit — the Dispatch board's tabs

Measured 2026-10-20 ~19:00Z by running the board's own reader (`readBoardRows`) against production:
216 rows, 205 once the parked pool (fleet `'1'`) is left out as the page leaves it out, 14 uncovered loads.

| Tab or queue | Rule (`dispatchBoardView.ts`, `boardFlags`) | Rows | Made of | Overlaps |
|---|---|---|---|---|
| All trucks | every row | 205 | | |
| **Needs a load** | `!inShop && (emptyNow \|\| noNextLoad)` | **196** | 100 empty ∪ 96 hauling with nothing booked | = Empty now ∪ No next load, both hidden queues |
| Needs attention | `lateRisk \|\| hosLow \|\| noGps \|\| warningUrgent` | **123** | 41 late or at risk, 5 HOS low, 63 no GPS, 27 urgent warning | |
| Empty now (hidden, Operations card "Find a load") | no current load | 100 | 58 with a driver, **42 with no driver and no GPS fix ever** | ⊂ Needs a load |
| No next load (hidden, card "Plan") | hauling, nothing booked after | 96 | of 105 hauling; 66 free within 24 h, 48 within 12 h, 7 already at the last stop | ⊂ Needs a load |
| Late risk / HOS low / No GPS (hidden, cards) | one flag each | 41 / 5 / 63 | No GPS = the 42 never-fixed trucks + 19 stale empties + 2 loaded | ⊂ Needs attention |
| History | `driver_equipment_timeline` | **0 rows, ever** | built from driver-app duty sessions: 0 sessions ever | |

**What the numbers say.**

- **"Needs a load" is the fleet.** The flag `noNextLoad` is true for 96 of the 105 trucks hauling right
  now, because almost no truck has its next load booked while it is still on this one (the plan's §2 of
  10-15 measured the same: 31 of 163 working trucks had one). So the union says 196 of 205. The
  arithmetic is right; the definition is not what a dispatcher means by "needs a load". DBV2 built the
  tab as the union of two queues the dispatchers had found confusing as seven tabs; it inherited both.
- **42 of the 100 "empty" trucks have no driver and have never reported a position.** They are parked
  or unassigned. They are not waiting for a load, and they are also 42 of the 63 "No GPS" rows that put
  the fleet on Needs attention. The honest empties are the other 58, and **39 of those have nothing
  booked** — that is the list a dispatcher would call "needs a load now".
- **Needs attention at 123 of 205 is as illogical as 196.** Three fifths of the fleet cannot "need
  attention" every morning. Taking the 42 parked trucks out leaves 81; the rest is real (41 late or at
  risk, 27 urgent warnings).
- **History can never show anything.** Nobody uses the driver app's in-app shift (`driver_duty_sessions`
  = 0 rows since the table was created), so the timeline that tab reads is empty by construction, not
  by date range. Widening the range does nothing.

## 2. Audit — the Loads page's tabs

Production SQL, 2026-10-20. The page reads open loads whole and delivered or canceled ones inside the
Delivered window (D-LA6), so every count below is under the default 7-day window.

| Tab | Rule (`loadBoardState`) | Rows | Note |
|---|---|---|---|
| In transit | McLeod `P` with a stop behind it | 103 | 57 have the last appointment already passed and no arrival keyed: McLeod's appointment is a window start, not an ETA |
| Upcoming | `A`/`P` with truck and driver, nothing started | 30 | |
| Uncovered | `A` missing a truck or a driver | 14 | the board's link says the same 14 |
| Delivered | `D`, last drop departed inside the window | ~280 | 10/14–10/20; weekdays 25–80 a day, weekends 5–8 |
| All | everything above plus canceled in the window | ≈430 | its badge is a sum of the others and changes with the window |
| Exceptions | driver-app events `declined` / `equipment_mismatch` / `amended`, plus timed-out shifts | **0, ever** | `load_events` holds only `created` 961 · `started` 469 · `completed` 794 · `canceled` 26 · `load_changed` 12; the driver app is not used for loads |
| Activity (view) | days without a load, per driver and truck | 172 drivers | a ranking, not a loads table |

**Delivered history.** 791 delivered loads. The mirror began 09/17/2026 (first delivery it holds:
09/14, a load already under way). The delivered time is the last drop's McLeod departure, filled on
791 of 791 (D-LA1); 2 are keyed in the future (D-LA4 marks them). At ~175 a week, six months is
about **4,500 loads with ~10,000 stops**.

**Where six months lives.** The handoff said older loads exist only in McLeod's `_hist` tables. That is
true of fuel and settlements and **false of movements**: the finance sweep (`MOVEMENT_FACTS`,
`tools/mcleod-agent/queries.mjs`) reads closed June trips out of live `dbo.movement` by settlement
window, and `movement` holds 296,242 rows back to 2015 (`mcleod-data-model-traps`). So six months of
delivered loads are readable from the tables the connector already has SELECT on. What the connector
**does not do** is read them: its board query is `m.status IN ('P','A')` (`BOARD_WHERE`), and a load
becomes `D` in core only through the close read of ids it once held open (LR5). A `D` movement the
connector never saw as `P` or `A` is never read. A backfill is therefore a **new query on the VM**
(status `D`, last stop departed inside a window), which Alex reviews before the VM runs it, and a
redeploy of the connector (stop → expand → copy → start, the 10-10 fleet-code package is the pattern).

## 3. Audit — the order each table opens in

`docs/DESIGN-SYSTEM-CONTRACT.md` §5.3 says how a sort is held (URL, `useUrlSort`, `sortRows`, nulls
last) and **nothing about which order a table opens in**. Each page chose its own:

| Table | Opens in | Is that the row's own time, newest first? |
|---|---|---|
| Dispatch board | Available, soonest first (D-DBV1, the dispatchers' own board) | No, and on purpose: the board plans forward |
| Loads → In transit, Upcoming, Uncovered, All | **no sort key**: the server's order, `loads.created_at` desc — when the mirror first saw the load. Identical for the hundreds swept on 09/17, so arbitrary among them; thereafter roughly McLeod order | No |
| Loads → Delivered | delivered, newest first (#1652) | Yes |
| Loads → Exceptions | `occurred_at` desc | Yes |
| Board → History | `from_at` desc | Yes (of nothing) |
| Loads → Activity | longest without a load first | A ranking; not a loads table |
| Load detail → timeline | `occurred_at` desc | Yes |

The owner's rule — *loads sort latest → oldest in every table* — is met by two of the five Loads tabs.
The other three sort by a column nobody can see.

## 4. Research — what "needs a load" means

The dispatchers' board (`board.silvicominc.com`, V2 plan §1) has no "needs a load" count at all: it
sorts every truck by **available date**, red when that date has passed. The TMW `AvailDate` / PTA
pattern that plan ranked first (`DISPATCH-BOARD-PLAN.md` §4) is the same: a truck "needs a load" when
it is free, or will be free before anything is booked for it. "Has no next load while hauling" is a
planning horizon, not a need.

Candidate definitions, with today's production count (pool excluded):

| | Definition | Trucks | Reads as |
|---|---|---|---|
| (a) | empty now, **a driver aboard**, nothing booked | **39** | needs a load now |
| (b) | (a) plus hauling, free within 24 h, nothing booked | 105 | needs a load by tomorrow |
| (c) | today's: empty, or hauling with nothing booked | 196 | the fleet |

(a) is what the words mean. (b) is (a) with the board's existing **Free** filter set to 24 h, so it
needs no tab of its own. The 42 empties with no driver are a different fact — *no driver* — and should
read as one in the Status column rather than inflate either tab. *Nothing booked* stays as it is
(`next == null`): 19 empty trucks have a next load and are not on the list.

## 5. Research — a real source for History

"Who was in this truck, when" has three honest sources and one dead one:

| Source | What it answers | Depth | Cost to read |
|---|---|---|---|
| Samsara `GET /fleet/driver-vehicle-assignments` | who was logged in to which vehicle, by HOS and the other assignment types | any `startTime`/`endTime`; no documented retention limit; paged; 5 req/s | already read on demand by inspection attribution (`attribute.ts`, D-IC7) and by the seat sync; no table |
| The loads mirror (`loads` + `load_stops`) | which driver and truck McLeod put on which load, with the stops' actual times, both seats (D-LA2) | since 09/17/2026 | one query; already in core |
| `driver_duty_sessions` → `driver_equipment_timeline` | in-app shifts | **0 rows ever** | the dead one |
| McLeod driver availability / home time | off-duty context | not granted to the connector (Q-LA1) | Alex |

Samsara's assignments are the attribution trail the evidence panels and the roadside-inspection
attribution already cite, so a History that reads them answers the tab's stated question — "the
attribution trail behind every evidence panel" — with the same source the evidence uses. The loads
mirror adds the load each segment was hauling. Neither needs a table: the read is a driver or a truck
and a date range, as the tab's filters already are, fetched when asked, like the driven path (DBV6).

## 6. Research — how far Delivered can reach

Three independent pieces, in order of what they cost:

- **(i) An explicit range, said on the page.** The picker exists (D-LA6). Give it presets (7 · 30 · 90
  days · custom), open on 30 days, and state the floor: *"Delivery history begins 09/17/2026."* No
  new read. The "two weeks" complaint goes away the same day.
- **(ii) The backfill (§2).** New connector query + Alex's review + VM redeploy, then a one-off run over
  six months. Core takes ~4,500 loads; `loads` is unique on `(org_id, ref)`, so re-reading a load the
  mirror already holds is a no-op. The connector's close read keeps working unchanged.
- **(iii) A server-paged Delivered list.** The page reads whole rows with their stops into the browser
  and pages client-side (D-US8). At 280 rows a week that is fine; at 4,500 it is several megabytes per
  open and a list past PostgREST's 1,000-row page three times over. Delivered needs the server to page
  (keyset on delivered time + id) and to apply Driver, Truck and Dispatcher there, as the Audit log and
  Billing do. Without (ii) it is not needed; with (ii) it is.

## 7. Decisions (proposed)

- **D-DLC1 — "Needs a load" is a truck that is empty, has a driver, and has nothing booked** (§4 (a)).
  `noNextLoad` stays a flag and a hidden queue, because the Operations card "hauling now, nothing
  booked after" is that number and it is a true one (D-FM7). It stops being part of the tab.
- **D-DLC2 — A truck with no driver is "No driver", not "Empty" and not "No GPS".** `boardFlags` gets
  the driver: `emptyNow` requires one; a truck with no driver and no fix is not on Needs attention for
  its GPS. The Status column says *No driver*. The Operations card "Empty · Find a load" counts the
  same rows as the tab, by the same function, as D-FM7 requires.
- **D-DLC3 — A tab that has never had a row is not shown.** Exceptions appears when its feed first
  returns one. The feed and its route stay (the driver app may yet be used, Q-DB9). Same rule as the
  Dispatch column (Q-DBV6).
- **D-DLC4 — Every loads table opens newest first by the row's own event time**, and the contract says
  so (§5.3 gains the sentence). Per tab the event time is: In transit → the first stop's actual
  departure; Upcoming and Uncovered → the first pickup's appointment; Delivered → delivered at (D-LA1);
  All → whichever of those the row has. Ties by load number. A header click still overrides. A test
  pins each tab's opening order, and `listLoads` keeps its server order only as the tiebreak.
- **D-DLC5 — History reads Samsara's assignments, on demand, no table.** Rows are assignment segments
  (driver, truck, from, to, source type) for the chosen driver or truck and range, with the load the
  truck was on at that time from the mirror. The dead reader of `driver_equipment_timeline` goes; the
  table stays (duty sessions own it, and 0151's RPC is kept for Q-DB10 option (a)). The range opens on
  the last 7 days as now — a Samsara read must be bounded — and the page says the source.
- **D-DLC6 — Delivered opens on 30 days with presets, and names its floor** (§6 (i)). The backfill and
  server paging are their own steps (§9), the first of which waits on Alex.
- **D-DLC7 — A badge is the rows its tab shows under the filters in force** (already true on both pages,
  kept). The Loads page's description names the window so "All 430" is read as "in this window".

## 8. Open questions — owner rulings

- **Q-DLC1 — "Needs a load": (a) 39 today, or (b) 105 with the 24-hour horizon?** *Recommend (a)*,
  with the Free filter giving (b) in one click. The tab must mean what its words mean.
- **Q-DLC2 — The 42 trucks with no driver and no fix.** (a) D-DLC2: they read *No driver*, off both
  tabs; (b) leave them in Empty now and No GPS. *Recommend (a).* A list that is two-fifths parked
  trucks trains people to ignore it. The owner may also want them checked against McLeod's
  `tractor_status` (`sold-trucks-are-tractor-status-i`): a truck that is sold should not be on the
  board at all — a roster question, recorded, not built here.
- **Q-DLC3 — The board's own order.** The owner's rule is *latest → oldest in every table*. The board
  is a table of trucks, not loads, and opens soonest-free first because that is the dispatchers' board's
  order (D-DBV1, Q-DBV5). *Recommend keeping it* and applying D-DLC4 to the loads tables only. If the
  owner means the board too, the sort key flips to Available descending in one constant.
- **Q-DLC4 — History: (a) rebuild on Samsara (D-DLC5, ~1.5 days), (b) remove the tab (half a day),
  (c) leave it.** *Recommend (a).* The question it asks is real and the source already serves the
  inspection attribution; (c) is a tab that lies by being empty.
- **Q-DLC5 — Six months of Delivered: (a) explicit range now (D-DLC6) and the backfill when Alex can
  review, or (b) wait for the backfill and change nothing until then?** *Recommend (a).* The backfill
  request goes to Alex as a package, the way the fleet-code SQL did (#1437).
- **Q-DLC6 — Server-paged Delivered (§6 (iii)).** Needed once the backfill lands. *Recommend building
  it in the same step as the backfill's reader*, not before: a server-paged list over 280 rows buys
  nothing and costs the Driver and Truck counts their client-side faceting.
- **Q-DLC7 — Upcoming's order.** D-DLC4 literally puts the farthest-out pickup first. A dispatcher
  planning tomorrow reads soonest first. *Recommend soonest first for Upcoming and Uncovered* (the
  only two tabs whose event is ahead of now) and newest first for the rest. Ruling either way is one
  line per tab.

## 9. Steps (one PR each; no migration anywhere)

| Step | What | Waits on |
|---|---|---|
| DLC1 | Board: D-DLC1, D-DLC2; the Status column's *No driver*; the Operations cards keep counting by the board's filter (D-FM7 test) | Q-DLC1, Q-DLC2 |
| DLC2 | Loads: D-DLC4 opening order per tab with its test and the contract sentence; D-DLC3 Exceptions shown only with rows; D-DLC6 presets, 30 days, the floor on the page; D-DLC7 the window in the description | Q-DLC3, Q-DLC5, Q-DLC7 |
| DLC3 | History on Samsara assignments (D-DLC5): `GET /api/dispatch/assignments/history` re-pointed, same filters and URL, the duty-session reader deleted | Q-DLC4 |
| DLC4 | Backfill package for Alex: `DISPATCH_LOADS_CLOSED` (status `D`, last stop departed in `[from, to)`), dry-run report, one-off run over six months | Alex |
| DLC5 | Server-paged Delivered with Driver, Truck and Dispatcher applied by the API (Q-DLC6) | DLC4 |

## 10. What this does NOT do

No writes to McLeod (D-LMR1). No new table. No change to which loads the board calls "current" or
"next" (`isLoadOnTruck`, `compareLoadsOnTruck`). No change to the Activity view's ranking.

## 11. Progress log

### 2026-10-20 — Written

Measured the board with its own reader and the Loads page with SQL (§1–§3), found that "Needs a load"
was the union of two hidden queues and that 42 of the empties have no driver, that History's source
has never held a row, that six months of movements sit in McLeod's live tables the connector does not
read, and that three of five Loads tabs open in the mirror's insertion order. Waiting on §8.

### 2026-10-20 — Rulings: as recommended, with two corrections

Owner: *"proceed as recommended."* Every §8 recommendation is a ruling, and two facts correct the plan:

- **The 42 trucks with no driver and no fix are ORDERED trucks, not yet delivered** (`vehicles.status =
  'ordered'`, 42 rows). They were on the board because it hid only `retired`. They are now left out
  with every status outside `IN_SERVICE_VEHICLE_STATUSES` (derived, as `lint:vehicle-status` asks).
  That empties Q-DLC2: D-DLC2's "No driver" row is not built, since no in-service empty lacks a fix
  for that reason; the Status column is unchanged.
- **"Needs a load" is retired, not redefined.** *"On the dispatch board we have a column for next
  loads and this is enough and correct; Needs a load is not correct and an unnecessary tab."* D-DLC1 is
  superseded: the board shows **All trucks** and **Needs attention**; `empty` and `no-next` stay hidden
  queues for the Operations cards (D-FM7). Q-DLC1 is closed by this.

Built the same day (DLC1 + DLC2 in one PR, web and API, no migration):
- Board: not-in-service trucks out; two tabs.
- Loads: each tab opens by its row's own event time (`loadListOrder.ts`, D-DLC4; Upcoming and
  Uncovered soonest first per Q-DLC7), pinned by `loadListOrder.test.ts`; the contract §5.3 states the
  rule. Exceptions is shown only once its feed has a row (D-DLC3). The Delivered window opens on 30
  days (D-DLC6); the page says the window and the mirror's first day, the server's `history_from`
  (D-DLC7). The columns and the sort accessor moved to `loadListColumns.ts` to keep the page under
  its 500-line budget.
- Not built here: DLC3 History on Samsara (next PR), DLC4 the backfill package for Alex, DLC5 server
  paging (after DLC4).

### 2026-10-20 — DLC3: History reads the seat sync's own table

- **The source is a table we already had.** §5 weighed a Samsara call per page. Building it found
  `driver_vehicle_assignments` (0051, roster's): the seat sync has upserted Samsara's
  driver↔vehicle assignments every five minutes since 2026-04-14 — 199,600 segments, 407 trucks,
  235 drivers, 1,347 a day. Six months deep, org-scoped, no Samsara call. D-DLC5 holds with that
  source: same facts, read from where they already are.
- **An open row is not always still held.** 44,799 rows have no `end_at`; 184 of them had been
  refreshed in the last two hours and 43,978 not for two days or more — a segment open when it last
  fell inside the sync's lookback keeps `end_at = null` for good. The reader tells them apart by
  `updated_at` (`STILL_HELD_WITHIN_MS`, 2 h): still held, or ended at a time Samsara no longer
  reports, last seen then. The window filter uses the last sighting as an open row's end, or every
  stale-open row since April would match every range.
- **The row.** Driver (name, or the Samsara id when the roster lacks them), Truck, the McLeod loads
  the truck was on while the segment ran, From, To (*Still held*, or *Not recorded* with the last
  sighting), Held for. No trailer and no seat: the source names neither. The Trailer filter went
  with them. Same URL keys, same keyset paging, same 7-day opening range.
- **Boundaries.** `loads -> roster` is a new edge; the history reader's grandfathered direct reads of
  `drivers` and `vehicles` are gone with it. `driver_equipment_timeline` keeps its one reader, the
  load detail's duty attribution (`duty.ts`), untouched.

### 2026-10-20 — DLC4: the backfill, packaged for Alex

- **What the connector gains.** `DISPATCH_LOADS_DELIVERED` / `DISPATCH_LOAD_STOPS_DELIVERED`
  (`queries.mjs`): the board's columns, `status = 'D'`, bounded by a window on a stop's
  `actual_departure` — never by status alone, which would read the 2215 sentinel and every D since
  2015. `fetchDeliveredLoads` requires the window, half-open, `YYYY-MM-DD`, like the finance sweep.
  `agent.mjs --loads-backfill --from= --to=` reads it and posts to the mirror in the board's batches;
  `--dry-run` prints coverage and posts nothing. Part 6 of `SILVICOM-READ-ROUTINE.sql`, regenerated.
- **What the API already does.** The mirror stores a movement it has never seen and projects it
  (LR4): a `D` with its stops' actual times becomes a delivered load, and the Delivered window
  (D-LA6) and Activity (D-LA7) read it as if the mirror had been running. `unique (org_id, ref)`
  makes an overlap with live history a no-op rewrite, so a slice may be re-run.
- **What waits on Alex.** The two statements are new SQL on the VM: `review/REQUEST-TO-ALEX-2026-10-20-BACKFILL.md`
  asks for the review and gives the four install steps and the one-off command, a month per slice,
  dry run first. Until the run, the Loads page says "Delivery history begins 09/17/2026" (D-DLC6).
- **DLC5 (server-paged Delivered)** waits on the run, per Q-DLC6.

### 2026-10-20 — DLC4 revised: run from the analytics copy, nothing on the VM

The owner had the package reviewed (Codex) and then ruled: read the six months from `lme_analytics`,
the isolated copy, and install nothing on the Board VM. Measured the same day before building:

| what | measured |
|---|---|
| `lme_analytics` restore date | 2026-10-09 13:13 — the day the VM's mirror went live, so the copy holds the whole gap |
| one month of `D` movements on the copy | ~3,100 movements, ~6,500 stops, 4.2–6.1 s through the connector's guards (one core) |
| one week on live `lme` (10/12–10/19) | 806 movements in 1.7 s: 417 loaded, **every one already in the mirror**; 385 empty legs, none |
| production's ingest limiter | 300 posts / 15 min on `/api/tms`; a month is four posts of 500 |

- **D-DLC8 — empty legs are not deliveries.** Part 6 gains `m.loaded = 'L'`. An empty leg (`E`, the
  deadhead to the next pickup) carries the SAME order as its loaded leg, and the projection makes a
  load of either, so the first draft would have added ~8,700 phantom deliveries and shown every order
  twice. The open board keeps reading every leg McLeod has open (it has caught eleven in six weeks).
- **D-DLC9 — a first sighting already closed is dated by McLeod's last departure.** The mirror stamped
  `closed_at` with the sync time; for the backfill that would have dated April on the day of the run
  and kept 8,700 rows inside the relink pass's 60-day window (D-LA3: read on every mirror post, in
  chunks of 50 — ~180 extra reads a minute for two months). `firstSightingCloseAt` in
  `dispatchMovementIngest.ts`: the latest stop departure not after the sync, else the sync; the close
  read's stamp for a movement the mirror already held is unchanged.
- **D-DLC10 — "Delivery history begins" is the earliest delivery held, not the earliest row.**
  `loadsHistoryFrom` reads the earliest delivery-stop departure and falls back to the earliest
  `created_at`; a floor on `created_at` alone would have gone on saying 09/17/2026 over six months of
  older loads.
- **The package to Alex is withdrawn.** The letter is now a courtesy note (what is read, from where);
  the routine header says six parts (the word was typed by hand) and Part 6 names the copy, the
  slices and the measured volume. The two-week slice is the run's shape, not a limit: a month took six
  seconds at most against a 15-second ceiling.
- **Codex's four points, disposed.** (1) The backfill takes no service lock — true, and moot off the
  VM. (2) The zip was behind `main` — by the open-period read, which needs a grant, a route and 0502
  that are not released; shipping `main` would have broken the finance sweep, so behind was right.
  (3) No backup/SHA/tests in the steps — true; no install now. (4) The roster change would resend the
  roster — the VM already carries it since 10/14. The Node path note stands for any future VM step.
- **Run order.** This PR releases to production first (the two API rules must hold before the first
  real post), then from the owner's machine against the copy: `--dry-run` per slice, then the real
  slices, April 1 → September 18, two weeks each. The real run writes to production and waits for the
  owner's go. DLC5 (server-paged Delivered, Q-DLC6) follows the run.
