// Silvicom 360 — "Mark all read" and "Clear all" on the bell (migration 0430).
//
// The defect 0430 removes: read-all selected 500 of the caller's events with no order, so an inbox of
// 590 kept its newest 33 unread after every click (production, 2026-10-05). The fixture here is 600
// events with the 50 newest unread — the exact shape a limited, unordered read gets wrong — plus
// another user's and another org's events, which the service-role function must never touch.
//
// Clearing stamps notification_reads.dismissed_at and never deletes an event: the events are the
// dedupe ledger the alert schedulers read.
//
// Run: node supabase/tests/notification-read-dismiss.test.mjs
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
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'U') returning id`)).id;
const ME = (await one(`insert into auth.users (email) values ('me@example.com') returning id`)).id;
const COLLEAGUE = (await one(`insert into auth.users (email) values ('them@example.com') returning id`)).id;

// 600 events for me, oldest first; the 550 oldest are already read.
await db.query(
  `insert into notification_events (org_id, audience_user_id, category, title, created_at)
   select $1, $2, 'card_status_changed', 'Card ' || g, now() - make_interval(mins => 600 - g)
     from generate_series(1, 600) g`,
  [ORG, ME],
);
await db.query(
  `insert into notification_reads (event_id, user_id, read_at)
   select id, $1, now() - interval '1 day' from notification_events
    where audience_user_id = $1 order by created_at limit 550`,
  [ME],
);
await db.query(
  `insert into notification_events (org_id, audience_user_id, category, title) values
     ($1, $2, 'system', 'colleague, same org'), ($3, $4, 'system', 'me, another org')`,
  [ORG, COLLEAGUE, OTHER_ORG, ME],
);

const unread = async (org, user) =>
  (await one(
    `select count(*)::int n from notification_events e
      where e.org_id = $1 and e.audience_user_id = $2
        and not exists (select 1 from notification_reads r where r.event_id = e.id and r.user_id = $2)`,
    [org, user],
  )).n;
const oldReadAt = async () =>
  (await one(
    `select count(*)::int n from notification_reads where user_id = $1 and read_at < now() - interval '1 hour'`,
    [ME],
  )).n;

ok("fixture: 50 of my 600 are unread before the click", (await unread(ORG, ME)) === 50);

const marked = (await one(`select mark_notifications_read($1, $2) n`, [ORG, ME])).n;
ok("read-all marks every unread event past 500, the newest included", (await unread(ORG, ME)) === 0);
ok("read-all reports the 50 it newly marked", marked === 50, `got ${marked}`);
ok("an event read yesterday keeps yesterday's read_at", (await oldReadAt()) === 550);
ok("a colleague's event in the same org stays unread", (await unread(ORG, COLLEAGUE)) === 1);
ok("my own event in another org stays unread", (await unread(OTHER_ORG, ME)) === 1);
ok("a second click is a no-op", (await one(`select mark_notifications_read($1, $2) n`, [ORG, ME])).n === 0);

// One fresh event after the read-all, so clearing must both mark it read and stamp it.
await db.query(
  `insert into notification_events (org_id, audience_user_id, category, title) values ($1, $2, 'system', 'fresh')`,
  [ORG, ME],
);
const dismissed = (await one(`select dismiss_notifications($1, $2) n`, [ORG, ME])).n;
ok("clear-all stamps all 601 of my events", dismissed === 601, `got ${dismissed}`);
ok("clear-all also marks the fresh one read", (await unread(ORG, ME)) === 0);
ok("clear-all keeps every event row (the dedupe ledger)",
  (await one(`select count(*)::int n from notification_events where audience_user_id = $1 and org_id = $2`, [ME, ORG])).n === 601);
ok("clear-all keeps earlier read_at values", (await oldReadAt()) === 550);
ok("clear-all leaves the colleague's inbox alone",
  (await one(`select count(*)::int n from notification_reads where user_id = $1`, [COLLEAGUE])).n === 0);
ok("clear-all leaves my inbox in the other org alone", (await unread(OTHER_ORG, ME)) === 1);

const firstStamp = (await one(`select min(dismissed_at) t from notification_reads where user_id = $1`, [ME])).t;
ok("a second clear changes nothing", (await one(`select dismiss_notifications($1, $2) n`, [ORG, ME])).n === 0);
ok("a second clear keeps the first dismissed_at",
  (await one(`select min(dismissed_at) t from notification_reads where user_id = $1`, [ME])).t.getTime() === firstStamp.getTime());

for (const fn of ["mark_notifications_read", "dismiss_notifications"]) {
  const g = await one(
    `select has_function_privilege('authenticated', $1, 'execute') a,
            has_function_privilege('anon', $1, 'execute') n,
            has_function_privilege('service_role', $1, 'execute') s`,
    [`public.${fn}(uuid, uuid)`],
  );
  ok(`${fn}: service role only — no browser can name another user's inbox`, !g.a && !g.n && g.s);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
