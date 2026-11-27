# T1 — driver loads and data fixes (McLeod API Kit v2, Track N, the store track, Hire again's roster side)

**Status:** PLAN, 2026-11-27, against `origin/main` merged into this branch at `ecc25c22d` (migrations end at
`0654_follow_up_urgent_category.sql`) and PR #2684 (`claude/driver-s1-dispatch-visible`, migration
`0655_sent_load_visible_at_any_mcleod_status.sql`; **merged to main** — corrected by chat 3, 2026-11-27). PR #2689
(Send puts the load in the app and notifies, enterprise S1.1's second half) builds N-19 (corrected by chat 3). Index:
`../MCLEOD-API-KIT-PLAN-V2.md`. Decisions are the register's (`../DECISION-REGISTER-2026-11-20-API-KIT.md`); every D-MK
id below is its. T2's interfaces (`v2/T2-transport.md` top) are used by name and never restated. Every file:line was
re-read on `ecc25c22d` (or on the PR branch where it says so). Migration numbers: none is taken here; each is the next
free one at merge (D-MK18), and the ORDER below is fixed.

**The consumer.** `docs/plans/drivers-app/DRIVER-APP-ENTERPRISE-PLAN.md` (rev 2) segment S1 (`:290-340`) is this
track seen from the app, and S9 (`:553-573`) is T2 seen from the app. S1.0 ("write the driver track") is this file.
The mapping is: S1.1 = 0655 (built) + N-8/N-9's "Got it"; S1.2 = N-6/N-7; S1.3 = N-8; S1.4 = N-8/N-9/N-17;
S1.5 = N-9; S1.6 = N-2/N-10/N-12; "the remaining Track N items" = N-1, N-5, N-13, N-14, N-15.

**Facts this track builds on (2026-11-27; cite them, do not re-measure them):**
- **D-LMR5 stands** (`../LOADS-MIRROR-PLAN.md:338`, re-confirmed by the owner 2026-11-27): a McLeod load reaches a
  driver only when the office presses Dispatch → Send in 360. The 2026-11-27 15:00 progress entry that said DF-1
  supersedes it was withdrawn by `docs/plans/drivers-app/enterprise-progress/2026-11-27-1600-s0-correction-dispatch.md`.
- **Production, 2026-11-27** (`enterprise-progress/2026-11-27-1500-s0-facts.md`, read-only counts): 0
  `load_dispatches` rows ever; 99 `in_transit` + 39 `pending_approval` `source='tms'` loads; 3 active loads with a
  co-driver; **1 of 195 active drivers has an app login**; 203/203 active stops have lat/lon; `driver_hos_clocks`
  fresh; `driver_time_off` last synced 2026-11-17.
- **Installed app builds (R3-21's count, D-MK23), production 2026-11-27, this chat:** `device_push_tokens` not
  revoked, grouped by platform and `app_version` → **2 rows, `ios`, `1.0.0`, last seen 2026-09-15**; no Android row.
  (`app_version` is written at `apps/api/src/modules/messaging/routes/notifications.ts:183`; the table has
  `last_seen_at`, not `updated_at` — `schema.generated.sql:2421-2430`.)
- **Owner, D-DA1** (enterprise plan `:173`): ~100 % company drivers; no pay, settlement, advance, detention or lumper
  request screens. Every lumper/detention item of the older specs is out of this track.
- **Owner, D-DA12** (enterprise plan `:226-232`): driver builds stay **local** (release builds on the Mac, `adb` onto
  the fleet tablets) until the owner rules the app 100 % finished. The store track below is **prepared, not
  published**.
- Staging has no McLeod feed and no test company. A McLeod-shaped staging check means: post a fixture to
  `/api/tms/dispatch-movements` with a staging ingest token from `apps/api/src/scripts/issueMcleodToken.ts`
  (enterprise plan R17), fixture shape from `apps/api/src/modules/mcleod/routes/tmsIngest.dispatchMovements.test.ts`.

---

## 0. What 0655 already built, and what T1 builds on it

0655 (PR #2684; `git diff origin/main...origin/claude/driver-s1-dispatch-visible`) is **built, not re-specified here**:
- `public.auth_visible_tms_load_ids()` — caller-scoped, no parameter: McLeod loads whose CURRENT dispatch (newest
  `sent_at`, then `id`) names the caller, or names the load's McLeod `driver_id` while the caller is its
  `co_driver_id`. Granted to anon/authenticated/service_role (0643's ACL rule).
- The three driver scopes (`loads_driver_scope`, `load_stops_driver_scope`, `load_events_driver_scope`): a tms load is
  visible at `pending_approval, approved, in_transit, delivered, canceled` when in that helper; manual loads keep 0087.
- `packages/shared/src/loadsLifecycle.ts` `TMS_DRIVER_VISIBLE_STATUSES` (same five); `driverLoads.ts`
  `tmsLoadsVisibleTo` restates the helper for the service role (PR branch `:90`); the app's `loadStatus.ts` reads
  `pending_approval`/`approved` as **"Dispatched"**.
- 0655 touches **none** of `assert_driver_load`, `driver_complete_stop`, `driver_add_stop_photos` or the
  `driver_accept/decline/start_load` functions. They still admit only `loads.driver_id = p_driver`
  (`0141_driver_load_rpc_contract.sql:79-86`) and gate stop work on `accepted, in_transit` (`0141:304-305`) and late
  photos on `in_transit, delivered` (`0645:79-80`).

**Consequence, stated once and applied in N-8:** after 0655 a driver can SEE a McLeod load he cannot WORK. A co-driver,
a driver the office sent a load McLeod seats on somebody else, and every driver on a `pending_approval`/`approved`
load get DL002 or DL003 on their first tap — 409/404 → the outbox's Needs attention. N-8 closes that by making the
SQL action door admit exactly whom 0655 shows, from **one** definition:

| Rule | Where it lives after N-8 |
|---|---|
| "who may see / act on a McLeod load now" | new `public.driver_visible_tms_load_ids(p_org, p_driver)` (service role); 0655's `auth_visible_tms_load_ids()` is re-created as a one-line wrapper over it, so the policy, the action door and the API read one body |
| "which McLeod statuses a driver sees / works" | the policies (0655) and `TMS_DRIVER_VISIBLE_STATUSES` (0655); N-8's status gate uses the same five, pinned by a matrix title that reads both |
| "was ever dispatched this load" (D-MK20) | new `public.driver_load_access(p_org, p_driver, p_load)` → `'current' | 'late' | 'none'` |

So `assert_driver_load` / `driver_complete_stop` / `driver_add_stop_photos` / `driver_acknowledge_load` **accept stop
actions from whoever 0655's current-dispatch / co-driver rule admits**, answer `late_evidence` for whoever it admitted
before (D-MK20), and refuse everyone else with DL002, as before.

---

## 1. Order (the T1 rows of the index's §2 table, expanded)

`Rel` as in the index: `stg` = merged and applied on staging; `prod` = carried by an owner-approved release and
`pnpm verify:live` green; `VM` = installed on the Board VM by a visit; `local` = installed by `adb` on a fleet tablet
(D-DA12).

| # | PR | Migration (order only) | Needs | Rel before the next dependent | Shares a file with |
|---|---|---|---|---|---|
| N-1 | B1 one required-photo rule | — | — | stg before N-7 | N-7 (`mirrorLoads.ts`) |
| N-2 | B2 reference/BOL/unmatched columns | two files (mcleod, loads) — 1st and 2nd of T1 | — | stg | — |
| N-3 | C-23 claim defect | roster — 3rd | — | stg | — |
| N-6 | S0a stable stop identity, band, `mcleod_removed_at` | loads — after N-2's | N-2 applied | stg | — |
| N-7 | S0b projection through the RPC; retire `POST /api/tms/loads` | — | N-1, N-6 stg | **prod** | N-1, CU-1 (`dispatchProjection.ts`, see N-7) |
| N-8 | M-A driver loads SQL (the one `driver_complete_stop` signature change) | loads — after N-6's; 0655 merged first | N-6 applied, 0655 applied | stg | T-4 rewrites its body |
| N-9 | C-A1 API + shared + web for M-A | — | N-8 stg; N-7 **in the same or an earlier release** | **prod** | T-5 (`driverLoads.ts`, `exceptions.ts`) |
| N-19 | Send reaches the app — **built by PR #2689** (`app`/`sent` row + `load_offered` notice; no migration) | — | — | prod (its own release) | N-9 (`dispatchToDriver.ts`: N-9 rebases onto it) |
| N-10 | B4 API half (BOL, customer, McLeod times, references expand) | — | N-2 stg | prod; agent half rides CU-1 | — |
| CU-1 | (T2) connector update: B4 statements + test-company read + `/ws` client | — | N-10 prod | VM | N-7 |
| N-11 | V1 PU qualifier check (operation) | — | CU-1 on VM | — | — |
| N-12 | B5 PU number + references contract phase | — | N-11 passed | prod | — |
| N-4 | C-16 link 360 hires | — | N-3 stg | prod | — |
| N-5 | B3 link-first + unmatched assignment exception | — | N-2 stg | prod | N-9 (`exceptions.ts` kinds) |
| N-13 | B6 planned rig first | — | N-9 merged | prod | — |
| N-14 | B7 driver arrival on the board | — | — | prod | — |
| N-15a | S0c ETA re-key: `stop_id` column + backfill | loads | N-7 prod ≥ 1 release | stg | — |
| N-15b | S0c recorder writes `stop_id` | — | N-15a applied | prod | — |
| N-16 | Hire again, roster half | roster | N-4 | prod | T3 (MK5 reactivate) |
| N-17 | C-A2 driver app | — | N-9 prod | local | S3 (`stop/[stopId].tsx`, S1 first) |
| N-18 | `action_id` required | — | N-17 local on every tablet + count = 0 | prod before S-3 | — |
| S-1 | `driver-store.yml` production-ancestor gate | — | — | merged | — |
| S-2..S-4 | store accounts, rc build, promotion | — | N-17, N-18 prod; Q-5; Q-DA2 | **held by D-DA12** | — |

Order rules that are not obvious from the table:
- **0655 merges before N-8.** N-8 re-creates 0655's helper as a wrapper; on a branch where 0655 is absent N-8 must
  not be merged (its `create or replace` would create a helper no policy reads). PR #2684 is merged (chat 3,
  2026-11-27), so this precondition holds.
- **N-7 and N-9 in one release or N-7 first** (aA A-44, cD DR-21): N-9's app-visible stops must be stable ids.
- **N-7 and CU-1 touch `dispatchProjection.ts`.** N-7 changes only `applyMirroredLoads`' stop write (inside
  `mirrorLoads.ts`) and adds nothing to `dispatchProjection.ts` beyond the `stopsRefused` count; CU-1's test-company
  skip is a guard at the top of `projectDispatchMovements` (`dispatchProjection.ts:44`). N-7 merges first; CU-1
  rebases. Neither re-orders the other's lines.
- **N-8 before T-4** (D-MK19): T-4 re-creates `driver_complete_stop` from N-8's body.

---

## N-1 B1 — one required-photo rule

**What changes for a user.** Nothing visible; the same photos are asked for at each stop.

**Files.**
- `packages/shared/src/loadsContract.ts` (259 lines): after the photo-slot helpers, `REQUIRED_PHOTOS_BY_STOP_KIND`
  and `requiredPhotosFor(kind)` exactly as spec B §2 (`api-kit-specs/B-data-fixes.md:72-89`); the name is spec B's
  (aA A-48). The doc comment says the rule was written twice until this PR, in `mirrorLoads.ts` and in the retired
  `/api/tms/loads` writer (aB B-27).
- `apps/api/src/modules/loads/mirrorLoads.ts:122` and `apps/api/src/modules/mcleod/tmsLoadIngestWriters.ts:157`:
  `required_photos: requiredPhotosFor(s.kind)`. `packages/shared/src/tms.ts:71`'s copy is mentioned in the comment
  and left (it is the retired feed's contract, removed by N-7).

**Tests.** `loadsContract.test.ts`: "every required photo slot is one the driver app can label"; "requiredPhotosFor
returns a copy, so a writer cannot change the rule". `apps/api/src/modules/mcleod/tmsLoadIngest.test.ts:132-141`:
"the TMS feed writes the shared required photos per stop kind". `routes/tmsIngest.dispatchProjection.test.ts`: "the
mirror writes the shared required photos on every stop it writes". Mutation: `pickup: ["bol"]` fails both API tests.

**Gates.** `typecheck`, `lint:boundaries`. **Staging check.** None beyond CI (identical output). **Rollback.** Revert.
**Release dependency.** stg before N-7 (N-7 moves the call into the RPC payload).

---

## N-2 B2 — reference, BOL and unmatched columns (merged alone)

**What changes for a user.** Nothing; columns are unread until N-5/N-10/N-12.

**Files.** Two migrations (one per module, `lint:table-modules`), DDL **verbatim from spec B §3.2**
(`B-data-fixes.md:166-190`): `<next>_mcleod_dispatch_stop_references.sql` (mcleod: `mcleod_dispatch_stops.reference_numbers
jsonb` + array CHECK) then `<next>_loads_references_bol_unmatched.sql` (loads: `loads.bol_number text`,
`loads.external_unmatched jsonb` + array CHECK, `load_stops.reference_numbers jsonb` + array CHECK). No default on any.
`supabase/schema.generated.sql` regenerated. New matrix `supabase/tests/loads-mcleod-references.test.mjs` (harness of
`loads-customer-name.test.mjs`).

**Tests.** "existing loads read null for bol_number and external_unmatched"; "a stop's reference_numbers accepts an
array and null"; "a stop's reference_numbers refuses an object" (one per CHECK); "no new column has a default".

**Gates.** `lint:migrations`, `lint:migration-ordering` (merged alone), `lint:table-modules`, `lint:schema-snapshot`,
matrices. **Staging check.** `select column_name from information_schema.columns where table_name in
('loads','load_stops','mcleod_dispatch_stops') and column_name in ('bol_number','external_unmatched','reference_numbers')`
→ 4 rows. **Rollback.** A later migration drops them one release after their last reader. **Release dependency.**
Applied on staging before N-6 (N-6's RPC writes `load_stops.reference_numbers`, r3S SEQ-7).

---

## N-3 C-23 — the claim defect (council OF-2)

**What changes for a user.** An office edit of a McLeod driver's phone stops warning that it will be overwritten when
McLeod does not own the phone.

**Files** (cO OF-2, `api-kit-council/4-office.md:64-83`, accepted by r3R R3-24):
- New roster migration `<next>_claim_identity_field_sources.sql`: re-creates the trigger on `drivers` from
  `0241_identity_provenance_claim.sql:124-126` with args `'full_name','first_name','middle_name','last_name','phone@samsara'`;
  `claim_identity_for_office` reads each arg with `split_part(arg, '@', 1)` / `split_part(arg, '@', 2)`. The 0241/0242
  vehicle and trailer triggers are untouched.
- New `packages/shared/src/driverIdentityFields.ts` (`{ field, sources? }[]`), re-exported from `rosterContract.ts`;
  `resolveDriverUpdate` and `wouldClaimFromTelematics` both call `claimsIdentity(field, identitySource)`.

**Tests.** `supabase/tests/identity-provenance.test.mjs` (the 0241 matrix): "a phone edit on a McLeod row does not
warn"; the parity title rewritten in this PR: "drivers mirror DRIVER_IDENTITY_FIELDS, so PostgREST and
resolveDriverUpdate agree" (it renders `col@source`). `definer-rpc-grants.test.mjs` unchanged list.

**Gates.** `lint:migrations`, `lint:schema-snapshot`, matrices, `lint:filesize`. **Staging check.** Edit a staging
McLeod-sourced driver's phone in Roster: no "McLeod will overwrite" warning; edit the name: the warning shows.
**Rollback.** A migration re-creating 0241's trigger args. **Release dependency.** stg before N-4.

---

## N-6 S0a — stable stop identity, the band, `mcleod_removed_at`

**What changes for a user.** Nothing until N-7 calls the RPC.

**Files.** New loads migration `<next>_load_stops_mcleod_identity.sql`, header: gap (spec A C1/C2: both stop writers
delete pending stops and re-insert them, so `load_stops.id` churns, `mirrorLoads.ts:107-126`); why kept-not-deleted
(D-MK15: `storageReconcile.ts:293-297` deletes photo objects whose `load_stop_photos` row is gone, and that row
cascades from the stop, `schema.generated.sql:8133`); why the band (D-MK16); `cross-module-waiver` and
`raw-access-waiver` lines for the one-time backfill and the RPC's read of `mcleod_dispatch_stops` (aA A-57); deploy
window (columns + function only; old writers keep working, the CHECK only widens). `supabase/schema.generated.sql`,
`scripts/table-writers.json` (`load_stops` producer: the RPC body), `supabase/tests/definer-rpc-grants.test.mjs`
(new function in the service-role class), new matrix `supabase/tests/load-stops-mcleod-identity.test.mjs` (adopts
`api-kit-round4/pg/tail.mjs`).

**Migration DDL.**
```sql
alter table public.load_stops add column if not exists mcleod_stop_id text;
alter table public.load_stops add column if not exists mcleod_removed_at timestamptz;
comment on column public.load_stops.mcleod_stop_id is
  'McLeod stop.id (trimmed). Identity of a projected stop: apply_mcleod_load_stops updates by (load_id, mcleod_stop_id) '
  'and never deletes it, so load_stops.id is stable for a phone that queued an action (S0a, D-MK15). Null on a manual load.';
comment on column public.load_stops.mcleod_removed_at is
  'When McLeod stopped listing this stop. The row and its photos are kept; computing readers skip it, displaying '
  'readers label it "Removed in McLeod" (D-MK15).';
-- Non-partial: NULLs are distinct, so manual rows never collide (aA A-28 corrected the old reason).
create unique index if not exists uq_load_stops_load_mcleod_stop on public.load_stops (load_id, mcleod_stop_id);

-- D-MK16: McLeod seq 1..999 at rest, removed stops at the tail (≤ 200 by refusal), 1000+ is the in-transaction band.
alter table public.load_stops drop constraint if exists load_stops_seq_check;              -- 0423:101-102 (1..50)
alter table public.load_stops add constraint load_stops_seq_check check (seq between 1 and 1999);

-- load_events kinds: 0645's list (0645:38-46) + two system facts this RPC writes.
alter table public.load_events drop constraint load_events_kind_check;
alter table public.load_events add constraint load_events_kind_check check (kind in (
  'created','submitted','approved','rejected','assigned','reassigned','released','accepted','declined','started',
  'stop_arrived','stop_completed','stop_skipped','equipment_mismatch','amended','canceled','completed',
  'load_changed','exception_resolved','stop_photo_added',
  'stop_removed_in_mcleod','stop_mirror_refused'));

-- Backfill (aA A-29): by movement and McLeod sequence, trimmed, company from external_id.
update public.load_stops ls
   set mcleod_stop_id = btrim(s.stop_id)
  from public.loads l
  join public.mcleod_dispatch_stops s
    on s.org_id = l.org_id and l.external_id = s.company_id || ':' || s.movement_id
 where ls.load_id = l.id and l.source = 'tms' and s.movement_sequence = ls.seq and ls.mcleod_stop_id is null;
```

`public.apply_mcleod_load_stops(p_org uuid, p_loads jsonb) returns jsonb` — `security definer`, `set search_path = ''`,
revoked from public/anon/authenticated, granted to service_role. `p_loads` = `[{load_id, stops:[ProjectedStop…]}]`.
For **each load, in its own `begin … exception when others then … end` sub-block** (D-MK16, V4 §2.2), in order:
1. `select … from public.loads where id = load_id and org_id = p_org and source = 'tms' for update` — none → the load
   goes to `refused` with reason `not_tms_in_org` (`LS001`'s meaning, returned not raised).
2. **Claim**: rows of the load with `mcleod_stop_id is null` and `seq` = an incoming stop's McLeod seq get that stop's
   id (rows the old writer inserted in the S0a→S0b window).
3. **Band**: `update load_stops set seq = seq + 1000 where load_id = …` — every row, worked or not, removed or not.
4. **Upsert** each incoming stop: `insert … on conflict (load_id, mcleod_stop_id) do update set` the projected columns
   only, derived from the payload with `jsonb_populate_record(null::public.load_stops, stop)` so a column added by a
   later PR (N-12's `reference_numbers`) needs no RPC change (aA A-47): `seq, kind, name, address_line, city, state,
   postal_code, lat, lon, appointment_start, appointment_end, location_name, location_code, external_status,
   actual_arrival_at, actual_departure_at, eta_at, contact_name, contact_phone, po_number, required_photos,
   reference_numbers, updated_at`, and `mcleod_removed_at = null` (a stop McLeod lists again is no longer removed).
   **Never** `status, arrived_at, completed_at, skip_reason` (the driver's).
5. **Removed**: rows still ≥ 1000 are stops McLeod no longer lists. Each gets `mcleod_removed_at = coalesce(mcleod_removed_at,
   now())` and `seq = max(incoming seq) + n` in their previous order; for each one newly stamped, one `load_events` row
   `kind = 'stop_removed_in_mcleod'`, `actor_role = 'system'`, `actor_user_id = null` (`load_events.actor_role` has no
   CHECK, `schema.generated.sql:8024`), payload `{stop_id, mcleod_stop_id, driver_status}`.
6. **Tail refusal**: if `max(incoming seq) + n > 1199` (a tail past 200) the sub-block raises a named error, caught by
   its own handler: the load goes to `refused` with reason `stop_tail_over_200`, and one `stop_mirror_refused` event is
   written unless the newest such event for the load is younger than 24 h (one per day, not one per 60-second sweep).
7. **Assert**: no row of the load has `seq ≥ 1000` (else raise → refused `band_not_empty`).
8. When a load applies cleanly and its newest `stop_mirror_refused` event has no later `exception_resolved` naming it,
   write `exception_resolved` with payload `{kind:'stop_mirror_refused', by:'mirror'}` (0145's close-by-new-row rule).

Return `{written: [load_id…], refused: [{load_id, reason}]}`. The sub-block's `when others` arm catches everything so
one load never aborts the batch; it re-raises `40001`/`40P01` (the caller retries the batch).

**Tests** (`load-stops-mcleod-identity.test.mjs`, prints `RESULT` after `await db.close()`): "a projected stop keeps its
id across two applies"; "the driver's status, arrived_at, completed_at and skip_reason survive an apply"; "a row without
a McLeod stop id is claimed by its sequence, not duplicated"; "a stop inserted mid-movement shifts the later stops in one
apply, ids unchanged"; "two stops swapped by dispatch are applied in one call"; "a worked stop McLeod removed no longer
blocks the stop McLeod put at its sequence"; "a worked stop keeps its own McLeod stop's address after a re-sequence,
never its sequence-neighbour's" (cD DR-2); "two consecutive sweeps after McLeod removed a worked stop both apply";
"a stop McLeod no longer lists is kept, stamped and moved to the tail"; "a removed stop McLeod lists again is no longer
removed"; "a stop McLeod adds at a removed worked stop's old sequence is inserted"; "the band is empty after every
apply"; "a load whose tail would pass 200 is refused by name and the rest of the batch applies"; "a refused load writes
one stop_mirror_refused event a day"; "a load that applies after a refusal closes it with exception_resolved"; "a load
of another organization is refused"; "a manual load is refused"; "the backfill fills mcleod_stop_id from raw by movement
and sequence"; "a projected load whose raw movement is gone keeps mcleod_stop_id null and is claimed by seq on its next
apply"; "load_events still accepts stop_photo_added" (0645's kind kept). `definer-rpc-grants.test.mjs`: the class check
covers the new function (it takes parameters; no list edit). Obsolete and NOT written: spec A's "a re-sequenced movement
is deferred, not failed…", aA A-27's "…deferred before S0c, both kept after", V4-2's "…would pass 50 stops…".

**Gates.** `lint:migrations`, `lint:migration-ordering` (no reader in this merge), `lint:table-access` (waivers),
`lint:table-writers`, `lint:schema-snapshot`, `lint:comment-claims`, matrices. **Staging check.** `select
count(*) filter (where mcleod_stop_id is null) from load_stops ls join loads l on l.id = ls.load_id where l.source='tms'
and l.external_closed_at is null` → 0 on staging after migrate-staging (staging tms rows come only from fixtures; 0 rows
is also a pass, say which). **Rollback.** Columns and function are inert without N-7; a later migration narrows nothing
(D-MK17: no "cannot roll back past S0b"). **Release dependency.** stg before N-7 and N-8.

---

## N-7 S0b — the projection writes stops through the RPC; the old feed retires

**What changes for a user.** A stop keeps its id when McLeod re-sends a movement, so a driver's queued tap reaches the
right stop; the office sees removed stops labelled.

**Files.**
- `packages/shared/src/mcleodLoadProjection.ts` (319 lines): `ProjectedStop` (`:65-86`) gains `mcleod_stop_id: string`;
  the stop mapper (`:254-284`) sets `mcleod_stop_id: s.stop_id.trim()`.
- `apps/api/src/modules/loads/mirrorLoads.ts`: `writeStops` (`:104-130`) becomes one
  `admin.rpc("apply_mcleod_load_stops", { p_org, p_loads })` per 50 loads (a load's stops never split); the
  `.delete()` (`:107-112`) and `.upsert(…, { onConflict: "load_id,seq" })` (`:126`) go. `MirrorWriteResult` gains
  `stopsRefused: { loadId, reason }[]`, logged `[mcleod-mirror] stops refused: n` (counts only). A thrown RPC error
  still throws (the sweep retries).
- **D-MK15's readers**, by code read of every `.from("load_stops")` outside the writers (2-v2-writer §2a.3):
  - *Compute* readers — add `.is("mcleod_removed_at", null)`: `loads/truckLoadPlanReads.ts:103` (board next stop / ETA),
    `loads/liveLoadReads.ts:108` and `:229` (map), `loads/dispatchLoads/queries.ts:166` (list counts),
    `loads/dispatchLoads/deliveredWindow.ts:28` and `:59`, `loads/dispatchLoads/activity.ts:62`, `loads/driverPickups.ts:32`,
    `loads/dispatchToDriver.ts:69` (the SMS body's stop list).
  - *Display* readers — select `mcleod_removed_at` and label: `loads/dispatchLoads/detail.ts:165` (office load page,
    "Removed in McLeod"), `loads/driverLoads.ts` stop read (driver app, N-9 adds the field to `loadStopSchema`).
  - Shared: `nextStopOnRoute` / `isStopBehindTruck` (`packages/shared/src/loadBoard.ts:192-197`) treat a removed stop as
    behind the truck, so every compute reader that receives one anyway is still right.
- `apps/api/src/modules/mcleod/routes/tmsIngest.ts:325-326` `POST /loads` answers
  `410 { code: "retired_feed", message: "Loads arrive through the McLeod mirror since LR4" }`; `ingestLoads` and
  `tmsLoadIngestWriters.ts`' writers with their tests are deleted (aA A-25); `scripts/table-writers.json` drops
  `tmsLoadIngestWriters.ts` from `load_stops` (`:508-511`) and its other tables; `load_external_payloads` keeps its
  remaining producer (re-checked in the PR by `lint:table-producers`). The resolvers that `tmsLoadIngest.ts` lends to
  the mirror move to `mcleod/loadEntityResolvers.ts` with the incident comment (aA A-25, aB B-36).
- Precondition for the 410 (A-25): CloudWatch for the production `api` service, 7 days, `POST /api/tms/loads` count = 0,
  pasted in the PR. Any hit → the 410 waits, the RPC change still ships.

**Tests.** `mcleodLoadProjection.test.ts`: "every projected stop carries McLeod's stop id, trimmed".
`routes/tmsIngest.dispatchProjection.test.ts` (`:164-177` rewritten; there is no `mirrorLoads.test.ts`, aA A-24): "stops
go through apply_mcleod_load_stops with every projected column and none of the driver's"; "a refused load is reported
in stopsRefused, not thrown"; "a re-sent movement keeps its stop ids". `tmsIngest.hardening.test.ts`: "POST
/api/tms/loads is 410 retired_feed". `truckLoadPlanReads.test.ts`: "a stop removed in McLeod is not the board's next
stop". `dispatchLoads/detail.test.ts`: "a stop removed in McLeod is listed and labelled".

**Gates.** `lint:table-writers`, `lint:table-producers`, `lint:filesize`, `test-api`, `test-packages`.
**Staging check.** Post the `tmsIngest.dispatchMovements.test.ts` fixture twice to staging with a staging ingest token;
`select id, mcleod_stop_id, updated_at from load_stops where load_id = …` — ids unchanged, `updated_at` moved; post it a
third time without one stop → that row has `mcleod_removed_at` and the load page labels it. **Rollback.** Revert the
code; stops written meanwhile keep their ids; the old writer's delete-and-reinsert returns (DR-2 re-exposed; say so in
the revert PR). **Release dependency.** prod, in the same release as N-9 or earlier.

---

## N-8 M-A — driver loads SQL (the one `driver_complete_stop` signature change, D-MK19)

**What changes for a user.** Nothing until N-9/N-17; the database starts accepting stop work from the driver and the
co-driver 0655 shows, "Got it", replays, and late evidence.

**Files.** New loads migration `<next>_driver_loads_mcleod_actions.sql`, merged **after 0655 and N-6 are applied**.
Header in the house register: the gap (§0 above: 0655 shows a load its driver cannot work; spec A C1/C3/C4 rows still
true of `0141`); why one definition (`driver_visible_tms_load_ids` replaces the restatements); why `late_evidence`
returns instead of raising (D-MK20: a raise rolls back the evidence); the O-3 team rule (0655's); the deploy window
(old API calls resolve to the new functions: named arguments, every new parameter defaulted; `runRpc` reads only
`error`, `apps/api/src/modules/loads/driverLoads.ts:210-226`, so `void → jsonb` is invisible to it); rollback.
Also: `supabase/schema.generated.sql`; `supabase/tests/rls.test.mjs:2244-2261` and
`supabase/tests/definer-rpc-grants.test.mjs:142` (the wrapper stays in the caller-scoped list; the new parameterised
functions fall in the service-role class); new matrix `supabase/tests/driver-load-actions.test.mjs`;
`supabase/tests/load-lifecycle.test.mjs` (new rows; `:140-152` stay green — manual loads are unchanged).

**Migration DDL** (abridged only where a body is the 0141 text unchanged; the PR writes every body in full).
```sql
-- 1. One definition of "who may see and work a McLeod load now" — 0655's body with the caller's claims made
--    parameters. Service role only (it takes a tenant and a driver).
create function public.driver_visible_tms_load_ids(p_org uuid, p_driver uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select cur.load_id
    from (select distinct on (d.load_id) d.load_id, d.driver_id
            from public.load_dispatches d
           where d.org_id = p_org
             and d.load_id in (select m.load_id from public.load_dispatches m where m.org_id = p_org and m.driver_id = p_driver
                               union
                               select l.id from public.loads l where l.org_id = p_org and l.co_driver_id = p_driver)
           order by d.load_id, d.sent_at desc, d.id desc) cur
    join public.loads l on l.id = cur.load_id
   where p_driver is not null
     and (cur.driver_id = p_driver or (cur.driver_id = l.driver_id and l.co_driver_id = p_driver));
$$;
revoke all on function public.driver_visible_tms_load_ids(uuid, uuid) from public, anon, authenticated;
grant execute on function public.driver_visible_tms_load_ids(uuid, uuid) to service_role;

-- 0655's policy helper becomes a wrapper: same name, same ACL, same answer, one body (deriving beats restating).
create or replace function public.auth_visible_tms_load_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select public.driver_visible_tms_load_ids(public.auth_org_id(), public.auth_driver_id());
$$;

-- 2. D-MK20: 'current' = 0655 shows it now (tms: in the set above AND a TMS_DRIVER_VISIBLE_STATUSES status;
--    manual: 0141's driver_id rule). 'late' = was ever dispatched it: any load_dispatches row names the driver, or a
--    driver event of this load carries payload.driver_id = the driver, or the load has a dispatch and the driver holds
--    a McLeod seat. A McLeod repower is covered by the first arm (raw keeps no seat history — the mirror overwrites
--    seats, mirrorLoads.ts — so "a repower recorded in raw" can only be known through the dispatch it undid).
--    An undispatched McLeod load is 'none' for its seat holders: they never saw it (0655), so no queued action exists.
create function public.driver_load_access(p_org uuid, p_driver uuid, p_load uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_source text; v_status text; v_driver uuid; v_co uuid;
begin
  select source, status, driver_id, co_driver_id into v_source, v_status, v_driver, v_co
    from public.loads where id = p_load and org_id = p_org;
  if v_source is null then return 'none'; end if;
  if v_source <> 'tms' then return case when v_driver = p_driver then 'current' else 'none' end; end if;
  if p_load in (select public.driver_visible_tms_load_ids(p_org, p_driver))
     and v_status in ('pending_approval','approved','in_transit','delivered','canceled') then return 'current'; end if;
  if exists (select 1 from public.load_dispatches d where d.org_id = p_org and d.load_id = p_load and d.driver_id = p_driver)
     or exists (select 1 from public.load_events e where e.org_id = p_org and e.load_id = p_load
                 and e.actor_role = 'driver' and e.payload->>'driver_id' = p_driver::text)
     or (p_driver in (v_driver, v_co)
         and exists (select 1 from public.load_dispatches d where d.org_id = p_org and d.load_id = p_load))
  then return 'late'; end if;
  return 'none';
end $$;
-- service_role only, like every parameterised helper.

-- 3. assert_driver_load: same signature and return (aA A-11: returning more is not a create-or-replace). Manual: 0141
--    unchanged (0141:79-86). tms: DL002 only when access is 'none' — closes spec A's hole (an undispatched McLeod load
--    was workable by its McLeod driver_id) and admits the co-driver and the dispatched non-seat 0655 shows.
create or replace function public.assert_driver_load(p_org uuid, p_driver uuid, p_load uuid) returns text …;

-- 4. Replays (N7, spec A §5.2 with aA A-14/A-15): org- and stop-checked; called right after the driver-in-org check
--    and BEFORE access, so a replayed owner-operator decline (which unassigned the load) is a no-op, not DL002.
create function public.load_action_seen(p_action_id uuid, p_org uuid, p_load uuid, p_kinds text[], p_stop uuid default null)
returns boolean …;   -- null id → false; no event with that id → false; same org+load+kind(+stop) → true; else DL012

-- 5. New kind, keeping N-6's list.
alter table public.load_events drop constraint load_events_kind_check;
alter table public.load_events add constraint load_events_kind_check check (kind in (
  'created','submitted','approved','rejected','assigned','reassigned','released','accepted','declined','started',
  'stop_arrived','stop_completed','stop_skipped','equipment_mismatch','amended','canceled','completed',
  'load_changed','exception_resolved','stop_photo_added','stop_removed_in_mcleod','stop_mirror_refused',
  'acknowledged'));

-- 6. Per-photo content hash (spec D M-D2, folded into M-A by D-MK19). Nullable: rows before this have none.
alter table public.load_stop_photos add column if not exists sha256 text
  constraint load_stop_photos_sha256_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');

-- 7. The signature change, once (D-MK19). Old signatures dropped by name, grants re-issued (aA A-10).
drop function public.driver_complete_stop(uuid, uuid, uuid, uuid, text, text, jsonb, uuid, timestamptz);
create function public.driver_complete_stop(
  p_org uuid, p_driver uuid, p_load uuid, p_stop uuid, p_status text,
  p_skip_reason text default null,
  p_photos jsonb default '[]'::jsonb,            -- [{id, slot, storage_path, captured_at, sha256}]
  p_actor_user uuid default null, p_occurred_at timestamptz default null,
  p_action_id uuid default null,                 -- the outbox record id (D-MK23)
  p_arrived_at timestamptz default null,         -- the Arrive the Complete carries (D-MK21, cD DR-9(1))
  p_arrive_action_id uuid default null,          -- that Arrive's own record id, so the late Arrive is a replay
  p_mcleod_write boolean default false           -- the fleet kill only (D-MK12); read by T-4's block
) returns jsonb …;
drop function public.driver_accept_load(uuid, uuid, uuid, uuid, timestamptz);
drop function public.driver_decline_load(uuid, uuid, uuid, text, uuid, timestamptz);
drop function public.driver_start_load(uuid, uuid, uuid, uuid, timestamptz);
-- re-created with a trailing `p_action_id uuid default null`; returns void unchanged.
create function public.driver_acknowledge_load(p_org uuid, p_driver uuid, p_load uuid, p_action_id uuid,
  p_actor_user uuid default null, p_occurred_at timestamptz default null) returns jsonb …;
create or replace function public.driver_add_stop_photos(…same seven parameters as 0645:48-56…) returns integer …;
-- grants: revoke all from public, anon, authenticated; execute to service_role, for every function above.
```

**`driver_complete_stop`, the body, in this order** (0141:280-400 is the base; every step is per source):
1. `driver not in this organization` → DL002 (0141:77's check, inline).
2. `load_action_seen(p_action_id, p_org, p_load, '{stop_arrived,stop_completed,stop_skipped}', p_stop)` → true: return
   `{status:'replayed'}`.
3. `v_access := driver_load_access(…)`; `'none'` → DL002. Read `v_load_source, v_load_status, v_external_id` from
   `loads` with `org_id = p_org` (aA A-55); `p_status` legality (DL010), stop row (`status, seq, completed_at,
   mcleod_removed_at`; none → DL005).
4. **Late evidence** (D-MK20, D-MK15): `v_access = 'late'` or `mcleod_removed_at is not null` → insert the photos
   (`on conflict (id) do nothing`), insert the `stop_*` event (id = `p_action_id`) with payload
   `late_evidence: true, late_reason: 'not_current_driver' | 'removed_in_mcleod'`, touch **no** `load_stops` or
   `loads` column (the current holder's facts are theirs), return `{status:'late_evidence'}`. This return is
   **before** the T-4 slot, so nothing is enqueued.
5. Status gate: manual `accepted, in_transit` (0141:304-305, unchanged); tms — access `'current'` already implies one of
   the five 0655 statuses, so no second list is written here (matrix title pins the two agree).
6. Same status again (0141:311-312): insert any new photos; when one was new, write `stop_photo_added` (0645's kind —
   no new `stop_photos_added` kind, cD DR-11 adjusted) and return `{status:'photos_added', added:n}`; else
   `{status:'replayed'}`. Both sources.
7. Terminal: tms `arrived` on a `completed|skipped` stop → `{status:'already_done'}` (cD DR-12, a co-driver's stale
   tap); every other change of a finished stop → DL003 as 0141:313-315.
8. Skip reason and required photos: 0141:318-337 unchanged.
9. Times. `v_now := coalesce(p_occurred_at, now())`. Manual: 0141:342 unchanged. tms: `arrived` sets
   `arrived_at = coalesce(arrived_at, v_now)`; `completed` sets `arrived_at = coalesce(arrived_at, p_arrived_at)` —
   never `v_now` (no fabricated arrival, spec A §3.1 step 5). When it took `p_arrived_at`, also insert the
   `stop_arrived` event with `id = coalesce(p_arrive_action_id, gen_random_uuid())`, `occurred_at = p_arrived_at`
   (`on conflict (id) do nothing`), so the late Arrive record is a replay. **M-A's plausibility rules** (T2 §T-4.2
   assigned them here): `p_arrived_at > v_now` → the carried arrival is not used and `time_flags` gains
   `arrival_after_departure`; `v_now` earlier than the current dispatch's `sent_at` → `time_flags` gains
   `before_dispatch`. Evidence is never refused for a time; T-4's `mcleod_stop_clear_outcome` answers
   `implausible_time` when `time_flags` is non-empty or the 5-minute future bound fails.
10. `load_stops` update (0141:340-346 shape) and photo insert (0141:349-362) with `sha256 = photo->>'sha256'`.
11. Load side: tms skips 0141:365-370 (`accepted → in_transit`) and 0141:389-399 (`delivered`); `loads.status` stays
    McLeod's (D-LMR2). Manual unchanged.
12. `v_mcleod text := 'off';` then the comment line `-- T-4 (v2/T2-transport.md §T-4.6) inserts the McLeod enqueue
    block here; v_load_source, v_external_id, v_now and v_mcleod are in scope.` — after the stop row and photos,
    before the event (T2's fixed order).
13. The `stop_*` event: `id = coalesce(p_action_id, gen_random_uuid())`; payload = 0141:378-387's plus `driver_id`
    (aA A-15), `action_id`, `time_flags`, `mcleod_write: v_mcleod`.
14. Return `{status:'recorded', stop_status}`.

**The other functions.**
- `driver_accept_load` / `driver_decline_load`: driver-in-org → `load_action_seen` (`accepted` / `declined`) →
  `source = 'tms'` (read with `org_id`) → DL014 "McLeod loads are not accepted or declined in the app" → 0141 body
  with the primary event id = `p_action_id`. `driver_start_load`: same, DL013 "a McLeod load starts at its first stop".
- `driver_acknowledge_load` (spec A §4.1 with aA A-39/A-55): `p_action_id` null → DL015 `action id required`;
  driver-in-org → `load_action_seen(…, '{acknowledged}')` → access: `'none'` DL002, `'late'` → `{status:'late_evidence'}`
  with nothing written; manual → DL014; else the current dispatch's id; a second "Got it" for that dispatch by this
  driver → `{status:'replayed'}`; insert `acknowledged` (id = `p_action_id`, payload `{dispatch_id, driver_id}`).
  Both seats acknowledge separately.
- `driver_add_stop_photos` (0645, same signature and `integer` return): `assert_driver_load` → access; tms load
  status gate = access `'current'` (any of 0655's five) instead of 0645:79-80's `in_transit, delivered`; `'late'` →
  photos stored, the `stop_photo_added` event flagged `late_evidence: true`; the 14-day window (0645:85-86) and the
  photo checks unchanged; each photo's `sha256` stored. Relation to M-D2: the hash is the same column for both doors,
  so MK4's `mcleod_image_sends (stop_id, kind, sha256)` (D-MK8) reads one place.

**Tests** (`driver-load-actions.test.mjs`, new; prints `RESULT`): *visibility = action door* "the co-driver of a sent
McLeod load may complete its stops"; "a driver the office sent a load McLeod seats on someone else may work it";
"a sent load at pending_approval can be worked"; "an unsent McLeod load is refused to its McLeod driver (DL002)";
"driver_visible_tms_load_ids answers what auth_visible_tms_load_ids answers, for both seats"; "the action door's
statuses are TMS_DRIVER_VISIBLE_STATUSES" (reads the shared constant's source text); *late evidence* "evidence from a
driver the load was re-dispatched away from is stored and flagged"; "…after a McLeod repower changed the seats";
"…from the co-driver who had acknowledged it"; "evidence for a stop McLeod removed is stored and flagged, never DL005";
"late evidence changes no stop or load column"; "a driver never dispatched this load is still refused (DL002)";
*replays* "a replayed decline writes one declined event, not two"; "a replayed owner-operator decline is a no-op, not
DL002"; "a replayed arrive after the stop completed is a no-op, not DL003"; "an action id reused on another load is
refused (DL012)"; "an action id reused for another kind is refused (DL012)"; "an action id reused for another stop of
the same load is refused (DL012)"; "the primary event's id is the action id"; "a call without an action id keeps 0141's
state-based idempotency"; *team and photos* "an Arrive after the co-driver completed the stop is a no-op, not DL003";
"a second Complete with new photos records them and changes nothing else"; "a Complete that carries its Arrive records
the arrival once, and the late Arrive is a no-op"; "a Complete without an arrival leaves arrived_at empty on a McLeod
load"; "a carried arrival later than the departure is not used and is flagged"; *McLeod load untouched* "completing
every stop of a McLeod load leaves loads.status as McLeod set it"; "start on a McLeod load is refused (DL013)";
"accept on a McLeod load is refused (DL014)"; "decline on a McLeod load is refused (DL014)"; *Got it* "Got it records
one acknowledged event naming the current dispatch"; "a replayed Got it writes nothing"; "Got it from a second phone
for the same dispatch writes nothing"; "after a re-send, Got it records a new acknowledgement"; "both seats of a team
acknowledge separately"; "Got it without an action id is refused (DL015)"; "a manual load is refused (DL014)";
*late photos* "late photos on a sent McLeod load at approved are accepted"; "a photo's sha256 is stored, and a malformed
one is refused"; *signatures* "the old nine-argument driver_complete_stop no longer exists"; "load_events keeps
stop_photo_added, stop_removed_in_mcleod and stop_mirror_refused". `load-lifecycle.test.mjs`: "assert_driver_load
refuses an undispatched McLeod load (DL002)"; "the co-driver may act on a team load". Mutations
(`scripts/mutation-check.mjs`): drop the `load_action_seen` call in `driver_decline_load`; drop the `kind = any(p_kinds)`
clause; let `driver_load_access` return `'current'` for a seat holder without a dispatch.

**Gates.** `lint:migrations`, `lint:migration-ordering` (functions only; no app reader in this merge),
`lint:schema-snapshot`, `lint:comment-claims`, `lint:table-writers` (`load_events`, `load_stop_photos` producers
unchanged: the functions), matrices, `mutation:check`. **Staging check.** `select proname, pg_get_function_identity_arguments(oid)
from pg_proc where proname in ('driver_complete_stop','driver_acknowledge_load','driver_load_access')` → one row each,
the 13-argument signature; existing staging app (if any build points at staging) still completes a manual stop.
**Rollback.** A migration re-creating 0141's/0645's functions from their text and 0655's helper body; the `acknowledged`
kind and `sha256` column stay (additive). **Release dependency.** stg before N-9; before T-4 (D-MK19).

---

## N-9 C-A1 — API, shared contract and office web for M-A

**What changes for a user.** Dispatchers see "Seen by driver 11/27/2026 9:14 AM" on a sent load, "Not in Dixon's
app — no app login" when a Send cannot reach anyone, "Driver's phone last reached us at 2:05 PM" on a silent active
load, and late evidence in Exceptions. Drivers on today's builds see nothing new.

**Files.**
- **`apps/api/src/modules/driver-app/routes/meLoads.ts` (new; r3S SEQ-15)**: the six load routes move out of
  `routes/me.ts` (462 lines, over the 450 warning): `GET /loads` (`:292`), `runLoadMutation` (`:312-343`), accept
  (`:346-356`), decline (`:359-369`), start (`:372-382`), `stops/:stopId` (`:385-395`), `stops/:stopId/photos`
  (`:401-411`); plus new `POST /loads/:id/acknowledge` (audit `load.acknowledged`). `me.ts` mounts it with one line.
- `apps/api/src/modules/loads/driverLoads.ts`:
  - `tmsLoadsVisibleTo` (PR #2684 `:90`) is deleted; `getDriverLoads` reads
    `admin.rpc("driver_visible_tms_load_ids", { p_org, p_driver })` (throw on error — a silent empty list is how a
    driver loses a load) — the third restatement of 0655's rule is gone. The PostgREST `.or()` keeps 0655's two
    branches (manual 0087, tms with `TMS_DRIVER_VISIBLE_STATUSES`).
  - **14-day window** (D-MK25, Q-8 default): delivered/canceled loads are listed only while
    `coalesce(external_closed_at, completed_at) >= now() - 14 days`; applied in the list only, never in
    `driver_load_access`, so late evidence is unaffected. Stops and photos read via `fetchAllPagedIn`
    (`packages/shared/src/paging.ts:110`), each `.eq("org_id")` and throwing on error (aA A-30, cD DR-15).
  - `LOAD_COLUMNS` (`:70-72`) + `source, customer_name`; `STOP_COLUMNS` (`:74-76`) + `external_status,
    actual_arrival_at, actual_departure_at, mcleod_removed_at`.
  - `acknowledged_at` per tms load: one chunked read of the current dispatch per load and one of `load_events`
    `kind='acknowledged'` (`payload->>driver_id` = me, `payload->>dispatch_id` = current).
  - `PG_TO_API` (`:40-50`) gains `DL012: 422 action_id_reused`, `DL013: 409 mcleod_load_has_no_start`,
    `DL014: 409 mcleod_load_no_offer`, `DL015: 422 action_id_required`.
  - Every action passes `p_action_id: input.action_id ?? null`; `completeStop` also `p_arrived_at`,
    `p_arrive_action_id` and each photo's `sha256`. `p_mcleod_write` is **not** passed here (T-5 adds it).
  - The mutation answer gains the function's `status`: HTTP 200 `{ load, status }`, where `status` is
    `recorded | replayed | photos_added | already_done | late_evidence` (D-MK20: late evidence is 200, never 4xx).
- **Every API error body carries `{code}`** (D-MK21): `toLoadError` already maps to a code; `meLoads.ts` sends
  `{ code, message }` for every refusal, and the generic error handler's 5xx body gains `code: "server_error"`.
- `packages/shared/src/loadsContract.ts` (259) + `loadsLifecycle.ts` (197): `loadSchema` (`:103-119`) +
  `source: z.enum(["manual","tms"]).default("manual")`, `acknowledged_at: z.string().nullable().default(null)`;
  `loadStopSchema` (`:80-100`) + `external_status`, `actual_arrival_at`, `actual_departure_at`, `mcleod_removed_at`,
  all `.nullable().default(null)` (cD DR-4: an app must parse an older or rolled-back API). `action_id: recordId().optional()`
  on `acceptLoadRequestSchema` (`:134`), `completeStopRequestSchema` (`:153-160`), `addStopPhotosRequestSchema`
  (`:174`), and on `declineLoadRequestSchema` / `startLoadRequestSchema` (`loadsLifecycle.ts:136-146`); new
  `acknowledgeLoadRequestSchema` with `action_id` **required**. `completeStopRequestSchema` + `arrived_at`,
  `arrive_action_id` optional; `stopPhotoInputSchema` (`:140`) + `sha256` optional. `LOAD_EVENT_KINDS`
  (`loadsLifecycle.ts:150-160`) + `acknowledged`, `stop_removed_in_mcleod`, `stop_mirror_refused`;
  `LOAD_EVENT_LABELS` (`:176-197`) "Seen by driver", "Removed in McLeod", "McLeod stops not applied".
- New `packages/shared/src/driverLoadPhase.ts` (spec A §3.3 with aA A-20: `driverLoadPhase(load)` reads
  `load.acknowledged_at`, no second parameter): `awaiting_ack | upcoming | current | previous`; `nextStop` moves onto
  `nextStopOnRoute` / `isStopBehindTruck` (`loadBoard.ts:192-197`, spec A C5), so a removed stop and a stop McLeod
  departed are behind the driver.
- `packages/shared/src/loadDispatchContract.ts` `LoadDispatchSummary` + `acknowledgements: {driverId, driverName,
  at}[]` and `reachable: { ok: true } | { ok: false; reason: "no_app_login" | "uncovered_in_mcleod" | "closed" }`;
  `seatNote: "mcleod_seats_someone_else" | null`.
- `apps/api/src/modules/loads/dispatchToDriver.ts` (257): `dispatchesByLoad` (`:208-257`) attaches acknowledgements
  (one chunked `load_events` read, names via the existing `drivers(full_name)` join). `reachable` is **derived**, not
  restated (cD DR-14, re-derived against 0655): `closed` when `external_closed_at` is set; `uncovered_in_mcleod` when
  `loads.status = 'draft'` (0655 shows every other McLeod status); `no_app_login` when the dispatched driver has no
  `user_id` or `app_access_enabled` is false — the predicate PR #2689's `inApp` already computes in `prepare()`, so
  N-9 exports it once as `driverHasAppLogin(driver)` and both read it (N-19) (the 1-of-195 fact makes this the
  commonest case today);
  `seatNote` when the dispatched driver is neither McLeod seat (0655 still shows them the load — the office's dispatch
  decides, D-LMR6 — but the office should know McLeod disagrees, e.g. after a repower). The Dispatch drawer's
  preview already says the `no_app_login` case before Send (#2689's `inApp` line); N-9 adds `uncovered_in_mcleod`
  and `seatNote` to that preview from the same derivation.
- `apps/api/src/modules/loads/dispatchLoads/exceptions.ts` (166): `EXCEPTION_KINDS` + `late_evidence` (events whose
  `payload->>late_evidence = 'true'`, one extra read), `dispatch_not_visible` (current dispatch with `reachable.ok =
  false`, derived over open loads), `stop_mirror_refused` (open while no later `exception_resolved` names it). The two
  existing `load_events` reads (`:82-94`) are T-5's to page (D-MK32); N-9 adds its reads through `fetchAllPagedIn` from
  the start. The kinds table (r3S SEQ-14) after N-9: B3's `unmatched_assignment` (N-5), N-9's three, T-5's write kinds.
- **D-MK22, phone last reached us**: `dispatchLoads/detail.ts` (`:165` neighbourhood) and the board row derive
  `lastContactAt = max(load_events.recorded_at where actor_role = 'driver' and payload->>driver_id = d)` and
  `device_push_tokens.last_seen_at` (the column is `last_seen_at`, `schema.generated.sql:2428` — the register's
  "`updated_at`" corrected) of the driver's login; on a load with an open dispatch and status `pending_approval,
  approved, in_transit`, when older than 60 min: "Driver's phone last reached us at h:mm A" (`formatDateTime`).
- Web: `apps/web/src/features/dispatch/useLoadDispatch.ts` `dispatchHeadline` (`:69`) appends ` · Seen {date time}`
  or the team form; `DispatchLoadDetailPage.vue` (357) shows the dispatch fact, `reachable`, `seatNote`, the
  last-contact line and stops labelled "Removed in McLeod"; `LoadExceptionsTable.vue` words the three kinds.
  `DispatchLoadsPage.vue` (495) is not edited (budget; the headline is a computed string the cell already renders).
- Stale comments rewritten (aA A-54/spec A C6): `driverLoads.ts` doc comments, `loadsContract.ts:13-17`,
  `loadsLifecycle.ts:18-22`.
- `scripts/table-lifecycle.json`: `load_events` budget to 1,500/day, `load_stop_photos` to 1,400/day (aA A-40).

**Tests.** `driverLoads.test.ts` (rewritten around the PR #2684 cases): "asks driver_visible_tms_load_ids with this org
and driver, and reads only those McLeod ids, org-scoped" (`expectOrgScoped`); "an RPC error throws instead of answering
an empty list"; "stops and photos are read in pages, org-scoped"; "a load delivered 15 days ago is not listed but still
accepts evidence"; "every load action passes the action id to its function"; "a Complete passes the arrival it carries
and each photo's sha256"; "late evidence answers 200 with status late_evidence"; "acknowledged_at is this driver's ack of
the current dispatch only". `meLoads.test.ts`: "every refusal carries a code"; "Got it without an action id is 422
action_id_required". `loadsContract.test.ts`: "a load from an API without source/acknowledged_at still parses";
"a stop without the McLeod fields still parses". `driverLoadPhase.test.ts`: "a sent McLeod load nobody touched awaits
Got it"; "after Got it it is upcoming"; "the driver's first Arrive makes it current with loads.status still approved";
"McLeod's in_transit makes it current before the driver taps anything"; "a stop McLeod departed is behind the driver
even if they never tapped it"; "a stop removed in McLeod is behind the driver"; "every stop behind → previous even while
McLeod says in_transit"; "delivered/canceled → previous"; "a manual offered load is still an offer". `loadOnTruck.test.ts:100`
replaced by "the driver's nextStop is the office's nextStopOnRoute: a stop McLeod departed is behind the driver (Q-MK3)"
(aA A-18). `dispatchToDriver.test.ts`: "a dispatch seen by its driver lists the acknowledgement"; "a dispatch to a driver
with no app login says the driver will not see it"; "a dispatch of an uncovered McLeod load says nobody will see it";
"a dispatch to a driver McLeod does not seat is visible to them and says McLeod seats someone else".
`exceptions.test.ts`: "late evidence is an open exception naming the driver and the stop"; "a sent load nobody can see
is an open exception"; "a refused stop mirror is open until the next clean apply". `useLoadDispatch.test.ts`: "a
dispatch seen by its driver says Seen with the time"; "a team dispatch names who has seen it and who has not".
`DispatchLoadDetailPage.test.ts`: "the dispatch fact shows the driver's acknowledgement"; "a silent phone on an active
load shows when it last reached us"; "a stop removed in McLeod is labelled".

**Gates.** `lint:shared-contracts`, `lint:record-id`, `lint:date-format`, `lint:filesize` (`me.ts` shrinks below 450),
`lint:funcsize`, `lint:table-access`, `lint:boundaries`, `lint:comment-claims`, `test-api`, `test-web`, `test-packages`.
**Staging check.** On staging: post the fixture, Dispatch → Send it to the staging test driver; the load page reads
"Not in {name}'s app — no app login" for a driver without a login, nothing for the test driver;
`curl` `GET /api/me/loads` as the test driver lists it at `approved` with `source: "tms"`, `acknowledged_at: null`;
`POST …/acknowledge` with a uuid → the load page says "Seen by driver …". **Rollback.** Revert; the SQL stays
(it answers the old API identically except the new statuses, which the old API ignores). **Release dependency.** prod
before N-17 is built for the tablets (the app's new fields default, so order is safe either way; the feature needs it).

---

## N-19 Send reaches the app — BUILT by PR #2689 (no T1 PR)

**Status (corrected 2026-11-27, chat 3).** This step is **built** by PR #2689 (`claude/driver-s1-send-push`,
enterprise plan S1.1's second half; `gh pr diff 2689`). T1's first draft of N-19 (a new `load_dispatched` category and
"a notification, not a `channel='app'` row") is **withdrawn**; nothing below is to be built again. What #2689 does,
read from its diff:
- **One `load_dispatches` row per Send, its channel decided by the login.** `dispatchToDriver.ts` `prepare()` reads
  `drivers.user_id, app_access_enabled`; `inApp = user_id != null && app_access_enabled === true`. With a login the row
  is `channel='app', outcome='sent', outcome_reason=null`; without one it is the held `sms` / `not_sent` row as before
  (Q-LMR9). The visibility rule (0371/0655) reads the latest row whatever its channel, so "latest dispatch decides"
  still reads one line per decision.
- **The notification is the existing `load_offered` category** (`notificationsContract.ts:18`, deep link `/loads/:id`
  at `:344`), titled "New load from dispatch", body "Load {ref} is in your app.", sent through messaging's `notify()`
  (mutes, quiet hours, dedupe) by `tellDriversOfDispatch` to the dispatched driver's login and, when the dispatch names
  the load's McLeod `driver_id`, to `loads.co_driver_id`'s login (O-3, the seats 0655 shows); `dedupeKey =
  load_dispatch:<dispatch row id>:<user id>`. A failed notify never fails the Send. **No migration**: no new category.
- **The office is told beforehand.** The preview contract (`loadDispatchContract.ts`) gains `inApp: boolean`; the web
  Dispatch drawer says "Send puts this load in X's app and notifies them." or "X has no app login, so this load won't
  reach their phone. Dispatching still records who takes the load and when. Set up app access on the driver's page.";
  the toast says "It is in their app now."; `dispatchHeadline` adds " · in their app" for an `app`/`sent` row.
- **Boundary edge `loads -> messaging`** (`scripts/check-feature-boundaries.mjs`, the `hazmat -> messaging` shape;
  messaging imports nothing of loads).
- Tests (its titles): "puts the load in the app of a driver with an app login: one app/sent row, and a New load notice to
  driver and co-driver (S1.1)"; "tells nobody, and keeps the held text record, when the driver has no app login";
  "says before Send whether the load reaches the driver's app (S1.1)".

**What T1 still owes against #2689 (carried by N-9, not a new PR):**
- N-9's `reachable.no_app_login` is the **same predicate** as #2689's `inApp`; N-9 derives it by calling one exported
  `driverHasAppLogin(driver)` in `dispatchToDriver.ts` that both `prepare()` and `dispatchesByLoad` use, so the preview
  line, the history line and the `dispatch_not_visible` exception cannot disagree (deriving beats restating).
- N-9's `acknowledgements` read the current dispatch row of either channel (an `app` row is the normal case once logins
  exist; production on 2026-11-27 has 1 login of 195 active drivers, so `sms`/`not_sent` stays the common row).
- `dispatchHeadline`'s " · Seen {date time}" (N-9) is appended after #2689's " · in their app".

**Release dependency.** #2689 ships in the release that carries it; on 2026-11-27 it was open with CI running. If it
were closed unmerged, the build is exactly #2689's diff (it is the ruled shape), re-opened under N-9. The dispatcher
briefing (D-MK34, Q-9) says Send is how a load reaches the phone.

---

## N-10 B4 — BOL, customer, McLeod times, references (expand); agent statements ride CU-1

**What changes for a user.** The office load page and hover show BOL #, customer, weight, pieces and McLeod's actual
times; the driver's "This load" card shows them once N-17 is on the tablet. Reference numbers appear after CU-1 and N-12.

**Files** — spec B §3.3–§3.5 and §3.8 (`B-data-fixes.md:206-415, 479-489`) as amended by aB: statements placed after
`DISPATCH_LOAD_STOPS` (B-5); `MIRROR_SHAPE = 2` salt so the first cycle re-sends every movement (B-6/B-30); the
mixed-shape guard covers every stop of the payload, and its reason is supabase-js filling a missing key with NULL
(B-7); `dispatchMovementIngest.ts:13-18` header amended (B-8); plain `title` attribute, no tooltip component (B-13);
`DispatchLoadsPage.vue` (495) gets the Load # cell extracted to a component so it falls below 450 (B-14, V4-25);
one shared `clockOf` (B-25); shared `stopMcleodFactsSchema` defaults (aA A-47(3)); reprojection script
`apps/api/src/scripts/reprojectMcleodMirror.ts`. **API half merges alone** (this PR); the **agent half** —
`tools/mcleod-agent/queries.mjs` statements, `loads.mjs` mapping, `dryRun.mjs` counts, regenerated
`review/SILVICOM-READ-ROUTINE.sql` — is a commit inside **CU-1** (T2 §CU-1, D-MK38): one SQL review by Alex covering
B4's statements and the test-company read, one VM visit. B4's Step 0 (column names, `HAS_PERMS_BY_NAME` on the analytics
copy, B-10/B-33) runs in that visit.

**Tests.** Spec B §3.3/§3.9 titles verbatim (agent: "a stop carries its reference numbers, qualifier and value,
de-duplicated", "a stop with no reference rows sends an empty list, never omits the key", "a reference with no
qualifier or no value is not sent", "the reference statements join stop and company, never stop alone", "the close
read returns a references statement with one parameter per id", "the mirror dry run prints reference qualifier counts
and no reference value", "every close-read statement is in the routine the carrier reviews"; API: "a stop's references
are stored raw", "a connector that sends no references leaves stored ones alone", "a payload mixing stops with and
without references is refused by name", "the BOL number is McLeod's blnum, empty is null", "the projection writes
bol_number", "re-projecting twice writes the same loads", "it refuses an org whose name does not match").

**Gates.** spec B §7 B4 row. **Staging check.** Spec B §3.9's walk (fixture with `blnum`, weight, pieces → load page
facts). **Rollback.** Spec B §8. **Release dependency.** prod before CU-1's VM visit.

## N-11 V1 — the PU qualifier, verified (operation, no PR)

Spec B §3.6 with aB B-31/B-32/B-41: after CU-1 is on the VM, run the fill and qualifier queries read-only on
production, then the owner-named dispatcher reads three loads' pickup numbers on McLeod's screen and the result is
recorded with the screen field read. **Builds per outcome:** PU rows are pickup numbers → `PICKUP_NUMBER_QUALIFIERS =
["P8","PU"]`; PU rows are previous BOL numbers → `["P8"]` and PU is labelled "Previous BOL #"; P8 itself is not the
pickup number → `pickup_number` stays null and the stop references are shown under their codes only (no label guessed).
**Waits on:** the owner naming one dispatcher (`api-kit-round3/3-external.md` §3.3 item 8).

## N-12 B5 — PU number and stop references (contract phase)

Spec B §3.4 B5 half: projection writes `loads.pickup_number` (V1's constant) and `load_stops.reference_numbers` (no RPC
change — N-6 derives its column set); `tmsDispatchStopSchema.reference_numbers` becomes required. **Tests.** Spec B
§3.9's PU titles ("the PU number is P8 on the first pickup stop", "PU is used only when no pickup stop carries P8", "two
P8 values on one stop are both kept", "a pickup stop not yet read gives no PU number, not a guess", "a PO on a pickup
stop is not a PU number", "references on a stop are projected verbatim", "the stop's PO is shown once, from the stop",
"an unknown qualifier is shown under its own code") and aB B-28's "refuses a stop missing reference_numbers rather than
keeping a stale list" plus "keeps reference_numbers when sent and omits nothing" (the `it.each` cannot carry it).
**Release dependency.** After V1; load-rates R5 flips its keys separately (V4-22).

---

## N-4 C-16 — a 360-hired driver is linked to McLeod

**What changes for a user.** A driver hired in 360 and then entered in McLeod by the office becomes one roster row,
not two. Drawer text while McLeod create is off: "Enter this driver in McLeod. 360 will connect them on the next McLeod
sync."

**Files** (cO OF-3, cR RT-19, register D-MK28's C-16 sentence): new `apps/api/src/modules/roster/linkHiredDriverToTms.ts`
exported from `roster/index.ts` (beside `handApplicationToTms`, `:52`; `linkHiredDriverToTms` does not exist yet —
grep 2026-11-27): `linkHiredDriverToTms(admin, orgId, driverId, mcleod: { driverId, companyId })` sets
`mcleod_driver_id`, `mcleod_company_id`, `identity_source = 'mcleod'` on an **active `manual` row with no McLeod id**
that has a `compliance.applicant_hired` audit row in the last 30 days, org-scoped, returning whether it linked. The
D-RL5 sweep (`apps/api/src/modules/mcleod/rosterApplicantHire.ts`, `hireApplicantsFromTms` `:53`, called from
`rosterIngest.ts:341`) calls it when `rosterMatch` pairs such a row with McLeod's driver by licence and `sameName`.

**Tests.** `linkHiredDriverToTms.test.ts`: "a 360-hired manual row is handed to McLeod when McLeod's driver matches by
licence and name"; "a row that already has a McLeod id is never relinked"; "a manual row hired more than 30 days ago is
not linked"; "the update is scoped to the caller's org" (`expectOrgScoped`).

**Gates.** `lint:boundaries` (mcleod calls roster's export), `test-api`. **Staging check.** None possible beyond the
unit tests (no McLeod roster feed on staging); production check after release: `select count(*) from drivers where
identity_source='mcleod' and …` before/after one sweep, pasted in the progress log. **Rollback.** Revert; links made
stay (they are correct). **Release dependency.** prod (only production's sweep runs it).

## N-5 B3 — McLeod id first; an unmatched assignment becomes an office exception

Spec B §4 (`B-data-fixes.md:515-674`) with aB B-16 (`trucks_unresolved` added to §4.4's query), B-18 (`perLoad`
declared per movement), B-19 (Drivers link uses `DRIVERS_QUERY_KEYS.search`, URL key `q`), B-35 (null and `[]` equal:
"relink treats no unmatched codes and null as the same"), B-36 (`entityLookup.test.ts` fixtures, the incident comment
moves with the functions), B-40 (new `LoadExceptionsTable.test.ts`). Exception kind `unmatched_assignment` joins
N-9's kinds (r3S SEQ-14).

**The act that clears each reason** (aB B-20; closed by one production measurement in the PR, read-only, then fixed):
the PR runs, for each open unmatched truck/trailer code, whether the code exists in the McLeod `tractor`/`trailer` raw
rows the roster sweep reads.
| Measured | What the exception row says and links to |
|---|---|
| driver code unknown | "McLeod driver {code} is not on the roster" → Roster held list (`RosterHeldList`) with the code searched |
| truck/trailer code present in McLeod's unit rows (the sweep will create or link it) | "Waiting for the next McLeod roster sync" — no action, it clears itself |
| truck/trailer code absent from McLeod's unit rows | "McLeod has unit {code} on the load but not in its unit list — a McLeod data fix" → names Alex's queue (no 360 action) |
| ambiguous (two unlinked units share the number) | "Two trucks are numbered {code}" → Trucks/Trailers with the code searched |

**Tests.** Spec B §4.3 titles verbatim, plus the four rows above as "an unknown driver code links to the roster held
list", "a unit McLeod lists is shown as waiting for the sync", "a unit McLeod does not list is shown as a McLeod data
fix", "an ambiguous unit links to the units page with the code searched". **Release dependency.** prod.

## N-13 B6 — the rig pick list puts the load's truck and trailer first

Spec B §5 with aB B-21 and cD DR-16: the planned load set is `driver_visible_tms_load_ids(org, driver)` (N-8's), so
the pin exists only for a load the driver can see and the co-driver gets it too; new
`apps/api/src/modules/loads/driverPlannedEquipment.ts`, `dutyContract.ts` `is_planned`, `dutySessions.ts` ordering,
`apps/driver/src/features/duty/checkInModel.ts`, `startShortcutModel.ts`. **Heading ruled here** (B-21(c), copy
only): the start card (`apps/driver/src/screens/today/StartShift.tsx`, which replaced `StartDayCard.tsx` in V5, `903bec235`)
reads **"Dispatch's truck for today?"** when the shortcut offers the planned truck, else its current text. **Tests.**
Spec B §5.3 titles verbatim, plus "the planned unit is pinned only for a load the driver can see" and "the start card
asks about dispatch's truck when it offers the planned one". **Release dependency.** API prod; app half ships with N-17.

## N-14 B7 — the board shows the driver's arrival where McLeod has none, labelled

Spec B §6 unchanged, with aB B-24 (DB7's 14-day window restarts at B7's release; say so in the PR) and B-34 (display
precedence only). Titles: spec B §6.3 verbatim. **Release dependency.** prod; it shows nothing until drivers tap (N-17
on tablets).

---

## N-15 S0c — ETA predictions keyed by stop id (D-MK17)

The index and the band **stay**. Two merges (the third, "readers", has no reader to change: grep 2026-11-27 finds no
reader of `load_stop_eta_predictions` outside retention; DB7's scoring run, T3's D-11, reads `stop_id` from its first
line):
- **N-15a** loads migration: `alter table public.load_stop_eta_predictions add column stop_id uuid references
  public.load_stops(id) on delete set null; create index … on (org_id, stop_id);` backfill `update … set stop_id = ls.id
  from load_stops ls where ls.load_id = p.load_id and ls.seq = p.stop_seq and ls.mcleod_removed_at is null` (table and
  `stop_seq` at `0453_load_stop_eta_predictions.sql:40-63`). Header lists every `(load_id, seq)` consumer (aA A-52):
  `etaPredictions.ts:39`, `boardEtaRecorder.ts:37-40`, `activity.ts:63`, `truckLoadPlanReads.ts:105,110`.
  Matrix (`eta-predictions` new): "the backfill keys each prediction to the stop at its sequence"; "a prediction whose
  stop is gone keeps its sequence and a null stop id".
- **N-15b** `apps/api/src/modules/loads/etaPredictions.ts` writes `stop_id` beside `stop_seq`; `boardEtaRecorder.ts`
  passes the stop's id. Test: "a recorded prediction names its stop id".
**Release dependency.** N-15a ≥ 1 release after N-7 in production.

---

## N-16 Hire again — roster half (D-MK28; T3 owns the McLeod reactivate write)

**What changes for a user.** On a former driver's page, **Hire again** reopens their row as an applicant (same McLeod
id, audited) instead of creating a duplicate.

**Files** (cO OF-1 as the base, the register over V4-10):
- Roster migration `<next>_reopen_former_driver.sql`: `reopen_former_driver(p_org, p_driver, p_actor) returns jsonb`
  (terminated → applicant, `termination_date` **kept** until the close, `reopened_at` recorded in the audit row);
  `hire_applicant` re-created from `0386_applicant_hire_guard.sql:88-161` so the close also sets `termination_date =
  null, archived_at = null` (D-MK28; `drivers.termination_date` `schema.generated.sql:3446`, `archived_at` `:3480`).
- `apps/api/src/modules/roster/driverReopen.ts`, route `POST /api/recruitment/drivers/:id/reopen` (gate inline, RT-16),
  audit `driver.reopened_for_rehire`, 409 `former_driver_exists` for a non-terminated row.
- **Who may press it (D-MK28 "managers only until Q-3"), mapped to the permission catalogue, not a role list:** new
  editable permission `recruitment.reopen_former_driver` in `packages/shared/src/rolePermissions.ts` beside
  `CLOSE_APPLICATION_PERMISSION` (`:49`, row `:115-121`), `shippedRoles: ["fleet_manager", "safety_manager"]` (the
  admin holds every permission). **Q-3 builds:** yes → the owner (or the carrier) ticks the recruiter in Settings →
  Permissions, no code; no → nothing changes.
- The D-RL5 sweep (`rosterApplicantHire.ts:53`): while the `driver_reactivate` switch (T3) is not `live`, a reopened row
  is hired **only** when McLeod shows that driver active with `hire_date` ≥ the reopen date; otherwise skipped.

**Tests.** `reopen-former-driver.test.mjs`: "a former driver reopened for rehire becomes an applicant with the same
McLeod id"; "closing a reopened application clears termination_date and archived_at"; "an active driver cannot be
reopened". `rosterApplicantHire.test.ts`: "a reopened former driver whom McLeod reactivates by hand is hired by the
sweep once while reactivate is off"; "a reopened former driver McLeod still shows terminated is not hired by the sweep";
"a linked-but-not-hired applicant is still hired by the next sweep". `driverReopen.test.ts`: "Hire again needs
recruitment.reopen_former_driver"; "it is scoped to the caller's org". `rolePermissions.test.ts`: "reopening a former
driver ships to the fleet and safety managers, not the recruiter". Obsolete, not written: V4-10's "a reopened row is
not hired by the sweep once reactivate is on".

**Release dependency.** prod after N-4. **Waits on:** Q-3 only for who else presses it.

---

## N-17 C-A2 — the driver app (local builds, D-DA12)

**What changes for a user.** On a tablet with a local build: a sent McLeod load shows "Dispatched" with one **Got it**
button; then one big button per step ("I'm here" → photos → "Complete stop" → next stop, DF-4); a secondary "I already
left — finish without an arrival time"; a finished stop offers **Add photos**; nothing is lost offline; after 60 min
of failing, "Not sent yet. Keep the app open where you have signal."

**Files** (spec A §3.4/§4.4/§5.3 rebased onto the merged V5–V7 screens, D-MK27; every line re-read 2026-11-27):
- `apps/driver/src/data/sync.ts:25-36` `SyncError` gains `code` from the `{code}` body (D-MK21).
- `apps/driver/src/data/policy.ts` (180): `outcomeAfterFailure` (`:77-108`): for kinds `load_stop`, `load_ack`,
  `load_photos` and the load actions, a transient failure (`isTransient`, `:42-46`) **never** dead-letters (as 429 does,
  `:94-97`), backoff capped at 15 min; a 4xx **with a code** goes to Needs attention as today (`:100-101`). Records gain
  `firstFailedAt` (outbox column, `outbox.ts` migration of its SQLite schema with default null). No phone-side FIFO
  (D-MK21): `claimNext` (`outbox.ts:95-120`) unchanged.
- `apps/driver/src/data/handlers.ts` (339): `loadHandler` (`:51-62`) and the stop handler (`:128-158`) send
  `action_id: record.id` (the record's id, so records queued before this build carry one too, cD DR-24); the stop
  handler sends `arrived_at` + `arrive_action_id` from the optimistic cache when a Complete follows an unsent or
  failed Arrive, and each photo's `sha256` (computed at capture, `expo-crypto` digest of the staged file); new
  `LOAD_ACK_KIND = 'load_ack'` registered beside `:120-122`; `FailedSyncList.tsx` labels "Confirming a load" and shows
  "Not sent yet…" for a record whose `firstFailedAt` is older than 60 min.
- `apps/driver/src/features/loads/useLoads.ts`: `useAcknowledgeLoad()`; `patchStop` (`:108-146`) unchanged; accept/
  decline/start hooks offered only for manual loads.
- `loadViewModel.ts` `bucketLoads` (`:53-63`) by `driverLoadPhase`; `awaiting_ack` first in Upcoming (aA A-19).
  `loadStatus.ts` keeps 0655's "Dispatched" and reads the phase.
- `app/loads/[id].tsx` (241) footer (`:113-156`): tms `awaiting_ack` → **Got it**; otherwise the next-stop button
  (no Start on McLeod loads); manual unchanged.
- `app/loads/[id]/stop/[stopId].tsx` (357; `stopFooter` from `stopCaptureModel.ts:81`): tms pending → "I'm here";
  arrived → "Complete stop"; secondary "I already left — finish without an arrival time"; completed/skipped →
  **Add photos** (`driver_add_stop_photos` via the existing late-photos handler), Skip hidden (cD DR-11); a stop McLeod
  departed shows "Dispatch has this stop done at {time}. You can still add your photos."; a removed stop shows
  "Removed in McLeod — your photos still go to the office"; while unsent captures exist and the load left the list,
  the screen keeps the last-seen load and offers "Send these photos to the office" (cD DR-22). S3 edits this file
  after S1 (enterprise plan §5 table).
- No pay, settlement, detention or lumper screen (D-DA1).

**Tests.** `apps/driver` `policy.test.ts`: "a load_stop record is never dead-lettered by a 500"; "a stop action is
never dead-lettered by timeouts, however many"; "a load_stop record with a refusal code goes to Needs attention";
"a load_stop backoff caps at 15 minutes"; "a record failing for over 60 minutes says Not sent yet". `handlers.test.ts`:
"a load action posts the outbox record id as action_id"; "a record queued before this build still posts its record id";
"a Complete after an unsent Arrive carries the arrival and its record id". `load-view-model.test.ts`: "an approved
McLeod load the driver arrived at is in current"; "an unacknowledged McLeod load leads the Upcoming list".
`load-status.test.ts`: "a McLeod load is Dispatched, never Accepted". `stop-capture-model.test.ts`: "a finished stop
offers Add photos and hides Skip"; "a McLeod stop offers I'm here before Complete". Obsolete, not written: aA A-21's
per-stop FIFO title, cD DR-9's two per-load FIFO titles, r3R R3-5's "a 500 … dead-letters after 8 attempts".

**Gates.** driver `lint`, `lint:tokens`, `lint:design`, `test`; `native-android` runs (all of `apps/driver/` is on
`NATIVE_INPUTS`, cD DR-20); no iOS job. **Device check (replaces "staging check", D-DA12).** A local release build
pointed at **staging** (`apps/driver` staging env) installed by `adb` on the Tab A9; post the fixture twice, Send it to
the staging test driver: the load shows Dispatched → Got it → stop ids unchanged after the second post → I'm here →
photos → Complete; with the API host blocked (not airplane mode — cD DR-9: nothing is attempted offline), the record
stays queued past 60 min and says "Not sent yet", then sends when unblocked. Screenshots to the owner before merge.
**Rollback.** Reinstall the previous local build by `adb`. **Release dependency.** N-9 in production; the tablets'
logins issued (S7.10).

## N-18 `action_id` required (D-MK23)

`.optional()` is removed from the five request schemas, so the API answers 422 `action_id_required` without one.
**Precondition, recorded:** R3-21's count was run on 2026-11-27 (§ facts: 2 iOS tokens on `1.0.0`, last seen
2026-09-15, none Android) — no installed build that drivers use sends load actions today. Re-run the same query before
merging, restricted to tokens seen in the last 30 days: the PR merges only when every such row reports the N-17 build's
`app_version` or later. Test: "a stop action without action_id is refused with action_id_required". **Release
dependency.** prod before any S-3 store tag (D-MK23: from the first store build).

---

## S-1..S-4 The store track — prepared, not published (D-DA12)

- **S-1** `.github/workflows/driver-store.yml` (212 lines; `actions/checkout@v4` at `:64` has no `fetch-depth`; no
  ancestor check): `fetch-depth: 0`; `git fetch origin production`; a step on **every** trigger, `workflow_dispatch`
  included (D-MK26), running new `scripts/driver-store-ancestor.sh "$GITHUB_SHA" origin/production`, which exits 1 with
  "::error::cut driver builds only from a commit production already serves" unless `git merge-base --is-ancestor`
  holds (a script, so it can be tested: the repo has no workflow test harness). Header (`:3-15`, which still names the
  deleted `driver-android.yml` lane) rewritten; `RELEASE-GATE.md` Gate D (`:117`) gains the row. Test
  `scripts/driver-store-ancestor.test.mjs` (a throwaway git repo whose `production` trails `main`): "a dispatch from
  main ahead of production is refused"; "a commit production serves is accepted". The test is chained onto `lint:release-train` (the release-lane gate) and its
  `"//lint:release-train"` comment says so (CLAUDE.md: a gate in neither list is not a gate). Every field the app newly reads has a default (N-9, D-MK26). **Merged now**; it changes
  nothing that runs (the workflow has never run, R12).
- **S-2** owner accounts — enterprise plan S7.1–S7.5 and register Q-5 (Apple Individual → Organization, Play internal
  track only if Q-DA2 says yes). **Prepared, not used** until the owner rules the app finished.
- **S-3** the first tag `driver-v1.0.0-rc.1` (enterprise plan R12), cut from a commit production serves (S-1), carrying
  N-9's API in production, N-17 and N-18 — so no store build ever shows a sent McLeod load with the pre-N-17 screens
  (cD DR-3). **Held by D-DA12.** Until then, S7.9's local release build is the delivery.
- **S-4** promotion (internal track → testers) — **held by D-DA12 and Q-DA2**. Builds per outcome: the owner rules the
  app finished and Q-DA2 = yes → Android internal track first, iOS through external TestFlight (register §6 "Store
  release" silence row; TestFlight builds expire after 90 days, `3-outcomes.md` F9); Q-DA2 = no → only the finished
  ruling releases S-3/S-4; never → tablets stay on local builds and every driver benefit stays on the fleet's tablets.

---

## Rulings made in this document (no owner question; chat 3 records them in `v2/RE-RULINGS.md`'s preamble)

1. **0655 is the visibility rule; M-A derives the action door from it** (§0): one parameterised body,
   `driver_visible_tms_load_ids`, with 0655's helper re-created as its wrapper; `assert_driver_load` and every driver
   function admit whom 0655 shows. Spec A's `driver_visible_load_ids` / status list `approved…canceled` (Q-MK5) is
   superseded by 0655's five statuses (DF-1).
2. **D-MK20's "repower recorded in raw" arm is subsumed by the dispatch arm** (raw keeps no seat history), and the
   "either current seat" arm requires the load to have been dispatched at all.
3. **D-MK19's "every new parameter" includes `p_arrived_at` and `p_arrive_action_id`** (D-MK21 needs them; the
   register lists only three).
4. **Late evidence changes no `load_stops`/`loads` column**; it stores photos and a flagged event only.
5. **A second Complete with photos uses 0645's `stop_photo_added` kind** (no `stop_photos_added`); `driver_add_stop_photos`
   keeps its signature and gains the tms status gate and `sha256`.
6. **M-A never refuses evidence for a time**; it flags `time_flags`, and T-4 answers `implausible_time`.
7. **DR-14's reasons re-derived against 0655**: `no_app_login`, `uncovered_in_mcleod` (draft), `closed`, plus a
   `seatNote` when McLeod seats someone else (the load stays visible to the dispatched driver).
8. **N-19 is built by PR #2689, and its shape replaces this list's first draft**: a Send to a driver with an app login
   writes ONE `load_dispatches` row `channel='app', outcome='sent'` (else the held `sms` row) and notifies the driver and
   the McLeod co-driver under the existing `load_offered` category ("New load from dispatch"); no `load_dispatched`
   category exists. N-9's `reachable.no_app_login` derives from #2689's `inApp` predicate (one function).
9. **Hire again's "managers" = a new editable permission shipped to fleet and safety managers** (Q-3 = a Settings tick).
10. **D-MK22's push-registration column is `last_seen_at`**, not `updated_at`.
11. **S0c has no reader merge**: no reader of the predictions table exists.

## Owner and outside answers this track waits on

Q-3 (N-16, who else presses Hire again — default managers), Q-5 and Q-DA2 with D-DA12's "finished" ruling (S-2..S-4),
Q-8 (14 days, the default built), the owner naming a V1 dispatcher (N-11), Alex's one SQL review and VM visit (CU-1,
then N-11/N-12), the CloudWatch count before N-7's 410 (an operation, not an owner question), Q-9 (the dispatcher
briefing that Send is how a load reaches the phone; N-19 itself is built by PR #2689). Q-1..Q-10 were unanswered on 2026-11-27; none is assumed.
