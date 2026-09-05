// FuelGuard — ESIGN consent matrix (migration 0227, APPLICATION-SYSTEM-PLAN A4 / D-APP5).
//
// 49 CFR §390.32(d) makes an electronic §391.21 application conditional on including proof of consent
// per 15 U.S.C. 7001(c). This is that proof, and it sits on the EVIDENCE side of the line — the exact
// mirror of `application_drafts` (0226), which is built to be deleted.
//
// So the properties are the opposite ones:
//
//   · the append-only guard fires for the SERVICE ROLE too (the EI010/DA010 family), because nothing
//     may rewrite proof of consent — where 0226's 0213-style guard deliberately lets it through
//   · a delete is refused outright, from every writer
//   · `withdrawn_at` may be set once and never changed, because withdrawing is a fact ABOUT a consent
//     and un-withdrawing is a new consent, not an edit
//   · one consent per invitation, and the transaction that files it stamps the invitation's phase
//
// Applies EVERY migration, same as rls.test.mjs.
//
// Run:  node supabase/tests/esign-consents.test.mjs
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
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;
const USER = (await one(`insert into auth.users (email) values ('recruiter@t.test') returning id`)).id;
const DRIVER = (
  await one(`insert into drivers (org_id, full_name, status) values ($1,'Susan Godfrey','applicant') returning id`, [ORG])
).id;

const invite = async (label, org = ORG, driver = DRIVER, expires = "now() + interval '14 days'") =>
  (
    await one(
      `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
         values ($1, $2, $3, ${expires}) returning id`,
      [org, driver, `hash-${label}`],
    )
  ).id;

const TEXT = "You can have these on paper instead\nYou do not have to do any of this electronically.";
const INTENT = "I agree to sign this application and its authorizations electronically.";

const consent = (invitation, org = ORG, driver = DRIVER) =>
  db.query(
    `select public.record_esign_consent($1,$2,$3,'v1',$4,$5,'203.0.113.9','UA') as r`,
    [org, invitation, driver, TEXT, INTENT],
  );

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

// ── recording one ──────────────────────────────────────────────────────────────────────────────
const INV = await invite("susan");
const filed = (await consent(INV)).rows[0].r;
ok("the consent is filed", Boolean(filed.consent_id));
ok(
  "and the invitation's consent phase is stamped in the same transaction",
  (await one(`select consented_at from application_invitations where id = $1`, [INV])).consented_at !== null,
);
// The point of storing the text rather than a reference to code that may change.
const row = await one(`select disclosure_version, disclosure_text, intent_statement, applicant_ip from esign_consents where id = $1`, [filed.consent_id]);
ok("the exact text the driver saw is stored beside their consent", row.disclosure_text === TEXT);
ok("with the version, so a draft consent could never pass for a reviewed one", row.disclosure_version === "v1");
ok("and the same attribution every signature here carries", row.intent_statement === INTENT && row.applicant_ip === "203.0.113.9");

const second = await raised(() => consent(INV));
ok("a second consent on the same link is refused (EC022)", second?.code === "EC022", String(second?.code));
ok("and only one row exists", (await count(`select count(*)::int as n from esign_consents where invitation_id = $1`, [INV])) === 1);

// ── the invitation still governs the whole session ─────────────────────────────────────────────
const REVOKED = await invite("revoked");
await db.query(`update application_invitations set revoked_at = now() where id = $1`, [REVOKED]);
const revoked = await raised(() => consent(REVOKED));
ok("a revoked invitation cannot be consented on (EC021)", revoked?.code === "EC021", String(revoked?.code));

const EXPIRED = await invite("expired", ORG, DRIVER, "now() - interval '1 day'");
const expired = await raised(() => consent(EXPIRED));
ok("nor an expired one (EC021)", expired?.code === "EC021", String(expired?.code));

const STRANGER_DRIVER = (
  await one(`insert into drivers (org_id, full_name, status) values ($1,'Jose Davis','applicant') returning id`, [OTHER_ORG])
).id;
const STRANGER_INV = await invite("stranger", OTHER_ORG, STRANGER_DRIVER);
const crossOrg = await raised(() => consent(STRANGER_INV, ORG, STRANGER_DRIVER));
ok("an invitation from another org is not found (EC020)", crossOrg?.code === "EC020", String(crossOrg?.code));
ok(
  "and nothing was filed for them",
  (await count(`select count(*)::int as n from esign_consents where invitation_id = $1`, [STRANGER_INV])) === 0,
);

// ── EVIDENCE: nothing rewrites it, including the service role ──────────────────────────────────
// This is the assertion the trigger style was chosen for, and it is the exact opposite of 0226's
// prunability pin. Both are deliberate; each table's header says which side of the line it is on.
const serviceUpdate = await raised(() =>
  db.query(`update esign_consents set disclosure_text = 'something else' where id = $1`, [filed.consent_id]),
);
ok("the SERVICE ROLE cannot rewrite the text", serviceUpdate?.code === "EC010", String(serviceUpdate?.code));
const serviceVersion = await raised(() =>
  db.query(`update esign_consents set disclosure_version = 'v9' where id = $1`, [filed.consent_id]),
);
ok("nor the version", serviceVersion?.code === "EC010", String(serviceVersion?.code));
const serviceDelete = await raised(() => db.query(`delete from esign_consents where id = $1`, [filed.consent_id]));
ok("nor delete it", serviceDelete?.code === "EC010", String(serviceDelete?.code));
ok(
  "and it is still there, unchanged",
  (await one(`select disclosure_text from esign_consents where id = $1`, [filed.consent_id])).disclosure_text === TEXT,
);

// ── withdrawal is a fact about a consent, not an edit of one ───────────────────────────────────
const withdraw = await raised(() =>
  db.query(`update esign_consents set withdrawn_at = now() where id = $1`, [filed.consent_id]),
);
ok("7001(c)(1)(B)(i)(II): the consent can be withdrawn", withdraw === null, String(withdraw?.code));
const unwithdraw = await raised(() =>
  db.query(`update esign_consents set withdrawn_at = null where id = $1`, [filed.consent_id]),
);
ok(
  "but a withdrawal cannot be undone by an UPDATE — resuming means consenting again",
  unwithdraw?.code === "EC010",
  String(unwithdraw?.code),
);

// ── not reachable from a browser session ───────────────────────────────────────────────────────
ok(
  "esign_consents has RLS on and no client policies",
  (await count(`select count(*)::int as n from pg_policies where tablename = 'esign_consents'`)) === 0 &&
    (await one(`select relrowsecurity from pg_class where relname = 'esign_consents'`)).relrowsecurity === true,
);
ok(
  "a browser session reads nothing",
  Number((await asRole("authenticated", `select count(*)::int as n from esign_consents`)).rows[0].n) === 0,
);
ok(
  "the recording function is service_role only",
  (await count(
    `select count(*)::int as n from information_schema.role_routine_grants
      where routine_name = 'record_esign_consent' and grantee in ('anon','authenticated','PUBLIC')`,
  )) === 0,
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
