// Silvicom 360 — office chat legal holds and exports (migration 0517, OFFICE-CHAT-PLAN CHA3a).
//
// What the database itself must guarantee, whoever calls the functions:
//   · a hold is set with a matter and a reason, is only ever RELEASED (once, by a new reason), and can
//     be neither edited nor deleted — not even by the service role;
//   · each hold and each release is a ledger row, whatever wrote it;
//   · an export without a valid reason leaves no row and returns nothing;
//   · an export returns the whole conversation or search, retracted words and earlier versions
//     included, each body with the hash the ledger holds — and its `content_sha256` is the documented
//     fold of those hashes, carried by its own `compliance_export` ledger row;
//   · an export record moves building → ready → purged and no other way;
//   · nothing of another organisation's, and a browser can call none of it.
//
// Run: node supabase/tests/office-chat-holds-exports.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { createHash } from "node:crypto";
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
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

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

// ── People and conversations ────────────────────────────────────────────────────────────────────
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const ORG_B = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other carrier') returning id`)).id;
const person = async (email, org, role, name) => {
  const id = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  await db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,$3)`, [org, id, role]);
  if (name) await db.query(`insert into user_profiles (user_id, full_name) values ($1,$2)`, [id, name]);
  return id;
};
const ANA = await person("ana@silvicom.test", ORG, "dispatcher", "Ana Petrović");
const BEN = await person("ben@silvicom.test", ORG, "admin", "Ben Admin");
const CLEO = await person("cleo@silvicom.test", ORG, "safety_manager", "Cleo Safety");
const OUT = await person("outsider@other.test", ORG_B, "admin", "Other Admin");
const OUT2 = await person("outsider2@other.test", ORG_B, "dispatcher", "Other Dispatcher");

const uuid = async () => (await one(`select gen_random_uuid() id`)).id;
const send = async (org, actor, thread, body) => one(`select * from chat_send($1,$2,$3,$4,$5)`, [org, actor, thread, await uuid(), body]);
const ledgerCount = async (org) => Number((await one(`select count(*)::int n from chat_ledger where org_id=$1`, [org])).n);

const DM = (await one(`select chat_open_direct($1,$2,$3,$4) id`, [ORG, ANA, BEN, await uuid()])).id;
const M1 = (await send(ORG, ANA, DM, "Truck 654 is at the yard.")).message_id;
await db.query(`select chat_edit($1,$2,$3,'Truck 654 is at the YARD GATE.')`, [ORG, ANA, M1]);
const M2 = (await send(ORG, BEN, DM, "Approved, 100% sure.")).message_id;
await db.query(`select chat_retract($1,$2,$3)`, [ORG, BEN, M2]);
const GROUP = (await one(`select chat_create_group($1,$2,$3,'Night dispatch',$4) id`, [ORG, ANA, await uuid(), [BEN, CLEO]])).id;
await send(ORG, CLEO, GROUP, "Night shift starts at 9.");
const OTHER_DM = (await one(`select chat_open_direct($1,$2,$3,$4) id`, [ORG_B, OUT, OUT2, await uuid()])).id;
await send(ORG_B, OUT, OTHER_DM, "Night shift at the other carrier");

const REASON = { category: "legal", text: "Litigation hold, matter 2026-CV-118" };
const RELEASE = { category: "legal", text: "Matter 2026-CV-118 settled, hold lifted by counsel" };

// ── Holds ───────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- holds --");
let before = await ledgerCount(ORG);
ok("no reason, no hold", (await sqlstate(`select chat_hold_set($1,$2,null,'person',$3,'Matter 118')`, [ORG, BEN, ANA])) === "CH009");
ok("no matter, no hold", (await sqlstate(`select chat_hold_set($1,$2,$3,'person',$4,'  ')`, [ORG, BEN, REASON, ANA])) === "CH010");
ok("a hold on another organisation's conversation is refused", (await sqlstate(`select chat_hold_set($1,$2,$3,'conversation',$4,'Matter 118')`, [ORG, BEN, REASON, OTHER_DM])) === "CH001");
ok("a hold on another organisation's person is refused", (await sqlstate(`select chat_hold_set($1,$2,$3,'person',$4,'Matter 118')`, [ORG, BEN, REASON, OUT])) === "CH001");
ok("...and refusals leave no ledger row", (await ledgerCount(ORG)) === before);

const H_PERSON = (await one(`select chat_hold_set($1,$2,$3,'person',$4,'Matter 2026-CV-118') id`, [ORG, BEN, REASON, ANA])).id;
const H_CONV = (await one(`select chat_hold_set($1,$2,$3,'conversation',$4,'Matter 2026-CV-118') id`, [ORG, BEN, REASON, GROUP])).id;
let rows = await all(`select action, actor_user_id, thread_id, subject_user_id, detail from chat_ledger where org_id=$1 and action like 'hold_%' order by seq`, [ORG]);
ok("each hold is a hold_set ledger row with the actor, the target, the matter and the reason", rows.length === 2
  && rows.every((r) => r.action === "hold_set" && r.actor_user_id === BEN && r.detail.matter === "Matter 2026-CV-118" && r.detail.reason.text === REASON.text)
  && rows[0].subject_user_id === ANA && rows[0].thread_id === null && rows[1].thread_id === GROUP && rows[1].detail.hold_id === H_CONV, JSON.stringify(rows));

ok("a hold cannot be deleted, even by the service role", (await sqlstate(`delete from chat_holds where id=$1`, [H_PERSON])) === "CL001");
ok("...nor its matter edited", (await sqlstate(`update chat_holds set matter='Something else' where id=$1`, [H_PERSON])) === "CL001");
ok("...nor truncated", (await sqlstate(`truncate chat_holds`)) === "CL001");

let list = await all(`select * from chat_holds_list($1,false)`, [ORG]);
ok("the active holds are listed with names", list.length === 2 && list.some((h) => h.user_name === "Ana Petrović" && h.set_by_name === "Ben Admin") && list.some((h) => h.thread_subject === "Night dispatch"));

ok("a release needs a reason", (await sqlstate(`select chat_hold_release($1,$2,null,$3)`, [ORG, BEN, H_PERSON])) === "CH009");
ok("another organisation cannot release this org's hold", (await sqlstate(`select chat_hold_release($1,$2,$3,$4)`, [ORG_B, OUT, RELEASE, H_PERSON])) === "CH001");
await db.query(`select chat_hold_release($1,$2,$3,$4)`, [ORG, CLEO, RELEASE, H_PERSON]);
const released = await one(`select * from chat_holds where id=$1`, [H_PERSON]);
ok("a release keeps the hold and records who, when and why", released.released_by === CLEO && released.released_at !== null && released.release_reason.text === RELEASE.text && released.matter === "Matter 2026-CV-118");
ok("a released hold stays released", (await sqlstate(`update chat_holds set released_at=null, released_by=null, release_reason=null where id=$1`, [H_PERSON])) === "CL001");
ok("...and cannot be released twice", (await sqlstate(`select chat_hold_release($1,$2,$3,$4)`, [ORG, BEN, RELEASE, H_PERSON])) === "CH010");
rows = await all(`select actor_user_id, detail from chat_ledger where org_id=$1 and action='hold_released'`, [ORG]);
ok("the release is a hold_released ledger row naming who released it and why", rows.length === 1 && rows[0].actor_user_id === CLEO && rows[0].detail.reason.text === RELEASE.text && rows[0].detail.hold_id === H_PERSON);
list = await all(`select * from chat_holds_list($1,false)`, [ORG]);
ok("the active list drops the released hold", list.length === 1 && list[0].id === H_CONV);
list = await all(`select * from chat_holds_list($1,true)`, [ORG]);
ok("...and the full list keeps it, active first", list.length === 2 && list[0].id === H_CONV && list[1].released_by_name === "Cleo Safety");
ok("the other organisation sees none of these holds", (await all(`select * from chat_holds_list($1,true)`, [ORG_B])).length === 0);

// ── Export ──────────────────────────────────────────────────────────────────────────────────────
console.log("\n-- export --");
before = await ledgerCount(ORG);
const exportsBefore = Number((await one(`select count(*)::int n from chat_exports`)).n);
ok("no reason, no export", (await sqlstate(`select * from chat_compliance_export_rows($1,$2,null,$3,'conversation',$4,null,null,null,null)`, [ORG, BEN, await uuid(), DM])) === "CH009");
ok("another organisation's conversation is CH001", (await sqlstate(`select * from chat_compliance_export_rows($1,$2,$3,$4,'conversation',$5,null,null,null,null)`, [ORG, BEN, REASON, await uuid(), OTHER_DM])) === "CH001");
ok("a conversation export must name its conversation", (await sqlstate(`select * from chat_compliance_export_rows($1,$2,$3,$4,'conversation',null,null,null,null,null)`, [ORG, BEN, REASON, await uuid()])) === "CH010");
ok("...and refusals leave neither a ledger row nor an export record", (await ledgerCount(ORG)) === before && Number((await one(`select count(*)::int n from chat_exports`)).n) === exportsBefore);

const E1 = await uuid();
const ex = await one(`select * from chat_compliance_export_rows($1,$2,$3,$4,'conversation',$5,null,null,null,null)`, [ORG, BEN, REASON, E1, DM]);
ok("a conversation export returns every line oldest first, retracted words included", ex.lines.length === 2 && ex.lines[0].id === M1 && ex.lines[1].id === M2 && ex.lines[1].body === "Approved, 100% sure." && ex.lines[1].deleted_at !== null);
ok("...each earlier version with its own hash", ex.lines[0].versions.length === 1 && ex.lines[0].versions[0].body === "Truck 654 is at the yard." && ex.lines[0].versions[0].body_sha256 === sha("Truck 654 is at the yard."));
const sentRow = await one(`select body_sha256 from chat_ledger where message_id=$1 and action='message_edited'`, [M1]);
ok("...each body hash is the hash the ledger holds for that line", ex.lines[0].body_sha256 === sentRow.body_sha256 && ex.lines[0].body_sha256 === sha("Truck 654 is at the YARD GATE."));
const fold = sha(ex.lines.map((l) => `${l.id}:${sha(l.body)}`).join("\n"));
ok("content_sha256 is the documented fold of the line hashes", ex.export.content_sha256 === fold, `${ex.export.content_sha256} vs ${fold}`);
ok("the conversation comes with everyone who was in it", ex.conversations.length === 1 && ex.conversations[0].thread_id === DM && ex.conversations[0].members.length === 2);
const exLedger = await one(`select seq, hash, body_sha256, actor_user_id, thread_id, detail from chat_ledger where org_id=$1 and action='compliance_export'`, [ORG]);
ok("the export is one compliance_export ledger row carrying the fold, the reason and the export id", exLedger.body_sha256 === fold && exLedger.actor_user_id === BEN && exLedger.thread_id === DM && exLedger.detail.export_id === E1 && exLedger.detail.reason.text === REASON.text && exLedger.detail.message_count === 2);
ok("...and the export names that row as its chain position", Number(ex.export.ledger_seq) === Number(exLedger.seq) && ex.export.ledger_hash === exLedger.hash);
const rec = await one(`select * from chat_exports where id=$1`, [E1]);
ok("the export record holds the same position and fold, building", rec.status === "building" && Number(rec.ledger_seq) === Number(exLedger.seq) && rec.content_sha256 === fold && rec.message_count === 2 && rec.requested_by === BEN);
ok("an export id cannot be reused", (await sqlstate(`select * from chat_compliance_export_rows($1,$2,$3,$4,'conversation',$5,null,null,null,null)`, [ORG, BEN, REASON, E1, DM])) === "CH010");

const E2 = await uuid();
const ex2 = await one(`select * from chat_compliance_export_rows($1,$2,$3,$4,'search',null,null,null,null,'night')`, [ORG, BEN, REASON, E2]);
ok("a search export returns the matching lines across conversations, and never another org's", ex2.lines.length === 1 && ex2.lines[0].thread_id === GROUP && !ex2.lines.some((l) => l.body.includes("other carrier")));
ok("...with the filters it was asked with", ex2.export.filters.q === "night" && ex2.conversations.length === 1 && ex2.conversations[0].subject === "Night dispatch");
const E3 = await uuid();
const ex3 = await one(`select * from chat_compliance_export_rows($1,$2,$3,$4,'search',null,null,null,null,'is at the yard.')`, [ORG, BEN, REASON, E3]);
ok("a search export finds a phrase that survives only in an earlier version", ex3.lines.length === 1 && ex3.lines[0].id === M1);
const E4 = await uuid();
const ex4 = await one(`select * from chat_compliance_export_rows($1,$2,$3,$4,'search',null,null,null,null,'no such words anywhere')`, [ORG, BEN, REASON, E4]);
ok("an empty search export is still an export: no lines, the fold of nothing, a ledger row", ex4.lines.length === 0 && ex4.export.content_sha256 === sha("") && ex4.export.message_count === 0);

// ── The export record's life ────────────────────────────────────────────────────────────────────
console.log("\n-- the export record --");
ok("what was exported never changes", (await sqlstate(`update chat_exports set message_count=99 where id=$1`, [E1])) === "CL001");
ok("an export cannot be deleted", (await sqlstate(`delete from chat_exports where id=$1`, [E1])) === "CL001");
ok("a building export cannot be marked purged", (await sqlstate(`select chat_export_purged($1)`, [E1])) === null && (await one(`select purged_at from chat_exports where id=$1`, [E1])).purged_at === null);
const MAN = sha("manifest");
await db.query(`select chat_export_stored($1,$2,$3,$4,$5)`, [ORG, E1, [`${ORG}/chat/${E1}/export.jsonl`, `${ORG}/chat/${E1}/export.pdf`, `${ORG}/chat/${E1}/manifest.json`], 4096, MAN]);
let r = await one(`select * from chat_exports where id=$1`, [E1]);
ok("stored: ready for seven days with its paths and manifest hash", r.status === "ready" && r.storage_paths.length === 3 && r.manifest_sha256 === MAN && Math.round((new Date(r.expires_at) - new Date(r.completed_at)) / 86400000) === 7);
ok("another organisation cannot mark it stored", (await sqlstate(`select chat_export_stored($1,$2,$3,$4,$5)`, [ORG_B, E2, ["x"], 1, MAN])) === "CH001");
ok("a ready export cannot go back to building", (await sqlstate(`update chat_exports set status='building' where id=$1`, [E1])) === "CL001");
await db.query(`select chat_export_failed($1,$2,'upload refused')`, [ORG, E2]);
ok("a failed build is recorded with its error", (await one(`select status, error from chat_exports where id=$1`, [E2])).error === "upload refused");
ok("nothing has expired yet", (await all(`select * from chat_exports_expired(100)`)).length === 0);
await db.exec(`begin; alter table chat_exports disable trigger trg_chat_exports_guard;`);
await db.query(`update chat_exports set expires_at = now() - interval '1 minute' where id=$1`, [E1]);
await db.exec(`alter table chat_exports enable trigger trg_chat_exports_guard; commit;`);
const expired = await all(`select * from chat_exports_expired(100)`);
ok("an expired export is offered to the sweep with its paths", expired.length === 1 && expired[0].id === E1 && expired[0].storage_paths.length === 3);
await db.query(`select chat_export_purged($1)`, [E1]);
r = await one(`select * from chat_exports where id=$1`, [E1]);
ok("purged: the bytes' paths go, the record and its hashes stay", r.storage_paths === null && r.purged_at !== null && r.content_sha256 === fold && r.manifest_sha256 === MAN && r.status === "ready");
ok("a purged export cannot be given paths again", (await sqlstate(`update chat_exports set storage_paths=$2, purged_at=null where id=$1`, [E1, ["x"]])) === "CL001");
const listed = await all(`select * from chat_exports_list($1,null,50)`, [ORG]);
ok("the exports list is newest first, with who asked", listed.length === 4 && listed.every((e) => e.requested_by_name === "Ben Admin") && new Date(listed[0].created_at) >= new Date(listed[3].created_at));
ok("...and the other organisation's is empty", (await all(`select * from chat_exports_list($1,null,50)`, [ORG_B])).length === 0);
ok("a download asks the org: another org gets nothing", (await all(`select * from chat_export_get($1,$2)`, [ORG_B, E1])).length === 0);

// ── The access log and the chain ────────────────────────────────────────────────────────────────
console.log("\n-- the access log and the chain --");
const log = await all(`select * from chat_compliance_access_log($1,null,50)`, [ORG]);
ok("the access log shows the holds, the release and the exports", log.filter((x) => x.action === "hold_set").length === 2 && log.filter((x) => x.action === "hold_released").length === 1 && log.filter((x) => x.action === "compliance_export").length === 4);
const verdict = await one(`select * from chat_ledger_verify($1, 0)`, [ORG]);
ok("the ledger verifies intact with the hold and export rows in it", verdict.problem === null, JSON.stringify(verdict));

// ── The browser ─────────────────────────────────────────────────────────────────────────────────
console.log("\n-- the browser --");
const benJwt = { org_id: ORG, user_role: "admin", sub: BEN };
ok("an admin's browser cannot set a hold or export",
  /permission denied/.test((await asUser(benJwt, `select chat_hold_set($1,$2,$3,'person',$4,'Matter 118')`, [ORG, BEN, REASON, ANA])).error ?? "")
  && /permission denied/.test((await asUser(benJwt, `select * from chat_compliance_export_rows($1,$2,$3,gen_random_uuid(),'conversation',$4,null,null,null,null)`, [ORG, BEN, REASON, DM])).error ?? ""));
ok("...nor read the holds or the exports tables", (await asUser(benJwt, `select * from chat_holds`)).rows?.length === 0 && (await asUser(benJwt, `select * from chat_exports`)).rows?.length === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
