// Silvicom 360 — toll plazas and observations (migration 0636; TOLLS-PER-TRUCK-PLAN.md TL8a, D-TL14, D-TL21).
//
// 1. A plaza attempt is placed (position, zone, clock) or not placed (a sentence), never half of each.
// 2. An observation is at a placed plaza of its line's org, provider and role (TG103, TG104); once per
//    line, role and plaza; "observed" carries its window, a clock outcome carries nothing.
// 3. Plaza attempts and observations are never changed (TG102) or deleted (TG101), except with the org.
// 4. RLS on with no client policy.

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
/** Run a statement and report the SQLSTATE it raised, or null when it succeeded. */
const refuses = async (q, p = []) => {
  try {
    await db.query(q, p);
    return null;
  } catch (e) {
    return e.code ?? "unknown";
  }
};

// Supabase-managed schemas, shimmed identically to unit-tags.test.mjs.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false, file_size_limit bigint,
    allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text)
  returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));


const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Fleet') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Rival') returning id`)).id;
const USER = "11111111-1111-4111-8111-111111111111";
let shaSeq = 0;
/** A read statement of `provider` with one toll line; returns the line id. */
const tollLine = async (org, provider = "ezpass") => {
  const stmt = (await one(
    `insert into toll_statements (id, org_id, provider, file_name, format, byte_size, sha256, storage_path, uploaded_by)
     values (gen_random_uuid(), $1::uuid, $3, 'June.pdf', 'pdf', 1000, $2, $1::text || '/' || gen_random_uuid(), $4::uuid) returning id`,
    [org, (++shaSeq).toString(16).padStart(64, "0"), provider, USER],
  )).id;
  const read = { outcome: "read", reader: "r@1", account: "1", period_start: "2026-06-01", period_end: "2026-06-30", printed_charges_cents: 845, ties: [] };
  const line = { line_index: 0, kind: "toll", tag_number: "09990000001", agency: "ILTOLL", exit_plaza: "17", exit_at: "2026-06-28T14:24:00", amount_cents: 845, page: 1, match_key: "k|0" };
  await db.query(`select record_toll_statement_read($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::jsonb)`, [org, stmt, USER, JSON.stringify(read), JSON.stringify([line])]);
  return (await one(`select id from toll_statement_lines where statement_id = $1`, [stmt])).id;
};
const PLACED = { outcome: "placed", lat: 41.59, lon: -87.68, spread_m: 18, time_zone: "America/Chicago", offset_s: 12, offset_spread_s: 49, sample_count: 7, day_count: 7 };
const plaza = (org, over = {}) =>
  refuses(
    `insert into toll_plazas (org_id, provider, role, plaza_key, engine_version, outcome, reason, lat, lon, spread_m, time_zone, offset_s, offset_spread_s, sample_count, day_count, known_count, samples, readings)
     select $1::uuid, coalesce(p->>'provider','ezpass'), coalesce(p->>'role','exit'), 'ezpass|exit|ILTOLL|41|', 1, p->>'outcome', p->>'reason', (p->>'lat')::float8, (p->>'lon')::float8,
            (p->>'spread_m')::int, p->>'time_zone', (p->>'offset_s')::int, (p->>'offset_spread_s')::int, (p->>'sample_count')::int, (p->>'day_count')::int, 12, '[]', '[]'
       from (select $2::jsonb as p) x`,
    [org, JSON.stringify({ ...PLACED, ...over })],
  );
const newest = async (org) => (await one(`select id from toll_plazas where org_id = $1 order by created_at desc, id limit 1`, [org])).id;
const observe = (org, line, plazaId, over = {}) =>
  refuses(
    `insert into toll_line_observations (org_id, line_id, role, plaza_id, outcome, at, half_window_s, nearby, reporting)
     select $1::uuid, $2::uuid, coalesce(o->>'role','exit'), $3::uuid, coalesce(o->>'outcome','observed'), (o->>'at')::timestamptz, (o->>'half_window_s')::int,
            coalesce(o->'nearby','[]'::jsonb), coalesce((select array_agg(x::bigint) from jsonb_array_elements_text(o->'reporting') x), '{}')
       from (select $4::jsonb as o) y`,
    [org, line, plazaId, JSON.stringify({ at: "2026-06-28T19:24:12Z", half_window_s: 90, nearby: [{ samsaraId: "281474977077541", kind: "vehicle", distanceM: 4, offsetS: 12 }], reporting: ["281474977077541", "281474977077542"], ...over })],
  );

// ── 1: a plaza attempt is one thing or the other ──────────────────────────────────────────────
ok("a placed plaza is kept with its place, zone and clock", (await plaza(ORG)) === null);
const P = await newest(ORG);
ok("a plaza not placed is kept with its sentence", (await plaza(ORG, { outcome: "not_placed", reason: "2 of 6 known tolls meet", lat: null, lon: null, spread_m: null, time_zone: null, offset_s: null, offset_spread_s: null })) === null);
const NP = await newest(ORG);
ok("a plaza not placed must say why", (await plaza(ORG, { outcome: "not_placed", reason: null, lat: null, lon: null, spread_m: null, time_zone: null, offset_s: null, offset_spread_s: null })) === "23514");
ok("a plaza not placed carries no position", (await plaza(ORG, { outcome: "not_placed", reason: "x", time_zone: null, offset_s: null, offset_spread_s: null, spread_m: null })) === "23514");
ok("a placed plaza needs its zone", (await plaza(ORG, { time_zone: null })) === "23514");
ok("a placed plaza needs its clock", (await plaza(ORG, { offset_s: null })) === "23514");
ok("a latitude off the globe is refused", (await plaza(ORG, { lat: 91 })) === "23514");
ok("a provider outside the three is refused", (await plaza(ORG, { provider: "prepass" })) === "23514");

// ── 2: an observation belongs ─────────────────────────────────────────────────────────────────
const LINE = await tollLine(ORG);
ok("an observation at a placed plaza is kept", (await observe(ORG, LINE, P)) === null);
{
  const o = await one(`select reporting::text, nearby->0->>'distanceM' as d from toll_line_observations where line_id = $1`, [LINE]);
  ok("…with the reporting ids as numbers and what was near", o.reporting === "{281474977077541,281474977077542}" && o.d === "4", JSON.stringify(o));
}
ok("a line is observed once at a plaza and role", (await observe(ORG, LINE, P)) === "23505");
ok("an observation at a plaza that was not placed is refused (TG104)", (await observe(ORG, LINE, NP)) === "TG104");
ok("an observation in the wrong role is refused (TG104)", (await observe(ORG, LINE, P, { role: "entry" })) === "TG104");
{
  const ktag = await tollLine(ORG, "ktag");
  ok("an observation at another provider's plaza is refused (TG104)", (await observe(ORG, ktag, P)) === "TG104");
}
{
  const theirs = await tollLine(OTHER);
  ok("another org's line is refused (TG103)", (await observe(ORG, theirs, P)) === "TG103");
  ok("…and so is filing it under their org against our plaza (TG103)", (await observe(OTHER, theirs, P)) === "TG103");
}
ok("an observed window must say when", (await observe(ORG, await tollLine(ORG), P, { at: null })) === "23514");
ok("a window wider than ten minutes is refused", (await observe(ORG, await tollLine(ORG), P, { half_window_s: 601 })) === "23514");
ok("a time in the repeated hour is kept as such, with nothing fetched", (await observe(ORG, await tollLine(ORG), P, { outcome: "clock_ambiguous", at: null, half_window_s: null, nearby: [], reporting: [] })) === null);
ok("…and a clock outcome cannot carry what was near", (await observe(ORG, await tollLine(ORG), P, { outcome: "clock_skipped", at: null, half_window_s: null })) === "23514");

// ── 3: never changed, never deleted ───────────────────────────────────────────────────────────
ok("a plaza attempt is never changed (TG102)", (await refuses(`update toll_plazas set lat = 1 where id = $1`, [P])) === "TG102");
ok("a plaza attempt is never deleted (TG101)", (await refuses(`delete from toll_plazas where id = $1`, [NP])) === "TG101");
ok("an observation is never changed (TG102)", (await refuses(`update toll_line_observations set nearby = '[]' where line_id = $1`, [LINE])) === "TG102");
ok("an observation is never deleted (TG101)", (await refuses(`delete from toll_line_observations where line_id = $1`, [LINE])) === "TG101");
{
  await plaza(OTHER);
  const theirPlaza = await newest(OTHER);
  await observe(OTHER, await tollLine(OTHER), theirPlaza);
  ok("an organisation that goes takes its plazas and observations", (await refuses(`delete from organizations where id = $1`, [OTHER])) === null);
  ok("…and none is left", Number((await one(`select count(*)::int as n from toll_plazas where org_id = $1`, [OTHER])).n) === 0);
}

// ── 4: closed to clients ──────────────────────────────────────────────────────────────────────
for (const t of ["toll_plazas", "toll_line_observations"]) {
  const rls = await one(`select relrowsecurity as on, (select count(*)::int from pg_policies where tablename = $1) as policies from pg_class where relname = $1`, [t]);
  ok(`${t}: RLS is on with no client policy`, rls.on === true && rls.policies === 0);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
