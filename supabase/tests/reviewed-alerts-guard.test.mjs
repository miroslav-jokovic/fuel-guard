// FuelGuard — a reviewed alert cannot be deleted (migration 0437; F02-F04 AUDIT A3, Q-F8 (a)).
//
// WHY THIS FILE EXISTS. 311 alerts reviewed between 07-01 and 08-05 are gone from production, with
// their verdicts and their history: the scoring of the time deleted and re-created cases. Today's
// scoring does not, and 0437 makes the database refuse it outright, so no future rebuild, re-score or
// fill delete can do it again. A trigger nothing exercises is invisible until it fires in production,
// and the unit suites run against a Supabase fake, so it is proven here, in PGlite, against the full
// migration ledger.
//
// What can be wrong, each asserted below:
//   • A REBUILD LOSES THE VERDICT. Re-scoring a fill whose case a person closed must leave that case,
//     its disposition and its transitions exactly as they were.
//   • THE DOOR IS STILL OPEN. A direct delete, or a fill delete that cascades onto the alert, must be
//     refused — and refused WHOLE: the fill must survive too.
//   • THE GUARD IS TOO WIDE. An open or superseded case nobody touched holds no verdict; it must still
//     go with its fill, and deleting an organization must still remove everything.
//
// Run:  node supabase/tests/reviewed-alerts-guard.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SUPA = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(SUPA, f), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const count = async (q, p = []) => Number((await one(q, p)).n);
/** Run a statement and return its error message, or null when it succeeded. */
const err = async (p) => { try { await p; return null; } catch (e) { return e.message; } };

// Supabase-managed objects (present in a real project; shimmed here), as in rls.test.mjs.
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
  grant usage on schema public, storage to anon, authenticated, service_role;
`);

console.log(`Applying ${MIGRATIONS.length} migrations in lexical order`);
for (const name of MIGRATIONS) {
  await db.exec(read(`migrations/${name}`).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────
const ORG = (await one(`insert into organizations (name) values ('Alert Guard Co') returning id`)).id;
const REVIEWER = (await one(`insert into auth.users (email) values ('reviewer@x.test') returning id`)).id;

const fill = async (org = ORG) =>
  (await one(`insert into fuel_transactions (org_id, fueled_at, gallons) values ($1, now(), 100) returning id`, [org])).id;

/** A case in `status`, optionally with a disposition and a transition a person wrote. */
const alert = async (txn, status, { disposition = null, transition = false, rule = "theft_case", org = ORG } = {}) => {
  const id = (await one(
    `insert into anomalies (org_id, transaction_id, rule_id, severity, status, message, source, disposition)
     values ($1, $2, $3, 'high', $4::anomaly_status, 'seeded', 'rules', $5) returning id`,
    [org, txn, rule, status, disposition],
  )).id;
  if (transition)
    await db.query(
      `insert into anomaly_transitions (org_id, anomaly_id, from_status, to_status, from_version, to_version, note, disposition, actor_id)
       values ($1, $2, 'open', $3::anomaly_status, 1, 2, 'looked at it', $4, $5)`,
      [org, id, status === "superseded" ? "dismissed" : status, disposition, REVIEWER],
    );
  return id;
};

const exists = async (table, id) => (await count(`select count(*) n from ${table} where id = $1`, [id])) === 1;
const transitionsOf = async (id) => count(`select count(*) n from anomaly_transitions where anomaly_id = $1`, [id]);

/** Re-score a fill through the production RPC, as a rebuild does: a fresh attempt, then persist. */
const rescore = async (txn, kase) => {
  const attempt = (await one(
    `insert into scoring_attempts (id, org_id, transaction_id, engine_version, result_hash) values (gen_random_uuid(), $1, $2, 'v-matrix', 'h') returning id`,
    [ORG, txn],
  )).id;
  return err(db.query(
    `select public.persist_scoring_outcome_v2($1, $2, $3, null, now(), 'v-matrix', 'h', $4::jsonb, $5::jsonb, null, null, null, null)`,
    [attempt, ORG, txn, kase === null ? null : JSON.stringify(kase), JSON.stringify({ has_anomaly: kase !== null })],
  ));
};

console.log("\n-- a rebuild over a case a person closed --");
{
  const txn = await fill();
  const closed = await alert(txn, "dismissed", { disposition: "false_positive", transition: true });

  const r1 = await rescore(txn, { rule_id: "theft_case", severity: "critical", message: "re-scored", evidence: {} });
  ok("re-scoring the fill with a case succeeds", r1 === null, r1 ?? "");
  const r2 = await rescore(txn, null);
  ok("re-scoring it with no case succeeds", r2 === null, r2 ?? "");

  const row = await one(`select status, disposition, message from anomalies where id = $1`, [closed]);
  ok("the closed case survives both", row !== undefined);
  ok("…still dismissed, as false_positive, with its own message", row?.status === "dismissed" && row?.disposition === "false_positive" && row?.message === "seeded", JSON.stringify(row));
  ok("…and its transition survives", (await transitionsOf(closed)) === 1);
}

console.log("\n-- the door: deleting a reviewed alert is refused --");
for (const [label, status, opts] of [
  ["dismissed with a verdict", "dismissed", { disposition: "false_positive" }],
  ["resolved", "resolved", {}],
  ["under investigation", "investigating", {}],
  ["open, but carrying a disposition", "open", { disposition: "inconclusive" }],
  ["re-opened (open, with a transition)", "open", { transition: true }],
]) {
  const id = await alert(await fill(), status, opts);
  const refused = await err(db.query(`delete from anomalies where id = $1`, [id]));
  ok(`a case ${label} cannot be deleted`, /reviewed_alert/.test(refused ?? ""), refused ?? "(deleted)");
  ok(`…and is still there`, await exists("anomalies", id));
}

console.log("\n-- the live route: a fill delete that would cascade onto a reviewed alert --");
{
  const txn = await fill();
  const closed = await alert(txn, "dismissed", { disposition: "confirmed", transition: true });
  const refused = await err(db.query(`delete from fuel_transactions where id = $1`, [txn]));
  ok("deleting the fill is refused", /reviewed_alert/.test(refused ?? ""), refused ?? "(deleted)");
  ok("the fill is still there", await exists("fuel_transactions", txn));
  ok("the alert is still there", await exists("anomalies", closed));
  ok("its transition is still there", (await transitionsOf(closed)) === 1);
}

console.log("\n-- not too wide: an untouched case still goes with its fill --");
{
  const txnOpen = await fill();
  const open = await alert(txnOpen, "open");
  const r = await err(db.query(`delete from fuel_transactions where id = $1`, [txnOpen]));
  ok("deleting a fill whose only case is open and untouched succeeds", r === null, r ?? "");
  ok("…and the case goes with it", !(await exists("anomalies", open)));

  const superseded = await alert(await fill(), "superseded");
  const s = await err(db.query(`delete from anomalies where id = $1`, [superseded]));
  ok("an untouched superseded case can be deleted", s === null, s ?? "");
}

console.log("\n-- deleting the organization still removes everything --");
{
  const other = (await one(`insert into organizations (name) values ('Leaving Co') returning id`)).id;
  const txn = await fill(other);
  const closed = await alert(txn, "dismissed", { disposition: "confirmed", transition: true, org: other });
  const r = await err(db.query(`delete from organizations where id = $1`, [other]));
  ok("deleting an org holding a reviewed alert succeeds", r === null, r ?? "");
  ok("…its alert is gone", !(await exists("anomalies", closed)));
  ok("…its fill is gone", !(await exists("fuel_transactions", txn)));
  ok("…its transitions are gone", (await transitionsOf(closed)) === 0);
  ok("the other org's reviewed alerts are untouched", (await count(`select count(*) n from anomalies where org_id = $1 and status = 'dismissed'`, [ORG])) > 0);
}

console.log("\n-- the guard is the database's own --");
{
  const g = await one(`select has_function_privilege('authenticated', 'public.anomalies_reviewed_cannot_be_deleted()', 'execute') as can`);
  ok("the browser role cannot call the guard function", g?.can === false);
  const t = await one(`select count(*) n from pg_trigger where tgrelid = 'public.anomalies'::regclass and tgname = 'anomalies_reviewed_cannot_be_deleted' and tgenabled <> 'D'`);
  ok("the trigger is installed and enabled", Number(t.n) === 1);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
