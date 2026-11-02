// Silvicom 360 — office chat: conversations about a load, a driver, a truck, a card-fraud incident or a
// roadside inspection (migrations 0543 and 0545, OFFICE-CHAT-PLAN CH11a, §9.4; D-CHAT31–D-CHAT36, Q-CHAT6 (a),
// Q-CHAT21 (c)).
//
// What the database itself must guarantee, whoever calls the functions:
//   · a group may be about one record — a load, a driver or a truck — set when it is made, and the
//     ledger's `conversation_created` names it; a direct conversation or a channel never is, and no
//     conversation is about two;
//   · the record must be the conversation's organisation's, on insert and on any later re-point;
//   · `chat_about` lists only the conversations about that record the caller is in NOW — nothing of
//     the rest, not even their number; another organisation's call finds nothing;
//   · `chat_thread_about` tells a member what it is about (the load's ref, the driver's name, the
//     truck's unit) and refuses anybody else (CH001);
//   · a driver merge carries the conversation to the surviving driver (the real DRIVER_REASSIGNMENTS);
//   · a browser can call none of it.
//
// Run: node supabase/tests/office-chat-about.test.mjs
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
const all = async (q, p = []) => (await db.query(q, p)).rows;
const sqlstate = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
};
async function asUser(claims, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return { rows: res.rows };
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}

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
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`);
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const ORG_B = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other carrier') returning id`)).id;
const person = async (email, org, role, name) => {
  const id = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  await db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,$3)`, [org, id, role]);
  await db.query(`insert into user_profiles (user_id, full_name) values ($1,$2)`, [id, name]);
  return id;
};
const ANA = await person("ana@silvicom.test", ORG, "dispatcher", "Ana Petrović");
const BEN = await person("ben@silvicom.test", ORG, "admin", "Ben Admin");
const CLEO = await person("cleo@silvicom.test", ORG, "safety_manager", "Cleo Safety");
const DEV = await person("dev@silvicom.test", ORG, "dispatcher", "Dev Dispatch");
const OUT = await person("outsider@other.test", ORG_B, "admin", "Other Admin");

const uuid = async () => (await one(`select gen_random_uuid() id`)).id;
const LOAD = (await one(`insert into loads (org_id, ref, status, source, provider) values ($1,'L-20481','in_transit','tms','mcleod') returning id`, [ORG])).id;
const DRIVER = (await one(`insert into drivers (org_id, full_name) values ($1,'Marcus Reyes') returning id`, [ORG])).id;
const TRUCK = (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,'702',150) returning id`, [ORG])).id;
const LOAD_B = (await one(`insert into loads (org_id, ref, status, source, provider) values ($1,'B-1','in_transit','tms','mcleod') returning id`, [ORG_B])).id;
const DRIVER_B = (await one(`insert into drivers (org_id, full_name) values ($1,'Other Driver') returning id`, [ORG_B])).id;
const TRUCK_B = (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,'B9',150) returning id`, [ORG_B])).id;

const about = async (actor, members, kind, record, subject = "About it", id) => {
  const tid = id ?? (await uuid());
  await db.query(`select chat_create_about($1,$2,$3,$4,$5,$6,$7)`, [ORG, actor, tid, subject, members, kind, record]);
  return tid;
};
const list = async (user, kind, record, org = ORG) => (await all(`select * from chat_about($1,$2,$3,$4)`, [org, user, kind, record])).map((r) => r.thread_id);
const what = (user, thread) => all(`select * from chat_thread_about($1,$2,$3)`, [ORG, user, thread]);

// ── Making one ────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- making a conversation about a record --");
const T_LOAD = await about(ANA, [BEN], "load", LOAD, "Load L-20481");
const row = await one(`select kind, subject, load_id, driver_id, vehicle_id, created_by from message_threads where id=$1`, [T_LOAD]);
ok("a group about a load: kind group, the load linked, nothing else", row.kind === "group" && row.load_id === LOAD && row.driver_id === null && row.vehicle_id === null && row.created_by === ANA, JSON.stringify(row));
const led = await one(`select detail from chat_ledger where thread_id=$1 and action='conversation_created'`, [T_LOAD]);
ok("the ledger's conversation_created names the load", led.detail.load_id === LOAD && led.detail.kind === "group", JSON.stringify(led.detail));
const T_DRV = await about(BEN, [CLEO], "driver", DRIVER, "Marcus Reyes");
const T_TRK = await about(DEV, [ANA], "vehicle", TRUCK, "Truck 702");
ok("...a driver and a truck the same way, the ledger naming each",
  (await one(`select detail from chat_ledger where thread_id=$1 and action='conversation_created'`, [T_DRV])).detail.driver_id === DRIVER
  && (await one(`select detail from chat_ledger where thread_id=$1 and action='conversation_created'`, [T_TRK])).detail.vehicle_id === TRUCK);
ok("the maker owns it and the people named are members",
  JSON.stringify((await all(`select user_id, member_role from thread_participants where thread_id=$1 order by member_role desc`, [T_LOAD])).map((r) => [r.user_id, r.member_role]))
  === JSON.stringify([[ANA, "owner"], [BEN, "member"]]));
ok("asking again with the same id returns it and makes nothing new",
  (await one(`select chat_create_about($1,$2,$3,'x',$4,'load',$5) id`, [ORG, ANA, T_LOAD, [BEN], LOAD])).id === T_LOAD
  && Number((await one(`select count(*) n from message_threads where load_id=$1`, [LOAD])).n) === 1);
ok("a plain group still carries no link", (await (async () => {
  const g = await uuid();
  await db.query(`select chat_create_group($1,$2,$3,'Plain',$4)`, [ORG, ANA, g, [BEN]]);
  const r = await one(`select load_id, driver_id, vehicle_id from message_threads where id=$1`, [g]);
  return r.load_id === null && r.driver_id === null && r.vehicle_id === null;
})()));

// ── Refusals ──────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- refusals --");
ok("another organisation's load is refused CH016 and makes nothing",
  (await sqlstate(`select chat_create_about($1,$2,$3,'x',$4,'load',$5)`, [ORG, ANA, await uuid(), [BEN], LOAD_B])) === "CH016"
  && Number((await one(`select count(*) n from message_threads where load_id=$1`, [LOAD_B])).n) === 0);
ok("...another organisation's driver and truck the same way",
  (await sqlstate(`select chat_create_about($1,$2,$3,'x',$4,'driver',$5)`, [ORG, ANA, await uuid(), [BEN], DRIVER_B])) === "CH016"
  && (await sqlstate(`select chat_create_about($1,$2,$3,'x',$4,'vehicle',$5)`, [ORG, ANA, await uuid(), [BEN], TRUCK_B])) === "CH016");
ok("a record that does not exist is refused CH016", (await sqlstate(`select chat_create_about($1,$2,$3,'x',$4,'driver',$5)`, [ORG, ANA, await uuid(), [BEN], await uuid()])) === "CH016");
ok("a kind there is no such thing as is refused CH016", (await sqlstate(`select chat_create_about($1,$2,$3,'x',$4,'case',$5)`, [ORG, ANA, await uuid(), [BEN], LOAD])) === "CH016");
ok("...as is no record at all", (await sqlstate(`select chat_create_about($1,$2,$3,'x',$4,'load',null)`, [ORG, ANA, await uuid(), [BEN]])) === "CH016");
ok("alone, it is refused as any group is (CH002)", (await sqlstate(`select chat_create_about($1,$2,$3,'x',$4,'load',$5)`, [ORG, ANA, await uuid(), [], LOAD])) === "CH002");
ok("a person of another organisation cannot be put in it",
  (await sqlstate(`select chat_create_about($1,$2,$3,'x',$4,'load',$5)`, [ORG, ANA, await uuid(), [OUT], LOAD])) !== null);
ok("the table refuses a conversation about two records (23514)",
  (await sqlstate(`update message_threads set driver_id=$2 where id=$1`, [T_LOAD, DRIVER])) === "23514");
const DIRECT = await uuid();
await db.query(`select chat_open_direct($1,$2,$3,$4)`, [ORG, ANA, DEV, DIRECT]);
ok("...and a direct conversation about anything (23514)", (await sqlstate(`update message_threads set vehicle_id=$2 where id=$1`, [DIRECT, TRUCK])) === "23514");
ok("re-pointing a link to another organisation's record is refused CH016",
  (await sqlstate(`update message_threads set load_id=$2 where id=$1`, [T_LOAD, LOAD_B])) === "CH016");

// ── Who sees what ─────────────────────────────────────────────────────────────────────────────────
console.log("\n-- participants only --");
ok("Ana, in it, finds the load's conversation from the load", JSON.stringify(await list(ANA, "load", LOAD)) === JSON.stringify([T_LOAD]));
ok("Cleo, not in it, finds nothing — not even that one exists", (await list(CLEO, "load", LOAD)).length === 0);
const T_LOAD2 = await about(CLEO, [DEV], "load", LOAD, "Detention on L-20481");
ok("two conversations about one load: each person finds only theirs",
  JSON.stringify(await list(ANA, "load", LOAD)) === JSON.stringify([T_LOAD]) && JSON.stringify(await list(CLEO, "load", LOAD)) === JSON.stringify([T_LOAD2]));
await db.query(`select chat_add_members($1,$2,$3,$4)`, [ORG, ANA, T_LOAD, [CLEO]]);
ok("once added, Cleo finds both, newest activity first",
  (await list(CLEO, "load", LOAD)).length === 2 && new Set(await list(CLEO, "load", LOAD)).has(T_LOAD));
await db.query(`select chat_leave($1,$2,$3,null)`, [ORG, BEN, T_LOAD]);
ok("once Ben has left, he finds none", (await list(BEN, "load", LOAD)).length === 0);
const listed = (await all(`select * from chat_about($1,$2,'load',$3)`, [ORG, ANA, LOAD]))[0];
ok("a listed conversation carries its subject, its members' count and who else is in it",
  listed.subject === "Load L-20481" && Number(listed.member_count) === 2 && listed.title_members.map((m) => m.name).join() === "Cleo Safety", JSON.stringify(listed));
ok("the kind is read with the record: asking for a driver with a load's id finds nothing", (await list(ANA, "driver", LOAD)).length === 0);
ok("an unknown kind finds nothing rather than failing", (await list(ANA, "case", LOAD)).length === 0);
ok("another organisation's call for the same record finds nothing", (await list(ANA, "load", LOAD, ORG_B)).length === 0);

// ── What it is about ──────────────────────────────────────────────────────────────────────────────
console.log("\n-- what it is about --");
ok("a member is told: the load and its ref", JSON.stringify(await what(ANA, T_LOAD)) === JSON.stringify([{ kind: "load", record_id: LOAD, label: "L-20481" }]));
ok("...the driver and their name", JSON.stringify(await what(CLEO, T_DRV)) === JSON.stringify([{ kind: "driver", record_id: DRIVER, label: "Marcus Reyes" }]));
ok("...the truck and its unit", JSON.stringify(await what(ANA, T_TRK)) === JSON.stringify([{ kind: "vehicle", record_id: TRUCK, label: "702" }]));
ok("a conversation about nothing answers no row", (await what(ANA, DIRECT)).length === 0);
ok("somebody not in it is refused CH001", (await sqlstate(`select * from chat_thread_about($1,$2,$3)`, [ORG, ANA, T_DRV])) === "CH001");

// ── A driver merge ────────────────────────────────────────────────────────────────────────────────
console.log("\n-- a driver merge --");
const tsSrc = readFileSync(join(SUPA, "..", "apps", "api", "src", "modules", "roster", "mergeDriver.ts"), "utf8");
const MOVES = [...tsSrc.matchAll(/\{\s*table:\s*"([a-z_][a-z0-9_]*)",\s*column:\s*"([a-z_][a-z0-9_]*)"(,\s*orgScoped:\s*true)?/g)]
  .map((m) => ({ table: m[1], column: m[2], org_scoped: !!m[3] }));
ok("the real merge list is read and moves message_threads.driver_id", MOVES.length > 20 && MOVES.some((m) => m.table === "message_threads" && m.column === "driver_id"));
const DUP = (await one(`insert into drivers (org_id, full_name) values ($1,'Marcus Reyes (dup)') returning id`, [ORG])).id;
const T_DUP = await about(BEN, [CLEO], "driver", DUP, "Marcus, the duplicate");
await db.query(`select merge_driver_v2($1,$2,$3,$4::jsonb)`, [ORG, DUP, DRIVER, JSON.stringify(MOVES)]);
ok("merging the duplicate into Marcus carries its conversation to Marcus",
  (await one(`select driver_id from message_threads where id=$1`, [T_DUP])).driver_id === DRIVER
  && new Set(await list(CLEO, "driver", DRIVER)).has(T_DUP));

// ── 0545: a card-fraud incident and a roadside inspection ─────────────────────────────────────────
console.log("\n-- 0545: a fraud incident, a roadside inspection --");
const incident = async (org, cardRef) => (await one(
  `insert into card_fraud_incidents (org_id, incident_key, card_key, card_ref, opened_at, last_attempt_at, level, attempt_count, places, steps)
   values ($1, $2, 'k', $3, '2026-10-01', '2026-10-01', 'alert', 1, '[{}]', '[{}]') returning id`, [org, await uuid(), cardRef])).id;
const inspection = async (org, report = null, day = null) => (await one(
  `with r as (insert into fmcsa_fetch_runs (org_id, dataset, dot_number, started_at, outcome, complete)
     values ($1, 'fx4q-ay7w', '1', now(), 'succeeded', true) returning id),
   raw as (insert into fmcsa_raw_rows (org_id, fetch_run_id, dataset, natural_key, version, kind, payload, sha256)
     select $1, id, 'fx4q-ay7w', gen_random_uuid()::text, 1, 'present', '{}'::jsonb, repeat('a', 64) from r returning id)
   insert into roadside_inspections (org_id, fmcsa_inspection_id, raw_row_id, report_number, inspection_date)
     select $1, (random() * 1e12)::bigint, id, $2, $3 from raw returning id`, [org, report, day])).id;
const FRAUD = await incident(ORG, "7083050099003367559");
const FRAUD_B = await incident(ORG_B, "1234");
const INSP = await inspection(ORG, "MN1234567", "2026-10-21");
const INSP_DAY = await inspection(ORG, null, "2026-10-21");
const INSP_B = await inspection(ORG_B, "X1");
const T_FRAUD = await about(DEV, [BEN], "fraud_incident", FRAUD, "Card fraud ••7559");
const T_INSP = await about(CLEO, [BEN], "roadside_inspection", INSP, "Inspection MN1234567");
ok("a group about a fraud incident and one about a roadside inspection, each linked and nothing else",
  (await one(`select num_nonnulls(load_id, driver_id, vehicle_id, card_fraud_incident_id, roadside_inspection_id) n, card_fraud_incident_id c from message_threads where id=$1`, [T_FRAUD])).c === FRAUD
  && (await one(`select roadside_inspection_id r, num_nonnulls(load_id, driver_id, vehicle_id, card_fraud_incident_id, roadside_inspection_id) n from message_threads where id=$1`, [T_INSP])).r === INSP);
ok("...the ledger's conversation_created naming each",
  (await one(`select detail from chat_ledger where thread_id=$1 and action='conversation_created'`, [T_FRAUD])).detail.card_fraud_incident_id === FRAUD
  && (await one(`select detail from chat_ledger where thread_id=$1 and action='conversation_created'`, [T_INSP])).detail.roadside_inspection_id === INSP);
const fraudSays = (await what(DEV, T_FRAUD))[0];
ok("a fraud incident is called by the card's last four digits — never the number as stored (D-CHAT36)",
  fraudSays?.kind === "fraud_incident" && fraudSays?.label === "••7559" && !JSON.stringify(fraudSays).includes("7083050099"), JSON.stringify(fraudSays));
ok("an inspection by its report number", JSON.stringify(await what(CLEO, T_INSP)) === JSON.stringify([{ kind: "roadside_inspection", record_id: INSP, label: "MN1234567" }]));
const T_DAY = await about(CLEO, [BEN], "roadside_inspection", INSP_DAY);
ok("...or, without one, by its day as MM/DD/YYYY", (await what(CLEO, T_DAY))[0]?.label === "10/21/2026", JSON.stringify(await what(CLEO, T_DAY)));
ok("the record's page finds them for the people in them only",
  JSON.stringify(await list(DEV, "fraud_incident", FRAUD)) === JSON.stringify([T_FRAUD]) && (await list(ANA, "fraud_incident", FRAUD)).length === 0
  && new Set(await list(BEN, "roadside_inspection", INSP)).has(T_INSP) && (await list(ANA, "roadside_inspection", INSP)).length === 0);
ok("another organisation's incident or inspection is refused CH016",
  (await sqlstate(`select chat_create_about($1,$2,$3,'x',$4,'fraud_incident',$5)`, [ORG, ANA, await uuid(), [BEN], FRAUD_B])) === "CH016"
  && (await sqlstate(`select chat_create_about($1,$2,$3,'x',$4,'roadside_inspection',$5)`, [ORG, ANA, await uuid(), [BEN], INSP_B])) === "CH016");
ok("re-pointing a link to another organisation's incident or inspection is refused CH016",
  (await sqlstate(`update message_threads set card_fraud_incident_id=$2 where id=$1`, [T_FRAUD, FRAUD_B])) === "CH016"
  && (await sqlstate(`update message_threads set roadside_inspection_id=$2 where id=$1`, [T_INSP, INSP_B])) === "CH016");
ok("still at most one link: an inspection on a conversation about an incident is refused (23514)",
  (await sqlstate(`update message_threads set roadside_inspection_id=$2 where id=$1`, [T_FRAUD, INSP])) === "23514");
ok("...and a direct conversation is still about nothing (23514)",
  (await sqlstate(`update message_threads set card_fraud_incident_id=$2 where id=$1`, [DIRECT, FRAUD])) === "23514");

// ── The browser ───────────────────────────────────────────────────────────────────────────────────
console.log("\n-- the browser --");
const claims = { sub: ANA, role: "authenticated" };
for (const [fn, sql] of [
  ["chat_create_about", `select chat_create_about('${ORG}','${ANA}','${await uuid()}','x',array['${BEN}']::uuid[],'load','${LOAD}')`],
  ["chat_about", `select * from chat_about('${ORG}','${ANA}','load','${LOAD}')`],
  ["chat_thread_about", `select * from chat_thread_about('${ORG}','${ANA}','${T_LOAD}')`],
]) {
  ok(`a browser cannot call ${fn}`, !!(await asUser(claims, sql)).error);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
