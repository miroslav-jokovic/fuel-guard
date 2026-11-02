// Silvicom 360 — office chat: load and truck numbers in a line become links (migration 0547,
// CHAT-REDESIGN-PLAN Q-CHATUI6 (a)).
//
// What the database itself must guarantee, whoever calls the function:
//   · a seven-digit order id that is a load of this organisation is a link, as is "load 137581" / "load
//     #137581" / "order 137581" padded to seven; a number that is no load of ours is not;
//   · a truck is a number after "truck", "unit" or "tractor" that is exactly one unit of ours — a retired
//     one too ("183 - SOLD") — and a bare number, or one two units could be, is never a link;
//   · the answer is the text as it stands in the line, with the record it names;
//   · only lines the caller can read: not a conversation they are not in or left, not a retracted line,
//     not a driver conversation, not another organisation's — and only records of their organisation;
//   · a browser can call none of it.
//
// Run: node supabase/tests/office-chat-line-links.test.mjs
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
const send = async (actor, thread, body, org = ORG) => {
  const mid = await uuid();
  await db.query(`select * from chat_send($1,$2,$3,$4,$5)`, [org, actor, thread, mid, body]);
  return mid;
};
const links = async (user, ids, org = ORG) =>
  (await all(`select * from chat_line_links($1,$2,$3) order by message_id, text`, [org, user, ids])).map((r) => ({ m: r.message_id, text: r.text, kind: r.kind, id: r.record_id }));
const loadOf = async (org, ref) => (await one(`insert into loads (org_id, ref, status, source, provider) values ($1,$2,'in_transit','tms','mcleod') returning id`, [org, ref])).id;
const unitOf = async (org, unit) => (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,$2,150) returning id`, [org, unit])).id;

const L1 = await loadOf(ORG, "0137581");
const L2 = await loadOf(ORG, "0099999");
const LB = await loadOf(ORG_B, "0137582");
const T506 = await unitOf(ORG, "506");
const T183 = await unitOf(ORG, "183 - SOLD");
await unitOf(ORG, "77");
await unitOf(ORG, "77 - SOLD");
const GROUP = await uuid();
await db.query(`select chat_create_group($1,$2,$3,'Night desk',$4)`, [ORG, ANA, GROUP, [BEN]]);

// ── Loads ─────────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- loads --");
const M1 = await send(ANA, GROUP, "Can you approve the detention on 0137581? Then Load #99999 is next.");
ok("a seven-digit order id of ours is a load link, and 'Load #99999' is load 0099999",
  JSON.stringify(await links(BEN, [M1])) === JSON.stringify([
    { m: M1, text: "0137581", kind: "load", id: L1 }, { m: M1, text: "Load #99999", kind: "load", id: L2 },
  ].sort((a, b) => a.text.localeCompare(b.text))), JSON.stringify(await links(BEN, [M1])));
const M2 = await send(ANA, GROUP, "order 137581 is the same load; call 555-0137 or 1234567; 0137582 is theirs");
const two = await links(BEN, [M2]);
ok("'order 137581' links too; a phone number, a seven-digit number that is no load, and another org's load do not",
  JSON.stringify(two.map((l) => [l.text, l.id])) === JSON.stringify([["order 137581", L1]]), JSON.stringify(two));
const M3 = await send(ANA, GROUP, "x0137581 and 01375810 are not words of their own");
ok("an order id inside a longer word is not a link", (await links(BEN, [M3])).length === 0);

// ── Trucks ────────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- trucks --");
const M4 = await send(ANA, GROUP, "Truck 506 is at the yard, unit #183 was sold, tractor 77 is which one?, and 506 alone is a number");
const four = await links(BEN, [M4]);
ok("'Truck 506' is truck 506 and 'unit #183' the retired '183 - SOLD'",
  four.some((l) => l.text === "Truck 506" && l.id === T506 && l.kind === "vehicle") && four.some((l) => l.text === "unit #183" && l.id === T183), JSON.stringify(four));
ok("a number two units could be ('77' and '77 - SOLD') is no link", !four.some((l) => l.text.includes("77")));
ok("a bare number is never a truck", four.length === 2, JSON.stringify(four));
await unitOf(ORG_B, "612");
const M5 = await send(ANA, GROUP, "truck 999 is not ours, and truck 612 is the other carrier's");
ok("a unit that is not ours — none's, or another organisation's — is no link", (await links(BEN, [M5])).length === 0);

// ── Only what the reader could read ───────────────────────────────────────────────────────────────
console.log("\n-- readable lines only --");
ok("somebody not in the conversation gets nothing for its lines", (await links(CLEO, [M1, M4])).length === 0);
ok("another organisation's call for the same lines gets nothing", (await links(BEN, [M1], ORG_B)).length === 0);
// M2 names 0137582, which is the OTHER organisation's load: asked under that organisation's id, these
// lines must still give nothing — not a link to their load from our conversation.
ok("...not even its own load named in our line", (await links(BEN, [M2], ORG_B)).length === 0);
await db.query(`select chat_retract($1,$2,$3)`, [ORG, ANA, M4]);
ok("a retracted line has no links", (await links(BEN, [M4])).length === 0);
const DRIVER_THREAD = (await one(`insert into message_threads (org_id, created_by) values ($1,$2) returning id`, [ORG, ANA])).id;
await db.query(`insert into thread_participants (thread_id, org_id, user_id, role) values ($1,$2,$3,'office')`, [DRIVER_THREAD, ORG, ANA]);
const DRV = await uuid();
await db.query(`insert into messages (id, thread_id, org_id, sender_user_id, body) values ($1,$2,$3,$4,'load 0137581 delivered')`, [DRV, DRIVER_THREAD, ORG, ANA]);
ok("a driver conversation's line is never read for links", (await links(ANA, [DRV])).length === 0);
await db.query(`select chat_leave($1,$2,$3,null)`, [ORG, BEN, GROUP]);
ok("once Ben has left, he gets none", (await links(BEN, [M1])).length === 0);
ok("Ana, still in it, still does", (await links(ANA, [M1])).length === 2);
ok("no ids, no rows", (await links(ANA, [])).length === 0);

// ── The browser ───────────────────────────────────────────────────────────────────────────────────
console.log("\n-- the browser --");
ok("a browser cannot call chat_line_links", !!(await asUser({ sub: ANA, role: "authenticated" }, `select * from chat_line_links('${ORG}','${ANA}',array['${M1}']::uuid[])`)).error);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
