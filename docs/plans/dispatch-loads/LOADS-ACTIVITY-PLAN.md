# Loads activity: who has not hauled for days, and a Delivered list you can filter — plan

**Status: RULED 2026-10-19, building.** The owner said *"proceed as proposed and recommended"* to the
analysis in §1–§3. Decision IDs are `D-LA*` and open questions `Q-LA*`. This plan extends
`LOADS-MIRROR-PLAN.md` (`D-LMR*`, the McLeod projection) and `DISPATCH-BOARD-V2-PLAN.md` (`D-DBV*`, the
Loads page's filters) and restates neither.

---

## 0. The request

The owner, 2026-10-19: *"On our Loads page we need some better data filtering. For example we want to
keep track if some driver has not picked up or delivered any loads multiple days, also on Delivered
tab we need better filtering, per driver and truck."* They then asked for the data to be made precise
before anything was built on it.

## 1. What the page had (main at `cd6e841`)

- `DispatchLoadsPage.vue` reads **every** load the org has into the browser (`listLoads`, paged past
  PostgREST's 1,000), and each tab is a filter over that list.
- Delivered tab filters: Dispatcher/fleet, Type, Dispatched by and a free-text search. **No driver or
  truck filter.** "80" matches trucks 801, 806 and 809 and every load number containing 80. **No date
  range. No "delivered at".** Delivery shows and sorts by the *appointment*.
- Nothing anywhere counted how long a driver had gone without a load.

## 2. What the data says (production, measured 2026-10-19)

| Fact | Measured |
|---|---|
| Delivered loads with the last stop's McLeod departure (`load_stops.actual_departure_at`) | **762 of 762** |
| Delivered loads with the first stop's departure | 762 of 762, and 101 of 103 in transit |
| `loads.completed_at` on any McLeod load | **0 of 942**. The driver app writes it and McLeod never does |
| `loads.external_closed_at` minus the last departure | median **+24.7 h**, p95 **+21.8 days**, 73 rows *before* it |
| Mirror history starts | 09/17/2026 (older loads exist only in McLeod's `_hist`) |
| Team movements (`driver_codes` with 2 entries) | **28**. The projection kept only the first |
| Delivered loads with no `driver_id` whose McLeod code now matches an active driver | **17**. Resolved once at ingest and never again |
| Stops whose McLeod "actual" time is in the future | **16**. Keyed ahead in McLeod, e.g. 0136753 departs 10/21 = its appointment |
| Delivered movements that were empty moves (`loaded = false`) | **9** |
| `driver_time_off` rows (home time / PTO) | **0**. The table exists (0068) and nothing feeds it |

Days since each of the 172 active drivers' last actual pickup or delivery: <2 d **71**, 2–4 d **52**
(42 of them mid-haul), 4–7 d **24**, 7 d+ **15**, none since 09/17 **10**. The "none" list was led by
team second drivers (MHOUSTON, WILLKENO, MGARZA, LFEAGIN), two of them on HOS *driving* at that moment.

## 3. Decisions

- **D-LA1 — "Delivered at" is the McLeod departure from the last stop, read through one function.**
  `loadDeliveredAt` in `@silvicom/shared`: the last stop by `seq`, its McLeod `actual_departure_at`,
  else the driver app's `completed_at`. Never `loads.completed_at` (always null on a McLeod load) and
  never `external_closed_at` (billing closes it a day to three weeks later). The page, the API's date
  window and the activity read all call it.
- **D-LA2 — A team load names both drivers.** `loads.co_driver_id` (0493) holds McLeod's second
  `driver_codes` entry. One column, not a table: McLeod's measured maximum is two. The projection writes
  it on every sync, as it writes `driver_id`. The Loads list shows "+ second driver", the driver
  filter matches either seat, and activity credits both.
  *Not changed:* the Dispatch board, the live map and the driver app still follow `driver_id`. Each is
  a "who is in this truck" reader, and a team's lead driver answers it. A second seat on the board is
  its own ruling (Q-LA4).
- **D-LA3 — A link that resolves later is re-made.** After each `/dispatch-movements` batch, the sync
  re-projects every mirrored load whose stored driver, co-driver, truck or trailer differs from what its
  raw codes resolve to **now**. It only does this where a code now resolves, so a code the roster never
  carries (JFERGUSO) is not re-projected every ten minutes. The projection is the one that already
  exists ("the same function given every movement id re-projects the whole mirror"), so there is no
  second write path.
- **D-LA4 — A time keyed ahead in McLeod is shown as such, and is "now" for activity.** The Delivered
  list shows the recorded time with a *"Entered ahead in McLeod"* marker rather than hiding it. The
  activity read caps it at the moment of reading. A driver with a stop dated tomorrow has a load, and
  is not idle.
- **D-LA5 — Empty moves are not loads.** `loaded = false` movements stay on the Delivered list, marked
  *Empty move*. They do not count as a pickup or delivery for activity.
- **D-LA6 — The Delivered tab gets Driver, Truck and a date range, and the server bounds it.**
  - Driver and Truck are exact-match selects. Each entry carries its count of the rows shown, like the
    Dispatcher select (Q-DBV8), and Driver matches either seat.
  - "Delivered" is a date range on D-LA1's time, in the carrier's days (`dayRangeInstants`). It
    defaults to the trailing 7 days and is never written to the URL until moved, as Billing's is.
  - A "Delivered at" column, sorted by it newest first.
  - `GET /api/dispatch/loads` takes `delivered_from` / `delivered_before`: open queues are returned
    whole as before, and delivered loads only inside the window. The browser no longer holds every
    delivered load since 09/17, a list that grows by about 25 a day.
- **D-LA7 — Activity means days WITHOUT A LOAD, not days since the last stop.** 42 of the 52 drivers
  at "2–4 days since a stop" were mid-haul. Per active driver the read gives: the load on the truck now
  (`isLoadOnTruck`) and the planned next one; the last pickup and last delivery (D-LA1, D-LA4, D-LA5,
  both seats); current HOS; and **days without a load** (0 while a load is on the truck, else since
  the last delivery). If nothing has happened since the mirror began, it says *"none since <first
  mirrored delivery>"* rather than inventing a number. The same read is done per truck. The view filters
  on 2 / 3 / 5 / 7 days.
- **D-LA8 — Activity is a view of the Loads page, not a queue tab.** Its rows are drivers or trucks,
  not loads, so it is a `Loads | Activity` switch above the queues (`?view=activity`). It shares the
  Dispatcher / fleet scope, so "my drivers who have not hauled in 3 days" is one link.

## 4. Steps

| Step | What | Status |
|---|---|---|
| LA1 | Migration 0493 `loads.co_driver_id` + index, schema only. **No foreign key**: a second `loads → drivers` reference would make every `drivers(full_name)` embed ambiguous (PGRST201) and take the Loads page down for the deploy minutes. The writer only writes resolved roster ids, and the relink pass (D-LA3) repairs an id a merge leaves behind | in review |
| LA2 | Projection writes the co-driver; the relink pass (D-LA2, D-LA3); `loadDeliveredAt` (D-LA1); the Delivered window on the API and its filters, column and markers (D-LA4–D-LA6); the activity read and view (D-LA7, D-LA8) | building, after LA1 is on staging |

## 5. Open questions

- **Q-LA1 — Home time.** Nothing tells "on home time" apart from "sitting idle". `driver_time_off`
  exists (0068) with 0 rows, and McLeod's driver availability is not granted to the connector.
  *Candidates:* (a) ask Alex for SELECT on McLeod's driver home-time/PTO table and feed `driver_time_off`;
  (b) the office marks home time in Silvicom; (c) leave it, and show current HOS beside the days.
  *Recommendation:* (a). Until then the view shows (c), and the days figure carries no verdict.
- **Q-LA2 — History before 09/17/2026.** Older loads exist only in McLeod `_hist`. *Recommendation:* not
  now. Activity looks back weeks, not months, and the mirror passes 30 days on 10/17.
- **Q-LA3 — Active drivers off duty 25+ days** (ROMENDOZ, MOTIS, WMARDY, TSMITH, CHRILAFL, BELSTON on
  2026-10-19). The view lists them with their HOS rather than hiding them. Whether they are still
  employed is a roster question for the office.
- **Q-LA4 — The second seat on the Dispatch board and map.** D-LA2 leaves them on the lead driver.
  *Recommendation:* leave them until a dispatcher asks.
