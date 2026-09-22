// FuelGuard — migration 0355, the 53 reserved unit numbers (FLEET-CENSUS-AND-IDLE-TRUTH-PLAN F5).
//
// A data migration gets exactly one chance to be right: it runs once, against the carrier's
// production roster, and `migrate.yml` applies it on merge with nobody watching. The way to get this
// one wrong is silent and expensive —
//
//   select the 53 with the obvious predicate over our OWN columns and seven working trucks go with
//   them, out of the operating fleet and out of the §396.17 inspection roster, because our copy of
//   McLeod's purchase date is stale on anything delivered since the last identity sweep.
//
// So this matrix applies every migration UP TO 0355, seeds the shapes production actually holds —
// including unit 811, a purchased truck still waiting for its gateway, which is indistinguishable
// from a reservation in our own columns and is NOT one — and then applies 0355 to the seeded
// database. That is the only way to test a data migration with the data it was written for.
//
//   1. A reserved unit number becomes `ordered`.
//   2. Unit 811 is left alone. This is the assertion that fails on the destructive version.
//   3. A listed reservation that has since gained a gateway, or a purchase date, is skipped.
//   4. A row somebody has already moved on is not re-opened.
//   5. The act is on the record, with before and after values.
//   6. Applying the file twice changes nothing the second time — which is how the guards are proved
//      to be guards rather than decoration.
//
// Run:  node supabase/tests/reserved-units-ordered.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const ALL = readdirSync(join(SUPA, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const SUBJECT = "0355_reserved_units_ordered.sql";
const BEFORE = ALL.filter((f) => f < SUBJECT);

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

// Supabase-managed schemas, shimmed identically to rls.test.mjs.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key,
    name text,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner uuid,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (
    version text primary key,
    name text,
    statements text[]
  );
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);

for (const f of BEFORE) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;

const truck = async (cols) => {
  const keys = ["org_id", "tank_capacity_gal", ...Object.keys(cols)];
  const vals = [ORG, 0, ...Object.values(cols)];
  const ph = keys.map((_, i) => `$${i + 1}`).join(",");
  return (await one(`insert into vehicles (${keys.join(",")}) values (${ph}) returning id`, vals)).id;
};

const RESERVED = await truck({ unit_number: "812", status: "active", identity_source: "mcleod", mcleod_tractor_id: "812" });
// Unit 811: purchased 2026-09-14, gateway not yet fitted, and our copy of the purchase date is still
// null because no identity sweep has run since. In OUR columns it is identical to a reservation — no
// gateway, no purchase date, no model year — and it is a truck (D-FC4). It is not on McLeod's list,
// so nothing here may touch it.
const AWAITING_GATEWAY = await truck({ unit_number: "811", status: "active", identity_source: "mcleod", mcleod_tractor_id: "811" });
// A listed reservation that has since been delivered: the gateway is the tell.
const DELIVERED = await truck({
  unit_number: "820",
  status: "active",
  identity_source: "mcleod",
  mcleod_tractor_id: "820",
  samsara_vehicle_id: "281475099999999",
});
// …and one where the purchase date arrived first.
const PURCHASED = await truck({
  unit_number: "821",
  status: "active",
  identity_source: "mcleod",
  mcleod_tractor_id: "821",
  purchased_at: "2026-09-14",
});
// A listed row somebody has already moved on: not re-opened.
const ALREADY = await truck({ unit_number: "822", status: "retired", identity_source: "mcleod", mcleod_tractor_id: "822" });
// An ordinary working truck, to prove the fleet is not touched at all.
const WORKING = await truck({
  unit_number: "579",
  status: "maintenance",
  identity_source: "mcleod",
  mcleod_tractor_id: "579",
  purchased_at: "2020-12-21",
  samsara_vehicle_id: "281475000000001",
});

const statusOf = async (id) => (await one(`select status from vehicles where id = $1`, [id])).status;

// ═══ apply the subject ══════════════════════════════════════════════════════════════════════════
let applied = null;
try {
  await db.exec(read(join("migrations", SUBJECT)));
} catch (e) {
  applied = e.message;
}
ok("0355 applies without raising", applied === null, applied ?? "");

ok("a reserved unit number becomes ordered", (await statusOf(RESERVED)) === "ordered");
ok(
  "unit 811 — a purchased truck still waiting for its gateway — is NOT marked",
  (await statusOf(AWAITING_GATEWAY)) === "active",
);
ok("a listed reservation that has gained a gateway is skipped", (await statusOf(DELIVERED)) === "active");
ok("a listed reservation that has gained a purchase date is skipped", (await statusOf(PURCHASED)) === "active");
ok("a listed row somebody already moved on is not re-opened", (await statusOf(ALREADY)) === "retired");
ok("a working truck in the shop is untouched", (await statusOf(WORKING)) === "maintenance");
ok(
  "exactly one row changed status",
  Number((await one(`select count(*)::int n from vehicles where org_id = $1 and status = 'ordered'`, [ORG])).n) === 1,
);

// ── the act is on the record ────────────────────────────────────────────────────────────────────
const audit = await one(`select meta from audit_logs where entity_id = $1 and action = 'roster.vehicle_marked_ordered'`, [
  RESERVED,
]);
ok(
  "the status change records the unit number and both states",
  audit?.meta?.from === "active" && audit?.meta?.to === "ordered" && audit?.meta?.unit_number === "812",
  JSON.stringify(audit?.meta),
);
ok(
  "one row marked means exactly one audit row",
  Number((await one(`select count(*)::int n from audit_logs where action = 'roster.vehicle_marked_ordered'`)).n) === 1,
);

// ── idempotence ─────────────────────────────────────────────────────────────────────────────────
// Migrations are applied once, so this is not a requirement production depends on. It is how the
// guards are proved to be guards: a second application that changed something would mean at least one
// of them is decoration.
let second = null;
try {
  await db.exec(read(join("migrations", SUBJECT)));
} catch (e) {
  second = e.message;
}
ok("applying it a second time does not raise", second === null, second ?? "");
ok(
  "…and writes no second audit row",
  Number((await one(`select count(*)::int n from audit_logs where action = 'roster.vehicle_marked_ordered'`)).n) === 1,
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
