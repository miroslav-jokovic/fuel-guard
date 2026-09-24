// FuelGuard — applicant-flow phases matrix (migration 0365, APPLICANT-FLOW-PLAN AF2).
//
// The two functions the owner's order of the hire needs before any TypeScript calls them:
//
//   · record_applicant_identity — ONE writer for the driver row and the draft (D-AF8). The applicant
//     fills gaps only, the office overwrites, and the draft always holds what ended up on the row, so
//     the licence PSP ran against is the licence on the filed application.
//   · send_application_invitation — the office's act between screening and the form: rotate the
//     link, stamp the first send, never shorten the expiry, never before the permissions.
//
// And the backfill: every invitation already past its permissions keeps the form it has.
//
// Applies EVERY migration, same as rls.test.mjs.
//
// Run:  node supabase/tests/applicant-flow-phases.test.mjs
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
const BACKFILL_MIGRATION = "0365_applicant_flow_phases.sql";

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
const raised = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
};
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

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

// ⚠ The migrations BEFORE 0365 first, then the fixtures the backfill has to find, then 0365 and
// anything after it. Seeding after every migration had run would test an UPDATE against rows it
// never saw — the backfill would pass on an empty table.
const before = MIGRATIONS.filter((f) => f < BACKFILL_MIGRATION);
const from = MIGRATIONS.filter((f) => f >= BACKFILL_MIGRATION);
ok("0365 is among the migrations applied", from[0] === BACKFILL_MIGRATION);
const apply = async (files) => {
  for (const f of files)
    await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
};
await apply(before);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'U') returning id`)).id;
const newDriver = async (name, org = ORG) =>
  (await one(`insert into drivers (org_id, full_name, status) values ($1,$2,'applicant') returning id`, [org, name])).id;
const invite = async (driver, label, { expires = "now() + interval '14 days'", org = ORG } = {}) =>
  (
    await one(
      `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
         values ($1, $2, $3, ${expires}) returning id`,
      [org, driver, `hash-${label}`],
    )
  ).id;

// ── the backfill, seeded under the OLD schema ──────────────────────────────────────────────────
const PAST_DRIVER = await newDriver("Past Permissions");
const PAST = await invite(PAST_DRIVER, "past");
await db.query(
  `update application_invitations set releases_completed_at = timestamptz '2026-09-17 15:00:00+00' where id = $1`,
  [PAST],
);
const FRESH_DRIVER = await newDriver("Fresh Link");
const FRESH = await invite(FRESH_DRIVER, "fresh");

await apply(from);

// A brand new table has no grant for `authenticated` without this (rls.test.mjs's reason).
await db.exec(`
  grant usage on schema public to authenticated, anon;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant select on all tables in schema public to anon;
`);

{
  const past = await one(`select application_sent_at, releases_completed_at, signing_opened_at from application_invitations where id = $1`, [PAST]);
  ok(
    "backfill: an invitation past its permissions is sent at the moment they completed",
    past.application_sent_at?.getTime() === past.releases_completed_at?.getTime(),
    JSON.stringify(past),
  );
  ok("backfill: signing is NOT opened for anybody", past.signing_opened_at === null);
  const fresh = await one(`select application_sent_at from application_invitations where id = $1`, [FRESH]);
  ok("backfill: an invitation still at its permissions stays unsent", fresh.application_sent_at === null);
}

// ── identity: fill-only for the applicant, overwrite for the office ────────────────────────────
const identity = (inv, driver, dob, number, state, overwrite, org = ORG) =>
  db.query(`select public.record_applicant_identity($1,$2,$3,$4::date,$5,$6,$7) as r`, [
    org, inv, driver, dob, number, state, overwrite,
  ]);
const driverRow = (id) => one(`select date_of_birth, cdl_number, cdl_state from drivers where id = $1`, [id]);
const draftOf = async (inv) => (await one(`select payload from application_drafts where invitation_id = $1`, [inv]))?.payload;

const SUSAN = await newDriver("Susan Godfrey");
const INV = await invite(SUSAN, "susan");

{
  ok("no draft exists before identity is given", (await draftOf(INV)) === undefined);
  const r = (await identity(INV, SUSAN, "1980-04-02", " D1234567 ", "IL", false)).rows[0].r;
  const row = await driverRow(SUSAN);
  ok("applicant: fills an empty driver row", iso(row.date_of_birth) === "1980-04-02" && row.cdl_number === "D1234567" && row.cdl_state === "IL", JSON.stringify(row));
  const draft = await draftOf(INV);
  ok("applicant: creates the draft when there is none", draft !== undefined && r.draft_id);
  ok(
    "applicant: the draft carries the same three values, the DOB as YYYY-MM-DD",
    draft.date_of_birth === "1980-04-02" && draft.cdl_number === "D1234567" && draft.cdl_state === "IL",
    JSON.stringify(draft),
  );
  ok("applicant: nothing kept over what they typed on an empty row", Array.isArray(r.kept_existing) && r.kept_existing.length === 0);
}

// The applicant has typed other answers since; the office then corrects the licence number.
await db.query(`update application_drafts set payload = payload || '{"first_name":"Susan","employers":[{"name":"Acme"}]}'::jsonb where invitation_id = $1`, [INV]);
{
  await identity(INV, SUSAN, "1980-04-02", "D7654321", "WI", true);
  const row = await driverRow(SUSAN);
  ok("office: overwrites the driver row", row.cdl_number === "D7654321" && row.cdl_state === "WI", JSON.stringify(row));
  const draft = await draftOf(INV);
  ok("office: overwrites the draft's identity keys", draft.cdl_number === "D7654321" && draft.cdl_state === "WI");
  ok(
    "office: the merge keeps every other key the applicant typed",
    draft.first_name === "Susan" && Array.isArray(draft.employers) && draft.employers[0]?.name === "Acme",
    JSON.stringify(draft),
  );
}

// ⚠ The discriminating case for D-AF8: the applicant re-submits AFTER the office's correction. The
// row keeps the office's value (fill-only), and the draft must follow the ROW, not what was typed —
// a merge of the typed values would leave PSP's licence and the application's licence different.
{
  const r = (await identity(INV, SUSAN, "1981-01-01", "TYPED-AGAIN", "IN", false)).rows[0].r;
  const row = await driverRow(SUSAN);
  ok("applicant after office: the row keeps the office's values", iso(row.date_of_birth) === "1980-04-02" && row.cdl_number === "D7654321" && row.cdl_state === "WI", JSON.stringify(row));
  const draft = await draftOf(INV);
  ok(
    "applicant after office: the draft holds what is on the row, not what was typed",
    draft.date_of_birth === "1980-04-02" && draft.cdl_number === "D7654321" && draft.cdl_state === "WI",
    JSON.stringify(draft),
  );
  ok(
    "applicant after office: names (never values) what was kept",
    JSON.stringify([...r.kept_existing].sort()) === JSON.stringify(["cdl_number", "cdl_state", "date_of_birth"]),
    JSON.stringify(r),
  );
  ok("applicant after office: one draft per invitation, still", Number((await one(`select count(*)::int n from application_drafts where invitation_id = $1`, [INV])).n) === 1);
}

// ── identity: refusals ─────────────────────────────────────────────────────────────────────────
{
  const e1 = await raised(() => identity(INV, SUSAN, "1980-04-02", "X", "IL", true, OTHER_ORG));
  ok("refuses another org's invitation (AI001)", e1?.code === "AI001", e1?.code);

  const OTHER_DRIVER = await newDriver("Somebody Else");
  const e2 = await raised(() => identity(INV, OTHER_DRIVER, "1980-04-02", "X", "IL", true));
  ok("refuses a driver the invitation does not name (AI001)", e2?.code === "AI001", e2?.code);

  const e3 = await raised(() => identity(INV, SUSAN, "1980-04-02", "   ", "IL", false));
  ok("refuses a blank licence number (AI004)", e3?.code === "AI004", e3?.code);

  const EXP_DRIVER = await newDriver("Lapsed Link");
  const EXP = await invite(EXP_DRIVER, "lapsed", { expires: "now() - interval '1 day'" });
  const e4 = await raised(() => identity(EXP, EXP_DRIVER, "1975-05-05", "L1", "OH", false));
  ok("applicant: refuses an expired link (AI002)", e4?.code === "AI002", e4?.code);
  const e5 = await raised(() => identity(EXP, EXP_DRIVER, "1975-05-05", "L1", "OH", true));
  ok("office: corrects identity on a link that lapsed during screening", e5 === null, e5?.message);
  ok("office: and the correction reached the row", (await driverRow(EXP_DRIVER)).cdl_number === "L1");

  const REV_DRIVER = await newDriver("Revoked Link");
  const REV = await invite(REV_DRIVER, "revoked");
  await db.query(`update application_invitations set revoked_at = now() where id = $1`, [REV]);
  const e6 = await raised(() => identity(REV, REV_DRIVER, "1975-05-05", "R1", "OH", true));
  ok("refuses a revoked link, even for the office (AI002)", e6?.code === "AI002", e6?.code);

  const SUB_DRIVER = await newDriver("Filed Already");
  const SUB = await invite(SUB_DRIVER, "filed");
  await db.query(`update application_invitations set submitted_at = now() where id = $1`, [SUB]);
  const e7 = await raised(() => identity(SUB, SUB_DRIVER, "1975-05-05", "S1", "OH", true));
  ok("refuses a submitted application — it is frozen (AI003)", e7?.code === "AI003", e7?.code);
  ok("and a refused call wrote nothing to the row", (await driverRow(SUB_DRIVER)).cdl_number === null);
}

// ── sending the application ────────────────────────────────────────────────────────────────────
const send = (inv, hash, days = 14, org = ORG) =>
  db.query(`select public.send_application_invitation($1,$2,$3,$4) as sent`, [org, inv, hash, days]);
const invitationOf = (id) =>
  one(`select token_hash, expires_at, application_sent_at from application_invitations where id = $1`, [id]);

{
  const e = await raised(() => send(INV, "hash-rotated-1"));
  ok("refuses before the permissions are complete (AI005)", e?.code === "AI005", e?.code);
  ok("and did not rotate the link", (await invitationOf(INV)).token_hash === "hash-susan");

  await db.query(`update application_invitations set releases_completed_at = now() where id = $1`, [INV]);
  const sent = (await send(INV, "hash-rotated-1")).rows[0].sent;
  const after = await invitationOf(INV);
  ok("sends once the permissions are complete, rotating the hash", after.token_hash === "hash-rotated-1");
  ok("stamps application_sent_at and returns it", after.application_sent_at !== null && sent?.getTime() === after.application_sent_at.getTime());

  // A second press — the email was lost. Rotates again; the stamp keeps its first date.
  await db.query(`update application_invitations set application_sent_at = timestamptz '2026-09-20 12:00:00+00' where id = $1`, [INV]);
  await send(INV, "hash-rotated-2");
  const again = await invitationOf(INV);
  ok("a second send rotates again", again.token_hash === "hash-rotated-2");
  ok("a second send keeps the FIRST date", again.application_sent_at.toISOString() === "2026-09-20T12:00:00.000Z", again.application_sent_at?.toISOString());
}

{
  // A recruiter's deliberate 60-day link is not cut to 14 by sending the application.
  const LONG_DRIVER = await newDriver("Long Link");
  const LONG = await invite(LONG_DRIVER, "long", { expires: "now() + interval '60 days'" });
  await db.query(`update application_invitations set releases_completed_at = now() where id = $1`, [LONG]);
  const before = (await invitationOf(LONG)).expires_at.getTime();
  await send(LONG, "hash-long-rotated", 14);
  ok("never shortens a longer link", (await invitationOf(LONG)).expires_at.getTime() === before);

  // The owner's order outlives 14 days: the link lapsed while the office waited on a lab.
  const LAB_DRIVER = await newDriver("Waited On A Lab");
  const LAB = await invite(LAB_DRIVER, "lab", { expires: "now() - interval '3 days'" });
  await db.query(`update application_invitations set releases_completed_at = now() - interval '20 days' where id = $1`, [LAB]);
  const e = await raised(() => send(LAB, "hash-lab-rotated", 14));
  ok("revives a link that lapsed during screening", e === null, e?.message);
  const lab = await invitationOf(LAB);
  ok("and gives it at least the extension asked for", lab.expires_at.getTime() > Date.now() + 13 * 86_400_000, lab.expires_at?.toISOString());

  const REV_DRIVER = await newDriver("Revoked Before Send");
  const REV = await invite(REV_DRIVER, "rev-send");
  await db.query(`update application_invitations set releases_completed_at = now(), revoked_at = now() where id = $1`, [REV]);
  const e2 = await raised(() => send(REV, "hash-rev-rotated"));
  ok("refuses a revoked invitation (AI002)", e2?.code === "AI002", e2?.code);

  const SUB_DRIVER = await newDriver("Filed Before Send");
  const SUB = await invite(SUB_DRIVER, "sub-send");
  await db.query(`update application_invitations set releases_completed_at = now(), submitted_at = now() where id = $1`, [SUB]);
  const e3 = await raised(() => send(SUB, "hash-sub-rotated"));
  ok("refuses a submitted application (AI003)", e3?.code === "AI003", e3?.code);

  const e4 = await raised(() => send(INV, "hash-x", 14, OTHER_ORG));
  ok("refuses another org's invitation (AI001)", e4?.code === "AI001", e4?.code);
}

// ── both functions are the service role's alone ───────────────────────────────────────────────
{
  const grants = await db.query(
    `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth,
            has_function_privilege('anon', p.oid, 'execute') as anon
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('record_applicant_identity','send_application_invitation')`,
  );
  ok("both functions exist", grants.rows.length === 2);
  ok("neither is executable by a browser session", grants.rows.every((g) => !g.auth && !g.anon), JSON.stringify(grants.rows));
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
