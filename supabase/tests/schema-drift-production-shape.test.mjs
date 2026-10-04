// Silvicom 360 — 0422 applies to a database shaped like PRODUCTION, not only to one built from
// migrations (RELEASE-TRAIN-PLAN Q-REL6).
//
// Every other matrix builds its database from the migrations, so every one of them ran 0422 against
// the shape it was written to leave alone, and all 120 passed. Production then refused it on its
// first push (2026-10-04, 2BP01): `uq_load_stops_seq` is a UNIQUE CONSTRAINT there, and its index
// cannot be dropped bare. A reconciling migration's whole job is the OTHER side's shape, so this
// matrix builds that side — migrations through 0421, then production's own extra objects as its
// catalog showed them on 2026-10-04 — and applies 0422 to it.
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
`);

let error = null;
try { await db.exec(read(join("migrations", RECONCILE))); } catch (e) { error = `${e.code ?? ""} ${e.message}`; }
ok("0422 applies to production's shape", error === null, error ?? "");

const has = async (q) => (await one(q)).c > 0;
ok("…and production's UNIQUE constraint on load_stops is gone",
  !(await has(`select count(*)::int c from pg_constraint where conname = 'uq_load_stops_seq'`)));
ok("…while the migrations' own unique on (load_id, seq) — the upserts' arbiter — remains",
  await has(`select count(*)::int c from pg_indexes where indexname = 'idx_load_stops_load_seq'`));
ok("…the NOT NULL driver_id that would fail the first shift is gone",
  !(await has(`select count(*)::int c from information_schema.columns
                where table_name = 'duty_equipment_segments' and column_name = 'driver_id'`)));
ok("…and applying it twice is a no-op, as a reconciling file must be",
  await db.exec(read(join("migrations", RECONCILE))).then(() => true, () => false));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
