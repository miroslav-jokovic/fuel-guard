-- 0422: production and the migrations describe one schema again (RELEASE-TRAIN-PLAN Q-REL6)
--
-- Building the staging project from these migrations on 2026-10-02 and fingerprinting it against
-- production (columns, indexes, triggers, function signatures, policies, RLS flags) found the two
-- had drifted in BOTH directions. 0413 (grants) and 0414 (`revoke_push_tokens`, `notify_dedupe_key`)
-- closed part of it; re-measured 2026-10-04 at 0421, what is left is 1 item only on staging and 37
-- only on production, and this file is exactly those 38. All of it dates from the 0084–0094 era:
-- those files were edited after production had applied them, and their if-not-exists table creates
-- then skipped the edit there, so production kept the first shape of the duty/loads tables beside the
-- second. The rest was made out of band and has no record anywhere.
--
-- cross-module-waiver: a schema reconciliation is by definition every module whose tables drifted
-- (anomalies, driver-app, fuel, loads, mcleod, org); each statement restores one table to the shape
-- its own module's code already reads, and nothing here moves data or ownership between modules.
--
-- The rule for every item: whichever side the CODE was built against is the truth, except security
-- and integrity, where the stricter side wins. Every statement is idempotent, so this file corrects
-- production where production is wrong, corrects a migrations-built database (staging, the PGlite
-- matrices, a disaster-recovery restore) where IT is wrong, and is a no-op otherwise.
--
-- ── 1. SECURITY: six RESTRICTIVE driver denials existed ONLY on production — now in migrations ───
-- A restrictive policy narrows every permissive one, so on production a driver cannot read
-- anomalies, thresholds, memberships, TMS movements or another driver's fills, whatever else grants
-- it. A database rebuilt from migrations had none of them, so a driver there could. Predicates are
-- production's `pg_policies` verbatim (re-read 2026-10-04).
--
-- ── 2. SECURITY: three PERMISSIVE `load-photos` storage policies existed ONLY on production — dropped
-- `load_photos_read` / `_insert` / `_delete` are the bucket's first shape. 0085 replaced them with
-- `load_photos_manager_read` (five named office roles), `load_photos_driver_read` and
-- `load_photos_driver_write` (a driver's own `${org}/${driver}/` folder), which production ALSO has.
-- Permissive policies OR together, so the old three widened 0085's: any non-driver role in the org
-- could read and upload, and a dispatcher could delete a driver's proof of work through the browser.
-- Copying them into the migrations (the 2026-10-03 draft of this file did) would have widened every
-- rebuilt database the same way. Nothing needs them: the driver app uploads insert-only to the path
-- 0085's write policy checks (`stopCaptureModel.ts` stopPhotoPath, `handlers.ts` uploadStopPhoto),
-- and every other reader is the API on the service role. The bucket held 0 objects on 2026-10-04.
--
-- ── 3. INTEGRITY: `uq_duty_seg_current` (one open segment per duty session) — kept, now in migrations
-- Production-only, and the one production index no migration implies. `swap_duty_equipment` (0143)
-- closes every open segment of the session before inserting the next, and `start_duty_session`
-- inserts the first into a session that has none, so the code already honours it; the index makes a
-- future path that forgets fail loudly instead of leaving a session in two trucks at once.
--
-- ── 4. MISSING ON PRODUCTION: `idx_hazmat_runs_org_created` (0094). hazmat_runs holds 0 rows there.
--
-- ── 5. LEFTOVERS on production: dropped ───────────────────────────────────────────────────────────
-- * `duty_equipment_segments.driver_id` is NOT NULL with no default on production, and
--   `start_duty_session` never sets it, so **the first driver shift production ever starts would
--   fail**. The table has never held a row there. Dropped with its index.
-- * `driver_duty_sessions.start_lat/start_lon`, `load_events.actor_driver_id` — 0 non-null rows on
--   production (2026-10-04) and read by no code (the inventory module's `actor_driver_id` is
--   `asset_movements`' column). `load_stop_photos.created_at` — the migrations' column is
--   `uploaded_at`; the table is empty on production.
-- * Nineteen indexes duplicating, or implied by, the migrations' own. Exact duplicates:
--   `idx_duty_sessions_driver`, `idx_load_events_load`, `idx_load_events_org_kind`,
--   `idx_load_stop_photos_load`, and `idx_load_stops_load` + `uq_load_stops_seq` beside the unique
--   `idx_load_stops_load_seq (load_id, seq)` — which is the arbiter both `load_stops` upserts name
--   (`mirrorLoads.ts`, `tmsLoadIngestWriters.ts`), so they keep working. Implied by a stricter
--   unique: `uq_drivers_org_user` by `idx_drivers_user (user_id)`, `uq_duty_session_active` by
--   `idx_duty_sessions_one_open_per_driver (driver_id)`, `uq_duty_seg_vehicle_in_use` /
--   `uq_duty_seg_trailer_in_use` by `idx_duty_segments_one_driver_per_vehicle` /
--   `_one_holder_per_trailer`. `uq_loads_external` was wider than `idx_loads_provider_ext` — every
--   external id, not only `source = 'tms'` — and production holds no non-TMS load with an external id
--   (2026-10-04), so nothing it guarded is lost. The rest are covered by a migrations index on the
--   same leading columns; the tables hold ~300 loads and no duty rows.
-- * The stale overloads `resolve_driver_type(uuid, uuid)` and the ten-argument `start_duty_session`.
--   Every caller (0087, 0141, dutySessions.ts) uses the one-argument and eleven-argument forms.
--
-- ── DEPLOY WINDOW ─────────────────────────────────────────────────────────────────────────────────
-- Nothing dropped is read by the code that is live now, and nothing created is read by any code.
-- Either order of code and schema is safe (MIGRATION-DISCIPLINE.md).

-- ── 1. restrictive driver denials ─────────────────────────────────────────────────────────────────
drop policy if exists anomalies_driver_deny on public.anomalies;
create policy anomalies_driver_deny on public.anomalies as restrictive for select
  using (auth_role() <> 'driver');

drop policy if exists thresholds_driver_deny on public.anomaly_thresholds;
create policy thresholds_driver_deny on public.anomaly_thresholds as restrictive for select
  using (auth_role() <> 'driver');

drop policy if exists memberships_driver_deny on public.memberships;
create policy memberships_driver_deny on public.memberships as restrictive for select
  using (auth_role() <> 'driver');

drop policy if exists tms_movements_driver_deny on public.tms_movements;
create policy tms_movements_driver_deny on public.tms_movements as restrictive for select
  using (auth_role() <> 'driver');

drop policy if exists ftxn_driver_select on public.fuel_transactions;
create policy ftxn_driver_select on public.fuel_transactions as restrictive for select
  using ((auth_role() <> 'driver') or (driver_id = auth_driver_id()));

drop policy if exists ftxn_driver_insert on public.fuel_transactions;
create policy ftxn_driver_insert on public.fuel_transactions as restrictive for insert
  with check (
    (auth_role() <> 'driver')
    or (
      (driver_id = auth_driver_id())
      and (source = 'manual')
      and exists (
        select 1 from public.vehicles v
         where v.id = fuel_transactions.vehicle_id and v.assigned_driver_id = auth_driver_id()
      )
    )
  );

-- ── 2. the bucket's first-shape storage policies ──────────────────────────────────────────────────
drop policy if exists load_photos_read on storage.objects;
drop policy if exists load_photos_insert on storage.objects;
drop policy if exists load_photos_delete on storage.objects;

-- ── 3. one open segment per duty session ──────────────────────────────────────────────────────────
create unique index if not exists uq_duty_seg_current
  on public.duty_equipment_segments (session_id) where (to_at is null);

-- ── 4. missing on production ──────────────────────────────────────────────────────────────────────
create index if not exists idx_hazmat_runs_org_created on public.hazmat_runs (org_id, created_at desc);

-- ── 5. leftovers ──────────────────────────────────────────────────────────────────────────────────
drop index if exists public.idx_duty_seg_driver_time;
alter table public.duty_equipment_segments drop column if exists driver_id;
alter table public.driver_duty_sessions drop column if exists start_lat;
alter table public.driver_duty_sessions drop column if exists start_lon;
alter table public.load_events drop column if exists actor_driver_id;
alter table public.load_stop_photos drop column if exists created_at;

drop index if exists public.idx_duty_sessions_driver;
drop index if exists public.idx_duty_sessions_open;
drop index if exists public.uq_duty_session_active;
drop index if exists public.uq_drivers_org_user;
drop index if exists public.idx_duty_seg_session;
drop index if exists public.idx_duty_seg_trailer_time;
drop index if exists public.idx_duty_seg_vehicle_time;
drop index if exists public.uq_duty_seg_trailer_in_use;
drop index if exists public.uq_duty_seg_vehicle_in_use;
drop index if exists public.idx_load_events_load;
drop index if exists public.idx_load_events_org_kind;
drop index if exists public.idx_load_stop_photos_load;
drop index if exists public.idx_load_stop_photos_stop;
drop index if exists public.idx_load_stops_load;
-- Edited after staging applied this file (2026-10-04, owner-approved in PR review): production's first
-- push failed HERE with 2BP01, because on production uq_load_stops_seq is a UNIQUE CONSTRAINT, not
-- a bare index, and its index cannot be dropped on its own. The transaction rolled back, so
-- production stayed at 0421 untouched, and would have retried this file and failed on every push
-- after. The line below is a no-op wherever the constraint does not exist, which includes staging,
-- so every database that already applied 0422 is in the state this edit would have produced.
alter table public.load_stops drop constraint if exists uq_load_stops_seq;
drop index if exists public.uq_load_stops_seq;
drop index if exists public.idx_loads_driver;
drop index if exists public.idx_loads_pending;
drop index if exists public.idx_loads_status;
drop index if exists public.uq_loads_external;

drop function if exists public.resolve_driver_type(uuid, uuid);
drop function if exists public.start_duty_session(uuid, uuid, uuid, uuid, uuid, uuid, numeric, timestamptz, text, boolean);
