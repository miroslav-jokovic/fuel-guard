# McLeod API Kit — what it unblocks, what we decide, what we build

**Status:** PLAN, 2026-11-19. Nothing below is built. Decision and question prefix: **D-MK / Q-MK**
(unused anywhere in the repo on 2026-11-19). Blockers that only McLeod or Alex can clear: **B-MK**.

**Why this exists.** On 2026-11-19 the owners decided to buy McLeod's full API Kit (quoted verbally at
about $750/month) so Silvicom 360 can become a custom front end for McLeod: read through the API and,
for the first time, **write**. "Start small." Until now every plan was built on the opposite rule —
McLeod is read-only, SELECTs only — and that rule is written into a dozen rulings that still say so.
This document (1) records what we actually know and do not know, (2) lists every place the old rule
stopped work, (3) proposes an answer for each open question, and (4) gives the build order.

Sources: three read-throughs of `origin/main` at `2e1527c68` on 2026-11-19 (code, plans, memory), the
2026-11-11 meeting PDFs in `docs/plans/mcleod/` (untracked), `docs/MCLEOD-SELF-HOSTED-INTEGRATION.md`,
and the owner's driver-app research of 2026-11-19 (checked claim by claim against the code, §2).

---

## 0. What we know about the API, and what we do not

### 0.1 Known (public McLeod docs + our own measurements; none of it from API Kit docs for our install)

| Fact | Source |
|---|---|
| Two modes: **Direct-Hosted** `https://<our-host>/ws` on our LAN, or **Cloud-Hosted** via Innovation Hub (`X-Mcld-Tenant`, `X-Api-Key`) | `MCLEOD-SELF-HOSTED-INTEGRATION.md:12-20, 49-50` |
| Auth: HTTP Basic, or a revocable token made in LoadMaster or returned by `POST /users/login`; every call sends `AnywhereCompanyID`; `Accept: application/json` (default is XML) | same, `:59-97` |
| 401 = bad token, 403 = role lacks the operation; JSON uses LoadMaster table/field names, omits nulls | same, `:80-83, 105-109` |
| Documented reads: `/movements/search` (`changedAfterDate`, paging), `/movements/{id}`, `/orders`, `/drivers`, `/drivers/{id}/assignments|current|lastStop` | same `:85-88`; SILVICOM360-TMS `RESEARCH-RESOLUTIONS.md:2330-2335, 2750-2765` |
| Documented writes: `PUT /drivers/create`, `/users/create`, `PUT /users/update` | `RESEARCH-RESOLUTIONS.md:2750-2765` |
| **Symphony Mobile Communications** API: POST position, trailerStatus, forms; PUT driverHours, driverAvailable, driverStatus; reads outbound messages/workflows | `RESEARCH-RESOLUTIONS.md:3558-3584` |
| Movement search caps at 1,000 rows; `changedAfterDate` reaches back only as far as audit retention | `MCLEOD-SELF-HOSTED-INTEGRATION.md:39-43` |
| We run **LoadMaster 22.1**; current is 26.2; `/ws` "ships with our version but was never enabled" | meeting PREP PDF |
| Our on-prem VM (`<VM LAN IP>`, Alex's) is **outbound-only**: LME `:1433` and HTTPS 443 out, nothing in | `mail.md:40`; `tools/mcleod-agent/README.md:24-28` |
| McLeod's EFS integration writes TRIP and TRLR prompts onto fuel cards on every dispatch (162 of 199 cards) | `docs/25-EFS-ACCOUNT-INVENTORY.md:180` |
| Imaging (DocumentPower) lives in `dta`..`dta6` on host <imaging host>; neither of our logins can open it | `dispatch-loads/LUMPER-REVISED-RC-PLAN.md:302-305` |

### 0.2 Not known — every one of these is a blocker for something below

| # | Unknown | Blocks |
|---|---|---|
| **B-MK1** | **The API Kit's documentation for our install**: the service list and, per service, read vs write. Not documented anywhere we hold: stop arrive/depart/actualize, ETA, order create/update, dispatch/assign, DocumentPower upload, tractor/trailer status update, AP voucher create, settlement/deduction writes, fuel entry, home time outside Symphony | every write in §5 except `drivers/create` |
| **B-MK2** | Does `/ws` work on **22.1**, or does the kit need the 26.x upgrade? Are calls stable across upgrades? (meeting Q46, unanswered) | MK0 |
| **B-MK3** | Our `/ws` URL, its TLS certificate (the SQL server's is self-signed), our `AnywhereCompanyID` values (TMS..TMS4) | MK0 |
| **B-MK4** | An integration user + token with the **least** role that still does each write | MK0, every write |
| **B-MK5** | A **test company or test database we may write to**. `lme_analytics` is a read-only restore, and none of TMS2..TMS4 is known to be a test company | every write (D-MK3) |
| **B-MK6** | Our audit retention and whether the 1,000-row cap can be raised | MK1 (read parity) |
| **B-MK7** | Webhooks/events on `/ws`, or polling only | MK1 design |
| **B-MK8** | Do we license **Symphony**? (needed for Symphony mobile writes and for Samsara↔McLeod) | home time / driver status via Symphony |
| **B-MK9** | **Alex's written agreement** to API writes. His 2026-09-24 terms are "SELECTs only, nothing connecting into our network" (`mail.md:36-42`) | every write |
| **B-MK10** | The 2026-11-11 meeting answers (the QUESTIONS PDF "Notes" section is blank) and the 2026-11-19 email to Ron and his reply — neither is on file | context for B-MK1..8 |

**Recommended single action that clears most of them:** one request to McLeod (through Ron) for: the
API Kit docs for 22.1, the `/ws` enablement steps, a write-capable **test company**, the role list per
service, audit retention and row cap, webhook availability, and whether Symphony is licensed. Plus one
email to Alex asking for his written OK on API writes from the VM, sent as **one complete message**.
Until B-MK1 lands, only §4 (things that need no API) and MK0's preparation can be built.

---

## 1. Every ruling that still says "read-only" — to re-rule on paper

Nothing below changes until the owner re-rules it. Proposed new wording in the right column.

| Ruling | Where | Says today | Proposed re-ruling |
|---|---|---|---|
| 2026-09-24 owner ruling, **D-LMR1** | `LOADS-MIRROR-PLAN.md:18` | McLeod is the only author of a load; office write paths removed | **Keep for now** (D-MK4): loads are still created in McLeod. Re-open only after MK3 proves writes |
| **D-LMR2** | `:23` | `loads.status` is McLeod's projection | **Keep.** The driver writes stop facts *to McLeod*; McLeod's status comes back on the sweep |
| **D-LMR5** (was Q-LMR1) | `:338` | no offer step; the office Dispatch button sends | **Keep** — and remove Accept/Decline for McLeod loads (Q-MK4) |
| **D-FC0** | `roster/FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md:16, 375` | McLeod owns drivers, trucks, trailers, loads | **Keep ownership; add the write column**: McLeod still owns them, and 360 may edit the fields listed in D-MK2 *through the API* |
| **D-RL5** | `mcleod/ROSTER-LIFECYCLE-PLAN.md:152` | McLeod's hire is the hire; 360 does not hire | Re-rule per Q-MK11 |
| **Q-7** (a) | `FLEET-CENSUS...:537` | truck status read-only, "Set in McLeod" | Re-rule per Q-MK12 |
| **D-MR6** / `identity_source` claim | `MCLEOD-ROSTER-SYNC-PLAN.md:296` | an office edit claims the row and stops the sync | Re-rule per Q-MK13 |
| BOL **Q6** "default no" | `drivers-app/BOL-READING-RELIABILITY-PLAN.md:629` | nothing written into McLeod | Re-rule per Q-MK8 |
| CPM spec out-of-scope | `MCLEOD-CPM-DATA-SOURCE-SPEC.md:669` | "any write to McLeod" out of scope | Strike the McLeod clause |
| Money control out-of-scope | `maintenance/MAINTENANCE-MONEY-CONTROL-PLAN.md:294` | no writes to FleetPal, McLeod or EFS | Strike McLeod only; FleetPal and EFS stay out |
| Alex's terms | `mcleod/mail.md:36-42` | SELECTs only, nothing inbound | B-MK9 |
| TMS repo: dispatchers no `loads.create`; no McLeod writes before cutover | SILVICOM360-TMS `HANDOFF.md:80`, `RESEARCH-RESOLUTIONS.md` §126(7) | — | Owner rules separately for that repo; this plan does not touch it |

---

## 2. The driver-app research, checked against the code

The owner's research (2026-11-19) holds, with five corrections that change the plan:

1. **Accept/Decline can never work on a McLeod load.** Nothing sets a `source='tms'` load to `offered`
   (`packages/shared/src/mcleodLoadProjection.ts:136-149`); `driver_accept_load` only works from
   `offered` (`0141:122`). The only offered loads are gallery samples (`apps/driver/src/features/loads/sampleOffers.ts`).
   So the "offers" question is not open: D-LMR5 already ruled no offer step.
2. **A dispatched McLeod load is invisible to its driver until a stop departs.** Driver read policies
   allow `offered, accepted, in_transit, delivered, canceled` (`0371_load_driver_scope_reads_dispatch.sql:65-100`,
   `loadsLifecycle.ts:23-29`); a McLeod load that is dispatched but not started is `approved`.
3. **The sweep undoes load status, not stop facts.** `mirrorLoads.ts:54-77, 202` rewrites `loads.status`,
   `driver_id`, `vehicle_id`, `trailer_id` on every change, and the 0368 guard lets a tms load move to any
   status. But `load_stops.status/arrived_at/completed_at` are not in the stop upsert and survive; worked
   stops are never deleted (`mirrorLoads.ts:105-110`).
4. **Trucks and trailers on a load resolve by unit number, not by their McLeod id**
   (`mcleod/entityLookup.ts:63-73`), and an unmatched driver leaves `driver_id` null silently
   (`dispatchProjection.ts:69-75`).
5. **The rig pick list is every truck and trailer in the org** (`driver-app/dutySessions.ts:94-104`), not
   McLeod's assignment; and **driver workflows need no environment approval** — the hold is GitHub's
   "Approve and run" for the bot's pushes (memory `driver-release-lanes-need-approval`).

Also confirmed: `co_driver_id` exists on loads (`0493`) but no policy reads it; required photos are
hard-coded in two files (`mirrorLoads.ts:120`, `tmsLoadIngestWriters.ts:157`); the shared contract lacks
pickup number, references, customer, weight, pieces and McLeod's actual times (`loadsContract.ts:69-108`)
though the database has them (0366); `loads.pickup_number` is never written; load actions send no action
id and a replayed **decline** writes a second event; navigation is a dev-only sample; the app has never
run on a real phone and is in neither store (`RELEASE-GATE.md:128-139, 184-189`).

---

## 3. Open questions, with a proposed answer for each

**Q-MK1 — Where do API calls run?** (a) the on-prem agent on Alex's VM **pulls** queued requests from
our API over its existing outbound HTTPS and calls `/ws` on the LAN; (b) open an inbound path from AWS
into the LAN (site-to-site VPN) and call `/ws` from the API; (c) Cloud-Hosted Innovation Hub, called
straight from AWS. **Recommend (a)**: it keeps Alex's "nothing inbound" term, reuses the agent that is
already the only McLeod boundary (`MCLEOD-READ-ONLY-INTEGRATION-HANDOFF.md:331`), and needs no network
change. (c) is better long-term if the kit includes it (B-MK1); (b) is the most work and the most risk.

**Q-MK2 — Which facts may 360 write, field by field?** Recommend this table as **D-MK2**, each row live
only after its endpoint exists (B-MK1) and is proven on the test company (D-MK3):

| Fact | Written by | Into McLeod as | Phase |
|---|---|---|---|
| Stop arrival / departure | driver app | stop actual arrival/departure | MK3 |
| BOL / POD / lumper receipt / revised RC files | driver app, office | DocumentPower image on the order | MK4 |
| New driver at hire | office (hire step) | `PUT /drivers/create` | MK5 |
| Termination / rehire | office | driver update | MK5 |
| Truck / trailer in or out of service | office | tractor / trailer status | MK5 |
| Medical card / CDL expiry when 360 holds the scanned card | office | driver fields | MK5 |
| ETA | 360's computed ETA | stop ETA | MK6 |
| Home time | office | driver availability (Symphony or driver fields) | MK6 |
| Load create / edit / assign | **stays in McLeod** (D-MK4) | — | not planned |
| AP vouchers, tolls, deductions | **stays in McLeod** until accounting asks (D-MK5) | — | not planned |

**Q-MK3 — Whose stop arrival is the truth? (this answers Q-LMR2)** Recommend: **McLeod's value is the
truth once McLeod accepts our write**; the driver's tap is kept forever as evidence (who, when, where,
photo) in our own row. Until MK3 ships, stop actions are evidence only and **stop moving `loads.status`
for McLeod loads** (§4 N1) — that is the existing recommendation and it removes the "sweep undoes it" bug
without the API.

**Q-MK4 — Accept/Decline.** Already ruled (D-LMR5). Recommend: for `source='tms'` loads the app shows
no Accept/Decline; it shows the dispatched load and one **"Got it"** button that records an
acknowledgement event in 360 only (the office sees "seen by driver"). Writing that acknowledgement to
McLeod needs Symphony (B-MK8); not planned.

**Q-MK5 — Which loads does a driver see?** Recommend: a McLeod load is visible when the office has
dispatched it (`auth_dispatched_load_ids()`, already required) **and** `driver_id` or `co_driver_id` is
the driver, in statuses `approved, in_transit, delivered, canceled`. This answers **Q-LMR4** (team loads)
with the column that already exists; no `load_drivers` table.

**Q-MK6 — The write pipeline's states.** Recommend **D-MK1**: one append-only table of write requests
(new table; RLS on, no client policies), one row per intent, keyed by the **client action id** the phone
already generates for its outbox. States: `queued → sent → confirmed | refused | conflict`. `conflict`
= McLeod's record changed since the request was made (dispatch changed the load while the phone was
offline) — shown to the office, never retried blindly. `refused` stores McLeod's message and a plain
reason for the driver's failed list. Our evidence row is written first and never depends on McLeod.

**Q-MK7 — How do we test writes?** Recommend **D-MK3**: no write runs against the live company until it
has passed on a McLeod test company (B-MK5). If McLeod cannot give one, the owner rules whether the
first write may run live on one named test driver/load.

**Q-MK8 — Documents into McLeod (re-rules BOL Q6, answers BOL Q9 and Q-LRC10's fallback).** Recommend:
when B-MK1 shows a DocumentPower upload, driver photos and office files go to the order through it, with
our document types mapped to McLeod's image categories (`imapcats`) in one table. Reading revised RCs
moves from route (b) (the `dta` grant, ruled 2026-11-18, not yet run) to route (a) the API **only if** the
API exposes it; until then (b) stands. If there is no upload service, the fallback stays the clerk packet.

**Q-MK9 — Required photos per stop.** Recommend: one shared constant in `@silvicom/shared`, read by
both writers (today hard-coded twice). No settings screen until an owner names a stop that needs a
different list.

**Q-MK10 — Rig check-in.** Recommend: list McLeod's assigned truck and trailer for the driver's
current load first, then everything else (no write). Writing the pairing to McLeod stays out: D-TL1
(planned = McLeod, physical = GPS) still holds.

**Q-MK11 — New hire into McLeod (re-rules D-RL5).** `PUT /drivers/create` is the one write that is
publicly documented. Recommend: after the hire step, 360 **creates** the McLeod driver with the fields
McLeod requires, then links it; Alex no longer types it. Needs: McLeod's required-field list for
`drivers/create` (B-MK1) and the owner's re-ruling. Removes the 1–3 day lag and the "new truck shows
unassigned" path.

**Q-MK12 — Truck/trailer status (re-rules Q-7).** Recommend: the status field becomes editable again
for McLeod-linked units and **writes McLeod's status**; the sweep then brings it back. No `status_source`
column needed, because there is one writer (McLeod) and we only ask it to change.

**Q-MK13 — Office edits to McLeod-owned driver fields (re-rules D-MR6).** Recommend: for the fields in
D-MK2, an edit writes McLeod and does **not** claim the row; the row stays in sync. Fields McLeod does
not hold stay 360-only as today.

**Q-MK14 — Medical card / CDL when sources disagree (extends D-MSUX7).** Recommend: when 360 holds a
scanned card that wins under D-MSUX7, offer the office a one-click "update McLeod", never automatic.

**Q-MK15 — Money writes.** Recommend **D-MK5**: none in this plan. AP vouchers from FleetPal bills,
toll postings per truck, PrePass reclass and deductions change the books; they wait until accounting
asks and B-MK1 shows the endpoints. The kit's **read** side for finance (ending the frozen restore,
D-PREC12) is MK2 and is wanted now.

---

## 4. Build now — needs no API (each still needs the named ruling)

| Step | What | Ruling it needs |
|---|---|---|
| **N1** | `driver_complete_stop` stops writing `loads.status` for McLeod loads; the app reads stop state for its own UI | Q-MK3 / Q-LMR2 |
| **N2** | Driver visibility: `approved` dispatched loads, and the co-driver (`co_driver_id`) | Q-MK5 |
| **N3** | Hide Accept/Decline on McLeod loads; add "Got it" acknowledgement | Q-MK4 |
| **N4** | Shared contract: pickup number, references, customer, weight, pieces, McLeod actual arrival/departure beside the driver's | none (fields exist in 0366) — `pickup_number` waits on Q-LMR5's PU half |
| **N5** | Required photos: one shared constant | Q-MK9 |
| **N6** | Load trucks/trailers resolve by McLeod id first, unit number second; unmatched driver raises an office exception, not a silent null | none |
| **N7** | Outbox sends the client action id on load actions; decline becomes idempotent | none |
| **N8** | Rig pick list puts the load's assigned truck/trailer first | Q-MK10 |
| **N9** | Dispatch board shows the driver's arrival where McLeod's is empty (`truckLoadPlanReads.ts:156` reads McLeod's only) | none |

## 5. Build with the API Kit, in order

| Phase | What | Needs |
|---|---|---|
| **MK0** | Enable `/ws`; integration user + token; agent can call it; `GET /api/version`-style health line for the McLeod API | B-MK2, B-MK3, B-MK4, B-MK9, Q-MK1 |
| **MK1** | **Read parity**: agent reads movements through the API beside SQL for 7 days; numbers compared; SQL retired per table only when equal | MK0, B-MK6, B-MK7 |
| **MK2** | **Finance through the API** — the live GL/AP/settlement reads that end the frozen `lme_analytics` restore (D-PREC12, Finance v2 F0, truck P&L P1, Q-FR2-3/4, fuel_detail F12b) | MK1, B-MK1 shows those services |
| **MK3** | **First write: stop arrival/departure** from the driver app, through the D-MK1 pipeline, on the test company first | N1, N7, Q-MK2, Q-MK6, D-MK3, B-MK5 |
| **MK4** | Documents into DocumentPower (driver BOL/POD; lumper receipt; revised RC) | Q-MK8, B-MK1 |
| **MK5** | Office writes: new hire, termination/rehire, truck/trailer status, medical/CDL | Q-MK11..14, B-MK1 |
| **MK6** | ETA write; home time | D-DB4's 14-day measurement; B-MK8 for home time |

**Driver screens the API enables (each its own small plan after MK3):** detention and lumper report
(feeds the lumper case, D-LRC3), fuel receipt photo (D-IP7: the uploaded file wins), roadside repair
request (feeds the roadside flow), home-time request, ETA, real navigation on McLeod's stops.

## 6. Not McLeod — but gates any of this reaching a driver

- The driver app has never run on a real phone and is in neither store; the Apple account is
  Individual (`RELEASE-GATE.md:128-139`). Runs in parallel with N1–N9.
- Dispatch by SMS is blocked by consent (Q-LMR9) and a Telnyx number, not by McLeod.
- Creating the Samsara driver at hire needs a Samsara write token (ours is read-only).

## 7. Decisions

| ID | Decision | Status |
|---|---|---|
| D-MK1 | One append-only write-request table, keyed by the client action id; states queued/sent/confirmed/refused/conflict; our evidence row first | proposed |
| D-MK2 | Field-by-field write list (Q-MK2 table) | proposed |
| D-MK3 | No live write before it passes on a McLeod test company | proposed |
| D-MK4 | Loads are still created, edited and assigned in McLeod | proposed |
| D-MK5 | No money writes in this plan | proposed |

## 8. Progress log

- 2026-11-19 — Plan written from the code at `2e1527c68`, every McLeod plan and memory. Nothing built.
  Next: owner rules Q-MK1..15 and §1; one request to McLeod (B-MK1..8, B-MK10) and one to Alex (B-MK9).
