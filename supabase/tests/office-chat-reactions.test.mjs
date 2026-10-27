// Silvicom 360 — office chat reactions, pins and saved lines (migration 0523, OFFICE-CHAT-PLAN CH6c-1).
//
// What the database itself must guarantee, whoever calls the functions (§9.2's rows):
//   · one reaction of a kind per person per line, and only the six (D-CHAT26);
//   · reacting or pinning bumps the line's `rev` — so `/sync` re-delivers it — and writes one ledger
//     row; doing it again changes nothing and writes nothing; taking it back does both once more;
//   · a retracted line refuses reactions and pins, and stops showing the ones it had;
//   · saving is invisible to every other reader, moves no `rev` and writes no ledger row (D-CHAT24);
//   · the four readers carry reactions, the pin and the caller's own save; the pins and saved lists
//     show only what the caller may still read;
//   · the ledger refuses UPDATE/DELETE of the new actions as of all others, and still verifies;
//   · nothing of another organisation's; a browser can call none of it.
//
// Run: node supabase/tests/office-chat-reactions.test.mjs
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
const send = async (actor, thread, body) => {
  const mid = await uuid();
  await db.query(`select * from chat_send($1,$2,$3,$4,$5)`, [ORG, actor, thread, mid, body]);
  return mid;
};
const reply = async (actor, thread, parent, body) => {
  const mid = await uuid();
  await db.query(`select * from chat_send_reply($1,$2,$3,$4,$5,$6)`, [ORG, actor, thread, mid, parent, body]);
  return mid;
};
const react = (actor, message, reaction, on = true, org = ORG) =>
  db.query(`select chat_react($1,$2,$3,$4,$5) rev`, [org, actor, message, reaction, on]);
const pin = (actor, message, on = true) => db.query(`select chat_pin($1,$2,$3,$4) rev`, [ORG, actor, message, on]);
const save = (user, message, on = true) => db.query(`select chat_save($1,$2,$3,$4)`, [ORG, user, message, on]);
const revOf = async (message) => Number((await one(`select rev from messages where id=$1`, [message])).rev);
const threadRev = async (thread) => Number((await one(`select rev from message_threads where id=$1`, [thread])).rev);
const ledgerN = async () => Number((await one(`select count(*) n from chat_ledger where org_id=$1`, [ORG])).n);
const facts = async (message) => (await all(`select action, actor_user_id, subject_user_id, detail from chat_ledger where message_id=$1 order by seq`, [message]));
const line = async (user, thread, message) => (await all(`select * from chat_history($1,$2,$3,null,50)`, [ORG, user, thread])).find((m) => m.id === message);

// A group of Ana, Ben and Cleo; a Dispatch team with its General channel.
const GROUP = await uuid();
await db.query(`select chat_create_group($1,$2,$3,'Night desk',$4)`, [ORG, ANA, GROUP, [BEN, CLEO]]);
const DISPATCH = await uuid(), GENERAL = await uuid();
await db.query(`select chat_team_create($1,$2,$3,$4,'Dispatch',null,$5)`, [ORG, BEN, DISPATCH, GENERAL, [ANA, CLEO, DEV]]);

// ── Reactions ─────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- reactions --");
const M1 = await send(ANA, GROUP, "Truck 12 is loaded");
let rev0 = await revOf(M1), ledger0 = await ledgerN();
const r1 = Number((await react(BEN, M1, "thumbs_up")).rows[0].rev);
ok("reacting bumps the line's rev to the conversation's next one, and answers it",
  r1 > rev0 && r1 === (await revOf(M1)) && r1 === (await threadRev(GROUP)));
ok("...and writes one ledger row naming who, what and which line",
  (await ledgerN()) === ledger0 + 1
  && JSON.stringify((await facts(M1)).at(-1)) === JSON.stringify({ action: "reaction_added", actor_user_id: BEN, subject_user_id: BEN, detail: { reaction: "thumbs_up" } }),
  JSON.stringify(await facts(M1)));
ok("/sync re-delivers the line after the rev its tab held",
  (await all(`select id from chat_sync($1,$2,$3,$4,200)`, [ORG, CLEO, GROUP, rev0])).some((m) => m.id === M1));

const r2 = Number((await react(BEN, M1, "thumbs_up")).rows[0].rev);
ok("one reaction of a kind per person per line: the second 👍 changes nothing and writes nothing",
  r2 === r1 && (await ledgerN()) === ledger0 + 1
  && Number((await one(`select count(*) n from message_reactions where message_id=$1`, [M1])).n) === 1);
ok("...and the table itself refuses a second one",
  (await sqlstate(`insert into message_reactions (message_id, user_id, reaction, org_id, thread_id) values ($1,$2,'thumbs_up',$3,$4)`, [M1, BEN, ORG, GROUP])) === "23505");
await react(CLEO, M1, "thumbs_up");
await react(BEN, M1, "done");
await react(CLEO, M1, "heart");
let seen = await line(ANA, GROUP, M1);
ok("the reader carries reactions in D-CHAT26's order, each kind's people in the order they reacted",
  JSON.stringify(seen.reactions.map((r) => ({ reaction: r.reaction, users: r.users }))) === JSON.stringify([
    { reaction: "thumbs_up", users: [BEN, CLEO] }, { reaction: "heart", users: [CLEO] }, { reaction: "done", users: [BEN] },
  ]), JSON.stringify(seen.reactions));
ok("only the six are reactions", (await sqlstate(`select chat_react($1,$2,$3,'angry',true)`, [ORG, BEN, M1])) === "CH006"
  && (await sqlstate(`select chat_react($1,$2,$3,null,true)`, [ORG, BEN, M1])) === "CH006"
  && (await sqlstate(`insert into message_reactions (message_id, user_id, reaction, org_id, thread_id) values ($1,$2,'angry',$3,$4)`, [M1, ANA, ORG, GROUP])) === "23514");

rev0 = await revOf(M1); ledger0 = await ledgerN();
await react(BEN, M1, "done", false);
ok("taking a reaction back bumps the rev and writes reaction_removed",
  (await revOf(M1)) > rev0 && (await ledgerN()) === ledger0 + 1 && (await facts(M1)).at(-1).action === "reaction_removed"
  && !(await line(ANA, GROUP, M1)).reactions.some((r) => r.reaction === "done"));
rev0 = await revOf(M1); ledger0 = await ledgerN();
await react(BEN, M1, "done", false);
ok("...and taking back one you do not have changes nothing", (await revOf(M1)) === rev0 && (await ledgerN()) === ledger0);
ok("a reaction is nobody else's to take back: Cleo's ❤️ survives Ben's unreact",
  (await react(BEN, M1, "heart", false), (await line(ANA, GROUP, M1)).reactions.some((r) => r.reaction === "heart")));
ok("a reaction changes neither the words nor their hash, so no version is written",
  Number((await one(`select count(*) n from message_versions where message_id=$1`, [M1])).n) === 0
  && (await one(`select edited_at from messages where id=$1`, [M1])).edited_at === null);

ok("somebody not in the conversation cannot react", (await sqlstate(`select chat_react($1,$2,$3,'heart',true)`, [ORG, DEV, M1])) === "CH001");
ok("...nor another organisation", (await sqlstate(`select chat_react($1,$2,$3,'heart',true)`, [ORG_B, OUT, M1])) === "CH001");
const POST = await send(CLEO, GENERAL, "Who has the 4417 paperwork?");
const R1 = await reply(DEV, GENERAL, POST, "I do");
await react(ANA, R1, "thumbs_up");
ok("a channel's reply takes a reaction, and its reader carries it",
  (await all(`select * from chat_replies($1,$2,$3,null,50)`, [ORG, CLEO, POST]))[0].reactions[0].users[0] === ANA);
await react(ANA, POST, "laugh");
ok("...as does its post, in the posts reader",
  (await all(`select * from chat_channel_posts($1,$2,$3,null,50)`, [ORG, DEV, GENERAL])).find((m) => m.id === POST).reactions[0].reaction === "laugh");

// A driver conversation (0096) is not office chat's.
const DRIVER_THREAD = (await one(`insert into message_threads (org_id, created_by) values ($1,$2) returning id`, [ORG, ANA])).id;
await db.query(`insert into thread_participants (thread_id, org_id, user_id, role) values ($1,$2,$3,'office')`, [DRIVER_THREAD, ORG, ANA]);
const DRV = await uuid();
await db.query(`insert into messages (id, thread_id, org_id, sender_user_id, body) values ($1,$2,$3,$4,'on my way')`, [DRV, DRIVER_THREAD, ORG, ANA]);
ok("a driver conversation takes no reaction, pin or save",
  (await sqlstate(`select chat_react($1,$2,$3,'heart',true)`, [ORG, ANA, DRV])) === "CH006"
  && (await sqlstate(`select chat_pin($1,$2,$3,true)`, [ORG, ANA, DRV])) === "CH006"
  && (await sqlstate(`select chat_save($1,$2,$3,true)`, [ORG, ANA, DRV])) === "CH006");

// ── Pins ──────────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- pins --");
const M2 = await send(BEN, GROUP, "Gate code is 4417");
rev0 = await revOf(M2); ledger0 = await ledgerN();
await pin(CLEO, M2);
ok("pinning bumps the line's rev and writes message_pinned by the person who pinned",
  (await revOf(M2)) > rev0 && (await ledgerN()) === ledger0 + 1
  && (await facts(M2)).at(-1).action === "message_pinned" && (await facts(M2)).at(-1).actor_user_id === CLEO);
const pinnedAt = (await line(ANA, GROUP, M2)).pinned_at;
ok("the reader carries the pin to everybody in it", pinnedAt instanceof Date && (await line(BEN, GROUP, M2)).pinned_at?.getTime() === pinnedAt.getTime());
rev0 = await revOf(M2); ledger0 = await ledgerN();
await pin(ANA, M2);
ok("pinning it again changes nothing and keeps who pinned it", (await revOf(M2)) === rev0 && (await ledgerN()) === ledger0
  && (await one(`select pinned_by from chat_pins where message_id=$1`, [M2])).pinned_by === CLEO);
await new Promise((r) => setTimeout(r, 20));
await pin(BEN, M1);
let pins = await all(`select * from chat_pins($1,$2,$3)`, [ORG, ANA, GROUP]);
ok("a conversation's pins, the latest first, with who pinned each",
  pins.map((p) => p.id).join() === [M1, M2].join() && pins[1].pinned_by_name === "Cleo Safety" && pins[1].body === "Gate code is 4417", JSON.stringify(pins));
rev0 = await revOf(M1); ledger0 = await ledgerN();
await pin(ANA, M1, false);
ok("anybody in it may unpin: rev bumped, message_unpinned by the person who did",
  (await revOf(M1)) > rev0 && (await ledgerN()) === ledger0 + 1
  && (await facts(M1)).at(-1).action === "message_unpinned" && (await facts(M1)).at(-1).actor_user_id === ANA
  && (await line(ANA, GROUP, M1)).pinned_at === null);
ok("somebody not in the conversation can neither pin nor list its pins",
  (await sqlstate(`select chat_pin($1,$2,$3,true)`, [ORG, DEV, M1])) === "CH001"
  && (await sqlstate(`select * from chat_pins($1,$2,$3)`, [ORG, DEV, GROUP])) === "CH001");

// ── Retracted lines ───────────────────────────────────────────────────────────────────────────────
console.log("\n-- retracted --");
const GONE = await send(ANA, GROUP, "wrong truck");
await react(BEN, GONE, "sad");
await pin(BEN, GONE);
await save(BEN, GONE);
await db.query(`select chat_retract($1,$2,$3)`, [ORG, ANA, GONE]);
rev0 = await revOf(GONE); ledger0 = await ledgerN();
ok("a retracted line refuses a reaction (CH004) and writes nothing",
  (await sqlstate(`select chat_react($1,$2,$3,'heart',true)`, [ORG, CLEO, GONE])) === "CH004" && (await revOf(GONE)) === rev0 && (await ledgerN()) === ledger0);
await pin(BEN, GONE, false);
ok("...and a pin", (await sqlstate(`select chat_pin($1,$2,$3,true)`, [ORG, CLEO, GONE])) === "CH004");
ok("...and a save, though it can still be unsaved",
  (await sqlstate(`select chat_save($1,$2,$3,true)`, [ORG, CLEO, GONE])) === "CH004" && (await sqlstate(`select chat_save($1,$2,$3,false)`, [ORG, BEN, GONE])) === null);
ok("...even by a hand-written insert", (await sqlstate(`insert into message_reactions (message_id, user_id, reaction, org_id, thread_id) values ($1,$2,'heart',$3,$4)`, [GONE, CLEO, ORG, GROUP])) === "CH004");
const gone = await line(BEN, GROUP, GONE);
ok("a retracted line shows no reactions and no pin", JSON.stringify(gone.reactions) === "[]" && gone.pinned_at === null);
await pin(BEN, M2);
const G2 = await send(ANA, GROUP, "also wrong");
await pin(BEN, G2);
await db.query(`select chat_retract($1,$2,$3)`, [ORG, ANA, G2]);
ok("...and drops out of the pins list", !(await all(`select * from chat_pins($1,$2,$3)`, [ORG, ANA, GROUP])).some((p) => p.id === G2));

// A hand-written row takes its place from its message, whatever it claims.
const M3 = await send(ANA, GROUP, "placed");
await db.query(`insert into message_reactions (message_id, user_id, reaction, org_id, thread_id) values ($1,$2,'heart',$3,$4)`, [M3, BEN, ORG_B, GENERAL]);
const placed = await one(`select org_id, thread_id from message_reactions where message_id=$1`, [M3]);
ok("a reaction's organisation and conversation are its message's, never the writer's", placed.org_id === ORG && placed.thread_id === GROUP);

// ── Saved ─────────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- saved --");
rev0 = await revOf(M2); ledger0 = await ledgerN();
let tRev = await threadRev(GROUP);
await save(CLEO, M2);
ok("saving moves no rev and writes no ledger row", (await revOf(M2)) === rev0 && (await threadRev(GROUP)) === tRev && (await ledgerN()) === ledger0);
ok("the saver's reader says saved; nobody else's does",
  (await line(CLEO, GROUP, M2)).saved === true && (await line(ANA, GROUP, M2)).saved === false && (await line(BEN, GROUP, M2)).saved === false);
ok("...in /sync too", (await all(`select * from chat_sync($1,$2,$3,0,200)`, [ORG, ANA, GROUP])).every((m) => m.saved === false));
await save(CLEO, M2);
ok("saving twice is one save", Number((await one(`select count(*) n from chat_saved where user_id=$1`, [CLEO])).n) === 1);
await new Promise((r) => setTimeout(r, 20));
await save(CLEO, R1);
let saved = await all(`select * from chat_saved($1,$2,null,null,50)`, [ORG, CLEO]);
ok("the saved list is the saver's, newest first, with where each line is",
  saved.map((s) => s.message_id).join() === [R1, M2].join()
  && saved[0].kind === "channel" && saved[0].parent_id === POST && saved[1].subject === "Night desk" && saved[1].sender_name === "Ben Admin", JSON.stringify(saved));
ok("...and nobody else's", (await all(`select * from chat_saved($1,$2,null,null,50)`, [ORG, ANA])).length === 0
  && (await all(`select * from chat_saved($1,$2,null,null,50)`, [ORG_B, CLEO])).length === 0);
const p1 = await all(`select * from chat_saved($1,$2,null,null,1)`, [ORG, CLEO]);
const p2 = await all(`select * from chat_saved($1,$2,$3,$4,1)`, [ORG, CLEO, p1[0].saved_at, p1[0].message_id]);
ok("...and pages without repeating or skipping", p1[0].message_id === R1 && p2.length === 1 && p2[0].message_id === M2);
await db.query(`select chat_leave($1,$2,$3,null)`, [ORG, CLEO, GROUP]);
ok("a saved line of a conversation you left leaves the list", !(await all(`select * from chat_saved($1,$2,null,null,50)`, [ORG, CLEO])).some((s) => s.message_id === M2));
await db.query(`select chat_add_members($1,$2,$3,$4)`, [ORG, ANA, GROUP, [CLEO]]);
await save(CLEO, M2, false);
ok("unsaving takes it off", !(await all(`select * from chat_saved($1,$2,null,null,50)`, [ORG, CLEO])).some((s) => s.message_id === M2));
ok("somebody not in the conversation cannot save its line", (await sqlstate(`select chat_save($1,$2,$3,true)`, [ORG, DEV, M2])) === "CH001");

// ── Archived ──────────────────────────────────────────────────────────────────────────────────────
await db.query(`update message_threads set archived_at = now() where id=$1`, [GROUP]);
ok("an archived conversation takes no reaction or pin (CH005), but a line can still be saved",
  (await sqlstate(`select chat_react($1,$2,$3,'heart',true)`, [ORG, BEN, M2])) === "CH005"
  && (await sqlstate(`select chat_pin($1,$2,$3,false)`, [ORG, BEN, M2])) === "CH005"
  && (await sqlstate(`select chat_save($1,$2,$3,true)`, [ORG, BEN, M2])) === null);
await db.query(`update message_threads set archived_at = null where id=$1`, [GROUP]);

// ── The ledger and the browser ────────────────────────────────────────────────────────────────────
console.log("\n-- ledger and access --");
for (const action of ["reaction_added", "reaction_removed", "message_pinned", "message_unpinned"]) {
  const row = await one(`select id from chat_ledger where action=$1 limit 1`, [action]);
  ok(`the ledger refuses UPDATE of ${action}`, (await sqlstate(`update chat_ledger set detail='{}' where id=$1`, [row.id])) === "CL001");
  ok(`...and DELETE`, (await sqlstate(`delete from chat_ledger where id=$1`, [row.id])) === "CL001");
}
ok("the ledger still verifies", (await one(`select * from chat_ledger_verify($1, 0)`, [ORG])).problem === null);

const claims = { sub: BEN, role: "authenticated" };
for (const [what, sql] of [
  ["chat_react", `select chat_react('${ORG}','${BEN}','${M2}','heart',true)`],
  ["chat_pin", `select chat_pin('${ORG}','${BEN}','${M2}',true)`],
  ["chat_save", `select chat_save('${ORG}','${BEN}','${M2}',true)`],
  ["chat_pins", `select * from chat_pins('${ORG}','${BEN}','${GROUP}')`],
  ["chat_saved", `select * from chat_saved('${ORG}','${BEN}',null,null,50)`],
]) {
  ok(`a browser cannot call ${what}`, !!(await asUser(claims, sql)).error);
}
for (const table of ["message_reactions", "chat_pins", "chat_saved"]) {
  const r = await asUser(claims, `select count(*) n from ${table}`);
  ok(`a browser reads no ${table} rows`, !!r.error || Number(r.rows[0].n) === 0);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
