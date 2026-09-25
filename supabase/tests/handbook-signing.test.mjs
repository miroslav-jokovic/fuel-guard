// Silvicom 360 — the handbook ceremony's schema (migration 0374, HANDBOOK-SIGNING-PLAN.md HB0).
//
// What must be a fact rather than a comment: Representatives are added and deleted but never edited,
// and cannot be deleted once they countersign (D-HB3); a handbook mark exists only between "the
// application is filed and the office opened handbook signing" and "the handbook is filed" (D-HB1);
// the carrier's place names both the Representative and the office user; and marks are append-only,
// including against a cascade from the invitation.
//
// Run:  node supabase/tests/handbook-signing.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const sqlstate = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
};

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text,
    name text, owner uuid, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
// Supabase's default privileges, before the migrations, as rls.test.mjs installs them: RLS is the gate.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const org = async (name) => (await one(`insert into organizations (id, name) values (gen_random_uuid(), $1) returning id`, [name])).id;
const ORG = await org("Carrier");
const OTHER = await org("Someone else");
const OFFICE = (await one(`insert into auth.users (email) values ('office@carrier.test') returning id`)).id;
const DRIVER = (await one(`insert into drivers (org_id, full_name) values ($1, 'Jovana Petrović-Szczepańska') returning id`, [ORG])).id;

const invitation = async (over = {}) => {
  const v = { submitted_at: "now()", opened: true, filed: false, expires: "now() + interval '10 days'", ...over };
  return (await one(
    `insert into application_invitations (org_id, driver_id, token_hash, expires_at, submitted_at,
       handbook_signing_opened_at, handbook_signing_opened_by, handbook_filed_at)
     values ($1, $2, md5(random()::text), ${v.expires}, ${v.submitted_at},
       ${v.opened ? "now()" : "null"}, ${v.opened ? `'${OFFICE}'` : "null"}, ${v.filed ? "now()" : "null"})
     returning id`, [ORG, DRIVER])).id;
};

const addRep = (o, path, name = "Miroslav Jokovic", title = "Safety manager") =>
  sqlstate(`insert into carrier_representatives (org_id, full_name, title, signature_path, created_by) values ($1,$2,$3,$4,$5)`,
    [o, name, title, path, OFFICE]);

const mark = (inv, place, over = {}) => {
  const m = { org: ORG, party: "driver", rep: null, by: null, version: "hb-2026-09-25-abcdef", ...over };
  return sqlstate(
    `insert into handbook_marks (org_id, invitation_id, placement_id, party, handbook_version, signed_name, affirmed,
       representative_id, recorded_by)
     values ($1, $2, $3, $4, $5, 'Jovana Petrović-Szczepańska', 'By signing this, I agree to safety penalty policy.', $6, $7)`,
    [m.org, inv, place, m.party, m.version, m.rep, m.by]);
};

// ── 1. Representatives (D-HB3: add or delete, like maintenance_inspectors) ──────────────────────
ok("a representative with a name, a title and a signature in the org's own folder is accepted",
  (await addRep(ORG, `${ORG}/representatives/r1.png`)) === null);
ok("a signature from ANOTHER org's folder is refused (23514)", (await addRep(ORG, `${OTHER}/representatives/x.png`)) === "23514");
ok("a signature outside the representatives folder is refused (23514)", (await addRep(ORG, `${ORG}/examiners/x.png`)) === "23514");
ok("a blank name is refused (23514)", (await addRep(ORG, `${ORG}/representatives/s.png`, " ")) === "23514");
ok("a blank title is refused (23514)", (await addRep(ORG, `${ORG}/representatives/s.png`, "Miroslav Jokovic", " ")) === "23514");
const REP = (await one(`select id from carrier_representatives where org_id = $1`, [ORG])).id;
for (const [col, val] of [["full_name", "'Someone Else'"], ["title", "'Owner'"],
  ["signature_path", `'${ORG}/representatives/other.png'`], ["org_id", `'${OTHER}'`]]) {
  ok(`a representative's ${col} is never edited (HB010)`,
    (await sqlstate(`update carrier_representatives set ${col} = ${val} where id = $1`, [REP])) === "HB010");
}
await addRep(ORG, `${ORG}/representatives/unused.png`, "Unused Person");
const UNUSED = (await one(`select id from carrier_representatives where full_name = 'Unused Person'`)).id;
ok("a representative who has signed nothing can be deleted",
  (await sqlstate(`delete from carrier_representatives where id = $1`, [UNUSED])) === null);

// ── 2. The order the database holds (HB020..HB024) ───────────────────────────────────────────────
const LIVE = await invitation();
ok("a driver mark on a filed application with signing open is accepted", (await mark(LIVE, "h1")) === null);
ok("the same place twice is refused by the index (23505)", (await mark(LIVE, "h1")) === "23505");
ok("before the application is filed: HB022", (await mark(await invitation({ submitted_at: "null", opened: false }), "h1")) === "HB022");
ok("before the office opens handbook signing: HB023", (await mark(await invitation({ opened: false }), "h1")) === "HB023");
ok("after the handbook is filed: HB024", (await mark(await invitation({ filed: true }), "h1")) === "HB024");
ok("on an expired link: HB021", (await mark(await invitation({ expires: "now() - interval '1 day'" }), "h1")) === "HB021");
const REVOKED = await invitation();
await db.query(`update application_invitations set revoked_at = now() where id = $1`, [REVOKED]);
ok("on a revoked link: HB021", (await mark(REVOKED, "h1")) === "HB021");
ok("against another org's invitation: HB020", (await mark(LIVE, "h2", { org: OTHER })) === "HB020");

// ── 3. What a mark must carry ────────────────────────────────────────────────────────────────────
ok("a place that is not h<n> is refused (23514)", (await mark(LIVE, "p25")) === "23514");
ok("a party that is neither driver nor carrier is refused (23514)", (await mark(LIVE, "h2", { party: "witness" })) === "23514");
ok("a carrier mark without its Representative and office user is refused (23514)",
  (await mark(LIVE, "h4c", { party: "carrier" })) === "23514");
ok("a carrier mark naming the Representative but not who applied it is refused (23514)",
  (await mark(LIVE, "h4c", { party: "carrier", rep: REP })) === "23514");
ok("a driver mark naming a Representative is refused (23514)", (await mark(LIVE, "h2", { rep: REP, by: OFFICE })) === "23514");
ok("a carrier mark naming who applied it but no Representative is refused (23514)",
  (await mark(LIVE, "h4c", { party: "carrier", by: OFFICE })) === "23514");
ok("a driver mark naming a Representative alone is refused (23514)", (await mark(LIVE, "h2", { rep: REP })) === "23514");
ok("a carrier mark with both is accepted", (await mark(LIVE, "h4c", { party: "carrier", rep: REP, by: OFFICE })) === null);
ok("a missing text version is refused (23514)", (await mark(LIVE, "h3", { version: "x" })) === "23514");

// ── 4. Append-only, and what that does to the Representative and a merge ─────────────────────────
const MARK = (await one(`select id from handbook_marks where placement_id = 'h1' and invitation_id = $1`, [LIVE])).id;
ok("a mark is never edited (HB011)", (await sqlstate(`update handbook_marks set signed_name = 'x' where id = $1`, [MARK])) === "HB011");
ok("a mark is never deleted (HB011)", (await sqlstate(`delete from handbook_marks where id = $1`, [MARK])) === "HB011");
// 23001 (restrict_violation), not 23503: `on delete restrict` raises its own code. The API maps it to
// a 409 "has signed a handbook", as `deleteInspector` does for 0280's.
ok("a representative who countersigned cannot be deleted (23001, on delete restrict)",
  (await sqlstate(`delete from carrier_representatives where id = $1`, [REP])) === "23001");
ok("deleting the invitation cannot take its handbook marks with it in silence (HB011)",
  (await sqlstate(`delete from application_invitations where id = $1`, [LIVE])) === "HB011");

// ── 5. The invitation's stamps stay in order ─────────────────────────────────────────────────────
const inv2 = await invitation({ submitted_at: "null", opened: false });
ok("handbook signing cannot open before the application is filed (23514)",
  (await sqlstate(`update application_invitations set handbook_signing_opened_at = now(), handbook_signing_opened_by = $2 where id = $1`, [inv2, OFFICE])) === "23514");
const inv3 = await invitation({ opened: false });
ok("opening names who opened it (23514 without)",
  (await sqlstate(`update application_invitations set handbook_signing_opened_at = now() where id = $1`, [inv3])) === "23514");
ok("the handbook cannot be filed before signing was opened (23514)",
  (await sqlstate(`update application_invitations set handbook_filed_at = now() where id = $1`, [inv3])) === "23514");

// ── 6. RLS: on, no client policy ─────────────────────────────────────────────────────────────────
for (const t of ["carrier_representatives", "handbook_marks"]) {
  ok(`${t}: RLS is enabled`, (await one(`select relrowsecurity r from pg_class where relname = $1`, [t])).r === true);
  ok(`${t}: no policy is declared — deny-all is the design`,
    (await one(`select count(*)::int c from pg_policies where tablename = $1`, [t])).c === 0);
}
await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'admin')`, [ORG, OFFICE]);
await db.exec("begin");
await db.exec("set local role authenticated");
await db.query("select set_config('request.jwt.claims', $1, true)",
  [JSON.stringify({ sub: OFFICE, org_id: ORG, user_role: "admin" })]);
const seenReps = (await db.query(`select id from carrier_representatives`)).rows.length;
const seenMarks = (await db.query(`select id from handbook_marks`)).rows.length;
await db.exec("rollback");
ok("an office user of the same org reads neither table through the client — the API is the only door",
  seenReps === 0 && seenMarks === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
