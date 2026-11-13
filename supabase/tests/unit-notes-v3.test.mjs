// UNIT-NOTES-PLAN §8 (v3), migration 0596: an author edits and removes their own note, a holder of
// "Edit and remove anyone's note" does both for every note; an edit keeps the old words and re-derives the
// mentions; a removed note leaves every list, count, pin and board chip and is never deleted; a note names
// a truck, trailer or driver by token, and that unit's board chip stays until somebody resolves it; the
// driver merge moves a driver's chips.
//
// Run:  node supabase/tests/unit-notes-v3.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const tsSrc = readFileSync(join(SUPA, "..", "apps", "api", "src", "modules", "roster", "mergeDriver.ts"), "utf8");
const MOVES = [...tsSrc.matchAll(/\{\s*table:\s*"([a-z_][a-z0-9_]*)",\s*column:\s*"([a-z_][a-z0-9_]*)"(,\s*orgScoped:\s*true)?/g)]
  .map((m) => ({ table: m[1], column: m[2], org_scoped: !!m[3] }));
if (MOVES.length < 20) {
  console.error("could not parse DRIVER_REASSIGNMENTS");
  process.exit(1);
}

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
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────
const org = async (name) => (await one(`insert into organizations (id, name) values (gen_random_uuid(), $1) returning id`, [name])).id;
const ORG = await org("Carrier");
const OTHER = await org("Other carrier");
const user = async (o, role) => {
  const id = (await one(`insert into auth.users (id) values (gen_random_uuid()) returning id`)).id;
  await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, $3)`, [o, id, role]);
  return id;
};
const DANA = await user(ORG, "dispatcher");
const BILLING = await user(ORG, "accountant");
const ADMIN = await user(ORG, "admin");
const DRIVER_LOGIN = await user(ORG, "driver");
const driver = async (o, name, status = "active") =>
  (await one(`insert into drivers (org_id, full_name, status) values ($1, $2, $3) returning id`, [o, name, status])).id;
const MARCUS = await driver(ORG, "Marcus Hill");
const MARCUS_DUP = await driver(ORG, "Marcus Hill (dup)");
const APPLICANT = await driver(ORG, "Ann Applicant", "applicant");
const truck = async (o, unit) => (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1, $2, 150) returning id`, [o, unit])).id;
const T702 = await truck(ORG, "702");
const T848 = await truck(ORG, "848");
const THEIR_TRUCK = await truck(OTHER, "848");
const TRAILER = (await one(`insert into trailers (org_id, unit_number) values ($1, '5310') returning id`, [ORG])).id;

const add = async (kind, subject, body, author = DANA, at = null) => {
  const err = await sqlstate(
    `insert into unit_notes (org_id, subject_kind, subject_id, body, author_id, author_name, created_at)
     values ($1, $2, $3, $4, $5, 'Dana', coalesce($6::timestamptz, now()))`,
    [ORG, kind, subject, body, author, at]);
  if (err) return err;
  return (await one(`select id from unit_notes where body = $1 order by created_at desc limit 1`, [body])).id;
};
const edit = (note, body, actor = DANA, any = false, o = ORG) =>
  sqlstate(`select edit_unit_note($1, $2, $3, $4, 'Actor', $5)`, [o, note, body, actor, any]);
const remove = (note, actor = DANA, any = false, o = ORG) =>
  sqlstate(`select remove_unit_note($1, $2, $3, 'Actor', $4)`, [o, note, actor, any]);
const resolve = (note, kind, subject, o = ORG) =>
  sqlstate(`select resolve_unit_note_unit_mention($1, $2, $3, $4, $5, 'Dana')`, [o, note, kind, subject, DANA]);
const board = async (o = ORG) => (await one(`select unit_note_open_unit_mentions($1) b`, [o])).b;
const search = (subjects) =>
  all(`select * from unit_notes_search($1, null, $2::jsonb, null, null, null, null, null, null, null, null, null)`, [ORG, JSON.stringify(subjects)]);
const tok = (kind, id) => `<#${kind}:${id}>`;

// ── editing: the author, the old words kept ───────────────────────────────────────────────────
const SEAL = await add("vehicle", T702, "Door seal leaks", DANA, "2026-11-01T10:00:00Z");
ok("the author edits their own note", (await edit(SEAL, "Door seal leaks, shop has the part")) === null);
const sealRow = await one(`select body, edited_at from unit_notes where id = $1`, [SEAL]);
ok("…its words change and it says when", sealRow.body === "Door seal leaks, shop has the part" && sealRow.edited_at !== null, JSON.stringify(sealRow));
const versions = await all(`select body, edited_by, edited_by_name from unit_note_versions where note_id = $1`, [SEAL]);
ok("…and the old words are kept, with who edited", versions.length === 1 && versions[0].body === "Door seal leaks" &&
  versions[0].edited_by === DANA && versions[0].edited_by_name === "Actor", JSON.stringify(versions));
ok("an edit that changes nothing keeps no version", (await edit(SEAL, "Door seal leaks, shop has the part")) === null &&
  Number((await one(`select count(*)::int n from unit_note_versions where note_id = $1`, [SEAL])).n) === 1);
ok("somebody else cannot edit it without the permission (UN025)", (await edit(SEAL, "Hijacked", BILLING)) === "UN025");
ok("…with it they can, and the version names them", (await edit(SEAL, "Seal replaced 11/12", ADMIN, true)) === null &&
  (await one(`select edited_by from unit_note_versions where note_id = $1 order by replaced_at desc, id desc limit 1`, [SEAL])).edited_by === ADMIN);
ok("another carrier cannot edit it, permission or not (UN020)", (await edit(SEAL, "cross", ADMIN, true, OTHER)) === "UN020");
ok("an edit to empty words is refused (23514)", (await edit(SEAL, "   ")) === "23514");
ok("a raw UPDATE of the words is refused — only edit_unit_note keeps the old ones (UN011)",
  (await sqlstate(`update unit_notes set body = 'raw' where id = $1`, [SEAL])) === "UN011");
const editedAt = (await one(`select edited_at from unit_notes where id = $1`, [SEAL])).edited_at;
await db.query(`update unit_notes set edited_at = '2020-01-01' where id = $1`, [SEAL]);
ok("edited_at is the trigger's: a caller cannot set it", new Date((await one(`select edited_at from unit_notes where id = $1`, [SEAL])).edited_at).getTime() === new Date(editedAt).getTime());
ok("a note is born unedited even when the insert says otherwise", (await sqlstate(
  `insert into unit_notes (org_id, subject_kind, subject_id, body, author_name, edited_at, deleted_at, deleted_by_name)
   values ($1, 'vehicle', $2, 'Born edited?', 'Dana', now(), now(), 'X')`, [ORG, T702])) === null &&
  JSON.stringify(await one(`select edited_at, deleted_at from unit_notes where body = 'Born edited?'`)) === '{"edited_at":null,"deleted_at":null}');

// The old words are append-only.
const VERSION = (await one(`select id from unit_note_versions where note_id = $1 limit 1`, [SEAL])).id;
ok("an old version is never edited (UN024)", (await sqlstate(`update unit_note_versions set body = 'x' where id = $1`, [VERSION])) === "UN024");
ok("an old version is never deleted (UN024)", (await sqlstate(`delete from unit_note_versions where id = $1`, [VERSION])) === "UN024");

// ── an edit re-derives the people it names ────────────────────────────────────────────────────
const CARD = await add("vehicle", T702, "Fuel card on hold", DANA, "2026-11-02T10:00:00Z");
ok("an edit that adds an office member names them", (await edit(CARD, `<@${BILLING}> fuel card on hold`)) === null &&
  (await all(`select user_id from unit_note_mentions where note_id = $1`, [CARD])).map((r) => r.user_id).join() === BILLING);
ok("an edit that adds a driver login is refused (UN015)", (await edit(CARD, `<@${BILLING}> <@${DRIVER_LOGIN}> card`)) === "UN015");
await db.query(`update memberships set suspended_at = now() where user_id = $1`, [BILLING]);
ok("an edit elsewhere in the note keeps a name the office has since suspended — only what an edit ADDS is checked",
  (await edit(CARD, `<@${BILLING}> fuel card on hold, called EFS`)) === null);
await db.query(`update memberships set suspended_at = null where user_id = $1`, [BILLING]);
ok("an edit that takes a name out drops the mention", (await edit(CARD, "Fuel card on hold, called EFS")) === null &&
  Number((await one(`select count(*)::int n from unit_note_mentions where note_id = $1`, [CARD])).n) === 0);

// ── naming units: tokens, checked ─────────────────────────────────────────────────────────────
const NAMES = await add("driver", MARCUS, `Marcus swaps to ${tok("vehicle", T848)} Monday, pulls ${tok("trailer", TRAILER)}`, DANA, "2026-11-03T10:00:00Z");
const units = await all(`select subject_kind, subject_id, resolved_at from unit_note_unit_mentions where note_id = $1 order by subject_kind`, [NAMES]);
ok("a note's unit tokens are derived into unit_note_unit_mentions, open", units.length === 2 &&
  units.some((u) => u.subject_kind === "vehicle" && u.subject_id === T848) && units.some((u) => u.subject_kind === "trailer" && u.subject_id === TRAILER) &&
  units.every((u) => u.resolved_at === null), JSON.stringify(units));
ok("naming another carrier's truck is refused (UN016)", (await add("vehicle", T702, `see ${tok("vehicle", THEIR_TRUCK)}`)) === "UN016");
ok("naming an applicant is refused (UN016)", (await add("vehicle", T702, `ask ${tok("driver", APPLICANT)}`)) === "UN016");
ok("a token's kind names its table — a truck's id as a driver is refused (UN016)", (await add("vehicle", T702, `ask ${tok("driver", T848)}`)) === "UN016");
ok("an edit that adds another carrier's truck is refused (UN016)", (await edit(NAMES, `${tok("vehicle", THEIR_TRUCK)}`)) === "UN016");
const DRIVER_NAMED = await add("vehicle", T702, `${tok("driver", MARCUS)} reports a low tire on 702`, BILLING, "2026-11-04T10:00:00Z");
ok("a truck's note may name a driver", typeof DRIVER_NAMED === "string" && DRIVER_NAMED.length === 36, String(DRIVER_NAMED));

// The search carries the units by label, for the chips.
const marcusList = await search([{ kind: "driver", id: MARCUS }]);
const named = marcusList.find((r) => r.id === NAMES);
ok("the list carries each note's named units with their labels", JSON.stringify(named?.unit_mentions?.map((u) => [u.kind, u.label])) === '[["trailer","5310"],["vehicle","848"]]', JSON.stringify(named?.unit_mentions));
ok("…and when it was edited", (await search([{ kind: "vehicle", id: T702 }])).find((r) => r.id === SEAL)?.edited_at !== null);

// ── the board: open mentions, one value, resolved by anyone ───────────────────────────────────
let b = await board();
ok("the board's read holds truck 848's open mention", b.vehicle?.[T848]?.[0]?.note_id === NAMES, JSON.stringify(b));
ok("…naming the note's own unit and author", b.vehicle?.[T848]?.[0]?.note_kind === "driver" && b.vehicle?.[T848]?.[0]?.note_label === "Marcus Hill" &&
  b.vehicle?.[T848]?.[0]?.author_name === "Dana", JSON.stringify(b.vehicle?.[T848]));
ok("…and the trailer's, and the driver's", b.trailer?.[TRAILER]?.length === 1 && b.driver?.[MARCUS]?.[0]?.note_id === DRIVER_NAMED, JSON.stringify(b));
ok("another carrier's board holds none of them", JSON.stringify(await board(OTHER)) === "{}", JSON.stringify(await board(OTHER)));
ok("resolving truck 848's chip succeeds", (await resolve(NAMES, "vehicle", T848)) === null);
b = await board();
ok("…and it is gone from the board while the trailer's stays", !b.vehicle?.[T848] && b.trailer?.[TRAILER]?.length === 1, JSON.stringify(b));
const res = await one(`select resolved_at, resolved_by, resolved_by_name from unit_note_unit_mentions where note_id = $1 and subject_kind = 'vehicle'`, [NAMES]);
ok("…signed by who resolved it", res.resolved_at !== null && res.resolved_by === DANA && res.resolved_by_name === "Dana", JSON.stringify(res));
ok("resolving it again is a quiet yes", (await resolve(NAMES, "vehicle", T848)) === null);
ok("resolving a unit the note does not name is refused (UN020)", (await resolve(NAMES, "vehicle", T702)) === "UN020");
ok("another carrier cannot resolve it (UN020)", (await resolve(NAMES, "trailer", TRAILER, OTHER)) === "UN020");
ok("a resolution is never reopened (UN023)",
  (await sqlstate(`update unit_note_unit_mentions set resolved_at = null, resolved_by = null, resolved_by_name = null where note_id = $1 and subject_kind = 'vehicle'`, [NAMES])) === "UN023");
ok("an edit that keeps the token keeps it resolved", (await edit(NAMES, `Marcus swaps to ${tok("vehicle", T848)} Tuesday, pulls ${tok("trailer", TRAILER)}`)) === null &&
  !(await board()).vehicle?.[T848]);
ok("an edit that takes the trailer out takes its chip off the board", (await edit(NAMES, `Marcus swaps to ${tok("vehicle", T848)} Tuesday`)) === null &&
  !(await board()).trailer?.[TRAILER]);
// Five per unit at most, newest first.
for (let i = 0; i < 7; i++) await add("trailer", TRAILER, `Bring ${tok("vehicle", T702)} in, round ${i}`, DANA, `2026-11-0${i + 1}T12:00:00Z`);
b = await board();
ok("the board holds the newest five open mentions of a unit", b.vehicle?.[T702]?.length === 5 &&
  b.vehicle[T702].every((m, i, a) => i === 0 || new Date(a[i - 1].at) >= new Date(m.at)), JSON.stringify(b.vehicle?.[T702]?.map((m) => m.at)));

// ── removing: the author, or the permission ───────────────────────────────────────────────────
await db.query(`select set_unit_note_pinned($1, $2, true)`, [ORG, SEAL]);
ok("somebody else cannot remove the note without the permission (UN025)", (await remove(SEAL, BILLING)) === "UN025");
ok("the author removes their own note", (await remove(SEAL)) === null);
const gone = await one(`select deleted_at, deleted_by, deleted_by_name, pinned, body from unit_notes where id = $1`, [SEAL]);
ok("…the row stays, signed, and unpinned", gone.deleted_at !== null && gone.deleted_by === DANA && gone.deleted_by_name === "Actor" &&
  gone.pinned === false && gone.body === "Seal replaced 11/12", JSON.stringify(gone));
ok("…it leaves the unit's list", !(await search([{ kind: "vehicle", id: T702 }])).some((r) => r.id === SEAL));
ok("…the wall and the search", (await all(`select * from unit_notes_search($1, null, null, 'seal', null, null, null, null, null, null, null, null)`, [ORG])).length === 0);
const sum = (await one(`select unit_note_summary($1, array['vehicle']) s`, [ORG])).s;
const live702 = Number((await one(`select count(*)::int n from unit_notes where subject_id = $1 and deleted_at is null`, [T702])).n);
ok("…and the count", sum.vehicle?.[T702]?.count === live702 && live702 === 3, `${JSON.stringify(sum.vehicle?.[T702])} live=${live702}`);
ok("a removed note cannot be edited (UN020)", (await edit(SEAL, "back")) === "UN020");
ok("…nor removed twice (UN020)", (await remove(SEAL)) === "UN020");
ok("…nor pinned (UN020)", (await sqlstate(`select set_unit_note_pinned($1, $2, true)`, [ORG, SEAL])) === "UN020");
ok("…nor brought back by a raw UPDATE (UN022)", (await sqlstate(`update unit_notes set deleted_at = null where id = $1`, [SEAL])) === "UN022");
ok("a raw UPDATE cannot remove a note — only remove_unit_note signs it (UN011)",
  (await sqlstate(`update unit_notes set deleted_at = now(), deleted_by_name = 'X' where id = $1`, [CARD])) === "UN011");
ok("a note is still never DELETEd (UN010)", (await sqlstate(`delete from unit_notes where id = $1`, [CARD])) === "UN010");
ok("with the permission somebody else removes it", (await remove(DRIVER_NAMED, ADMIN, true)) === null);
ok("…and its chip leaves the board", !(await board()).driver?.[MARCUS], JSON.stringify((await board()).driver));
ok("…and nobody can resolve a removed note's chip (UN020)", (await resolve(DRIVER_NAMED, "driver", MARCUS)) === "UN020");

// ── the driver merge moves a driver's chips ───────────────────────────────────────────────────
ok("the merge list carries unit_note_unit_mentions.subject_id, org-scoped",
  MOVES.some((m) => m.table === "unit_note_unit_mentions" && m.column === "subject_id" && m.org_scoped));
const DUP_ONLY = await add("vehicle", T848, `${tok("driver", MARCUS_DUP)} owes a log`, DANA);
const BOTH = await add("vehicle", T848, `${tok("driver", MARCUS)} and ${tok("driver", MARCUS_DUP)} — same person?`, DANA);
const mergeErr = await sqlstate(`select merge_driver_v2($1, $2, $3, $4::jsonb)`, [ORG, MARCUS_DUP, MARCUS, JSON.stringify(MOVES)]);
ok("a merge of a named driver completes with the real list", mergeErr === null, String(mergeErr));
ok("the duplicate's chip is now the surviving driver's",
  (await all(`select subject_id from unit_note_unit_mentions where note_id = $1`, [DUP_ONLY])).map((r) => r.subject_id).join() === MARCUS);
ok("a note that named both keeps one row, the survivor's, and the leftover is cleared",
  (await all(`select subject_id from unit_note_unit_mentions where note_id = $1 and subject_kind = 'driver'`, [BOTH])).map((r) => r.subject_id).join() === MARCUS);
ok("no row names the merged-away driver",
  Number((await one(`select count(*)::int n from unit_note_unit_mentions where subject_id = $1`, [MARCUS_DUP])).n) === 0);
// A truck mention sharing the merged driver's uuid stops the merge, never moves.
const TWIN = await driver(ORG, "Twin dup");
await db.query(`insert into vehicles (id, org_id, unit_number, tank_capacity_gal) values ($1, $2, '777', 150)`, [TWIN, ORG]);
await add("trailer", TRAILER, `Hook ${tok("vehicle", TWIN)}`, DANA);
ok("a truck mention sharing the merged driver's id stops the merge (UN012)",
  (await sqlstate(`select merge_driver_v2($1, $2, $3, $4::jsonb)`, [ORG, TWIN, MARCUS, JSON.stringify(MOVES)])) === "UN012");

// ── the api's only door ───────────────────────────────────────────────────────────────────────
for (const t of ["unit_note_versions", "unit_note_unit_mentions"]) {
  const policies = Number((await one(`select count(*)::int n from pg_policies where tablename = $1`, [t])).n);
  ok(`${t}: RLS on with no client policy — deny-all from a browser`,
    policies === 0 && (await one(`select relrowsecurity r from pg_class where relname = $1`, [t])).r === true);
}
for (const fn of ["edit_unit_note", "remove_unit_note", "resolve_unit_note_unit_mention", "unit_note_open_unit_mentions", "unit_notes_search"]) {
  const r = await one(
    `select bool_or(has_function_privilege('anon', p.oid, 'execute')) a, bool_or(has_function_privilege('authenticated', p.oid, 'execute')) u,
            bool_or(has_function_privilege('service_role', p.oid, 'execute')) s
       from pg_proc p where p.proname = $1`, [fn]);
  ok(`${fn}: service role only`, r.a === false && r.u === false && r.s === true, JSON.stringify(r));
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
