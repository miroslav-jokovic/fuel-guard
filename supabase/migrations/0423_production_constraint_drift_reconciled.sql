-- 0423: production's constraints and the migrations' agree (RELEASE-TRAIN-PLAN Q-REL6, after 0422)
--
-- 0422's fingerprint compared indexes, not constraints, and production's first push of it failed on
-- exactly that blind spot (a UNIQUE constraint where staging had a bare index). Adding constraints
-- to the fingerprint (`scripts/schema-drift.mjs`) on 2026-10-04 found 31 more differences, all on
-- the same 0084–0102-era tables 0422 reconciled and for the same reason: those files were edited
-- after production applied them. 0422's column drops took two of them (the `driver_id` and
-- `actor_driver_id` foreign keys) and its fix took a third (`uq_load_stops_seq`). This file is the
-- rest. Same rule as 0422: whichever side the code was built against, except where integrity is
-- at stake, where the stricter side wins.
--
-- cross-module-waiver: a schema reconciliation is by definition every module whose tables drifted
-- (driver-app, loads, org, messaging); each statement restores one table's constraint to the shape
-- its own module's code already assumes, and nothing here moves data or ownership between modules.
--
-- ── 1. SAME RULE, TWO NAMES ───────────────────────────────────────────────────────────────────────
-- Six checks are identical on both sides under different names. The migrations' names win: they are
-- what the files, the matrices and `schema.generated.sql` say. Production's copy is dropped and the
-- migrations' name (re)created, so the pair is idempotent on either side.
--
-- ── 2. ON PRODUCTION'S SIDE ONLY: missing checks, added ───────────────────────────────────────────
-- Seven checks the migrations declare and production never got: push-token platform, start/end
-- odometer >= 0, load-stop lat/lon range, stop sequence 1–50, appointment end >= start. Measured on
-- production 2026-10-04: zero rows violate any of them, so each is added VALID.
--
-- ── 3. DIFFERENT RULES: one side chosen ───────────────────────────────────────────────────────────
-- * `duty_ended_needs_reason` is NOT VALID in the migrations and valid on production. Recreated
--   valid: both tables are empty on both sides.
-- * `duty_sessions_end_paired_check` ((ended_at is null) = (ended_reason is null)) exists only on
--   production, and is stricter than `duty_ended_needs_reason` — it also refuses a reason on an
--   open shift. Kept, and added to the migrations: every writer of `ended_at` (0086 end/takeover/
--   sweeper, 0143, 0151) sets `ended_reason` in the same statement.
-- * `duty_equipment_segments.trailer_id`: migrations `on delete set null`, production `restrict`.
--   RESTRICT wins: a segment is the record of who held which trailer when, and SET NULL would
--   erase that from history the moment a trailer row was deleted. RESTRICT is already the house
--   rule for every trailer reference that carries history (0092 hazmat, 0331–0333 inventory). No
--   code deletes a trailer, and nothing deletes an organization, so no cascade can trip it.
-- * `invites.driver_id`: migrations `on delete cascade` (0102), production `set null`. SET NULL
--   wins: `merge_driver` (0264) ends in `delete from public.drivers` and does not reassign invites,
--   so under CASCADE folding a duplicate driver silently destroyed their invitations — the exact
--   trap 0203 and 0234 closed for sixteen other tables. Production holds no invite with a
--   driver_id (2026-10-04), so nothing changes there today.
-- * `organizations.duty_session_timeout_hours`: migrations 4–48, production 1–168. 4–48 wins: it is
--   the range 0086 documents (a legal split-sleep day plus margin) and that `dutySessionSweeper.ts`
--   assumes; a 1-hour timeout would end a real shift mid-route. Every org holds 16.
--
-- ── DEPLOY WINDOW ─────────────────────────────────────────────────────────────────────────────────
-- No code reads a constraint name, and every row on both sides already satisfies every rule added.
-- Either order of code and schema is safe (MIGRATION-DISCIPLINE.md).

-- ── 1. same rule, two names ───────────────────────────────────────────────────────────────────────
alter table public.driver_duty_sessions drop constraint if exists duty_sessions_end_reason_check;
alter table public.driver_duty_sessions drop constraint if exists duty_end_reason_check;
alter table public.driver_duty_sessions add constraint duty_end_reason_check
  check (ended_reason is null or ended_reason = any (array['driver', 'taken_over', 'auto_timeout', 'dispatch']));

alter table public.driver_duty_sessions drop constraint if exists duty_sessions_window_check;
alter table public.driver_duty_sessions drop constraint if exists duty_sessions_end_after_start;
alter table public.driver_duty_sessions add constraint duty_sessions_end_after_start
  check (ended_at is null or ended_at >= started_at);

alter table public.driver_duty_sessions drop constraint if exists duty_sessions_source_check;
alter table public.driver_duty_sessions drop constraint if exists duty_source_check;
alter table public.driver_duty_sessions add constraint duty_source_check
  check (source = any (array['driver_app', 'dispatch', 'telematics']));

alter table public.duty_equipment_segments drop constraint if exists duty_seg_confirmed_by_check;
alter table public.duty_equipment_segments drop constraint if exists duty_confirmed_by_check;
alter table public.duty_equipment_segments add constraint duty_confirmed_by_check
  check (confirmed_by = any (array['driver', 'dispatch']));

alter table public.duty_equipment_segments drop constraint if exists duty_seg_window_check;
alter table public.duty_equipment_segments drop constraint if exists duty_equipment_segments_check;
alter table public.duty_equipment_segments add constraint duty_equipment_segments_check
  check (to_at is null or to_at >= from_at);

alter table public.duty_equipment_segments drop constraint if exists duty_seg_seat_check;
alter table public.duty_equipment_segments drop constraint if exists duty_seat_check;
alter table public.duty_equipment_segments add constraint duty_seat_check
  check (seat = any (array['driver', 'co_driver']));

-- ── 2. checks production never got ────────────────────────────────────────────────────────────────
alter table public.device_push_tokens drop constraint if exists device_push_tokens_platform_check;
alter table public.device_push_tokens add constraint device_push_tokens_platform_check
  check (platform = any (array['ios', 'android', 'unknown']));

alter table public.driver_duty_sessions drop constraint if exists driver_duty_sessions_start_odometer_check;
alter table public.driver_duty_sessions add constraint driver_duty_sessions_start_odometer_check
  check (start_odometer is null or start_odometer >= 0);
alter table public.driver_duty_sessions drop constraint if exists driver_duty_sessions_end_odometer_check;
alter table public.driver_duty_sessions add constraint driver_duty_sessions_end_odometer_check
  check (end_odometer is null or end_odometer >= 0);

alter table public.load_stops drop constraint if exists load_stops_check;
alter table public.load_stops add constraint load_stops_check
  check (appointment_end is null or appointment_start is null or appointment_end >= appointment_start);
alter table public.load_stops drop constraint if exists load_stops_lat_check;
alter table public.load_stops add constraint load_stops_lat_check check (lat is null or (lat >= -90 and lat <= 90));
alter table public.load_stops drop constraint if exists load_stops_lon_check;
alter table public.load_stops add constraint load_stops_lon_check check (lon is null or (lon >= -180 and lon <= 180));
alter table public.load_stops drop constraint if exists load_stops_seq_check;
alter table public.load_stops add constraint load_stops_seq_check check (seq >= 1 and seq <= 50);

-- ── 3. different rules ────────────────────────────────────────────────────────────────────────────
alter table public.driver_duty_sessions drop constraint if exists duty_ended_needs_reason;
alter table public.driver_duty_sessions add constraint duty_ended_needs_reason
  check (ended_at is null or ended_reason is not null);

alter table public.driver_duty_sessions drop constraint if exists duty_sessions_end_paired_check;
alter table public.driver_duty_sessions add constraint duty_sessions_end_paired_check
  check ((ended_at is null) = (ended_reason is null));

alter table public.duty_equipment_segments drop constraint if exists duty_equipment_segments_trailer_id_fkey;
alter table public.duty_equipment_segments add constraint duty_equipment_segments_trailer_id_fkey
  foreign key (trailer_id) references public.trailers(id) on delete restrict;

alter table public.invites drop constraint if exists invites_driver_id_fkey;
alter table public.invites add constraint invites_driver_id_fkey
  foreign key (driver_id) references public.drivers(id) on delete set null;

alter table public.organizations drop constraint if exists organizations_duty_timeout_check;
alter table public.organizations drop constraint if exists organizations_duty_session_timeout_hours_check;
alter table public.organizations add constraint organizations_duty_session_timeout_hours_check
  check (duty_session_timeout_hours >= 4 and duty_session_timeout_hours <= 48);
