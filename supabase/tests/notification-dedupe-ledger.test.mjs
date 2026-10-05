// Silvicom 360 — the notification dedupe ledger (migration 0432, DATA-LIFECYCLE-PLAN Q11).
//
// What must hold for the inbox to become prunable:
//   1. the backfill carries every key the events already held, with its FIRST send time;
//   2. emit_notification dedupes against the ledger, so a key survives its event being deleted;
//   3. notification_keys_sent answers "which of these keys did this org send?" in one row, past
//      1,000 matches, scoped to the org, and optionally only keys first sent since a date.
//
// The migrations are applied in two halves so the backfill runs against rows written BEFORE 0432,
// the shape production has.
//
// Run: node supabase/tests/notification-dedupe-ledger.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();
const LEDGER = MIGRATIONS.findIndex((f) => f.startsWith("0432_"));

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text,
    name text, owner uuid, owner_id text, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
const apply = async (files) => {
  for (const f of files) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
};
ok("0432 is present", LEDGER > 0);
await apply(MIGRATIONS.slice(0, LEDGER));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'U') returning id`)).id;
const A = (await one(`insert into auth.users (email) values ('a@example.com') returning id`)).id;
const B = (await one(`insert into auth.users (email) values ('b@example.com') returning id`)).id;
for (const org of [ORG, OTHER_ORG]) {
  await db.query(`insert into org_modules (org_id, module_key, enabled) values ($1, 'notifications', true)
                  on conflict (org_id, module_key) do update set enabled = true`, [org]);
}

// Before 0432: one keyed event per user, one unkeyed, and the same key in another org.
await db.query(
  `insert into notification_events (org_id, audience_user_id, category, title, dedupe_key, created_at) values
     ($1, $2, 'system', 'old', 'dq:d1:medical:30', '2026-08-10T12:00:00Z'),
     ($1, $3, 'system', 'old', 'dq:d1:medical:30', '2026-08-10T12:00:05Z'),
     ($1, $2, 'system', 'unkeyed', null, '2026-08-11T12:00:00Z'),
     ($4, $2, 'system', 'elsewhere', 'dq:d9:medical:30', '2026-08-12T12:00:00Z')`,
  [ORG, A, B, OTHER_ORG],
);
await apply(MIGRATIONS.slice(LEDGER));

ok("backfill: one ledger row per (org, recipient, key), unkeyed events skipped",
  (await one(`select count(*)::int n from notification_dedupe_keys`)).n === 3);
ok("backfill keeps the event's send time as first_sent_at",
  (await one(`select first_sent_at t from notification_dedupe_keys where audience_user_id = $1 and org_id = $2`, [B, ORG])).t.toISOString()
    === "2026-08-10T12:00:05.000Z");

const emit = (org, user, key) =>
  one(`select emit_notification($1, $2, 'system', 'title', null, 'info', null, null, null, $3) id`, [org, user, key]);

ok("a backfilled key dedupes a new emit", (await emit(ORG, A, "dq:d1:medical:30")).id === null);
ok("a fresh key writes an event", (await emit(ORG, A, "fuel:stale:x:2026-10-05")).id !== null);
ok("the fresh key is claimed in the ledger",
  (await one(`select count(*)::int n from notification_dedupe_keys where dedupe_key = 'fuel:stale:x:2026-10-05'`)).n === 1);
ok("the same key to another recipient is still delivered", (await emit(ORG, B, "fuel:stale:x:2026-10-05")).id !== null);
ok("an unkeyed emit always writes", (await emit(ORG, A, null)).id !== null && (await emit(ORG, A, null)).id !== null);
ok("an unkeyed emit claims nothing",
  (await one(`select count(*)::int n from notification_dedupe_keys where dedupe_key is null`)).n === 0);

// The point of the split: the inbox row goes, the fact that it was sent does not.
await db.query(`delete from notification_events where org_id = $1`, [ORG]);
ok("after its event is deleted, the key still dedupes", (await emit(ORG, A, "fuel:stale:x:2026-10-05")).id === null);
ok("deleting events leaves the ledger whole",
  (await one(`select count(*)::int n from notification_dedupe_keys where org_id = $1`, [ORG])).n === 4);

// A suppressed emit claims nothing, as before: switch the module off and emit.
await db.query(`update org_modules set enabled = false where org_id = $1 and module_key = 'notifications'`, [ORG]);
ok("a suppressed emit returns null", (await emit(ORG, A, "suppressed:1")).id === null);
ok("a suppressed emit claims no key, so it can still be sent later",
  (await one(`select count(*)::int n from notification_dedupe_keys where dedupe_key = 'suppressed:1'`)).n === 0);
await db.query(`update org_modules set enabled = true where org_id = $1 and module_key = 'notifications'`, [ORG]);

const sent = async (keys, since = null, org = ORG) =>
  (await one(`select notification_keys_sent($1, $2, $3) k`, [org, keys, since])).k;
ok("keys_sent answers only the keys asked about, once each",
  JSON.stringify((await sent(["dq:d1:medical:30", "never-sent"])).sort()) === JSON.stringify(["dq:d1:medical:30"]));
ok("keys_sent is org-scoped", (await sent(["dq:d9:medical:30"])).length === 0);
ok("keys_sent sees the other org's own key", (await sent(["dq:d9:medical:30"], null, OTHER_ORG)).length === 1);
ok("p_since drops keys first sent before it", (await sent(["dq:d1:medical:30"], "2026-09-01T00:00:00Z")).length === 0);
ok("an empty or null key list answers an empty array",
  (await sent([])).length === 0 && (await one(`select notification_keys_sent($1, null) k`, [ORG])).k.length === 0);

// Past PostgREST's 1,000-row cap: 1,500 keys × 2 recipients, answered in one row.
await db.query(
  `insert into notification_dedupe_keys (org_id, audience_user_id, dedupe_key)
   select $1, u, 'bulk:' || g from generate_series(1, 1500) g, unnest(array[$2::uuid, $3::uuid]) u`,
  [ORG, A, B],
);
const bulk = Array.from({ length: 1500 }, (_, i) => `bulk:${i + 1}`);
ok("1,500 sent keys come back whole, in one row", (await sent(bulk)).length === 1500);

ok("row level security is on the ledger",
  (await one(`select relrowsecurity r from pg_class where relname = 'notification_dedupe_keys'`)).r === true);
for (const sig of ["emit_notification(uuid, uuid, text, text, text, text, text, uuid, text, text)", "notification_keys_sent(uuid, text[], timestamptz)"]) {
  const g = await one(
    `select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') n,
            has_function_privilege('service_role', $1, 'execute') s`,
    [`public.${sig}`],
  );
  ok(`${sig.split("(")[0]}: service role only`, !g.a && !g.n && g.s);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
