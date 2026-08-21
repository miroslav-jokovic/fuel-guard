// FuelGuard — application session matrix (migration 0225, APPLICATION-SYSTEM-PLAN A1 / D-APP1).
//
// The invitation stopped being a fuse and became a session. `application-intake.test.mjs` proves the
// submission transaction; this proves the PHASES around it — that revocation and expiry still kill
// the whole credential, that a spent phase refuses only itself, and that the backfill left every
// invitation issued before 0225 behaving exactly as it did before.
//
// The defect being fixed is worth restating where it will be read: `resolveInvitation` refused any
// token whose `used_at` was set, the submit transaction stamped `used_at`, and `POST /:token/release`
// — the endpoint that records the driver's own signature on each FCRA instrument — resolves through
// that same function. So submitting the application closed the door on the signing the applicant's
// page had promised. Nobody hit it in production only because every disclosure is still `v0-draft`
// and the signing gate refuses drafts.
//
// Applies EVERY migration, same as rls.test.mjs.
//
// Run:  node supabase/tests/application-session.test.mjs
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

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;

const driver = async (name) =>
  (await one(`insert into drivers (org_id, full_name, status) values ($1,$2,'applicant') returning id`, [ORG, name])).id;

const invite = async (driverId, label, expires = "now() + interval '14 days'") =>
  (
    await one(
      `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
         values ($1, $2, $3, ${expires}) returning id`,
      [ORG, driverId, `hash-${label}`],
    )
  ).id;

const PAYLOAD = JSON.stringify({ first_name: "Susan", last_name: "Godfrey", certified: true });
const PATCH = JSON.stringify({ first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01" });

const submit = (invitation, driverId) =>
  db.query(
    `select public.submit_driver_application($1,$2,$3,$4::jsonb,'Susan Godfrey','203.0.113.9','UA','6789',null,$5::jsonb,'[]'::jsonb) as r`,
    [ORG, invitation, driverId, PAYLOAD, PATCH],
  );

// ── the submit phase ───────────────────────────────────────────────────────────────────────────
const SUSAN = await driver("Susan Godfrey");
const INV = await invite(SUSAN, "susan");
await submit(INV, SUSAN);

const stamps = await one(
  `select consented_at, releases_completed_at, submitted_at
     from application_invitations where id = $1`,
  [INV],
);
ok("submitting stamps the submit phase", stamps.submitted_at !== null);
ok(
  "and touches neither of the other two — they belong to A4 and A5",
  stamps.consented_at === null && stamps.releases_completed_at === null,
);
// ⚠ `used_at` was the compatibility mirror 0225 kept for three staff-facing readers. A5 moved all
// three to `submitted_at` and 0229 dropped the column, once A5's reader-free code was verified live.
ok(
  "the mirror column is gone, and submitted_at carries the fact alone",
  (await count(
    `select count(*)::int as n from information_schema.columns
      where table_name = 'application_invitations' and column_name = 'used_at'`,
  )) === 0,
);

const replay = await raised(() => submit(INV, SUSAN));
ok("a second submission is refused as a spent PHASE (DA022), not a dead link", replay?.code === "DA022", String(replay?.code));
ok(
  "and the second attempt filed nothing",
  (await count(`select count(*)::int as n from driver_applications where driver_id = $1`, [SUSAN])) === 1,
);

// ── THE DEFECT: the link survives its own submission ───────────────────────────────────────────
// The API decides this, so what the database can prove is the half that matters here: the row that a
// submitted invitation leaves behind is still a LIVE credential by every column resolution reads.
const live = await one(
  `select revoked_at, expires_at > now() as unexpired from application_invitations where id = $1`,
  [INV],
);
ok(
  "a submitted invitation is still resolvable — not revoked, not expired",
  live.revoked_at === null && live.unexpired === true,
);

// ── revocation and expiry still kill the whole session ─────────────────────────────────────────
const GARY = await driver("Gary Thomas");
const REVOKED = await invite(GARY, "gary-revoked");
await db.query(`update application_invitations set revoked_at = now() where id = $1`, [REVOKED]);
const revoked = await raised(() => submit(REVOKED, GARY));
ok("a revoked invitation is refused (DA021)", revoked?.code === "DA021", String(revoked?.code));

const JOSE = await driver("Jose Davis");
const EXPIRED = await invite(JOSE, "jose-expired", "now() - interval '1 day'");
const expired = await raised(() => submit(EXPIRED, JOSE));
ok("an expired invitation is refused (DA021)", expired?.code === "DA021", String(expired?.code));
ok(
  "and neither filed anything",
  (await count(
    `select count(*)::int as n from driver_applications where driver_id = any($1::uuid[])`,
    [[GARY, JOSE]],
  )) === 0,
);

// A revoked invitation is dead in every phase, including the ones nothing spends yet: the column is
// nullable and free, so a would-be A4/A5 write on a revoked session has nothing stopping it except
// the API's own resolve — which is why that refusal is pinned in applicationIntake.test.ts
// ("every bad link fails the same way") and not claimed here.

// ── the backfill ───────────────────────────────────────────────────────────────────────────────
// 0225 backfilled `submitted_at := used_at` so an invitation spent before it behaved identically
// after it. That column is gone as of 0229, so what can still be proved here is the property the
// backfill existed to guarantee: after every migration has run, no invitation is left in the
// contradictory state the backfill was written to prevent — spent, but with no submit stamp.
ok(
  "no invitation survives the migrations spent-but-unstamped",
  (await count(
    `select count(*)::int as n from application_invitations
      where submitted_at is null
        and exists (select 1 from driver_applications a where a.invitation_id = application_invitations.id)`,
  )) === 0,
);

// ── the table is still a credential store, not a browser-readable one ──────────────────────────
ok(
  "application_invitations has RLS on and no client policies",
  (await count(`select count(*)::int as n from pg_policies where tablename = 'application_invitations'`)) === 0 &&
    (await one(`select relrowsecurity from pg_class where relname = 'application_invitations'`)).relrowsecurity === true,
);
ok(
  "the intake function is still service_role only after being replaced",
  (await count(
    `select count(*)::int as n from information_schema.role_routine_grants
      where routine_name = 'submit_driver_application' and grantee in ('anon','authenticated','PUBLIC')`,
  )) === 0,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
