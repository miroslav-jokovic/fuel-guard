// FuelGuard — applicant disposition matrix (migration 0238).
//
// The applicant pipeline had one exit and it went one way: `hire_applicant`. Nothing could record
// that a carrier decided NOT to hire somebody — not the reason, not the date, not who decided. That
// is a gap in its own right, and it is the blocker underneath R10, because FCRA adverse action is a
// consequence of a decision and there was no decision to hang it on.
//
// Five rules, and this file is where each is a fact rather than a comment:
//
//   1. AD010 — the CONTENT is immutable on UPDATE, for everybody including the service role. A
//      correction is a new disposition and the list is newest-first.
//   2. ⚠ `driver_id` is NOT in that column list, so `merge_driver` can carry the row.
//   3. ⚠ **`merge_driver` MUST carry it, and this is the case 0237's did not have.** The
//      return-to-duty flag needed no merge work because it only exists on a driver holding a
//      `driver_applications` row, which MD010 refuses to merge. A disposition has no such shield: an
//      applicant can be declined before they ever open the link.
//   4. It IS deletable — deliberately prunable, because this is personal data about somebody the
//      carrier did not employ. No window is set; that is Q-REC7's question.
//   5. There is no `hired` outcome. `drivers.status` records a hire; a second row saying so is one
//      fact in two places.
//
// Run:  node supabase/tests/applicant-dispositions.test.mjs
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
const count = async (q, p = []) => Number((await one(q, p)).n);

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
    bucket_id text, name text, owner uuid, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text)
  returns text[]
  language sql
  immutable
  as $fn$
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
// Supabase's real default privileges, installed BEFORE the migrations run — same modelling (and the
// same reasoning) as rls.test.mjs: full DML granted, RLS is the gate.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ACTOR = "00000000-0000-4000-8000-000000000001";
await db.query(`insert into auth.users (id, email) values ($1, 'admin@test') on conflict do nothing`, [ACTOR]);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'O') returning id`)).id;
const driver = async (name, org = ORG) =>
  (await one(`insert into drivers (org_id,full_name) values ($1,$2) returning id`, [org, name])).id;

const DRIVER = await driver("Turned Down");

const decide = async (driverId = DRIVER, over = {}) => {
  const o = { outcome: "declined", decided_on: "2026-08-20", reason: "Gap in the three-year window", rested: false, org: ORG, ...over };
  return one(
    `insert into applicant_dispositions
       (org_id, driver_id, outcome, decided_on, reason, rested_on_consumer_report, decided_by)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [o.org, driverId, o.outcome, o.decided_on, o.reason, o.rested, ACTOR],
  );
};

const attempt = async (sql, params = []) => {
  try { await db.query(sql, params); return "OK"; } catch (e) { return e.code ?? `ERROR: ${e.message}`; }
};

// ── 1. It records ─────────────────────────────────────────────────────────────────────────────
const ID = (await decide()).id;
ok("a decision is recorded", (await count(`select count(*)::int as n from applicant_dispositions where id = $1`, [ID])) === 1);

// ── 2. The vocabulary ─────────────────────────────────────────────────────────────────────────
for (const outcome of ["declined", "withdrawn", "no_response"]) {
  ok(
    `'${outcome}' is a lawful outcome`,
    (await attempt(
      `insert into applicant_dispositions (org_id, driver_id, outcome, decided_on) values ($1,$2,$3,'2026-08-21')`,
      [ORG, DRIVER, outcome],
    )) === "OK",
  );
}
// ⚠ The absence is the decision, so it is asserted rather than left to the header. `drivers.status`
// records a hire; a second row saying the same thing is how the two come to disagree.
ok(
  "'hired' is NOT an outcome — a hire is recorded on the driver, not here",
  (await attempt(
    `insert into applicant_dispositions (org_id, driver_id, outcome, decided_on) values ($1,$2,'hired','2026-08-21')`,
    [ORG, DRIVER],
  )) === "23514",
);

// ── 3. AD010 — the content cannot be rewritten ────────────────────────────────────────────────
for (const [col, val] of [
  ["outcome", "'withdrawn'"],
  ["decided_on", "'2026-01-01'"],
  ["reason", "'a nicer reason'"],
  ["rested_on_consumer_report", "true"],
  ["decided_by", "null"],
]) {
  ok(
    `${col} cannot be rewritten`,
    (await attempt(`update applicant_dispositions set ${col} = ${val} where id = $1`, [ID])) === "AD010",
  );
}

// ── 4. …but driver_id can, which is what lets a merge carry it ────────────────────────────────
const CANON = await driver("Canonical");
ok(
  "driver_id is reassignable, because the guard is about the DECISION and not about whose it is",
  (await attempt(`update applicant_dispositions set driver_id = $1 where id = $2`, [CANON, ID])) === "OK",
);
await db.query(`update applicant_dispositions set driver_id = $1 where id = $2`, [DRIVER, ID]);

// ── 5. merge_driver carries it (0234's lesson — and 0237's did NOT need this) ──────────────────
// ⚠ The contrast is the point. A driver carrying the §40.25(j) flag necessarily holds a
// `driver_applications` row and MD010 refuses to merge them at all. A DECLINED APPLICANT need never
// have opened the link, so this row has no such shield and is exactly what a routine dedup would
// cascade into nothing.
const DUPE = await driver("Declined Before They Ever Applied");
await decide(DUPE);
ok("the duplicate has no application, so MD010 does not protect them",
  (await count(`select count(*)::int as n from driver_applications where driver_id = $1`, [DUPE])) === 0);
await db.query(`select merge_driver($1,$2,$3)`, [ORG, DUPE, CANON]);
ok(
  "a merge carries the decision to the surviving driver instead of destroying it",
  (await count(`select count(*)::int as n from applicant_dispositions where driver_id = $1`, [CANON])) === 1
    && (await count(`select count(*)::int as n from applicant_dispositions where driver_id = $1`, [DUPE])) === 0,
);

// ── 6. Prunable, deliberately ─────────────────────────────────────────────────────────────────
// Not in RETENTION_FORBIDDEN and not immutable on DELETE: this is personal data about somebody the
// carrier did not employ. The WINDOW is Q-REC7's and unanswered, so no rule prunes it yet — the
// schema simply must not stand in the way of the answer.
const PRUNE = (await decide(CANON, { decided_on: "2020-01-01" })).id;
ok("a disposition can be deleted, so a retention rule will be able to prune it",
  (await attempt(`delete from applicant_dispositions where id = $1`, [PRUNE])) === "OK");

// ── 7. Tenancy ────────────────────────────────────────────────────────────────────────────────
const STRANGER = await driver("Somebody Else", OTHER);
await decide(STRANGER, { org: OTHER });
ok(
  "another org's decision is its own and does not join this org's list",
  (await count(`select count(*)::int as n from applicant_dispositions where org_id = $1`, [OTHER])) === 1
    && (await count(
      `select count(*)::int as n from applicant_dispositions where org_id = $1 and driver_id = $2`,
      [ORG, STRANGER],
    )) === 0,
);

// ── 8. RLS is deny-all for a browser session ──────────────────────────────────────────────────
// No client policies, by design: the API reads with the service role and org-filters itself.
await db.exec("begin");
await db.exec("set local role authenticated");
await db.query("select set_config('request.jwt.claims', $1, true)", [
  JSON.stringify({ sub: ACTOR, org_id: ORG, user_role: "admin", role: "authenticated" }),
]);
const asMember = Number((await db.query(`select count(*)::int as n from applicant_dispositions`)).rows[0].n);
await db.exec("rollback");
ok("even an admin's browser session reads nothing directly — the API is the only door", asMember === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
