// FuelGuard — a document is an ordered assembly of pages (migrations 0454–0455, DOCUMENT-READER-PLAN.md
// §7A D-DR14, step N1).
//
// Seven properties that would each fail quietly, because nothing in the product writes these tables yet:
//
//   0. ONE VOCABULARY. `made_by` is ASSEMBLY_MAKERS, read back out of the APPLIED catalog.
//   1. ONE DOOR WRITES BOTH. document_assembly_create stores the assembly and its pages together, in the
//      array's order (positions 1..n), and refuses an empty list, a null entry or a repeated page (DO016),
//      a page of another carrier (DO017) and a superseded assembly of another carrier (DO018) — and when
//      it refuses, nothing is left behind.
//   2. PROVENANCE. Layer 1's proposal names its prepare_version and no person; a sender's or reviewer's
//      names the person and no version.
//   3. A LINE, NEVER A FORK. An edit names the assembly it supersedes; a version is superseded at most once
//      (the second concurrent edit conflicts), and never by itself.
//   4. APPEND-ONLY, FOR THE SERVICE ROLE TOO. Neither table takes UPDATE or DELETE.
//   5. ONE ORG, NO CLIENT PATH. A direct insert naming another carrier's page or assembly is refused by
//      the composite FKs; RLS on, no policies, the function not executable by a browser session.
//   6. A READ NAMES WHAT IT WAS GIVEN (0455). A read names exactly one of a source or an assembly, the
//      assembly of its own org, and the assembly is fixed at insert like the source.
//
// Run:  node supabase/tests/document-assemblies.test.mjs   (after `pnpm --filter @silvicom/shared build:rn`)
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ASSEMBLY_MAKERS } from "../../packages/shared/dist/index.js";

const SUPA = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
/** The SQLSTATE a statement raised, or null when it succeeded. */
const sqlstate = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
};

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
`);
// Supabase's real default privileges, installed BEFORE the migrations — full DML granted, RLS is the
// gate. Without this a client "cannot read" for the wrong reason and the lockout below proves nothing.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
ok("0454 present", MIGRATIONS.some((f) => f.startsWith("0454_document_assemblies")));
ok("0455 present", MIGRATIONS.some((f) => f.startsWith("0455_document_read_assembly")));
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// ── 0. one vocabulary ─────────────────────────────────────────────────────────────────────────────
const made = await one(
  `select pg_get_constraintdef(oid) as d from pg_constraint
    where conrelid = 'public.document_assemblies'::regclass and conname = 'document_assemblies_made_by_check'`);
const madeLiterals = made ? [...made.d.matchAll(/'([^']*)'::text/g)].map((m) => m[1]) : null;
ok("made_by's CHECK equals ASSEMBLY_MAKERS", Array.isArray(ASSEMBLY_MAKERS) && ASSEMBLY_MAKERS.length > 0
  && JSON.stringify(madeLiterals) === JSON.stringify([...ASSEMBLY_MAKERS]),
  `${JSON.stringify(madeLiterals)} vs ${JSON.stringify(ASSEMBLY_MAKERS)}`);

// ── fixtures: two carriers, each with photos from two sources ──────────────────────────────────────
const ORG = (await one(`insert into organizations (name) values ('Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (name) values ('Other') returning id`)).id;
const USER = (await one(`insert into auth.users (email) values ('dispatch@x.test') returning id`)).id;
let hashes = 0;
const nextSha = () => (++hashes).toString(16).padStart(64, "0");
/** One photo = one source with one page (D-DR14); returns the page id. */
const photo = async (org) => {
  const s = (await one(
    `insert into document_sources (org_id, origin, storage_path, sha256, mime, byte_size, page_count)
     values ($1, 'upload', 'x', $2, 'image/jpeg', 1000, 1) returning id`, [org, nextSha()])).id;
  return (await one(
    `insert into document_pages (org_id, source_id, page_number, original_path, original_sha256, working_path, width, height, normaliser_version)
     values ($1, $2, 1, 'o', $3, 'w', 2000, 1500, '1.1.0') returning id`, [org, s, nextSha()])).id;
};
const [P1, P2, P3] = [await photo(ORG), await photo(ORG), await photo(ORG)];
const PX = await photo(OTHER);

const create = (org, pages, madeBy = "prepare", extra = {}) => {
  const v = { actor: null, version: madeBy === "prepare" ? "prepare-1" : null, supersedes: null, ...extra };
  return db.query(`select * from document_assembly_create($1, $2::uuid[], $3, $4, $5, $6)`,
    [org, pages, madeBy, v.actor, v.version, v.supersedes]);
};
const createState = async (...args) => { try { await create(...args); return null; } catch (e) { return e.code ?? String(e.message); } };
const pagesOf = async (assembly) =>
  (await db.query(`select position, page_id from document_assembly_pages where assembly_id = $1 order by position`,
    [assembly])).rows;
const counts = async () => one(
  `select (select count(*)::int from document_assemblies) a, (select count(*)::int from document_assembly_pages) p`);

// ── 1. one door writes both ────────────────────────────────────────────────────────────────────────
const A1 = (await create(ORG, [P3, P1, P2])).rows[0];
ok("Layer 1's proposal is stored with its maker and version", A1?.made_by === "prepare" && A1?.prepare_version === "prepare-1");
ok("its pages are stored in the array's order, positions 1..n", JSON.stringify(await pagesOf(A1.id))
  === JSON.stringify([{ position: 1, page_id: P3 }, { position: 2, page_id: P1 }, { position: 3, page_id: P2 }]),
  JSON.stringify(await pagesOf(A1.id)));
const before = await counts();
ok("an empty page list is refused (DO016)", (await createState(ORG, [])) === "DO016");
ok("a null entry is refused (DO016)", (await createState(ORG, [P1, null])) === "DO016");
ok("a page listed twice is refused (DO016)", (await createState(ORG, [P1, P2, P1])) === "DO016");
ok("another carrier's page is refused (DO017)", (await createState(ORG, [P1, PX])) === "DO017");
ok("a superseded assembly of another carrier is refused (DO018)", await (async () => {
  const AX = (await create(OTHER, [PX])).rows[0];
  return (await createState(ORG, [P1], "reviewer", { actor: USER, supersedes: AX.id })) === "DO018";
})());
const after = await counts();
ok("a refusal leaves no assembly and no page row behind (only the other carrier's one was added)",
  after.a === before.a + 1 && after.p === before.p + 1, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

// ── 2. provenance ──────────────────────────────────────────────────────────────────────────────────
ok("a proposal without its prepare_version is refused", (await createState(ORG, [P1], "prepare", { version: null })) === "23514");
ok("a proposal naming a person is refused", (await createState(ORG, [P1], "prepare", { actor: USER })) === "23514");
ok("a sender's assembly without its person is refused", (await createState(ORG, [P1], "sender")) === "23514");
ok("a reviewer's edit carrying a prepare_version is refused",
  (await createState(ORG, [P1], "reviewer", { actor: USER, version: "prepare-1" })) === "23514");
ok("a maker outside ASSEMBLY_MAKERS is refused", (await createState(ORG, [P1], "robot", { actor: USER })) === "23514");
const S1 = (await create(ORG, [P1, P2], "sender", { actor: USER })).rows[0];
ok("a sender's upload order is stored with the person", S1?.made_by === "sender" && S1?.actor === USER);

// ── 3. a line, never a fork ────────────────────────────────────────────────────────────────────────
const E1 = (await create(ORG, [P1, P3], "reviewer", { actor: USER, supersedes: A1.id })).rows[0];
ok("a reviewer's edit is a new assembly naming the one it replaces", E1?.supersedes_id === A1.id && E1.id !== A1.id);
ok("the replaced assembly still holds its own pages", (await pagesOf(A1.id)).length === 3);
ok("a second edit of the same version conflicts (23505), not a fork",
  (await createState(ORG, [P2], "reviewer", { actor: USER, supersedes: A1.id })) === "23505");
ok("the edit of the edit continues the line", !!(await create(ORG, [P3], "reviewer", { actor: USER, supersedes: E1.id })).rows[0]);
ok("an assembly cannot supersede itself", (await sqlstate(
  `insert into document_assemblies (id, org_id, made_by, prepare_version, supersedes_id)
   values ('00000000-0000-4000-8000-000000000001', $1, 'prepare', 'p', '00000000-0000-4000-8000-000000000001')`,
  [ORG])) === "23514");
ok("one page can belong to two documents (a BOL split across two sends)",
  !!(await create(ORG, [P2, P3])).rows[0]);

// ── 4. append-only ─────────────────────────────────────────────────────────────────────────────────
ok("an assembly cannot be rewritten (UPDATE)",
  (await sqlstate(`update document_assemblies set made_by = 'sender' where id = $1`, [A1.id])) === "DO010");
ok("an assembly cannot be deleted", (await sqlstate(`delete from document_assemblies where id = $1`, [A1.id])) === "DO010");
ok("a page cannot be moved inside an assembly (UPDATE)",
  (await sqlstate(`update document_assembly_pages set position = 9 where assembly_id = $1`, [A1.id])) === "DO010");
ok("a page cannot be taken out of an assembly (DELETE)",
  (await sqlstate(`delete from document_assembly_pages where assembly_id = $1`, [A1.id])) === "DO010");

// ── 5. one org, no client path ─────────────────────────────────────────────────────────────────────
ok("a direct insert listing another carrier's page is refused by the composite FK", (await sqlstate(
  `insert into document_assembly_pages (assembly_id, org_id, position, page_id) values ($1, $2, 9, $3)`,
  [A1.id, ORG, PX])) === "23503");
ok("a direct insert filing a page under another carrier's assembly is refused", (await sqlstate(
  `insert into document_assembly_pages (assembly_id, org_id, position, page_id) values ($1, $2, 9, $3)`,
  [A1.id, OTHER, PX])) === "23503");
ok("a position below 1 is refused", (await sqlstate(
  `insert into document_assembly_pages (assembly_id, org_id, position, page_id) values ($1, $2, 0, $3)`,
  [S1.id, ORG, P3])) === "23514");

// ── 6. a read names its assembly (0455) ────────────────────────────────────────────────────────────
const SRC = (await one(`select source_id from document_pages where id = $1`, [P1])).source_id;
const readOf = (org, { source = null, assembly = null } = {}) => sqlstate(
  `insert into document_reads (org_id, source_id, assembly_id, profile, profile_version, requested_by)
   values ($1, $2, $3, 'shipping_document', 'sd-1', $4)`, [org, source, assembly, USER]);
ok("a read naming an assembly and no source is accepted", (await readOf(ORG, { assembly: A1.id })) === null);
ok("a read naming a source and no assembly is still accepted (the path old code writes)",
  (await readOf(ORG, { source: SRC })) === null);
ok("a read naming both a source and an assembly is refused", (await readOf(ORG, { source: SRC, assembly: A1.id })) === "23514");
ok("a read naming neither is refused", (await readOf(ORG)) === "23514");
ok("a read naming another carrier's assembly is refused by the composite FK",
  (await readOf(OTHER, { assembly: A1.id })) === "23503");
ok("even with the RPC's flag set, a read's assembly is fixed", await (async () => {
  const R = (await one(`select id from document_reads where assembly_id = $1`, [A1.id])).id;
  await db.exec("begin");
  try {
    await db.query(`select set_config('silvicom.document_read_transition', 'on', true)`);
    return (await sqlstate(`update document_reads set assembly_id = $2 where id = $1`, [R, E1.id])) === "DO012";
  } finally { await db.exec("rollback"); }
})());

async function asClient(org, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: USER, org_id: org, user_role: "admin", role: "authenticated" }),
    ]);
    const res = await db.query(sql, params);
    return { rows: res.rows, error: null };
  } catch (e) {
    return { rows: [], error: e.code ?? String(e.message) };
  } finally {
    await db.exec("rollback");
  }
}
for (const t of ["document_assemblies", "document_assembly_pages"]) {
  const r = await asClient(ORG, `select count(*)::int as n from ${t}`);
  ok(`an admin's browser session reads nothing from ${t} (no client policy)`, r.error === null && r.rows[0].n === 0, JSON.stringify(r));
}
// The privilege itself, not a call: a call from a browser session is refused by RLS on the tables
// underneath even with EXECUTE granted, so a 42501 from calling it cannot tell the revoke is there. The
// privilege holds twice over: 0454's own revoke, and 0412's default that closes every new function to
// clients — removing either one alone leaves it closed.
const FN = "public.document_assembly_create(uuid, uuid[], text, uuid, text, uuid)";
const grants = await one(
  `select has_function_privilege('authenticated', $1, 'execute') as authed, has_function_privilege('anon', $1, 'execute') as anon`,
  [FN]);
ok("neither a signed-in nor an anonymous browser session may execute document_assembly_create",
  grants.authed === false && grants.anon === false, JSON.stringify(grants));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
