// Silvicom 360 — office chat files (migration 0539, OFFICE-CHAT-PLAN CH7; D-CHAT27–D-CHAT30).
//
// What the database itself must guarantee, whoever calls the functions:
//   · a line's files are written with it, in one call, in the order given, only when each one's bytes
//     are in the `chat-files` bucket under the key the database derives — never a key the caller chose;
//   · a retry of the same line adds no second set of files;
//   · a line may be only files (D-CHAT29), but a line with neither words nor a file is refused at commit
//     (CH014) — on the plain `chat_send` path and on the driver path too;
//   · a file is evidence (D-CHAT28): never changed, never removed while its line exists, ledgered with its
//     hash, and the ledger still verifies;
//   · the readers carry a line's files and stop showing them once the line is retracted; `chat_file_for`
//     answers only somebody in the conversation, and not for a retracted line; `chat_files` lists them;
//   · nothing of another organisation's; a browser can call none of it.
//
// Run: node supabase/tests/office-chat-files.test.mjs
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
const DEV = await person("dev@silvicom.test", ORG, "dispatcher", "Dev Dispatch");
const OUT = await person("outsider@other.test", ORG_B, "admin", "Other Admin");

const uuid = async () => (await one(`select gen_random_uuid() id`)).id;
const SHA = (c) => c.repeat(64);
/** The browser's upload: an object under the key the database will derive. */
const upload = async (thread, id, org = ORG) =>
  db.query(`insert into storage.objects (bucket_id, name) values ('chat-files', $1)`, [`${org}/${thread}/${id}`]);
const file = (id, name = "trailer.jpg", over = {}) => ({ id, file_name: name, mime: "image/jpeg", byte_size: 2048, sha256: SHA("a"), ...over });
const sendFiles = (actor, thread, mid, body, files, parent = null, org = ORG) =>
  db.query(`select * from chat_send_files($1,$2,$3,$4,$5,$6,$7)`, [org, actor, thread, mid, parent, body, JSON.stringify(files)]);
const history = async (user, thread) => all(`select * from chat_history($1,$2,$3,null,50)`, [ORG, user, thread]);

const GROUP = await uuid();
await db.query(`select chat_create_group($1,$2,$3,'Night desk',$4)`, [ORG, ANA, GROUP, [BEN]]);
const DISPATCH = await uuid(), GENERAL = await uuid();
await db.query(`select chat_team_create($1,$2,$3,$4,'Dispatch',null,$5)`, [ORG, BEN, DISPATCH, GENERAL, [ANA]]);

console.log("\n-- the bucket --");
const bucket = await one(`select public, file_size_limit from storage.buckets where id='chat-files'`);
ok("chat-files is private and capped at 25 MB", bucket?.public === false && Number(bucket.file_size_limit) === 25 * 1024 * 1024);

console.log("\n-- sending with files --");
const F1 = await uuid(), F2 = await uuid(), M1 = await uuid();
await upload(GROUP, F1); await upload(GROUP, F2);
const sent = (await sendFiles(ANA, GROUP, M1, "Damage on 455's trailer", [file(F1), file(F2, "report.pdf", { mime: "application/pdf", sha256: SHA("B") })])).rows[0];
ok("a line with files is sent once and answers like chat_send", sent.message_id === M1 && sent.duplicate === false);
const rows = await all(`select id, position, storage_path, org_id, thread_id, uploaded_by, sha256 from chat_attachments where message_id=$1 order by position`, [M1]);
ok("its files are written in the order given, keyed by the database, by its sender",
  rows.map((r) => r.id).join() === [F1, F2].join() && rows[0].storage_path === `${ORG}/${GROUP}/${F1}` && rows.every((r) => r.uploaded_by === ANA));
ok("a hash is stored lower-case, as the CHECK requires", rows[1].sha256 === SHA("b"));
const again = (await sendFiles(ANA, GROUP, M1, "Damage on 455's trailer", [file(F1), file(F2)])).rows[0];
ok("a retry of the same line answers the first send and adds no files",
  again.duplicate === true && Number((await one(`select count(*) n from chat_attachments where message_id=$1`, [M1])).n) === 2);

const F3 = await uuid(), M2 = await uuid();
ok("a file whose bytes are not in the bucket refuses the whole line (CH015) and leaves no line",
  (await sqlstate(`select * from chat_send_files($1,$2,$3,$4,null,'x',$5)`, [ORG, ANA, GROUP, M2, JSON.stringify([file(F3)])])) === "CH015"
  && !(await one(`select 1 x from messages where id=$1`, [M2])));
await upload(GENERAL, F3); // the right id, the WRONG conversation's key
ok("...and so does an object stored under another conversation's key",
  (await sqlstate(`select * from chat_send_files($1,$2,$3,$4,null,'x',$5)`, [ORG, ANA, GROUP, M2, JSON.stringify([file(F3)])])) === "CH015");
ok("no files, or more than ten, is CH015",
  (await sqlstate(`select * from chat_send_files($1,$2,$3,$4,null,'x','[]')`, [ORG, ANA, GROUP, M2])) === "CH015"
  && (await sqlstate(`select * from chat_send_files($1,$2,$3,$4,null,'x',$5)`, [ORG, ANA, GROUP, M2, JSON.stringify(Array.from({ length: 11 }, () => file(F1)))])) === "CH015");
const F4 = await uuid(); await upload(GROUP, F4);
ok("a name with a path in it, an empty name, a size over 25 MB or a malformed hash is refused by the table",
  (await sqlstate(`select * from chat_send_files($1,$2,$3,$4,null,'x',$5)`, [ORG, ANA, GROUP, await uuid(), JSON.stringify([file(F4, "../etc/passwd")])])) === "23514"
  && (await sqlstate(`select * from chat_send_files($1,$2,$3,$4,null,'x',$5)`, [ORG, ANA, GROUP, await uuid(), JSON.stringify([file(F4, "  ")])])) === "23514"
  && (await sqlstate(`select * from chat_send_files($1,$2,$3,$4,null,'x',$5)`, [ORG, ANA, GROUP, await uuid(), JSON.stringify([file(F4, "big.zip", { byte_size: 26 * 1024 * 1024 })])])) === "23514"
  && (await sqlstate(`select * from chat_send_files($1,$2,$3,$4,null,'x',$5)`, [ORG, ANA, GROUP, await uuid(), JSON.stringify([file(F4, "a.jpg", { sha256: "abc" })])])) === "23514");

console.log("\n-- words or files (D-CHAT29) --");
const M3 = await uuid();
await sendFiles(ANA, GROUP, M3, "", [file(F4, "only-a-photo.jpg")]);
ok("a line may be only files", (await one(`select body from messages where id=$1`, [M3])).body === "");
ok("a line with neither words nor a file is refused at commit (CH014)",
  (await sqlstate(`select * from chat_send($1,$2,$3,$4,'   ')`, [ORG, ANA, GROUP, await uuid()])) === "CH014");
const M4 = await uuid();
await db.query(`select * from chat_send($1,$2,$3,$4,'words')`, [ORG, ANA, GROUP, M4]);
ok("...and emptying a line with words but no files is CH014", (await sqlstate(`select chat_edit($1,$2,$3,'')`, [ORG, ANA, M4])) === "CH014");
ok("emptying the words of a line that has files is allowed — the files still say something",
  (await sqlstate(`select chat_edit($1,$2,$3,'')`, [ORG, ANA, M1])) === null);

console.log("\n-- replies --");
const POST = await uuid();
await db.query(`select * from chat_send($1,$2,$3,$4,'Weekly photos')`, [ORG, BEN, GENERAL, POST]);
const F5 = await uuid(), R1 = await uuid();
await upload(GENERAL, F5);
await sendFiles(ANA, GENERAL, R1, "", [file(F5)], POST);
const rep = (await all(`select * from chat_replies($1,$2,$3,null,50)`, [ORG, BEN, POST])).find((m) => m.id === R1);
ok("a reply carries files, and the replies reader shows them", rep?.parent_id === POST && rep.attachments.length === 1 && rep.attachments[0].id === F5);

console.log("\n-- reading --");
const seen = (await history(BEN, GROUP)).find((m) => m.id === M1);
ok("the readers carry a line's files in order: id, name, type and size — never the storage key",
  seen.attachments.map((a) => a.id).join() === [F1, F2].join() && seen.attachments[1].file_name === "report.pdf"
  && !("storage_path" in seen.attachments[0]) && Number(seen.attachments[0].byte_size) === 2048);
ok("...in /sync too", (await all(`select * from chat_sync($1,$2,$3,0,200)`, [ORG, BEN, GROUP])).find((m) => m.id === M1).attachments.length === 2);
ok("...and in a channel's posts", (await all(`select * from chat_channel_posts($1,$2,$3,null,50)`, [ORG, ANA, GENERAL])).every((m) => Array.isArray(m.attachments)));
const where = await one(`select * from chat_file_for($1,$2,$3)`, [ORG, BEN, F2]);
ok("chat_file_for answers where the bytes are for somebody in the conversation", where.storage_path === `${ORG}/${GROUP}/${F2}` && where.mime === "application/pdf");
ok("...and refuses somebody not in it, and another organisation (CH001)",
  (await sqlstate(`select * from chat_file_for($1,$2,$3)`, [ORG, DEV, F2])) === "CH001"
  && (await sqlstate(`select * from chat_file_for($1,$2,$3)`, [ORG_B, OUT, F2])) === "CH001");
const list = await all(`select * from chat_files($1,$2,$3,null,null,50)`, [ORG, BEN, GROUP]);
ok("chat_files lists the conversation's files newest first, with who sent each",
  list.length === 3 && list[0].id === F4 && list.every((f) => f.uploaded_by_name === "Ana Petrović"));
const p1 = await all(`select * from chat_files($1,$2,$3,null,null,1)`, [ORG, BEN, GROUP]);
const p2 = await all(`select * from chat_files($1,$2,$3,$4,$5,1)`, [ORG, BEN, GROUP, p1[0].created_at, p1[0].id]);
ok("...and pages without repeating", p2.length === 1 && p2[0].id !== p1[0].id);
ok("...only for somebody in it", (await sqlstate(`select * from chat_files($1,$2,$3,null,null,50)`, [ORG, DEV, GROUP])) === "CH001");

console.log("\n-- retracting --");
await db.query(`select chat_retract($1,$2,$3)`, [ORG, ANA, M1]);
ok("a retracted line stops showing its files", (await history(BEN, GROUP)).find((m) => m.id === M1).attachments.length === 0);
ok("...its files leave the files list", !(await all(`select * from chat_files($1,$2,$3,null,null,50)`, [ORG, BEN, GROUP])).some((f) => f.message_id === M1));
ok("...and are no longer served (CH004)", (await sqlstate(`select * from chat_file_for($1,$2,$3)`, [ORG, BEN, F1])) === "CH004");
ok("...but the rows stay, as the line's words do", Number((await one(`select count(*) n from chat_attachments where message_id=$1`, [M1])).n) === 2);

console.log("\n-- evidence (D-CHAT28) --");
ok("a file is never changed (CH003)", (await sqlstate(`update chat_attachments set file_name='renamed.jpg' where id=$1`, [F4])) === "CH003");
ok("...and never removed while its line exists (CH003)", (await sqlstate(`delete from chat_attachments where id=$1`, [F4])) === "CH003");
const facts = await all(`select action, actor_user_id, detail from chat_ledger where message_id=$1 and action='file_attached' order by seq`, [M3]);
ok("each file is ledgered as file_attached, by its sender, with its hash, size and name",
  facts.length === 1 && facts[0].actor_user_id === ANA && facts[0].detail.sha256 === SHA("a") && Number(facts[0].detail.byte_size) === 2048 && facts[0].detail.file_name === "only-a-photo.jpg");
const fRow = await one(`select id from chat_ledger where action='file_attached' limit 1`);
ok("the ledger refuses UPDATE of file_attached", (await sqlstate(`update chat_ledger set detail='{}' where id=$1`, [fRow.id])) === "CL001");
ok("...and DELETE", (await sqlstate(`delete from chat_ledger where id=$1`, [fRow.id])) === "CL001");
ok("the ledger still verifies", (await one(`select * from chat_ledger_verify($1, 0)`, [ORG])).problem === null);

console.log("\n-- who may --");
await db.query(`update message_threads set archived_at = now() where id=$1`, [GROUP]);
ok("an archived conversation takes no file (CH005)", (await sqlstate(`select chat_file_can_upload($1,$2,$3)`, [ORG, ANA, GROUP])) === "CH005");
await db.query(`update message_threads set archived_at = null where id=$1`, [GROUP]);
ok("somebody in it may upload; somebody not in it, or another organisation, may not (CH001)",
  (await one(`select chat_file_can_upload($1,$2,$3) v`, [ORG, ANA, GROUP])).v === true
  && (await sqlstate(`select chat_file_can_upload($1,$2,$3)`, [ORG, DEV, GROUP])) === "CH001"
  && (await sqlstate(`select chat_file_can_upload($1,$2,$3)`, [ORG_B, OUT, GROUP])) === "CH001");
const F6 = await uuid(); await upload(GROUP, F6, ORG_B);
ok("another organisation cannot send a file into this conversation (CH001)",
  (await sqlstate(`select * from chat_send_files($1,$2,$3,$4,null,'x',$5)`, [ORG_B, OUT, GROUP, await uuid(), JSON.stringify([file(F6)])])) === "CH001");

const claims = { sub: BEN, role: "authenticated" };
for (const [what, sql] of [
  ["chat_send_files", `select * from chat_send_files('${ORG}','${BEN}','${GROUP}',gen_random_uuid(),null,'x','[]')`],
  ["chat_file_for", `select * from chat_file_for('${ORG}','${BEN}','${F2}')`],
  ["chat_files", `select * from chat_files('${ORG}','${BEN}','${GROUP}',null,null,50)`],
  ["chat_file_can_upload", `select chat_file_can_upload('${ORG}','${BEN}','${GROUP}')`],
]) {
  ok(`a browser cannot call ${what}`, !!(await asUser(claims, sql)).error);
}
const r = await asUser(claims, `select count(*) n from chat_attachments`);
ok("a browser reads no chat_attachments rows", !!r.error || Number(r.rows[0].n) === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
