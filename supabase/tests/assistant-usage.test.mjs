// Silvicom 360 — Ask AI's usage ledger (migration 0584, F21 R2; PLAN.md Step 1a, Q-AI1).
//
// What the database itself must guarantee, whoever calls the functions:
//   · `record_assistant_answer` writes one ledger row AND adds every prompt token (uncached, cache read,
//     cache write) and every output token to the carrier's month in `org_usage_month`, in one call;
//   · an answer that spent nothing writes its row and no counter row; `runs` (hazmat's) never moves;
//   · `assistant_month_spend` sums cost from an instant, per carrier, never another's;
//   · a malformed outcome or a negative count is refused; the bell takes `ai_assistant_budget`;
//   · a browser can read the ledger through no policy and call neither function.
//
// Run: node supabase/tests/assistant-usage.test.mjs
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
const ANA = (await one(`insert into auth.users (email) values ('ana@silvicom.test') returning id`)).id;
await db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,'admin')`, [ORG, ANA]);
const month = (await one(`select to_char(now(), 'YYYY-MM') m`)).m;
const record = (org, o = {}) => db.query(
  `select public.record_assistant_answer($1,$2,'claude-haiku-5-5',$3,$4,$5,$6,$7,$8,$9,$10,$11) id`,
  [org, ANA, o.rounds ?? 2, o.input ?? 1200, o.read ?? 9000, o.write ?? 300, o.output ?? 400, o.cost ?? 1234, o.ms ?? 2100, o.tools ?? ["fuel_report"], o.outcome ?? "answered"],
);
const counter = (org) => one(`select input_tokens::int i, output_tokens::int o, runs from org_usage_month where org_id=$1 and yyyymm=$2`, [org, month]);

console.log("record_assistant_answer — the row and the counter, in one call");
await record(ORG);
const row = await one(`select * from ai_assistant_usage where org_id=$1`, [ORG]);
ok("one ledger row with every count as given", row && row.input_tokens === 1200 && row.cache_read_tokens === 9000 && row.cache_write_tokens === 300
  && row.output_tokens === 400 && Number(row.cost_micro_usd) === 1234 && row.rounds === 2 && row.latency_ms === 2100
  && row.tools.join() === "fuel_report" && row.outcome === "answered" && row.user_id === ANA && row.model === "claude-haiku-5-5", JSON.stringify(row));
let c = await counter(ORG);
ok("the month's counter took all prompt tokens (1200 + 9000 + 300) and the output", c && c.i === 10500 && c.o === 400, JSON.stringify(c));
ok("runs keeps 0130's meaning (hazmat runs) and does not move", c && c.runs === 0, JSON.stringify(c));
await record(ORG, { input: 100, read: 0, write: 0, output: 50, cost: 66 });
c = await counter(ORG);
ok("a second answer adds to the same month row", c.i === 10600 && c.o === 450, JSON.stringify(c));
await record(ORG_B, { input: 0, read: 0, write: 0, output: 0, cost: 0, rounds: 0, outcome: "error", tools: [] });
ok("an answer that spent nothing writes its row and no counter row",
  (await one(`select count(*)::int n from ai_assistant_usage where org_id=$1`, [ORG_B])).n === 1 && (await counter(ORG_B)) === undefined);

console.log("assistant_month_spend — per carrier, from an instant");
const spend = (org, since) => one(`select cost_micro_usd::int c, answers from public.assistant_month_spend($1, $2)`, [org, since]);
const s = await spend(ORG, new Date(Date.now() - 3600_000).toISOString());
ok("sums this carrier's answers since the instant", s.c === 1300 && s.answers === 2, JSON.stringify(s));
await db.query(`update ai_assistant_usage set asked_at = now() - interval '40 days' where org_id=$1 and cost_micro_usd=66`, [ORG]);
const s2 = await spend(ORG, new Date(Date.now() - 86400_000).toISOString());
ok("an answer before the instant is not this month's", s2.c === 1234 && s2.answers === 1, JSON.stringify(s2));
ok("another carrier's spend is never summed in", (await spend(ORG_B, "2000-01-01")).c === 0);

console.log("refusals");
ok("an outcome outside the five is refused (23514)", (await sqlstate(
  `select public.record_assistant_answer($1,$2,'m',1,1,0,0,1,1,1,'{}','great')`, [ORG, ANA])) === "23514");
ok("a negative token count is refused (23514)", (await sqlstate(
  `select public.record_assistant_answer($1,$2,'m',1,-5,0,0,1,1,1,'{}','answered')`, [ORG, ANA])) === "23514");
const check = (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname='notification_events_category_check'`)).d;
ok("the bell's category CHECK carries ai_assistant_budget (0584) and keeps ads_creative_retired (0581)",
  check.includes("'ai_assistant_budget'") && check.includes("'ads_creative_retired'"), check);

console.log("a browser reaches none of it");
const claims = { sub: ANA, role: "authenticated" };
const sel = await asUser(claims, `select * from ai_assistant_usage`);
ok("an admin's session reads no ledger row (RLS, no policy)", !sel.error && sel.rows.length === 0, JSON.stringify(sel));
const call = await asUser(claims, `select public.record_assistant_answer('${ORG}','${ANA}','m',1,1,0,0,1,1,1,'{}','answered')`);
ok("…and cannot call record_assistant_answer", Boolean(call.error), JSON.stringify(call));
const sp = await asUser(claims, `select * from public.assistant_month_spend('${ORG}', now())`);
ok("…or assistant_month_spend", Boolean(sp.error), JSON.stringify(sp));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
