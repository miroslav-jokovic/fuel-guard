# Which trailer is on which truck: one source per question

Written 2026-10-19 from an audit the owner asked for ("how precise are the trailer connections to
trucks, and what is our source"). Owner's ruling the same day: *proceed as proposed* — **McLeod for
anything about planning, GPS for what is physically hooked up** (D-TL1). Item 2 of that proposal,
running the GPS pairing on a schedule, was **not** taken; §4 says what that leaves open.

## 1. Two sources, measured (production, 2026-10-19)

| Source | Field | Written by | Fresh |
|---|---|---|---|
| **McLeod**: the trailer dispatch put on the load | `loads.trailer_id` | McLeod `continuity` row with equipment type `L` on the movement (`tools/mcleod-agent/queries.mjs` `DISPATCH_LOADS_SELECT`), resolved by unit number in `mcleod/dispatchProjection.ts` | Every dispatch sync (minutes) |
| **Samsara GPS**: the trailer tracker that travels with a truck | `trailers.assigned_vehicle_id`, `pairing_source = 'inferred'` | `samsara/trailerPairingSync.ts` (0.25 mi, 10 min, ≥ 8 co-samples, ≥ 60 % share, 5-day window). Samsara's assignment feed returns nothing for this org | **Only when someone presses the manual trailer sync** (`sync_trailers`; no scheduler). The last job found was 2026-08-04, and `trailers.updated_at` peaks at 2026-09-08 |

On the 114 trucks whose current load carries a trailer:

- 12 agree;
- 72 have GPS naming another truck;
- 30 have the load's trailer GPS-unpaired;
- 13 of the load trailers have no gateway, so GPS can never pair them.

Separately, 19 trucks have two or more trailers GPS-paired.

**Reefers** (45 active, 34 GPS-paired): **0 of the 17** reefers on a current load are GPS-paired to that
truck. 15 trucks are GPS-paired to a reefer while their load's trailer is a dry van.

## 2. Every reader, and its source under D-TL1

| Reader | Question it answers | Source today | Under D-TL1 | Step |
|---|---|---|---|---|
| Dispatch board, Loads, truck drawer | Which trailer is on this load | McLeod | McLeod (unchanged) | — |
| Live map route + its fuel stops (`loadPlanningTruck` from `liveMapLoadRoute`) | Does this load burn reefer fuel | GPS | **McLeod: the load's trailer** | **TL1 (this PR)** |
| Fuel planner (`planFuelRoute`, no load) | Same, for a typed trip | GPS, or the planner's own equipment choice | McLeod: the truck's current load; GPS only for a truck on no load | TL3 (built) |
| Trailers page "Paired tractor" | Where is this trailer | GPS | Both, labelled: *On load (McLeod)* and *GPS pairing*, with its age | TL4 |
| Reefer coverage page | Which trucks physically pull a reefer | GPS | GPS (physical), shown with its age | TL4 |
| Fuel anomaly scoring: reefer tank size, reefer-diversion rule (`anomalies/scoring/context.ts`) | Was a reefer on this truck at the fill | GPS, **current state judged against past fills** | Open: Q-TL1 | — |
| Anomalies page trailer list (`useAnomaliesPage`) | Context for an alert | GPS | Follows Q-TL1 | — |

## 3. Decisions

- **D-TL1 — One source per question** (owner, 2026-10-19). Anything about what dispatch planned reads
  McLeod's load. Anything about what is physically hitched reads the GPS pairing, and says how old it
  is.
- **D-TL2 — A load's reefer is its trailer's.** A caller that plans a load passes the load's own
  trailer (`LoadForRoute.trailerIsReefer`) into `loadPlanningTruck`, and the GPS pairing is not read.
  A load with no trailer is not a reefer: 5 of 119 current loads, 2026-10-19.

## 4. Open questions

- **Q-TL1 — Fraud scoring's reefer context.** The reefer-tank capacity and the reefer-diversion rule
  ask "was a reefer on this truck *when it fuelled*", and answer from today's GPS pairing, which is
  two months stale. In the last 30 days, 287 tractor fills and 138 reefer fills were scored this way.
  Candidates:
  (a) McLeod's movement for that truck at the fill's time (`mcleod_movements.trailer_unit`, 27,484
  movements carry one). This is the trailer dispatched then, the only one of the three that is
  historical.
  (b) The GPS pairing, kept fresh by item 2's scheduler.
  (c) Leave it.
  *Recommend (a).* It changes which fills raise reefer alerts, so it ships with a re-score dry run
  that counts alerts gained and lost (the same care as a weight change), and the owner sees the counts
  before it merges.
- **Q-TL2 — GPS freshness.** D-TL1 sends the "physically hooked up" readers to a pairing that only a
  button refreshes. Until that runs on a schedule, those screens should show the pairing's age, so
  nobody reads a two-month-old pairing as today's. *Recommend running the pairing once a day in the
  scheduler fleet* (`docs/WORKER-DEPLOYMENT.md`) when the owner is ready. Until then TL4 shows the age.

## 5. Steps (one PR each)

- **TL1** — The live map's route and fuel stops take the reefer from the load's trailer (D-TL2).
- **TL2** — Record when a pairing was last seen to hold (`trailers.pairing_confirmed_at`, migration 0488), so TL4
  can show its age. The writers that set it ship in the next merge (`lint:migration-ordering`).
- **TL3** — The fuel planner reads the truck's current McLeod load, through a new `routing -> loads`
  edge (it has none today, so TL1 does not reach it).
- **TL4** — Trailers page: *On load (McLeod)* beside *GPS pairing (as of …)*. Reefer coverage shows the
  pairing's age.
- **TL5** — Q-TL1, once ruled.

## 6. Progress log

### 2026-10-19 — Audited, ruled, TL1 built

Measured as in §1. Owner ruled D-TL1. TL1 is in this PR. Q-TL1 and Q-TL2 wait on the owner.

### 2026-10-19 — Rulings on the open questions; TL2's migration

Owner: *"proceed as proposed"*. So **Q-TL1 (a)**: fraud scoring reads McLeod's movement at the fill's
time, built with a re-score dry run whose alert counts the owner sees before it merges. **Q-TL2**: the
GPS pairing runs once a day in the scheduler fleet.

TL2's migration is 0488, `trailers.pairing_confirmed_at`. The name says "confirmed", not "paired":
the daily run re-confirms each pairing it still finds, and its age is what a reader needs. A person's
change is dated by trigger, since the Trailers form writes from the browser. There is no backfill:
`updated_at` would date a two-month-old pairing to the last roster write.

Found on the way (**Q-TL3**, open): the Trailers form never sets `pairing_source = 'manual'`. So a
pairing a person chose there is overwritten by the next inference, though both writers mean to skip
manual pairings. *Recommend* the form marks its own pairing manual, in TL4.
### 2026-10-19 — TL3: the fuel planner reads the truck's current load

`planFuelRoute` asks `loads.readTruckLoadTrailer` for the load the truck is hauling now, chosen by the
map's rule (`isLoadOnTruck`, then `compareLoadsOnTruck`). That load's trailer decides reefer burn. A
truck on no load still falls back to its GPS pairing, since nothing else says what it pulls. The
planner's own equipment choice ("reefer") still adds reefer burn. This is the first `routing -> loads`
edge: one narrow reader, and `loads` imports nothing from `routing`.
