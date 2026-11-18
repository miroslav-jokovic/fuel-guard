// Silvicom 360 — a toll statement's reads and lines (migration 0633; TOLLS-PER-TRUCK-PLAN.md TL4b).
//
// 1. A read is written whole by record_toll_statement_read: the attempt, every line, and the
//    statement's read columns, in one transaction; lines must run 0..n-1 exactly once (TS107).
// 2. A refusal is kept with its sentence and no lines (TS106); a statement is read once (TS105); a
//    removed statement is not read (TS104); another org's statement is not found (TS103).
// 3. A toll names a tag or a plate and a time; a non-toll line names neither and says what it is.
// 4. Reads and lines are never changed (TS102) and never deleted (TS101), except with the org.
// 5. RLS on with no client policy; the write function is closed to clients.
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
/** Run a statement and report the SQLSTATE it raised, or null when it succeeded. */
const refuses = async (q, p = []) => {
  try {
    await db.query(q, p);
    return null;
  } catch (e) {
    return e.code ?? "unknown";
  }
};

// Supabase-managed schemas, shimmed identically to unit-tags.test.mjs.
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
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));


const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Fleet') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Rival') returning id`)).id;
const USER = "11111111-1111-4111-8111-111111111111";
let shaSeq = 0;
const statement = async (org) =>
  (await one(
    `insert into toll_statements (id, org_id, provider, file_name, format, byte_size, sha256, storage_path, uploaded_by)
     values (gen_random_uuid(), $1::uuid, 'ezpass', 'June.pdf', 'pdf', 1000, $2, $1::text || '/' || gen_random_uuid(), $3::uuid) returning id`,
    [org, (++shaSeq).toString(16).padStart(64, "0"), USER],
  )).id;

const READ = { outcome: "read", reader: "ezpass-nj@1", account: "1000200030004", period_start: "2026-06-27", period_end: "2026-07-26", printed_charges_cents: 2350, ties: [{ label: "Ending Balance", printedCents: 100, readCents: 100 }] };
const toll = (i, over = {}) => ({ line_index: i, kind: "toll", tag_number: "09990000001", plate: null, agency: "ILTOLL", exit_plaza: "17", exit_at: "2026-06-28T14:24:00", amount_cents: 845, page: 1, match_key: `ezpass|09990000001|2026-06-28T14:24|17|845|${i}`, ...over });
const fee = (i) => ({ line_index: i, kind: "service_fee", label: "Service Fee", amount_cents: 100, page: 1, match_key: `ezpass|fee|2026-06-27|100|${i}` });
const record = (org, stmt, read, lines) =>
  refuses(`select record_toll_statement_read($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::jsonb)`, [org, stmt, USER, JSON.stringify(read), JSON.stringify(lines)]);
const count = async (table, stmt) => Number((await one(`select count(*)::int as n from ${table} where statement_id = $1`, [stmt])).n);

// ── 1: a read is written whole ────────────────────────────────────────────────────────────────
const JUNE = await statement(ORG);
{
  const r = await record(ORG, JUNE, READ, [toll(0), toll(1, { amount_cents: 1405, match_key: "ezpass|k|1" }), fee(2)]);
  ok("a read is kept with every line", r === null, r);
}
ok("…three lines", (await count("toll_statement_lines", JUNE)) === 3);
{
  const s = await one(`select period_start::text, period_end::text, printed_total::text, read_at is not null as read from toll_statements where id = $1`, [JUNE]);
  ok("…and the statement's period, printed total and read time are filled", s.period_start === "2026-06-27" && s.period_end === "2026-07-26" && s.printed_total === "23.50" && s.read === true, JSON.stringify(s));
}
{
  const r = await one(`select line_count, toll_line_count, toll_cents from toll_statement_reads where statement_id = $1`, [JUNE]);
  ok("the read counts its tolls itself: two tolls, $22.50, three lines", r.line_count === 3 && r.toll_line_count === 2 && Number(r.toll_cents) === 2250, JSON.stringify(r));
}
{
  const l = await one(`select exit_at::text, amount_cents from toll_statement_lines where statement_id = $1 and line_index = 0`, [JUNE]);
  ok("a toll keeps its local time as printed, with no zone", l.exit_at === "2026-06-28 14:24:00" && Number(l.amount_cents) === 845, JSON.stringify(l));
}
// A doubled position never reaches TS107: the (read_id, line_index) key refuses it first (23505).
for (const [name, lines, code] of [
  ["a gap in the positions", [toll(0), toll(2)], "TS107"],
  ["a position given twice", [toll(0), toll(0, { match_key: "ezpass|k|2" })], "23505"],
  ["positions that do not start at 0", [toll(1)], "TS107"],
]) {
  const s = await statement(ORG);
  const r = await record(ORG, s, READ, lines);
  ok(`${name} is refused (${code})`, r === code, r);
  ok(`…and nothing of that read is left`, (await count("toll_statement_reads", s)) === 0 && (await count("toll_statement_lines", s)) === 0);
}

// ── 2: refusals, once, removed, other org ─────────────────────────────────────────────────────
{
  const s = await statement(ORG);
  const r = await record(ORG, s, { outcome: "refused", reader: "ezpass-nj@1", message: "Ending Balance: printed $1.00, read $2.00" }, []);
  ok("a refusal is kept with its sentence", r === null, r);
  ok("…with no lines and the statement still unread", (await count("toll_statement_lines", s)) === 0 && (await one(`select read_at from toll_statements where id = $1`, [s])).read_at === null);
  ok("a refusal cannot carry lines (TS106)", (await record(ORG, s, { outcome: "refused", reader: "x", message: "m" }, [toll(0)])) === "TS106");
  ok("a refusal needs its sentence", (await record(ORG, s, { outcome: "refused", reader: "x" }, [])) === "23514");
  ok("a statement refused before may still be read", (await record(ORG, s, READ, [toll(0)])) === null);
}
ok("a statement is read once (TS105)", (await record(ORG, JUNE, READ, [toll(0)])) === "TS105");
{
  const s = await statement(ORG);
  await db.query(`update toll_statements set removed_at = now(), removed_by = $2, remove_reason = 'wrong provider' where id = $1`, [s, USER]);
  ok("a removed statement is not read (TS104)", (await record(ORG, s, READ, [toll(0)])) === "TS104");
}
ok("another org's statement is not found (TS103)", (await record(OTHER, JUNE, READ, [toll(0)])) === "TS103");
ok("a read must say its account and period", (await record(ORG, await statement(ORG), { ...READ, account: null }, [toll(0)])) === "23514");

// ── 3: what a line names ──────────────────────────────────────────────────────────────────────
ok("a toll with neither tag nor plate is refused", (await record(ORG, await statement(ORG), READ, [toll(0, { tag_number: null })])) === "23514");
ok("a toll with no time is refused", (await record(ORG, await statement(ORG), READ, [toll(0, { exit_at: null })])) === "23514");
ok("a plate-only toll is kept", (await record(ORG, await statement(ORG), READ, [toll(0, { tag_number: null, plate: "P7654321" })])) === null);
ok("a fee naming a tag is refused", (await record(ORG, await statement(ORG), READ, [{ ...fee(0), tag_number: "09990000001" }])) === "23514");
ok("a fee that does not say what it is is refused", (await record(ORG, await statement(ORG), READ, [{ ...fee(0), label: null }])) === "23514");
ok("a kind outside the five is refused", (await record(ORG, await statement(ORG), READ, [{ ...fee(0), kind: "prepass" }])) === "23514");

// ── 4: never changed, never deleted ───────────────────────────────────────────────────────────
ok("a line is never changed (TS102)", (await refuses(`update toll_statement_lines set amount_cents = 1 where statement_id = $1`, [JUNE])) === "TS102");
ok("a read is never changed (TS102)", (await refuses(`update toll_statement_reads set account = 'x' where statement_id = $1`, [JUNE])) === "TS102");
ok("a line is never deleted (TS101)", (await refuses(`delete from toll_statement_lines where statement_id = $1`, [JUNE])) === "TS101");
ok("a read is never deleted (TS101)", (await refuses(`delete from toll_statement_reads where statement_id = $1`, [JUNE])) === "TS101");
{
  const s = await statement(OTHER);
  await record(OTHER, s, READ, [toll(0)]);
  ok("an organisation that goes takes its reads and lines", (await refuses(`delete from organizations where id = $1`, [OTHER])) === null);
  ok("…and none is left", Number((await one(`select count(*)::int as n from toll_statement_lines where org_id = $1`, [OTHER])).n) === 0);
}

// ── 5: closed to clients ──────────────────────────────────────────────────────────────────────
for (const t of ["toll_statement_reads", "toll_statement_lines"]) {
  const rls = await one(`select relrowsecurity as on, (select count(*)::int from pg_policies where tablename = $1) as policies from pg_class where relname = $1`, [t]);
  ok(`${t}: RLS is on with no client policy`, rls.on === true && rls.policies === 0);
}
{
  const g = await one(`select has_function_privilege('authenticated', 'record_toll_statement_read(uuid, uuid, uuid, jsonb, jsonb)', 'execute') as a, has_function_privilege('anon', 'record_toll_statement_read(uuid, uuid, uuid, jsonb, jsonb)', 'execute') as b`);
  ok("the write function is closed to the browser", g.a === false && g.b === false);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
