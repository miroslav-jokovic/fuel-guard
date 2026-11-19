# Spec A — Driver loads on McLeod: N1, N2, N3, N7, and the app/API half of MK3

**Status:** build spec, 2026-11-19, written read-only against `FG-mcleod-api` at `cc590a62b`
(branch `claude/mcleod-api-kit-build-plan`). Plan: `docs/plans/mcleod/MCLEOD-API-KIT-PLAN.md`
(§2, §3 Q-MK3..Q-MK7, §4 N1/N2/N3/N7, §5 MK3, D-MK1) and `LOADS-MIRROR-PLAN.md` (D-LMR1/2/5/6/7,
Q-LMR2, Q-LMR4). API surface facts: `docs/plans/mcleod/MCLEOD-API-SURFACE-2026-11-19.md`.

**Rulings this spec treats as taken (owner, 2026-11-19):** McLeod's stop time is the truth once McLeod
confirms our write (Q-MK3, answers Q-LMR2); the driver's tap is kept forever as evidence; until the
write ships, driver stop actions on `source='tms'` loads are evidence only and never move
`loads.status`; no Accept/Decline on McLeod loads, a "Got it" acknowledgement recorded in 360 only
(Q-MK4); a driver sees a McLeod load when the office dispatched it AND `driver_id` or `co_driver_id`
is the driver, in `approved, in_transit, delivered, canceled` (Q-MK5, answers Q-LMR4); the outbox
sends the client action id and every load action is idempotent, decline included (N7).

Migration numbers are written `NNNN` = "next free at build time" (latest on main today: `0636`). Each
step below names its merges; **a merge never depends on the schema of a later merge**, and since
2026-09-30 the schema may land BEFORE or AFTER the code of the same merge
(`docs/MIGRATION-DISCIPLINE.md` §"2026-09-30"), so every merge must work against both.

---

## 0. Genuine conflicts and new findings (read first)

| # | What | Where | Resolution in this spec |
|---|---|---|---|
| C1 | **Stop ids churn on every McLeod sync.** Both stop writers DELETE every `pending` stop of the load and re-INSERT it, so a pending stop gets a new `load_stops.id` (default `gen_random_uuid()`) whenever its movement changes. A driver's queued Arrive references the old id → `DL005 stop_not_found` → 404 → outbox `dead` (`policy.ts:99-101`). Harmless today only because no driver can see an approved McLeod load; **N2 makes it live.** | `apps/api/src/modules/loads/mirrorLoads.ts:102-128`; `apps/api/src/modules/mcleod/tmsLoadIngestWriters.ts:123-164` | New prerequisite **S0** (§1): stops keyed by McLeod's stop id, never deleted-and-reinserted while their McLeod stop still exists. |
| C2 | **`load_stops` stores no McLeod stop id**, and MK3's write (`POST /dispatch/clearStop/{stopId}`) needs it. Raw has it (`mcleod_dispatch_stops.stop_id`, char 32, `0364:113-117`); the projection drops it (`packages/shared/src/mcleodLoadProjection.ts:207-229`). `loads` has no McLeod order id: `external_id` = `company:movement`, `ref` = order id. | as cited | S0 adds `load_stops.mcleod_stop_id` and carries it through the projection. Company and movement are parsed from `loads.external_id` at enqueue time (MK3). |
| C3 | **Q-MK5 read literally hides every co-driver.** `auth_dispatched_load_ids()` returns loads whose CURRENT dispatch names *the caller* (`0371:37-56`). A dispatch names one person (`load_dispatches.driver_id`, `0370`). "Dispatched (that helper) AND co_driver_id = me" is therefore true only when the office dispatched the load to the co-driver — and then the primary driver loses it. The ruling's intent ("the team sees its load") cannot be built from the helper as written. | `MCLEOD-API-KIT-PLAN.md:148-151`; `0371:12-18, 37-56` | Rule implemented: **a McLeod load is visible to driver X when X holds a seat (`driver_id` or `co_driver_id`) AND the load's current dispatch names a seat-holder of that load.** A dispatch to either seat dispatches the team. 0371's other rule is kept: a load dispatched to somebody who holds no McLeod seat reaches nobody (`0371:16-18`). Flag for the owner: confirm in one line. |
| C4 | **D-MK1 says "one append-only table … states queued/sent/confirmed/refused/conflict".** An append-only row cannot carry a changing state; a single table with a mutable `state` would be the first evidence-family table whose rows change after the fact, and would lose the attempt history (sent → network loss → sent again → confirmed). | `MCLEOD-API-KIT-PLAN.md:153-158, 243` | Two append-only tables (§6.2): `mcleod_write_requests` (the intent, immutable, keyed by the client action id) and `mcleod_write_outcomes` (every state McLeod's side reached, one row each; at most one terminal). `queued` = a request with no outcome row. Same five states, same key. Proposed amendment to D-MK1's wording: "one append-only intent table and its append-only outcome log". |
| C5 | `nextStop` says "whether McLeod's departure should finish a stop in the driver app is Q-LMR2, still open". Q-MK3 rules it: McLeod's departure is truth. | `packages/shared/src/loadsContract.ts:163-174` | N1 moves the app's next-stop reading onto `isStopBehindTruck` (`loadBoard.ts:191-193`), the office's existing predicate — one definition, not a second one. |
| C6 | Stale comments that state the old visibility rule as fact (would become false): `driverLoads.ts:108-114` ("SAME predicate as `loads_driver_scope` in 0087"), `routes/me.ts:285-287`, `useLoads.ts:27-35`, `(tabs)/loads.tsx:38-45`, `loadsLifecycle.ts:18-22`, `loadsContract.ts:13-17`. | as cited | Rewritten in the merge that changes the behaviour each one describes. |
| C7 | Legacy `POST /api/tms/loads` still mounted and still a writer of `load_stops` with no McLeod stop id; the agent stopped posting it at LR4 (`tools/mcleod-agent/agent.mjs:643-645`). Reachable, it would undo S0. | `apps/api/src/modules/mcleod/routes/tmsIngest.ts`, `tmsLoadIngest.ts:474` | S0b retires the handler (410 Gone with a reason), rather than keep a second stop writer that no longer has a caller. |

No conflict with D-LMR1/2/5/6/7: nothing below writes `loads` from a driver action; the ack is the
driver's own fact in `load_events`, never a column on the mirrored load (D-LMR6's rule applied to the
other author).

---

## 1. S0 — stable stop identity (prerequisite of N1-in-production and of MK3)

### 1.1 Why
C1 + C2. After S0 a stop's `id` is stable for as long as McLeod holds that stop, which is what a
phone that queued an action hours ago needs, and `mcleod_stop_id` is what `clearStop` needs.

### 1.2 Merges (three, in order; S0c at least one RELEASE after S0b)

**S0a — migration `NNNN_load_stops_mcleod_stop_id.sql` (schema + backfill + RPC; no code).**

```sql
-- header in the repo's register: C1/C2 above, measured counts from staging before merge
-- cross-module-waiver: the one-time backfill reads mcleod_dispatch_stops (module mcleod, raw) to fill
--   loads' load_stops; the projection is the only other place that joins them (D-LMR3).
-- raw-access-waiver: same backfill; the mcleod collector's stop id is McLeod's identity of a stop.

alter table load_stops add column if not exists mcleod_stop_id text;
comment on column load_stops.mcleod_stop_id is
  'McLeod stop.id (char 32, trimmed). Identity of a projected stop: the projection upserts on (load_id, mcleod_stop_id) and never deletes a stop McLeod still has, so load_stops.id is stable for the phone (S0). Null on a manual load.';

-- Non-partial on purpose: PostgREST's onConflict cannot name a partial index's predicate, and NULLs are
-- distinct, so manual rows (null) never collide.
create unique index if not exists uq_load_stops_load_mcleod_stop on load_stops (load_id, mcleod_stop_id);

-- Backfill: every stop of a McLeod load the projection can still touch. The projection writes only
-- movements present in raw, so a row it can reach always finds its raw stop here.
update load_stops ls
   set mcleod_stop_id = btrim(s.stop_id)
  from loads l
  join mcleod_dispatch_stops s
    on s.org_id = l.org_id
   and l.external_id = s.company_id || ':' || s.movement_id
 where ls.load_id = l.id
   and l.source = 'tms' and l.provider = 'mcleod'
   and s.movement_sequence = ls.seq
   and ls.mcleod_stop_id is null;
```

Plus `public.apply_mcleod_load_stops(p_org uuid, p_stops jsonb) returns jsonb`, `security definer`,
`set search_path = ''`, revoked from `public, anon, authenticated`, granted to `service_role`
(0141's grant block shape). One call per projection batch. Per load, inside its own
`begin … exception when unique_violation … end` block:

1. refuse a load that is not `source='tms'` in `p_org` (`LS001`);
2. **claim** rows with `mcleod_stop_id is null` by `(load_id, seq)` (rows the old writer inserted
   during the S0a→S0b window);
3. delete rows of that load with `status = 'pending'` whose `mcleod_stop_id` is null or not in the
   incoming set — a stop McLeod removed and nobody worked; a worked stop (`arrived/completed/skipped`)
   is evidence and is never deleted (the rule `mirrorLoads.ts:20` and `tmsLoadIngestWriters.ts:118-121`
   already state);
4. `insert … on conflict (load_id, mcleod_stop_id) do update set` every PROJECTED column (`seq, kind,
   name, address_line, city, state, postal_code, lat, lon, appointment_start, appointment_end,
   location_name, location_code, external_status, actual_arrival_at, actual_departure_at, eta_at,
   contact_name, contact_phone, po_number, required_photos, updated_at`). **Never** `status,
   arrived_at, completed_at, skip_reason` — the driver's columns.

The `exception when unique_violation` arm adds the load id to `deferred` in the returned
`{written, deferred}` and leaves that load's stops as they were. It exists for exactly one case: McLeod
re-sequenced a movement while `idx_load_stops_load_seq` (unique, `0085:162`) still exists; a
non-deferrable unique index is checked per row, so a shift (stop 2 → 3, 3 → 4) collides mid-statement.
The arm's comment says, in the repo's register, that it is TRANSITIONAL, what it works around
(`idx_load_stops_load_seq` uniqueness), and that S0c removes it.

Tests (S0a merge): new matrix `supabase/tests/load-stops-mcleod-identity.test.mjs` (must print
`RESULT`, `await db.close()` first — `lint:matrix-exit`). Titles:
- "a projected stop keeps its id across two applies"
- "a pending stop McLeod removed is deleted"
- "a worked stop McLeod removed is kept (evidence)"
- "the driver's status, arrived_at, completed_at and skip_reason survive an apply"
- "a row without a McLeod stop id is claimed by its sequence, not duplicated"
- "a load of another organization is refused (LS001)"
- "a manual load is refused (LS001)"
- "a re-sequenced movement is deferred, not failed, while the sequence index is unique"
- "the backfill fills mcleod_stop_id from raw by movement and sequence"
- definer-grant: "apply_mcleod_load_stops is not executable by anon or authenticated" (also covered by
  `rls.test.mjs:2222-2268`'s class check, which needs no edit — it takes parameters).

**S0b — code (after S0a reports `schema.state = current` on staging, `pnpm verify:live staging`).**
- `packages/shared/src/mcleodLoadProjection.ts`: `ProjectedStop` (`:57-78`) gains
  `mcleod_stop_id: string`; the stop mapper (`:207-229`) sets `mcleod_stop_id: s.stop_id.trim()`.
  `mcleodLoadProjection.test.ts`: "every projected stop carries McLeod's stop id, trimmed".
- `packages/shared`: new `MCLEOD_REQUIRED_PHOTOS` is NOT added here — N5 owns it; S0b keeps
  `mirrorLoads.ts:120`'s literal and moves it into the RPC payload unchanged.
- `apps/api/src/modules/loads/mirrorLoads.ts:102-128`: `writeStops` becomes one
  `admin.rpc("apply_mcleod_load_stops", { p_org, p_stops })` per 500 stops (grouped so a load's stops
  never split across calls); `deferred` load ids are logged as `[mcleod-mirror] stops deferred: …` and
  counted in `MirrorWriteResult` (new field `stopsDeferred`). The `.delete()` and the
  `.upsert(…, { onConflict: "load_id,seq" })` go.
- `scripts/table-writers.json:490-493`: `load_stops` loses `mirrorLoads.ts` (no `.from` write left)
  and `tmsLoadIngestWriters.ts`; the RPC body is the producer (`check-table-producers` DML scan).
- C7: the `POST /loads` handler in `apps/api/src/modules/mcleod/routes/tmsIngest.ts` answers
  `410 { code: "retired_feed", message: "Loads arrive through the mirror since LR4" }`;
  `tmsLoadIngestWriters.writeStops` and its now-unreferenced helpers are deleted with their tests.
- Tests: `mirrorLoads.test.ts` "stops go through apply_mcleod_load_stops with every projected column
  and none of the driver's" (recorder: assert the rpc args), "a deferred load is reported, not
  thrown"; `tmsIngest` route test "POST /api/tms/loads is 410 retired_feed".

**S0c — migration (≥ one release after S0b is in production; check with `pnpm verify:live`).**
`drop index if exists idx_load_stops_load_seq; create index if not exists idx_load_stops_load_seq_order
on load_stops (load_id, seq);` and `create or replace` `apply_mcleod_load_stops` without the
exception arm. Matrix title flips to "a re-sequenced movement is applied in one call". Why a release
apart: in a release, migrations run before code; S0c with S0b's predecessor still serving would break
`onConflict: "load_id,seq"` ("no unique or exclusion constraint matching") for the deploy minutes.

Staging check (S0): pick a dispatched staging movement, note `load_stops.id`s, wait for two sweeps
(`select id, mcleod_stop_id, updated_at from load_stops where load_id = …`), ids unchanged,
`updated_at` moved.

---

## 2. N2 — who sees a McLeod load (do it with N1 in one migration; §2 then §3)

### 2.1 One definition, three callers (deriving beats restating)
Today the rule lives in four places: three RLS policies (`0371:62-100`), `auth_dispatched_load_ids()`
(`0371:37-56`), `driverLoads.ts:85-106,120-132` (restated for the service role), and
`DRIVER_VISIBLE_STATUSES` (`loadsLifecycle.ts:23-29`). After N2 it lives in ONE SQL function, and the
policies, `assert_driver_load` and the API all call it.

### 2.2 Migration M-A `NNNN_driver_loads_mcleod_channel.sql` (N1+N2+N3+N7 SQL together)

```sql
-- The whole visibility predicate. Service role only (it takes a tenant and a driver: 0162's rule).
create or replace function public.driver_visible_load_ids(p_org uuid, p_driver uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select l.id
    from public.loads l
    left join lateral (
      select d.driver_id
        from public.load_dispatches d
       where d.org_id = l.org_id and d.load_id = l.id
       order by d.sent_at desc, d.id desc          -- 0371's order, unchanged
       limit 1
    ) cur on l.source = 'tms'
   where l.org_id = p_org
     and p_driver is not null
     and (l.driver_id = p_driver or l.co_driver_id = p_driver)
     and (
       ( l.source = 'tms'
         and l.status in ('approved', 'in_transit', 'delivered', 'canceled')        -- Q-MK5
         and cur.driver_id in (l.driver_id, l.co_driver_id) )                       -- C3
       or
       ( l.source <> 'tms'
         and l.status in ('offered', 'accepted', 'in_transit', 'delivered', 'canceled') )  -- 0087, unchanged
     );
$$;
revoke all on function public.driver_visible_load_ids(uuid, uuid) from public, anon, authenticated;
grant execute on function public.driver_visible_load_ids(uuid, uuid) to service_role;

-- The caller-scoped wrapper the policies call (no parameter, reads only the caller's claims).
create or replace function public.auth_driver_visible_load_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$ select public.driver_visible_load_ids(public.auth_org_id(), public.auth_driver_id()); $$;
-- EXECUTE stays with authenticated/anon (0412 default-deny means grant it explicitly):
grant execute on function public.auth_driver_visible_load_ids() to anon, authenticated, service_role;

drop policy if exists loads_driver_scope on loads;
create policy loads_driver_scope on loads as restrictive for select
  using (auth_role() <> 'driver' or id in (select public.auth_driver_visible_load_ids()));

drop policy if exists load_stops_driver_scope on load_stops;
create policy load_stops_driver_scope on load_stops as restrictive for select
  using (auth_role() <> 'driver' or load_id in (select public.auth_driver_visible_load_ids()));

drop policy if exists load_events_driver_scope on load_events;
create policy load_events_driver_scope on load_events as restrictive for select
  using (auth_role() <> 'driver' or load_id in (select public.auth_driver_visible_load_ids()));

drop function if exists public.auth_dispatched_load_ids();   -- its three readers were replaced above
```

Why `id in (select …)` and not `exists`: uncorrelated, Postgres runs it once per query (0371's note);
and the stop/event policies no longer depend on `loads_driver_scope` re-evaluating under RLS (0368's
"defence in depth that no row here can isolate" caveat goes away — each scope now states the rule).
Check before merge: `0412` default-deny — confirm on PGlite that `anon` can execute the wrapper, or an
anonymous read of `loads` errors instead of filtering (the 0371 matrix's last assertion).

`assert_driver_load` (`0141:59-89`) is replaced in the same migration: the "owns the load" check
becomes `p_load in (select public.driver_visible_load_ids(p_org, p_driver))`, still raising `DL002`
for both "foreign driver" and "not yours". This closes a hole that exists today: a McLeod driver can
act on an UNDISPATCHED McLeod load by id through the API, because `assert_driver_load` checks only
`driver_id`. It also admits the co-driver to every action.

Not changed, stated: `load_stop_photos_driver_scope` (`0085:245-251`, own rows only) and
`load_stop_photos_driver_insert` (`0085:257-267`, `driver_id` seat only) — no client inserts photos
(the RPC does, as service role), and the app reads photos through the API. Storage
`load_photos_driver_read` (`0085:290-296`) is own-folder only, so a co-driver's app shows a
teammate's photo as a filled slot without a thumbnail (§3.5).

### 2.3 Shared contract (merge C-A1)
- `packages/shared/src/loadsLifecycle.ts:18-33`: delete `DRIVER_VISIBLE_STATUSES` and
  `isDriverVisible`. Their only runtime reader is `driverLoads.ts:126`, which C-A1 replaces with the
  RPC; a TS copy of a SQL rule with no reader is a copy with a delay fuse. `loadsLifecycle.test.ts:16-31`
  ("exposes exactly the five statuses…", "hides everything before release") are deleted and their
  promise moves to the PGlite matrix (§2.5), which tests the one definition.
- `loadsContract.ts:13-17` comment rewritten to point at `driver_visible_load_ids`.
- `loadSchema` (`loadsContract.ts:92-108`) gains `source: z.enum(["manual", "tms"])` (column exists
  since 0085 — no ordering issue) — required (see rollout §8 for why the API ships it a release
  before the app reads it).

### 2.4 API (merge C-A1, after M-A is `current` on staging; production: M-A released first)
`apps/api/src/modules/loads/driverLoads.ts`:
- delete `loadsDispatchedTo` (`:79-106`);
- `getDriverLoads` (`:115-132`): `const { data: ids, error } = await admin.rpc("driver_visible_load_ids",
  { p_org: orgId, p_driver: driverId })` (throw on error — a silent empty list is how a driver loses
  their load), then `.from("loads").select(LOAD_COLUMNS).eq("org_id", orgId).in("id", ids)` via
  `chunks()` (`lib/paging.ts`, IN_LIST_CHUNK — memory "`.in()` overflows Node 22"); no `.eq("driver_id")`,
  no status filter, no `.or()` — the function is the filter;
- `LOAD_COLUMNS` (`:67-69`) adds `source`; doc comment `:108-114` rewritten.
- This is a reader of a function M-A creates → **separate merge after M-A** (memory
  "hold-a-function-reader-behind-its-migration"; `lint:migration-ordering` sees columns, not functions).

### 2.5 Tests
- `supabase/tests/loads-mirror-status-guard.test.mjs:115-195` — rewrite §3 against the new helper:
  - "an UNSENT tms load in transit is invisible to its own driver" (kept)
  - "a dispatched McLeod load in APPROVED is visible to its driver" (new — the N2 bug)
  - "…and to its co-driver" / "…and its stops and events, to both seats"
  - "a dispatch to the co-driver dispatches the team: the primary driver sees it too" (C3)
  - "a load dispatched to a driver who holds no McLeod seat reaches nobody" (0371:16-18 kept)
  - "re-dispatched to somebody else, the load leaves the first driver's app" (kept)
  - "a McLeod load in pending_approval (uncovered) is never visible, dispatched or not"
  - "a McLeod load never shows as offered/accepted — those statuses are the manual chain's"
  - "auth_driver_visible_load_ids names the driver's own visible loads, and only those"
  - "an anonymous read of loads is filtered, not an error" (kept)
  - "a manual load the office released is visible to its driver, as before" (kept)
  - "driver_visible_load_ids answers the same set the policy does, for both seats" (parity)
- `supabase/tests/rls.test.mjs:2246` and `supabase/tests/definer-rpc-grants.test.mjs:142`: replace
  `auth_dispatched_load_ids` with `auth_driver_visible_load_ids` in `CALLER_SCOPED_HELPERS` / `RLS_HELPERS`
  (same merge as M-A, or both matrices go red).
- `load-lifecycle.test.mjs`: "assert_driver_load refuses an undispatched McLeod load (DL002)";
  "the co-driver may act on a team load".
- `apps/api/src/modules/loads/driverLoads.test.ts` rewritten: "asks driver_visible_load_ids with this
  org and driver, and reads only those ids, org-scoped" (`expectOrgScoped`); "reads no load at all when
  the function returns none"; "an RPC error throws instead of answering an empty list".

---

## 3. N1 — stop actions are evidence on McLeod loads; the app reads stop state

### 3.1 SQL (in M-A): `driver_complete_stop` replaced
Same signature as `0141:266-276` **plus `p_action_id uuid default null` and (MK3, §6)
`p_mcleod_write boolean default false` as trailing defaults** — added now, behind defaults, so old API
calls resolve to the single new function (no overload: two overloads with defaults make PostgREST
ambiguous, PGRST203). Body changes against `0141:280-400`:

1. `v_load_source` read beside `v_load_status` (extend `assert_driver_load` to return
   `status` and `source`, or a second `select`; keep DL002 semantics).
2. **N7 dedupe first** (§5.2).
3. Status gate (`0141:304-306`) becomes per source:
   manual → `accepted, in_transit` (unchanged); tms → `approved, in_transit, delivered, canceled`.
   Reason for admitting delivered/canceled on tms: the phone may sync hours after the tap, McLeod may
   have closed or voided the movement meanwhile, and the evidence row "never depends on McLeod"
   (D-MK1). Refusing would dead-letter a real arrival (`policy.ts:99-101`).
4. Replay/terminal checks (`0141:310-315`) unchanged.
5. **No fabricated arrival on tms.** `0141:342`: `arrived_at = case when p_status in ('arrived','completed')
   and arrived_at is null then v_now …`. For tms, `completed` from `pending` leaves `arrived_at` null:
   McLeod's `clearStop` would otherwise receive an arrival the driver never recorded (MK3). Manual
   unchanged.
6. **Load untouched on tms.** Skip `0141:364-370` (`accepted → in_transit` + `started` event) and
   `0141:389-399` (`delivered` + `completed_at` + `completed` event) when `v_load_source = 'tms'`.
   `loads.status` stays McLeod's projection (D-LMR2); `loads.completed_at` stays null on every McLeod
   load (already documented as true, `loadActivity.ts:14`).
7. The `stop_*` event and photos are written exactly as today; the event's id is `p_action_id` (§5).

`driver_start_load` (`0141:232-261`): tms → raise `DL013` "a McLeod load starts at its first stop".
`driver_accept_load` / `driver_decline_load`: tms → raise `DL014` "McLeod loads are not accepted or
declined in the app" (before any other check, so the code says why). Both also gain `p_action_id`.

### 3.2 API (C-A1)
`driverLoads.ts:39-47` `PG_TO_API` adds
`DL012: 422 action_id_reused "That action was already used for something else"`,
`DL013: 409 mcleod_load_has_no_start "This load starts when you arrive at the first stop"`,
`DL014: 409 mcleod_load_no_offer "Call dispatch about this load"`. A 409 goes to the app's Needs
attention list (`policy.ts:99-101`) — correct for these: the world will not change on retry.

### 3.3 Shared derivations (C-A1) — new file `packages/shared/src/driverLoadPhase.ts`
Moved here from `loadsContract.ts:152-188` (`loadBucket`, `nextStop`, `stopProgress`) to avoid a
`loadsContract ↔ loadBoard` import cycle; re-exported from `index.ts` so every importer is unchanged.
- `nextStop(load)` → `nextStopOnRoute(load.stops)` (`loadBoard.ts:197-200`), i.e.
  `isStopBehindTruck` (`:191-193`): driver-done OR McLeod `D`. C5.
- `stopProgress(load)` counts `isStopBehindTruck`.
- `driverLoadPhase(load, ackedByMe)`: `'awaiting_ack' | 'upcoming' | 'current' | 'previous'`.
  - manual: `loadBucket(load.status)` exactly as today (offered stays the offer deck).
  - tms: `previous` if status `delivered|canceled` or every stop `isStopBehindTruck`; `current` if
    status `in_transit` or any stop's driver `status <> 'pending'`; else `awaiting_ack` when
    `!ackedByMe`, else `upcoming`.
  This is "the app derives its UI state from stop state": the driver's first Arrive puts the load in
  Current without anybody moving `loads.status`.
- `loadStopSchema` (`loadsContract.ts:69-89`) gains `external_status`, `actual_arrival_at`,
  `actual_departure_at` (nullable; columns exist since 0366; this is the slice of N4 the phase needs;
  N4 adds the rest). API `STOP_COLUMNS` (`driverLoads.ts:71-73`) adds them.
- Tests `driverLoadPhase.test.ts`: "a dispatched McLeod load nobody touched awaits Got it",
  "after Got it it is upcoming", "the driver's first Arrive makes it current with loads.status still
  approved", "McLeod's in_transit makes it current before the driver taps anything", "a stop McLeod
  departed is behind the driver even if they never tapped it", "every stop behind → previous even
  while McLeod says in_transit", "delivered/canceled → previous", "a manual offered load is still an
  offer", "nextStop skips a stop McLeod departed".

### 3.4 Driver app (C-A2, after C-A1 is in production)
- `src/features/loads/loadViewModel.ts:53-55`: `bucketLoads` buckets by `driverLoadPhase`
  (`awaiting_ack` goes in `upcoming`, ordered first). Callers unchanged (`home.tsx:63`,
  `duty/end-shift.tsx:80`, `(tabs)/loads.tsx:55`).
- `src/features/loads/loadStatus.ts:6-22`: `driverLoadStatus(load, ackedByMe)` from the phase; new
  `dispatched` entry `{ label: 'Dispatched', tone: 'info', icon: 'schedule' }` for tms
  awaiting/upcoming; `upcoming` keeps "Accepted" for manual only.
- `app/loads/[id].tsx:84-160`: `working` = phase `current`; footer: manual branch unchanged (`offered`
  → accept/decline, `accepted` → Start); tms: `awaiting_ack` → "Got it" (§4); otherwise → next-stop
  button whenever `next` exists (no Start step on McLeod loads — DL013).
- `app/loads/[id]/stop/[stopId].tsx:160-190`: for `load.source === 'tms'` and `stop.status ===
  'pending'`, the primary button is **"I'm here"** (`submit('arrived')`); "Complete stop" appears
  once arrived; a secondary text button **"I already left — finish without an arrival time"** submits
  `completed` (no fabricated arrival, §3.1 step 5). Manual unchanged. When McLeod already departed the
  stop (`mcleodStopDeparted(stop.external_status)`), a Banner says "Dispatch has this stop done at
  {time}. You can still add your photos." and Complete stays available (evidence).
- `useLoads.ts:101-144` `patchStop`: unchanged; `patchLoad` no longer invoked for tms.
- Tests: `loadViewModel.test.ts` "an approved McLeod load the driver arrived at is in current";
  `loadStatus.test.ts` "a McLeod load is Dispatched, never Accepted".

### 3.5 Office (C-A1)
`DispatchLoadDetailPage.vue:70-83` timeline facts: "Delivered" reads `completed_at`, now always null
on tms — correct (McLeod's delivery is on the stops). Stop rows already show McLeod's time beside the
driver's (LOADS-MIRROR-PLAN progress log :669). No change beyond §4.4.

### 3.6 Everything that relied on the old behaviour (grep 2026-11-19)
| Reliance | Where | After N1/N2/N3 |
|---|---|---|
| driver stop moves tms load to `in_transit`/`delivered` | `0141:364-399` | stops for tms; nothing read it for tms (0 tms loads were driver-visible) |
| `loads.completed_at` set by driver | `0141:395`; read `DispatchLoadDetailPage.vue:80`, `useDispatchLoads.ts:109,139`, `loadViewModel.ts:61` (history sort) | null on tms; history sort falls back to `created_at` → change to last stop's `actual_departure_at ?? completed_at ?? created_at` (`loadViewModel.ts:61`) |
| `status === 'offered'` | `(tabs)/loads.tsx:81-97`, `[id].tsx:118`, `loadStatus.ts:10`, `offerDeckModel.ts:40,47`, `UpNext.tsx:17`, `todayModel.ts:251`, `loadBoard.ts:171,175`, `sampleOffers.ts`, `gallery.tsx` | manual only; tms never offered (`mcleodLoadProjection.ts:136-149`); unchanged code is correct for manual. `UpNext.tsx:17` adds the `awaiting_ack` reading ("New load — tap to confirm") |
| `accepted_at` | `driverLoads.ts:68,239`, `loadsContract.ts:100,124`, `useLoads.ts:151-157`, `DispatchLoadDetailPage.vue:78`, `useDispatchLoads.ts:138` | untouched; never written for tms; the ack is NOT stored there (D-LMR6) |
| `driver_accept_load` / `driver_decline_load` / `driver_start_load` | `driverLoads.ts:229-277`, `me.ts:342-381`, `load-lifecycle.test.mjs:140-187` | tms refused (DL014/DL013); manual unchanged |
| `DRIVER_VISIBLE_STATUSES` / `isDriverVisible` | `driverLoads.ts:3,126`, `loadsLifecycle.test.ts:5-31` | deleted (§2.3) |
| `auth_dispatched_load_ids` | `0371` policies, `rls.test.mjs:2246`, `definer-rpc-grants.test.mjs:142`, `loads-mirror-status-guard.test.mjs:156-168` | dropped, replaced (§2.2) |
| `nextStop` driver-only reading | `loadRows.tsx:16`, `itineraryModel.ts:110`, `TodayHero.tsx:105,197`, `[id].tsx:82` | now `isStopBehindTruck` (C5) |

---

## 4. N3 — no Accept/Decline on McLeod loads; "Got it"

### 4.1 Where the acknowledgement lives — `load_events`, kind `acknowledged`
Not `load_dispatches`: that row is the office's act and its guard freezes every column except a merge's
`driver_id` (`0370:107-140`); the ack is a different fact by a different author (D-LMR7's own
reasoning). Not `loads.accepted_at`: the mirrored load is McLeod's (D-LMR6). `load_events` is already the
append-only, driver-readable timeline (`0087:110-195`), and the ack is a timeline fact. It names the
dispatch it answers: a re-send is a new dispatch and needs a new "Got it".

M-A: `alter table load_events drop constraint load_events_kind_check` + re-add with `'acknowledged'`
appended to `0145:21-29`'s list.

```sql
create function public.driver_acknowledge_load(
  p_org uuid, p_driver uuid, p_load uuid, p_action_id uuid,
  p_actor_user uuid default null, p_occurred_at timestamptz default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_source text; v_dispatch uuid; v_now timestamptz := coalesce(p_occurred_at, now());
begin
  perform public.assert_driver_load(p_org, p_driver, p_load);        -- visibility (§2.2), DL002
  select source into v_source from public.loads where id = p_load;
  if v_source <> 'tms' then raise exception 'a manual load is accepted, not acknowledged' using errcode = 'DL014'; end if;
  -- N7: the same action replayed
  if exists (select 1 from public.load_events where id = p_action_id) then
    if exists (select 1 from public.load_events where id = p_action_id and load_id = p_load and kind = 'acknowledged') then return; end if;
    raise exception 'action id reused' using errcode = 'DL012';
  end if;
  select d.id into v_dispatch from public.load_dispatches d
   where d.org_id = p_org and d.load_id = p_load order by d.sent_at desc, d.id desc limit 1;
  -- A second "Got it" for the same dispatch by the same driver (two phones, a double tap) is a no-op.
  if exists (select 1 from public.load_events e where e.load_id = p_load and e.kind = 'acknowledged'
              and e.payload->>'dispatch_id' = v_dispatch::text and e.payload->>'driver_id' = p_driver::text) then return; end if;
  insert into public.load_events (id, org_id, load_id, actor_user_id, actor_role, kind, payload, occurred_at)
  values (p_action_id, p_org, p_load, p_actor_user, 'driver', 'acknowledged',
          jsonb_build_object('dispatch_id', v_dispatch, 'driver_id', p_driver), v_now)
  on conflict (id) do nothing;
end $$;
-- revoke from public, anon, authenticated; grant to service_role (0141:403-417 shape)
```
Both seats acknowledge separately; the office sees each.

### 4.2 Shared (C-A1)
- `loadsLifecycle.ts:150-191`: `LOAD_EVENT_KINDS` += `"acknowledged"`; `LOAD_EVENT_LABELS.acknowledged =
  "Seen by driver"`. Must ship no later than the first row can exist; the first writer is C-A1's route,
  so same merge is safe.
- `acknowledgeLoadRequestSchema = z.object({ action_id: recordId(), occurred_at: z.string().optional() })`.
- `loadSchema` += `acknowledged_at: z.string().nullable()` — this driver's ack of the CURRENT dispatch.
- `LoadDispatchSummary` (`loadDispatchContract.ts:64-72`) += `acknowledgements: { driverId: string;
  driverName: string | null; at: string }[]`.

### 4.3 API (C-A1)
- `routes/me.ts`: `POST /loads/:id/acknowledge` through `runLoadMutation` (`:309-340`), audit action
  `load.acknowledged`. `me.ts` is 444 lines; +15 crosses the 450 warn line — acceptable, under 500
  (`lint:filesize`); if it would cross 500, move the five load routes to `routes/meLoads.ts`.
- `driverLoads.ts`: `acknowledgeLoad()` → `runRpc("driver_acknowledge_load", { p_action_id, … })`;
  `getDriverLoads` derives `acknowledged_at` with one read: current dispatch per visible tms load
  (`load_dispatches` newest per load, chunked) and `load_events` `kind='acknowledged'` for those loads
  whose `payload->>driver_id` = me and `payload->>dispatch_id` = current.
- `dispatchToDriver.ts:208-254` `dispatchesByLoad`: one more chunked read of `load_events`
  (`kind='acknowledged'`, `.in("load_id", ids)`, `.eq("org_id")`), names via the `driver_names`
  surface or `drivers(full_name)` lookup, attached per dispatch id.

### 4.4 Driver app (C-A2)
- `useLoads.ts`: `useAcknowledgeLoad()` enqueues `{ id: newClientId(), kind: LOAD_ACK_KIND, payload:
  { load_id, occurred_at } }` and patches `acknowledged_at` optimistically; `useAcceptLoad` /
  `useDeclineLoad` / `useStartLoad` are only ever offered for manual loads.
- `handlers.ts:24-27,117-120`: `LOAD_ACK_KIND = 'load_ack'`, `registerHandler(LOAD_ACK_KIND,
  loadHandler('acknowledge'))`; `FailedSyncList.tsx:26-38` `KIND_LABEL[LOAD_ACK_KIND] = 'Confirming a load'`.
- `(tabs)/loads.tsx`: tms loads never reach `orderOffers` (`status !== 'offered'`); the Upcoming list
  puts `awaiting_ack` first with a "Got it" button on the row (`loadRows.tsx` `UpcomingRow` gains an
  optional `onAcknowledge`). Empty-state copy (`:31-36`) "once dispatch releases them" → "once dispatch
  sends them".
- `[id].tsx` footer for `awaiting_ack`: one primary "Got it" (icon `check_circle`), no secondary.
  The ack is not a gate: stop rows stay tappable before it (a driver at a dock with no signal must
  still be able to work the stop; nothing in the ruling makes the ack a precondition).

### 4.5 Web (C-A1)
- `useLoadDispatch.ts:69-73` `dispatchHeadline`: appends ` · Seen {MM/DD/YYYY h:mm}` (one ack) or
  ` · Seen by Dixon {time}, Houston —` (team), via `formatDateTime` (`lint:date-format`).
- `DispatchLoadDetailPage.vue:211-213` dispatch fact shows it; the events list (`:332-345`) shows the
  `acknowledged` event with its label automatically. `DispatchLoadsPage.vue:479` board cell same headline.
- Tests: `useLoadDispatch.test.ts` "a dispatch seen by its driver says Seen with the time", "a team
  dispatch names who has seen it and who has not"; `DispatchLoadDetailPage.test.ts` "the dispatch fact
  shows the driver's acknowledgement".

### 4.6 SQL tests (`supabase/tests/driver-load-actions.test.mjs`, new matrix)
"Got it records one acknowledged event naming the current dispatch"; "a replayed Got it writes
nothing"; "Got it from a second phone for the same dispatch writes nothing"; "after a re-send, Got it
records a new acknowledgement"; "both seats of a team acknowledge separately"; "a manual load is
refused (DL014)"; "an undispatched McLeod load is refused (DL002)"; "accept on a McLeod load is
refused (DL014)"; "decline on a McLeod load is refused (DL014)"; "start on a McLeod load is refused
(DL013)".

---

## 5. N7 — the client action id, and idempotency for every load action

### 5.1 Mechanism: the action id IS the primary event's `load_events.id`
The repo's idempotency pattern is "the client UUID becomes the domain row's primary key"
(`outbox.ts:46`; photos `0141:348-361`; messages `handlers.ts:158-161`). So no new column and no
deploy-window step: each function inserts its primary event with `id = p_action_id` (`on conflict (id)
do nothing`). Primary event per action: accept → `accepted`; decline → `declined`; start → `started`;
stop → `stop_arrived|stop_completed|stop_skipped`; ack → `acknowledged`. Secondary events
(`equipment_mismatch`, manual `started`/`completed`) keep `gen_random_uuid()`.

### 5.2 Dedupe rule, identical in all five functions (written once as a helper)
```sql
create or replace function public.load_action_seen(p_action_id uuid, p_load uuid, p_kinds text[])
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if p_action_id is null then return false; end if;                  -- legacy caller: state-based checks only
  if not exists (select 1 from public.load_events where id = p_action_id) then return false; end if;
  if exists (select 1 from public.load_events where id = p_action_id and load_id = p_load and kind = any (p_kinds)) then
    return true;                                                       -- the same action, replayed: no-op
  end if;
  raise exception 'action id % reused for a different action', p_action_id using errcode = 'DL012';
end $$;   -- service_role only
```
Called right after `assert_driver_load`; `true` → `return`. This fixes, beyond decline:
- **decline replay** (`0141:216-224` writes a second `declined` event each time) — gone;
- **arrive retried after complete** — `claimNext` picks the oldest *due* record (`outbox.ts:95-110`),
  so a timed-out Arrive in backoff lets the younger Complete sync first; the retried Arrive then hits
  `stop already completed` (`0141:313-315`) → 409 → `dead`. With the action id the retried Arrive finds
  its own `stop_arrived` event and no-ops.
State-based idempotency (`0141:118-121, 249-251, 310-312`) stays for `p_action_id is null` callers.

### 5.3 Contract and transport
**Body field, not a header.** `action_id: recordId()` on `acceptLoadRequestSchema`,
`declineLoadRequestSchema`, `startLoadRequestSchema`, `completeStopRequestSchema`,
`acknowledgeLoadRequestSchema`: the request schema is the contract's one home (`lint:shared-contracts`),
`validateBody` checks it with `recordId()` (`lint:record-id`), and a header would bypass both.
- C-A1: optional on the four existing schemas (`.optional()`), required on the new ack schema.
- C-A2: `handlers.ts:48-60` `loadHandler` and `:126-156` stop handler send
  `action_id: record.id` — the **outbox record's id**, read from the record, not the payload, so a
  record queued by an older build carries one too (the outbox survives an app update — `handlers.ts:225-230`).
- C-A3 (after C-A2 is in production): `.optional()` removed on the four schemas.
- API `driverLoads.ts` passes `p_action_id: input.action_id ?? null` in every `runRpc`.

### 5.4 Tests
Matrix `driver-load-actions.test.mjs`: "a replayed decline writes one declined event, not two"; "a
replayed arrive after the stop completed is a no-op, not DL003"; "an action id reused on another load
is refused (DL012)"; "an action id reused for another kind is refused (DL012)"; "the primary event's
id is the action id"; "a call without an action id keeps 0141's state-based idempotency". API
`driverLoads.test.ts`: "every load action passes the action id to its function". App
`handlers.test.ts` (or `policy.test.ts` neighbour): "a load action posts the outbox record id as
action_id"; "a record queued before this build still posts its record id". Mutation candidates for
`scripts/mutation-check.mjs`: drop `load_action_seen` call in `driver_decline_load`; drop the
`kind = any(p_kinds)` clause.

---

## 6. MK3 — the first McLeod write: stop departure through the write pipeline (app/API half)

The agent transport (claiming, calling `/ws`, reading back) is another spec; this section fixes the
table contract jointly (D-MK1) and everything on the app and API side. **Nothing here sends to McLeod
until D-MK3** (test company passes) and B-MK1..5/9.

### 6.1 How taps map to `clearStop` (one call, both dates)
`POST /dispatch/clearStop/{stopId}?arrivalDate=&departureDate=` "clears the stop" — it is McLeod's
departure act; `/dispatch/{stopId}/arrive|depart` are LTL-only (SURFACE doc). So:
- **Arrive** → evidence only, no write request. Writing on arrival would mark the stop departed in
  McLeod. The office sees the driver's arrival in 360 meanwhile (N9).
- **Complete** (departure) → ONE write request carrying `arrival_at = load_stops.arrived_at` (the
  driver's Arrive tap, or **null** if they used "I already left", §3.4) and `departure_at` = the
  completion's `occurred_at`.
- **Skip** → no write request: a skip asserts the driver did not work the stop; clearing it in McLeod
  would assert times that never happened. The `stop_skipped` event is the office's prompt.
- **Arrival null**: whether `clearStop` accepts `departureDate` alone is unknown until our `/ws/docs`
  (MK0). The agent spec decides by that answer; if McLeod requires both, the outcome is `refused`
  with `reason_code = 'arrival_unknown'` and the office keys the arrival in McLeod. Never a guessed time.
- `hub` (odometer) is not sent; no driver-side odometer is trusted for it (Samsara's is a later D-MK2 row).

### 6.2 The tables (migration M-K1, after S0b is live — `mcleod_stop_id` populated)
Owner module `mcleod`, layer `core` (user-authored intents and McLeod's answers, not collector staging).
```sql
-- cross-module-waiver: driver_complete_stop (module loads) enqueues the write in the same transaction
--   as its evidence row, so a stop is never completed without its write intent or vice versa (D-MK1).
create table if not exists mcleod_write_requests (
  id              uuid primary key,          -- the client action id = the stop_completed event's id (§5)
  org_id          uuid not null references organizations(id) on delete cascade,
  operation       text not null constraint mcleod_write_requests_operation_check check (operation in ('stop_clear')),
  load_id         uuid not null references loads(id) on delete restrict,
  stop_id         uuid not null references load_stops(id) on delete restrict,   -- a completed stop is never deleted (S0)
  company_id      text not null,             -- AnywhereCompanyID, split_part(loads.external_id, ':', 1)
  movement_id     text not null,             -- split_part(loads.external_id, ':', 2)
  mcleod_stop_id  text not null,
  arrival_at      timestamptz,               -- the driver's; null when they never tapped Arrive (§6.1)
  departure_at    timestamptz not null,
  expected        jsonb not null,            -- McLeod's stop as 360 last saw it: external_status, actual_arrival_at, actual_departure_at, seen_at
  origin          text not null constraint mcleod_write_requests_origin_check check (origin in ('driver_app', 'office_retry')),
  supersedes      uuid references mcleod_write_requests(id) on delete restrict,
  requested_by    uuid not null references auth.users(id),
  requested_at    timestamptz not null default now(),
  constraint mcleod_write_requests_retry_check check ((origin = 'office_retry') = (supersedes is not null))
);
create unique index if not exists uq_mcleod_write_requests_driver_stop
  on mcleod_write_requests (stop_id, operation) where origin = 'driver_app';   -- one driver intent per stop
create unique index if not exists uq_mcleod_write_requests_supersedes on mcleod_write_requests (supersedes);
create index if not exists idx_mcleod_write_requests_org_load on mcleod_write_requests (org_id, load_id);
alter table mcleod_write_requests enable row level security;   -- no client policy: deny-all on purpose

create table if not exists mcleod_write_outcomes (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  request_id       uuid not null references mcleod_write_requests(id) on delete restrict,
  state            text not null constraint mcleod_write_outcomes_state_check
                     check (state in ('sent', 'confirmed', 'refused', 'conflict')),
  attempt          integer not null check (attempt >= 1),
  reason_code      text,       -- stable code the app and the office word: arrival_unknown, stop_gone, mcleod_differs, …
  mcleod_status    integer,    -- HTTP status from /ws, verbatim
  mcleod_message   text,       -- McLeod's text, verbatim (refused)
  observed         jsonb,      -- McLeod's stop as read (GET /stops/{id}) before or after the write
  recorded_at      timestamptz not null default now(),
  constraint mcleod_write_outcomes_reason_check check ((state in ('refused', 'conflict')) = (reason_code is not null))
);
create unique index if not exists uq_mcleod_write_outcomes_terminal
  on mcleod_write_outcomes (request_id) where state in ('confirmed', 'refused', 'conflict');  -- one end
create index if not exists idx_mcleod_write_outcomes_request on mcleod_write_outcomes (request_id, recorded_at desc);
alter table mcleod_write_outcomes enable row level security;
```
Both tables get a guard trigger in 0370's shape: INSERT checks that the load / request belongs to the
row's org (`MW010`), UPDATE and DELETE raise (`MW011` "append-only: a later fact is a new row").
States: `queued` = request with no outcome; `sent` = the agent called `/ws` (an attempt; may repeat);
`confirmed` = McLeod reads back our times (or already had them); `refused` = McLeod said no (4xx,
message kept); `conflict` = McLeod's record changed since `expected` (stop already cleared with other
times, stop gone, movement reassigned) — **never retried by the agent**; shown to the office.

Repo gates a new table must pass (all in M-K1's merge):
- `lint:rls` — both `enable row level security` ✓; no `auth_role() in (...)` lists, so
  `check-section-policies` has nothing to match.
- `lint:table-modules` — `scripts/table-modules.json` entries: both `{ module: "mcleod", layer: "core" }`.
- `lint:table-lifecycle` — `growth: "time"`, `retention_days: null`, budgets: requests **700/day**
  (live lme 2026-09-24: 99.3 movements/day × ~2.3 PU/SO stops ≈ 230 departures × 3), outcomes
  **1,500/day** (≈2 per request × 3); `why` says they are evidence of what we told McLeod and what it
  said. Add both to `RETENTION_FORBIDDEN` (`apps/api/src/modules/org/dataRetentionForbidden.ts`) with a
  comment: the record that 360 wrote a carrier's dispatch system, and McLeod's answer, is what a
  disputed detention or a "who changed this stop" question asks for.
- `lint:table-producers` — requests: DML in `driver_complete_stop` + the office-retry route;
  outcomes: the agent intake route (`.from("mcleod_write_outcomes").insert`).
- `lint:table-writers` — `scripts/table-writers.json` adds the two route files under
  `apps/api/src/modules/mcleod/writes/` (owner's directory, so `check-table-modules` writer-path passes).
- `lint:schema-snapshot` — regenerate `supabase/schema.generated.sql` (`node scripts/gen-schema-snapshot.mjs`).
- `lint:upserts` — none used; inserts only.
- `lint:driver-references` — no `drivers(id)` FK on either table (the driver is the
  `stop_completed` event's actor, the same id), so `merge_driver` needs no entry.
- `lint:migration-ordering` — new tables exempt; the `driver_complete_stop` change adds a defaulted
  parameter (old API calls still resolve).

### 6.3 Enqueue (in M-K1: `driver_complete_stop` replaced once more)
When `v_load_source = 'tms' and p_status = 'completed' and p_mcleod_write`:
```sql
select ls.mcleod_stop_id, ls.arrived_at, ls.external_status, ls.actual_arrival_at, ls.actual_departure_at
  into … from public.load_stops ls where ls.id = p_stop;            -- AFTER the evidence update
if v_mcleod_stop_id is null then
  v_write_note := 'no_mcleod_stop_id';                               -- recorded in the event payload
else
  insert into public.mcleod_write_requests (id, org_id, operation, load_id, stop_id, company_id, movement_id,
     mcleod_stop_id, arrival_at, departure_at, expected, origin, requested_by)
  values (p_action_id, p_org, 'stop_clear', p_load, p_stop,
     split_part(v_external_id, ':', 1), split_part(v_external_id, ':', 2), v_mcleod_stop_id,
     v_arrived_at, v_now, jsonb_build_object('external_status', v_ext, 'actual_arrival_at', v_aa,
     'actual_departure_at', v_ad, 'seen_at', now()), 'driver_app', p_actor_user)
  on conflict (id) do nothing;
end if;
```
- Same transaction as the evidence: the evidence row is written first in the body, and the request is
  a local insert that cannot fail for a McLeod reason (McLeod is never called here).
- `p_action_id` null (a legacy caller) → no request (there is no key to make it idempotent); after
  C-A3 every caller sends one.
- The `stop_completed` event payload gains `mcleod_write: 'requested' | 'off' | 'no_mcleod_stop_id'`.
- **D-MK3 switch:** `p_mcleod_write` is computed by the API: `true` iff the load's company (prefix of
  `loads.external_id`) is in env `MCLEOD_WRITE_COMPANIES` (comma list, empty by default). Set on the
  API services that serve `/api/me` only after D-MK3 passes for that company; documented beside
  `RUN_SCHEDULERS_IN_PROCESS` in `docs/DEPLOYMENT.md` (no gate can see an env var — say so there).
  Rows are never created for a company that is off, so turning it on never flushes a backlog of stale
  departures into McLeod.

### 6.4 API (merge C-K2, after M-K1 is `current`; `/me/loads` must not read the new tables earlier or
the whole list 500s during the window)
- `driverLoads.completeStop` passes `p_mcleod_write`. New `lib`: `mcleodWriteEnabledFor(env, externalId)`.
- `getDriverLoads`: one chunked read of requests (`.in("stop_id", stopIds)`, org-scoped) + their
  outcomes; each stop gets `mcleod_write: { state, reason_code, at } | null` (latest outcome, else
  `queued`; superseded requests read through to their successor).
- Shared: `MCLEOD_WRITE_STATES = ["queued","sent","confirmed","refused","conflict"]`,
  `mcleodWriteStatusSchema`, `loadStopSchema.mcleod_write` (`.nullable()`); `MCLEOD_WRITE_REASON_TEXT`
  (driver words) in shared so app and web word one code one way.
- Agent boundary (contract only; implementation in the agent spec), under
  `apps/api/src/modules/mcleod/writes/`, behind the ingest token like `tmsIngestRouter`
  (`routes/tmsIngest.ts:93`): `GET /api/tms/writes?limit=` → queued requests and `sent` ones whose last
  attempt is older than the lease, oldest first; `POST /api/tms/writes/:id/outcome` `{ state, attempt,
  reason_code?, mcleod_status?, mcleod_message?, observed? }` → one `mcleod_write_outcomes` row; a
  second terminal → 409 (the unique index), which the agent treats as "already recorded".
  Read-before-write is the agent's duty: `GET /stops/{id}`; McLeod already `D` with our departure
  (± 1 min) → `confirmed` without a write; `D` with other times / stop gone / movement differs →
  `conflict`; else `clearStop`, then re-read → `confirmed` or `refused`.
- Office (`routes/dispatch.ts`, `canManage` = `requireSection("dispatch")`, same gate as
  `/loads/:id/dispatch` `:255`): `POST /api/dispatch/loads/:id/stops/:stopId/mcleod-write/retry` →
  new request `origin='office_retry'`, `supersedes` = the conflicted/refused one, times copied from it
  (the driver's, never an office edit — office corrections stay in McLeod), `expected` re-read from
  `load_stops`; `POST …/mcleod-write/keep-mcleod` → `load_events` `exception_resolved` with
  `{ mcleod_write_request_id, action: 'kept_mcleod' }` (`0145`'s purpose: an append-only log closes an
  exception by a new row). Both refuse when the latest request is not `refused|conflict` (409).
- `detail.ts:163-221`: stops carry `mcleod_write` (+ history list for the page).

### 6.5 Driver app (merge C-K3, after C-K2 in production)
- Stop rows (`Itinerary.tsx`, `StopHero.tsx`): a small line under the driver's time — queued/sent
  "Sending to dispatch", confirmed "In McLeod", refused/conflict "Dispatch will fix this in McLeod".
- **Failed list.** The outbox record of a stop is `done` once the API holds the evidence (200), which
  is correct: the driver's work is safe and McLeod's answer comes later. So McLeod's refusals are NOT
  outbox records and `policy.ts` is unchanged (409 → `dead` stays the rule for evidence refusals). New
  `src/features/loads/McleodWriteIssues.tsx` lists stops whose `mcleod_write.state` is
  `refused|conflict`, no Retry button (the driver cannot fix McLeod; the agent never retries a
  conflict blindly), text from `MCLEOD_WRITE_REASON_TEXT`. Rendered in `app/settings.tsx:54` directly
  under `<FailedSyncList />` — composed at the route, because `features/support` may not import
  `features/loads` (`lint:boundaries`).
- Tests: "a refused McLeod write lists the stop with dispatch's wording and no retry"; "a confirmed
  write lists nothing".

### 6.6 Web (C-K2)
`DispatchLoadDetailPage.vue` stop row: "McLeod: In McLeod 10/14 10:20" / "Not in McLeod —
{reason}" with **Write again** and **Keep McLeod's** for `refused|conflict` (`session.can('dispatch')`);
the board (`DispatchLoadsPage.vue`) gets no new column — the load page is where a stop is fixed; the
exceptions feed (`load_events` by kind, `0145:32-33`) lists open `refused|conflict` writes until an
`exception_resolved` or a confirmed successor exists.

### 6.7 MK3 tests
Matrix `supabase/tests/mcleod-write-requests.test.mjs`: "completing a McLeod stop with writes on
enqueues one stop_clear keyed by the action id"; "the request carries the driver's arrival, or null
when they never arrived"; "arrive enqueues nothing"; "skip enqueues nothing"; "writes off → no request
and the event says off"; "a stop without a McLeod id → no request and the event says so"; "a replayed
completion enqueues nothing more"; "a manual load never enqueues"; "requests and outcomes refuse
UPDATE and DELETE (MW011)"; "a second terminal outcome is refused"; "an office retry must name what it
supersedes, once"; "a request's org must be its load's (MW010)"; "neither table is readable by a
driver or a dispatcher session (deny-all)". API: `writes/agentRoutes.test.ts` "the queue lists queued
and lease-expired sent requests, org-scoped, oldest first", "an outcome is recorded once; a second
terminal answers 409"; `dispatch` route tests "retry copies the driver's times and supersedes",
"keep-mcleod writes exception_resolved", "both refuse unless the write was refused or in conflict".

---

## 7. Gates that will check this work

`pnpm test` (all matrices print `RESULT`), `pnpm typecheck`, `pnpm lint`, plus by name:
`lint:migrations`, `lint:migration-ordering`, `lint:rls` (+ section-policies), `lint:table-producers`,
`lint:table-writers` (+ table-modules), `lint:table-lifecycle`, `lint:schema-snapshot`,
`lint:table-access` (S0a backfill waiver), `lint:upserts`, `lint:driver-references`, `lint:filesize`
(`me.ts` 444 → watch 450/500), `lint:funcsize`, `lint:boundaries` (§6.5 route composition),
`lint:shared-contracts`, `lint:record-id`, `lint:date-format` (§4.5), `lint:comment-claims` (every
"proves"/"pinned by" in new headers quotes a real title above), `lint:matrix-exit`, `lint:tests`
(new `driverLoadPhase.test.ts` collected), `mutation:check`. `native-android` is not triggered.

## 8. Rollout order (merges; ⟶ = wait for staging `schema current` or for production as stated)

1. **S0a** migration ⟶ staging current.
2. **S0b** code ⟶ in production (a release).
3. **M-A** migration (N1+N2+N3+N7 SQL; test-allowlist edits) — may merge in parallel with S0b; ⟶ staging current.
4. **C-A1** API + shared + web (RPC visibility, `source`, stop McLeod columns, ack route and display,
   action ids optional, DL012-14) ⟶ **in production** (the app's `loadSchema` requires `source`).
5. **C-A2** driver app (phase derivation, tms stop flow, Got it, action ids sent) — OTA/APK lanes ⟶ production.
6. **C-A3** action id required on the four endpoints.
7. **S0c** migration (≥1 release after S0b).
8. **M-K1** migration (needs S0b live) ⟶ staging current.
9. **C-K2** API + web (enqueue switch, `/me/loads` McLeod state, agent and office endpoints) ⟶ production.
10. **C-K3** driver app McLeod state + issues list.
11. Agent spec ships its half; `MCLEOD_WRITE_COMPANIES=<test company>` after D-MK3's test plan; live
    company only on the owner's word.

Steps 1–7 need no API Kit and can ship now; 8–10 can ship dark (switch empty) before MK0.

## 9. Verifying on staging

- **N2:** staging test driver (memory `staging-test-members`) in McLeod as driver of a `P` movement;
  dispatch it from the load page; driver app shows it under Upcoming with "Got it" while
  `loads.status = 'approved'`. Set the co-driver seat in staging data (or a team movement) — the second
  login sees it too. Re-dispatch to a third person — both lose it.
- **N3:** tap Got it offline, reconnect: one `acknowledged` row (`select id, payload from load_events
  where load_id = … and kind = 'acknowledged'`), id = the outbox record id; load page reads "Seen …".
- **N1:** tap I'm here: the load moves to Current in the app; `select status from loads` still
  `approved`; one `stop_arrived` event; next sweep leaves the stop's `status/arrived_at` and `id`.
- **N7:** airplane mode, Arrive, wait for a failed attempt, Complete, reconnect: both land, nothing in
  Needs attention; replay a decline (manual staging load) twice — one `declined` event.
- **MK3 (dark):** with `MCLEOD_WRITE_COMPANIES` empty, Complete → `stop_completed.payload.mcleod_write =
  'off'`, no request row. On the test company with the agent: request → `sent` → `confirmed`, McLeod's
  stop shows our times, the next sweep projects `D` and McLeod's actuals; force a conflict by clearing
  the stop in McLeod first → `conflict` on the load page with Write again / Keep McLeod's, and the
  driver's Settings lists it without a Retry.
