# Load detail page — audit and plan (2026-08-07)

Prerequisite for the hazmat consolidation (`docs/plans/hazmat-consolidation/HAZMAT-IA-PLAN.md`), which
needs somewhere for the hazmat workspace to open into. Read alongside
`docs/plans/dispatch-loads/LOADS-{AUDIT,DECISIONS,PLAN}.md` — this does not replace them; L0–L6 still
stand and LD0 below is L0.

## 1. Corrections to what we thought we had

- **`LoadsPage.vue` is dead code.** `router/index.ts:49-65` sends `/loads`, `/loads/new` **and
  `/loads/:id`** to `DispatchLoadsPage.vue`. `LoadsPage.vue` (267 lines) has no importer, nor does its
  `features/dispatch/LoadForm.vue`, nor `DispatchAssignmentsPage.vue`, nor the duplicate
  `composables/useDispatchLoads.ts`. That is finding F4 of the loads audit, still unremediated.
- **A detail surface already exists** — `LoadDetailPanel.vue` (278 lines) in a `SlideOver`, reached
  from `/loads/:id`. It renders ref, status, hazmat, equipment, the driver/truck/trailer block with
  inline reassign, the full approval checklist, the stop list with `required_photos` slot pills, a
  history timeline, and the action rail. The work is not "build a detail view from nothing"; it is
  "give it a point-read, a page, and the data it is currently missing".

## 2. Three defects found on the way, one of them severe

**F-LD1 (severe) — the four driver load RPCs have three different signatures across the repo.**
`0087_load_lifecycle.sql:307` defines `driver_accept_load(p_load uuid, p_occurred_at timestamptz)` and
derives the driver from `auth_driver_id()`. `services/driverLoads.ts:167,189` calls it with
`{p_org, p_driver, p_load, p_actor_user, p_occurred_at}`. `supabase/tests/load-lifecycle.test.mjs:111`
calls it positionally with three and four arguments. The same drift affects `driver_decline_load`,
`driver_start_load` and `driver_complete_stop`. `driverLoads.ts:26-34` also maps SQLSTATEs
`DL001/DL002/DL003/DL005/DL006` that `0087` never raises, and does **not** map `DL404`, which it does.

Read against the migration as written here, **every driver load mutation would fail** — either
"function does not exist" from the argument mismatch, or `42501 not a driver` because the service
role's `auth_driver_id()` is null. Either the deployed database carries a newer function body than the
repository does, or the driver write path is broken. This is not in `LOADS-AUDIT` and it must be
resolved before anything is built on top of it.

**F-LD2 — the history timeline is silently empty.** `dispatchLoads/queries.ts:55` selects
`"… , drivers(full_name)"` from `load_events`. `load_events` has no foreign key to `drivers` — its
actor column is `actor_user_id → auth.users` (`0087:117`) — so PostgREST cannot resolve the embed.
Line 53 destructures only `{ data }` and discards `error`, so `listEvents` returns `[]` and the panel
renders "No history yet." Every load, always.

**F-LD3 — `assignLoad` has no status gate.** `POST /loads/:id/assign` writes driver, vehicle and
trailer without touching `status`, so it never trips `loads_status_guard`. A `delivered` or `canceled`
load can be reassigned. `LoadDetailPanel.vue:60` hides the button client-side only.

## 3. What the office cannot see today

Everything in this list is already captured, already stored, and already returned by an API — and
discarded before it reaches a screen.

| Data | Where it lives | Why it is invisible |
| --- | --- | --- |
| **Stop photos** | `load_stop_photos` + bucket `load-photos`; dispatch has SELECT on both | Nothing in `dispatchLoads/` or `apps/web` reads either. The panel renders `required_photos` — what was *asked for* — never a captured image. This is F1 of the loads audit and D-L1 of its decisions. |
| Per-stop progress | `load_stops.status`, `arrived_at`, `completed_at`, `skip_reason`; all in `STOP_COLUMNS` | The panel renders none of them. The driver's D21 free-text explaining a missing BOL reaches the database and never reaches the office. |
| Lifecycle provenance | `submitted_at`, `approved_by/at`, `released_at`, `assigned_by/at`, `accepted_at`, `completed_at`, `decline_reason` — all on the wire from `GET /loads` | The `DispatchLoad` TS interface (`useDispatchLoads.ts:43-65`) simply omits them. "Who approved this, and when" is only inferable from an events list that returns nothing (F-LD2). |
| TMS amendment diff | `load_events.payload.diff`, both sides of every changed field | No UI reads it. |
| Equipment mismatch, amendments, auto-timeout shifts | `load_events` kinds `equipment_mismatch`, `amended`, plus D44.5 | F2 of the loads audit; needs the exceptions endpoint from D-L2 / L2. |

## 4. What is not captured at all

Not gaps in the UI — gaps in the product. Each is a decision, not an oversight to fix quietly.

- **No signature capture** anywhere in the schema or the driver app. A signed POD is the single most
  requested artifact in dispatch software and we do not have one.
- **No arrival geolocation, no departure timestamp, no per-stop odometer.** `load_stops` has
  `arrived_at` and `completed_at` only, both server-stamped from the driver's `occurred_at`. A detail
  page cannot show *where* the driver was when they marked arrived.
- **No document attachment on a load** — `load_stop_photos` is images-only. No rate confirmation, no
  BOL PDF, no signed POD. `hazmat_documents` is the nearest precedent.
- **No `loads ↔ duty_session` link.** There is no `duty_session_id` column, despite
  `DRIVER-APP-PLAN.md:107` claiming 0087 added one. Attributing a load to the truck the driver was
  actually in needs a time-range join through `driver_duty_sessions` → `duty_equipment_segments` on
  `driver_id`, which nothing does.
- **No `loads ↔ tms_movements` link**, so reefer and temperature context for an ingested load is
  unreachable from the load.
- **TMS `external_status` and `raw` are dropped on the floor** — validated by the schema, never
  persisted. The page cannot show "McLeod says this order is DLVD", and there is no original record to
  reconcile against. Note `tms_movements` *does* keep `raw`.
- **`POST /api/tms/loads` has no producer.** `tools/mcleod-agent/agent.mjs` calls only
  `/api/tms/movements` and `/api/tms/driver-time`. The entire load-ingest path is untested against a
  real TMS.

## 5. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D-LD1 | `/loads/:id` becomes a real page, not a slide-over over the list cache. | A drawer cannot deep-link, cannot refresh without loading every load in the org, and goes stale whenever the list query does. The hazmat workspace needs a host that survives a page reload. |
| D-LD2 | Add `GET /api/dispatch/loads/:id` returning the load, its stops, per-stop photos with signed URLs, the event history with resolved actors, and every lifecycle timestamp. | Today the "detail" is a `.find()` over `GET /loads`, which returns every load in the org with every stop nested, unpaginated. That is the only reason the page cannot exist. |
| D-LD3 | Resolve F-LD1 before any of this is built. | If the driver RPCs are broken in production, the detail page would be a window onto data that never arrives. |
| D-LD4 | Photos are signed in batch server-side (`createSignedUrls(paths, 300)`), reusing `hazmatLoads.ts:189`. | The pattern exists, is proven, and keeps originals unreachable without an API-issued URL. Re-deciding it would be a second way to do the same thing. |
| D-LD5 | Load↔duty attribution is **derived**, not stored, until a case forces otherwise. | A `duty_session_id` column has to be written by someone at the right moment and will be wrong the first time a driver swaps trucks mid-load. A time-range join is always correct and costs a view. |
| D-LD6 | TMS `external_status` and `raw` are persisted. | We already do this for `tms_movements`. Dropping the source record makes every future reconciliation question unanswerable. |
| D-LD7 | Signature capture, arrival GPS and departure time are **out of scope here** and tracked as product decisions. | Each changes the driver's flow and the privacy story. They should not arrive as a side effect of a dashboard page. |

## 6. Plan

### LD0 — Unblock (this is L0, plus the two defects above) — **DONE 2026-08-07**

All four matrices now run in `pnpm test:rls`: **159 + 16 + 42 + 20 = 237 assertions, 0 failures.**

Repairing the harness turned it into the specification nobody had read. The lifecycle matrix called
the driver RPCs *exactly* the way `driverLoads.ts` does and expected precisely the error codes the API
maps — independent confirmation that the service was right and `0087` was the outlier, not a judgement
call. It then failed on six behaviours it asserts and nothing implemented:

| Found by | Built in | What it was |
| --- | --- | --- |
| F-LD1 | `0141` | The four driver RPCs, re-signed to `(p_org, p_driver, p_load, p_actor_user, …)` with the ownership check made explicit. The old versions could never have run from the service role. |
| matrix | `0141` | `loads.duty_session_id` + D47: accepting in a different truck stamps the shift, writes an `equipment_mismatch` event, and does **not** overwrite dispatch's plan. Documented in `driverLoads.ts` since Phase 3B, never possible. |
| matrix | `0141` | Owner-operator decline clears `released_at`; a replayed stop sync is a no-op rather than an error (the outbox retries). |
| matrix | `0141` | D21 enforced server-side: finishing a stop without a required photo, or skipping one, requires a reason. The rule had lived only in the app. |
| matrix | `0142` | **Separation of duties** — `organizations.require_separate_approver`, off by default. Maker-checker on the object that commits a truck and a delivery promise. |
| matrix | `0142` | An approval must record `approved_by`; `submitted_at` and `approved_at` stamped by the guard rather than by whichever caller remembers. |
| matrix | `0143` | Duty error codes realigned to the `DG001`–`DG005` the API maps and tests. Plus **DG005**: the equipment a driver checks into must belong to their organization — never checked, and RLS is not in that path. Plus: a no-op equipment change no longer shreds the segment timeline. |

F-LD2 (history silently empty) and F-LD3 (terminal loads reassignable) are fixed in
`dispatchLoads/queries.ts` and `mutations.ts` respectively.

- Repair `load-lifecycle.test.mjs` and `duty-sessions.test.mjs` (stale migration filenames:
  `0083_driver_identity` → `0083_driver_rls_matrix`, `0084_driver_scoped_rls` → `0084_driver_rls_writes`,
  `0016_vehicle_fuel_level` → `0016_driver_samsara_idx`) and wire all four matrices into `test:rls`.
  The ledger has been quoting "lifecycle 42/42" and "duty 20/20" for months without either running.
- **Resolve F-LD1.** Dump the deployed function signatures, reconcile `0087`, `driverLoads.ts` and the
  matrix onto one contract, and add a service test that calls each RPC the way the API does.
- Fix F-LD2 (resolve the event actor without a non-existent embed, and stop discarding the error).
- Fix F-LD3 (gate `assignLoad` on non-terminal status, server-side).

Nothing else starts until the matrices run green.

### LD1 — The point-read endpoint (D-LD2) — **DONE 2026-08-07**

`GET /api/dispatch/loads/:id` → `{ load }` carrying stops (each with its captured photos), the event
timeline with resolved actors, and every lifecycle timestamp. `canView` roles, `Cache-Control:
no-store` because the photo URLs expire in five minutes.

`apps/api/src/services/dispatchLoads/detail.ts`, with `detail.test.ts` alongside (D-L7). Notes:

- **Photos are signed in one batch call**, 300-second TTL, the same shape `hazmatLoads.ts:189` uses. A
  per-photo round trip makes a twelve-stop load unusable; long-lived URLs put proof-of-work images one
  leaked link away from public.
- **Storage failure degrades to `url: null`**, it does not fail the request. Storage is the least
  reliable dependency in the path and the stops, timeline and checklist are still worth showing. Same
  for the photo table read itself.
- **The org boundary is a filter on every read**, not a check afterwards. Asserted in the tests.
- Stops, photos and events are fetched concurrently; only the load read is sequential, because it is
  what proves the organization owns the id.

### LD2 — The page (D-LD1) — **DONE 2026-08-07**

`apps/web/src/pages/DispatchLoadDetailPage.vue`, on the LD1 point-read. `/loads/:id` now routes to it
with `meta.parent: "/loads"`, so AppShell supplies the back chevron and the H1 — the page adds neither.

Sections, in the order dispatch asks for them: summary with the action rail; **Progress** (the
provenance strip — every stage the load actually reached, with its time); approval checklist; stops;
history. Editing moved onto this page (`?edit=1`), because editing one load from a board was only ever
a consequence of detail being a drawer.

Two things landed here that were meant for LD3 and made no sense to defer once the page existed:

- **Per-stop truth.** Each stop shows its real status, arrival and completion times, and the driver's
  free-text note. Required photo slots render green when captured and amber when still outstanding, so
  the gap dispatch chases is visible without opening anything.
- **The photos.** Thumbnails under each stop, from the batch-signed URLs. Captured since `0085`,
  stored the whole time, and never once shown to the office.

**Deliberately not a lightbox.** `D-L1` said thumbnail row *plus* lightbox; there is no modal or
dialog primitive in this design system, and inventing one is precisely the mistake the hazmat pages
made. A thumbnail opens the full-size image in a new tab, which is also what someone saving a bill of
lading actually wants. If a lightbox is wanted later it should be designed as a shared component
first.

**Five files deleted** (D-L4), all verified to have no remaining importer:
`pages/LoadsPage.vue`, `features/dispatch/LoadForm.vue`, `pages/DispatchAssignmentsPage.vue`,
`composables/useDispatchLoads.ts` (the drifted twin), and `features/dispatch/LoadDetailPanel.vue`,
which the page supersedes. The board no longer imports any single-load mutation.

`vue-tsc` clean; design-token and token-parity gates pass.

### LD3 — Photo states and evidence verification — **DONE 2026-08-07**

LD2 absorbed the thumbnails and per-stop truth. What remained was making the photos *legible* and
making the evidence *verifiable*, and both are now done.

**Legible.** Photos are grouped by the slot that was ASKED for, not shown as a flat row. A flat row
cannot answer the only question that matters — "is the bill of lading there?" — because a stop with
three seal photos and no BOL looks busy while missing the one thing anyone will ask for. Every required
slot gets a row whether or not it was captured; anything the driver shot outside the asked-for slots is
grouped as `· extra` rather than dropped. A finished stop with outstanding required slots carries a
count badge in its header, so the board question is answerable without reading each group.

"Not captured" and "Not captured yet" are different strings on purpose: before a stop is finished, an
empty slot is a schedule, not a gap.

**Verifiable.** Two independent detections, because a signed URL is signed over a *path* — Storage
issues one happily for an object that no longer exists, and the browser is the first thing that finds
out:

- Client-side, a failed image load renders **"Image missing"** in danger tone rather than an empty
  frame. A dead thumbnail reading as "no photo taken" is a different and much more comfortable claim
  than the true one.
- Server-side, `load-photos` now has a reconciler. It never had one: nothing checked that a photo the
  office can see a row for still exists. `storageReconcile.ts` was generalised from hazmat-only to
  `reconcileBucketOrphans(bucket, table)`, with thin wrappers for both, and the nightly scheduler now
  runs both buckets — independently, so a failure on one cannot skip the other. Rows are flagged, never
  deleted: a row is the claim that evidence exists, and losing the claim silently is worse than losing
  the bytes.

Still open: photo retention (`LOADS-PLAN` question 1). `load-photos` is backed up and never expired.

### LD4 — Exceptions, amendments and the change producer — **DONE 2026-08-07**

`GET /api/dispatch/exceptions`, event-driven per D-L2, with all five sources: declines, aging
approvals, `equipment_mismatch` (D47), `amended` (D48) and `load_changed` (D-L8) — plus auto-closed
shifts from `driver_duty_sessions`.

**Why it had to move to the server.** The `isException()` it replaces derived from `loads` columns, so
it could only ever see two of the five: a decline and an aging approval. Equipment mismatches, TMS
amendments and post-release changes exist *only* as events — the tab whose entire purpose is showing
what needs attention was blind to three fifths of it. Reading the event log also makes the feed
complete by construction: a new event kind appears rather than being excluded by a filter nobody
widened.

**Two event kinds the plan specified and the schema forbade.** Migration `0145` widens
`load_events_kind_check`, which would have rejected both:

- **`load_changed`** (D-L8) — emitted when a **released** load's driver-visible facts change, with the
  before-and-after of each. Scoped deliberately: equipment, commodity, hazmat, miles and the stop list;
  never notes or billing refs. Emitting on every field would train drivers to ignore the category,
  which is worse than not emitting.
- **`exception_resolved`** (D-L2) — how an append-only log closes an exception. `load_events` is what
  an auditor reads, so an exception is closed by a later event naming it, never by editing history. The
  payload carries the id resolved, the action taken and who took it.

Also added an `(org_id, kind, occurred_at)` index: the feed reads by kind across the whole org, which
the existing per-load index cannot serve.

On the board, Exceptions is now its own table rather than a filter over the loads list — three of its
sources have no load row to filter. Each row states what happened, which load, which driver, when, and
the one action that clears it.

### LD5 — Context (D-LD5, D-LD6)

A duty view joining `driver_duty_sessions` × `duty_equipment_segments` by driver and time range, so the
page can say which truck and trailer the driver was actually in for each stop. Persist TMS
`external_status` and `raw`, and surface both.

### LD6 — Hazmat host

The hazmat workspace opens as a section on this page (`HAZMAT-IA-PLAN.md` H-C1), once `hazmat_loads`
carries its nullable `load_id`.

## 7. Open questions

1. **Signature and POD** — is a signed proof of delivery in scope for the pilot? It is the most common
   reason a shipper rejects an invoice, and adding it later means re-touching the stop capture flow.
2. **Arrival geolocation** — capturing where the driver was when they marked arrived is straightforward
   and is also location tracking. Worth a deliberate decision, including what drivers are told.
3. **Photo retention** — still open from `LOADS-PLAN` question 1. `load-photos` is backed up, never
   expired and never swept for orphans; only the `hazmat` bucket has a reconciler.
4. **TMS load ingest has no producer.** Do we build the McLeod loads puller now, or does the pilot run
   on manually created loads?
