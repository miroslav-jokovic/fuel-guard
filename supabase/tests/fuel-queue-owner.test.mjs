// FuelGuard — the fuel queue's default owner (migration 0442; Q-F1; F02-F04 PLAN.md chunk 8a).
//
// WHY THIS FILE EXISTS. The rule lives in a trigger on three tables written by three SQL functions, and
// the act that turns it on runs once on production (chunk 8b). Nothing in the unit suites executes
// either. What can be wrong, each asserted below:
//   • A NEW ITEM IS NOT GIVEN TO THE OWNER, on any of the three tables, or through the real ingest.
//   • IT OVERWRITES A PERSON'S CHOICE: an insert that names an assignee, or a re-ingest of a finding
//     somebody reassigned, must keep that person.
//   • IT GIVES WORK TO SOMEBODY WHO LEFT, or to the wrong org's owner.
//   • THE ACT assigns the wrong items (closed ones, assigned ones, another org's), sets a non-member,
//     runs without an actor, leaves no audit row, or can be called from the browser.
//
// Run:  node supabase/tests/fuel-queue-owner.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SUPA = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(SUPA, f), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const count = async (q, p = []) => Number((await one(q, p)).n);
/** Run a statement and return its error message, or null when it succeeded. */
const err = async (p) => { try { await p; return null; } catch (e) { return e.message; } };

// Supabase-managed objects (present in a real project; shimmed here), as in rls.test.mjs.
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
    bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now()
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
  grant usage on schema public, storage to anon, authenticated, service_role;
`);

console.log(`Applying ${MIGRATIONS.length} migrations in lexical order`);
for (const name of MIGRATIONS) {
  await db.exec(read(`migrations/${name}`).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────
const ORG = (await one(`insert into organizations (name) values ('Queue Co') returning id`)).id;
const OTHER = (await one(`insert into organizations (name) values ('Other Co') returning id`)).id;
const user = async (email, org, role = "admin") => {
  const id = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  if (org) await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, $3::user_role)`, [org, id, role]);
  return id;
};
const OWNER = await user("owner@x.test", ORG);
const PERSON = await user("person@x.test", ORG); // an admin too: the org must keep one when OWNER leaves (memberships_keep_an_admin)
const OTHER_OWNER = await user("other@x.test", OTHER);
const STRANGER = await user("stranger@x.test", null);

let seq = 0;
const anomaly = async (org = ORG, { status = "open", assignee = null } = {}) => {
  const txn = (await one(`insert into fuel_transactions (org_id, fueled_at, gallons) values ($1, now(), 100) returning id`, [org])).id;
  return (await one(
    `insert into anomalies (org_id, transaction_id, rule_id, severity, status, message, source, assigned_to)
     values ($1, $2, 'theft_case', 'medium', $3::anomaly_status, 'seeded', 'rules', $4) returning id`, [org, txn, status, assignee])).id;
};
const finding = async (org = ORG, { status = "open", assignee = null } = {}) =>
  (await one(
    `insert into fuel_exceptions (org_id, kind, amount_kind, fingerprint, status, assigned_to)
     values ($1, 'recon_amount', 'overbilled', $2, $3, $4) returning id`, [org, `fp-${++seq}`, status, assignee])).id;
const incident = async (org = ORG, { status = "open", assignee = null } = {}) =>
  (await one(
    `insert into card_fraud_incidents (org_id, incident_key, card_key, card_ref, opened_at, last_attempt_at, level,
       attempt_count, places, steps, status, assigned_to, disposition)
     values ($1, $2, 'card', '…0001', now(), now(), 'alert', 1, '[{"city":"A"}]', '[{"step":"opened"}]', $3, $4,
             case when $3 in ('resolved', 'dismissed') then 'false_positive' end) returning id`,
    [org, `inc-${++seq}`, status, assignee])).id;
const MAKERS = [["fill case", anomaly, "anomalies"], ["money finding", finding, "fuel_exceptions"], ["card fraud incident", incident, "card_fraud_incidents"]];
const assigneeOf = async (table, id) => (await one(`select assigned_to from ${table} where id = $1`, [id])).assigned_to;
const setOwner = (org, actor, owner) =>
  db.query(`select * from set_fuel_queue_owner($1, $2, $3)`, [org, actor, owner]).then((r) => r.rows[0], (e) => ({ error: e.message }));

console.log("\n-- with no owner set, nothing changes (today's behaviour, every org until 8b) --");
for (const [name, make, table] of MAKERS) {
  ok(`a new ${name} stays unassigned`, (await assigneeOf(table, await make())) === null);
}

console.log("\n-- the act: refusals first, each leaving no trace --");
ok("no actor is refused", /actor is required/.test((await setOwner(ORG, null, OWNER)).error ?? ""));
ok("an owner who is not a member is refused", /not a member/.test((await setOwner(ORG, OWNER, STRANGER)).error ?? ""));
ok("another org's owner is refused", /not a member/.test((await setOwner(ORG, OWNER, OTHER_OWNER)).error ?? ""));
ok("…and none of them set the owner or wrote an audit row",
  (await one(`select fuel_queue_owner from organizations where id = $1`, [ORG])).fuel_queue_owner === null &&
  (await count(`select count(*) n from audit_logs where action = 'fuel.queue_owner_set'`)) === 0);

// The open items the act should take, and the ones it must leave.
const openCase = await anomaly(), workingCase = await anomaly(ORG, { status: "investigating" });
const closedCase = await anomaly(ORG, { status: "dismissed" }), takenCase = await anomaly(ORG, { assignee: PERSON });
const openFinding = await finding(), disputed = await finding(ORG, { status: "disputed" });
const credited = await finding(ORG, { status: "credited" }), takenFinding = await finding(ORG, { assignee: PERSON });
const openIncident = await incident(), closedIncident = await incident(ORG, { status: "resolved" });
const otherOrgCase = await anomaly(OTHER);
// Open and unassigned: the one of each from the no-owner block, plus the open ones just seeded.
const EXPECTED = { cases: 3, findings: 3, incidents: 2 };

console.log("\n-- the act --");
const res = await setOwner(ORG, OWNER, OWNER);
ok("it reports what it assigned: 3 cases, 3 findings, 2 incidents",
  res.cases === EXPECTED.cases && res.findings === EXPECTED.findings && res.incidents === EXPECTED.incidents, JSON.stringify(res));
ok("the owner is set", (await one(`select fuel_queue_owner from organizations where id = $1`, [ORG])).fuel_queue_owner === OWNER);
for (const [name, table, id] of [["an open case", "anomalies", openCase], ["a case being investigated", "anomalies", workingCase],
  ["an open finding", "fuel_exceptions", openFinding], ["a disputed finding", "fuel_exceptions", disputed],
  ["an open incident", "card_fraud_incidents", openIncident]]) {
  ok(`${name} goes to the owner`, (await assigneeOf(table, id)) === OWNER);
}
for (const [name, table, id, want] of [["a closed case", "anomalies", closedCase, null], ["a credited finding", "fuel_exceptions", credited, null],
  ["a resolved incident", "card_fraud_incidents", closedIncident, null], ["another org's case", "anomalies", otherOrgCase, null],
  ["a case a person took", "anomalies", takenCase, PERSON], ["a finding a person took", "fuel_exceptions", takenFinding, PERSON]]) {
  ok(`${name} is left as it was`, (await assigneeOf(table, id)) === want);
}
const audit = await one(`select actor_id, entity_id, meta from audit_logs where action = 'fuel.queue_owner_set'`);
ok("one audit row names the actor, the org, the owner and the counts",
  (await count(`select count(*) n from audit_logs where action = 'fuel.queue_owner_set'`)) === 1 &&
  audit.actor_id === OWNER && audit.entity_id === ORG && audit.meta.owner === OWNER && audit.meta.previous_owner === null &&
  audit.meta.assigned_cases === res.cases && audit.meta.assigned_findings === res.findings && audit.meta.assigned_incidents === res.incidents,
  JSON.stringify(audit));

console.log("\n-- from now on, a new item goes to the owner --");
for (const [name, make, table] of MAKERS) {
  ok(`a new ${name} is assigned to the owner`, (await assigneeOf(table, await make())) === OWNER);
  ok(`a new ${name} that names an assignee keeps that person`, (await assigneeOf(table, await make(ORG, { assignee: PERSON }))) === PERSON);
  ok(`a new ${name} in another org is not given this org's owner`, (await assigneeOf(table, await make(OTHER))) === null);
}

console.log("\n-- through the real ingest (sync_fuel_exceptions) --");
{
  const ingest = (fp) => db.query(`select * from sync_fuel_exceptions($1, null, $2::jsonb)`,
    [ORG, JSON.stringify([{ fingerprint: fp, kind: "contract_variance", amount: 12.5, amountKind: "overbilled" }])]);
  const r1 = await ingest("ingest-1").then(() => null, (e) => e.message);
  ok("the ingest runs", r1 === null, r1 ?? "");
  const id = (await one(`select id from fuel_exceptions where fingerprint = 'ingest-1'`))?.id;
  ok("a finding the ingest creates goes to the owner", id != null && (await assigneeOf("fuel_exceptions", id)) === OWNER);
  if (id) await db.query(`update fuel_exceptions set assigned_to = $1 where id = $2`, [PERSON, id]);
  const r2 = await ingest("ingest-1").then(() => null, (e) => e.message);
  ok("a re-ingest of a finding a person reassigned keeps that person", r2 === null && id != null && (await assigneeOf("fuel_exceptions", id)) === PERSON, r2 ?? "");
}

console.log("\n-- an owner who left gets nothing new --");
await db.query(`delete from memberships where org_id = $1 and user_id = $2`, [ORG, OWNER]);
for (const [name, make, table] of MAKERS) {
  ok(`a new ${name} stays unassigned`, (await assigneeOf(table, await make())) === null);
}

console.log("\n-- clearing the owner --");
{
  const cleared = await setOwner(ORG, PERSON, null);
  ok("null clears the setting and assigns nothing", cleared.cases === 0 && cleared.findings === 0 && cleared.incidents === 0 &&
    (await one(`select fuel_queue_owner from organizations where id = $1`, [ORG])).fuel_queue_owner === null, JSON.stringify(cleared));
  const a = await one(`select meta from audit_logs where action = 'fuel.queue_owner_set' order by created_at desc, id desc limit 1`);
  ok("…with its own audit row naming the previous owner", (await count(`select count(*) n from audit_logs where action = 'fuel.queue_owner_set'`)) === 2 &&
    a.meta.previous_owner === OWNER && a.meta.owner === null, JSON.stringify(a));
}

console.log("\n-- the browser cannot reach it, and cannot move the owner --");
{
  const sig = "public.set_fuel_queue_owner(uuid, uuid, uuid)";
  const g = await one(
    `select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') n,
            has_function_privilege('service_role', $1, 'execute') s`, [sig]);
  ok("set_fuel_queue_owner: service role only", !g.a && !g.n && g.s, JSON.stringify(g));
  const pol = await count(
    `select count(*) n from pg_policies where schemaname = 'public' and tablename = 'organizations' and cmd in ('UPDATE', 'ALL')`);
  ok("organizations has no browser update policy, so the owner moves only through the act", pol === 0, String(pol));
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
