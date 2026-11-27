// Silvicom 360 — the mail gateway's database door (migration 0643, BROKER-MAIL-READER-PLAN.md D-BMR3).
//
// The gateway logs in as `mail_gateway`. The promise is that this login can execute exactly the six
// mailgw_* door functions and touch NO table — and that the functions themselves refuse what the
// gateway must not do: name a mailbox off the derived list, write outside its lease, keep an internal
// message, close a thread on unrelated mail, or keep running once the canary has opened.
//
// Why each setup choice:
//   · The platform's DEFAULT ACL is reproduced first (as definer-rpc-grants.test.mjs does), because a
//     PGlite cluster without it grants nothing to anyone and every "cannot execute" passes for free.
//     Functions created by migrations older than 0412 still carry PUBLIC execute in this setup, as on
//     production — and `mail_gateway`, like every role, holds what PUBLIC holds. The catalog walk is
//     therefore the real question: not "did 0643 grant too much" but "can this login reach anything".
//   · The walk lists every function and every table in `public` from the live catalog, so a later
//     migration that forgets a revoke fails here, not in a review.
//   · The behaviour cases run AS mail_gateway (`set role`), so a function that only worked because
//     the test ran as the superuser fails.
//
// Run:  node supabase/tests/mail-gateway-door.test.mjs   (needs packages/shared/dist: pnpm --filter @silvicom/shared build:rn)
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  BROKER_MAIL_MATCH_STATES, BROKER_MAIL_THREAD_STATES, MAIL_GATEWAY_MAILBOX_STATES,
  MAIL_GATEWAY_PROBE_RESULTS, MAIL_GATEWAY_FOLDER_ROLES, BROKER_MAIL_SUBJECT_MAX, normaliseBrokerMailToken,
  mailGatewayCycleStartSchema, BROKER_MAIL_ROSTER_REASONS,
} from "../../packages/shared/dist/index.js";

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
const all = async (q, p = []) => (await db.query(q, p)).rows;

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
  create schema if not exists extensions; create schema if not exists partman;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);
for (const f of MIGRATIONS) {
  try { await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, "")); }
  catch (e) { console.error(`migration ${f} failed: ${e.message}`); process.exit(1); }
}

const DOOR = ["mailgw_begin_cycle", "mailgw_save_cursor", "mailgw_record_messages", "mailgw_mark_threads", "mailgw_record_probe", "mailgw_end_cycle"];

// ── 1. the login itself ──────────────────────────────────────────────────────────────────────────
console.log("\nthe role");
const role = await one(`select rolcanlogin, rolinherit, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication, rolconnlimit,
                               rolconfig from pg_roles where rolname = 'mail_gateway'`);
ok("mail_gateway exists, NOLOGIN in the migration (the owner's script turns login on)", role && role.rolcanlogin === false);
ok("noinherit, no superuser / createrole / createdb / bypassrls / replication",
  role.rolinherit === false && !role.rolsuper && !role.rolcreaterole && !role.rolcreatedb && !role.rolbypassrls && !role.rolreplication);
ok("connection limit 3", role.rolconnlimit === 3);
ok("statement_timeout and idle-in-transaction timeout are set on the role",
  (role.rolconfig ?? []).includes("statement_timeout=15s") && (role.rolconfig ?? []).includes("idle_in_transaction_session_timeout=30s"), JSON.stringify(role.rolconfig));
const memberOf = await all(`select r.rolname from pg_auth_members am join pg_roles r on r.oid = am.roleid
                             join pg_roles m on m.oid = am.member where m.rolname = 'mail_gateway'`);
ok("member of no role (it holds only what PUBLIC holds, plus its own grants)", memberOf.length === 0, JSON.stringify(memberOf));

// ── 2. the door: exactly six functions, no table ─────────────────────────────────────────────────
console.log("\nthe door, walked from the catalog");
const fns = await all(`select p.oid, p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public' and p.prokind in ('f', 'p')`);
const reachable = [];
for (const f of fns) {
  const { x } = await one(`select has_function_privilege('mail_gateway', $1::oid, 'execute') x`, [f.oid]);
  if (x) reachable.push(f);
}
const trig = new Set((await all(`select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype`)).map((r) => r.oid));
const reachableDefiner = reachable.filter((f) => f.prosecdef && !trig.has(f.oid)).map((f) => f.proname).sort();
ok("the callable SECURITY DEFINER functions mail_gateway can execute are exactly the six door functions",
  JSON.stringify(reachableDefiner) === JSON.stringify([...DOOR].sort()), `got ${JSON.stringify(reachableDefiner)}`);
// Trigger functions created before 0412 still carry PUBLIC execute; Postgres refuses to call one
// directly, which is the only reason they may stay reachable. Proved by calling one.
const aTrigger = reachable.find((f) => f.prosecdef && trig.has(f.oid));
if (aTrigger) {
  const sig = (await one(`select $1::oid::regprocedure::text s`, [aTrigger.oid])).s;
  await db.exec("set role mail_gateway");
  let refused = false;
  try { await db.query(`select ${sig.replace(/\(.*\)$/, "()")}`); } catch (e) { refused = /trigger/i.test(e.message); }
  await db.exec("reset role");
  ok(`a reachable trigger function cannot be called directly (${aTrigger.proname})`, refused);
}
ok("the four RLS helpers no longer carry PUBLIC execute, and anon/authenticated/service_role keep theirs",
  (await all(`select p.proname, p.proacl::text acl from pg_proc p where p.proname in ('auth_driver_id', 'auth_dispatched_load_ids', 'auth_in_thread', 'auth_module_enabled')`))
    .every((r) => !r.acl.includes("{=X/") && !r.acl.includes(",=X/") && ["anon=X", "authenticated=X", "service_role=X"].every((g) => r.acl.includes(g))));
// An invoker function runs AS mail_gateway, which can read no table, so reaching one opens nothing;
// it is still counted, so the number cannot grow unseen.
const reachableInvoker = reachable.filter((f) => !f.prosecdef).map((f) => f.proname);
ok("no mailgw_* helper is reachable (config, lease, derived list, token rule)",
  !reachable.some((f) => f.proname.startsWith("mailgw_") && !DOOR.includes(f.proname)), JSON.stringify(reachable.map((f) => f.proname).filter((n) => n.startsWith("mailgw_"))));
console.log(`        (invoker functions reachable through PUBLIC: ${reachableInvoker.length}; each runs as mail_gateway and can read nothing)`);

const rels = await all(`select c.oid, c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')`);
const touchable = [];
for (const r of rels) {
  const privs = r.relkind === "S" ? ["select", "update", "usage"] : ["select", "insert", "update", "delete", "truncate", "references", "trigger"];
  for (const pr of privs) {
    const q = r.relkind === "S" ? `select has_sequence_privilege('mail_gateway', $1::oid, '${pr}') x` : `select has_table_privilege('mail_gateway', $1::oid, '${pr}') x`;
    if ((await one(q, [r.oid])).x) { touchable.push(`${r.relname}:${pr}`); }
  }
}
ok(`mail_gateway holds no privilege on any of the ${rels.length} tables, views and sequences in public`, touchable.length === 0, JSON.stringify(touchable.slice(0, 10)));
ok("mail_gateway cannot read auth.users", !(await one(`select has_table_privilege('mail_gateway', 'auth.users', 'select') x`)).x);

for (const fn of DOOR) {
  const sig = (await one(`select p.oid::regprocedure::text s from pg_proc p where p.proname = $1`, [fn])).s;
  const who = await one(`select has_function_privilege('anon', '${sig}', 'execute') a, has_function_privilege('authenticated', '${sig}', 'execute') u,
                                has_function_privilege('service_role', '${sig}', 'execute') s`);
  ok(`${fn}: closed to anon, authenticated and service_role`, !who.a && !who.u && !who.s, JSON.stringify(who));
}

// ── 3. the contract's words are the CHECKs' words ────────────────────────────────────────────────
console.log("\nevery vocabulary in brokerMailContract equals its CHECK");
const checkWords = async (table, column) => {
  const defs = await all(`select pg_get_constraintdef(c.oid) d from pg_constraint c join pg_class t on t.oid = c.conrelid
                           where t.relname = $1 and c.contype = 'c'`, [table]);
  const d = defs.map((r) => r.d).find((s) => s.includes(`(${column} = ANY`) || s.includes(`((${column} = ANY`));
  return d ? [...d.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort() : null;
};
for (const [label, table, column, words] of [
  ["match_state", "broker_mail_messages", "match_state", BROKER_MAIL_MATCH_STATES],
  ["thread_state", "broker_mail_messages", "thread_state", BROKER_MAIL_THREAD_STATES],
  ["mailbox state", "mail_gateway_mailboxes", "state", MAIL_GATEWAY_MAILBOX_STATES],
  ["folder_role", "mail_gateway_cursors", "folder_role", MAIL_GATEWAY_FOLDER_ROLES],
  ["canary_result", "mail_gateway_config", "canary_result", MAIL_GATEWAY_PROBE_RESULTS],
]) {
  const got = await checkWords(table, column);
  ok(`${label}: contract ${JSON.stringify([...words].sort())} = CHECK`, JSON.stringify(got) === JSON.stringify([...words].sort()), `CHECK ${JSON.stringify(got)}`);
}
const subjCheck = (await all(`select pg_get_constraintdef(c.oid) d from pg_constraint c join pg_class t on t.oid = c.conrelid
                               where t.relname = 'broker_mail_messages' and c.contype = 'c'`)).map((r) => r.d).find((s) => s.includes("subject"));
ok(`subject length: contract ${BROKER_MAIL_SUBJECT_MAX} = CHECK`, subjCheck?.includes(`<= ${BROKER_MAIL_SUBJECT_MAX}`), subjCheck);
for (const raw of ["PO# 12-345", "po12345", "LOAD 9981", "ab", "  ", "ÄBC-1234", "x".repeat(70), "1234"]) {
  const sql = (await one(`select mailgw_norm_token($1) t`, [raw])).t;
  ok(`token rule agrees with SQL on ${JSON.stringify(raw.slice(0, 12))}`, sql === normaliseBrokerMailToken(raw), `js=${normaliseBrokerMailToken(raw)} sql=${sql}`);
}

// ── 4. behaviour, as mail_gateway ────────────────────────────────────────────────────────────────
const ORG = "00000000-0000-0000-0000-00000000a001";
const OTHER = "00000000-0000-0000-0000-00000000b001";
const U = { ann: "00000000-0000-0000-0000-0000000000a1", bob: "00000000-0000-0000-0000-0000000000b2", cat: "00000000-0000-0000-0000-0000000000c3",
            dan: "00000000-0000-0000-0000-0000000000d4", eve: "00000000-0000-0000-0000-0000000000e5", fay: "00000000-0000-0000-0000-0000000000f6" };
await db.exec(`
  insert into organizations (id, name) values ('${ORG}', 'Carrier'), ('${OTHER}', 'Other carrier');
  insert into auth.users (id, email) values
    ('${U.ann}', 'Ann@Carrier.com'), ('${U.bob}', 'bob@gmail.com'), ('${U.cat}', 'cat@carrier.com'),
    ('${U.dan}', 'dan@carrier.com'), ('${U.eve}', 'eve@carrier.com'), ('${U.fay}', 'fay@carrier.com');
  insert into memberships (org_id, user_id, role) values
    ('${ORG}', '${U.ann}', 'dispatcher'), ('${ORG}', '${U.bob}', 'dispatcher'), ('${ORG}', '${U.cat}', 'dispatcher'),
    ('${ORG}', '${U.dan}', 'dispatcher'), ('${ORG}', '${U.eve}', 'admin'), ('${OTHER}', '${U.fay}', 'dispatcher');
  update memberships set suspended_at = now() where user_id = '${U.cat}';
  insert into tms_dispatchers (org_id, provider, external_id, user_id, is_system, is_active) values
    ('${ORG}', 'mcleod', 'ann1', '${U.ann}', false, true), ('${ORG}', 'mcleod', 'ann2', '${U.ann}', false, true),
    ('${ORG}', 'mcleod', 'bob', '${U.bob}', false, true), ('${ORG}', 'mcleod', 'cat', '${U.cat}', false, true),
    ('${ORG}', 'mcleod', 'dan', '${U.dan}', false, false), ('${ORG}', 'mcleod', 'eve', '${U.eve}', false, true),
    ('${ORG}', 'mcleod', 'loadmaster', null, true, true), ('${OTHER}', 'mcleod', 'fay', '${U.fay}', false, true);
  insert into loads (id, org_id, ref, pickup_number) values
    ('00000000-0000-0000-0000-00000000c001', '${ORG}', 'L-55501', 'PU7788'),
    ('00000000-0000-0000-0000-00000000c002', '${ORG}', 'L-55502', 'SHARED1'),
    ('00000000-0000-0000-0000-00000000c003', '${ORG}', 'L-55503', 'SHARED1'),
    ('00000000-0000-0000-0000-00000000c009', '${OTHER}', 'L-99999', null);
  insert into load_stops (org_id, load_id, seq, kind, name, po_number) values
    ('${ORG}', '00000000-0000-0000-0000-00000000c001', 1, 'pickup', 'Shipper', 'PO-4411');
`);
const gw = async (sql, params = []) => {
  await db.exec("set role mail_gateway");
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { error: e.code ?? e.message, message: e.message }; }
  finally { await db.exec("reset role"); }
};
const begin = async () => (await gw(`select mailgw_begin_cycle('abc1234') r`)).rows?.[0]?.r;
const release = async (cycle) => gw(`select mailgw_end_cycle($1, '{}'::jsonb, '[]'::jsonb)`, [cycle]);

console.log("\nbehaviour, as mail_gateway");
ok("with no config row, begin_cycle refuses", (await gw(`select mailgw_begin_cycle('abc1234')`)).error === "P0002");
await db.exec(`insert into mail_gateway_config (org_id, enabled, mail_domains, excluded_user_ids) values ('${ORG}', false, '{carrier.com}', '{${U.eve}}')`);
ok("a second config row is refused (one gateway per database, D-BMR12)",
  await db.query(`insert into mail_gateway_config (org_id) values ('${OTHER}')`).then(() => false, () => true));
let s = await begin();
ok("switched off: begin_cycle returns no cycle and no mailbox", s.cycle_id === null && s.enabled === false && s.mailboxes.length === 0);
await db.exec(`update mail_gateway_config set enabled = true`);
s = await begin();
ok("begin_cycle's answer parses with mailGatewayCycleStartSchema", mailGatewayCycleStartSchema.safeParse(s).success, JSON.stringify(mailGatewayCycleStartSchema.safeParse(s).error?.issues?.[0]));
ok("derived list = Ann only: two McLeod logins are one mailbox; gmail, suspended, McLeod-inactive, excluded, system and the other org are out",
  JSON.stringify(s.mailboxes) === JSON.stringify([{ mailbox: "ann@carrier.com", owner_user_id: U.ann }]), JSON.stringify(s.mailboxes));
ok("the lease is held: a second begin_cycle gets no cycle", (await begin()).cycle_id === null);
const C1 = s.cycle_id;
ok("mail_gateway cannot read a table directly", (await gw(`select * from broker_mail_messages`)).error === "42501");
ok("mail_gateway cannot call a helper", (await gw(`select * from mailgw_derived_mailboxes('${ORG}')`)).error === "42501");

const env = (o) => ({ mailbox: "ann@carrier.com", conversation_id: "conv-1", from_address: "Ops@Broker.com", received_at: "2026-11-24T15:00:00Z",
  subject: "Update please", addressed_directly: true, was_candidate: true, body_was_read: false, tokens: [], ...o });
const rec = (cycle, list) => gw(`select mailgw_record_messages($1, $2::jsonb) n`, [cycle, JSON.stringify(list)]);
let r = await rec(C1, [
  env({ internet_message_id: "<m1>", tokens: ["L 55501"] }),
  env({ internet_message_id: "<m2>", tokens: ["shared-1"] }),
  env({ internet_message_id: "<m3>", tokens: ["NOPE99"] }),
  env({ internet_message_id: "<m4>", tokens: [] }),
  env({ internet_message_id: "<m5>", tokens: ["po 4411"], conversation_id: "conv-2" }),
  env({ internet_message_id: "<m6>", from_address: "colleague@CARRIER.com", tokens: ["L55501"] }),
  env({ internet_message_id: "<m7>", tokens: ["L99999"] }),
  env({ internet_message_id: "<m8>", subject: "s".repeat(400) }),
]);
ok("record_messages stores 7 of 8: the internal sender is never a row", r.rows?.[0]?.n === 7, JSON.stringify(r));
const rows = Object.fromEntries((await all(`select internet_message_id, match_state, load_id, matched_refs, owner_user_id, from_address, from_domain, length(subject) sl
                                             from broker_mail_messages`)).map((x) => [x.internet_message_id, x]));
ok("ref match → one load", rows["<m1>"].match_state === "one" && rows["<m1>"].load_id === "00000000-0000-0000-0000-00000000c001" && rows["<m1>"].matched_refs.join() === "L55501");
ok("a pickup number two loads share → several, no load named", rows["<m2>"].match_state === "several" && rows["<m2>"].load_id === null);
ok("a token that is no reference → none, and it is not kept", rows["<m3>"].match_state === "none" && rows["<m3>"].matched_refs.length === 0);
ok("no token → not_tried", rows["<m4>"].match_state === "not_tried");
ok("a stop's PO number matches its load", rows["<m5>"].match_state === "one" && rows["<m5>"].load_id === "00000000-0000-0000-0000-00000000c001");
ok("another org's load never matches", rows["<m7>"].match_state === "none");
ok("the owner is the mailbox's user; sender lower-cased; domain derived", rows["<m1>"].owner_user_id === U.ann && rows["<m1>"].from_address === "ops@broker.com" && rows["<m1>"].from_domain === "broker.com");
ok("a long subject is cut to 255", rows["<m8>"].sl === 255);
ok("no row for the internal sender", !rows["<m6>"]);
r = await rec(C1, [env({ internet_message_id: "<m1>", tokens: ["L 55501"] })]);
ok("a re-read of the same message is harmless (0 new)", r.rows?.[0]?.n === 0);
r = await rec(C1, [env({ internet_message_id: "<x1>" }), env({ internet_message_id: "<x2>", mailbox: "bob@gmail.com" })]);
ok("a mailbox off the derived list refuses the whole batch", r.error === "42501" && !(await one(`select 1 x from broker_mail_messages where internet_message_id = '<x1>'`)));
ok("a wrong cycle id cannot write", (await rec("00000000-0000-0000-0000-000000000000", [env({ internet_message_id: "<x3>" })])).error === "55P03");
ok("the other org's rows: none", (await one(`select count(*)::int n from broker_mail_messages where org_id = '${OTHER}'`)).n === 0);

const mark = (cycle, answers, checked) => gw(`select mailgw_mark_threads($1, $2::jsonb, $3::text[]) n`, [cycle, JSON.stringify(answers), checked]);
r = await mark(C1, [
  { mailbox: "ann@carrier.com", conversation_id: "conv-1", answered_at: "2026-11-24T14:00:00Z", by: "owner", recipients: ["ops@broker.com"] },
  { mailbox: "ann@carrier.com", conversation_id: "conv-1", answered_at: "2026-11-24T16:00:00Z", by: "owner", recipients: ["someone@else.com"] },
], ["ann@carrier.com"]);
ok("an answer EARLIER than the message, or to unrelated recipients, closes nothing", r.rows?.[0]?.n === 0, JSON.stringify(r));
r = await mark(C1, [{ mailbox: "ann@carrier.com", conversation_id: "conv-2", answered_at: "2026-11-24T16:00:00Z", by: "colleague", recipients: ["dispatch@broker.com"] }], []);
ok("a later answer on the conversation to the broker's domain closes that row only", r.rows?.[0]?.n === 1 &&
  (await one(`select thread_state, answered_at is not null a from broker_mail_messages where internet_message_id = '<m5>'`)).thread_state === "answered_by_colleague");
ok("the other rows of the mailbox stay waiting", (await one(`select count(*)::int n from broker_mail_messages where thread_state = 'waiting'`)).n === 6);
ok("thread_checked_at is stamped only for mailboxes the cycle read to the end",
  (await one(`select count(*) filter (where thread_checked_at is not null)::int n from broker_mail_messages where thread_state = 'waiting'`)).n === 6);
ok("an unknown answer kind is refused", (await mark(C1, [{ mailbox: "ann@carrier.com", conversation_id: "c", answered_at: "2026-11-24T16:00:00Z", by: "boss", recipients: [] }], [])).error === "22023");

ok("save_cursor stores a position", !(await gw(`select mailgw_save_cursor($1, 'ann@carrier.com', 'F1', 'inbox', 'https://graph/delta?x')`, [C1])).error &&
  (await one(`select count(*)::int n from mail_gateway_cursors`)).n === 1);
ok("save_cursor refuses a mailbox off the list", (await gw(`select mailgw_save_cursor($1, 'bob@gmail.com', 'F1', 'inbox', 'l')`, [C1])).error === "42501");
ok("save_cursor with null forgets the position", !(await gw(`select mailgw_save_cursor($1, 'ann@carrier.com', 'F1', 'inbox', null)`, [C1])).error &&
  (await one(`select count(*)::int n from mail_gateway_cursors`)).n === 0);

r = await gw(`select mailgw_end_cycle($1, '{"messages_in": 8, "bad key!": 1, "note": "text"}'::jsonb, '[{"mailbox": "ann@carrier.com", "state": "over_quota"}]'::jsonb)`, [C1]);
const cyc = await one(`select counts, ended_at is not null e, commit from mail_gateway_cycles where id = $1`, [C1]);
ok("end_cycle keeps numeric counts with plain keys only, stamps the end and the commit",
  !r.error && JSON.stringify(cyc.counts) === '{"messages_in":8}' && cyc.e && cyc.commit === "abc1234", JSON.stringify({ r, cyc }));
ok("end_cycle records a mailbox's state", (await one(`select state from mail_gateway_mailboxes where mailbox = 'ann@carrier.com'`)).state === "over_quota");
ok("end_cycle released the lease: the next begin gets a cycle", (s = await begin()).cycle_id !== null);
ok("a cycle may not report a mailbox as connected or unlinked", (await gw(`select mailgw_end_cycle($1, '{}'::jsonb, '[{"mailbox": "ann@carrier.com", "state": "connected"}]'::jsonb)`, [s.cycle_id])).error === "22023");
await release(s.cycle_id);

// Unlink: Ann's McLeod logins lose their user → her mailbox leaves the list, is probed, and refuses writes.
await db.exec(`update tms_dispatchers set user_id = null where external_id in ('ann1', 'ann2')`);
s = await begin();
ok("an unlinked mailbox leaves the derived list and is due a probe", s.mailboxes.length === 0 && JSON.stringify(s.probe_unlinked) === '["ann@carrier.com"]', JSON.stringify(s));
ok("its envelopes are refused", (await rec(s.cycle_id, [env({ internet_message_id: "<u1>" })])).error === "42501");
ok("an unlinked probe that opens is recorded as still connected", !(await gw(`select mailgw_record_probe($1, 'unlinked', 'ann@carrier.com', 'opened')`, [s.cycle_id])).error &&
  (await one(`select state from mail_gateway_mailboxes where mailbox = 'ann@carrier.com'`)).state === "still_connected_after_unlink");
await release(s.cycle_id);
s = await begin();
ok("probed today: not due again", s.probe_unlinked.length === 0);
await release(s.cycle_id);
await db.exec(`update tms_dispatchers set user_id = '${U.ann}' where external_id in ('ann1', 'ann2')`);

// Canary: an opened canary switches the gateway off in the same call.
s = await begin();
ok("the canary is due on the first cycle", s.canary_due === true);
r = await gw(`select mailgw_record_probe($1, 'canary', 'unused', 'opened') ok`, [s.cycle_id]);
const cfg = await one(`select enabled, canary_result, disabled_reason from mail_gateway_config`);
ok("an OPENED canary turns the gateway off and says why", r.rows?.[0]?.ok === false && cfg.enabled === false && cfg.canary_result === "opened" && /canary/.test(cfg.disabled_reason));
await release(s.cycle_id);
ok("…and the next run gets no cycle", (await begin()).cycle_id === null);
ok("an unknown probe result is refused", (await gw(`select mailgw_record_probe(gen_random_uuid(), 'canary', 'x', 'maybe')`)).error !== undefined);

// Empty domains derive nobody: a missing setting fails closed (Q-BMR10).
await db.exec(`update mail_gateway_config set enabled = true, mail_domains = '{}', lease_cycle_id = null, lease_until = null`);
s = await begin();
ok("empty mail_domains: no mailbox at all", s.cycle_id !== null && s.mailboxes.length === 0);
await release(s.cycle_id);

// ── 5. the admin's roster and "left out on purpose" (0649, P2) ──────────────────────────────────
// The derived list reads the roster since 0649, so every case above already ran against the new body.
console.log("\nthe roster (0649), as the API's service role");
await db.exec(`
  update mail_gateway_config set mail_domains = '{carrier.com}';
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a7', 'gus@carrier.com'), ('00000000-0000-0000-0000-0000000000a8', null);
  insert into memberships (org_id, user_id, role) values ('${ORG}', '00000000-0000-0000-0000-0000000000a8', 'dispatcher');
  insert into tms_dispatchers (org_id, provider, external_id, user_id, is_system, is_active) values
    ('${ORG}', 'mcleod', 'aneta', null, false, true), ('${ORG}', 'mcleod', 'gus', '00000000-0000-0000-0000-0000000000a7', false, true),
    ('${ORG}', 'mcleod', 'hal', '00000000-0000-0000-0000-0000000000a8', false, true);
`);
const sr = async (sql, params = []) => {
  await db.exec("set role service_role");
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { error: e.code ?? e.message }; }
  finally { await db.exec("reset role"); }
};
const roster = Object.fromEntries(((await sr(`select * from mailgw_mailbox_roster('${ORG}')`)).rows ?? [])
  .map((x) => [x.user_id ?? `login:${x.mcleod_logins[0]}`, x]));
const reason = (k) => roster[k]?.reason ?? (roster[k] ? null : "absent");
ok("roster: Ann is read, one row for her two McLeod logins", reason(U.ann) === null && JSON.stringify(roster[U.ann].mcleod_logins) === '["ann1","ann2"]');
ok("roster says WHY each other dispatcher is not read",
  reason(U.bob) === "other_domain" && reason(U.cat) === "suspended" && reason(U.eve) === "left_out" &&
  reason("00000000-0000-0000-0000-0000000000a7") === "not_member" && reason("00000000-0000-0000-0000-0000000000a8") === "no_email" &&
  reason("login:aneta") === "not_linked", JSON.stringify(Object.values(roster).map((x) => [x.mcleod_logins, x.reason])));
ok("roster leaves out the McLeod-inactive, the system login and the other org", reason(U.dan) === "absent" && !roster["login:loadmaster"] && reason(U.fay) === "absent");
ok("every roster reason is a word of BROKER_MAIL_ROSTER_REASONS",
  Object.values(roster).every((x) => x.reason === null || BROKER_MAIL_ROSTER_REASONS.includes(x.reason)));
ok("the derived list is exactly the roster's unreasoned rows",
  JSON.stringify((await sr(`select * from mailgw_derived_mailboxes('${ORG}')`)).rows) === JSON.stringify([{ mailbox: "ann@carrier.com", owner_user_id: U.ann }]));
ok("mail_gateway cannot call the roster or the left-out act",
  (await gw(`select * from mailgw_mailbox_roster('${ORG}')`)).error === "42501" &&
  (await gw(`select broker_mail_set_left_out('${ORG}', '${U.ann}', true)`)).error === "42501");
r = await sr(`select broker_mail_set_left_out('${ORG}', '${U.ann}', true) v`);
ok("leaving Ann out takes her mailbox off the derived list", !r.error && (await sr(`select * from mailgw_derived_mailboxes('${ORG}')`)).rows.length === 0 &&
  (await sr(`select reason from mailgw_mailbox_roster('${ORG}') where user_id = '${U.ann}'`)).rows[0].reason === "left_out");
await sr(`select broker_mail_set_left_out('${ORG}', '${U.ann}', true)`);
ok("leaving her out twice keeps one entry", (await one(`select cardinality(excluded_user_ids) n from mail_gateway_config`)).n === 2);
await sr(`select broker_mail_set_left_out('${ORG}', '${U.ann}', false)`);
ok("taking her back restores the derived list; Eve stays out", (await sr(`select * from mailgw_derived_mailboxes('${ORG}')`)).rows.length === 1 &&
  JSON.stringify((await one(`select excluded_user_ids x from mail_gateway_config`)).x) === JSON.stringify([U.eve]));
ok("a user who is not a member is refused (22023)", (await sr(`select broker_mail_set_left_out('${ORG}', '${U.fay}', true)`)).error === "22023");
ok("another org has no config row: refused (P0002)", (await sr(`select broker_mail_set_left_out('${OTHER}', '${U.fay}', true)`)).error === "P0002");
ok("broker_mail_settings is RLS-on and refuses an answer time under five minutes",
  (await one(`select relrowsecurity x from pg_class where relname = 'broker_mail_settings'`)).x === true &&
  await db.query(`insert into broker_mail_settings (org_id, answer_within_minutes) values ('${ORG}', 4)`).then(() => false, () => true));

// ── 6. what the texts need (0651, P3-a) ─────────────────────────────────────────────────────────
console.log("\nthe texts' tables (0651)");
const bell = async (c) => db.query(`insert into notification_events (org_id, audience_user_id, category, title) values ($1, $2, $3, 'x')`, [ORG, U.ann, c]).then(() => null, (e) => e.code);
ok("both broker-mail alert categories are accepted by notification_events", (await bell("broker_mail_waiting")) === null && (await bell("broker_mail_backup")) === null);
ok("…0624's categories still are, and an unknown one is still refused", (await bell("lumper_billing_gap")) === null && (await bell("broker_mail_nonsense")) === "23514");
const st = await one(`insert into broker_mail_settings (org_id) values ('${ORG}')
  on conflict (org_id) do update set updated_at = now() returning texts_on_since, backup_after_minutes`);
ok("texts start OFF (no moment) and the backup notice defaults to +5 minutes", st.texts_on_since === null && st.backup_after_minutes === 5);
ok("a backup delay outside 1–120 minutes is refused",
  await db.query(`update broker_mail_settings set backup_after_minutes = 0`).then(() => false, () => true));
await db.exec(`insert into broker_mail_backups (org_id, dispatcher_user_id, backup_user_id) values ('${ORG}', '${U.ann}', '${U.eve}')`);
ok("a dispatcher cannot be their own backup",
  await db.query(`insert into broker_mail_backups (org_id, dispatcher_user_id, backup_user_id) values ('${ORG}', '${U.ann}', '${U.ann}')`).then(() => false, () => true));
ok("the same backup twice is one row", await db.query(`insert into broker_mail_backups (org_id, dispatcher_user_id, backup_user_id) values ('${ORG}', '${U.ann}', '${U.eve}')`).then(() => false, () => true));
ok("a recorded envelope starts un-alerted on both stamps", (await all(`select 1 from broker_mail_messages where owner_alerted_at is not null or backup_alerted_at is not null`)).length === 0 &&
  (await one(`select count(*)::int n from broker_mail_messages`)).n > 0);
ok("broker_mail_backups is RLS-on, and mail_gateway can neither read nor write it",
  (await one(`select relrowsecurity x from pg_class where relname = 'broker_mail_backups'`)).x === true &&
  (await gw(`select * from broker_mail_backups`)).error === "42501");

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
