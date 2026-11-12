// UNIT-NOTES-PLAN §4.1 (step UN1), migration 0592: notes on drivers, trucks and trailers — permanent and
// signed, the subject checked and never deleted under its notes, one pin per unit, mentions of office members
// only, a driver merge that moves a driver's notes and nothing else, word search with a typo pass, the
// counts as one value, and the bell's category.
//
// Run:  node supabase/tests/unit-notes.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

// The REAL merge list, parsed the way lint:driver-references parses it (inventory-driver-held's recipe).
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
const user = async (o, role, suspended = false) => {
  const id = (await one(`insert into auth.users (id) values (gen_random_uuid()) returning id`)).id;
  await db.query(`insert into memberships (org_id, user_id, role, suspended_at) values ($1, $2, $3, $4)`,
    [o, id, role, suspended ? new Date().toISOString() : null]);
  return id;
};
const DISPATCHER = await user(ORG, "dispatcher");
const BILLING = await user(ORG, "accountant");
const DRIVER_LOGIN = await user(ORG, "driver");
const SUSPENDED = await user(ORG, "dispatcher", true);
const STRANGER = await user(OTHER, "admin");
const driver = async (o, name, status = "active") =>
  (await one(`insert into drivers (org_id, full_name, status) values ($1, $2, $3) returning id`, [o, name, status])).id;
const MARCUS = await driver(ORG, "Marcus Hill");
const MARCUS_DUP = await driver(ORG, "Marcus Hill (dup)");
const APPLICANT = await driver(ORG, "Ann Applicant", "applicant");
const THEIR_DRIVER = await driver(OTHER, "Someone else");
const TRUCK = (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1, '702', 150) returning id`, [ORG])).id;
const THEIR_TRUCK = (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1, '702', 150) returning id`, [OTHER])).id;
const TRAILER = (await one(`insert into trailers (org_id, unit_number) values ($1, '5310') returning id`, [ORG])).id;

const add = (o, kind, subject, body, author = DISPATCHER, at = null) =>
  sqlstate(
    `insert into unit_notes (org_id, subject_kind, subject_id, body, author_id, author_name, created_at)
     values ($1, $2, $3, $4, $5, 'Dana', coalesce($6::timestamptz, now()))`,
    [o, kind, subject, body, author, at]);
const idOf = async (body) => (await one(`select id from unit_notes where body = $1`, [body])).id;

// ── writing: the subject is checked ───────────────────────────────────────────────────────────
ok("a note on this carrier's truck is written", (await add(ORG, "vehicle", TRUCK, "Door seal leaks, shop knows", DISPATCHER, "2026-11-01T10:00:00Z")) === null);
ok("a note on this carrier's trailer is written", (await add(ORG, "trailer", TRAILER, "Reefer unit L-20481 serviced", DISPATCHER, "2026-11-02T10:00:00Z")) === null);
ok("a note on this carrier's driver is written", (await add(ORG, "driver", MARCUS, "Prefers no NYC loads", DISPATCHER, "2026-11-03T10:00:00Z")) === null);
ok("a note on another carrier's truck is refused (UN012)", (await add(ORG, "vehicle", THEIR_TRUCK, "cross")) === "UN012");
ok("a note on another carrier's driver is refused (UN012)", (await add(ORG, "driver", THEIR_DRIVER, "cross")) === "UN012");
ok("a truck's id under the driver kind is refused — the kind names the table (UN012)", (await add(ORG, "driver", TRUCK, "wrong kind")) === "UN012");
ok("an id that is no unit at all is refused (UN012)", (await add(ORG, "trailer", MARCUS_DUP, "no such trailer")) === "UN012");
ok("a note on an applicant is refused — those are applicant_notes (UN013)", (await add(ORG, "driver", APPLICANT, "applicant")) === "UN013");
// The insert guard runs before the CHECK, so it is the guard that answers; the CHECK stands behind it.
ok("a kind outside the three is refused (UN012)", (await add(ORG, "load", TRUCK, "a load")) === "UN012");
ok("…and the column's CHECK names exactly the three kinds",
  /subject_kind = ANY \(ARRAY\['vehicle'::text, 'driver'::text, 'trailer'::text\]\)/.test(
    (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'unit_notes_subject_kind_check'`)).d));
ok("an empty note is refused (23514)", (await add(ORG, "vehicle", TRUCK, "   ")) === "23514");
ok("a note of 4,001 characters is refused (23514)", (await add(ORG, "vehicle", TRUCK, "x".repeat(4001))) === "23514");
const born = await sqlstate(
  `insert into unit_notes (org_id, subject_kind, subject_id, body, author_name, pinned) values ($1, 'vehicle', $2, 'Born pinned?', 'Dana', true)`,
  [ORG, TRUCK]);
ok("a note is born unpinned even when the insert says otherwise", born === null &&
  (await one(`select pinned from unit_notes where body = 'Born pinned?'`)).pinned === false);

// ── permanent ─────────────────────────────────────────────────────────────────────────────────
const SEAL = await idOf("Door seal leaks, shop knows");
const REEFER = await idOf("Reefer unit L-20481 serviced");
const NYC = await idOf("Prefers no NYC loads");
ok("a note's words are never edited (UN011)", (await sqlstate(`update unit_notes set body = 'changed' where id = $1`, [SEAL])) === "UN011");
ok("its author's name is never edited (UN011)", (await sqlstate(`update unit_notes set author_name = 'Eve' where id = $1`, [SEAL])) === "UN011");
ok("its author is never handed to someone else (UN011)", (await sqlstate(`update unit_notes set author_id = $2 where id = $1`, [SEAL, BILLING])) === "UN011");
ok("its time is never edited (UN011)", (await sqlstate(`update unit_notes set created_at = now() - interval '1 year' where id = $1`, [SEAL])) === "UN011");
ok("its kind is never edited (UN011)", (await sqlstate(`update unit_notes set subject_kind = 'trailer' where id = $1`, [SEAL])) === "UN011");
ok("a note is never deleted (UN010)", (await sqlstate(`delete from unit_notes where id = $1`, [SEAL])) === "UN010");
ok("the table is never truncated (UN010)", (await sqlstate(`truncate unit_notes cascade`)) === "UN010");
ok("a truck's note never moves to another unit (UN012)", (await sqlstate(`update unit_notes set subject_id = $2 where id = $1`, [SEAL, TRAILER])) === "UN012");
ok("a driver's note never moves to another carrier's driver (UN012)", (await sqlstate(`update unit_notes set subject_id = $2 where id = $1`, [NYC, THEIR_DRIVER])) === "UN012");

// The author's login can go; the signature stays.
const LEAVER = await user(ORG, "dispatcher");
await add(ORG, "vehicle", TRUCK, "Written by someone who leaves", LEAVER);
const leftUser = await sqlstate(`delete from auth.users where id = $1`, [LEAVER]);
const orphan = await one(`select author_id, author_name from unit_notes where body = 'Written by someone who leaves'`);
ok("deleting an author's login keeps the note, signed by name (author_id → null)",
  leftUser === null && orphan.author_id === null && orphan.author_name === "Dana", `${leftUser} ${JSON.stringify(orphan)}`);

// ── a unit is never deleted under its notes (UN014) ───────────────────────────────────────────
ok("a truck with notes cannot be deleted (UN014)", (await sqlstate(`delete from vehicles where id = $1`, [TRUCK])) === "UN014");
ok("a trailer with notes cannot be deleted (UN014)", (await sqlstate(`delete from trailers where id = $1`, [TRAILER])) === "UN014");
const BARE_TRAILER = (await one(`insert into trailers (org_id, unit_number) values ($1, '9999') returning id`, [ORG])).id;
ok("a trailer without notes still deletes", (await sqlstate(`delete from trailers where id = $1`, [BARE_TRAILER])) === null);
await db.query(`set fuelguard.merging_driver = 'on'`);
ok("a driver with notes cannot be deleted, even by the merge's own door (UN014)",
  (await sqlstate(`delete from drivers where id = $1`, [MARCUS])) === "UN014");
await db.query(`set fuelguard.merging_driver = 'off'`);

// ── pinning: one per unit ─────────────────────────────────────────────────────────────────────
await add(ORG, "vehicle", TRUCK, "Second truck note", DISPATCHER, "2026-11-04T10:00:00Z");
const SECOND = await idOf("Second truck note");
await db.query(`select set_unit_note_pinned($1, $2, true)`, [ORG, SEAL]);
await db.query(`select set_unit_note_pinned($1, $2, true)`, [ORG, SECOND]);
await db.query(`select set_unit_note_pinned($1, $2, true)`, [ORG, REEFER]);
const pinnedTruck = (await all(`select id from unit_notes where subject_kind = 'vehicle' and subject_id = $1 and pinned`, [TRUCK])).map((r) => r.id);
ok("pinning a second note unpins the first — one at the top of a unit", pinnedTruck.length === 1 && pinnedTruck[0] === SECOND, JSON.stringify(pinnedTruck));
ok("pinning on another unit leaves this unit's pin alone",
  (await one(`select pinned from unit_notes where id = $1`, [REEFER])).pinned === true &&
  (await one(`select pinned from unit_notes where id = $1`, [SECOND])).pinned === true);
ok("another carrier cannot pin this note (UN020)", (await sqlstate(`select set_unit_note_pinned($1, $2, true)`, [OTHER, SEAL])) === "UN020");
ok("a second pinned row on a unit is refused by the index too (23505)", (await sqlstate(`update unit_notes set pinned = true where id = $1`, [SEAL])) === "23505");
await db.query(`select set_unit_note_pinned($1, $2, false)`, [ORG, SECOND]);
ok("unpinning leaves the unit with none pinned",
  Number((await one(`select count(*)::int n from unit_notes where subject_id = $1 and pinned`, [TRUCK])).n) === 0);
await db.query(`select set_unit_note_pinned($1, $2, true)`, [ORG, SECOND]);

// ── mentions: office members of this carrier only (UN015) ─────────────────────────────────────
ok("naming an office member writes the note", (await add(ORG, "vehicle", TRUCK, `<@${BILLING}> fuel card for 702 is on hold`, DISPATCHER, "2026-11-05T10:00:00Z")) === null);
const MENTION_NOTE = await idOf(`<@${BILLING}> fuel card for 702 is on hold`);
const mentioned = await all(`select user_id, org_id from unit_note_mentions where note_id = $1`, [MENTION_NOTE]);
ok("the mention is derived into unit_note_mentions", mentioned.length === 1 && mentioned[0].user_id === BILLING && mentioned[0].org_id === ORG, JSON.stringify(mentioned));
ok("naming a driver login is refused (UN015)", (await add(ORG, "vehicle", TRUCK, `<@${DRIVER_LOGIN}> see this`)) === "UN015");
ok("naming a suspended member is refused (UN015)", (await add(ORG, "vehicle", TRUCK, `<@${SUSPENDED}> see this`)) === "UN015");
ok("naming another carrier's member is refused (UN015)", (await add(ORG, "vehicle", TRUCK, `<@${STRANGER}> see this`)) === "UN015");
ok("a refused mention writes no note", Number((await one(`select count(*)::int n from unit_notes where body like '%see this'`)).n) === 0);

// ── the Notes column's counts: one value ──────────────────────────────────────────────────────
const sum = (await one(`select unit_note_summary($1, array['vehicle','trailer','driver']) s`, [ORG])).s;
ok("the summary counts a truck's notes", sum.vehicle?.[TRUCK]?.count === 5, JSON.stringify(sum.vehicle));
const newestTruck = (await one(`select max(created_at) m from unit_notes where subject_kind = 'vehicle' and subject_id = $1`, [TRUCK])).m;
ok("…with the newest note's time", new Date(sum.vehicle?.[TRUCK]?.last_at).getTime() === new Date(newestTruck).getTime(), JSON.stringify(sum.vehicle?.[TRUCK]));
ok("…and the trailer's and the driver's", sum.trailer?.[TRAILER]?.count === 1 && sum.driver?.[MARCUS]?.count === 1, JSON.stringify(sum));
const onlyTrailers = (await one(`select unit_note_summary($1, array['trailer']) s`, [ORG])).s;
ok("only the kinds asked come back", Object.keys(onlyTrailers).join() === "trailer", JSON.stringify(onlyTrailers));
const theirs = (await one(`select unit_note_summary($1, array['vehicle']) s`, [OTHER])).s;
ok("another carrier's summary holds none of these notes", JSON.stringify(theirs) === '{"vehicle":{}}', JSON.stringify(theirs));

// ── the list, the search, the wall ────────────────────────────────────────────────────────────
const search = (o, { kinds = null, subjects = null, q = null, author = null, from = null, to = null, before = null, after = null, limit = null } = {}) =>
  all(`select * from unit_notes_search($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [o, kinds, subjects && JSON.stringify(subjects), q, author, from, to, before?.at ?? null, before?.id ?? null, after?.at ?? null, after?.id ?? null, limit]);
const bodies = (rows) => rows.map((r) => r.body);

const truckList = await search(ORG, { subjects: [{ kind: "vehicle", id: TRUCK }] });
ok("a unit's list is its notes only, newest first", truckList.length === 5 &&
  truckList.every((r) => r.subject_id === TRUCK) &&
  truckList.every((r, i) => i === 0 || new Date(truckList[i - 1].created_at) >= new Date(r.created_at)), JSON.stringify(bodies(truckList)));
ok("each row names its unit", truckList[0].subject_label === "702", truckList[0].subject_label);
ok("each row carries its mentions", truckList.find((r) => r.id === MENTION_NOTE)?.mentions?.[0] === BILLING);
ok("a plain list is not fuzzy", truckList.every((r) => r.fuzzy === false));
const merged = await search(ORG, { subjects: [{ kind: "vehicle", id: TRUCK }, { kind: "trailer", id: TRAILER }, { kind: "driver", id: MARCUS }] });
ok("the board's merged drawer reads three units in one call", merged.length === 7 &&
  new Set(merged.map((r) => r.subject_label)).size === 3, JSON.stringify(merged.map((r) => r.subject_label)));
ok("a unit named under the wrong kind returns nothing", (await search(ORG, { subjects: [{ kind: "driver", id: TRUCK }] })).length === 0);
ok("another carrier asking for this truck gets nothing", (await search(OTHER, { subjects: [{ kind: "vehicle", id: TRUCK }] })).length === 0);
ok("more than eight units is refused (UN030)",
  (await sqlstate(`select * from unit_notes_search($1, null, $2::jsonb, null, null, null, null, null, null, null, null, null)`,
    [ORG, JSON.stringify(Array.from({ length: 9 }, () => ({ kind: "vehicle", id: TRUCK })))])) === "UN030");

// Keyset both ways.
const page1 = await search(ORG, { subjects: [{ kind: "vehicle", id: TRUCK }], limit: 2 });
const last = page1[page1.length - 1];
const page2 = await search(ORG, { subjects: [{ kind: "vehicle", id: TRUCK }], limit: 2, before: { at: last.created_at, id: last.id } });
ok("pages older by (created_at, id) without overlap", page1.length === 2 && page2.length === 2 &&
  !page2.some((r) => page1.some((p) => p.id === r.id)) && new Date(page2[0].created_at) <= new Date(last.created_at));
const oldest = truckList[truckList.length - 1];
const newer = await search(ORG, { subjects: [{ kind: "vehicle", id: TRUCK }], limit: 2, after: { at: oldest.created_at, id: oldest.id } });
ok("'newer than I hold' returns the OLDEST newer notes, newest first — nothing skipped",
  newer.length === 2 && newer[1].id === truckList[truckList.length - 2].id && newer[0].id === truckList[truckList.length - 3].id,
  JSON.stringify(bodies(newer)));
ok("asking older and newer at once is refused (UN030)",
  (await sqlstate(`select * from unit_notes_search($1, null, null, null, null, null, null, now(), $2, now(), $2, null)`, [ORG, SEAL])) === "UN030");
// 55 notes on one trailer of the other carrier, so the clamp has something to cut.
const MANY = (await one(`insert into trailers (org_id, unit_number) values ($1, 'MANY') returning id`, [OTHER])).id;
await db.query(`insert into unit_notes (org_id, subject_kind, subject_id, body, author_name)
                select $1, 'trailer', $2, 'Note ' || g, 'Dana' from generate_series(1, 55) g`, [OTHER, MANY]);
ok("the limit is clamped to 50", (await search(OTHER, { subjects: [{ kind: "trailer", id: MANY }], limit: 500 })).length === 50);
ok("no limit means one page of 50", (await search(OTHER, { subjects: [{ kind: "trailer", id: MANY }] })).length === 50);

// Words: prefixes, all required, dashes split as chat's.
ok("a word matches as a prefix", bodies(await search(ORG, { q: "seal" })).join() === "Door seal leaks, shop knows");
ok("two words that are both in a note find it", bodies(await search(ORG, { q: "seal leak" })).join() === "Door seal leaks, shop knows");
ok("every word must match — two notes' words together find no exact hit",
  (await search(ORG, { q: "seal reefer" })).every((r) => r.fuzzy));
ok("a hyphenated number is found by its digits, as in chat", bodies(await search(ORG, { q: "20481" })).join() === "Reefer unit L-20481 serviced");
ok("a unit number in the text is found", (await search(ORG, { q: "702" })).some((r) => r.id === MENTION_NOTE));
ok("an exact hit is not fuzzy", (await search(ORG, { q: "seal" }))[0].fuzzy === false);
// Typo pass.
await add(ORG, "vehicle", TRUCK, "Brakes adjusted at Petro", DISPATCHER, "2026-11-06T10:00:00Z");
const typo = await search(ORG, { q: "brakse" });
const sim = Number((await one(`select public.word_similarity('brakse', 'Brakes adjusted at Petro') s`)).s);
ok("the typo scores between 0.4 and the extension's 0.6 default — why 0592 sets 0.4", sim >= 0.4 && sim < 0.6, String(sim));
ok("a typo finds the close match, marked fuzzy", typo.length >= 1 && typo[0].body === "Brakes adjusted at Petro" && typo.every((r) => r.fuzzy), JSON.stringify(typo.map((r) => [r.body, r.fuzzy])));
ok("nonsense finds nothing, even fuzzily", (await search(ORG, { q: "zzqxv" })).length === 0);
ok("a search never reaches another carrier", (await search(OTHER, { q: "seal" })).length === 0 && (await search(OTHER, { q: "brakse" })).length === 0);
// Filters and the wall.
const wall = await search(ORG, {});
const orgCount = Number((await one(`select count(*)::int n from unit_notes where org_id = $1`, [ORG])).n);
ok("the wall is every note of the carrier", orgCount === 8 && wall.length === orgCount, `${wall.length} of ${orgCount}`);
ok("the wall's kind filter keeps one kind", (await search(ORG, { kinds: ["trailer"] })).every((r) => r.subject_kind === "trailer"));
ok("the author filter keeps one author", (await search(ORG, { author: LEAVER })).length === 0 &&
  (await search(ORG, { author: DISPATCHER })).length === 6 && (await search(ORG, { author: DISPATCHER })).every((r) => r.author_id === DISPATCHER));
// `to` lands exactly on "Second truck note" (2026-11-04T10:00Z), `from` exactly on the reefer note.
const ranged = await search(ORG, { from: "2026-11-02T10:00:00Z", to: "2026-11-04T10:00:00Z" });
ok("the date range is from-inclusive, to-exclusive", bodies(ranged).sort().join("|") === "Prefers no NYC loads|Reefer unit L-20481 serviced", JSON.stringify(bodies(ranged)));

// ── the driver merge: a driver's notes move, nothing else does ────────────────────────────────
await add(ORG, "driver", MARCUS_DUP, "Dup's note: uses the Laredo yard", DISPATCHER);
await add(ORG, "driver", MARCUS_DUP, "Dup's pinned note", DISPATCHER);
await db.query(`select set_unit_note_pinned($1, $2, true)`, [ORG, await idOf("Dup's pinned note")]);
await db.query(`select set_unit_note_pinned($1, $2, true)`, [ORG, NYC]);
const truckBefore = await all(`select id, subject_id from unit_notes where subject_kind = 'vehicle' order by id`);
ok("the merge list carries unit_notes.subject_id, org-scoped",
  MOVES.some((m) => m.table === "unit_notes" && m.column === "subject_id" && m.org_scoped));
const mergeErr = await sqlstate(`select merge_driver_v2($1, $2, $3, $4::jsonb)`, [ORG, MARCUS_DUP, MARCUS, JSON.stringify(MOVES)]);
ok("a merge of a driver with notes completes with the real list", mergeErr === null, String(mergeErr));
const marcusNotes = await all(`select body, pinned from unit_notes where subject_kind = 'driver' and subject_id = $1 order by body`, [MARCUS]);
ok("the duplicate's notes are now the surviving driver's", marcusNotes.length === 3, JSON.stringify(marcusNotes));
ok("the surviving driver keeps their own pin; the moved pin arrives unpinned",
  marcusNotes.filter((n) => n.pinned).map((n) => n.body).join() === "Prefers no NYC loads", JSON.stringify(marcusNotes));
const truckAfter = await all(`select id, subject_id from unit_notes where subject_kind = 'vehicle' order by id`);
ok("no truck note was touched by the merge", JSON.stringify(truckAfter) === JSON.stringify(truckBefore));
// A truck that happens to share the duplicate driver's uuid: the merge must stop, never re-point it.
const TWIN = await driver(ORG, "Twin dup");
await db.query(`insert into vehicles (id, org_id, unit_number, tank_capacity_gal) values ($1, $2, '777', 150)`, [TWIN, ORG]);
await add(ORG, "vehicle", TWIN, "Truck 777 note");
const twinErr = await sqlstate(`select merge_driver_v2($1, $2, $3, $4::jsonb)`, [ORG, TWIN, MARCUS, JSON.stringify(MOVES)]);
ok("a truck note sharing the merged driver's id stops the merge (UN012), never moves", twinErr === "UN012" &&
  (await one(`select subject_kind, subject_id from unit_notes where body = 'Truck 777 note'`)).subject_id === TWIN, String(twinErr));
// Without the line, the merge stops at the driver delete rather than lose the notes.
await add(ORG, "driver", TWIN, "Twin's own note");
const withoutNotes = JSON.stringify(MOVES.filter((m) => m.table !== "unit_notes"));
const DUP3 = await driver(ORG, "Third dup");
await add(ORG, "driver", DUP3, "Third dup's note");
ok("a merge list without unit_notes aborts (UN014) instead of losing the notes",
  (await sqlstate(`select merge_driver_v2($1, $2, $3, $4::jsonb)`, [ORG, DUP3, MARCUS, withoutNotes])) === "UN014");

// ── the bell's category ───────────────────────────────────────────────────────────────────────
const contractSrc = readFileSync(join(SUPA, "..", "packages", "shared", "src", "notificationsContract.ts"), "utf8");
ok("the contract lists unit_note_mention", /"unit_note_mention",/.test(contractSrc));
ok("notification_events accepts unit_note_mention",
  (await sqlstate(`insert into notification_events (org_id, audience_user_id, category, title) values ($1, $2, 'unit_note_mention', 'Dana named you')`, [ORG, BILLING])) === null);
ok("…and still refuses a category nobody declared (23514)",
  (await sqlstate(`insert into notification_events (org_id, audience_user_id, category, title) values ($1, $2, 'unit_note_mentions', 'x')`, [ORG, BILLING])) === "23514");

// ── the api's only door ───────────────────────────────────────────────────────────────────────
for (const t of ["unit_notes", "unit_note_mentions"]) {
  const policies = Number((await one(`select count(*)::int n from pg_policies where tablename = $1`, [t])).n);
  ok(`${t}: RLS on with no client policy — deny-all from a browser`,
    policies === 0 && (await one(`select relrowsecurity r from pg_class where relname = $1`, [t])).r === true);
}
for (const fn of ["unit_notes_search", "unit_note_summary", "set_unit_note_pinned"]) {
  const r = await one(
    `select bool_or(has_function_privilege('anon', p.oid, 'execute')) a, bool_or(has_function_privilege('authenticated', p.oid, 'execute')) u,
            bool_or(has_function_privilege('service_role', p.oid, 'execute')) s
       from pg_proc p where p.proname = $1`, [fn]);
  ok(`${fn}: service role only`, r.a === false && r.u === false && r.s === true, JSON.stringify(r));
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
