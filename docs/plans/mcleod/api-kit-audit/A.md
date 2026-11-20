# Audit of spec A — `docs/plans/mcleod/api-kit-specs/A-driver-loads.md`

Audited read-only against `/Users/miroslavjokovic/Projects/FG-mcleod-api` at `22f3f0540` (spec was
written at `cc590a62b`). Latest migration on disk: `0636_toll_plazas_and_observations.sql`.
Spec line numbers below are the spec file's own line numbers.

---

### A-1 [OK-with-note] — C1: both stop writers delete pending stops and re-insert them
- Spec says (line 27): "Both stop writers DELETE every `pending` stop of the load and re-INSERT it … `mirrorLoads.ts:102-128`; `tmsLoadIngestWriters.ts:123-164`"
- Evidence: `apps/api/src/modules/loads/mirrorLoads.ts:102-128` (`writeStops`: `.delete()…eq("status","pending")` at 105-110, then `.upsert(…, { onConflict: "load_id,seq" })` at 124). `apps/api/src/modules/mcleod/tmsLoadIngestWriters.ts:123-164` (same shape, delete 132-137, upsert 162). Both line ranges are exact.
- Note: the trigger is "every time the agent posts the movement, or the relink pass re-projects it" (`dispatchProjection.ts:98`, `:125-166` relink pass every few minutes). So churn also happens on a relink with no McLeod change — add "and every relink re-projection (`relinkDispatchMovements`, `dispatchProjection.ts:125-166`)" to C1, which strengthens the case.
- `policy.ts:99-101` is at `apps/driver/src/data/policy.ts:99-101` (spec gives no directory; add it). 404 is non-transient (`policy.ts:42-46`), so `dead` is correct.

### A-2 [OK] — C2: raw stop id column and projection mapper
- Spec says (line 28): "`mcleod_dispatch_stops.stop_id`, char 32, `0364:113-117`; projection drops it (`mcleodLoadProjection.ts:207-229`)"
- Evidence: `supabase/migrations/0364_mcleod_dispatch_raw.sql:113` `create table if not exists mcleod_dispatch_stops (`, `:116` `stop_id text not null, -- stop.id, char(32)`. Raw PK is `(org_id, company_id, stop_id)` (`0364:145`) — note this: the stop id is unique per COMPANY, not per movement, and a stop's `movement_id` is a mutable column. `mcleodLoadProjection.ts:207-229` is the `projected.push({...})` with no stop id. `ProjectedStop` is `:57-78` exactly. `external_id = ${company_id}:${movement_id}` at `:240`, `ref: m.order_id` at `:241`. Correct.

### A-3 [IMPRECISE] — C5 / §3.3: `isStopBehindTruck` line numbers
- Spec says (lines 31, 322): "`isStopBehindTruck` (`loadBoard.ts:191-193`)"
- Evidence: `packages/shared/src/loadBoard.ts:192-194` `export function isStopBehindTruck(stop: RouteStop): boolean { return DRIVER_DONE_STOP_STATUSES.includes(...) || mcleodStopDeparted(stop.external_status); }`; `nextStopOnRoute` `:197-200` ✓.
- Fix: cite `loadBoard.ts:192-194`.
- Also correct: `loadBoard.ts:1` imports `DRIVER_DONE_STOP_STATUSES` from `loadsContract.js`, so moving `nextStop` onto `isStopBehindTruck` inside `loadsContract.ts` WOULD create a `loadsContract ↔ loadBoard` cycle; the new-file rationale (§3.3) is grounded.

### A-4 [OK] — C5 `nextStop` comment
- Spec says (line 31): "`loadsContract.ts:163-174`"
- Evidence: `packages/shared/src/loadsContract.ts:163-174` — the comment "whether McLeod's departure should finish a stop in the driver app is Q-LMR2 … still open" and `nextStop`. Exact. `loadBucket/nextStop/stopProgress` are `:153-182` (spec line 319 says `:152-188`; 183-188 is `missingPhotoSlots`, which the spec does not say it moves — state "`:152-182`; `missingPhotoSlots` stays").

### A-5 [OK] — `driverLoads.ts` citations
- Spec says (lines 155, 245-251, 312, 333, 372-374): `loadsDispatchedTo :79-106`, `getDriverLoads :115-132`, `LOAD_COLUMNS :67-69`, `STOP_COLUMNS :71-73`, `PG_TO_API :39-47`, comment `:108-114`, `DRIVER_VISIBLE_STATUSES :3,126`, `accepted_at :68,239`, actions `:229-277`.
- Evidence: `apps/api/src/modules/loads/driverLoads.ts` — all exact (doc comment of `loadsDispatchedTo` starts at 79, function 85-106; `.in("status",[...DRIVER_VISIBLE_STATUSES])` at 126; `p_occurred_at: input.accepted_at` at 239).

### A-6 [OPEN] — "Rulings this spec treats as taken (owner, 2026-11-19)" are not recorded as ruled anywhere in the repo
- Spec says (lines 8-14): "Rulings this spec treats as taken (owner, 2026-11-19): … (Q-MK3) … (Q-MK4) … (Q-MK5) … (N7)."
- Evidence: `docs/plans/mcleod/MCLEOD-API-KIT-PLAN.md:137-158` states Q-MK3..Q-MK6 as "Recommend:", `:243` "D-MK1 … | proposed", `:251-252` progress log "Nothing built. Next: owner rules Q-MK1..15 and §1". No other doc in `docs/plans` records a ruling on Q-MK3/4/5 (grep). `LOADS-MIRROR-PLAN.md:403-410` still lists Q-LMR2 and Q-LMR4 as open.
- Fix: before the first merge, append a progress-log entry to `MCLEOD-API-KIT-PLAN.md` §8 (and `LOADS-MIRROR-PLAN.md`'s log, closing Q-LMR2 and Q-LMR4) recording the owner's ruling verbatim with date, and mark D-MK1 ruled with C4's amended wording. Until that line exists, spec A's header must say "rulings PROPOSED; build blocked on them" — the spec cannot cite a ruling the repo does not hold.

### A-7 [GAP] — C3's own team rule must be ruled, not "flagged"
- Spec says (line 29): "Rule implemented: a McLeod load is visible to driver X when X holds a seat … AND the load's current dispatch names a seat-holder … Flag for the owner: confirm in one line."
- Evidence: Q-MK5 text (`MCLEOD-API-KIT-PLAN.md:148-151`) names `auth_dispatched_load_ids()` — whose current definition (`0371_load_driver_scope_reads_dispatch.sql:37-56`) is "current dispatch names the CALLER". C3's analysis is correct: the literal reading hides the non-dispatched seat.
- Fix: this is a re-reading of a ruling, so it is an open question, not an implementation detail. Add it to the plan's §3 as **Q-MK5a** with the candidates (a) dispatch to either seat dispatches the team [spec's choice]; (b) the office must dispatch each seat separately (two `load_dispatches` rows, helper unchanged); (c) dispatch rows gain a team flag. Recommendation (a). M-A cannot merge until the owner has answered it; "confirm in one line" is an assumption left in a build spec.

### A-8 [IMPRECISE] — 0371 policy line range
- Spec says (line 154): "three RLS policies (`0371:62-100`)"
- Evidence: `0371:61-63` is the section comment; the three policies are `0371:64-102` (`loads_driver_scope` 64-74, `load_stops_driver_scope` 76-88, `load_events_driver_scope` 90-102).
- Fix: cite `0371:64-102`.

### A-9 [OK] — 0141 citations (signature, body, gates, events, grants)
- Spec says (lines 220, 283-307, 417, 479, 499, 504): `assert_driver_load 0141:59-89`, `driver_complete_stop` signature `:266-276`, body `:280-400`, status gate `:304-306`, replay `:310-315`, arrived_at `:342`, started `:364-370`, delivered `:389-399`, completed_at `:395`, `driver_start_load :232-261`, decline second event `:216-224`, photos `:348-361`, idempotency `:118-121, 249-251, 310-312`, grant block `:403-417`.
- Evidence: `supabase/migrations/0141_driver_load_rpc_contract.sql` — every range verified exact. No later migration redefines any of these functions (grep of all 636 migrations: only 0087 and 0141 define them), so 0141 IS the current definition.

### A-10 [WRONG] — "added now, behind defaults … (no overload)" needs an explicit DROP of the 0141 signature, and fresh grants
- Spec says (lines 283-286): "Same signature as `0141:266-276` plus `p_action_id uuid default null` and … `p_mcleod_write boolean default false` as trailing defaults — added now, behind defaults, so old API calls resolve to the single new function (no overload …)."
- Evidence: `create or replace function` with a different argument list creates a SECOND function in Postgres; it does not replace. 0141 itself shows the required pattern: `0141:264-265` `drop function if exists driver_complete_stop(uuid, uuid, text, text, jsonb, timestamptz); drop function if exists driver_complete_stop(uuid, uuid, uuid, uuid, text, text, jsonb, uuid, timestamptz);` then `create function`. And `0412_new_functions_closed_to_clients_by_default.sql` closes new functions by default, and 0141's grants (`:407-417`) name the old 9-arg signature, so the new one needs its own `revoke … from public, anon, authenticated; grant execute … to service_role`.
- Fix text: "M-A: `drop function if exists public.driver_complete_stop(uuid, uuid, uuid, uuid, text, text, jsonb, uuid, timestamptz);` then `create function public.driver_complete_stop(…, p_occurred_at timestamptz default null, p_action_id uuid default null, p_mcleod_write boolean default false)`; same for `driver_accept_load(uuid,uuid,uuid,uuid,timestamptz)`, `driver_decline_load(uuid,uuid,uuid,text,uuid,timestamptz)`, `driver_start_load(uuid,uuid,uuid,uuid,timestamptz)` each gaining `p_action_id uuid default null`; then the 0141 grant block re-issued for the four NEW signatures plus `driver_acknowledge_load`, `load_action_seen`, `driver_visible_load_ids`. Deploy window: old code calls by named args without the new ones → resolves to the new function via defaults (PostgREST named-arg call), so drop+create in one migration is safe either order." Add a matrix assertion "the old nine-argument driver_complete_stop no longer exists" (otherwise PGRST203 ambiguity is exactly what a leftover overload causes).

### A-11 [WRONG] — "extend `assert_driver_load` to return `status` and `source`" cannot be a `create or replace`
- Spec says (lines 288-289): "`v_load_source` read beside `v_load_status` (extend `assert_driver_load` to return `status` and `source`, or a second `select`; keep DL002 semantics)."
- Evidence: `0141:59-63` `create or replace function public.assert_driver_load(p_org uuid, p_driver uuid, p_load uuid) returns text`. Changing a function's return type requires DROP (Postgres: "cannot change return type of existing function"), and all four callers assign it to `text` (`0141:116, 189, 247, 291`).
- Fix (close the "or"): keep `assert_driver_load(uuid,uuid,uuid) returns text` (status) unchanged in signature; each caller that needs the source does `select l.source into v_load_source from public.loads l where l.id = p_load and l.org_id = p_org;` right after it. One choice, no "or".

### A-12 [GAP] — Visibility-based `assert_driver_load` turns an existing matrix assertion red (DL001 → DL002)
- Spec says (lines 220-224): "`assert_driver_load` … the 'owns the load' check becomes `p_load in (select public.driver_visible_load_ids(p_org, p_driver))`, still raising `DL002` …"
- Evidence: `supabase/tests/load-lifecycle.test.mjs:150-152` `const A2 = await makeLoad("LD-A2", CO); ok("cannot accept a load that was never released (DL001)", …code === "DL001")`. `makeLoad` (`:71-79`) inserts with the default status `draft`. Today `assert_driver_load` returns `draft` and `driver_accept_load` raises DL001 (`0141:122-124`). Under the new check a `draft` manual load is not visible → DL002. The spec's test list (§2.5, §4.6) never mentions this assertion.
- Fix text: add to §2.5 "`load-lifecycle.test.mjs:151` is rewritten to 'accepting a load that was never released is refused as not yours (DL002) — an unreleased load is not visible'", and to §3.2 that `DL001 not_offered` is now reachable only for a visible manual load in `accepted`→… (`in_transit`, `delivered`, `canceled`). Also state that `assert_driver_load` keeps returning `text` status (A-11).

### A-13 [GAP] — The new `assert_driver_load` dead-letters legitimate evidence after a re-dispatch or a McLeod seat change, contradicting §3.1 step 3's own reasoning
- Spec says (lines 291-295): "Reason for admitting delivered/canceled on tms: the phone may sync hours after the tap … Refusing would dead-letter a real arrival (`policy.ts:99-101`)."
- Evidence: visibility now also depends on the CURRENT dispatch (`driver_visible_load_ids`, spec lines 168-182) and on `loads.driver_id/co_driver_id`, which the mirror overwrites on every sync (`mirrorLoads.ts:62-63`, relink pass `dispatchProjection.ts:125-166`). A driver who arrives offline, then the office re-dispatches (spec §9 line 754 does exactly this) or McLeod repowers the movement, gets DL002 → 404 (`driverLoads.ts:41`) → non-transient → `dead` (`apps/driver/src/data/policy.ts:42-46, 99-101`). The evidence is lost, the very outcome step 3 says it avoids.
- Fix: rule it explicitly (new open question **Q-MK5b**: "may a driver record evidence on a load after it was taken away from them?") with candidates (a) refuse (spec as written; evidence dead-letters, shown in Needs attention); (b) for stop actions on `tms` loads, `assert_driver_load` accepts a driver who HELD a seat when the action occurred: `exists load_events/load_dispatches naming p_driver for p_load` — i.e. "was ever dispatched this load"; (c) accept and flag the event `payload.after_reassignment=true`. Recommend (b)+(c): evidence is never refused for a load the driver was dispatched; the event says it arrived late. At minimum, `load_action_seen` (A-14) must run before the visibility check so replays never hit this.

### A-14 [GAP] — N7 dedupe runs AFTER `assert_driver_load`, so an owner-operator decline replay still dead-letters; "every load action is idempotent, decline included" is not met
- Spec says (line 498): "Called right after `assert_driver_load`; `true` → `return`." and (line 14) "every load action is idempotent, decline included (N7)".
- Evidence: owner-operator decline sets `driver_id = null` (`0141:200-214`); the replay then fails `assert_driver_load` with DL002 (`0141:80-86`; under M-A the load is also no longer visible) before any dedupe can run → 404 → `dead`. Same for any replay after a re-dispatch (A-13).
- Fix text for §5.2: "Order inside every action function: (1) driver-in-org check (`drivers.id = p_driver and org_id = p_org`, DL002); (2) `load_action_seen(p_action_id, p_load, kinds)` — when true, return; the check additionally requires the event's `org_id = p_org` and `actor_role = 'driver'`, and that the event's payload or actor names this driver (see A-15); (3) only then the visibility/ownership check." Add matrix title "a replayed owner-operator decline is a no-op, not DL002".

### A-15 [GAP] — `load_action_seen` does not check org or driver, and `load_events` has no driver column
- Spec says (lines 487-496): `if exists (select 1 from public.load_events where id = p_action_id and load_id = p_load and kind = any (p_kinds)) then return true;`
- Evidence: `load_events` (`0087:110-141`) has `actor_user_id`, `actor_role`, no `driver_id`; the stop event payload carries `stop_id` and `seq` only (`0141:378-387`). So "the same action" is decided by id+load+kind only. Two seats of a team now act on one load (spec line 224 "admits the co-driver to every action"); a stop action's dedupe does not check `payload->>'stop_id' = p_stop` either, so an action id reused for a different STOP of the same load is treated as a replay and silently dropped.
- Fix: give `load_action_seen` the stop: `load_action_seen(p_action_id uuid, p_org uuid, p_load uuid, p_kinds text[], p_stop uuid default null)` matching `org_id = p_org and load_id = p_load and kind = any(p_kinds) and (p_stop is null or payload->>'stop_id' = p_stop::text)`; otherwise DL012. Add `'driver_id', p_driver` to every primary event payload the five functions write (stop events today carry none), so the replay check and the office can name which seat acted. Matrix title: "an action id reused for another stop of the same load is refused (DL012)".

### A-16 [OK-with-note] — `driver_visible_load_ids` indexes and the anon grant
- Spec says (lines 162-218).
- Evidence: indexes exist for both seat predicates: `idx_loads_org_driver_status (org_id, driver_id, status) where driver_id is not null` and `idx_loads_org_co_driver (org_id, co_driver_id) where co_driver_id is not null` (`supabase/schema.generated.sql:8020-8021`, `0493_loads_co_driver.sql:41-43`); `idx_load_dispatches_load_sent (load_id, sent_at desc)` (`0370:92-93`) serves the lateral. 0412 makes new functions closed by default (`0412:47-52`), so the explicit `grant execute … to anon, authenticated` on the wrapper is required and present. The "check before merge … confirm on PGlite that anon can execute the wrapper" is already an existing matrix assertion (`loads-mirror-status-guard.test.mjs:182-188`), so it is not an open check but a kept test — reword line 217-218 as "kept assertion `loads-mirror-status-guard.test.mjs:188` proves it".
- Note: `x in (l.driver_id, l.co_driver_id)` with `co_driver_id` null yields NULL (not false) when `x <> driver_id`; correct in a WHERE, but write it `(cur.driver_id = l.driver_id or cur.driver_id = l.co_driver_id)` so nobody "simplifies" it into `not in` later.

### A-17 [IMPRECISE] — Test citations in §2.5 / §3.6
- Spec says (lines 256, 375): "`loads-mirror-status-guard.test.mjs:115-195` — rewrite §3"; "`loads-mirror-status-guard.test.mjs:156-168`" (helper reference).
- Evidence: §3 of that matrix is `:116-198` (`:200-202` close/RESULT); the helper is used at `:168-181` (`helperAs` → `select auth_dispatched_load_ids()` at 173, title at 178). `rls.test.mjs:2246` ✓, `definer-rpc-grants.test.mjs:142` ✓, `rls.test.mjs:2222-2268` ✓ (class check spans 2222-2268).
- Also: the kept-list omits two existing assertions that must survive the rewrite: `:145` "0371: a legacy Release alone no longer reveals a McLeod load — only a dispatch does" and `:155` "…while the dispatch record itself stays unreadable to them (deny-all)", and `:165` "and sent back to them, it returns — the CURRENT dispatch decides". Name them "(kept)".

### A-18 [GAP] — Moving `nextStop` onto `isStopBehindTruck` turns an existing shared test red; the spec does not list it
- Spec says (lines 321-322): "`nextStop(load)` → `nextStopOnRoute(load.stops)` … C5."
- Evidence: `packages/shared/src/loadOnTruck.test.ts:100-104` `it("is a separate reading from the driver's nextStop, which McLeod's departure does not move (Q-LMR2)", … expect(nextStop(load as never)?.id).toBe("s1"))` — asserts the exact opposite of C5. Also `loadsContract.test.ts:39-96` tests `loadBucket/nextStop/stopProgress` (still pass via re-export, but belong next to the moved functions).
- Fix text for §3.3 tests: "`loadOnTruck.test.ts:100` is replaced by 'the driver's nextStop is the office's nextStopOnRoute: a stop McLeod departed is behind the driver (Q-MK3)'; `loadsContract.test.ts`'s `loadBucket/nextStop/stopProgress` blocks move to `driverLoadPhase.test.ts`." Also update the comment at `loadsContract.ts:163-170` (the Q-LMR2 sentence) in the same merge — C6 lists stale comments but omits this one and `mirrorLoads.ts:20-21` ("never into it (Q-LMR2 is open)").

### A-19 [GAP] — The Upcoming list re-sorts by appointment, so "awaiting_ack first" is lost
- Spec says (lines 342-343, 448-450): "`bucketLoads` buckets by `driverLoadPhase` (`awaiting_ack` goes in `upcoming`, ordered first)"; "the Upcoming list puts `awaiting_ack` first".
- Evidence: `app/(tabs)/loads.tsx:56-57` feeds `buckets.upcoming` through `orderOffers`/`acceptedUpcoming` (`src/features/loads/offerDeckModel.ts:38-49`), and `acceptedUpcoming` re-sorts by first appointment only (`:46-48`), discarding `bucketLoads`' order. Its doc comment (`:44` "Loads the driver has accepted but not started") becomes false for tms loads.
- Fix: C-A2 changes `acceptedUpcoming` to sort `awaiting_ack` before the rest, then by appointment, taking the phase from the same `driverLoadPhase`; rewrite its comment; test "an unacknowledged McLeod load leads the Upcoming list".

### A-20 [IMPRECISE] — `driverLoadPhase(load, ackedByMe)` restates a fact the load already carries
- Spec says (line 324): "`driverLoadPhase(load, ackedByMe)`" and §4.2 (line 426) "`loadSchema` += `acknowledged_at` — this driver's ack of the CURRENT dispatch".
- Evidence: the load the app holds already has `acknowledged_at` (server-derived per driver, §4.3). A second boolean parameter is a copy every caller must compute identically (`loadStatus.ts:9`, `loadViewModel.ts:53-55`, `[id].tsx:84`, `UpNext.tsx:17`).
- Fix: `driverLoadPhase(load: Pick<Load, 'source'|'status'|'stops'|'acknowledged_at'>)`; `awaiting_ack` iff `acknowledged_at === null`. Deriving beats restating (CLAUDE.md).

### A-21 [WRONG] — The N7 staging check (§9) describes the case the design does NOT fix
- Spec says (line 759-760): "N7: airplane mode, Arrive, wait for a failed attempt, Complete, reconnect: both land, nothing in Needs attention"; and §5.2 (lines 500-503): "With the action id the retried Arrive finds its own `stop_arrived` event and no-ops."
- Evidence: in airplane mode the Arrive never reaches the server, so no `stop_arrived` event with its id exists. `claimNext` takes the oldest DUE record (`apps/driver/src/data/outbox.ts:95-110`); the Arrive is in backoff (`policy.ts:103-108`), the Complete is due, so the Complete lands first and sets the stop `completed`. The retried Arrive then finds no event, hits `v_stop_status in ('completed','skipped')` (`0141:313-315`) → DL003 → 409 → `dead` (`policy.ts:99-101`). For a tms stop the arrival time is also lost (§3.1 step 5 leaves `arrived_at` null), so MK3 sends `arrival_at = null` → `arrival_unknown`. The action id only fixes the case where the server committed the Arrive and the response was lost.
- Fix (one of two, recommend (a)): (a) per-stop FIFO in the outbox: `claimNext` skips a `load_stop` record while an older non-`done`, non-`dead` record with the same `payload.stop_id` exists (C-A2, `outbox.ts`; test "a Complete never syncs before an older Arrive of the same stop"); (b) server side: an `arrived` on a completed stop whose `arrived_at` is null records the arrival (sets `arrived_at`, writes `stop_arrived`) instead of DL003 — but under MK3 the write request was already enqueued with a null arrival, so (b) also needs a request superseding rule; (a) avoids that. Rewrite the §9 N7 check to match the chosen fix, and add matrix/app titles for both the committed-replay and the never-landed cases.

### A-22 [OK] — Driver-app citations (outbox, handlers, settings, boundaries)
- Spec says (lines 446-447, 479, 500, 512-514, 692-694): `handlers.ts:24-27, 117-120, 48-60, 126-156, 158-161, 225-230`, `FailedSyncList.tsx:26-38`, `outbox.ts:46`, `outbox.ts:95-110`, `settings.tsx:54`.
- Evidence: `apps/driver/src/data/handlers.ts` 24-27 (kind constants), 117-120 (registrations), 48-60 (`loadHandler`), 126-156 (stop handler), 158-161 (message replay comment), 225-230 (legacy record comment) — exact. `apps/driver/src/features/support/FailedSyncList.tsx:26-38` `KIND_LABEL` ✓. `apps/driver/src/data/outbox.ts:46-49` `newClientId` ✓, `:95-110` `claimNext` ✓. `apps/driver/app/settings.tsx:54` `<FailedSyncList />` ✓. Note: `loadHandler`'s `run` is typed `(record: { payload: unknown })` (`handlers.ts:52`); sending `record.id` needs the parameter widened to `OutboxRecord` (`sync.ts:63` passes the full record), state it.
- Paths: spec writes `src/features/loads/...`, `app/loads/...` without the `apps/driver/` prefix and `policy.ts` without `src/data/`; prefix them.

### A-23 [OK-with-note] — Driver-app screen citations
- Spec says (lines 342-357): `loadViewModel.ts:53-55`, `loadStatus.ts:6-22`, `[id].tsx:84-160`, `stop/[stopId].tsx:160-190`, `useLoads.ts:101-144`, callers `home.tsx:63`, `duty/end-shift.tsx:80`, `(tabs)/loads.tsx:55`.
- Evidence: all exact (`[id].tsx:85` `working = load.status === 'in_transit'`, `:118` offered, `:133` accepted, `:147` working&&next; `stop/[stopId].tsx:156-190` footer with "Mark arrived" at 167-178; `useLoads.ts:101-144` `patchStop`). Note the stop screen today labels the arrive button "Mark arrived" (secondary, `:170`) and "Complete stop" is the primary for every status; the spec's tms flow swaps primacy — say "replaces `:154-190`'s footer for tms".
- `loadStatus.ts:6-22` change of `driverLoadStatus(status)` to `(load)` touches its only caller `app/loads/[id].tsx:84` — list it.

### A-24 [WRONG] — `mirrorLoads.test.ts` does not exist; the stop-write tests live elsewhere
- Spec says (lines 134-136): "Tests: `mirrorLoads.test.ts` 'stops go through apply_mcleod_load_stops …' (recorder: assert the rpc args), 'a deferred load is reported, not thrown'; `tmsIngest` route test …"
- Evidence: no `apps/api/src/modules/loads/mirrorLoads.test.ts` on disk. The mirror's stop write is tested through the route in `apps/api/src/modules/mcleod/routes/tmsIngest.dispatchProjection.test.ts:164-177` ("draws PU and SO …", "only a driver's untouched stops are cleared — a worked stop is never deleted", which asserts the `.delete()` that S0b removes). `tmsLoadIngest.test.ts:135, 205, 397, 435` assert `load_stops` upserts of the legacy ingest that S0b deletes.
- Fix text: "S0b rewrites `routes/tmsIngest.dispatchProjection.test.ts:164-177` — the delete assertion becomes 'stops go through apply_mcleod_load_stops with every projected column and none of the driver's' (recorder `rpc` call args) and 'a deferred load is reported in stopsDeferred, not thrown'; `tmsLoadIngest.test.ts`'s stop assertions go with `writeStops`." Name the files.

### A-25 [GAP] — C7's 410 retirement leaves the whole legacy ingest alive; the spec only deletes `writeStops`
- Spec says (lines 131-133): "the `POST /loads` handler … answers `410 …`; `tmsLoadIngestWriters.writeStops` and its now-unreferenced helpers are deleted with their tests."
- Evidence: `routes/tmsIngest.ts:325-347` mounts `/loads` calling `ingestLoads` (`tmsLoadIngest.ts:354`, imported at `routes/tmsIngest.ts:23`). `ingestLoads` also writes `loads`, `load_events`, `load_external_payloads` (`scripts/table-writers.json:479-497` list `tmsLoadIngestWriters.ts` for all four). `dispatchProjection.ts:4` still imports `loadEntityResolvers` from `tmsLoadIngest.ts` (`:128`), so the file cannot simply go. `tmsLoadIngest.ts` is 490 lines.
- Fix text: "S0b: the `/loads` handler returns 410; `ingestLoads` and every writer only it calls (`writeStops`, `insertCreates`, `applyCancels`, `applyOverwrites`, `stampExternalStatus`, `writePayloads`, `writeEvents` if unreferenced) are deleted with `tmsLoadIngest.test.ts`'s cases for them; `loadEntityResolvers` moves to its own file (e.g. `mcleod/entityResolvers.ts`) for `dispatchProjection.ts`. `table-writers.json` drops `tmsLoadIngestWriters.ts` from `load_events`, `load_external_payloads`, `load_stops`, `loads` (the gate fails on a stale pin, `check-table-writers.mjs` staleWriters). Check `load_external_payloads` keeps a producer for `lint:table-producers` (it is read by `detail.ts:173 externalPayload`, reads count)." Also confirm with the agent owner that no deployed agent build still posts `/api/tms/loads` (`tools/mcleod-agent/agent.mjs:643-645` is the repo copy only).

### A-26 [GAP] — S0b changes `load_stops`' writer set to zero app writers; `lint:table-writers` and `check-table-modules` must be told
- Spec says (lines 129-130): "`scripts/table-writers.json:490-493`: `load_stops` loses `mirrorLoads.ts` … and `tmsLoadIngestWriters.ts`; the RPC body is the producer (`check-table-producers` DML scan)."
- Evidence: `scripts/table-writers.json:490-493` ✓ exact. `check-table-writers.mjs:61-66` fails on stale pins, so the entry must be removed (an empty array or deleting the key — either is accepted by the code, which iterates `Object.entries(pinned)`). `lint:table-writers` also runs `gen-schema-snapshot` + `git diff --exit-code supabase/schema.generated.sql` (`package.json:94`), so S0a must regenerate `supabase/schema.generated.sql` (new column + index + function) — S0a's merge text does not say so; M-A and S0c change the snapshot too.
- Fix: add "regenerate `supabase/schema.generated.sql` (`node scripts/gen-schema-snapshot.mjs`)" to S0a, M-A, S0c and M-K1 (spec has it only for M-K1, line 621).

### A-27 [GAP] — S0's `deferred` arm can defer a load forever while the worked-stop / seq collision persists, and after S0c two rows can share a `seq`
- Spec says (lines 97-102, 138-143): the unique_violation arm "exists for exactly one case: McLeod re-sequenced a movement"; S0c makes `(load_id, seq)` non-unique.
- Evidence: the mirror keeps every worked stop (`mirrorLoads.ts:18-21`) and S0's step 3 keeps them too. A worked stop X at seq 2 that McLeod REMOVES, followed by McLeod adding stop Y at seq 2, collides on `idx_load_stops_load_seq` (`0085:162-163`) on every apply — not a re-sequence, and not transient: the load is deferred every sweep until S0c. After S0c, X and Y both sit at seq 2; every reader orders by `seq` (`driverLoads.ts:143`, `detail.ts:169`), and `nextStopOnRoute`'s sort (`loadBoard.ts:197-200`) has no tie-break.
- Fix: (1) state the second case in the arm's comment and add matrix title "a worked stop McLeod removed and a new stop at its sequence: deferred before S0c, both kept after"; (2) S0c adds a deterministic order for ties — readers order by `(seq, created_at)` — or keep `seq` unique by renumbering kept-but-removed worked stops (e.g. `seq = -seq`)? Recommend: ORDER BY `seq, created_at` in the three readers + `nextStopOnRoute` tie-break on `id`, stated in S0c. (3) S0b logs deferred ids; add that a load deferred for > 1 day raises the existing mirror refusal path so a person sees it.

### A-28 [IMPRECISE] — "Non-partial on purpose: PostgREST's onConflict cannot name a partial index's predicate"
- Spec says (lines 61-63).
- Evidence: after S0b no PostgREST upsert targets this index — the only writer is the plpgsql RPC (`insert … on conflict (load_id, mcleod_stop_id)`), where a partial index IS usable with `on conflict (load_id, mcleod_stop_id) where mcleod_stop_id is not null`.
- Fix: either keep non-partial and give the true reason ("simplest arbiter; NULLs are distinct so manual rows never collide"), or make it partial `where mcleod_stop_id is not null` and write the arbiter with the WHERE. Recommend keep non-partial, correct the comment.

### A-29 [GAP] — S0a backfill: `company_id` and trimming assumptions
- Spec says (lines 67-76): join `l.external_id = s.company_id || ':' || s.movement_id` and `s.movement_sequence = ls.seq`.
- Evidence: projection builds `external_id` from the MOVEMENT row's `company_id`/`movement_id` verbatim (`mcleodLoadProjection.ts:240`); raw stops carry their own `company_id` (`0364:115`) and the raw stop PK is `(org_id, company_id, stop_id)` (`0364:145`). If the agent stores these char columns untrimmed in one table and trimmed in the other, the join silently matches nothing. The join also cannot use an index (`external_id` expression) — fine at ~300 loads/1.2k stops but should be stated.
- Fix: the migration header records the measured staging counts the spec already promises (line 52) AND a post-backfill assertion: `select count(*) from load_stops ls join loads l … where l.source='tms' and ls.mcleod_stop_id is null and l.status in ('approved','in_transit')` must be 0 on staging before S0b merges (live loads all claimed); the matrix title "the backfill fills mcleod_stop_id from raw by movement and sequence" plus "a projected load whose raw movement is gone keeps mcleod_stop_id null and is claimed by seq on its next apply".

### A-30 [GAP] — `getDriverLoads`' stop and photo reads are not org-scoped and not chunked, so the spec's own test cannot pass as written
- Spec says (lines 274-276): driverLoads.test "asks driver_visible_load_ids … and reads only those ids, org-scoped (`expectOrgScoped`)"; line 246-250 chunks only the `loads` read.
- Evidence: `driverLoads.ts:142-149` reads `load_stops` and `load_stop_photos` with `.in("load_id", loadIds)` and NO `.eq("org_id", …)`, unchunked; `loadsDispatchedTo` and the loads read also ignore `error` (`:86-90, 121-132`).
- Fix text for §2.4: "both nested reads gain `.eq('org_id', orgId)` and go through `chunks()`; every read throws on `error` (a swallowed error is an empty load list on the phone)." CLAUDE.md: "every service query must org-filter itself".

### A-31 [WRONG] — Office retry route inserts into a `mcleod`-owned table from the `loads` module
- Spec says (lines 619-620): "`lint:table-writers` — `scripts/table-writers.json` adds the two route files under `apps/api/src/modules/mcleod/writes/` (owner's directory, so `check-table-modules` writer-path passes)"; and (lines 675-678): "Office (`routes/dispatch.ts` …): `POST /api/dispatch/loads/:id/stops/:stopId/mcleod-write/retry` → new request `origin='office_retry'`".
- Evidence: `routes/dispatch.ts` is `apps/api/src/modules/loads/routes/dispatch.ts` (module `loads`). `check-table-modules.mjs:140-152` fails "`<table>` is written from `<path>`, outside its owner" for any `.from("mcleod_write_requests").insert` outside `apps/api/src/modules/mcleod/`. Two placements in the spec contradict each other.
- Fix text: "The retry insert lives in `apps/api/src/modules/mcleod/writes/officeRetry.ts` (exported through `mcleod/index.ts`); `loads/routes/dispatch.ts` calls that interface. `table-writers.json` `mcleod_write_requests: ['apps/api/src/modules/mcleod/writes/officeRetry.ts']`, `mcleod_write_outcomes: ['apps/api/src/modules/mcleod/writes/agentRoutes.ts']`." Same for `getDriverLoads` (loads module) and `detail.ts` reading the two tables: route those reads through a `mcleod` module function too (`readStopWriteStates(admin, orgId, stopIds)`), which keeps the `loads` module from knowing the mcleod schema.

### A-32 [GAP] — The exceptions feed cannot "list open refused|conflict writes" as specified; it is built from `load_events` kinds only
- Spec says (lines 679-681, 701-703): keep-mcleod writes "`load_events` `exception_resolved` with `{ mcleod_write_request_id, action: 'kept_mcleod' }`"; "the exceptions feed (`load_events` by kind, `0145:32-33`) lists open `refused|conflict` writes until an `exception_resolved` or a confirmed successor exists."
- Evidence: `apps/api/src/modules/loads/dispatchLoads/exceptions.ts:33` `EVENT_KINDS = ["declined", "equipment_mismatch", "amended"]`; open = candidate event whose id is not in `exception_resolved.payload.resolves` (`:103-107`); `EXCEPTION_KINDS` in `packages/shared/src/dispatchContract.ts:87`. A refused McLeod write produces no `load_events` row at all (outcomes go to `mcleod_write_outcomes`), and the resolution key is `payload.resolves`, not `mcleod_write_request_id`.
- Fix text: "C-K2: `EXCEPTION_KINDS += 'mcleod_write'` with label 'Not in McLeod' and action `review_mcleod_write` (`dispatchContract.ts:87-100`); `listExceptions` adds a fifth read (through the mcleod module interface, A-31): requests whose latest outcome is `refused|conflict` and that have no successor, id `mcleod_write:<request id>` (the `auto_timeout` synthetic-id pattern, `exceptions.ts:141-157`); keep-mcleod writes `exception_resolved` with `{ resolves: 'mcleod_write:<request id>', action: 'kept_mcleod' }`." Name the test "a refused McLeod write is an open exception until Keep McLeod's or a confirmed retry".

### A-33 [GAP] — `requested_by … references auth.users(id)` blocks deleting a driver's login, and the append-only guard forbids any ON DELETE action
- Spec says (line 571): "`requested_by uuid not null references auth.users(id)`" and (line 600-601) "UPDATE and DELETE raise (MW011)".
- Evidence: driver logins are deleted: `apps/api/src/modules/roster/driverCredentials.ts:236-253` `revokeDriverLogin` → `admin.auth.admin.deleteUser(userId)`; also `:148`. A default (NO ACTION) FK makes that delete fail for any driver who ever completed a McLeod stop; `on delete set null` would be an UPDATE the MW011 guard refuses. `load_events.actor_user_id` uses `on delete set null` (`0087:117`) precisely because users go away. Also `driver_complete_stop`'s `p_actor_user` defaults to null (`0141:274`), so a NOT NULL `requested_by` can fail the whole evidence transaction.
- Fix: `requested_by uuid` with NO foreign key and nullable, comment "the auth user at the time of the request, kept as evidence; users are deleted (revokeDriverLogin), so no FK" — plus record the driver (`driver_id uuid not null`, no FK either, same reason as `co_driver_id` in 0493) since that, not the login, is who the evidence is about. `lint:driver-references` then needs the column accounted for (`merge_driver` must move it, or an explicit exemption) — state which.

### A-34 [GAP] — Outcome log accepts rows after a terminal one, and MW010 does not tie the stop to the load
- Spec says (lines 595-601): unique terminal index; "INSERT checks that the load / request belongs to the row's org (MW010)".
- Evidence: nothing stops a `sent` row after `confirmed` (only a second TERMINAL is unique). `stop_id` and `load_id` are independent FKs, so a request can name a stop of another load.
- Fix: the outcomes guard refuses any insert when a terminal row exists for `request_id` (`MW012 'request already ended'`); the requests guard checks `exists (select 1 from load_stops s join loads l on l.id = s.load_id where s.id = new.stop_id and s.load_id = new.load_id and l.org_id = new.org_id and l.source = 'tms')` and that `new.mcleod_stop_id = s.mcleod_stop_id`. Add titles "an outcome after the terminal one is refused (MW012)", "a request whose stop is not on its load is refused (MW010)".

### A-35 [WRONG] — `MCLEOD_WRITE_COMPANIES` env switch is keyed by McLeod company, not by tenant, and duplicates an existing per-org config home
- Spec says (lines 650-655): "`p_mcleod_write` is computed by the API: `true` iff the load's company (prefix of `loads.external_id`) is in env `MCLEOD_WRITE_COMPANIES` (comma list…)".
- Evidence: Silvicom 360 is multi-tenant; `external_id` is `company:movement` per org (`mcleodLoadProjection.ts:240`), and McLeod company ids are per-install (e.g. `TMS`), so two carriers can share a company id and one env value switches both. `org_integrations (org_id, provider, enabled, config jsonb "non-secret settings …")` already exists (`0068_tms_integration.sql:10-20`) and is the per-org McLeod config the ingest token resolves to. An env var is invisible to every gate (spec admits it) and to the office.
- Fix: "the switch is `org_integrations.config.write_companies: string[]` on the org's `mcleod` row (empty by default), read by `mcleodWriteEnabledFor(admin, orgId, externalId)`; changing it is an audited admin act." If the owner prefers env for the first test company, label it a workaround per CLAUDE.md (what it works around, what removes it). Also name where D-MK3's pass is recorded before the switch is set.

### A-36 [OPEN] — `clearStop`'s service-failure side effect is not addressed
- Spec says (lines 537-550): one `clearStop` call with `arrivalDate`/`departureDate`; "`hub` is not sent".
- Evidence: `MCLEOD-API-SURFACE-2026-11-19.md:38-42` — clearStop "Clears the stop with the given dates **and creates a service failure record if necessary**", with `delayCode`, `delayComments`, `causedByType`, `driverId`, `isReportable` (default **true**), `faultOfCarrierOrDriver` (default false). A late departure written by 360 can create a REPORTABLE service failure in the carrier's McLeod with defaults nobody chose.
- Fix: add open question **Q-MK3a** "when our times make McLeod raise a service failure, which delayCode/causedByType/isReportable do we send?" with candidates (a) send nothing, accept McLeod defaults; (b) send `isReportable=false` and let the office classify in McLeod; (c) refuse to write when the departure is past the appointment and leave it to the office. Recommend (b) pending Alex; record the answer in D-MK2's row. The agent spec must not send without it.

### A-37 [OPEN] — McLeod-side facts the spec treats as known
- Spec says: (line 538-539) "clearStop … is McLeod's departure act"; (line 540) "Writing on arrival would mark the stop departed"; (line 563) "`company_id text not null -- AnywhereCompanyID`"; (line 673) "McLeod already `D` with our departure (± 1 min) → confirmed".
- Evidence: the surface doc says only "Clears the stop with the given dates" (`:38-39`); it is read from ANOTHER customer's `/ws/docs`, "Not our install and not our version … Every operation below must be confirmed on OUR /ws/docs" (`:5-8`). Nothing says raw `stop.company_id` equals the `AnywhereCompanyID` header value, that the char(32) stop id is accepted trimmed in the path, which time zone `arrivalDate`/`departureDate` are read in, or what tolerance McLeod's read-back rounds to (± 1 min is invented).
- Fix: list these five as MK0 confirmations in §6.1 (each with "if not, then …"): (1) clearStop semantics (does it set status `D`; does it accept departure without arrival — already listed); (2) AnywhereCompanyID == `mcleod_dispatch_movements.company_id`; (3) stop id trimmed vs padded in the path; (4) date format and zone; (5) read-back precision → the ± tolerance. The table columns stay; their meaning is what MK0 confirms.

### A-38 [WRONG] — Error codes `MW010`/`MW011` are already taken
- Spec says (lines 600-601): "INSERT checks … (`MW010`), UPDATE and DELETE raise (`MW011` …)".
- Evidence: `supabase/migrations/0551_recruiting_message_wording.sql:91,93` already raise `MW011` and `MW010` (recruiting message wording, with the meanings swapped: MW010 = "never edited"). The `MK*` and `LS*` prefixes appear in no migration (`grep errcode` over all migrations); `DL012-DL014` are free (`DL001-006, 010, 011, 020-023, 030, 099, 404` used).
- Fix: use `MK010` (org/load/stop mismatch), `MK011` (append-only), `MK012` (outcome after terminal, A-34). `LS001` and `DL012-DL014` are fine as written.

### A-39 [IMPRECISE] — `driver_acknowledge_load` restates the dedupe the spec says is "written once as a helper", and lets a null action id reach a NOT NULL primary key
- Spec says (line 485) "Dedupe rule, identical in all five functions (written once as a helper)"; but the ack body (lines 402-406) inlines its own `exists … DL012` check, and (line 412-415) inserts `id = p_action_id` without a null guard.
- Evidence: `load_events.id uuid primary key default gen_random_uuid()` (`0087:111`); an explicit NULL in the insert list overrides the default → 23502 → unmapped in `PG_TO_API` (`driverLoads.ts:39-47`) → thrown → 500 → transient → retried forever (`policy.ts:42-46`).
- Fix: ack body calls `if public.load_action_seen(p_action_id, p_org, p_load, array['acknowledged']) then return; end if;` and starts with `if p_action_id is null then raise exception 'an acknowledgement needs its action id' using errcode = 'DL012'; end if;` (or a new `DL015`, mapped 422). The ack also reuses DL014 for "a manual load is accepted, not acknowledged" whose API text is "Call dispatch about this load" (`mcleod_load_no_offer`, spec line 315) — wrong words for that case; give it its own code (`DL015 manual_load_not_acknowledged`, 409) or state that the app can never send it (it only offers Got it on tms) and accept the generic text.

### A-40 [GAP] — `load_events` growth budget is exceeded the day N2 goes live; table-lifecycle declaration must move with it
- Spec says (lines 607-616) budgets only for the two new tables.
- Evidence: `scripts/table-modules.json` declares `load_events` `budget_rows_per_day: 50` ("5 rows/day, x3 headroom", measured 2026-09-21) and `load_stop_photos` 500. With McLeod loads visible, every stop produces `stop_arrived` + `stop_completed` events plus one `acknowledged` per dispatch per seat: the spec's own estimate is ≈230 departures/day (line 612) → ≥ 460 driver events/day + acks, 10× the declared budget (the L8 growth judge reads these declarations, `check-table-lifecycle.mjs:30-33`).
- Fix: C-A1 (the first merge that lets a driver write events on McLeod loads) updates `load_events.lifecycle.budget_rows_per_day` (e.g. 1,500 = (230 × 2 + ~100 acks + mirror status events) × 3) with the measurement in `why`, and `load_stop_photos` if 500 is short (230 stops × 2 required photos = 460/day, ×3 headroom = 1,400).

### A-41 [IMPRECISE] — Unsourced throughput number
- Spec says (lines 611-613): "requests 700/day (live lme 2026-09-24: 99.3 movements/day × ~2.3 PU/SO stops ≈ 230 departures × 3)".
- Evidence: no document in the repo contains "99.3" (grep of `docs/`); the nearest measured figures are "96 `P` movements, 253 stops" on the 2026-09-28 open board (`mcleodLoadProjection.ts:113-118`) and "942 movements, 28 team" (`:91-92`) — board counts, not per-day throughput.
- Fix: cite the query and its result file, or replace with a number from a stated source (e.g. `select count(*)/30.0 from mcleod_dispatch_stops where stop_type in ('PU','SO') and actual_departure >= now()-interval '30 days'` on production, result recorded in the migration header).

### A-42 [IMPRECISE] — History sort restates an existing shared definition
- Spec says (line 370): "history sort … change to last stop's `actual_departure_at ?? completed_at ?? created_at` (`loadViewModel.ts:61`)".
- Evidence: `packages/shared/src/loadActivity.ts:43` `export function loadDeliveredAt(stops: readonly ActivityStop[])` — "the last delivery stop's McLeod departure; the driver app's completed_at stands in" (D-LA1), already the one definition of "delivered at".
- Fix: "`loadViewModel.ts:61` sorts `previous` by `loadDeliveredAt(load.stops) ?? load.created_at`." (Needs `actual_departure_at` on `loadStopSchema` — which §3.3 adds.) Also `useDispatchLoads.ts:109` cited for `loads.completed_at` is the STOP's `completed_at` (`DispatchStopDetail`); the load's is `:139`.

### A-43 [GAP] — C-A3 ("action id required") has no condition that old app builds are gone
- Spec says (line 515): "C-A3 (after C-A2 is in production): `.optional()` removed on the four schemas."
- Evidence: the handler fix covers records queued by an older build but DRAINED by the new one (`handlers.ts:225-230` pattern). A phone that has not taken the C-A2 update still runs the old handler, which sends no `action_id` → 422 from `validateBody` → non-transient → `dead` (`policy.ts:99-101`). "In production" is a release event, not an adoption measure. The API has no app-version signal on these routes (only `notifications.ts:182` stores `app_version` on push registration).
- Fix: C-A3's precondition is "every driver device that synced in the last 30 days reports a build ≥ C-A2" — read from push-registration `app_version` (`notifications.ts:182`) or EAS Update adoption (`eas-update-insights`); state the query. Until then C-A3 waits.

### A-44 [GAP] — Rollout does not state that C-A1 must wait for S0b IN PRODUCTION
- Spec says (lines 733-737): steps 1-4, "M-A … may merge in parallel with S0b"; §1 title "S0 — prerequisite of N1-in-production".
- Evidence: C1's churn only matters once a driver can see an approved McLeod load, which C-A1 (the API filter, `getDriverLoads`) enables; M-A alone exposes nothing through the API (the app never reads `loads` via PostgREST — `useLoads.ts:58` uses `/api/me/loads`). So the binding edge is S0b-in-production → C-A1-in-production, which the numbered list implies but does not say; a parallel chat could release C-A1 first.
- Fix: add to step 4: "⟵ S0b in production (verify `pnpm verify:live` shows S0b's commit) — C-A1 is what makes C1 live."

### A-45 [OK-with-note] — Migration numbering and per-merge ordering
- Spec says (lines 16-19): NNNN = next free; latest `0636`.
- Evidence: `supabase/migrations/0636_toll_plazas_and_observations.sql` is latest ✓. Column-then-reader: S0a adds `load_stops.mcleod_stop_id` + RPC with no code; S0b is the first reader/writer ✓ separate merge. M-A adds no column (it changes functions/policies/check constraint); C-A1 reads the new FUNCTIONS — correctly held as a separate merge (`lint:migration-ordering` sees only columns — `package.json:56` comment). M-K1 creates tables (exempt) + replaces `driver_complete_stop` with the SAME signature (already widened in M-A) — so line 625-626 "the `driver_complete_stop` change adds a defaulted parameter" is wrong for M-K1 (the parameter came in M-A); say "M-K1 keeps M-A's signature". C-K2 reads M-K1's tables in a later merge ✓. S0c drops a unique index a release after S0b ✓ (the reason given, `onConflict: "load_id,seq"` needs a matching unique index, is correct).
- Note: the spec gives four migrations (S0a, M-A, S0c, M-K1); with parallel chats racing numbers (memory: migration-number race) each must take its number at merge time — the spec's "NNNN" convention is right; do not pre-assign.

### A-46 [WRONG] — Spec A's write-pipeline table contract contradicts spec C's for the SAME table name
- Spec says (lines 533-535): "The agent transport … is another spec; this section fixes the table contract jointly (D-MK1)"; §6.2 defines `mcleod_write_requests` (stop-specific columns: `operation 'stop_clear'`, `load_id`, `stop_id`, `mcleod_stop_id`, `arrival_at`, `departure_at`, `expected`, `origin`, `supersedes`; NO status column) + append-only `mcleod_write_outcomes`; error codes MW010/MW011; agent routes `GET /api/tms/writes`, `POST /api/tms/writes/:id/outcome`; switch = env `MCLEOD_WRITE_COMPANIES`; Arrive enqueues nothing.
- Evidence: `docs/plans/mcleod/api-kit-specs/C-transport.md:320-372` defines `public.mcleod_write_requests` with a generic shape (`kind`, `company_id`, `target_type`, `target_id`, `payload`, `baseline`, `source_ref`, a forward-moving `status`, lease columns) + `mcleod_write_attempts` + `mcleod_write_switches`; codes `MW001-MW005` (`:339-341`); routes `/api/tms/mcleod-api/writes/claim` and `/settle` (`:44-50`); three locks incl. env `MCLEOD_API_WRITES` and per-org switch rows (`:56-58`); kinds `stop_arrival` AND `stop_departure`, with "`status: "arrived"` → `stop_arrival`" (`:617`) and a 72-hour `stale_intent` rule (`:489-490`); enqueue from TypeScript `completeStopAndQueueMcleod` AFTER the RPC (`:605-616`), not inside `driver_complete_stop`. `D-office-finance-docs.md:13-28` relies on C's generic `kind`/`target`/`state` shape and a per-kind enable flag.
- Fix: one table contract, owned by ONE spec. Recommend: spec C's generic shape (D, the third consumer, needs `kind`/`target`), and spec A keeps only the stop-specific parts as C's `stop_departure` kind payload (`{ mcleod_stop_id, arrival_at, departure_at }`, baseline = A's `expected`). Spec A §6.2-6.4 then shrinks to: which actions enqueue (Complete → `stop_departure`; Arrive → none, per A's §6.1 reasoning, which C must adopt — or the owner rules C's U10 branch), where (inside `driver_complete_stop` for atomicity, A's argument, vs after it in TS, C's — pick one: A's same-transaction argument is stronger; C's step 5 "503 → outbox replays" works only because both halves are idempotent), and the app/office UI. Both specs must cite the same MK codes (A-38) and the same routes. Until reconciled, M-K1 cannot be written.

### A-47 [GAP] — Spec B adds projected stop columns that spec A's RPC would silently drop
- Spec says (lines 91-95): the RPC's `on conflict … do update set` lists every PROJECTED column explicitly.
- Evidence: `docs/plans/mcleod/api-kit-specs/B-data-fixes.md:370-374` adds `reference_numbers` to `ProjectedStop` and relies on "`writeStops` already spreads `...s`" — true of today's `mirrorLoads.ts:117`, false once S0b replaces it with an RPC whose insert/update column list is fixed in SQL. B also edits `tmsLoadIngestWriters.ts:155-157` (`B-data-fixes.md:94-96`), a file S0b deletes; and B adds `actual_arrival_at`/`actual_departure_at` to `loadStopSchema` (`:326-335`) which A §3.3 (line 331-333) also adds.
- Fix: (1) the RPC's column set is DERIVED, not restated: build the insert from `jsonb_populate_record(null::public.load_stops, stop)` and update exactly the keys present in the payload except the driver's four (`status, arrived_at, completed_at, skip_reason`) and identity columns — then a new projected column needs no RPC migration; or, if kept explicit, spec B's B5 must `create or replace` the RPC in the same merge that adds the column to the projection (state it in both specs). (2) Order the specs: whichever of A-S0b / B-N5 merges second edits the other's file; B's edit to `tmsLoadIngestWriters.ts` disappears if S0b lands first. (3) One merge adds the two McLeod actual-time fields to `loadStopSchema` — B's `stopMcleodFactsSchema` (with `.default(null)`, safe for the app before the API ships) — and A's C-A1 reuses it.

### A-48 [IMPRECISE] — Name of N5's constant
- Spec says (line 122): "new `MCLEOD_REQUIRED_PHOTOS` is NOT added here — N5 owns it".
- Evidence: spec B names it `REQUIRED_PHOTOS_BY_STOP_KIND` / `requiredPhotosFor(kind)` (`B-data-fixes.md:~78-90`). And S0b moving "`mirrorLoads.ts:120`'s literal … into the RPC payload unchanged" is correct (`mirrorLoads.ts:118-120`).
- Fix: "N5's `requiredPhotosFor` (spec B)".

### A-49 [OK] — Remaining citations verified exact
- `0364:113-117` (raw stops table, `stop_id`), `0370:107-140` (dispatch guard UPDATE rule), `0087:110-195` (load_events + append-only triggers), `0145:21-29` (kind list), `0145:32-33` (org/kind/time index), `0085:162` (unique `idx_load_stops_load_seq`, created `:162-163`), `0085:245-251`, `0085:257-267`, `0085:290-296` (photo/storage policies), `loadsLifecycle.ts:18-33` and `:23-29`, `loadsLifecycle.test.ts:16-31`, `loadsContract.ts:13-17, 69-89, 92-108, 100, 124`, `loadDispatchContract.ts:64-72`, `dispatchToDriver.ts:208-254`, `useLoadDispatch.ts:69-73`, `DispatchLoadDetailPage.vue:70-83, 78, 80, 211-213, 332-345`, `DispatchLoadsPage.vue:479`, `detail.ts:163-221`, `routes/dispatch.ts:255`, `routes/tmsIngest.ts:93`, `tmsLoadIngest.ts:474`, `tools/mcleod-agent/agent.mjs:643-645`, `loadActivity.ts:14`, `loadBoard.ts:171,175`, `offerDeckModel.ts:40,47`, `UpNext.tsx:17`, `todayModel.ts:251`, `loadRows.tsx:16` (+`UpcomingRow` at `:58`), `itineraryModel.ts:110`, `TodayHero.tsx:105,197`, `[id].tsx:82`, `useLoads.ts:27-35, 151-157`, `(tabs)/loads.tsx:31-36, 38-45, 55, 81-97`, `me.ts:285-287, 309-340, 342-381` (file is `apps/api/src/modules/driver-app/routes/me.ts`, 444 lines ✓), C6 list. `loadsLifecycle.ts:150-191` is `:150-193` (labels end at 193).

### A-50 [IMPRECISE] — Dangling cross-reference and "one read"
- Spec says (line 230) "a co-driver's app shows a teammate's photo as a filled slot without a thumbnail (§3.5)"; §3.5 (lines 361-364) is about the office and says nothing about it. Spec says (line 435) "`getDriverLoads` derives `acknowledged_at` with one read" but then describes two (dispatches, then events).
- Evidence: `0085:290-296` `load_photos_driver_read` = own folder only — so the degradation is real.
- Fix: move the sentence into §3.4 (driver app) and make it a decision: OPEN **Q-MK5c** "may a co-driver see the teammate's stop photos?" (a) no (spec); (b) extend `load_photos_driver_read` to `(storage.foldername(name))[3]::uuid in (select public.auth_driver_visible_load_ids())`. Recommend (b) — the team works one load, and the data is already returned to the co-driver by the API. Reword "one read" → "two chunked reads".

### A-51 [GAP] — getDriverLoads ack derivation and `dispatchesByLoad` name lookup left as "or"
- Spec says (line 439-440): "names via the `driver_names` surface or `drivers(full_name)` lookup".
- Evidence: `dispatchesByLoad` already embeds `drivers(full_name)` for the dispatch row (`dispatchToDriver.ts:222`); the ack's driver is `payload.driver_id`, which has no embed (no FK on a jsonb key).
- Fix: "one chunked `drivers` read `.select('id, full_name').eq('org_id', orgId).in('id', ackDriverIds)`" — single choice.

### A-52 [GAP] — S0c drops `(load_id, seq)` uniqueness without listing what joins on it
- Spec says (lines 138-143): S0c drops `idx_load_stops_load_seq` and creates a plain index.
- Evidence: `supabase/migrations/0453_load_stop_eta_predictions.sql:13-17, 44-45` keys predictions by `(load_id, stop_seq)` "which is what `load_stops` carries and what the comparison joins on to `load_stops.actual_arrival_at`"; `dispatchLoads/activity.ts:62-63` and `truckLoadPlanReads.ts:103-105` read `load_id, seq`; `0085:160-161` comment ("`replaceStops()` upserts on this exact conflict key") and `0422:57-58` describe the index as the upsert arbiter.
- Fix: S0c's header lists every `(load_id, seq)` consumer and states for each whether a duplicate `seq` (A-27) changes its answer; the ETA comparison either joins on `load_stops.id` (add `stop_id` to predictions — a column, so its own two-merge step) or keeps `seq` and dedupes by `(seq, created_at)`. Without that, S0c is not ready to write.

### A-53 [WRONG] — "`native-android` is not triggered"
- Spec says (line 729): "`native-android` is not triggered."
- Evidence: `.github/workflows/ci.yml:673-675` `NATIVE_INPUTS: apps/driver/ packages/capture-engine/ pnpm-lock.yaml package.json …` — every C-A2 and C-K3 driver-app change is under `apps/driver/`, so the job builds on those PRs.
- Fix: "`native-android` runs on C-A2 and C-K3 (any `apps/driver/` change, `ci.yml:673-675`); expect its build time on those PRs."

### A-54 [IMPRECISE] — C6's stale-comment list is incomplete
- Spec says (line 32): six stale comments.
- Evidence (also stale after M-A/C-A1/N1): `apps/api/src/modules/loads/dispatchToDriver.ts:204-206` ("the order `auth_dispatched_load_ids` reads, 0371"); `apps/api/src/modules/loads/driverLoads.test.ts:51`; `supabase/tests/rls.test.mjs:2245` ("0371: the loads whose current dispatch names the calling driver"); `packages/shared/src/loadsContract.ts:163-170` (Q-LMR2 "still open"); `apps/api/src/modules/loads/mirrorLoads.ts:18-21` ("Q-LMR2 is open"; "pending stops … are replaced"); `apps/driver/src/features/loads/offerDeckModel.ts:44`; `packages/shared/src/loadOnTruck.test.ts:100` title; `0085:160-161`/`supabase/schema` comment on the seq index (S0c).
- Fix: add them to C6 with the merge that falsifies each.

### A-55 [GAP] — `driver_accept_load`/`driver_decline_load` "DL014 before any other check" leaks across tenants
- Spec says (lines 308-309): "tms → raise `DL014` … (before any other check, so the code says why)".
- Evidence: the only org/driver gate is `assert_driver_load` (`0141:72-86`). Reading `loads.source` by id before it lets any API caller learn whether an arbitrary load id is a McLeod load in another org (DL014 vs DL002).
- Fix: "after the driver-in-org check, reading `source` with `where id = p_load and org_id = p_org`; a load not in the org stays DL002".

### A-56 [OPEN] — Agent-boundary details left unspecified in spec A
- Spec says (lines 668-671): "`GET /api/tms/writes?limit=` → queued requests and `sent` ones whose last attempt is older than the lease".
- Evidence: no lease length, no `limit` bound, no max age for a queued intent (spec C has 120 s lease, ≤5 rows, 72 h `stale_intent`, `C-transport.md:480-490`). Also `p_mcleod_write` needs the load's `external_id` in `completeStop` (`driverLoads.ts:284-301` has only ids) — an extra org-scoped read not stated.
- Fix: defer all three numbers to the single pipeline contract (A-46) and state the extra read: "`completeStop` reads `loads.external_id, source` (`.eq('org_id')`) once, before the RPC".

### A-57 [OK-with-note] — RLS on new tables, evidence-family, upserts
- Spec says (lines 579, 598, 607-626).
- Evidence: both new tables `enable row level security` with no policy (deny-all, allowed by CLAUDE.md); no `.upsert()`; append-only by trigger; `RETENTION_FORBIDDEN` path `apps/api/src/modules/org/dataRetentionForbidden.ts` exists ✓; `table-modules.json` layer `core` is a valid layer (180 entries use it) ✓; `lint:table-access` waiver syntax `-- raw-access-waiver:` ✓ (`check-table-access.mjs:158`), `-- cross-module-waiver:` ✓ (`check-table-modules.mjs:181`). S0a's migration touches only `loads`-module tables by the gate's patterns (`check-table-modules.mjs:158-172` matches alter/insert/update/delete/policy, not `from`), so its `cross-module-waiver` is unnecessary but harmless; its `raw-access-waiver` IS required. M-A touches only `loads` tables (no waiver needed). M-K1 touches `mcleod` + `loads` → waiver required, present ✓.
- Note: all gates the spec names exist in `package.json`; `lint:migration-ordering`, `lint:table-modules`, `lint:schema-snapshot`, `lint:table-access`, `lint:driver-references`, `lint:shared-contracts`, `mutation:check` are not named in `ci.yml` — they run chained per their `"//lint:*"` comments; `mutation:check` runs weekly in `.github/workflows/mutation-check.yml` (`package.json:78`), not per PR — so spec line 525-527's "Mutation candidates" must be ADDED to `scripts/mutation-check.mjs` in the merge that writes the code (otherwise the weekly run never tries them), and run once locally before merge.

---

## Summary

57 findings: **WRONG 9 · GAP 22 · OPEN 4 · IMPRECISE 11 · OK-with-note 5 · OK 6**.

Citations are overwhelmingly exact (0141, 0371, 0370, 0085, 0087, 0145, driverLoads.ts, handlers.ts, outbox.ts, screens). The problems are in design steps, missing work and cross-spec contracts, not line numbers.

### The 10 most important
1. **A-46 [WRONG]** Spec A and spec C define two incompatible `mcleod_write_requests` tables (columns, status model, attempts vs outcomes, error codes, routes, switches, kinds, and C enqueues on Arrive). D relies on C's shape. One contract must win before M-K1 can be written.
2. **A-6 [OPEN]** The "owner rulings 2026-11-19" (Q-MK3/4/5, D-MK1) are not recorded anywhere. The plan still says "proposed / Next: owner rules". Record them, or mark the spec blocked.
3. **A-21 [WRONG]** N7 does not fix an Arrive that never reached the server, which is exactly the §9 airplane-mode check. The Complete syncs first, the Arrive goes to DL003 and is dead, and for a McLeod load the arrival time is lost. Needs per-stop FIFO in `claimNext`.
4. **A-13/A-14 [GAP]** Visibility-based `assert_driver_load` runs before the dedupe check. So an owner-operator decline replay, or any action after a re-dispatch or a McLeod repower, is dead-lettered (DL002 → 404 → dead). That contradicts "every action idempotent" and the spec's own evidence rationale. Two fixes: run the dedupe before the visibility check, and rule Q-MK5b.
5. **A-10/A-11 [WRONG]** Adding `p_action_id`/`p_mcleod_write` needs a DROP of the 0141 signatures plus re-issued grants. Otherwise it creates overloads (PGRST203). `assert_driver_load` cannot change its return type with `create or replace`.
6. **A-35 [WRONG]** The env switch `MCLEOD_WRITE_COMPANIES` is keyed by McLeod company, not tenant. It would switch two carriers that share a company id, and it duplicates `org_integrations.config`.
7. **A-36 [OPEN]** `clearStop` "creates a service failure record if necessary" (default `isReportable=true`). The spec never decides delayCode, isReportable or causedByType.
8. **A-31/A-32 [WRONG/GAP]** The office retry inserts into a `mcleod` table from the `loads` module, which fails `check-table-modules`. The exceptions feed cannot list refused writes as written: it only reads `load_events` kinds and resolves by `payload.resolves`.
9. **A-27/A-52/A-47 [GAP]** S0 has three problems:
   - The `deferred` arm defers forever when a removed worked stop and a new stop share a `seq`, not only on a re-sequence.
   - After S0c, duplicate `seq` breaks `(load_id, seq)` consumers (0453 ETA predictions, readers with no tie-break).
   - The RPC's fixed column list silently drops spec B's new projected `reference_numbers`.
10. **A-12/A-18/A-24/A-25 [GAP/WRONG]** Existing tests and files the spec does not account for:
    - `load-lifecycle.test.mjs:151` (DL001 becomes DL002) turns red.
    - `loadOnTruck.test.ts:100` (nextStop ignores McLeod D) turns red.
    - `mirrorLoads.test.ts` does not exist; the real tests are in `routes/tmsIngest.dispatchProjection.test.ts`.
    - Retiring `/api/tms/loads` leaves `ingestLoads` and four other table writers alive, and `loadEntityResolvers` must move out of `tmsLoadIngest.ts`.

Also notable:
- **A-33:** the `requested_by` FK to `auth.users` blocks `revokeDriverLogin`.
- **A-38:** `MW010`/`MW011` are already used by 0551.
- **A-40:** the `load_events` budget of 50/day will be exceeded about 10× once N2 is live.
- **A-53:** `native-android` does run on the driver-app merges.
- **A-43:** C-A3 needs a device-adoption condition.
