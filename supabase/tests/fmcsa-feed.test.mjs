// FuelGuard — FMCSA's public record of our roadside inspections, versioned as served (migration 0457,
// INSPECTION-CHALLENGE-PLAN.md IC1, D-IC2).
//
// Properties that would each fail quietly, because the feed's next run would simply carry on:
//
//   0. ONE VOCABULARY. Both tables' `dataset` CHECK equals FMCSA_DATASETS, read back from the APPLIED catalog.
//   1. A SNAPSHOT VERSIONS ONLY WHAT CHANGED. First sight is version 1; a replay writes a run and no rows;
//      a changed payload is a new version; a key missing from a COMPLETE snapshot gets a payload-less
//      `vanished` version; a key that returns after vanishing is `reappeared`. Key order inside a payload
//      changes nothing (jsonb normalises it).
//   2. ONLY A COMPLETE SNAPSHOT VANISHES. An incomplete one never does.
//   3. AN EMPTY ANSWER CANNOT ERASE OUR RECORD. An empty complete snapshot over present rows is refused
//      (FM001) and leaves nothing behind, not even its run row; over a dataset with none, it is a run.
//   4. MALFORMED INPUT IS REFUSED. A repeated key (FM003), a row without a key or an object payload (FM002).
//   5. APPEND-ONLY, FOR THE SERVICE ROLE TOO (FM010). A run says why it failed iff it failed.
//   6. ONE ORG. Another carrier's versions are never compared with ours; a version cannot name another
//      carrier's run (composite FK); RLS on, no policy; the function closed to browser sessions.
//
// Run:  node supabase/tests/fmcsa-feed.test.mjs   (after `pnpm --filter @silvicom/shared build:rn`)
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FMCSA_DATASETS } from "../../packages/shared/dist/index.js";

const SUPA = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
/** The SQLSTATE a statement raised, or null when it succeeded. */
const sqlstate = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
};

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
// Supabase's real default privileges, installed BEFORE the migrations — full DML granted, RLS is the
// gate. Without this a client "cannot read" for the wrong reason and the lockout below proves nothing.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
ok("0457 present", MIGRATIONS.some((f) => f.startsWith("0457_fmcsa_feed_raw")));
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// ── 0. one vocabulary ─────────────────────────────────────────────────────────────────────────────
for (const t of ["fmcsa_fetch_runs", "fmcsa_raw_rows"]) {
  const c = await one(
    `select pg_get_constraintdef(oid) as d from pg_constraint
      where conrelid = $1::regclass and conname = $2`, [`public.${t}`, `${t}_dataset_check`]);
  const lits = c ? [...c.d.matchAll(/'([^']*)'::text/g)].map((m) => m[1]) : null;
  ok(`${t}.dataset's CHECK equals FMCSA_DATASETS`, FMCSA_DATASETS.length === 6
    && JSON.stringify(lits) === JSON.stringify([...FMCSA_DATASETS]), `${JSON.stringify(lits)}`);
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────
const ORG = (await one(`insert into organizations (name) values ('Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (name) values ('Other') returning id`)).id;
const USER = (await one(`insert into auth.users (email) values ('safety@x.test') returning id`)).id;
const DS = "fx4q-ay7w";
const rec = (org, rows, { complete = true, dataset = DS } = {}) =>
  one(`select * from fmcsa_snapshot_record($1, $2, '1864495', $3::jsonb, $4::jsonb)`,
    [org, dataset, JSON.stringify(rows.map(([k, p]) => ({ k, p }))),
      JSON.stringify({ started_at: "2026-10-11T12:00:00Z", complete, request_count: 2, duration_ms: 10 })]);
const versions = async (org, key, dataset = DS) =>
  (await db.query(`select version, kind, payload, sha256 from fmcsa_raw_rows
     where org_id = $1 and dataset = $2 and natural_key = $3 order by version`, [org, dataset, key])).rows;
const count = async (t, org) => (await one(`select count(*)::int as n from ${t} where org_id = $1`, [org])).n;
const A = { inspection_id: "1", change_date: "20261001 1200", oos_total: "0" };
const B = { inspection_id: "2", change_date: "20261002 1200", oos_total: "1" };
const C = { inspection_id: "3", change_date: "20261003 1200", oos_total: "0" };

// ── 1. versions only what changed ─────────────────────────────────────────────────────────────────
let r = await rec(ORG, [["1", A], ["2", B]]);
ok("a first snapshot sees 2 rows, both new", r.rows_seen === 2 && r.rows_new === 2 && r.rows_changed === 0 && r.rows_vanished === 0, JSON.stringify(r));
ok("each is version 1, present, with a 64-hex hash of its payload",
  (await versions(ORG, "1")).length === 1 && (await versions(ORG, "1"))[0].kind === "present" && /^[0-9a-f]{64}$/.test((await versions(ORG, "1"))[0].sha256));
const run1 = await one(`select * from fmcsa_fetch_runs where id = $1`, [r.run_id]);
ok("the run row records outcome, completeness, counts and the greatest change_date",
  run1.outcome === "succeeded" && run1.complete === true && run1.rows_new === 2 && run1.request_count === 2 && run1.max_change_date === "20261002 1200" && run1.dot_number === "1864495",
  JSON.stringify(run1));

r = await rec(ORG, [["2", { oos_total: "1", change_date: "20261002 1200", inspection_id: "2" }], ["1", A]]);
ok("a replay — same rows, other order, keys reordered inside a payload — is a run with no changes",
  r.rows_seen === 2 && r.rows_new + r.rows_changed + r.rows_reappeared + r.rows_vanished === 0, JSON.stringify(r));
ok("...and writes no version", (await count("fmcsa_raw_rows", ORG)) === 2 && (await count("fmcsa_fetch_runs", ORG)) === 2);

r = await rec(ORG, [["1", { ...A, oos_total: "2", change_date: "20261009 0900" }], ["3", C]]);
ok("change one, drop one, add one: 1 changed, 1 vanished, 1 new", r.rows_changed === 1 && r.rows_vanished === 1 && r.rows_new === 1, JSON.stringify(r));
const v1 = await versions(ORG, "1");
ok("the changed record has version 2 with the new payload, and version 1 is untouched",
  v1.length === 2 && v1[0].payload.oos_total === "0" && v1[1].payload.oos_total === "2" && v1[1].kind === "present");
const v2 = await versions(ORG, "2");
ok("the dropped record has a version 2 that is vanished, with no payload or hash",
  v2.length === 2 && v2[1].kind === "vanished" && v2[1].payload === null && v2[1].sha256 === null);

r = await rec(ORG, [["1", { ...A, oos_total: "2", change_date: "20261009 0900" }], ["2", B], ["3", C]]);
ok("a vanished record that returns is counted reappeared, not new", r.rows_reappeared === 1 && r.rows_new === 0 && r.rows_changed === 0, JSON.stringify(r));
ok("...as version 3, present again", (await versions(ORG, "2")).map((v) => v.kind).join() === "present,vanished,present");

// ── 2. only a complete snapshot vanishes ──────────────────────────────────────────────────────────
r = await rec(ORG, [["3", C]], { complete: false });
ok("an incomplete snapshot missing two records vanishes neither", r.rows_vanished === 0 && (await versions(ORG, "1")).length === 2, JSON.stringify(r));
ok("...and its run says it was incomplete", (await one(`select complete from fmcsa_fetch_runs where id = $1`, [r.run_id])).complete === false);

// ── 3. an empty answer cannot erase our record ────────────────────────────────────────────────────
const runsBefore = await count("fmcsa_fetch_runs", ORG), rowsBefore = await count("fmcsa_raw_rows", ORG);
ok("an empty complete snapshot over present rows is refused (FM001)", (await sqlstate(
  `select * from fmcsa_snapshot_record($1, $2, '1864495', '[]'::jsonb, '{"started_at":"2026-10-11T12:00:00Z","complete":true}'::jsonb)`, [ORG, DS])) === "FM001");
ok("...and leaves no run row and no version behind",
  (await count("fmcsa_fetch_runs", ORG)) === runsBefore && (await count("fmcsa_raw_rows", ORG)) === rowsBefore);
r = await rec(ORG, [], { dataset: "qbt8-7vic" });
ok("an empty complete snapshot of a dataset with nothing present is an ordinary run", r.rows_seen === 0 && r.rows_vanished === 0, JSON.stringify(r));

// ── 4. malformed input is refused ─────────────────────────────────────────────────────────────────
ok("a snapshot naming a key twice is refused (FM003)", (await sqlstate(
  `select * from fmcsa_snapshot_record($1, $2, '1', $3::jsonb, '{"started_at":"2026-10-11T12:00:00Z","complete":true}'::jsonb)`,
  [ORG, DS, JSON.stringify([{ k: "9", p: A }, { k: "9", p: B }])])) === "FM003");
ok("a row with no key is refused (FM002)", (await sqlstate(
  `select * from fmcsa_snapshot_record($1, $2, '1', $3::jsonb, '{"started_at":"2026-10-11T12:00:00Z","complete":true}'::jsonb)`,
  [ORG, DS, JSON.stringify([{ p: A }])])) === "FM002");
ok("a row whose payload is not an object is refused (FM002)", (await sqlstate(
  `select * from fmcsa_snapshot_record($1, $2, '1', $3::jsonb, '{"started_at":"2026-10-11T12:00:00Z","complete":true}'::jsonb)`,
  [ORG, DS, JSON.stringify([{ k: "9", p: "x" }])])) === "FM002");
ok("a dataset outside the six is refused by the CHECK (23514)", (await sqlstate(
  `select * from fmcsa_snapshot_record($1, 'abcd-efgh', '1', '[]'::jsonb, '{"started_at":"2026-10-11T12:00:00Z","complete":true}'::jsonb)`, [ORG])) === "23514");

// ── 5. append-only, and a failure says why ────────────────────────────────────────────────────────
ok("UPDATE of a version is refused, service role included (FM010)", (await sqlstate(`update fmcsa_raw_rows set kind = 'vanished' where org_id = $1`, [ORG])) === "FM010");
ok("DELETE of a version is refused (FM010)", (await sqlstate(`delete from fmcsa_raw_rows where org_id = $1`, [ORG])) === "FM010");
ok("UPDATE of a run is refused (FM010)", (await sqlstate(`update fmcsa_fetch_runs set rows_new = 0 where org_id = $1`, [ORG])) === "FM010");
ok("DELETE of a run is refused (FM010)", (await sqlstate(`delete from fmcsa_fetch_runs where org_id = $1`, [ORG])) === "FM010");
const failed = (outcome, error) => sqlstate(
  `insert into fmcsa_fetch_runs (org_id, dataset, dot_number, started_at, outcome, complete, error) values ($1, $2, '1', now(), $3, false, $4)`,
  [ORG, DS, outcome, error]);
ok("a failed run with its reason is accepted", (await failed("failed", "HTTP 503")) === null);
ok("a failed run without a reason is refused (23514)", (await failed("failed", null)) === "23514");
ok("a succeeded run carrying an error is refused (23514)", (await failed("succeeded", "x")) === "23514");

// ── 6. one org ────────────────────────────────────────────────────────────────────────────────────
r = await rec(OTHER, [["1", A], ["2", B]]);
ok("another carrier's snapshot of the same keys is new to it — ours are not compared", r.rows_new === 2 && r.rows_vanished === 0, JSON.stringify(r));
ok("...and ours are unchanged by it", (await versions(ORG, "1")).length === 2 && (await versions(OTHER, "1")).length === 1);
const otherRun = (await one(`select id from fmcsa_fetch_runs where org_id = $1 limit 1`, [OTHER])).id;
ok("a version naming another carrier's run is refused by the composite FK (23503)", (await sqlstate(
  `insert into fmcsa_raw_rows (org_id, fetch_run_id, dataset, natural_key, version, kind, payload, sha256)
   values ($1, $2, $3, 'x', 1, 'present', '{}', repeat('a', 64))`, [ORG, otherRun, DS])) === "23503");

async function asClient(org, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: USER, org_id: org, user_role: "admin", role: "authenticated" }),
    ]);
    const res = await db.query(sql, params);
    return { rows: res.rows, error: null };
  } catch (e) {
    return { rows: [], error: e.code ?? String(e.message) };
  } finally {
    await db.exec("rollback");
  }
}
for (const t of ["fmcsa_fetch_runs", "fmcsa_raw_rows"]) {
  const q = await asClient(ORG, `select count(*)::int as n from ${t}`);
  ok(`an admin's browser session reads nothing from ${t} (no client policy)`, q.error === null && q.rows[0].n === 0, JSON.stringify(q));
}
const FN = "public.fmcsa_snapshot_record(uuid, text, text, jsonb, jsonb)";
const grants = await one(
  `select has_function_privilege('authenticated', $1, 'execute') as authed, has_function_privilege('anon', $1, 'execute') as anon`, [FN]);
ok("neither a signed-in nor an anonymous browser session may execute fmcsa_snapshot_record",
  grants.authed === false && grants.anon === false, JSON.stringify(grants));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
