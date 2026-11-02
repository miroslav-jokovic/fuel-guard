// Silvicom 360 — the compliance console and its export carry a line's files (migration 0544,
// OFFICE-CHAT-PLAN §9.3 "Open after CH7"; D-CHAT28, CHA2, CHA3b).
//
// What the database itself must guarantee, whoever calls the functions:
//   · the console's conversation view, its message search and the export each carry every line's files,
//     in the order sent, with name, kind, size and SHA-256 — for a retracted line too — and never a
//     storage key;
//   · opening a file for review writes a compliance_view ledger row naming the file, its hash and the
//     reason, BEFORE it answers the storage key; no reason, or another organisation's file, writes nothing;
//   · an export says how many files and bytes it carries (header and ledger), refuses past 1 GB, and
//     hands the API the keys of that export's files only, while it is being built;
//   · the ledger still verifies; a browser can call none of it.
//
// Run: node supabase/tests/office-chat-compliance-files.test.mjs
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
const REASON = { category: "hr", text: "Grievance HR-14: messages about the night shift" };
const OTHER_GROUP = await uuid();
const OUT2 = await person("out2@other.test", ORG_B, "dispatcher", "Other Two");
await db.query(`select chat_create_group($1,$2,$3,'Elsewhere',$4)`, [ORG_B, OUT, OTHER_GROUP, [OUT2]]);

// Two lines with files, one of them retracted afterwards; one line of words only.
const F1 = await uuid(), F2 = await uuid(), F3 = await uuid(), FB = await uuid();
for (const f of [F1, F2, F3]) await upload(GROUP, f);
const M1 = await uuid(), M2 = await uuid(), M3 = await uuid();
await sendFiles(ANA, GROUP, M1, "Truck 702 loaded", [file(F1, "front.jpg", { sha256: SHA("1") }), file(F2, "BOL.pdf", { mime: "application/pdf", byte_size: 9000, sha256: SHA("2") })]);
await sendFiles(ANA, GROUP, M2, "", [file(F3, "wrong.jpg", { sha256: SHA("3") })]);
await db.query(`select * from chat_send($1,$2,$3,$4,'words only')`, [ORG, BEN, GROUP, M3]);
await db.query(`select chat_retract($1,$2,$3)`, [ORG, ANA, M2]);
await upload(OTHER_GROUP, FB, ORG_B);
await sendFiles(OUT, OTHER_GROUP, await uuid(), "elsewhere", [file(FB, "theirs.jpg")], null, ORG_B);

// A file in another conversation of the same organisation: no export of GROUP may count it.
const FG = await uuid();
await upload(GENERAL, FG);
await sendFiles(BEN, GENERAL, await uuid(), "elsewhere in the org", [file(FG, "yard.jpg", { byte_size: 5000 })]);

const shape = (a) => a.map((f) => [f.file_name, f.mime, Number(f.byte_size), f.sha256, f.uploaded_by]);

// ── The conversation view ─────────────────────────────────────────────────────────────────────────
console.log("\n-- the conversation view --");
const view = await one(`select * from chat_compliance_thread($1,$2,$3,$4,null,50)`, [ORG, BEN, REASON, GROUP]);
const byId = Object.fromEntries(view.messages.map((m) => [m.id, m]));
ok("a line's files, in the order sent, with name, kind, size, hash and who uploaded",
  JSON.stringify(shape(byId[M1].attachments)) === JSON.stringify([["front.jpg", "image/jpeg", 2048, SHA("1"), ANA], ["BOL.pdf", "application/pdf", 9000, SHA("2"), ANA]]),
  JSON.stringify(byId[M1].attachments));
ok("a RETRACTED line's file is still shown to compliance", byId[M2].deleted_at !== null && JSON.stringify(shape(byId[M2].attachments)) === JSON.stringify([["wrong.jpg", "image/jpeg", 2048, SHA("3"), ANA]]));
ok("a line of words only carries an empty list", JSON.stringify(byId[M3].attachments) === "[]");
ok("no storage key anywhere in the view", !JSON.stringify(view).includes("storage_path") && !JSON.stringify(view).includes(`${ORG}/${GROUP}/`));

// ── The message search ────────────────────────────────────────────────────────────────────────────
console.log("\n-- the message search --");
const found = await all(`select * from chat_compliance_messages($1,$2,$3,$4,null,null,null,null,null,null,50)`, [ORG, BEN, REASON, GROUP]);
ok("the search's rows carry their files the same way",
  JSON.stringify(shape(found.find((m) => m.id === M1).attachments)) === JSON.stringify(shape(byId[M1].attachments))
  && found.find((m) => m.id === M3).attachments.length === 0);
ok("...and it still refuses a search without a reason (CH009)",
  (await sqlstate(`select * from chat_compliance_messages($1,$2,null,null,null,null,null,null,null,null,50)`, [ORG, BEN])) === "CH009");

// ── Opening one file ──────────────────────────────────────────────────────────────────────────────
console.log("\n-- opening a file --");
const ledgerN = async () => Number((await one(`select count(*) n from chat_ledger where org_id=$1`, [ORG])).n);
const before = await ledgerN();
const opened = await one(`select * from chat_compliance_file($1,$2,$3,$4)`, [ORG, BEN, REASON, F2]);
ok("it answers the storage key, the name and the kind", opened.storage_path === `${ORG}/${GROUP}/${F2}` && opened.file_name === "BOL.pdf" && opened.mime === "application/pdf");
const row = await one(`select * from chat_ledger where org_id=$1 order by seq desc limit 1`, [ORG]);
ok("...after one compliance_view ledger row naming the file, its line, its hash and the reason",
  (await ledgerN()) === before + 1 && row.action === "compliance_view" && row.actor_user_id === BEN && row.message_id === M1
  && row.thread_id === GROUP && row.body_sha256 === SHA("2") && row.detail.file_id === F2 && row.detail.reason.text === REASON.text,
  JSON.stringify(row));
ok("a retracted line's file can be opened too", (await one(`select * from chat_compliance_file($1,$2,$3,$4)`, [ORG, BEN, REASON, F3])).file_name === "wrong.jpg");
const n2 = await ledgerN();
ok("no reason: refused CH009, nothing ledgered", (await sqlstate(`select * from chat_compliance_file($1,$2,null,$3)`, [ORG, BEN, F1])) === "CH009" && (await ledgerN()) === n2);
ok("another organisation's file: refused CH001, nothing ledgered", (await sqlstate(`select * from chat_compliance_file($1,$2,$3,$4)`, [ORG, BEN, REASON, FB])) === "CH001" && (await ledgerN()) === n2);

// ── The export ────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- the export --");
const EXP = await uuid();
const ex = await one(`select * from chat_compliance_export_rows($1,$2,$3,$4,'conversation',$5,null,null,null,null)`, [ORG, BEN, REASON, EXP, GROUP]);
const lines = Object.fromEntries(ex.lines.map((l) => [l.id, l]));
ok("each exported line carries its files, a retracted one's included",
  JSON.stringify(shape(lines[M1].attachments)) === JSON.stringify(shape(byId[M1].attachments)) && lines[M2].attachments.length === 1 && lines[M3].attachments.length === 0);
ok("the header says how many files and bytes it carries — this conversation's only, not the channel's", ex.export.file_count === 3 && Number(ex.export.file_bytes) === 2048 + 9000 + 2048, JSON.stringify(ex.export));
const exLedger = await one(`select detail from chat_ledger where action='compliance_export' and detail->>'export_id'=$1`, [EXP]);
ok("...and so does its ledger row", exLedger.detail.file_count === 3 && Number(exLedger.detail.file_bytes) === 13096);
ok("no storage key in the export's lines", !JSON.stringify(ex.lines).includes("storage_path"));
const keys = await all(`select * from chat_compliance_file_keys($1,$2,$3)`, [ORG, EXP, [F1, F2, F3]]);
ok("the API gets the keys of that export's files, in the export's order (line, then position)",
  JSON.stringify(keys.map((k) => k.storage_path)) === JSON.stringify([F1, F2, F3].map((f) => `${ORG}/${GROUP}/${f}`)), JSON.stringify(keys));
ok("...never another organisation's", (await all(`select * from chat_compliance_file_keys($1,$2,$3)`, [ORG, EXP, [FB]])).length === 0);
ok("...never under another organisation's id", (await all(`select * from chat_compliance_file_keys($1,$2,$3)`, [ORG_B, EXP, [F1]])).length === 0);
await db.query(`select chat_export_stored($1,$2,array['x'],1,$3)`, [ORG, EXP, SHA("e")]);
ok("...and only while the export is being built", (await all(`select * from chat_compliance_file_keys($1,$2,$3)`, [ORG, EXP, [F1]])).length === 0);

// The 1 GB ceiling, for real: five lines of ten 25 MB files is 1.22 GB in a conversation of its own.
const HEAVY = await uuid();
await db.query(`select chat_create_group($1,$2,$3,'Scans',$4)`, [ORG, ANA, HEAVY, [BEN]]);
const MB25 = 25 * 1024 * 1024;
for (let line = 0; line < 5; line++) {
  const files = [];
  for (let k = 0; k < 10; k++) { const id = await uuid(); await upload(HEAVY, id); files.push(file(id, `scan-${line}-${k}.pdf`, { mime: "application/pdf", byte_size: MB25 })); }
  await sendFiles(ANA, HEAVY, await uuid(), "", files);
}
const n3 = Number((await one(`select count(*) n from chat_exports`)).n);
ok("past 1 GB of files an export is refused (CH010), and nothing is recorded",
  (await sqlstate(`select * from chat_compliance_export_rows($1,$2,$3,$4,'conversation',$5,null,null,null,null)`, [ORG, BEN, REASON, await uuid(), HEAVY])) === "CH010"
  && Number((await one(`select count(*) n from chat_exports`)).n) === n3);
// Forty files (1,000 MB) is under the ceiling: a search from the second line on carries four lines.
const UNDER = await uuid();
const under = await sqlstate(`select * from chat_compliance_export_rows($1,$2,$3,$4,'search',$5,null,$6,null,null)`,
  [ORG, BEN, REASON, UNDER, HEAVY, (await one(`select created_at from messages where thread_id=$1 order by seq offset 1 limit 1`, [HEAVY])).created_at]);
ok("...and 40 files, exactly 1,000 MB, is under it", under === null
  && Number((await one(`select detail from chat_ledger where detail->>'export_id'=$1`, [UNDER])).detail.file_count) === 40, String(under));

// ── The ledger; the browser ───────────────────────────────────────────────────────────────────────
console.log("\n-- the ledger, the browser --");
ok("the ledger still verifies", (await one(`select * from chat_ledger_verify($1, 0)`, [ORG])).problem === null);
const claims = { sub: BEN, role: "authenticated" };
for (const [fn, sql] of [
  ["chat_compliance_file", `select * from chat_compliance_file('${ORG}','${BEN}','${JSON.stringify(REASON)}'::jsonb,'${F1}')`],
  ["chat_compliance_file_keys", `select * from chat_compliance_file_keys('${ORG}','${EXP}',array['${F1}']::uuid[])`],
  ["chat_compliance_line_files", `select chat_compliance_line_files('${M1}')`],
]) {
  ok(`a browser cannot call ${fn}`, !!(await asUser(claims, sql)).error);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
