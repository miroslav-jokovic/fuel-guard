// Silvicom 360 — samsara_feed_cursors matrix (migration 0288, SAM-S2 / D-SAM4).
//
// A cursor is the ONLY thing standing between "we poll often" and "we lost nothing". Every guarantee
// the delta feed is supposed to add — completeness by construction (SAMSARA-COLLECTION-PLAN §1.3), a
// stall that is loud rather than silent (§1.1), a per-feed staleness figure S5 can threshold (D-SAM6)
// — is a property of THIS ROW surviving and moving. Four ways it fails quietly, each destroying a
// different one:
//
//   1. A CLIENT CAN TOUCH IT. RLS is enabled with no policy, which is deny-all on purpose. A browser
//      that could WRITE a cursor could skip a window of the carrier's telematics on purpose, and one
//      that could READ it learns nothing an operator wants — staleness is a server-computed figure,
//      not an opaque vendor string. This is the sabotage version of the very bug S2 exists to fix.
//   2. TWO CURSORS FOR ONE FEED. The primary key is (org_id, feed). A second row is not a duplicate,
//      it is an ambiguity: two answers to "where did we get to", and whichever the reader happens to
//      pick decides how much history gets silently skipped.
//   3. `updated_at` DOES NOT MOVE. S5 reads it as "last cursor advance". A column that does not
//      advance on write reports a STALLED feed as fresh — the monitoring equivalent of the silent
//      snapshot loss, arriving with the alarm already disarmed.
//   4. IT GETS FROZEN. This table is operational, deliberately NOT evidence: it records where we are,
//      never what happened. A future append-only sweep that treats it like fuel_recon_runs would make
//      the cursor unadvanceable and stop the collector dead. That it stays writable is a DECISION and
//      is asserted here so a later hardening pass has to argue with a failing test.
//
// Run:  node supabase/tests/samsara-feed-cursors.test.mjs
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
  create table storage.buckets (
    id text primary key, name text, public boolean default false, file_size_limit bigint,
    allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text)
  returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);
// Supabase's real default privileges, installed BEFORE the migrations — full DML granted, RLS is the
// gate. Without this a client "cannot insert" for the wrong reason and the test proves nothing.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;
const USER = (await one(`insert into auth.users (email) values ('ops@silvicom.test') returning id`)).id;

// A real endCursor is a long opaque base64-ish token. Nothing here ever parses one; these only have to
// be distinguishable from each other.
const C1 = "b3ZlcmxhbmQ6MTc1NjcyMDAwMA==";
const C2 = "b3ZlcmxhbmQ6MTc1NjcyMTIwMA==";

const seed = (org, feed, cur) =>
  sqlstate(`insert into samsara_feed_cursors (org_id, feed, end_cursor) values ($1,$2,$3)`, [org, feed, cur]);

ok("the stats feed's cursor can be seeded", (await seed(ORG, "vehicle_stats", C1)) === null);

// ── 1. one cursor per (org, feed) ───────────────────────────────────────────────────────────────
ok(
  "a second cursor for the same feed is rejected — two answers to 'where did we get to' is not a duplicate, it is an ambiguity",
  (await seed(ORG, "vehicle_stats", C2)) === "23505",
);
ok(
  "another carrier's stats cursor is a different row entirely — the feed is per-tenant",
  (await seed(OTHER, "vehicle_stats", C1)) === null,
);
ok(
  "and one carrier may hold cursors for several feeds, which is what S5's per-feed staleness reads",
  (await seed(ORG, "hos_logs", C2)) === null,
);

// ── 2. a cursor is a value Samsara minted, or it is not stored ──────────────────────────────────
// A blank string is not a cursor. The reader treats "no cursor" as "seed from the feed's head", so an
// empty one would quietly restart the feed rather than resume it — recoverable, but it would look
// exactly like a healthy cursor to anything reading the row.
ok("an empty cursor is refused", (await seed(ORG, "blank_feed", "")) === "23514");
ok("as is a whitespace one", (await seed(ORG, "blank_feed", "   ")) === "23514");
ok("and a feed with no name", (await seed(ORG, "", C1)) === "23514");

// ── 3. the cursor advances, and says when ───────────────────────────────────────────────────────
const before = (await one(`select end_cursor, updated_at from samsara_feed_cursors where org_id=$1 and feed='vehicle_stats'`, [ORG]));
await db.query(`select pg_sleep(0.01)`);
ok(
  "advancing the cursor is an ordinary update — this table is operational, not evidence, and a frozen cursor stops the collector dead",
  (await sqlstate(`update samsara_feed_cursors set end_cursor=$1 where org_id=$2 and feed='vehicle_stats'`, [C2, ORG])) === null,
);
const after = (await one(`select end_cursor, updated_at from samsara_feed_cursors where org_id=$1 and feed='vehicle_stats'`, [ORG]));
ok("the new cursor is what is stored", after.end_cursor === C2 && before.end_cursor === C1);
ok(
  "and updated_at moved — S5 reads this as 'last cursor advance', so a column that does not move reports a stalled feed as fresh",
  new Date(after.updated_at).getTime() > new Date(before.updated_at).getTime(),
);

// A re-seed after losing the row costs one wide fetch and no history. That it is DELETABLE is the
// counterpoint to fuel_recon_runs and is deliberate — see the header.
ok(
  "a cursor can be dropped and re-seeded — losing one costs a re-read, never a fact",
  (await sqlstate(`delete from samsara_feed_cursors where org_id=$1 and feed='hos_logs'`, [ORG])) === null,
);

// ── 4. no client path at all, in either direction ───────────────────────────────────────────────
async function asClient(org, role, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: USER, org_id: org, user_role: role, role: "authenticated" }),
    ]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return { rows: res.rows, error: null };
  } catch (e) {
    await db.exec("rollback");
    return { rows: [], error: e.code ?? String(e.message) };
  }
}

for (const role of ["admin", "fleet_manager"]) {
  const ins = await asClient(ORG, role,
    `insert into samsara_feed_cursors (org_id, feed, end_cursor) values ($1,'vehicle_stats','forged')`, [ORG]);
  ok(`${role} cannot mint a cursor from the browser — that is how you skip a window of telematics on purpose`, ins.error === "42501");

  // An UPDATE or DELETE against a table with no matching policy does not RAISE — RLS simply matches no
  // rows and the statement reports success having changed nothing. That asymmetry with INSERT (which
  // raises 42501 on the WITH CHECK) reads as "the client can edit these", so both are asserted on the
  // EFFECT rather than on an error that never comes.
  const upd = await asClient(ORG, role,
    `with u as (update samsara_feed_cursors set end_cursor='rewound' where org_id=$1 returning 1)
     select count(*)::int n from u`, [ORG]);
  ok(`nor rewind one — RLS matches no rows, so nothing moves`, upd.error === null && upd.rows[0]?.n === 0, JSON.stringify(upd));

  const del = await asClient(ORG, role,
    `with d as (delete from samsara_feed_cursors where org_id=$1 returning 1) select count(*)::int n from d`, [ORG]);
  ok(`nor delete one`, del.error === null && del.rows[0]?.n === 0, JSON.stringify(del));

  const sel = await asClient(ORG, role, `select count(*)::int n from samsara_feed_cursors where org_id=$1`, [ORG]);
  ok(`and ${role} cannot read one either — deny-all, because an opaque vendor token answers no operator question`,
    sel.error === null && sel.rows[0]?.n === 0, JSON.stringify(sel));
}

// The service role, which is how the collector connects, is unaffected by all of the above.
ok(
  "the collector still sees its own cursors — the service role bypasses RLS, which is why every read it makes must org-filter itself",
  // Three seeded, one dropped by the re-seed assertion above.
  (await one(`select count(*)::int n from samsara_feed_cursors`)).n === 2,
);

// ── 5. the row belongs to the carrier ───────────────────────────────────────────────────────────
await db.query(`delete from organizations where id=$1`, [OTHER]);
ok(
  "deleting a carrier takes its cursors with it — nothing is left pointing into a tenant that no longer exists",
  (await one(`select count(*)::int n from samsara_feed_cursors where org_id=$1`, [OTHER])).n === 0,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
