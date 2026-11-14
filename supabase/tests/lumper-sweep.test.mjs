// LUMPER-REVISED-RC-PLAN step LRC2, migration 0600: one lumper sweep applied in one transaction. What the
// sweep carries is written, what it no longer carries is removed inside its own window and nowhere else,
// a case is opened once per order and never reopened or closed by a sweep, and another carrier's rows are
// never touched. Then 0601: the revised RC filed on a case is fixed once filed, and removed, never deleted.
//
// Run:  node supabase/tests/lumper-sweep.test.mjs
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
/** null on success; else the SQLSTATE, and the DETAIL when the function sent one. */
const outcome = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return { code: e.code ?? String(e.message), detail: e.detail ?? null }; }
};
const sqlstate = async (q, p = []) => (await outcome(q, p))?.code ?? null;

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
const SINCE = "2026-08-15";

const order = (id, over = {}) => ({
  order_external_id: id, company_id: "TMS", order_status: "D", ordered_at: "2026-10-01T00:00:00Z", bill_date: null,
  customer_id: "C1", customer_name: "A Broker", dispatcher_user_id: "kane", dispatcher_name: "Kane", movement_external_id: "M" + id,
  consignee_name: "A Warehouse", consignee_city: "Joliet", consignee_state: "IL", consignee_arrived_at: null, consignee_departed_at: null, ...over,
});
const charge = (id, orderId, amount = 310) => ({ external_id: id, company_id: "TMS", order_external_id: orderId, charge_code: "LUM", descr: "Unloading", amount, sequence: 1 });
const payment = (id, orderId, over = {}) => ({
  external_id: id, company_id: "TMS", settlement_state: "paid", order_external_id: orderId, movement_external_id: null, deduct_code: "UNL",
  deduction_type: "D", amount: 310, transacted_at: "2026-10-02T00:00:00Z", reference_no: "EFS-" + id, driver_external_id: "DRV1", payee_id: "DRV1",
  tractor_unit: "101", is_void: false, ...over,
});
const bill = (id, orderId, lumper, over = {}) => ({
  external_id: id, company_id: "TMS", order_external_id: orderId, invoice_no: "5512", bill_date: "2026-10-05T00:00:00Z", bill_type: "I",
  canceled: "N", rebilled: "N", total_charges: 2400, lumper_amount: lumper, lumper_lines: lumper > 0 ? 1 : 0, ...over,
});
const apply = async (o, { orders = [], charges = [], payments = [], bills = [], since = SINCE, company = "TMS" } = {}) =>
  (await one(`select lumper_sweep_apply($1, $2, $3, $4, $5, $6, $7) as r`,
    [o, company, since, JSON.stringify(orders), JSON.stringify(charges), JSON.stringify(payments), JSON.stringify(bills)])).r;
const count = async (table, o = ORG) => Number((await one(`select count(*) n from ${table} where org_id = $1`, [o])).n);

// ── the first sweep ───────────────────────────────────────────────────────────────────────────
console.log("first sweep");
let r = await apply(ORG, {
  orders: [order("A"), order("B")],
  charges: [charge("OC1", "A"), charge("OC2", "B")],
  payments: [payment("D1", "A"), payment("P1", "B", { settlement_state: "pending" }), payment("D9", null, { deduct_code: "LUM", reference_no: null })],
  bills: [bill("BL1", "A", 0)],
});
ok("it reports what it wrote", r.orders === 2 && r.charges === 2 && r.payments === 3 && r.bills === 1 && r.casesOpened === 2, JSON.stringify(r));
ok("two orders, two charges, three payments, one bill stored", (await count("mcleod_lumper_orders")) === 2 && (await count("mcleod_lumper_charges")) === 2 && (await count("mcleod_lumper_payments")) === 3 && (await count("mcleod_lumper_bills")) === 1);
ok("a payment with no order number is kept", (await one(`select count(*) n from mcleod_lumper_payments where org_id = $1 and order_id is null`, [ORG])).n == 1);
ok("one case per order, open, code LUM", (await all(`select order_id, charge_code, closed_at from lumper_cases where org_id = $1 order by order_id`, [ORG])).map((c) => `${c.order_id}:${c.charge_code}:${c.closed_at}`).join() === "A:LUM:null,B:LUM:null");
ok("the sweep's time and counts are recorded", (await one(`select since::text s, orders from mcleod_lumper_sweeps where org_id = $1 and company_id = 'TMS'`, [ORG])).s === SINCE);
const firstSeen = (await one(`select first_seen_at f, opened_at o from mcleod_lumper_orders m join lumper_cases c using (org_id, company_id, order_id) where m.org_id = $1 and m.order_id = 'A'`, [ORG]));

// A person closes case B (the page's act, LRC3); a sweep must not undo it.
const closer = (await one(`insert into auth.users (email) values ('billing@example.com') returning id`)).id;
await db.query(`update lumper_cases set closed_at = now(), closed_by = $2, close_reason = 'included_in_rate' where org_id = $1 and order_id = 'B'`, [ORG, closer]);

// ── the second sweep: billing re-keyed A's charge, B's pending line was paid, the orphan was removed ──
console.log("second sweep");
r = await apply(ORG, {
  orders: [order("A", { bill_date: "2026-10-09T00:00:00Z" }), order("B")],
  charges: [charge("OC7", "A", 310), charge("OC2", "B")],
  payments: [payment("D1", "A"), payment("D2", "B")],
  bills: [bill("BL1", "A", 0), bill("BL2", "A", 0, { bill_type: "C" }), bill("BL3", "A", 310)],
});
ok("it reports what it removed", r.chargesRemoved === 1 && r.paymentsRemoved === 2 && r.billsRemoved === 0 && r.casesOpened === 0, JSON.stringify(r));
ok("the re-keyed charge replaces the old row, it does not add to it", (await all(`select charge_id from mcleod_lumper_charges where org_id = $1 and order_id = 'A'`, [ORG])).map((c) => c.charge_id).join() === "OC7");
ok("the pending line that was paid is gone and the paid one is there", (await all(`select settlement_state, payment_id from mcleod_lumper_payments where org_id = $1 and order_id = 'B'`, [ORG])).map((p) => `${p.settlement_state}:${p.payment_id}`).join() === "paid:D2");
ok("the removed payment with no order is gone", (await count("mcleod_lumper_payments")) === 2);
ok("the credit memo and the second invoice are stored beside the first", (await count("mcleod_lumper_bills")) === 3);
ok("the order keeps its first sighting and takes the new bill date", await (async () => {
  const o = await one(`select first_seen_at f, bill_date b, last_seen_at l from mcleod_lumper_orders where org_id = $1 and order_id = 'A'`, [ORG]);
  return String(o.f) === String(firstSeen.f) && o.b != null && o.l > o.f;
})());
ok("no second case, and the opening time is unchanged", (await count("lumper_cases")) === 2 && String((await one(`select opened_at o from lumper_cases where org_id = $1 and order_id = 'A'`, [ORG])).o) === String(firstSeen.o));
ok("a case a person closed stays closed", (await one(`select close_reason c from lumper_cases where org_id = $1 and order_id = 'B'`, [ORG])).c === "included_in_rate");

// ── the third sweep: A's charge was deleted in McLeod and A fell out of the sweep; an old order stays ──
console.log("third sweep");
await apply(ORG, { orders: [order("OLD", { ordered_at: "2026-03-01T00:00:00Z" })], charges: [charge("OC50", "OLD")], payments: [payment("D50", "OLD", { transacted_at: "2026-03-05T00:00:00Z" })], since: "2026-01-01" });
r = await apply(ORG, { orders: [order("B")], charges: [charge("OC2", "B")], payments: [payment("D2", "B")], bills: [] });
ok("an order inside the window that the sweep no longer returns loses its charges", (await all(`select 1 from mcleod_lumper_charges where org_id = $1 and order_id = 'A'`, [ORG])).length === 0);
ok("its payment dated inside the window is removed with it", (await all(`select 1 from mcleod_lumper_payments where org_id = $1 and order_id = 'A'`, [ORG])).length === 0);
ok("its bills are kept: a sweep that did not return the order says nothing about its invoices", (await all(`select 1 from mcleod_lumper_bills where org_id = $1 and order_id = 'A'`, [ORG])).length === 3);
ok("its case is still there for the rule to read", (await all(`select 1 from lumper_cases where org_id = $1 and order_id = 'A'`, [ORG])).length === 1);
ok("an order older than the window keeps its charge and its payment", (await all(`select 1 from mcleod_lumper_charges where org_id = $1 and order_id = 'OLD'`, [ORG])).length === 1 && (await all(`select 1 from mcleod_lumper_payments where org_id = $1 and order_id = 'OLD'`, [ORG])).length === 1);

// ── another carrier, another company ──────────────────────────────────────────────────────────
console.log("isolation");
await apply(OTHER, { orders: [order("B")], charges: [charge("OC2", "B", 99)], payments: [payment("D2", "B", { amount: 99 })] });
ok("the other carrier's sweep wrote its own rows", (await count("mcleod_lumper_orders", OTHER)) === 1 && (await count("lumper_cases", OTHER)) === 1);
ok("and changed nothing of ours", Number((await one(`select amount a from mcleod_lumper_charges where org_id = $1 and charge_id = 'OC2'`, [ORG])).a) === 310);
await apply(OTHER, { orders: [], charges: [], payments: [] });
ok("the other carrier's empty sweep removed its rows and none of ours", (await count("mcleod_lumper_charges", OTHER)) === 0 && (await count("mcleod_lumper_charges")) === 2);
await apply(ORG, { company: "TMS2", orders: [], charges: [], payments: [] });
ok("a sweep of another McLeod company leaves this company's rows", (await count("mcleod_lumper_charges")) === 2 && (await count("mcleod_lumper_payments")) === 2);

// ── what the tables refuse ────────────────────────────────────────────────────────────────────
console.log("guards");
ok("a sweep with no org is refused", (await sqlstate(`select lumper_sweep_apply(null, 'TMS', '2026-08-15', '[]', '[]', '[]', '[]')`)) === "22023");
ok("a case cannot be half closed", (await sqlstate(`update lumper_cases set closed_at = now() where org_id = $1 and order_id = 'A'`, [ORG])) === "23514");
ok("a close reason outside the list is refused", (await sqlstate(`update lumper_cases set closed_at = now(), closed_by = $2, close_reason = 'because' where org_id = $1 and order_id = 'A'`, [ORG, closer])) === "23514");
ok("a settlement state outside paid and pending is refused", (await sqlstate(`insert into mcleod_lumper_payments (org_id, company_id, settlement_state, payment_id, deduct_code, amount) values ($1, 'TMS', 'maybe', 'X', 'UNL', 1)`, [ORG])) === "23514");

// ── the revised RC on a case (0601) ───────────────────────────────────────────────────────────
console.log("revised RC files");
const CASE_A = (await one(`select id from lumper_cases where org_id = $1 and order_id = 'A'`, [ORG])).id;
const THEIR_CASE = (await one(`select id from lumper_cases where org_id = $1 limit 1`, [OTHER])).id;
const file = (o, c, over = {}) => {
  const f = { id: crypto.randomUUID(), name: "revised-rc.pdf", mime: "application/pdf", size: 1200, sha: "a".repeat(64), ...over };
  return outcome(
    `insert into lumper_case_files (id, org_id, case_id, file_name, mime, byte_size, sha256, storage_path, uploaded_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [f.id, o, c, f.name, f.mime, f.size, f.sha, `${o}/${c}/${f.id}`, closer]).then((e) => ({ e, id: f.id }));
};
const filed = await file(ORG, CASE_A);
ok("a revised RC is filed on a case", filed.e === null, JSON.stringify(filed.e));
ok("a file cannot be put on another carrier's case (LR004)", (await file(ORG, THEIR_CASE)).e?.code === "LR004");
ok("a file type outside PDF, JPEG and PNG is refused", (await file(ORG, CASE_A, { mime: "application/zip" })).e?.code === "23514");
ok("a file name with a path in it is refused", (await file(ORG, CASE_A, { name: "../rc.pdf" })).e?.code === "23514");
ok("a filed paper is never changed (LR002)", (await sqlstate(`update lumper_case_files set file_name = 'other.pdf' where id = $1`, [filed.id])) === "LR002");
ok("a filed paper is never deleted (LR001)", (await sqlstate(`delete from lumper_case_files where id = $1`, [filed.id])) === "LR001");
ok("removing needs who and why together", (await sqlstate(`update lumper_case_files set removed_at = now() where id = $1`, [filed.id])) === "23514");
ok("it is removed with a person and a reason", (await sqlstate(`update lumper_case_files set removed_at = now(), removed_by = $2, remove_reason = 'wrong load' where id = $1`, [filed.id, closer])) === null);
ok("a removed file is not removed twice (LR003)", (await sqlstate(`update lumper_case_files set remove_reason = 'again, differently' where id = $1`, [filed.id])) === "LR003");
ok("the row is still there after removal", (await all(`select 1 from lumper_case_files where id = $1`, [filed.id])).length === 1);
await db.query(`delete from organizations where id = $1`, [OTHER]);
ok("an organisation that goes takes its cases and files with it", (await count("lumper_cases", OTHER)) === 0);

for (const t of ["lumper_case_files", "mcleod_lumper_orders", "mcleod_lumper_charges", "mcleod_lumper_payments", "mcleod_lumper_bills", "mcleod_lumper_sweeps", "lumper_cases"]) {
  const row = await one(`select c.relrowsecurity rls, (select count(*) from pg_policies p where p.tablename = c.relname) n from pg_class c where c.relname = $1`, [t]);
  ok(`${t}: row level security on, no client policy`, row.rls === true && Number(row.n) === 0, JSON.stringify(row));
}
{
  const p = await one(
    `select bool_or(has_function_privilege('anon', p.oid, 'execute')) a, bool_or(has_function_privilege('authenticated', p.oid, 'execute')) u,
            bool_or(has_function_privilege('service_role', p.oid, 'execute')) s from pg_proc p where p.proname = 'lumper_sweep_apply'`);
  ok("lumper_sweep_apply: service role only", p.a === false && p.u === false && p.s === true, JSON.stringify(p));
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
