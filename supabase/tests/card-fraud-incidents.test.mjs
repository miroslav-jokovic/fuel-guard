// FuelGuard — migration 0410, card fraud incidents (CF2, docs/plans/fuel/CARD-FRAUD-ALERTS-PLAN.md).
//
// What must hold:
//   1. Opening an incident stores it at version 1 and maps the attempt, with the step it took.
//   2. Recording the same attempt again is refused — a re-score never takes a second step.
//   3. Extending at the version read succeeds; at a stale version it is refused (two workers, one card).
//   4. Opening with a key already taken is refused.
//   5. A closed incident refuses every extension; closing needs an outcome.
//   6. Another org's id cannot extend this org's incident.
//   7. The writer is the service role's alone.
//
// Run: node supabase/tests/card-fraud-incidents.test.mjs

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const ALL = readdirSync(join(SUPA, "migrations"))
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

// Supabase-managed schemas, shimmed identically to rls.test.mjs.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key,
    name text,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner uuid,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (
    version text primary key,
    name text,
    statements text[]
  );
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);

for (const f of ALL) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}


const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const TRUCK = (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1, '729', 200) returning id`, [ORG])).id;
const CARD = "7083050030727564";
const KEY = `${CARD}@d04`;
const ids = { d04: "00000000-0000-0000-0000-000000000004", d05: "00000000-0000-0000-0000-000000000005", d06: "00000000-0000-0000-0000-000000000006" };

const record = (o) =>
  db.query(
    `select * from card_fraud_record($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14)`,
    [o.org ?? ORG, o.key ?? KEY, o.version ?? null, CARD, TRUCK, "2026-09-22T19:24:00Z", o.last ?? "2026-09-22T19:24:00Z",
     o.count ?? 1, o.fuel ?? false, JSON.stringify({ steps: o.steps ?? ["opened"] }), o.source ?? "decline", o.attempt, o.at ?? "2026-09-22T19:24:00Z", o.step ?? null],
  ).then((r) => r.rows);
const incident = () => one(`select * from card_fraud_incidents where org_id = $1 and incident_key = $2`, [ORG, KEY]);
const attempts = async () => (await db.query(`select source_id, step from card_fraud_incident_attempts order by attempted_at, source_id`)).rows;

// ── 1. open ──────────────────────────────────────────────────────────────────────────────────
let r = await record({ attempt: ids.d04, step: "opened" });
ok("opening an incident returns its id at version 1", r.length === 1 && r[0].version === 1, JSON.stringify(r));
ok("the attempt is mapped to it, with the step it took", JSON.stringify(await attempts()) === JSON.stringify([{ source_id: ids.d04, step: "opened" }]));

// ── 2. idempotent ────────────────────────────────────────────────────────────────────────────
r = await record({ attempt: ids.d04, version: 1, count: 2, step: "returned" });
ok("recording the same attempt again is refused", r.length === 0, JSON.stringify(r));
ok("and changes nothing", (await incident()).attempt_count === 1 && (await incident()).version === 1);

// ── 3. versions ──────────────────────────────────────────────────────────────────────────────
r = await record({ attempt: ids.d05, version: 1, count: 2, last: "2026-09-22T19:24:00Z" });
ok("extending at the version read succeeds and bumps the version", r.length === 1 && r[0].version === 2, JSON.stringify(r));
r = await record({ attempt: ids.d06, version: 1, count: 3, last: "2026-09-23T00:16:00Z", step: "inactive_card" });
ok("extending at a stale version is refused", r.length === 0, JSON.stringify(r));
ok("a refused extension maps no attempt", !(await attempts()).some((a) => a.source_id === ids.d06));
r = await record({ attempt: ids.d06, version: 2, count: 3, last: "2026-09-23T00:16:00Z", step: "inactive_card", at: "2026-09-23T00:16:00Z" });
const after = await incident();
ok("re-applied at the current version it lands", r.length === 1 && after.attempt_count === 3 && after.version === 3
  && new Date(after.last_attempt_at).toISOString() === "2026-09-23T00:16:00.000Z", JSON.stringify(after));

// ── 4. key taken ─────────────────────────────────────────────────────────────────────────────
r = await record({ attempt: "00000000-0000-0000-0000-0000000000aa" });
ok("opening with a key already taken is refused", r.length === 0, JSON.stringify(r));

// ── 5. closed ────────────────────────────────────────────────────────────────────────────────
const fails = async (name, fn, pattern) => {
  try { await fn(); ok(name, false, "did not raise"); } catch (e) { ok(name, pattern.test(e.message), e.message); }
};
await fails("closing without an outcome is refused",
  () => db.query(`update card_fraud_incidents set status = 'dismissed' where incident_key = $1`, [KEY]), /card_fraud_incidents_closed_has_outcome/);
await db.query(`update card_fraud_incidents set status = 'resolved', disposition = 'confirmed' where incident_key = $1`, [KEY]);
r = await record({ attempt: "00000000-0000-0000-0000-0000000000bb", version: 3, count: 4 });
ok("a closed incident refuses an extension, even at the current version", r.length === 0 && (await incident()).attempt_count === 3);
await db.query(`update card_fraud_incidents set status = 'open', disposition = null where incident_key = $1`, [KEY]);

// ── 6. tenancy ───────────────────────────────────────────────────────────────────────────────
r = await record({ org: OTHER, attempt: "00000000-0000-0000-0000-0000000000cc", version: 3, count: 4 });
ok("another org cannot extend this org's incident", r.length === 0 && (await incident()).attempt_count === 3);

// ── 7. grants ────────────────────────────────────────────────────────────────────────────────
const SIG = "public.card_fraud_record(uuid, text, int, text, uuid, timestamptz, timestamptz, int, boolean, jsonb, text, uuid, timestamptz, text)";
const can = async (role) => (await one(`select has_function_privilege($1, $2, 'execute') p`, [role, SIG])).p;
ok("the writer is the service role's alone",
  (await can("service_role")) === true && (await can("authenticated")) === false && (await can("anon")) === false);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
