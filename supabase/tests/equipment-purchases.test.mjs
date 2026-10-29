// Silvicom 360 — equipment bills (migration 0530; MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §7a.4, M10a).
//
// 1. `record_equipment_purchase` writes the bill and points its items at it; a retry with the same id
//    returns the same row and writes nothing twice (D-INV27).
// 2. One live bill per vendor + invoice number, compared trimmed and case-blind; the refusal names
//    the index the API maps by (M10b).
// 3. Append-only (IV026): no edit, no delete, and a superseded bill is frozen whole.
// 4. A correction supersedes the live bill in the same call and carries its items, minus any the new
//    list leaves out; correcting a corrected bill is IV028, an unknown one IV027.
// 5. Items: not ours is IV024, already on another live bill is IV029, and a refusal writes nothing.
// 6. Same org by key: an item cannot point at another org's bill, nor a bill at another org's
//    FleetPal purchase order.
// 7. The paper: subject `equipment_purchase` and kind `equipment_invoice`, and the CHECKs equal the
//    shared lists. Service role only: RLS on with no policy, the function not executable by clients.

import { DOCUMENT_KINDS, DOCUMENT_SUBJECT_TYPES } from "../../packages/shared/dist/index.js";
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

// Supabase-managed schemas, shimmed identically to inventory-integrity.test.mjs.
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


const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Shop') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Rival') returning id`)).id;
const ACTOR = (await one(`select gen_random_uuid() id`)).id;
const TYPE = (await one(`insert into asset_types (org_id, name, serialized, default_kit_quantity, held_by) values ($1,'Tablet',true,1,'driver') returning id`, [ORG])).id;
const RTYPE = (await one(`insert into asset_types (org_id, name, serialized, default_kit_quantity, held_by) values ($1,'Tablet',true,1,'driver') returning id`, [OTHER])).id;
const asset = async (org, type) =>
  (await one(`insert into inventory_assets (org_id, asset_type_id, name) values ($1,$2,'Cab tablet') returning id`, [org, type])).id;
const [A1, A2, A3, A4] = [await asset(ORG, TYPE), await asset(ORG, TYPE), await asset(ORG, TYPE), await asset(ORG, TYPE)];
const RIVAL_ASSET = await asset(OTHER, RTYPE);
const PO = (await one(`insert into fleetpal_purchase_orders (org_id, fleetpal_id) values ($1,'po-1') returning id`, [ORG])).id;
const RIVAL_PO = (await one(`insert into fleetpal_purchase_orders (org_id, fleetpal_id) values ($1,'po-9') returning id`, [OTHER])).id;
const newId = async () => (await one(`select gen_random_uuid() id`)).id;

const bill = (over = {}) => ({
  vendor: "AT&T Business", invoiceNumber: "INV-1001", invoiceDate: "2026-10-02", total: "4120.50", assetIds: [], ...over,
});
const record = (row, org = ORG) =>
  db.query(`select (record_equipment_purchase($1, $2, $3::jsonb)).*`, [org, ACTOR, JSON.stringify(row)]);
const recordRefuses = async (row, org = ORG) => {
  try {
    await record(row, org);
    return null;
  } catch (e) {
    return e.code ?? "unknown";
  }
};
const purchaseOf = async (id) => (await one(`select purchase_id from inventory_assets where id = $1`, [id])).purchase_id;
const count = async (q, p = []) => Number((await one(q, p)).n);

// ── 1: the bill and its items, once ─────────────────────────────────────────────────────────────
const B1 = await newId();
const first = (await record(bill({ id: B1, assetIds: [A1, A2, A1], notes: "  ten on one order  " }))).rows[0];
ok("a bill is recorded with the caller's id", first.id === B1 && first.created_by === ACTOR && first.superseded_by === null);
ok("vendor and number are stored trimmed, notes too", first.vendor === "AT&T Business" && first.notes === "ten on one order");
ok("its items point at it (a repeated id counts once)", (await purchaseOf(A1)) === B1 && (await purchaseOf(A2)) === B1);
ok("an item it does not name is untouched", (await purchaseOf(A3)) === null);
const again = (await record(bill({ id: B1, total: "1.00", assetIds: [A3] }))).rows[0];
ok("a retry with the same id returns the row already written", again.id === B1 && Number(again.total) === 4120.5);
ok("...and writes nothing (no second row, no item moved)",
  (await count(`select count(*) n from equipment_purchases`)) === 1 && (await purchaseOf(A3)) === null);
ok("a bill with no id is refused (IV015)", (await recordRefuses(bill({ invoiceNumber: "X-1" }))) === "IV015");

// ── 2: one live bill per vendor + number ────────────────────────────────────────────────────────
ok("the same bill typed again is refused (23505)",
  (await recordRefuses(bill({ id: await newId(), vendor: " at&t business ", invoiceNumber: "inv-1001 " }))) === "23505");
const dupMessage = await (async () => {
  try {
    await record(bill({ id: await newId() }));
  } catch (e) {
    return e.message;
  }
})();
ok("the refusal names the index the API reads it by", /idx_equipment_purchases_live_invoice/.test(dupMessage ?? ""), dupMessage);
ok("another vendor may use the same number",
  (await recordRefuses(bill({ id: await newId(), vendor: "Amazon" }))) === null);
ok("another org may record the same bill", (await recordRefuses(bill({ id: await newId() }), OTHER)) === null);

// ── 3: append-only ──────────────────────────────────────────────────────────────────────────────
ok("editing a bill's total is refused (IV026)",
  (await refuses(`update equipment_purchases set total = 1 where id = $1`, [B1])) === "IV026");
ok("deleting a bill is refused (IV026)", (await refuses(`delete from equipment_purchases where id = $1`, [B1])) === "IV026");

// ── 4: a correction ─────────────────────────────────────────────────────────────────────────────
const B2 = await newId();
const fixed = (await record(bill({ id: B2, total: "4210.50", supersedes: B1, assetIds: [A1, A4] }))).rows[0];
const old = await one(`select superseded_by, superseded_at from equipment_purchases where id = $1`, [B1]);
ok("a correction keeps the same vendor and number (the old bill is no longer live)", fixed.id === B2);
ok("the old bill points at its correction, with a time", old.superseded_by === B2 && old.superseded_at !== null);
ok("an item named again moves onto the correction", (await purchaseOf(A1)) === B2);
ok("an item the correction leaves out is cleared", (await purchaseOf(A2)) === null);
ok("a new item joins it", (await purchaseOf(A4)) === B2);
ok("no item still points at the superseded bill",
  (await count(`select count(*) n from inventory_assets where purchase_id = $1`, [B1])) === 0);
ok("correcting the corrected bill is refused (IV028)",
  (await recordRefuses(bill({ id: await newId(), invoiceNumber: "INV-1001b", supersedes: B1 }))) === "IV028");
ok("correcting an unknown bill is refused (IV027)",
  (await recordRefuses(bill({ id: await newId(), invoiceNumber: "INV-2", supersedes: await newId() }))) === "IV027");
ok("another org's bill is unknown here (IV027)",
  (await recordRefuses(bill({ id: await newId(), invoiceNumber: "INV-3", supersedes: B1 }), OTHER)) === "IV027");
ok("a superseded bill is frozen whole — even its supersede pair (IV026)",
  (await refuses(`update equipment_purchases set superseded_at = now() where id = $1`, [B1])) === "IV026");
ok("the live bill still admits only the supersede pair (IV026 on any other column)",
  (await refuses(`update equipment_purchases set vendor = 'x' where id = $1`, [B2])) === "IV026");

// ── 5: the items ────────────────────────────────────────────────────────────────────────────────
const before = await count(`select count(*) n from equipment_purchases where org_id = $1`, [ORG]);
ok("an item that is not ours is refused (IV024)",
  (await recordRefuses(bill({ id: await newId(), invoiceNumber: "INV-4", assetIds: [A3, RIVAL_ASSET] }))) === "IV024");
ok("an item already on another live bill is refused (IV029)",
  (await recordRefuses(bill({ id: await newId(), invoiceNumber: "INV-5", assetIds: [A3, A4] }))) === "IV029");
ok("a refused bill wrote nothing — no row, no item moved",
  (await count(`select count(*) n from equipment_purchases where org_id = $1`, [ORG])) === before && (await purchaseOf(A3)) === null);
ok("a bill for no item at all is fine (the paper first, items later)",
  (await recordRefuses(bill({ id: await newId(), invoiceNumber: "INV-6" }))) === null);

// ── 6: same org, by key ─────────────────────────────────────────────────────────────────────────
const RIVAL_BILL = (await one(`select id from equipment_purchases where org_id = $1 limit 1`, [OTHER])).id;
ok("an item cannot point at another org's bill (23503)",
  (await refuses(`update inventory_assets set purchase_id = $1 where id = $2`, [RIVAL_BILL, A3])) === "23503");
ok("a bill may name our FleetPal purchase order",
  (await recordRefuses(bill({ id: await newId(), invoiceNumber: "PO-1", fleetpalPurchaseOrderId: PO }))) === null);
ok("...but not another org's (23503)",
  (await recordRefuses(bill({ id: await newId(), invoiceNumber: "PO-9", fleetpalPurchaseOrderId: RIVAL_PO }))) === "23503");

// ── 7: the paper, and who may touch any of it ───────────────────────────────────────────────────
const checkValues = async (column) => {
  const c = await one(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.documents'::regclass and conname = $1`,
    [`documents_${column}_check`]);
  return [...c.d.matchAll(/'([^']*)'::text/g)].map((m) => m[1]).sort();
};
ok("documents.kind's CHECK equals DOCUMENT_KINDS",
  JSON.stringify(await checkValues("kind")) === JSON.stringify([...DOCUMENT_KINDS].sort()));
ok("documents.subject_type's CHECK equals DOCUMENT_SUBJECT_TYPES",
  JSON.stringify(await checkValues("subject_type")) === JSON.stringify([...DOCUMENT_SUBJECT_TYPES].sort()));
ok("an invoice's scan files against its bill",
  (await refuses(`insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, sha256)
                  values (gen_random_uuid(), $1, 'equipment_purchase', $2, 'equipment_invoice', $3, 'application/pdf', 'ab')`,
    [ORG, B2, `${ORG}/equipment_purchase/${B2}/invoice.pdf`])) === null);
const restrictive = (await db.query(`select qual from pg_policies where tablename = 'documents' and permissive = 'RESTRICTIVE'`))
  .rows.map((r) => r.qual).join(" ");
ok("no restrictive documents policy names the invoice", !restrictive.includes("equipment_") && restrictive.includes("drug_test"));
ok("RLS is on and no client policy exists",
  (await one(`select relrowsecurity r from pg_class where oid = 'public.equipment_purchases'::regclass`)).r === true
    && (await count(`select count(*) n from pg_policies where tablename = 'equipment_purchases'`)) === 0);
const grants = await one(`select has_function_privilege('authenticated', 'record_equipment_purchase(uuid,uuid,jsonb)', 'execute') a,
                                has_function_privilege('anon', 'record_equipment_purchase(uuid,uuid,jsonb)', 'execute') b,
                                has_function_privilege('service_role', 'record_equipment_purchase(uuid,uuid,jsonb)', 'execute') c`);
ok("clients cannot call the writer; the service role can", grants.a === false && grants.b === false && grants.c === true);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
