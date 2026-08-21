// FuelGuard — application draft matrix (migration 0226, APPLICATION-SYSTEM-PLAN A2 / D-APP2).
//
// `application_drafts` is the first table in the recruiting schema built to be DELETED. Everything
// around it — the application, the invitation, the authorizations, the documents — is evidence, in
// RETENTION_FORBIDDEN, append-only against every writer including the service role. A half-typed form
// is none of those things: nobody signed it, nothing cites it, and it holds a date of birth for a
// person who may never apply.
//
// So the properties proved here are the mirror image of the ones the evidence matrices prove:
//
//   · a browser session cannot read, write or delete it (RLS deny-all, plus the trigger)
//   · a JWT-bearing writer is refused by the guard even where RLS would not have applied
//   · the SERVICE ROLE can delete it — which is what makes A11's retention rule possible, and is
//     exactly what the EI010/DA010 trigger style would have made impossible
//   · deleting the invitation takes the draft with it, with no service code involved
//   · the save RPC is an update-then-insert that survives the concurrent-insert race
//
// Applies EVERY migration, same as rls.test.mjs.
//
// Run:  node supabase/tests/application-drafts.test.mjs
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

// A brand new table has no grant for `authenticated` without this, so every read would ERROR rather
// than be filtered by policy — and "it threw" would look like "it was refused". Copied from
// restricted-records.test.mjs, with `role` inside the claims JSON.
await db.exec(`
  grant usage on schema public to authenticated, anon;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant select on all tables in schema public to anon;
  alter default privileges in schema public grant select on tables to anon;
`);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const USER = (await one(`insert into auth.users (email) values ('recruiter@t.test') returning id`)).id;
const DRIVER = (
  await one(`insert into drivers (org_id, full_name, status) values ($1,'Susan Godfrey','applicant') returning id`, [ORG])
).id;

const invite = async (label) =>
  (
    await one(
      `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
         values ($1, $2, $3, now() + interval '14 days') returning id`,
      [ORG, DRIVER, `hash-${label}`],
    )
  ).id;

const INV = await invite("susan");

/**
 * Run one statement as a browser session would (the JWT shape rls.test.mjs uses).
 *
 * Inside an explicit transaction, because `set local` and `set_config(..., true)` are transaction
 * scoped — outside one they are discarded before the statement runs, the query executes as the owner
 * with no claims, and a test that meant to prove a refusal quietly proves nothing.
 */
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

const save = (invitation, payload, section = null) =>
  db.query(`select public.save_application_draft($1,$2,$3,$4::jsonb,$5) as r`, [
    ORG,
    invitation,
    DRIVER,
    JSON.stringify(payload),
    section,
  ]);

// ── saving: update-then-insert, never a partial upsert ─────────────────────────────────────────
const first = (await save(INV, { first_name: "Susan" }, "identity")).rows[0].r;
ok("the first save inserts a draft", Boolean(first.draft_id));
ok("one draft exists for the invitation", (await count(`select count(*)::int as n from application_drafts`)) === 1);

const second = (await save(INV, { first_name: "Susan", last_name: "Godfrey" })).rows[0].r;
ok("the second save updates the same row", second.draft_id === first.draft_id);
ok(
  "and the later answers win — last write wins is what a draft means",
  (await one(`select payload from application_drafts where id = $1`, [first.draft_id])).payload.last_name === "Godfrey",
);
// A save that names no section must not un-reach the page the driver got to.
ok(
  "a save without a section keeps the furthest one already reached",
  (await one(`select furthest_section from application_drafts where id = $1`, [first.draft_id])).furthest_section ===
    "identity",
);
await save(INV, { first_name: "Susan" }, "employment");
ok(
  "and a save that names one moves it forward",
  (await one(`select furthest_section from application_drafts where id = $1`, [first.draft_id])).furthest_section ===
    "employment",
);

// One draft per link, at the schema level rather than by service discipline.
const dupe = await raised(() =>
  db.query(
    `insert into application_drafts (org_id, invitation_id, driver_id, payload) values ($1,$2,$3,'{}'::jsonb)`,
    [ORG, INV, DRIVER],
  ),
);
ok("a second draft for the same invitation is refused", dupe?.code === "23505", String(dupe?.code));

// ── the guard: 0213's style, and the whole argument for choosing it ────────────────────────────
// First lock: RLS. With deny-all and no UPDATE/DELETE policy, a browser session's statement matches
// ZERO ROWS AND SUCCEEDS — so what is asserted is that the row did not change, never that it threw
// (the 2026-08-19 lesson; a test that expects an exception here passes for the wrong reason).
await asRole("authenticated", `update application_drafts set payload = '{"first_name":"Someone"}'::jsonb`);
ok(
  "a browser session's update matches nothing — RLS deny-all",
  (await one(`select payload from application_drafts where id = $1`, [first.draft_id])).payload.first_name === "Susan",
);
await asRole("authenticated", `delete from application_drafts`);
ok(
  "and its delete matches nothing either",
  (await count(`select count(*)::int as n from application_drafts`)) === 1,
);

// Second lock: the guard itself. It can only be REACHED by a writer RLS lets through, so it is
// proved the way it would actually fire — a connection that bypasses RLS while carrying a user's
// JWT claims, which is what a service-role path acting for a signed-in person looks like, and what
// any future client policy would create. `auth_role()` is non-null there, and DA030 is the answer.
const withClaims = async (sql) => {
  await db.exec("begin");
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: USER, org_id: ORG, role: "authenticated", user_role: "recruiter" }),
    ]);
    await db.query(sql);
    await db.exec("rollback");
    return null;
  } catch (e) {
    await db.exec("rollback");
    return e;
  }
};
const guardedUpdate = await withClaims(`update application_drafts set payload = '{"x":1}'::jsonb`);
ok("the guard refuses an update made under a user's claims", guardedUpdate?.code === "DA030", String(guardedUpdate?.code));
const guardedDelete = await withClaims(`delete from application_drafts`);
ok("and a delete made under them", guardedDelete?.code === "DA030", String(guardedDelete?.code));

ok(
  "and reads nothing at all — RLS deny-all, no client policies",
  Number((await asRole("authenticated", `select count(*)::int as n from application_drafts`)).rows[0].n) === 0,
);
ok(
  "an anonymous caller reads nothing either",
  Number((await asRole("anon", `select count(*)::int as n from application_drafts`)).rows[0].n) === 0,
);

// THE PRUNABILITY PIN. This is the assertion the trigger style was chosen for: A11's retention rule
// runs as the service role, and the EI010/DA010 family — correct for evidence — would have refused
// it and made "prunable" structurally false.
const DOOMED = (
  await one(
    `insert into application_drafts (org_id, invitation_id, driver_id, payload)
       values ($1, $2, $3, '{"first_name":"Temp"}'::jsonb) returning id`,
    [ORG, await invite("doomed"), DRIVER],
  )
).id;
const serviceDelete = await raised(() => db.query(`delete from application_drafts where id = $1`, [DOOMED]));
ok("the service role CAN delete a draft — retention has to be able to", serviceDelete === null, String(serviceDelete?.code));
ok(
  "and it is gone",
  (await count(`select count(*)::int as n from application_drafts where id = $1`, [DOOMED])) === 0,
);
const serviceUpdate = await raised(() =>
  db.query(`update application_drafts set payload = '{"first_name":"Susan"}'::jsonb where id = $1`, [first.draft_id]),
);
ok("the service role can update one too — that is what autosave is", serviceUpdate === null);

// ── the cascade: revoking the link collects the draft, with no service code involved ───────────
const CASCADE_INV = await invite("cascade");
await save(CASCADE_INV, { first_name: "Gone" });
ok("a draft exists for the second invitation", (await count(`select count(*)::int as n from application_drafts where invitation_id = $1`, [CASCADE_INV])) === 1);
await db.query(`delete from application_invitations where id = $1`, [CASCADE_INV]);
ok(
  "deleting the invitation takes its draft with it",
  (await count(`select count(*)::int as n from application_drafts where invitation_id = $1`, [CASCADE_INV])) === 0,
);

// ── the table is not on the evidence side of the line ──────────────────────────────────────────
ok(
  "application_drafts has RLS on and no client policies",
  (await count(`select count(*)::int as n from pg_policies where tablename = 'application_drafts'`)) === 0 &&
    (await one(`select relrowsecurity from pg_class where relname = 'application_drafts'`)).relrowsecurity === true,
);
ok(
  "the save RPC is service_role only",
  (await count(
    `select count(*)::int as n from information_schema.role_routine_grants
      where routine_name = 'save_application_draft' and grantee in ('anon','authenticated','PUBLIC')`,
  )) === 0,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
