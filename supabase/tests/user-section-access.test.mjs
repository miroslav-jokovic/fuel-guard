// Silvicom 360 — user_section_access and the claim it mints (0299).
//
// D-PERM4/D-PERM7/D-PERM8/D-SURF7, docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md step S5.
//
// ⚠ **This matrix is not optional coverage — it is S5's only test of the read path.** The whole read
// path is `custom_access_token_hook`, which is SQL, and only a real Postgres can run it. The API
// test beside it (`sectionAccess.test.ts`) proves the WRITE and nothing else; if this file were
// deleted, the merge of a person's answers over their role's would be unproven in every layer.
//
// The sibling of `org-section-access.test.mjs`, which proves the same things for the ROLE layer. The
// four properties below are the ones that would each be silently wrong in a different way:
//
//  1. **The merge direction.** A person's answer beats their role's, and neither is complete. Merged
//     the other way round the feature looks like it works right up until an org has answered for
//     both, which is exactly when somebody is relying on it.
//  2. **`jsonb_object_agg` over an empty set is NULL, not `{}`.** So `role_answers || user_answers`
//     is NULL whenever either half is absent, and a NULL written into `{sections}` would ERASE the
//     org's answer rather than leave it alone. Both one-sided cases are asserted, because the naive
//     merge passes the two-sided one.
//  3. **A token that mints nothing new.** An org that has never opened the permissions page must get
//     byte-for-byte the token it got before this migration, or applying it to a live project changes
//     somebody's access without anyone asking for it.
//  4. **The locks hold at the mint.** This function is the last place that can decline to honour a
//     row for the `admin` section or for a member holding `admin`/`driver`, and the only place whose
//     failure hands out access rather than merely storing something wrong (0292's header).
//
// It also carries the measurement Q-SURF4 asked for: the size of the claim when every editable
// section is overridden for one person, printed rather than asserted, because the number belongs in
// the plan and a threshold nobody has agreed is not an assertion.
//
// ⚠ The JWT subject must exist in auth.users, for the reason saved-views.test.mjs records — and here
// doubly so: the composite FK to `memberships` means an unmodelled member fails every insert.
//
// Run:  node supabase/tests/user-section-access.test.mjs
//
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
// Supabase's real default privileges, installed BEFORE the migrations run — full DML granted so that
// RLS is provably the only gate. Without this block a passing test proves nothing: the write would be
// refused by a missing GRANT rather than by the policy under test.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// ── The cast ────────────────────────────────────────────────────────────────────
// Four members of one org. Every difference between them is a row in one of the two override tables
// and nothing else, so any difference in their claims is attributable.
const NARROWED = "00000000-0000-4000-8000-000000000001"; // dispatcher, answered for at BOTH layers
const ROLE_ONLY = "00000000-0000-4000-8000-000000000002"; // dispatcher, only the role is answered for
const USER_ONLY = "00000000-0000-4000-8000-000000000003"; // recruiter, only the person is answered for
const UNTOUCHED = "00000000-0000-4000-8000-000000000004"; // fleet_manager, nobody has answered for
const BOSS = "00000000-0000-4000-8000-000000000005"; // admin — locked by D-PERM7
const HAULER = "00000000-0000-4000-8000-000000000006"; // driver — locked by D-PERM8
const OUTSIDER = "00000000-0000-4000-8000-000000000007";
await db.query(
  `insert into auth.users (id, email) values
     ($1,'narrowed@x.com'), ($2,'roleonly@x.com'), ($3,'useronly@x.com'), ($4,'untouched@x.com'),
     ($5,'boss@x.com'), ($6,'hauler@x.com'), ($7,'outsider@x.com')`,
  [NARROWED, ROLE_ONLY, USER_ONLY, UNTOUCHED, BOSS, HAULER, OUTSIDER],
);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'U') returning id`)).id;

const member = (org, user, role) =>
  db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,$3::user_role)`, [org, user, role]);
await member(ORG, NARROWED, "dispatcher");
await member(ORG, ROLE_ONLY, "dispatcher");
await member(ORG, USER_ONLY, "recruiter");
await member(ORG, UNTOUCHED, "fleet_manager");
await member(ORG, BOSS, "admin");
await member(ORG, HAULER, "driver");
await member(OTHER_ORG, OUTSIDER, "dispatcher");

/** Run one statement as `user` in `org`, holding `role`. */
async function asUser(user, org, role, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user, org_id: org, user_role: role, role: "authenticated" }),
    ]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return res;
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}

/**
 * Compare two objects by CONTENT, not by key order. `jsonb` normalises key order (shortest key
 * first, then bytewise), so a `JSON.stringify` comparison against a hand-written literal fails on
 * three correct claims — which reads as a broken merge and is not one.
 */
const same = (a, b) =>
  a != null &&
  b != null &&
  Object.keys(a).length === Object.keys(b).length &&
  Object.keys(b).every((k) => a[k] === b[k]);

const claimsFor = async (userId) =>
  (
    await one(
      `select public.custom_access_token_hook(jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb)) as e`,
      [userId],
    )
  ).e.claims;

// ── Seeded with the service role, standing in for the API's own writes ──────────
const ROLE_SET = `insert into org_section_access (org_id, role, section, access, updated_by) values ($1,$2,$3,$4,$5)`;
const USER_SET = `insert into user_section_access (org_id, user_id, section, access, updated_by) values ($1,$2,$3,$4,$5)`;

// The org narrows every dispatcher on two sections…
await db.query(ROLE_SET, [ORG, "dispatcher", "safety", "view", BOSS]);
await db.query(ROLE_SET, [ORG, "dispatcher", "fuel", "none", BOSS]);
// …then answers differently for ONE of them: safety back to manage, and roster taken away entirely.
await db.query(USER_SET, [ORG, NARROWED, "safety", "manage", BOSS]);
await db.query(USER_SET, [ORG, NARROWED, "roster", "none", BOSS]);
// A person whose ROLE has no overrides at all, so only the user half is present.
await db.query(USER_SET, [ORG, USER_ONLY, "recruitment", "view", BOSS]);
await db.query(USER_SET, [OTHER_ORG, OUTSIDER, "safety", "none", null]);

// ══════════════════════════════════════════════════════════════════════════════
// The claim — where a row becomes authority.
// ══════════════════════════════════════════════════════════════════════════════
const narrowed = await claimsFor(NARROWED);
ok(
  "a person's answer beats their role's, and the role's other answers survive",
  same(narrowed.sections, { fuel: "none", safety: "manage", roster: "none" }),
  JSON.stringify(narrowed.sections),
);
ok(
  "…while another member of the SAME role keeps the role's answer untouched",
  same((await claimsFor(ROLE_ONLY)).sections, { safety: "view", fuel: "none" }),
  JSON.stringify((await claimsFor(ROLE_ONLY)).sections),
);

// ⚠ The two one-sided cases. `jsonb_object_agg` over an empty set returns NULL, and `x || null` is
// NULL — so a merge written the obvious way erases the half that IS present. Each of these fails on
// its own if that guard is removed, and the two-sided case above passes either way.
ok(
  "a person answered for, whose role is not, carries THEIR answer rather than nothing",
  same((await claimsFor(USER_ONLY)).sections, { recruitment: "view" }),
  JSON.stringify((await claimsFor(USER_ONLY)).sections),
);
ok(
  "a role answered for, with no per-person row, is unchanged by this migration",
  same((await claimsFor(ROLE_ONLY)).sections, { safety: "view", fuel: "none" }),
);
ok(
  "a member nobody has answered for carries no sections claim at all — the token is byte-identical to today's",
  (await claimsFor(UNTOUCHED)).sections === undefined && (await claimsFor(UNTOUCHED)).user_role === "fleet_manager",
);

// ── The locks, at the one place whose failure is an escalation ──────────────────
await db.query(USER_SET, [ORG, BOSS, "fuel", "none", BOSS]);
await db.query(USER_SET, [ORG, HAULER, "dispatch", "manage", BOSS]);
ok(
  "an ADMIN's per-person rows are never honoured — the role keeps everything (D-PERM7)",
  (await claimsFor(BOSS)).sections === undefined,
  JSON.stringify((await claimsFor(BOSS)).sections),
);
ok(
  "a DRIVER's are not either (D-PERM8)",
  (await claimsFor(HAULER)).sections === undefined,
  JSON.stringify((await claimsFor(HAULER)).sections),
);
/**
 * ⚠ The hook's own `and section <> 'admin'` is UNREACHABLE while the CHECK constraint stands, so
 * asserting it needs a row the product cannot write. That row is exactly what 0292's header says the
 * guard is for — "a restore, a support action, a future writer" — so it is modelled by dropping the
 * constraint, writing the row the schema forbids, and putting the constraint back. Without this the
 * guard would be a line nothing exercises, and the next person to tidy it away would see every test
 * still green.
 */
ok(
  "a row for the ADMIN section that should not exist is still refused a claim, at the mint (D-PERM7)",
  await (async () => {
    const def = (
      await one(
        `select pg_get_constraintdef(oid) as d from pg_constraint
          where conrelid = 'public.user_section_access'::regclass and conname like '%section_check'`,
      )
    ).d;
    await db.exec(`alter table user_section_access drop constraint user_section_access_section_check`);
    await db.query(USER_SET, [ORG, ROLE_ONLY, "admin", "manage", BOSS]);
    const claims = await claimsFor(ROLE_ONLY);
    await db.query(`delete from user_section_access where user_id = $1 and section = 'admin'`, [ROLE_ONLY]);
    await db.exec(`alter table user_section_access add constraint user_section_access_section_check ${def}`);
    return claims.sections?.admin === undefined;
  })(),
);

ok(
  "the ADMIN SECTION cannot even be stored, so it can never reach a claim (D-PERM7)",
  await (async () => {
    try {
      await db.query(USER_SET, [ORG, NARROWED, "admin", "manage", BOSS]);
      return false;
    } catch {
      return true;
    }
  })(),
);
ok(
  "…and neither can a section that is not in the vocabulary at all",
  await (async () => {
    try {
      await db.query(USER_SET, [ORG, NARROWED, "not_a_section", "view", BOSS]);
      return false;
    } catch {
      return true;
    }
  })(),
);
ok(
  "an access level outside none/view/manage is refused",
  await (async () => {
    try {
      await db.query(USER_SET, [ORG, NARROWED, "billing", "owner", BOSS]);
      return false;
    } catch {
      return true;
    }
  })(),
);

// ── The claim is what auth_section() reads, which is what P4's policies branch on ─
// Asserted through the real reader rather than by inspecting the jsonb, because a claim the wrappers
// cannot read would be a claim that changes nothing — and 0292's own near-miss was in this function.
const asClaims = async (claims, sql) => {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const res = await db.query(sql);
    await db.exec("rollback");
    return res.rows[0];
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
};
ok(
  "auth_section reads the merged answer the hook minted, not the role's",
  (await asClaims({ ...narrowed, role: "authenticated" }, `select auth_section('safety') as v`)).v === "manage",
);
ok(
  "…and auth_section_manage agrees",
  (await asClaims({ ...narrowed, role: "authenticated" }, `select auth_section_manage('safety') as v`)).v === true,
);
ok(
  "a section neither layer answered for is still NULL, so its policy takes the default role list",
  (await asClaims({ ...narrowed, role: "authenticated" }, `select auth_section('billing') as v`)).v === null,
);

// ══════════════════════════════════════════════════════════════════════════════
// Storage, isolation, and the shape that makes "absence is not denial" possible.
// ══════════════════════════════════════════════════════════════════════════════
const countAs = async (user, org, role) => {
  const res = await asUser(user, org, role, "select count(*)::int as n from user_section_access");
  return res.error ? `ERROR: ${res.error}` : Number(res.rows[0].n);
};
const refusedAs = async (user, org, role, sql, params = []) => {
  const res = await asUser(user, org, role, sql, params);
  return typeof res.error === "string" && /row-level security/i.test(res.error);
};

ok("a member reads their own org's per-person overrides", (await countAs(NARROWED, ORG, "dispatcher")) === 5);
ok(
  "an outsider sees only their own org's row, never this org's",
  (await countAs(OUTSIDER, OTHER_ORG, "dispatcher")) === 1,
);
ok(
  "…and a caller with no org claim at all sees nothing",
  (await countAs(OUTSIDER, "00000000-0000-4000-8000-0000000000ff", "dispatcher")) === 0,
);

// No client writes this table, whatever role they hold. The dangerous version is an ADMIN doing it
// directly: it would look like the feature working while bypassing the audit row that makes a
// permission change reviewable — and this table is the DATA boundary, not the menu.
const INSERT = `insert into user_section_access (org_id, user_id, section, access) values ($1,$2,'billing','manage')`;
ok(
  "an admin cannot INSERT a per-person override through PostgREST",
  await refusedAs(BOSS, ORG, "admin", INSERT, [ORG, ROLE_ONLY]),
);
ok(
  "…nor can the member it is about grant themselves one",
  await refusedAs(NARROWED, ORG, "dispatcher", INSERT, [ORG, NARROWED]),
);
ok(
  "an admin cannot UPDATE one either",
  (await asUser(BOSS, ORG, "admin", `update user_section_access set access = 'manage'`)).affectedRows === 0,
);
ok("…nor DELETE one", (await asUser(BOSS, ORG, "admin", `delete from user_section_access`)).affectedRows === 0);

ok(
  "one row per (org, user, section) — a second is refused by the primary key",
  await (async () => {
    try {
      await db.query(USER_SET, [ORG, NARROWED, "safety", "view", BOSS]);
      return false;
    } catch {
      return true;
    }
  })(),
);
ok(
  "an override cannot name somebody who is not a member of that org",
  await (async () => {
    try {
      await db.query(USER_SET, [ORG, OUTSIDER, "safety", "none", BOSS]);
      return false;
    } catch {
      return true;
    }
  })(),
);
ok(
  "removing the member takes their overrides with them",
  await (async () => {
    const LEAVER = "00000000-0000-4000-8000-00000000000e";
    await db.query(`insert into auth.users (id,email) values ($1,'leaver@x.com')`, [LEAVER]);
    await member(ORG, LEAVER, "accountant");
    await db.query(USER_SET, [ORG, LEAVER, "billing", "none", BOSS]);
    await db.query(`delete from memberships where org_id = $1 and user_id = $2`, [ORG, LEAVER]);
    return (await one(`select count(*)::int as n from user_section_access where user_id = $1`, [LEAVER])).n === 0;
  })(),
);

// ⚠ The subject here is a member of BOTH orgs on purpose. Written the obvious way this assertion
// passes with the trigger DROPPED, because the composite membership FK refuses the update instead —
// the same trap the S4 matrix hit, kept from recurring by construction rather than by memory.
const DUAL = "00000000-0000-4000-8000-00000000d0a1";
await db.query(`insert into auth.users (id,email) values ($1,'dual@x.com')`, [DUAL]);
await member(ORG, DUAL, "auditor");
await member(OTHER_ORG, DUAL, "auditor");
await db.query(USER_SET, [ORG, DUAL, "billing", "view", BOSS]);
ok(
  "the org_id of an existing row is immutable, refused by the trigger rather than by a foreign key",
  await (async () => {
    try {
      await db.query(`update user_section_access set org_id = $1 where org_id = $2 and user_id = $3`, [
        OTHER_ORG,
        ORG,
        DUAL,
      ]);
      return false;
    } catch (e) {
      return /org_id is immutable/.test(e.message);
    }
  })(),
);

// ══════════════════════════════════════════════════════════════════════════════
// Q-SURF4 — the measurement the plan asked for, rather than a guess.
// ══════════════════════════════════════════════════════════════════════════════
// A per-user section override enters the JWT (D-SURF7), so the worst case is one person answered for
// on EVERY editable section. Measured, not bounded: the number goes into the plan, and a threshold
// nobody has agreed would be a failing test with no owner.
const MAXED = "00000000-0000-4000-8000-00000000ffff";
await db.query(`insert into auth.users (id,email) values ($1,'maxed@x.com')`, [MAXED]);
await member(ORG, MAXED, "safety_manager");
for (const s of [
  "fuel",
  "dispatch",
  "safety",
  "hazmat",
  "roster",
  "equipment",
  "recruitment",
  "settings",
  "accounting",
  "billing",
  "maintenance",
])
  await db.query(USER_SET, [ORG, MAXED, s, "manage", BOSS]);
const maxed = await claimsFor(MAXED);
const claimBytes = JSON.stringify(maxed.sections).length;
ok("every editable section can be answered for one person", Object.keys(maxed.sections).length === 11);
console.log(
  `\n[Q-SURF4] worst-case sections claim: ${claimBytes} bytes of JSON across 11 sections ` +
    `(~${Math.ceil((claimBytes * 4) / 3)} bytes base64url in the JWT payload, before the rest of the claims).`,
);

// Release the WASM database before the verdict. This matrix exits explicitly only when it FAILS, so
// on the green path Node had to drain PGlite's handles on its own — ~10 seconds of idle wait after
// the last assertion, paid once per matrix per run. Measured 2026-09-05: 11.33s -> 1.32s here.
await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
