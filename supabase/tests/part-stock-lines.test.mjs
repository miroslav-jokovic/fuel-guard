// part_stock_lines (0474, US6b F32): a stock line with its part's and location's names on one row,
// so the Labels search can be one `.or()` on the server instead of a filter over 200 browser rows.
//
// Pinned, against the real migrations:
//   1. The view carries the three fields the search reads (part number, description, location name)
//      beside the line's own, and a line whose part or location is another org's is not joined.
//   2. One `or()` over those three columns finds a line by any of them — the query PostgREST could
//      not express across embedded tables.
//   3. `security_invoker` holds: a browser token sees its own org's lines through the view and no
//      other org's, exactly as a direct read of `part_stock` does. Without it the view would run with
//      its owner's rights and hand every caller every shop's shelves.
//
// Run: node supabase/tests/part-stock-lines.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const rows = async (q, p = []) => (await db.query(q, p)).rows;

// Supabase-managed schemas, shimmed identically to rls.test.mjs.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false, file_size_limit bigint,
    allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);
await db.exec(
  "grant usage on schema public to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const org = async (name) => (await one(`insert into organizations (id,name) values (gen_random_uuid(),$1) returning id`, [name])).id;
const location = async (o, name, code) =>
  (await one(`insert into stock_locations (org_id,name,code) values ($1,$2,$3) returning id`, [o, name, code])).id;
const part = async (o, number, description) =>
  (await one(`insert into parts (org_id,part_number,description) values ($1,$2,$3) returning id`, [o, number, description])).id;
const line = (o, p, l, tag = null) =>
  db.query(`insert into part_stock (org_id,part_id,location_id,bin,tag_code) values ($1,$2,$3,'B4',$4)`, [o, p, l, tag]);

const ORG = await org("Silvicom");
const OTHER = await org("Somebody Else");
const MAIN = await location(ORG, "Main shop", "MAIN");
const YARD = await location(ORG, "North yard", "YARD");
const FILTER = await part(ORG, "LF-3000", "Oil filter, spin-on");
const BELT = await part(ORG, "BLT-77", "Serpentine belt");
await line(ORG, FILTER, MAIN, "S-0001");
await line(ORG, BELT, YARD);
const THEIRS = await part(OTHER, "XX-1", "Their own part");
await line(OTHER, THEIRS, await location(OTHER, "Their shop", "THEIRS"));

// ── 1. the row the search reads ───────────────────────────────────────────────────────────────
console.log("\n── 1. one row per line, with the three names on it");
const all = await rows(`select * from part_stock_lines where org_id = $1 order by part_number`, [ORG]);
ok("one row per stock line of the org (2)", all.length === 2, JSON.stringify(all));
const f = all.find((r) => r.part_id === FILTER);
ok("carries the part number, description and location name", f?.part_number === "LF-3000" && f?.part_description === "Oil filter, spin-on" && f?.location_name === "Main shop", JSON.stringify(f));
ok("carries the line's own fields beside them", f?.bin === "B4" && f?.tag_code === "S-0001" && f?.quantity_on_hand === 0 && f?.active === true && f?.unit_of_measure === "each");

// ── 2. one or() reaches all three ─────────────────────────────────────────────────────────────
console.log("\n── 2. a search over part number, description or location");
const search = async (term) =>
  (await rows(
    `select part_number from part_stock_lines where org_id = $1
       and (part_number ilike $2 or part_description ilike $2 or location_name ilike $2) order by part_number`,
    [ORG, `%${term}%`],
  )).map((r) => r.part_number);
ok("by part number", JSON.stringify(await search("lf-3")) === JSON.stringify(["LF-3000"]));
ok("by description", JSON.stringify(await search("serpentine")) === JSON.stringify(["BLT-77"]));
ok("by location name", JSON.stringify(await search("north")) === JSON.stringify(["BLT-77"]));
ok("and nothing of another org's, even when it matches", (await search("their")).length === 0);

// ── 3. security_invoker ───────────────────────────────────────────────────────────────────────
console.log("\n── 3. a browser token reads its own org through the view, and no other");
async function asTechnician(o, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "authenticated", sub: "00000000-0000-4000-8000-0000000000aa", org_id: o, user_role: "technician" }),
    ]);
    const r = await db.query(sql, params);
    await db.exec("rollback");
    return r.rows;
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}
const mine = await asTechnician(ORG, `select org_id from part_stock_lines`);
ok("its own org's two lines", Array.isArray(mine) && mine.length === 2 && mine.every((r) => r.org_id === ORG), JSON.stringify(mine));
const direct = await asTechnician(ORG, `select org_id from part_stock`);
ok("the same count as a direct read of part_stock", Array.isArray(direct) && direct.length === mine.length, JSON.stringify(direct));
const theirs = await asTechnician(OTHER, `select part_number from part_stock_lines`);
ok("the other org sees only its own line", Array.isArray(theirs) && theirs.length === 1 && theirs[0].part_number === "XX-1", JSON.stringify(theirs));
const opts = (await one(`select reloptions from pg_class where relname = 'part_stock_lines'`))?.reloptions ?? [];
ok("the view is security_invoker", opts.some((o) => /^security_invoker=(on|true)$/.test(o)), JSON.stringify(opts));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
