// Silvicom 360 — the SMS queue and the do-not-text list (migration 0376,
// APPLICATION-FLOW-V2-PLAN.md §8.2, A-11/D-AW12).
//
// What the database itself must hold, before any drain or webhook exists:
//   · `sms_outbox` stores a TEMPLATE and its PARAMETERS, never a rendered body with a link in it — the
//     link is minted at drain time, because a plaintext bearer token in a table is what 0232/Q-AX5
//     refused. The CHECKs are the only line that holds that before C2's writer does.
//   · a held text has a life (`expires_at > not_before`) and a closed status vocabulary;
//     `provider_message_id` is unique, so a delivery receipt lands on one row.
//   · `sms_suppressions` holds one LIVE row per (org, phone); lifting frees the slot.
//   · both are service-only (SO010/SO011), and both follow a merged driver (DRIVER_REASSIGNMENTS).
//
// Run:  node supabase/tests/sms-outbox.test.mjs
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
const count = async (q, p = []) => Number((await one(q, p)).n);
const code = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
};

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text,
    name text, owner uuid, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
const driver = async (name = "Applicant") =>
  (await one(`insert into drivers (org_id, full_name, status) values ($1, $2, 'applicant') returning id`, [ORG, name])).id;
const D1 = await driver();

const enqueue = (over = {}) => {
  const row = {
    phone: "+13125550100", template: "application.nudge", params: { first_name: "Ana" }, reason: "nudge",
    not_before: "now()", expires_at: "now() + interval '1 day'", ...over,
  };
  return db.query(
    `insert into sms_outbox (org_id, driver_id, phone, template, params, reason, not_before, expires_at${over.status ? ", status" : ""})
     values ($1, $2, $3, $4, $5::jsonb, $6, ${row.not_before}, ${row.expires_at}${over.status ? ", $7" : ""}) returning id, status, attempts`,
    [ORG, over.driver ?? D1, row.phone, row.template, JSON.stringify(row.params), row.reason, ...(over.status ? [over.status] : [])]);
};
const enqueueCode = async (over) => { try { await enqueue(over); return null; } catch (e) { return e.code; } };

// ── The outbox holds a template, never a link ────────────────────────────────────────────────────
const q1 = (await enqueue()).rows[0];
ok("a queued text starts queued with no attempts", q1.status === "queued" && q1.attempts === 0);
ok("a URL in the params is refused (no bearer link at rest)",
  (await enqueueCode({ params: { link: "https://apply.example.com/a/tok_123" } })) === "23514");
ok("…in any case", (await enqueueCode({ params: { note: "HTTP://x.example" } })) === "23514");
ok("params must be an object", (await enqueueCode({ params: ["a"] })) === "23514");
ok("a template is a slug, not a sentence", (await enqueueCode({ template: "Hi Ana, sign at https://x" })) === "23514");
ok("a reason outside the vocabulary is refused", (await enqueueCode({ reason: "marketing" })) === "23514");
ok("a status outside the vocabulary is refused", (await enqueueCode({ status: "lost" })) === "23514");
ok("a text cannot expire before it may be sent",
  (await enqueueCode({ not_before: "now()", expires_at: "now() - interval '1 minute'" })) === "23514");
ok("there is no body column to put a rendered text in",
  (await count(`select count(*) n from information_schema.columns where table_name='sms_outbox' and column_name in ('body','message','text')`)) === 0);

// ── Delivery receipts land on one row ────────────────────────────────────────────────────────────
await db.query(`update sms_outbox set status='sent', provider_message_id='msg-1', sent_at=now(), attempts=1 where id=$1`, [q1.id]);
const q2 = (await enqueue()).rows[0];
ok("a provider message id is unique",
  (await code(`update sms_outbox set provider_message_id='msg-1' where id=$1`, [q2.id])) === "23505");
ok("the drain index covers only queued rows",
  (await one(`select pg_get_indexdef('public.idx_sms_outbox_drain'::regclass) d`)).d.includes("WHERE (status = 'queued'"));

// ── Suppressions: one live row per (org, phone) ──────────────────────────────────────────────────
const suppress = (phone, reason = "stop", drv = D1) =>
  db.query(`insert into sms_suppressions (org_id, driver_id, phone, reason) values ($1,$2,$3,$4) returning id`, [ORG, drv, phone, reason]);
const s1 = (await suppress("+13125550100")).rows[0].id;
ok("a second live suppression of the same number is refused",
  (await code(`insert into sms_suppressions (org_id, phone, reason) values ($1,'+13125550100','manual')`, [ORG])) === "23505");
await db.query(`update sms_suppressions set lifted_at = now() where id=$1`, [s1]);
ok("once lifted, the number can be suppressed again (and the old row stays)",
  (await code(`insert into sms_suppressions (org_id, phone, reason) values ($1,'+13125550100','carrier_block')`, [ORG])) === null &&
  (await count(`select count(*) n from sms_suppressions where phone='+13125550100'`)) === 2);
ok("a suppression reason outside the vocabulary is refused",
  (await code(`insert into sms_suppressions (org_id, phone, reason) values ($1,'+13125550199','annoyed')`, [ORG])) === "23514");

// ── Service-only ─────────────────────────────────────────────────────────────────────────────────
const asClient = async (sql) => {
  try {
    await db.exec(`begin; select set_config('request.jwt.claims','{"role":"authenticated","user_role":"admin","org_id":"${ORG}"}',true); ${sql}; commit;`);
    return null;
  } catch (e) { await db.exec("rollback"); return e.code; }
};
ok("a JWT-bearing writer is refused on sms_outbox (SO010)", (await asClient("update sms_outbox set status = 'cancelled'")) === "SO010");
ok("…and on sms_suppressions (SO011)", (await asClient("delete from sms_suppressions")) === "SO011");
ok("RLS is on with no policies on both",
  (await count(`select count(*) n from pg_class where relname in ('sms_outbox','sms_suppressions') and relrowsecurity`)) === 2 &&
  (await count(`select count(*) n from pg_policies where tablename in ('sms_outbox','sms_suppressions')`)) === 0);

// ── Both follow a merged driver (DRIVER_REASSIGNMENTS, mergeDriver.ts) ───────────────────────────
// The two entries the TypeScript list passes for these tables; the gate `check-driver-references`
// proves the list names them, this proves the rows can actually move (no guard refuses the update).
const DUP = await driver("Applicant dup");
await enqueue({ driver: DUP, phone: "+13125550177" });
await suppress("+13125550177", "invalid", DUP);
await db.query(`select public.merge_driver_v2($1,$2,$3,$4::jsonb)`, [ORG, DUP, D1, JSON.stringify([
  { table: "sms_outbox", column: "driver_id", org_scoped: true },
  { table: "sms_suppressions", column: "driver_id", org_scoped: true },
])]);
ok("a merge carries the duplicate's queued texts to the surviving driver",
  (await count(`select count(*) n from sms_outbox where phone='+13125550177' and driver_id=$1`, [D1])) === 1);
ok("…and its suppression, rather than detaching it",
  (await count(`select count(*) n from sms_suppressions where phone='+13125550177' and driver_id=$1`, [D1])) === 1);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
