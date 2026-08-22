// FuelGuard — SMS consent matrix (migration 0233, APPLICATION-SYSTEM-PLAN A11b / D-APP13).
//
// `sms_consents` is on the EVIDENCE side of the line, and every property below follows from why: the
// TCPA assesses $500 to $1,500 PER MESSAGE, and the only defence a carrier has is the record of what
// somebody agreed to, in what words, and whether they later said stop. A record that could be edited
// after the fact is not a defence, so the guard is EI010's family — it fires for the service role
// too, which is us.
//
// The properties proved here:
//
//   · a browser session cannot read or write it (RLS deny-all, no client policies)
//   · nothing may rewrite what was agreed — not the text, not the version, not the number, not us
//   · `revoked_at` is the ONE mutable column, because a STOP must always be recordable...
//   · ...and once set it may not be cleared, because un-revoking is the act this table forbids
//   · one STOP revokes every live consent on that number, and a second one is a no-op
//
// Applies EVERY migration, same as rls.test.mjs.
//
// Run:  node supabase/tests/sms-consents.test.mjs
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
const raised = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
};

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
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// A brand new table has no grant for `authenticated` without this, so a read would ERROR rather than
// be filtered by policy — and "it threw" would look like "it was refused".
await db.exec(`
  grant usage on schema public to authenticated, anon;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant select on all tables in schema public to anon;
  alter default privileges in schema public grant select on tables to anon;
`);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'U') returning id`)).id;
const USER = (await one(`insert into auth.users (email) values ('recruiter@t.test') returning id`)).id;
const driver = async (name, org = ORG) =>
  (await one(`insert into drivers (org_id, full_name, status) values ($1,$2,'applicant') returning id`, [org, name])).id;
const DRIVER = await driver("Susan Godfrey");

const PHONE = "+17082365732";
const grant = async (driverId, phone = PHONE, org = ORG) =>
  (
    await one(
      `insert into sms_consents (org_id, driver_id, phone, consent_text, consent_version,
         intent_statement, source, granted_ip, granted_user_agent)
       values ($1,$2,$3,'The agreed wording.','v1','I agree to receive text messages.','application',
         '203.0.113.9','UA') returning id`,
      [org, driverId, phone],
    )
  ).id;

const CONSENT = await grant(DRIVER);
ok("a consent can be recorded", Boolean(CONSENT));

/** Run one statement as a browser session would (the JWT shape rls.test.mjs uses). */
const asRole = async (role, sql, params = []) => {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: USER, org_id: ORG, role, user_role: "recruiter" }),
    ]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return res;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
};

// ── nobody's browser reads or writes this ──────────────────────────────────────────────────────
ok(
  "a browser session reads nothing — RLS deny-all, no client policies",
  Number((await asRole("authenticated", `select count(*)::int as n from sms_consents`)).rows[0].n) === 0,
);
ok(
  "an anonymous caller reads nothing either",
  Number((await asRole("anon", `select count(*)::int as n from sms_consents`)).rows[0].n) === 0,
);
ok(
  "sms_consents has RLS on and no client policies",
  (await count(`select count(*)::int as n from pg_policies where tablename = 'sms_consents'`)) === 0 &&
    (await one(`select relrowsecurity from pg_class where relname = 'sms_consents'`)).relrowsecurity === true,
);

// ── ⚠ THE GUARD FIRES FOR US TOO. This is the whole difference between this table and a draft. ──
for (const [column, value] of [
  ["consent_text", `'something else entirely'`],
  ["consent_version", `'v2'`],
  ["phone", `'+15550001111'`],
  ["intent_statement", `'I agree to something else.'`],
  ["source", `'office'`],
  ["granted_ip", `'198.51.100.1'`],
]) {
  const e = await raised(() =>
    db.query(`update sms_consents set ${column} = ${value} where id = $1`, [CONSENT]));
  ok(`the service role cannot rewrite ${column} — a consent that can be edited is not evidence`,
    e?.code === "SC010", String(e?.code));
}

// ── the one column that may move, and the one direction it may move in ─────────────────────────
const revoked = await raised(() =>
  db.query(`select public.revoke_sms_consent($1,$2,'inbound: STOP')`, [ORG, PHONE]));
ok("a STOP is always recordable", revoked === null, String(revoked?.code));
ok(
  "and it lands on the row",
  (await one(`select revoked_at, revoked_reason from sms_consents where id = $1`, [CONSENT])).revoked_at !== null,
);
const unrevoke = await raised(() =>
  db.query(`update sms_consents set revoked_at = null where id = $1`, [CONSENT]));
ok(
  "un-revoking is refused — the act this table exists to make impossible",
  unrevoke?.code === "SC011", String(unrevoke?.code),
);

// ── one STOP means do not text me, not do not text me about this one application ───────────────
const SECOND = await driver("Same Phone, Second Application");
await grant(SECOND, PHONE);
const THIRD = await driver("Different Phone");
await grant(THIRD, "+15551230000");
const n = (await one(`select public.revoke_sms_consent($1,$2,'inbound: STOP') as r`, [ORG, PHONE])).r;
ok("a STOP revokes every live consent on that number", Number(n) === 1, String(n));
ok(
  "and leaves a different number's consent alone",
  (await one(`select revoked_at from sms_consents where driver_id = $1`, [THIRD])).revoked_at === null,
);
const again = (await one(`select public.revoke_sms_consent($1,$2,'inbound: STOP') as r`, [ORG, PHONE])).r;
ok("a second STOP is a no-op rather than an error", Number(again) === 0, String(again));

// ── tenancy: the webhook resolves the org from the number and never accepts one ────────────────
const MALLORY = await driver("Other Org", OTHER_ORG);
await grant(MALLORY, "+15559998888", OTHER_ORG);
const crossOrg = (await one(`select public.revoke_sms_consent($1,$2,'inbound: STOP') as r`,
  [ORG, "+15559998888"])).r;
ok("one org cannot revoke another org's consent", Number(crossOrg) === 0, String(crossOrg));
ok(
  "and that consent is still live",
  (await one(`select revoked_at from sms_consents where driver_id = $1`, [MALLORY])).revoked_at === null,
);

ok(
  "the revoke function is service_role only",
  (await count(
    `select count(*)::int as n from information_schema.role_routine_grants
      where routine_name = 'revoke_sms_consent' and grantee in ('anon','authenticated','PUBLIC')`,
  )) === 0,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
