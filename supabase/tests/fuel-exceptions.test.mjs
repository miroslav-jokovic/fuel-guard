// FuelGuard — fuel_exceptions matrix (migration 0250).
//
// The ledger's whole value is that a finding SURVIVES being found again. Four properties carry that,
// and every one fails quietly:
//
//   1. A RE-RUN MUST NOT RESET A PERSON'S WORK (D-FX10). If `sync_fuel_exceptions` touches `status`,
//      `assigned_to` or `resolution_note`, then every Monday's reconciliation silently reopens what
//      somebody closed on Friday — and nobody notices, because the row is still there.
//   2. A FINDING THAT STOPS APPEARING IS CLOSED, NOT DELETED. "Nobody decided anything, it stopped
//      appearing" and "somebody dismissed it" are different facts about a $9,000 dispute.
//   3. THE ACT LOG IS APPEND-ONLY, AND STILL PRUNABLE. Who closed a dispute may not be rewritten; the
//      table must still be removable with its parent, or `fuel_exceptions` quietly becomes evidence.
//   4. NO CLIENT WRITE PATH. A browser that can insert an exception can assert a discrepancy no
//      detector ever produced.
//
// Run:  node supabase/tests/fuel-exceptions.test.mjs
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
    bucket_id text, name text, owner uuid, created_at timestamptz default now()
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
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;
const USER = (await one(`insert into auth.users (id,email) values (gen_random_uuid(),'a@b.c') returning id`)).id;

/**
 * A NEW run row per reconciliation, which is what production does — and the reason 0253 exists.
 *
 * The first version of this fixture created one `RUN` and reused it for every `sync()` call. That is
 * the one shape in which 0250's close clause worked: it was scoped `where e.run_id = p_run`, and with
 * a fixed run id the second call's `p_run` still matched rows the first call had written. The deployed
 * `runFuelReconciliation` inserts a new row per upload, so in production the upsert had already moved
 * every seen finding onto the new run id and NOTHING COULD EVER CLOSE. The fixture is the production
 * shape now; re-run this file against 0250 and three assertions below go red.
 */
const newRun = async (from = "2026-08-17", to = "2026-08-23", org = ORG) =>
  (await one(
    `insert into fuel_recon_runs (org_id, source_kind, period_start, period_end, tol_gallons,
       tol_amount_abs, tol_amount_pct, max_day_drift, matcher_version, summary)
     values ($1,'weekly_statement',$2,$3,1,1,0.01,1,'f4','{}'::jsonb) returning id`, [org, from, to])).id;
const RUN = await newRun();
/** The kinds a reconciliation is authoritative for — `RECON_EXCEPTION_KINDS` in shared. */
const RECON_KINDS = ["recon_missing_in_system", "recon_missing_on_report", "recon_amount", "recon_gallons"];

/** What `reconFindings` produces, in the shape the RPC consumes. */
const finding = (fp, o = {}) => ({
  fingerprint: fp, kind: "recon_missing_in_system", occurredOn: "2026-08-17",
  amount: 242.11, amountKind: "unrecorded", transactionId: null,
  unit: "701", site: "436", city: "Amarillo", state: "TX", brand: null,
  evidence: { billedGallons: 48.2, authNo: "373364" }, ...o,
});
const sync = async (findings, opts = {}) =>
  await one(`select * from sync_fuel_exceptions($1, $2, $3::jsonb, $4, $5)`, [
    ORG,
    opts.run !== undefined ? opts.run : await newRun(opts.from, opts.to),
    JSON.stringify(findings),
    "actor" in opts ? opts.actor : USER,
    opts.kinds === undefined ? RECON_KINDS : opts.kinds,
  ]);

// ── 1. the first run files the findings ─────────────────────────────────────────────────────────
const r1 = await sync([finding("fp-a"), finding("fp-b", { amount: 55.12 })]);
ok("a run files what it found", Number(r1.inserted) === 2 && Number(r1.refreshed) === 0, JSON.stringify(r1));
ok("and each one opens with an event, so the log is complete from the first row",
  (await all(`select * from fuel_exception_events where org_id=$1 and kind='opened'`, [ORG])).length === 2);
ok("the finding carries its evidence",
  (await one(`select evidence->>'authNo' as a from fuel_exceptions where fingerprint='fp-a'`)).a === "373364");
ok("the RPC audits itself, because the service role makes the table triggers see no actor",
  (await all(`select * from audit_logs where action='fuel.exceptions_synced' and org_id=$1`, [ORG])).length === 1);

// ── 2. D-FX10: a re-run refreshes evidence and leaves the person's work alone ────────────────────
await db.query(
  `update fuel_exceptions set status='disputed', assigned_to=$1, resolution_note='Raised with Pilot 08-25'
     where org_id=$2 and fingerprint='fp-a'`, [USER, ORG]);

const r2 = await sync([finding("fp-a", { amount: 999.99, evidence: { billedGallons: 48.2, authNo: "CORRECTED" } }), finding("fp-b", { amount: 55.12 })]);
ok("the same findings a week later are refreshed, not duplicated",
  Number(r2.inserted) === 0 && Number(r2.refreshed) === 2, JSON.stringify(r2));

const a = await one(`select * from fuel_exceptions where org_id=$1 and fingerprint='fp-a'`, [ORG]);
ok("the evidence is updated", a.evidence.authNo === "CORRECTED" && Number(a.amount) === 999.99);
ok("the STATUS a person set is untouched", a.status === "disputed");
ok("so is the owner they assigned", a.assigned_to === USER);
ok("so is the note they wrote", a.resolution_note === "Raised with Pilot 08-25");
ok("and the row is the same row", (await one(`select count(*)::int n from fuel_exceptions where org_id=$1`, [ORG])).n === 2);

// ── 3. a finding that stops appearing is CLOSED, not deleted ────────────────────────────────────
const r3 = await sync([finding("fp-a")]); // fp-b no longer produced
ok("a finding the run no longer produces is closed", Number(r3.closed) === 1, JSON.stringify(r3));
const b = await one(`select * from fuel_exceptions where org_id=$1 and fingerprint='fp-b'`, [ORG]);
ok("it is still there, with its history", b.status === "resolved_by_reingest");
ok("and the reason is in the log, distinct from somebody dismissing it",
  (await all(`select * from fuel_exception_events where exception_id=$1 and kind='closed_by_reingest'`, [b.id])).length === 1);

// A finding closed that way and then found AGAIN is genuinely open again.
await sync([finding("fp-a"), finding("fp-b")]);
ok("and if it comes back, it is open again rather than staying closed",
  (await one(`select status from fuel_exceptions where org_id=$1 and fingerprint='fp-b'`, [ORG])).status === "open");

// But a decision a person made is never reopened by a detector.
await db.query(`update fuel_exceptions set status='dismissed' where org_id=$1 and fingerprint='fp-b'`, [ORG]);
await sync([finding("fp-a"), finding("fp-b")]);
ok("a dismissal survives the finding being produced again",
  (await one(`select status from fuel_exceptions where org_id=$1 and fingerprint='fp-b'`, [ORG])).status === "dismissed");
await db.query(`update fuel_exceptions set status='credited', credited_amount=200, credited_on='2026-09-01' where org_id=$1 and fingerprint='fp-b'`, [ORG]);
await sync([finding("fp-a"), finding("fp-b")]);
const credited = await one(`select status, credited_amount from fuel_exceptions where org_id=$1 and fingerprint='fp-b'`, [ORG]);
ok("and so does a credit, with the amount actually recovered",
  credited.status === "credited" && Number(credited.credited_amount) === 200);

// ── 3b. the close is scoped to a KIND and a PERIOD, never to a run id (0253) ────────────────────
// Everything above proves a finding closes. These four prove it closes only what this producer, over
// this window, is entitled to close — which is the half that turns a safe fix into an unsafe one if
// it is got wrong. Closing too much silently retires money the carrier is owed.

const other = (fp, o = {}) => finding(fp, { occurredOn: "2026-07-06", ...o });
await sync([other("fp-july")], { from: "2026-07-06", to: "2026-07-12" });

// A run over August must not close a July finding, even though it produces the same kinds.
const rAug = await sync([finding("fp-a")]);
ok("a run over one period does not close findings from another",
  Number(rAug.closed) === 0 &&
  (await one(`select status from fuel_exceptions where org_id=$1 and fingerprint='fp-july'`, [ORG])).status === "open",
  JSON.stringify(rAug));

// A producer that owns a different kind must not close a reconciliation finding it never looked for.
const rKind = await sync([], { from: "2026-07-06", to: "2026-07-12", kinds: ["contract_variance"] });
ok("a producer only closes the kinds it declares it owns",
  Number(rKind.closed) === 0 &&
  (await one(`select status from fuel_exceptions where org_id=$1 and fingerprint='fp-july'`, [ORG])).status === "open",
  JSON.stringify(rKind));

// The deployment-order default: the four-argument call the currently-deployed API still makes arrives
// with `p_kinds` null and must behave exactly as it does today, which is to close nothing.
const rNoKinds = await sync([], { from: "2026-07-06", to: "2026-07-12", kinds: null });
ok("a caller that declares no kinds closes nothing, so the old four-argument call stays safe",
  Number(rNoKinds.closed) === 0 &&
  (await one(`select status from fuel_exceptions where org_id=$1 and fingerprint='fp-july'`, [ORG])).status === "open");

// Somebody mid-conversation with the vendor keeps their row. A re-ingest is not entitled to end that.
await db.query(`update fuel_exceptions set status='disputed' where org_id=$1 and fingerprint='fp-july'`, [ORG]);
const rDisputed = await sync([], { from: "2026-07-06", to: "2026-07-12" });
ok("a disputed finding is never closed by a re-ingest",
  Number(rDisputed.closed) === 0 &&
  (await one(`select status from fuel_exceptions where org_id=$1 and fingerprint='fp-july'`, [ORG])).status === "disputed",
  JSON.stringify(rDisputed));

// And an EMPTY batch over the right window closes what is genuinely no longer there — the case a kind
// set derived from the batch could never express, because that set would be empty too.
await db.query(`update fuel_exceptions set status='open' where org_id=$1 and fingerprint='fp-july'`, [ORG]);
const rEmpty = await sync([], { from: "2026-07-06", to: "2026-07-12" });
ok("a run that finds nothing closes what it no longer finds",
  Number(rEmpty.closed) === 1 &&
  (await one(`select status from fuel_exceptions where org_id=$1 and fingerprint='fp-july'`, [ORG])).status === "resolved_by_reingest",
  JSON.stringify(rEmpty));

// The audit row carries the window and the kinds, so "why did this go away" is answerable later.
const audit = await one(`select meta from audit_logs where org_id=$1 and action='fuel.exceptions_synced'
                          order by created_at desc limit 1`, [ORG]);
ok("the sync audits the window and the kinds it closed against",
  audit.meta.periodStart === "2026-07-06" && audit.meta.periodEnd === "2026-07-12" &&
  Array.isArray(audit.meta.kinds) && audit.meta.kinds.includes("recon_amount"),
  JSON.stringify(audit.meta));

// ── 4. what may be recorded ─────────────────────────────────────────────────────────────────────
ok("only a credited exception may carry a credited amount",
  (await sqlstate(`update fuel_exceptions set credited_amount = 50 where org_id=$1 and fingerprint='fp-a'`, [ORG])) === "23514");
ok("an unknown kind is refused rather than filed",
  (await sqlstate(`insert into fuel_exceptions (org_id, kind, amount_kind, fingerprint)
                   values ($1,'made_up','overbilled','fp-x')`, [ORG])) === "23514");
ok("a finding with no transaction is FINE — that is the fuel-theft surface (D-FX2)",
  (await sqlstate(`insert into fuel_exceptions (org_id, kind, amount_kind, fingerprint)
                   values ($1,'recon_missing_in_system','unrecorded','fp-y')`, [ORG])) === null);

// ── 5. the act log ──────────────────────────────────────────────────────────────────────────────
const ev = (await all(`select id from fuel_exception_events where org_id=$1 limit 1`, [ORG]))[0];
ok("an event cannot be edited — who closed a dispute is not rewritable",
  (await sqlstate(`update fuel_exception_events set note='different' where id=$1`, [ev.id])) === "FE010");
await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ user_role: "admin", org_id: ORG })]);
ok("nor deleted by the API acting for a person",
  (await sqlstate(`delete from fuel_exception_events where id=$1`, [ev.id])) === "FE010");
// ...but retention must still be able to prune the pair. `auth_role()` is null for a bare service-role
// connection, which is the exemption 0213's style exists for.
await db.query(`select set_config('request.jwt.claims', '', false)`);
ok("retention can still prune an exception and its log together",
  (await sqlstate(`delete from fuel_exceptions where org_id=$1 and fingerprint='fp-y'`, [ORG])) === null);

// ── 6. no client write path, and org scope on read ──────────────────────────────────────────────
async function asClient(org, role, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: USER, org_id: org, user_role: role, role: "authenticated" }),
    ]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return { rows: res.rows, error: null };
  } catch (e) {
    await db.exec("rollback");
    return { rows: [], error: e.code ?? String(e.message) };
  }
}
for (const role of ["admin", "fleet_manager"]) {
  const ins = await asClient(ORG, role, `insert into fuel_exceptions (org_id, kind, amount_kind, fingerprint)
      values ($1,'recon_amount','overbilled','fp-client')`, [ORG]);
  ok(`a ${role} cannot file an exception from the browser`, ins.error === "42501");
  // An UPDATE against a table with no UPDATE policy does not RAISE — RLS simply matches no rows, and
  // the statement reports success having changed nothing. That asymmetry with INSERT (which raises
  // 42501 on the WITH CHECK) is easy to mistake for "the client can edit these", so it is asserted on
  // the effect rather than on an error that never comes.
  const upd = await asClient(ORG, role,
    `with u as (update fuel_exceptions set status='dismissed' where org_id=$1 returning 1)
     select count(*)::int n from u`, [ORG]);
  ok(`nor close one directly — RLS matches no rows, so nothing moves`, upd.error === null && upd.rows[0]?.n === 0,
    JSON.stringify(upd));
}
const rpc = await asClient(ORG, "admin", `select * from sync_fuel_exceptions($1,$2,'[]'::jsonb,null,null)`, [ORG, RUN]);
ok("and cannot call the sync RPC either — it is the service role's", rpc.error === "42501");

await sync([finding("fp-other")], { run: RUN });
await db.query(`insert into fuel_exceptions (org_id, kind, amount_kind, fingerprint)
                values ($1,'recon_amount','overbilled','fp-theirs')`, [OTHER]);
const mine = await asClient(ORG, "admin", `select count(*)::int n from fuel_exceptions`);
const theirs = await asClient(OTHER, "admin", `select count(*)::int n from fuel_exceptions`);
// fp-a, fp-b, fp-july and fp-other — fp-y was pruned by the retention check above, and fp-client was
// rolled back with the transaction that failed to insert it.
ok("a member reads only their own carrier's findings", mine.rows[0]?.n === 4, JSON.stringify(mine));
ok("and the other carrier reads only theirs", theirs.rows[0]?.n === 1, JSON.stringify(theirs));

// ── 7. the fingerprint is the identity ──────────────────────────────────────────────────────────
ok("two findings cannot share a fingerprint within an org",
  (await sqlstate(`insert into fuel_exceptions (org_id, kind, amount_kind, fingerprint)
                   values ($1,'recon_amount','overbilled','fp-a')`, [ORG])) === "23505");
ok("but two carriers may each have their own with the same one",
  (await sqlstate(`insert into fuel_exceptions (org_id, kind, amount_kind, fingerprint)
                   values ($1,'recon_amount','overbilled','fp-a')`, [OTHER])) === null);

// Release the WASM database before the verdict. This matrix exits explicitly only when it FAILS, so
// on the green path Node had to drain PGlite's handles on its own — ~10 seconds of idle wait after
// the last assertion, paid once per matrix per run. Measured 2026-09-05: 11.33s -> 1.32s here.
await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
