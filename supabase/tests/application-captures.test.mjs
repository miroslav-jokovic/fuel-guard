// FuelGuard — staged application captures matrix (migration 0230, APPLICATION-SYSTEM-PLAN A8 / D-APP10).
//
// `application_captures` is the second table in the recruiting schema built to be DELETED, and the
// first one whose whole purpose is to keep something OUT of the evidence tables. A driver
// photographing a licence in a truck-stop car park takes three attempts at it; `documents` is
// append-only and in RETENTION_FORBIDDEN, so three attempts filed there would be three rows in a
// §391.51 qualification file with no lawful way to remove two of them. And a candidate who fills in
// half an application and takes another job must leave nothing in an evidence bucket at all.
//
// So the properties proved here are the two halves of that:
//
//   · staging is REPLACEABLE — one row per slot, a re-shoot supersedes, the old object's path comes
//     back so the caller can collect it, and the service role can delete the row afterwards
//   · promotion is EXACTLY ONCE and only from a certified submission — one `documents` row per
//     staged capture, carrying the sha256 forward, filed under the capture's own id so a replay
//     cannot produce a second copy, and unable to file a capture belonging to another invitation
//
// Plus the usual pair for a table on the operational side of the line: a browser session cannot read
// or write it, and the cascade from the invitation is what actually collects an abandoned session.
//
// Applies EVERY migration, same as rls.test.mjs.
//
// Run:  node supabase/tests/application-captures.test.mjs
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
// than be filtered by policy — and "it threw" would look like "it was refused".
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

const invite = async (driverId, label, org = ORG) =>
  (
    await one(
      `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
         values ($1, $2, $3, now() + interval '14 days') returning id`,
      [org, driverId, `hash-${label}`],
    )
  ).id;

const INV = await invite(DRIVER, "susan");

const stage = async (invitation, slot, captureId, path, driverId = DRIVER, org = ORG) =>
  (
    await one(
      `select public.stage_application_capture($1,$2,$3,$4,$5,$6,'image/webp',240000,$7) as r`,
      [org, invitation, driverId, captureId, slot, path, "a1".repeat(32)],
    )
  ).r;

const newId = async () => (await one(`select gen_random_uuid() as id`)).id;

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

// ── staging: one row per slot, and a re-shoot replaces ─────────────────────────────────────────
const CAP1 = await newId();
const first = await stage(INV, "cdl_front", CAP1, `${ORG}/${INV}/${CAP1}.webp`);
ok("staging a photograph returns its id and its date", first.capture_id === CAP1 && Boolean(first.captured_at));
ok("nothing was superseded by the first one", first.replaced_path === null);
ok("one row exists", (await count(`select count(*)::int as n from application_captures`)) === 1);

const CAP2 = await newId();
const second = await stage(INV, "cdl_front", CAP2, `${ORG}/${INV}/${CAP2}.webp`);
ok(
  "a re-shoot replaces the slot rather than accumulating — the whole of D-APP10",
  (await count(`select count(*)::int as n from application_captures where invitation_id = $1`, [INV])) === 1,
);
ok(
  "and hands back the superseded object's path so the caller can collect the bytes",
  second.replaced_path === `${ORG}/${INV}/${CAP1}.webp`,
);
ok(
  "the row that survives is the later photograph",
  (await one(`select id from application_captures where invitation_id = $1`, [INV])).id === CAP2,
);

// A different slot is a different photograph, not a replacement.
const CAP3 = await newId();
await stage(INV, "medical_card", CAP3, `${ORG}/${INV}/${CAP3}.webp`);
ok("a different slot is a second row", (await count(`select count(*)::int as n from application_captures where invitation_id = $1`, [INV])) === 2);

const dupe = await raised(() =>
  db.query(
    `insert into application_captures (org_id, invitation_id, driver_id, slot, storage_path, content_type, sha256)
       values ($1,$2,$3,'cdl_front','p','image/webp','x')`,
    [ORG, INV, DRIVER],
  ),
);
ok("a second row for the same slot is refused at the schema level", dupe?.code === "23505", String(dupe?.code));

const badSlot = await raised(() =>
  db.query(
    `insert into application_captures (org_id, invitation_id, driver_id, slot, storage_path, content_type, sha256)
       values ($1,$2,$3,'hazmat_training','p','image/webp','x')`,
    [ORG, INV, DRIVER],
  ),
);
ok(
  "and the carrier's filing vocabulary is not the applicant's — an unknown slot is refused",
  badSlot?.code === "23514",
  String(badSlot?.code),
);

// ── the guard and RLS: operational, and invisible to every browser session ─────────────────────
// With deny-all and no UPDATE/DELETE policy a client's statement matches ZERO ROWS AND SUCCEEDS, so
// what is asserted is that nothing changed — never that it threw (the 2026-08-19 lesson).
await asRole("authenticated", `update application_captures set sha256 = 'tampered'`);
ok(
  "a browser session's update matches nothing — RLS deny-all",
  (await count(`select count(*)::int as n from application_captures where sha256 = 'tampered'`)) === 0,
);
await asRole("authenticated", `delete from application_captures`);
ok("and its delete matches nothing either", (await count(`select count(*)::int as n from application_captures`)) === 2);
ok(
  "and it reads nothing at all — no client policies",
  Number((await asRole("authenticated", `select count(*)::int as n from application_captures`)).rows[0].n) === 0,
);
ok(
  "an anonymous caller reads nothing either",
  Number((await asRole("anon", `select count(*)::int as n from application_captures`)).rows[0].n) === 0,
);

// The guard can only be REACHED by a writer RLS lets through, so it is proved the way it would
// actually fire: a connection that bypasses RLS while carrying a user's JWT claims.
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
ok(
  "the guard refuses an update made under a user's claims",
  (await withClaims(`update application_captures set sha256 = 'x'`))?.code === "DA040",
);
ok("and a delete made under them", (await withClaims(`delete from application_captures`))?.code === "DA040");

// THE PRUNABILITY PIN — the assertion the 0213-style trigger was chosen for. A11's retention rule
// runs as the service role, and the EI010/DA010 family would have refused it.
const serviceDelete = await raised(() => db.query(`delete from application_captures where id = $1`, [CAP3]));
ok("the service role CAN delete a staged capture — retention has to be able to", serviceDelete === null, String(serviceDelete?.code));
await stage(INV, "medical_card", CAP3, `${ORG}/${INV}/${CAP3}.webp`);

// ── the cascade: an abandoned session collects itself ──────────────────────────────────────────
const GONE_DRIVER = await driver("Walked Away");
const GONE = await invite(GONE_DRIVER, "abandoned");
await stage(GONE, "cdl_front", await newId(), `${ORG}/${GONE}/x.webp`, GONE_DRIVER);
ok("a staged capture exists for the abandoned session", (await count(`select count(*)::int as n from application_captures where invitation_id = $1`, [GONE])) === 1);
await db.query(`delete from application_invitations where id = $1`, [GONE]);
ok(
  "deleting the invitation takes its staged photographs with it, with no service code involved",
  (await count(`select count(*)::int as n from application_captures where invitation_id = $1`, [GONE])) === 0,
);
ok(
  "and it left NO documents row — an abandoned application is not evidence of anything",
  (await count(`select count(*)::int as n from documents where subject_id = $1`, [GONE_DRIVER])) === 0,
);

// ── promotion: the certified application is what makes a photograph evidence ───────────────────
const PAYLOAD = JSON.stringify({ first_name: "Susan", last_name: "Godfrey", certified: true });
const PATCH = JSON.stringify({ first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01" });

const submit = (invitation, driverId, captures) =>
  db.query(
    `select public.submit_driver_application(
       $1,$2,$3,$4::jsonb,'Susan Godfrey','203.0.113.9','UA','6789',null,$5::jsonb,'[]'::jsonb,$6::jsonb) as r`,
    [ORG, invitation, driverId, PAYLOAD, PATCH, JSON.stringify(captures)],
  );

/** What the API passes: the slot vocabulary resolved to kinds and pages in TypeScript. */
const promotion = (captureId, kind, page, driverId = DRIVER) => ({
  capture_id: captureId,
  kind,
  page,
  storage_path: `${ORG}/driver/${driverId}/${captureId}.webp`,
});

await submit(INV, DRIVER, [promotion(CAP2, "cdl", 1), promotion(CAP3, "medical_card", 1)]);

const filed = (await db.query(
  `select id, kind, page, sha256, content_type, storage_path, uploaded_by, variant
     from documents where subject_id = $1 order by kind, page`,
  [DRIVER],
)).rows;
ok("submitting files exactly one document per staged capture", filed.length === 2, `got ${filed.length}`);
ok(
  "the filed document IS the staged capture, by id — which is what makes promotion exactly-once",
  filed.some((d) => d.id === CAP2) && filed.some((d) => d.id === CAP3),
);
ok(
  "the sha256 the browser computed is carried forward unchanged",
  filed.every((d) => d.sha256 === "a1".repeat(32)),
);
ok(
  "the licence lands in the evidence bucket's own path, not the staging one",
  filed.every((d) => d.storage_path.startsWith(`${ORG}/driver/${DRIVER}/`)),
);
ok(
  "nobody in the carrier is recorded as having uploaded it — the applicant did",
  filed.every((d) => d.uploaded_by === null),
);
ok("and each is an original, not a derivative", filed.every((d) => d.variant === "original"));

// The staged rows stay: deleting inside the transaction could not be rolled back, and A11's
// retention rule is what collects them.
ok(
  "the staged rows survive the submission, for the retention rule to collect",
  (await count(`select count(*)::int as n from application_captures where invitation_id = $1`, [INV])) === 2,
);

// A replayed submit is refused by the phase stamp, so it cannot file a second copy of a licence.
const replay = await raised(() => submit(INV, DRIVER, [promotion(CAP2, "cdl", 1)]));
ok("a replayed submission is refused", replay?.code === "DA022", String(replay?.code));
ok(
  "and files nothing — the whole transaction rolls back, documents included",
  (await count(`select count(*)::int as n from documents where subject_id = $1`, [DRIVER])) === 2,
);

// ── the JOIN is what stops the caller's array filing anything it likes ─────────────────────────
const MALLORY = await driver("Mallory", OTHER_ORG);
const OTHER_INV = await invite(MALLORY, "mallory", OTHER_ORG);
const OTHER_CAP = await newId();
await stage(OTHER_INV, "cdl_front", OTHER_CAP, `${OTHER_ORG}/${OTHER_INV}/${OTHER_CAP}.webp`, MALLORY, OTHER_ORG);

const VICTIM = await driver("Second Applicant");
const INV2 = await invite(VICTIM, "second");
// An array naming a capture from ANOTHER org's invitation, submitted through this one.
await submit(INV2, VICTIM, [promotion(OTHER_CAP, "cdl", 1, VICTIM)]);
ok(
  "a promotion naming a capture from another invitation files nothing",
  (await count(`select count(*)::int as n from documents where subject_id = $1`, [VICTIM])) === 0,
);
ok(
  "and the other org's staged capture is untouched",
  (await count(`select count(*)::int as n from application_captures where id = $1`, [OTHER_CAP])) === 1,
);

// ── the shape of the table and its bucket ──────────────────────────────────────────────────────
ok(
  "application_captures has RLS on and no client policies",
  (await count(`select count(*)::int as n from pg_policies where tablename = 'application_captures'`)) === 0 &&
    (await one(`select relrowsecurity from pg_class where relname = 'application_captures'`)).relrowsecurity === true,
);
ok(
  "the staging RPC is service_role only",
  (await count(
    `select count(*)::int as n from information_schema.role_routine_grants
      where routine_name = 'stage_application_capture' and grantee in ('anon','authenticated','PUBLIC')`,
  )) === 0,
);
ok(
  "the widened intake function is service_role only too, after being dropped and recreated",
  (await count(
    `select count(*)::int as n from information_schema.role_routine_grants
      where routine_name = 'submit_driver_application' and grantee in ('anon','authenticated','PUBLIC')`,
  )) === 0,
);
// ⚠ One function, not two. `create or replace` with an extra parameter would have left the old
// eleven-argument overload standing, and an eleven-argument call would then match both and fail as
// ambiguous. 0230 drops it explicitly; this is the assertion that it did.
ok(
  "there is exactly ONE submit_driver_application — the old signature was dropped, not shadowed",
  (await count(
    `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'submit_driver_application'`,
  )) === 1,
);
const bucket = await one(`select public, file_size_limit from storage.buckets where id = 'application-captures'`);
ok("the staging bucket is private", bucket && bucket.public === false);
ok("and capped well below what a leaked link could store", Number(bucket.file_size_limit) === 8 * 1024 * 1024);
ok(
  "it carries no client write policy at all — every upload is a signed URL the API minted",
  (await count(
    `select count(*)::int as n from pg_policies
      where tablename = 'objects' and qual like '%application-captures%' or with_check like '%application-captures%'`,
  )) === 0,
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
