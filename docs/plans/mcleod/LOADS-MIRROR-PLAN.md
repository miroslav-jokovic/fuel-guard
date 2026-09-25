# Loads as a read-only mirror of McLeod — plan

**Status: PLANNED, NOTHING BUILT.** Written 2026-09-24. Decision IDs are `D-LMR*`; open questions
are `Q-LMR*`. This plan **supersedes** the approval half of the load lifecycle (0087/0142) for loads
that come from McLeod. It **defers** to `LOADS-GO-LIVE-PLAN.md` for connecting, the politeness
policy, the change detector and the schedule (L5–L7, L9), and does not restate them. It **absorbs**
that plan's Q-GL6 (loads leaving the board are never closed), because a mirror that cannot close a
load is not a mirror.

---

## 1. The owner's ruling, and what it means in code

> Loads are read-only on our dashboard. McLeod is where a load is created, dispatched and changed.
> We retire creating loads and approving them here. The collector must store the data properly and
> in good order.

**D-LMR1 — McLeod is the only author of a load.** Silvicom stops creating, editing, reassigning,
submitting, approving, rejecting, releasing and cancelling loads. Every office write path in §3.2
is removed, not hidden behind a permission. A button nobody may press is a workaround with a delay
fuse.

**D-LMR2 — `loads.status` becomes a projection of McLeod's status, not a workflow.** It is computed
by the ingest from McLeod's movement and stop status on every sync. Nobody at Silvicom moves it.

**D-LMR3 — the collector keeps McLeod's facts verbatim; core keeps our model of them.** This is
D-ARC1's collectors→core shape, applied properly rather than through the per-load JSON blob we have
today. §4 has the tables.

---

## 2. What was measured (2026-09-24, live `lme` and production Supabase)

**Production holds nothing a retirement could lose.** `loads`: **303 rows, all `source='tms'`, all
`pending_approval`**. Zero manual loads. Zero loads ever approved, released, accepted or delivered.
629 `load_stops`, 0 of them with a driver's `arrived_at`. 303 `load_events` (one `created` each),
303 `load_external_payloads`, 16 `tms_dispatchers`. **So retiring the approval workflow deletes
no history** — there is none.

**The live board: 162 movements, 335 stops.** Fill rates, all read through the grant we already
hold (`silvicom_dispatch_ro`), none of them pulled today:

| field | column | filled |
|---|---|---|
| real stop name ("BATTERY SOLUTIONS") | `stop.location_name` | 332 / 335 |
| stop status (`A` open / `D` done) | `stop.status` | 335 / 335 |
| actual arrival / departure | `stop.actual_arrival` / `actual_departure` | 123 / 115 |
| ETA | `stop.eta` | 159 |
| stop contact / phone | `stop.contact_name` / `phone` | 91 / 83 |
| stop PO number | `stop.ponum` | 59 |
| shipper's location code | `stop.location_id` | 239 |
| customer code | `orders.customer_id` | 162 / 162 |
| weight / pieces / pallets | `orders.weight` / `pieces` / `pallets_how_many` | 72 / 31 / 21 |
| consignee reference | `orders.consignee_refno` | 63 |
| loaded vs empty | `movement.loaded` | 162 / 162 |
| extra pickups / deliveries | `orders.extra_pickups` / `extra_deliveries` | 1 / 7 |

**Not available, and why:**

- **PU number.** `orders.pick_up_no` and `stop.refno` are **0 of 162 / 0 of 335**. At a McLeod
  carrier it lives in `reference_number`, which the login **cannot read** (`HAS_PERMS_BY_NAME = 0`).
  That is a grant, not a build — Q-LMR5.
- **Customer name.** `customer` is denied; we have the code only. Same grant request.
- **Reefer set-point.** `orders.temperature_min/max` and `setpoint_temp` are filled on **2 of 162**.
  McLeod here does not record it, so the page must not pretend to show it.
- **Hazmat.** `orders.hazmat` is 0 of 162, as measured on 2026-09-10. Silvicom's hazmat engine
  stays the only source (D-LM12 unchanged).

**One order, one movement.** 0 movements with two orders and 0 orders with two movements on
today's board, so a load row per movement stays correct. Split orders (SD/SP, migration 0362) are
the known exception and are already handled.

**Stop types on the board:** `PU` 161, `SO` 170, `SP` 2, `VA` 2. Today the agent **drops** the last
four (D-LM15). Under D-LMR3 the collector keeps them, even while core cannot yet draw them.

---

## 3. The blast radius of retiring approval

Mapped 2026-09-24 from the code, not from the plans.

### 3.1 The one thing that breaks: how a load reaches a driver

The driver app lists only `offered`, `accepted`, `in_transit`, `delivered`, `canceled`
(`DRIVER_VISIBLE_STATUSES`, `loadsLifecycle.ts`; the same list is in RLS `loads_driver_scope`, 0087).
**Only the office's Release button ever sets `offered`** (`mutations.ts`, the `release` patch).
`auto_approve_loads` reaches `approved`, which a driver cannot see.

**So removing approval and release, and changing nothing else, means no McLeod load ever reaches a
driver's phone.** That is Q-LMR1, and it must be ruled before LR4.

### 3.2 Office write paths to remove (all `apps/api/src/modules/loads/routes/dispatch.ts`)

| route | today |
|---|---|
| `POST /api/dispatch/loads` | create a draft by hand |
| `PATCH /api/dispatch/loads/:id` | edit fields and replace stops |
| `POST /api/dispatch/loads/:id/assign` | reassign driver/truck/trailer |
| `POST /api/dispatch/loads/:id/{submit,approve,release}` | the approval chain |
| `POST /api/dispatch/loads/:id/{reject,cancel}` | with a reason; cancel/release notify the driver |
| `POST /api/dispatch/loads/bulk` | bulk approve / release |
| `POST /api/dispatch/loads/:id/exceptions/resolve` | acknowledges `amended` / `load_changed` events |

**Web:** "New load" and bulk Approve/Release on `DispatchLoadsPage.vue`; Edit, Cancel, Send back,
Submit, Approve, Send to driver and Reassign on `DispatchLoadDetailPage.vue`; the whole of
`DispatchLoadFormPage.vue`; the `/loads/new` route; `dispatch.loads.new` in `surfaceCatalogue.ts`;
the "Needs approval" default tab and the "Approval readiness" column.

**Machinery that loses its reason to exist:** `approvalChecklist()`; `tmsMayOverwrite` and
`AMENDABLE_LOAD_FIELDS` (a mirror always overwrites, so there is nothing to amend); the `amended`
and `stale_approval` exceptions; `org_integrations.config.auto_approve_loads`;
`organizations.require_separate_approver` (no code sets it); the approval gate in
`loads_status_guard` (0142).

### 3.3 Consumers that must keep working

| consumer | reads | effect of D-LMR2 |
|---|---|---|
| live map (`liveLoadReads.ts`) | `accepted`, `in_transit` | needs the status projection to produce these — today it shows **nothing**, because nothing is ever accepted |
| assignments board (`dispatchLoads/queries.ts`) | `offered`, `accepted`, `in_transit` | same |
| hazmat (`hazmat_loads.load_id`, 0148) | id and ref only | unaffected — hazmat declarations stay an office act on Silvicom's own table |
| messages (`message_threads.load_id`) | no status filter | unaffected |
| financial entries (`load_id`, 0257) | no status filter | unaffected |
| driver app | §3.1 | Q-LMR1 / Q-LMR2 |

⚠ **The live map has been empty of loads since L1.** Every McLeod load is `pending_approval` and
the map draws `accepted`/`in_transit` only. The projection in LR4 fixes that as a side effect;
it is worth saying to the owner, because it is the most visible result of this plan.

---

## 4. How the data is stored (D-LMR3)

Today the collector's raw copy is `load_external_payloads`: **one JSON blob per load, overwritten
every sync** (0150 says so: "the LAST payload, not a history"). It cannot be queried by column, it
holds only what the agent already mapped (dropped stops are not in it), and it forgets.

**Collector layer — `mcleod` module, layer `raw`, new tables (exempt from the deploy-window rule):**

⚠ **Named `mcleod_dispatch_*` because `mcleod_movements` already exists** (0267): it is the
finance sweep's table of CLOSED trips, keyed for cost, 25,169 rows. A movement appears in both —
in the dispatch mirror while it is worked, in the finance table once it settles — and the two are
written by different feeds with different payloads, so merging them would force the partial upsert
`lint:upserts` forbids. (Corrected 2026-09-24 by `COLLECTOR-AUDIT-2026-09-24.md`.)

- **`mcleod_dispatch_movements`** — one row per McLeod movement, key `(org_id, company_id, movement_id)`
  (the `movement.id` collision across companies is why `company_id` is in the key). Typed columns
  for **every field the agent reads**, named as McLeod names them: `order_id`, `blnum`,
  `movement_status`, `loaded`, `dispatcher_user_id`, `driver_codes text[]`, `tractor_id`,
  `trailer_id`, `trailer_type`, `commodity`, `customer_id`, `weight`, `pieces`, `pallets`,
  `consignee_refno`, `move_distance`, and later `pick_up_no`/customer name (Q-LMR5). Plus our own
  bookkeeping: `first_seen_at`, `last_seen_at`, `closed_at`, `source_version` (the CT version once
  L6 lands).
- **`mcleod_dispatch_stops`** — one row per McLeod stop, key `(org_id, company_id, stop_id)`, with
  `movement_id`, `movement_sequence`, **`stop_type` verbatim (VA/SP kept)**, `status`,
  `location_id`, `location_name`, address, city, state, zip, lat, **lon already negated**,
  `sched_arrive_early/late`, `actual_arrival/departure`, `eta`, `contact_name`, `phone`, `ponum`.
- Times: McLeod stores **Central wall-clock without an offset**. The collector stores them as
  `timestamptz` converted with `America/Chicago` **in one function with a test across a DST
  boundary** — never "append Z" (the `weather_cache` bug: `raw + "Z"` → NaN).

**Core layer — `loads` module, the product's model.** `loads` / `load_stops` stay the only thing
the harness reads. New columns, **each added one merge before its first reader**:

- `loads`: `customer_code`, `weight_lbs`, `pieces`, `pickup_number` (null until Q-LMR5),
  `consignee_ref`, `loaded`, `external_closed_at`.
- `load_stops`: `location_name`, `location_code`, `external_status`, `actual_arrival_at`,
  `actual_departure_at`, `eta_at`, `contact_name`, `contact_phone`, `po_number`.
  ⚠ `arrived_at` already exists and belongs to the **driver app**. The McLeod arrival is a different
  fact from a different witness, so it gets its own column (Q-LMR2 decides which one the page shows).

**The rule between them (D-LMR4):** the collector writes raw; **a projection function owned by
`loads`** turns raw into core; core is rebuildable from raw at any time. A mapping change (e.g.
naming `VA`) then becomes "re-run the projection", not "re-pull McLeod and hope".
`load_external_payloads` becomes redundant once `mcleod_dispatch_movements` is populated. Retiring it is
LR8, **after** a week of both, compared row by row.

⚠ **This is not a second source of truth.** Raw is *what McLeod said*; core is *what Silvicom
shows*. Only one is ever written by the feed and only one is ever read by a page. The test in LR3
is that no harness file reads `mcleod_dispatch_movements` (`lint:table-access` already enforces it for a
`raw` table).

---

## 5. Steps — one PR each, in this order

Each step has a Done-when a number can settle. "Verified" in this plan means **the four levels of
LOADS-GO-LIVE-PLAN §6**: unit tests each proven by mutation; ingest tests with `expectOrgScoped`;
a live dry-run compared id by id; and production rows checked, with **three named loads compared
by hand against McLeod's screen.**

### LR0 · Rulings and the grant request — owner, no code

1. Rule Q-LMR1 (driver reach) and Q-LMR2 (whose arrival counts). **LR4 cannot start without them.**
2. Send Alex one email: SELECT on `reference_number` and `customer` (Q-LMR5), plus the pending
   `VA`/`SP` question (Q-GL1) and the review routine (L2). One email, not four.

**Done when** both rulings are written into §7 of this plan.

### LR1 · Migration: the two raw tables — schema only

`mcleod_dispatch_movements`, `mcleod_dispatch_stops` as in §4. `enable row level security`, no client policy.
`raw-access-waiver` in the migration, `scripts/table-modules.json` entries with a growth
declaration (~180 movements/day, ~310 stops/day, measured), a PGlite matrix per table printing
`RESULT`, regenerated `schema.generated.sql`. Producer waiver naming LR3.

**Done when** every `lint:*` passes (all of them, not the migration handful), `pnpm test` is green,
and the migration is **applied in production, checked from `information_schema`**.

### LR2 · Migration: the new core columns — schema only, separate merge

The `loads` and `load_stops` columns of §4. Nullable, no defaults that lie (a missing weight is
`null`, never `0`). **No reader, no writer in this PR** (`lint:migration-ordering`).

**Done when** as LR1, and applied in production before LR3 is merged.

### LR3 · The agent reads everything granted; the collector stores it raw

- `queries.mjs`: `DISPATCH_LOADS` / `DISPATCH_LOAD_STOPS` gain the §2 columns. **Every parameter
  typed** (D-MCC11). The review routine SQL regenerates from them and `review.test.mjs` pins it.
- `loads.mjs`: send **every** stop, with its verbatim `stop_type`. Stop dropping at the agent —
  deciding what core can draw is the projection's job, not the reader's.
- New `POST /api/tms/dispatch-movements` (`/api/tms/movements` is taken by the reefer feed) → `mcleod` module writes `mcleod_dispatch_movements` / `mcleod_dispatch_stops` with
  **complete rows** (`lint:upserts`), stamps `first_seen_at` once and `last_seen_at` every sync.
- Contract in `packages/shared/src/tms.ts` (the only home for it).

**Done when** a live dry-run prints 162±churn movements and **all** stops including `VA`/`SP`;
after one real run, row counts in production equal the dry-run's; three movements compared by
hand column by column against McLeod; the Central→UTC conversion pinned by a test across the
2026-11-01 DST change and **proven by mutation** (swap to "append Z" and it must fail).

### LR4 · The projection: raw → core, and status becomes McLeod's (blocked on Q-LMR1/Q-LMR2)

- One function in the `loads` module projects raw rows onto `loads` / `load_stops`, always
  overwriting (D-LMR2). No `tmsMayOverwrite`, no `amended` events.
- The status projection (proposed in Q-LMR1, final after the ruling):

  | McLeod | Silvicom |
  |---|---|
  | movement `A` (uncovered) | `pending_approval` → renamed/relabelled **"Uncovered"** on the page |
  | movement `P`, no stop departed | `accepted` (or `offered`, per Q-LMR1) |
  | movement `P`, first stop departed (`stop.status = 'D'`) | `in_transit` |
  | movement `D` | `delivered` |
  | movement `V` | `canceled` |

- Migration: `loads_status_guard` lets **the feed** set any status on a `source='tms'` load and
  drops the approval gate for it. ⚠ This is a function change, which `lint:migration-ordering`
  cannot see — ship it one merge ahead of the projection and check `pg_proc` by hand.
- `load_events` still gets an append-only row on each status change, with `actor = feed`. It is
  the history nothing else keeps.

**Done when** production shows loads in every projected status matching McLeod's counts for the
same minute; **the live map draws loads for the first time**; three loads hand-checked; mutation:
map `D` to `in_transit` and a test fails.

### LR5 · Close what leaves the board (Q-GL6, option (a))

The agent also reads McLeod status for **every movement we hold open that is no longer on the
board** — a keyed read, **one `VarChar(32)` parameter per id** (the database is compatibility level
110: `STRING_SPLIT` does not exist; measured 300 ids in 3 ms), bounded by ids we already have — and sends `D`/`V`
explicitly. Never infer a close from absence (the reconcile that retired 33 vehicles and 120
drivers did exactly that). The first run closes the backlog: today ~140 of the 303.

**Done when** open loads in production equal McLeod's open board, id by id, and a test proves a
movement merely **missing** from a payload is left untouched (mutation: close on absence → fails).

### LR6 · Retire the office write paths

Everything in §3.2: API routes, web buttons, the form page and its route, the surface-catalogue
entry, `approvalChecklist`, `tmsMayOverwrite`/`AMENDABLE_LOAD_FIELDS`, the `amended` and
`stale_approval` exceptions, the `auto_approve_loads` read, `seedDemoLoads.ts` (or rewrite it to
seed raw rows). Tests for removed behaviour are deleted with it; tests for "this route is gone"
(404) are added. Columns (`approved_by`, `released_at`, …) stay — dropping columns is a
four-step dance for no user benefit; a follow-up may remove them.

⚠ Order matters: LR6 lands **after** LR4, so there is never a day when a load can be neither
approved by a person nor projected by the feed.

**Done when** `grep` finds no caller of the removed routes in `apps/web`; `lint:boundaries`,
`lint:filesize`, typecheck, all tests green; the permission matrix no longer offers a
"create load" surface.

### LR7 · The Loads page, redesigned read-only

Reads core only. Starts from call sites and `docs/DESIGN-SYSTEM-CONTRACT.md`, not from a blank
page. Columns, from the owner's 2026-09-23 list, each mapped to its measured source:

| column | source | available |
|---|---|---|
| Load # | `loads.ref` (+ BOL on hover) | ✅ |
| Dispatcher | `tms_dispatchers.display_name` | ✅ |
| Truck / Trailer / Driver | `vehicle_id` / `trailer_id` / `driver_id` | ✅ (team co-driver: Q-LMR4) |
| PU # | `loads.pickup_number` | ⛔ until Q-LMR5 |
| Pickup — place + time | first pickup stop: `location_name`, city/ST, appointment, actual | ✅ |
| Delivery — place + time | last dropoff stop, same | ✅ |
| Additional stops | count, expandable | ✅ |
| Type: Regular / Reefer / Hazmat | trailer type; hazmat from Silvicom's engine | ✅ |
| Status | projected status, McLeod's words in the tooltip | ✅ after LR4 |
| View | detail drawer: stop timeline with scheduled vs actual vs ETA | ✅ |
| Send via Email / SMS | — | Q-LMR6 |

Tabs: **Active** (default) · **Uncovered** · **Delivered** · **All**. Dates through the one
MM/DD/YYYY definition, times in the carrier's zone. Walked at desktop and phone widths, screenshots
in the PR.

**Done when** three loads read the same on the page as on McLeod's screen, field by field.

### LR8 · Retire `load_external_payloads`

After one week of LR3 and the old blob side by side, compared row by row. Remove the writer,
then drop the table in a later merge.

### Beyond this plan (in LOADS-GO-LIVE-PLAN, re-ordered by COLLECTOR-AUDIT-2026-09-24)

CA1–CA7 in `COLLECTOR-AUDIT-2026-09-24.md`: the finance collision fix, one connection with the
politeness policy (L5), one process on the Board VM, and — if Q-CA1 is ruled — an agent-side hash
**instead of** the L6/L7 change detector, which measured costs the carrier more than the sweep. Until L9 the mirror is only as fresh as the last manual run, and the page must say so:
it shows **"McLeod as of <time>"** from `max(last_seen_at)`, never an implied "live".

---

## 6. What the owner will see, in order

LR3 — nothing visible. LR4 — the live map shows loads; statuses stop saying "pending approval".
LR5 — ~140 stale loads close. LR6 — approval buttons disappear. LR7 — the new page.

---

## 6a. The owner's second ruling (2026-09-24): how a McLeod load reaches a driver

> A dispatcher creates the load in McLeod; it appears on our table. From the table's action column
> and the load's detail page there is a **Dispatch** button; a modal picks the driver (with the
> components we already have) and **Send** dispatches it to the driver app — which is built later, so
> for now it texts the load's details to the driver. Distribution is built later: prepare it, do not
> insist it is functional now. What matters now is that the loads are pulled and kept current in the
> collectors.

**D-LMR5 — Q-LMR1 is ruled: a load reaches a driver when Silvicom's dispatcher SENDS it.** None of the
three candidates in §7: not automatic on McLeod `P` (a), not the old approve/release chain (b), and
not "never" (c). One office act, **Dispatch**, replaces submit → approve → release. It is the only
write Silvicom keeps on a McLeod load, and it does not write the load: see D-LMR6.

**D-LMR6 — a dispatch is its own record, never a column on the mirrored load.** Proposed, for the
owner to confirm before LR-D1. `loads` is a projection of McLeod (D-LMR2) and is overwritten on every
sync, so a driver chosen in the modal cannot live in `loads.driver_id`: the next sync would put
McLeod's driver back and the dispatch would silently vanish. It goes in a new append-only
`load_dispatches` row — load, driver, who sent it, when, the channel (`sms` now, `app` later) and
the channel's outcome. The modal PRE-SELECTS McLeod's driver; choosing someone else is allowed and
is then visibly different from McLeod on the page, not hidden. Re-dispatching is a new row, never an
edit. This is also the thing the driver app will read later ("loads sent to me"), so distribution
is prepared by construction rather than by a flag.

**D-LMR7 — `loads.status` stays McLeod's; "sent to driver" is derived from `load_dispatches`.**
Proposed with D-LMR6. The LR4 table below keeps its McLeod half; the dispatch state is a separate
column on the page ("Not sent" / "Sent to J. Smith, 09/24 10:14"), because it is a different fact
from a different author.

**D-LMR8 — a McLeod weight of 0 means "not entered", and projects to null.** Researched on live `lme`
2026-09-24 (every 2026 TMS order, 12,581 rows, all `weight_um = 'LB'`):

| order status | weight null | weight 0 | weight > 0 |
|---|---|---|---|
| A (available) | 22 | **0** | 22 |
| P (planned) | 74 | **0** | 44 |
| V (void) | 431 | **0** | 156 |
| D (delivered) | 31 | **8,526** | 3,275 |

A zero exists **only on delivered orders**, and **every** delivered order older than about two weeks
has either a real weight or 0 — the 31 nulls are all delivered in the last three weeks (23 this
week, 7 last, 1 three weeks back). So McLeod writes 0 in place of "no weight" some time after
delivery; it is not a load that weighed nothing. Corroborated: zero-weight orders carry pieces on 2 of
8,526 (weighed orders: 1,154 of 3,497), and zeros cluster by customer (ARRIAUTX 1,221 of 1,336,
LANDJAF2 1,019 of 1,121 — brokers whose tenders carry no weight). The single zero on the open board
is order 0005905, status P, a years-old stale order. **Rule for LR4:** raw keeps McLeod's 0 verbatim
(D-LMR3); the projection writes `loads.weight_lbs = null` for 0, and for any unit other than `LB`
(none exist) until someone rules on a conversion.

**The six fields beyond Alex's list** (`loaded`, `weight_um`, `pallets_how_many`, `consignee_refno`,
stop `id`, stop `phone`): the owner confirms Alex will add them to his list — accepted, no change.

### Steps, re-ordered by the ruling

| step | what | functional now? |
|---|---|---|
| LR4 | projection raw → core, status from McLeod, weight per D-LMR8, times already zoned (LR3) | yes — the table shows McLeod's loads, current |
| LR-D1 | migration: `load_dispatches` (append-only, RLS) | schema only |
| LR-D2 | `POST /api/dispatch/loads/:id/dispatch` → a `load_dispatches` row + the SMS attempt through `lib/sms.ts`; the outcome recorded, never assumed | yes, but SMS is dark: `SMS_PROVIDER=none` until Telnyx has a number (§6 of the SMS plan), so every send records `not_sent: sms_not_configured` |
| LR-D3 | the **Dispatch** button (table action column + detail page) and the modal, reusing the detail page's `ComboSelect` driver picker; McLeod's driver pre-selected; the SMS body previewed before Send | yes |
| LR6 | retire submit/approve/release/reject/create/edit — only after LR4 and LR-D3, so there is never a day with no way to reach a driver | — |
| LR7 | the read-only table redesign | — |
| later | driver app reads `load_dispatches`; Q-LMR2 (whose stop arrival counts) is ruled then | no |

## 7. Open questions

1. **Q-LMR1 — RULED 2026-09-24 as D-LMR5 (§6a): the office Dispatch action.** Original question: how does a McLeod load reach a driver's phone now that nobody releases it?
   (a) a `P` load with a resolved driver projects straight to **`accepted`** — McLeod dispatch *is*
   the assignment, and asking the driver to accept again duplicates a conversation that already
   happened; the app shows it read-only with stop capture;
   (b) project to **`offered`** and keep the driver's Accept/Decline — but a decline then has
   nowhere to go, because Silvicom can no longer reassign;
   (c) McLeod loads do not go to the driver app at all.
   **Recommendation: (a).**
2. **Q-LMR2 — whose stop arrival is the truth: McLeod's or the driver app's?** Today the driver's
   `driver_complete_stop` also moves the load to `in_transit`/`delivered`. Under D-LMR2 that would
   fight the projection. **Recommendation:** McLeod owns status and times; the driver app's stop
   actions become **evidence only** (photos, BOL/POD, its own `arrived_at`) and stop moving
   `loads.status`. The page shows McLeod's actual, with the driver's as a second line when both exist.
3. **Q-LMR3 — `A` loads (uncovered, no dispatcher, no trailer).** Show them? **Recommendation:**
   yes, on their own "Uncovered" tab, never on the map (D-MCC12 unchanged).
4. **Q-LMR4 — team loads.** The contract carries one driver; 4 team movements on the 2026-09-17 board.
   **Recommendation:** store both in raw (`driver_codes[]` already does); show the co-driver on the
   page; a `load_drivers` link table only if the driver app needs to show it to both.
5. **Q-LMR5 — PU number and customer name need SELECT on `reference_number` and `customer`.**
   Alex. **Recommendation:** ask in LR0's email; column-scoped on `customer` (name, city, state —
   no credit or billing fields), and `reference_number` filtered to what we read.
6. **Q-LMR6 — "Send via Email/SMS": what is sent, to whom?** SMS is dark until Telnyx has a number
   (see `sms-provider-is-telnyx`). **Recommendation:** after LR7; email first, via Brevo, sending the
   load sheet to the assigned driver; spec it separately.
7. **Q-LMR7 — manual loads.** Zero in production. **Recommendation:** remove the ability entirely
   (LR6); keep `source` as a column so history reads correctly.
8. **Q-LMR8 — retention of `mcleod_dispatch_movements` / `mcleod_dispatch_stops`.** Growth ~180 + ~310 rows/day.
   **Recommendation:** keep closed movements 400 days (IFTA/audit look-back), under DATA-LIFECYCLE L9.
9. **Q-LMR9 — no consent covers a dispatch text. BLOCKS the SMS half of Dispatch (found in LR-D2).**
   The only SMS consent instrument, `SMS_CONSENT` (`smsConsentContract.ts`), is limited in its own
   words to "messages about your own application", and every consent row in `sms_consents` was granted
   under it (source `application`). `lib/sms.ts` checks nothing by design — its caller owns consent
   and quiet hours — so a dispatch path calling it would text drivers without consent the day Telnyx
   gets a number. The 10DLC campaign being registered is also a recruiting use case, and a carrier's
   campaign is registered per use case. Candidates:
   (a) a second consent instrument, "dispatch and load messages", collected from employed drivers at
   onboarding (office-recorded, `source = 'office'` already exists), plus a dispatch use case on the
   Telnyx campaign; counsel reviews the wording with the Q1–Q17 memorandum;
   (b) widen `SMS_CONSENT` to cover employment messages — cheaper, but it re-papers every existing
   consent row and changes an instrument counsel has not yet read;
   (c) no SMS: dispatch reaches the driver through the app channel only (`channel = 'app'`) when it
   ships.
   **Recommendation: (a)**, with quiet hours NOT applied to dispatch (a load assigned at 02:00 is work,
   not marketing; counsel to confirm). Until it is ruled, Dispatch records `not_sent` /
   `sms_not_configured` today and `not_sent` / `no_dispatch_consent` once Telnyx is live — the text is
   composed and stored either way, and nothing is sent.

---

## 8. Progress log

Append a dated line per merge. Never edit a status column.

- 2026-09-24 — plan written. Measured: live board 162 movements / 335 stops, fill rates in §2;
  production 303 loads, all `tms`, all `pending_approval`, none ever approved; the only path to a
  driver is the office Release (§3.1); the live map has drawn no load since L1 (§3.3).
- 2026-09-24 — corrected by the collector audit: raw tables renamed `mcleod_dispatch_*` (the
  name `mcleod_movements` is the finance sweep's, 0267); LR5 uses one typed parameter per id
  (compatibility level 110, no `STRING_SPLIT`); the change detector is proposed dropped (Q-CA1).
- 2026-09-24 — **LR5's agent half is built** (COLLECTOR-AUDIT CA4): `closeReadQueries` +
  `fetchClosedLoads`, run every 10 minutes by `--service` for loads that left the board, and
  `--close --ids-file` for the one-off backlog. A `V` posts as `canceled: true`; a `D` travels as
  `external_status` until LR4 projects status. Dry run on production's backlog: 181 → 178 D, 3 V.
- 2026-09-24 — **LR1 built** (migration 0364, `mcleod-dispatch-raw.test.mjs` 28/28, seven mutants
  each failing by name). Column types read from lme's `INFORMATION_SCHEMA`, not assumed: `decimal`
  stored as unbounded `numeric`, `loaded` kept as McLeod's `L`/`E`, `pallets` named
  `pallets_how_many` as McLeod names it. Three departures from §4, each on purpose: **no
  `source_version`** (L6 was withdrawn with Q-CA1, so nothing would ever write it); stops **cascade
  from their movement through a composite `(org_id, company_id, movement_id)` FK**, so retention
  (Q-LMR8) deletes movements only; a **CHECK keeps `longitude` west-negative**, so a lost negation
  fails the sync instead of drawing the fleet in China. **Growth corrected:** measured on lme over
  the 28 days to 2026-09-22 it is **99.3 movements and 209.7 stops per day**, not ~180/~310 (those
  were board-size figures); budgets are 300 and 650 (×3). Producer waivers name LR3.
- 2026-09-24 — **LR1 merged** (#1005) and **applied in production**, checked from
  `information_schema`: both tables, 22 and 25 columns, the longitude CHECK, RLS on.
- 2026-09-24 — **LR2 built** (migration 0366, `loads-mirror-columns.test.mjs` 36/36, five mutants
  each failing by name). 0365 is the applicant flow's (#1007) and must merge first: `migrate.yml`'s
  plain `supabase db push` refuses a migration numbered below one already applied.
  The §4 columns exactly, all nullable with no default. Measured for the name
  `weight_lbs`: 69 of 69 weighted orders on the open board are `weight_um = 'LB'` — but McLeod's
  minimum there is **0**, so whether a McLeod zero means "none entered" is a ruling LR4's projection
  owes, not a default. No reader and no writer in this merge.
- 2026-09-24 — **LR2 merged** (#1008, after the applicant flow's 0365) and **applied in production**:
  7 columns on `loads`, 9 on `load_stops`, from `information_schema`. **Alex's reply:** Q-LMR5's grants
  are coming — `reference_number`, and `customer` column-scoped to id, name, city, state, exactly the
  recommendation — on the analytics copy first. His stop-type answer (LOADS-GO-LIVE Q-GL1) is what
  LR4 needs: SD/SP are split-trailer stops, VA/VP interline points. **LR3 carries a condition:** the
  new fields go live only after Alex has the regenerated `SILVICOM-READ-ROUTINE.sql`.
- 2026-09-24 — **0367 merged** (#1011): `mcleod_dispatch_movements.weight_um`, found while writing LR3 —
  0364 kept the weight without its unit, so LR4 could not have converted or refused a non-pound one.
- 2026-09-24 — **LR3 built.** `DISPATCH_LOADS` / `DISPATCH_LOAD_STOPS` gain the §2 columns (review file
  regenerated — **Alex must receive it before this reaches the VM**); `assemble` returns raw movements
  beside loads, every stop verbatim; `POST /api/tms/dispatch-movements` → `dispatchMovementIngest.ts`,
  complete rows, `first_seen_at` never rewritten, `closed_at` kept from McLeod's first D/V, a
  movement's removed stops deleted by id. Contract in `packages/shared/src/tmsDispatchMirror.ts` (not
  `tms.ts`: 468 of 500 lines). **Live dry run on `lme`: 163 movements, 340 stops — PU 163, SO 172,
  SP 2, VA 3 — every one through the contract, zero POSTs.** Fill rates: location_name 336/340,
  actual arrival 127, departure 121, ETA 154, contact 84, PO 53; weight 67/163, all `LB`.
  ⚠ **A live defect found and fixed on the way:** the load feed has posted McLeod's zoneless Central
  times bare since L1, and Postgres read them as UTC — every `load_stops.appointment_*` in production
  is **five hours early** (order 0135527, stop 2: McLeod 17:00, stored 17:00 UTC = noon Central).
  `centralToIso` (`centralTime.mjs`, DST pinned across 2026-11-01 and 2027-03-14) now converts every
  McLeod time, for the load feed as much as the mirror. The stored stops correct themselves on the
  VM: `writeStops` deletes and rewrites the pending stops of every load the feed still owns (all 303
  are `pending_approval`, none worked), the first `--service` sync re-posts every board load (its
  state starts empty), and the one-time `--close` re-posts the ~181 that left the board.
  Ten mutants, each failing by name (append-Z fails 7). Nothing is posted to production from here:
  the first real run is on the VM, after Alex has the new SQL file.
- 2026-09-24 — **Owner's second ruling recorded (§6a):** D-LMR5 (Q-LMR1: the office Dispatch
  action, SMS for now, the driver app later); D-LMR6/D-LMR7 proposed (a dispatch is its own
  `load_dispatches` row, `loads.status` stays McLeod's); D-LMR8 from research (McLeod weight 0 =
  "not entered" → null in core); the six extra fields accepted. Steps re-ordered: LR4, LR-D1..3, LR6, LR7.
- 2026-09-24 — **D-LMR6 and D-LMR7 ruled by the owner** ("yes on both"): a dispatch is its own
  `load_dispatches` row; `loads.status` stays McLeod's.
- 2026-09-24 — **LR4a built (migration 0368), one merge ahead of the projection.** `loads_status_guard`:
  a `tms` load enters pending_approval / approved / in_transit / delivered / canceled from any status,
  on insert or update, with no approver or readiness checks and no `completed_at` stamp (that is the
  driver's); moves into offered / accepted / draft keep 0142's table; manual loads unchanged; `source`
  can no longer change. ⚠ **Found while designing it:** `tab.loads` is on by default, so projecting
  McLeod's departed-`P` to `in_transit` would have put the load on its driver's phone before anyone
  pressed Dispatch — against D-LMR5. The driver scopes (and `driverLoads.ts`, which reads as the
  service role) now also require `released_at` for a `tms` load; LR-D2 moves that to `load_dispatches`.
  Matrix 24/24; eight mutants — six fail by name, and the two on the stops/events scopes cannot fail
  because those policies read `loads` under the driver's RLS (defence in depth, said so in 0368).
  **LR4b waits for `pg_proc` to show this body in production.**
- 2026-09-24 — **LR4a merged (#1016) and confirmed live**: `pg_proc` shows the 0368 guard, and all
  three driver-scope policies carry the `released_at` gate.
- 2026-09-24 — **LR4b built: raw → core.** `projectMcleodMovement` (pure, `@silvicom/shared`) holds
  every rule — status (D-LMR7), weight and pieces 0 → null (D-LMR8), PU/SO drawn with McLeod's
  sequence and real stop name, VA/SP kept in raw with a note, McLeod's actuals/ETA/contact in their own
  columns. `mcleod/dispatchProjection.ts` reads the raw rows BACK (core rebuildable from raw) and
  resolves codes with the ingest's own resolvers; `loads/mirrorLoads.ts` — the loads module's
  interface — writes `loads` / `load_stops` / `load_events`, overwriting only McLeod-owned columns
  (never hazmat, notes, approval or release stamps), clearing only pending stops. Wired into
  `POST /api/tms/dispatch-movements`. **The agent no longer posts `/api/tms/loads`**: two writers of
  one load would fight over its status. The route stays until LR6/LR8; since the old feed never ran
  alongside the mirror in production, LR8's week-long comparison has nothing to compare and becomes
  "remove the route and `load_external_payloads`".
  **Measured on today's live board with the real projection:** 164 movements → 47 `A` →
  pending_approval, 117 `P` → in_transit, 0 refused; drivers unmatched 5 of 143, trucks 0 of 143;
  weight on 63, null on 101. ⚠ **Two findings for LR7's labels, not the mapping:** (1) every `P` on the
  board already has its first stop DONE (arrival and departure) — at this carrier `P` means under way,
  and "P, nothing done → approved" occurs 0 times today; (2) 26 of the 47 `A` movements already carry
  a driver and a truck (no dispatcher) — "planned", not "uncovered". Both still read "not sent", which
  is what D-LMR5 needs. Ten mutants, each failing by name.
- 2026-09-24 — **LR-D1 built** (migration 0370 — 0369 went to the applicant flow's #1020, which
  therefore merges first; `load-dispatches.test.mjs` 27/27, eight mutants each failing by name; a ninth — skipping the DELETE branch — is a no-op, because the UPDATE comparison
  against a null `new` raises the same LD011). `load_dispatches`: load, driver, `sent_by`, `sent_at`,
  `channel` (`sms`/`app`), `outcome` (`sent`/`not_sent`/`failed`) + `outcome_reason`, `recipient`,
  `body` (what the driver was told — the load itself is overwritten by every sync), and
  `provider_message_id`. **A CHECK makes "sent" unwritable without a recipient and a provider
  receipt**, so the dark SMS can only ever record `not_sent`. Append-only by trigger (LD011) except
  `driver_id`, which a roster merge moves: the table is in `DRIVER_REASSIGNMENTS`, and the matrix
  drives the real list and shows the merge aborting (`on delete restrict`, 23001) without the entry.
  The guard refuses a load or driver from another org (LD010). RLS on, no policy; `rls.test.mjs`
  hand-seeds it (167 tables covered). Producer waiver names LR-D2.
  ⚠ **The driver scopes did NOT move here, on purpose.** `driverLoads.ts` applies 0368's predicate
  with the service role, so the policy and that reader must change in one merge, and a reader of
  `load_dispatches` cannot share the merge that creates it (the deploy window). They move in LR-D2,
  after `information_schema` shows 0370 in production, together with a driver-own-row select policy
  (the scope's `exists` runs under the driver's RLS, where deny-all would read "never sent").
- 2026-09-24 — **LR-D1 merged (#1021) and applied in production**, checked from `information_schema`
  and `pg_class`: `load_dispatches`, 12 columns, RLS on, no policy, 4 CHECKs, the guard trigger.
- 2026-09-24 — **LR-D2 built.** `POST /api/dispatch/loads/:id/dispatch` writes one `load_dispatches`
  row (`loads/dispatchToDriver.ts`), audited as `dispatch.load_dispatched`, behind the section
  matrix's `dispatch:manage` (the roles that could Release). It refuses a manual load, a delivered or
  canceled one, and a driver not active in the org. `GET /loads/:id/dispatch-preview?driverId=` returns
  the exact text Send would store: `composeLoadDispatchSms` (`@silvicom/shared`) is the one definition,
  ASCII-only so a message stays GSM-7, with appointments on the carrier's clock via a new optional
  zone on `formatDisplayDateTime`. ⚠ **Nothing is texted, on purpose: Q-LMR9.** The only SMS consent
  covers application messages, so the send records `sms_not_configured` (today) or
  `no_dispatch_consent` (Telnyx live) and never calls the transport. `smsConfigured` in `lib/sms.ts`
  is the one "is SMS live" definition, which `sendSms` now also uses.
  **The driver scopes moved (migration 0371):** a `tms` load reaches its driver while the load's
  CURRENT dispatch names them, via `auth_dispatched_load_ids()`, a parameterless caller-scoped
  security-definer helper in the family of `auth_driver_id` (a parameterised first draft was refused
  by `rls.test.mjs`'s 0162 rule, and its `anon` revoke made an anonymous read of `loads` error instead
  of filter). `released_at` no longer counts for a `tms` load. 0370's header expected a driver-own-row policy instead; that could not answer "latest", because
  a driver cannot see the rows naming others, so `load_dispatches` stays deny-all. `driverLoads.ts`
  restates the rule for the service role, in the same merge as the policy. `loads.driver_id = me` still
  applies, so a load dispatched to someone other than McLeod's driver reaches nobody in the app yet;
  that belongs with the app channel and Q-LMR2. Matrix `loads-mirror-status-guard` 30/30; 14 mutants
  across the service, the reader, the composer, the date zone and 0371, each failing by name. One
  survived at first (the reader's sort direction) and the test was tightened until it failed. Dropping the helper's org filter is a no-op mutant: `auth_driver_id()` is org-bound and 0370 keeps a dispatch in its load's org, so the filter serves the `(org_id, driver_id)` index, not correctness.
- 2026-09-24 — **LR-D2 merged (#1024) and live**: `api` serves f621535, `schema_migrations` reads
  0371, and all three driver scopes read `auth_dispatched_load_ids()` (none reads `released_at`).
- 2026-09-24 — **LR-D3 built: the Dispatch button and drawer.** `features/dispatch/DispatchLoadDrawer.vue`
  opens from the board's action column (a kebab item, "Dispatch…"; the contract's §5.6 puts a
  row with more than one action in the kebab) and from the load page ("Dispatch" / "Dispatch again").
  It is a `SlideOver` and not a centred modal, because the house rule reserves `BaseModal` for
  content that needs width. It pre-selects McLeod's driver, labelled "(McLeod's driver)", and offers
  only active drivers (the API refuses the rest). The message is the API's `dispatch-preview`,
  verbatim, so the browser never composes it, and it says in words that no text went out and why.
  Both reads now carry the dispatch record (D-LMR7): the board has a **Dispatch** column
  ("Not dispatched" / "Dispatched to … · MM/DD/YYYY h:mm") beside McLeod's status, and the load page
  has a Dispatch line fed by `dispatches`, the full history, newest first. The wording is
  **"Dispatched to", never "Sent to"**, while no text has gone out. `isDispatchable` is in
  `@silvicom/shared`, so the button and the endpoint share one rule. **Release ("Send to driver") is
  hidden on McLeod loads**, singly and in bulk: since 0371 it no longer reaches a driver, and LR6
  removes the route. The board's header copy was changed for the same reason.
  **Walked** with a dev-bypass build at 1440 px and 390 px (board → kebab → drawer → Dispatch →
  toast → load page). The walk found a real bug: a `.stop` on the kebab item kept the menu, and its
  scrim, open over the drawer's Dispatch button, so the click never landed. Fixed.
  ⚠ **For LR7, seen on the walk and not changed here:** the "Approval readiness" column shows red
  blockers on every McLeod load ("2 stop(s) missing a window"), which means nothing under
  D-LMR5; the queue tabs overflow a phone, so the page scrolls sideways at 390 px (683 px wide); and
  "Reassign…" on a McLeod load writes `loads.driver_id`, which the next sync overwrites (LR6).
- 2026-09-24 — **LR6 built: the office write paths are gone.** The API no longer has create
  (`POST /loads`), edit (`PATCH /loads/:id`), `/assign`, `/submit`, `/approve`, `/release`, `/reject`,
  `/cancel` or `/loads/bulk`; `dispatchRoutes.test.ts` asks each of the nine as an entitled dispatcher and
  gets 404 with nothing written, beside controls showing the board, `/exceptions/resolve` and Dispatch
  still answer. The web lost New load, bulk Approve / Send to driver and row selection, the Approval
  readiness column, and on the load page Edit, Cancel load, Send back, Submit, Approve, Send to driver,
  Reassign and the checklist card; `DispatchLoadFormPage.vue`, `dispatch.loads.new` (no stored access row
  named it) and `seedDemoLoads.ts` are deleted, and `/loads/new` redirects to `/loads` so a bookmark does
  not open a load called "new". `approvalChecklist`, the create/update/assign/reason schemas and the
  `stale_approval` and `load_changed` exceptions went with them — `stale_approval` would have flagged all
  47 `A` loads forever. Decided in the PR: **cancel** removed (McLeod's `V` already projects to canceled,
  so an office cancel fought the sync); **manual loads** removed entirely (Q-LMR7: 303 loads, all `tms`);
  **no migration** — 0142's approval gate stays in `loads_status_guard`, since it can only touch a manual
  load and none can be made, and removing it is a function change for no user benefit. ⚠ **The §40.25(j)
  return-to-duty gate moved to Dispatch** rather than leave with create/edit/assign, the three doors that
  carried it: it is in `prepare()`, so the preview refuses before a text is shown. Tabs are now Active
  (default) · Available · Delivered · Exceptions, and `pending_approval` reads "Available", McLeod's word
  for `A`; "Planned" for an `A` with driver and truck is LR7's. Kept: `/exceptions/resolve`, `amended`
  (until LR8 removes its writer), the approval columns, the driver app's verbs, `POST /api/tms/loads`.
  Seven mutants — the moved gate removed, scoped to the wrong org, or given the recruiter's wording;
  Release and create restored; `A` back under Active; an approval tab restored — each failing by name.
