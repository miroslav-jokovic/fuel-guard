// Silvicom 360 — the reconciling migrations (0422, 0423) apply to a database shaped like PRODUCTION,
// not only to one built from migrations (RELEASE-TRAIN-PLAN Q-REL6).
//
// Every other matrix builds its database from the migrations, so every one of them ran 0422 against
// the shape it was written to leave alone, and all 120 passed. Production then refused it on its
// first push (2026-10-04, 2BP01): `uq_load_stops_seq` is a UNIQUE CONSTRAINT there, and its index
// cannot be dropped bare. A reconciling migration's whole job is the OTHER side's shape, so this
// matrix builds that side — migrations through 0421, then production's own extra objects as its
// catalog showed them on 2026-10-04 — and applies 0422 and EVERY migration after it, in order, so a
// later file that cannot apply to production's shape fails here too. 0423 added production's
// constraint shape to the fixture, after constraints were the next blind spot.
//
// Run:  node supabase/tests/schema-drift-production-shape.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();
const RECONCILE = "0422_production_schema_drift_reconciled.sql";

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text,
    name text, owner uuid, owner_id text, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS.filter((f) => f < RECONCILE)) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

// Production's own objects, as its catalog showed them on 2026-10-04 (definitions verbatim; the two
// stale overloads' bodies are stubs — only their signatures matter to a DROP).
await db.exec(`
  alter table public.duty_equipment_segments add column driver_id uuid not null
    references public.drivers(id) on delete cascade;
  alter table public.driver_duty_sessions add column start_lat numeric, add column start_lon numeric;
  alter table public.load_events add column actor_driver_id uuid references public.drivers(id) on delete set null;
  alter table public.load_stop_photos add column created_at timestamptz not null default now();

  alter table public.load_stops add constraint uq_load_stops_seq unique (load_id, seq);
  create index idx_duty_seg_driver_time on public.duty_equipment_segments (org_id, driver_id, from_at desc);
  create index idx_duty_sessions_driver on public.driver_duty_sessions (org_id, driver_id, started_at desc);
  create index idx_duty_sessions_open on public.driver_duty_sessions (org_id, started_at desc) where ended_at is null;
  create unique index uq_duty_session_active on public.driver_duty_sessions (org_id, driver_id) where ended_at is null;
  create unique index uq_drivers_org_user on public.drivers (org_id, user_id) where user_id is not null;
  create index idx_duty_seg_session on public.duty_equipment_segments (session_id, from_at);
  create index idx_duty_seg_trailer_time on public.duty_equipment_segments (org_id, trailer_id, from_at desc) where trailer_id is not null;
  create index idx_duty_seg_vehicle_time on public.duty_equipment_segments (org_id, vehicle_id, from_at desc);
  create unique index uq_duty_seg_current on public.duty_equipment_segments (session_id) where to_at is null;
  create unique index uq_duty_seg_trailer_in_use on public.duty_equipment_segments (org_id, trailer_id)
    where to_at is null and seat = 'driver' and trailer_id is not null;
  create unique index uq_duty_seg_vehicle_in_use on public.duty_equipment_segments (org_id, vehicle_id)
    where to_at is null and seat = 'driver';
  create index idx_load_events_load on public.load_events (load_id, occurred_at desc);
  create index idx_load_events_org_kind on public.load_events (org_id, kind, occurred_at desc);
  create index idx_load_stop_photos_load on public.load_stop_photos (org_id, load_id);
  create index idx_load_stop_photos_stop on public.load_stop_photos (stop_id, slot, uploaded_at desc);
  create index idx_load_stops_load on public.load_stops (load_id, seq);
  create index idx_loads_driver on public.loads (org_id, driver_id, status, created_at desc);
  create index idx_loads_pending on public.loads (org_id, status, created_at desc)
    where status = any (array['draft', 'pending_approval', 'approved']);
  create index idx_loads_status on public.loads (org_id, status);
  create unique index uq_loads_external on public.loads (org_id, provider, external_id) where external_id is not null;
  drop index if exists public.idx_hazmat_runs_org_created;

  create policy load_photos_read on storage.objects for select using (bucket_id = 'load-photos');
  create policy load_photos_insert on storage.objects for insert with check (bucket_id = 'load-photos');
  create policy load_photos_delete on storage.objects for delete using (bucket_id = 'load-photos');

  create function public.resolve_driver_type(uuid, uuid) returns text language sql as $f$ select null::text $f$;
  create function public.start_duty_session(uuid, uuid, uuid, uuid, uuid, uuid, numeric, timestamptz, text, boolean)
    returns uuid language sql as $f$ select null::uuid $f$;

  -- Constraints: production lacks seven of the migrations' checks, holds six under other names, and
  -- differs on two foreign keys, one range and one validation (0423's header has the list).
  alter table public.device_push_tokens drop constraint device_push_tokens_platform_check;
  alter table public.driver_duty_sessions
    drop constraint driver_duty_sessions_start_odometer_check,
    drop constraint driver_duty_sessions_end_odometer_check,
    drop constraint duty_end_reason_check, drop constraint duty_sessions_end_after_start,
    drop constraint duty_source_check, drop constraint duty_ended_needs_reason,
    add constraint duty_ended_needs_reason check (ended_at is null or ended_reason is not null),
    add constraint duty_sessions_end_paired_check check ((ended_at is null) = (ended_reason is null)),
    add constraint duty_sessions_end_reason_check
      check (ended_reason is null or ended_reason = any (array['driver', 'taken_over', 'auto_timeout', 'dispatch'])),
    add constraint duty_sessions_source_check check (source = any (array['driver_app', 'dispatch', 'telematics'])),
    add constraint duty_sessions_window_check check (ended_at is null or ended_at >= started_at);
  alter table public.duty_equipment_segments
    drop constraint duty_confirmed_by_check, drop constraint duty_equipment_segments_check,
    drop constraint duty_seat_check, drop constraint duty_equipment_segments_trailer_id_fkey,
    add constraint duty_equipment_segments_trailer_id_fkey foreign key (trailer_id) references public.trailers(id) on delete restrict,
    add constraint duty_seg_confirmed_by_check check (confirmed_by = any (array['driver', 'dispatch'])),
    add constraint duty_seg_seat_check check (seat = any (array['driver', 'co_driver'])),
    add constraint duty_seg_window_check check (to_at is null or to_at >= from_at);
  alter table public.invites drop constraint invites_driver_id_fkey,
    add constraint invites_driver_id_fkey foreign key (driver_id) references public.drivers(id) on delete set null;
  alter table public.load_stops drop constraint load_stops_check, drop constraint load_stops_lat_check,
    drop constraint load_stops_lon_check, drop constraint load_stops_seq_check;
  alter table public.organizations drop constraint organizations_duty_session_timeout_hours_check,
    add constraint organizations_duty_timeout_check check (duty_session_timeout_hours >= 1 and duty_session_timeout_hours <= 168);
`);

const LATER = MIGRATIONS.filter((f) => f >= RECONCILE);
let error = null;
for (const f of LATER) {
  try { await db.exec(read(join("migrations", f))); } catch (e) { error = `${f}: ${e.code ?? ""} ${e.message}`; break; }
}
ok(`0422 and every migration after it (${LATER.length}) apply to production's shape`, error === null, error ?? "");

const has = async (q) => (await one(q)).c > 0;
ok("…and production's UNIQUE constraint on load_stops is gone",
  !(await has(`select count(*)::int c from pg_constraint where conname = 'uq_load_stops_seq'`)));
ok("…while the migrations' own unique on (load_id, seq) — the upserts' arbiter — remains",
  await has(`select count(*)::int c from pg_indexes where indexname = 'idx_load_stops_load_seq'`));
ok("…the NOT NULL driver_id that would fail the first shift is gone",
  !(await has(`select count(*)::int c from information_schema.columns
                where table_name = 'duty_equipment_segments' and column_name = 'driver_id'`)));

// ── 0423: constraints ────────────────────────────────────────────────────────────────────────────
const defs = Object.fromEntries((await db.query(
  `select conname, pg_get_constraintdef(oid) d from pg_constraint
    where conrelid in ('public.driver_duty_sessions'::regclass, 'public.duty_equipment_segments'::regclass,
                       'public.invites'::regclass, 'public.organizations'::regclass, 'public.load_stops'::regclass,
                       'public.device_push_tokens'::regclass)`)).rows.map((r) => [r.conname, r.d]));
const PROD_NAMES = ["duty_sessions_end_reason_check", "duty_sessions_source_check", "duty_sessions_window_check",
  "duty_seg_confirmed_by_check", "duty_seg_seat_check", "duty_seg_window_check", "organizations_duty_timeout_check"];
ok("production's six renamed checks and its 1–168 timeout range are gone",
  PROD_NAMES.every((n) => !(n in defs)), JSON.stringify(PROD_NAMES.filter((n) => n in defs)));
const MIGR_NAMES = ["duty_end_reason_check", "duty_sessions_end_after_start", "duty_source_check", "duty_confirmed_by_check",
  "duty_equipment_segments_check", "duty_seat_check", "device_push_tokens_platform_check",
  "driver_duty_sessions_start_odometer_check", "driver_duty_sessions_end_odometer_check", "load_stops_check",
  "load_stops_lat_check", "load_stops_lon_check", "load_stops_seq_check", "duty_sessions_end_paired_check"];
ok("the migrations' names, the seven missing checks and the stricter pairing rule all exist",
  MIGR_NAMES.every((n) => n in defs), JSON.stringify(MIGR_NAMES.filter((n) => !(n in defs))));
ok("the duty timeout is 4–48 hours", />= 4\).*<= 48/.test(defs.organizations_duty_session_timeout_hours_check ?? ""),
  defs.organizations_duty_session_timeout_hours_check);
ok("a segment's trailer is RESTRICT, so deleting a trailer cannot erase who held it",
  /ON DELETE RESTRICT/.test(defs.duty_equipment_segments_trailer_id_fkey ?? ""), defs.duty_equipment_segments_trailer_id_fkey);
ok("an invite's driver is SET NULL, so merge_driver cannot delete invitations",
  /ON DELETE SET NULL/.test(defs.invites_driver_id_fkey ?? ""), defs.invites_driver_id_fkey);
ok("duty_ended_needs_reason is validated",
  (await one(`select convalidated v from pg_constraint where conname = 'duty_ended_needs_reason'`)).v === true);

let again = null;
for (const f of LATER.filter((f) => f <= "0423_production_constraint_drift_reconciled.sql")) {
  try { await db.exec(read(join("migrations", f))); } catch (e) { again = `${f}: ${e.code ?? ""} ${e.message}`; break; }
}
ok("…and applying 0422 and 0423 twice is a no-op, as reconciling files must be", again === null, again ?? "");

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
