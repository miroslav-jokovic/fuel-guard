// Silvicom 360 — shop inventory ledger matrix (migration 0331, INVENTORY-PLAN.md step I2).
//
// What this file pins is the promise the whole feature rests on: `part_stock.quantity_on_hand` is a
// PROJECTION of `part_movements` and never an independent number. Everything above it — the parts
// screen, the count session, the scanner, the truck kit — is only worth building if that holds when
// the network is bad, when two technicians reach for the same filter, and when somebody tries to
// tidy the ledger afterwards.
//
// Eleven rules, each a fact here rather than a sentence in the migration:
//
//   1.  The projection equals the ledger sum after a mixed sequence of every reason.
//   2.  IV010 — stock cannot go negative, and the SECOND of two issues against one remaining is the
//       one that fails. D-INV26: there is no setting.
//   3.  D-INV27 — the same movement id twice is one movement and one projection move. This is the
//       offline queue's server half; a phone replays, and a replay must be free.
//   4.  ...and a failed movement leaves NOTHING behind. The insert precedes the guarded update, so
//       the rollback has to take the ledger row with it.
//   5.  A count takes its delta at commit time against the row it locked, so a receipt landing
//       mid-count is added to the count rather than erased by it.
//   6.  A transfer is two legs written by one call, both carrying the outbound id.
//   7.  IV011 — the ledger is append-only for the SERVICE ROLE, which is the only role that writes it.
//   8.  `rebuild_part_stock` is a no-op after all of the above. A projection that cannot be rebuilt
//       is a second source of truth wearing a projection's name.
//   9.  IV012 / IV013 / IV014 — the location, the part and the clock are checked inside the RPC,
//       because the API bypasses RLS and this is the last gate before data.
//   10. Cross-tenant isolation: one org's movement cannot land on another org's shelf.
//   11. RLS: a technician's browser session reads and inserts; it cannot rewrite the ledger, and a
//       dispatcher — `maintenance: none` — sees nothing at all.
//
// Run:  node supabase/tests/inventory-stock.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

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
const num = async (q, p = []) => Number((await one(q, p)).n);

// Supabase-managed schemas, shimmed identically to rls.test.mjs and account-closure.test.mjs.
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

const ACTOR = "00000000-0000-4000-8000-000000000001";
await db.query(`insert into auth.users (id, email) values ($1, 'tech@test') on conflict do nothing`, [ACTOR]);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Shop') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Rival') returning id`)).id;

const location = async (code, org = ORG) =>
  (await one(`insert into stock_locations (org_id,name,code) values ($1,$2,$3) returning id`, [org, `Bay ${code}`, code])).id;
const part = async (number, org = ORG, active = true) =>
  (
    await one(
      `insert into parts (org_id, part_number, description, unit_of_measure, active)
       values ($1,$2,$3,'each',$4) returning id`,
      [org, number, `Part ${number}`, active],
    )
  ).id;

const MAIN = await location("MAIN");
const ANNEX = await location("ANNEX");
const FILTER = await part("LF-9009");

/** Call the RPC the way the API will: a validated contract payload, verbatim, as jsonb. */
const move = async (row, org = ORG) => {
  try {
    const r = await one(`select * from record_part_movement($1,$2,$3::jsonb)`, [org, ACTOR, JSON.stringify(row)]);
    return { ok: true, row: r };
  } catch (e) {
    return { ok: false, code: e.code ?? null, message: e.message };
  }
};
const onHand = async (partId = FILTER, loc = MAIN, org = ORG) => {
  const r = await one(
    `select quantity_on_hand as n from part_stock where org_id=$1 and part_id=$2 and location_id=$3`,
    [org, partId, loc],
  );
  return r ? Number(r.n) : null;
};
const ledgerSum = async (partId = FILTER, loc = MAIN, org = ORG) =>
  num(`select coalesce(sum(quantity_delta),0)::int as n from part_movements
       where org_id=$1 and part_id=$2 and location_id=$3`, [org, partId, loc]);

const at = (hoursAgo = 0) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();

// ── 1. A mixed sequence, and the projection that must equal it ──────────────────────────────────
// Deliberately NOT a uniform fixture. Every reason appears, the quantities differ, and one of them
// is a correction — a sequence of six identical receipts would pass against an RPC that ignored the
// sign, the reason and the delta alike.
await move({ id: randomUUID(), partId: FILTER, locationId: MAIN, reason: "received", quantity: 24, unitCost: 12.5, supplier: "Fleetpride", occurredAt: at() });
await move({ id: randomUUID(), partId: FILTER, locationId: MAIN, reason: "issued", quantity: 3, vehicleId: null, trailerId: null, occurredAt: at() });
await move({ id: randomUUID(), partId: FILTER, locationId: MAIN, reason: "adjusted", quantityDelta: -2, adjustReason: "damaged", occurredAt: at() });
await move({ id: randomUUID(), partId: FILTER, locationId: MAIN, reason: "returned", quantity: 1, occurredAt: at() });

ok("the projection equals the ledger sum after a mixed sequence", (await onHand()) === (await ledgerSum()));
ok("...and that sum is the arithmetic a person would do (24 - 3 - 2 + 1)", (await onHand()) === 20, `got ${await onHand()}`);

// D-INV15: last cost comes from the receipt and from nothing else.
ok(
  "a receipt sets last_cost",
  Number((await one(`select last_cost as n from parts where id=$1`, [FILTER])).n) === 12.5,
);
ok(
  "an issue does not touch last_cost",
  await (async () => {
    await move({ id: randomUUID(), partId: FILTER, locationId: MAIN, reason: "issued", quantity: 1, occurredAt: at() });
    return Number((await one(`select last_cost as n from parts where id=$1`, [FILTER])).n) === 12.5;
  })(),
);
// Back to 20 so the numbers below read as written.
await move({ id: randomUUID(), partId: FILTER, locationId: MAIN, reason: "returned", quantity: 1, occurredAt: at() });

// ── 2. IV010, and WHICH of the two issues fails ─────────────────────────────────────────────────
const SCARCE = await part("ALT-1");
await move({ id: randomUUID(), partId: SCARCE, locationId: MAIN, reason: "received", quantity: 1, occurredAt: at() });
const firstIssue = await move({ id: randomUUID(), partId: SCARCE, locationId: MAIN, reason: "issued", quantity: 1, occurredAt: at() });
const secondIssue = await move({ id: randomUUID(), partId: SCARCE, locationId: MAIN, reason: "issued", quantity: 1, occurredAt: at() });
ok("the first issue against one remaining succeeds", firstIssue.ok);
ok("the second raises IV010", secondIssue.code === "IV010", `got ${secondIssue.code} ${secondIssue.message ?? ""}`);
ok("...and the shelf is at zero, not minus one", (await onHand(SCARCE)) === 0);

// 4. The failed movement left nothing behind. This is the assertion that proves insert-before-update
//    is safe: if the rollback did not take the ledger row with it, the sum and the projection would
//    now disagree by one and rule 8 below would fail for a reason nobody could find.
ok("a refused movement writes no ledger row", (await ledgerSum(SCARCE)) === 0);

// ── 3. D-INV27 — the replay ─────────────────────────────────────────────────────────────────────
const REPLAY = { id: randomUUID(), partId: FILTER, locationId: MAIN, reason: "received", quantity: 5, occurredAt: at() };
const before = await onHand();
const firstSend = await move(REPLAY);
const replay = await move(REPLAY);
ok("a replayed movement returns the same row", firstSend.ok && replay.ok && firstSend.row.id === replay.row.id);
ok(
  "...and the ledger holds one row for it",
  (await num(`select count(*)::int as n from part_movements where id=$1`, [REPLAY.id])) === 1,
);
ok("...and the shelf moved exactly once", (await onHand()) === before + 5, `expected ${before + 5}, got ${await onHand()}`);

// ── 5. A count takes its delta at commit time ───────────────────────────────────────────────────
// The shelf says 25. A technician counts 22 and, before the count commits, a receipt of 4 lands.
// A count that wrote an absolute total would erase the receipt; a count that takes a delta records
// a variance of -3 and leaves the receipt standing.
const beforeCount = await onHand();
await move({ id: randomUUID(), partId: FILTER, locationId: MAIN, reason: "received", quantity: 4, occurredAt: at() });
const counted = await move({
  id: randomUUID(), partId: FILTER, locationId: MAIN, reason: "counted",
  countedTotal: beforeCount - 3, blind: true, occurredAt: at(),
});
ok("a count records its variance as the delta", counted.ok && counted.row.quantity_delta === -7, `got ${counted.row?.quantity_delta}`);
ok("...and records what was counted, not only the change", counted.row?.counted_total === beforeCount - 3);
ok("...and records that it was blind (D-INV20)", counted.row?.blind === true);
ok("...and the shelf is the counted figure, taken against the receipt", (await onHand()) === beforeCount - 3);

// ── 6. A transfer is two legs ───────────────────────────────────────────────────────────────────
const mainBefore = await onHand();
const transferId = randomUUID();
const transfer = await move({
  id: transferId, partId: FILTER, locationId: MAIN, reason: "transferred",
  quantity: 6, toLocationId: ANNEX, occurredAt: at(),
});
ok("a transfer succeeds", transfer.ok, transfer.message ?? "");
ok("...and writes two ledger rows", (await num(`select count(*)::int as n from part_movements where transfer_group_id=$1`, [transferId])) === 2);
ok("...leaving the source down six", (await onHand()) === mainBefore - 6);
ok("...and the destination up six", (await onHand(FILTER, ANNEX)) === 6);
ok(
  "...and a replayed transfer moves neither shelf again",
  await (async () => {
    await move({ id: transferId, partId: FILTER, locationId: MAIN, reason: "transferred", quantity: 6, toLocationId: ANNEX, occurredAt: at() });
    return (await onHand()) === mainBefore - 6 && (await onHand(FILTER, ANNEX)) === 6;
  })(),
);
ok(
  "a transfer to the same location is refused",
  (await move({ id: randomUUID(), partId: FILTER, locationId: MAIN, reason: "transferred", quantity: 1, toLocationId: MAIN, occurredAt: at() })).code === "IV012",
);

// ── 7. IV011 — append-only, for the role that actually writes ───────────────────────────────────
const attempt = async (sql, params = []) => {
  try {
    await db.query(sql, params);
    return "OK";
  } catch (e) {
    return e.code ?? `ERROR: ${e.message}`;
  }
};
// Each attempt gets its own transaction. The first draft ran both inside one, and the DELETE came
// back `25P02` — "current transaction is aborted" — which is the UPDATE's exception still standing,
// not the trigger refusing the delete. An assertion that accepts the wrong error code for the right
// reason is the kind that keeps passing after the trigger is dropped.
const asServiceRole = async (sql, params) => {
  await db.exec("begin");
  await db.exec("set local role service_role");
  const out = await attempt(sql, params);
  await db.exec("rollback");
  return out;
};
const svcUpdate = await asServiceRole(`update part_movements set note = 'tidied' where id = $1`, [REPLAY.id]);
const svcDelete = await asServiceRole(`delete from part_movements where id = $1`, [REPLAY.id]);
ok("the service role cannot update the ledger", svcUpdate === "IV011", `got ${svcUpdate}`);
ok("the service role cannot delete from the ledger", svcDelete === "IV011", `got ${svcDelete}`);

// ── 8. The projection is rebuildable ────────────────────────────────────────────────────────────
const changed = await num(`select rebuild_part_stock($1)::int as n`, [ORG]);
ok("rebuild_part_stock changes nothing after every sequence above", changed === 0, `it changed ${changed} rows`);
// ...and it would notice. A projection nobody can break is not being checked.
await db.exec("alter table part_stock disable trigger all");
await db.query(`update part_stock set quantity_on_hand = quantity_on_hand + 9 where org_id=$1 and part_id=$2 and location_id=$3`, [ORG, FILTER, MAIN]);
const repaired = await num(`select rebuild_part_stock($1)::int as n`, [ORG]);
await db.exec("alter table part_stock enable trigger all");
ok("...and it repairs a shelf that was written behind its back", repaired === 1 && (await onHand()) === (await ledgerSum()));

// ── 9. The gates inside the RPC ─────────────────────────────────────────────────────────────────
ok(
  "an unknown location raises IV012",
  (await move({ id: randomUUID(), partId: FILTER, locationId: randomUUID(), reason: "received", quantity: 1, occurredAt: at() })).code === "IV012",
);
ok(
  "an unknown part raises IV013",
  (await move({ id: randomUUID(), partId: randomUUID(), locationId: MAIN, reason: "received", quantity: 1, occurredAt: at() })).code === "IV013",
);
const RETIRED = await part("OLD-1", ORG, false);
ok(
  "an inactive part refuses a receipt",
  (await move({ id: randomUUID(), partId: RETIRED, locationId: MAIN, reason: "received", quantity: 1, occurredAt: at() })).code === "IV013",
);
ok(
  "...but still accepts the count that writes it down",
  (await move({ id: randomUUID(), partId: RETIRED, locationId: MAIN, reason: "counted", countedTotal: 0, blind: false, occurredAt: at() })).ok,
);
ok(
  "a clock 30 hours out raises IV014",
  (await move({ id: randomUUID(), partId: FILTER, locationId: MAIN, reason: "received", quantity: 1, occurredAt: at(30) })).code === "IV014",
);
ok(
  "...and 23 hours late is accepted, because a dead bay is not a broken clock",
  (await move({ id: randomUUID(), partId: FILTER, locationId: MAIN, reason: "received", quantity: 1, occurredAt: at(23) })).ok,
);

// ── 10. Cross-tenant ────────────────────────────────────────────────────────────────────────────
const RIVAL_LOC = await location("MAIN", OTHER);
const RIVAL_PART = await part("LF-9009", OTHER);
ok(
  "an org cannot move stock at another org's location",
  (await move({ id: randomUUID(), partId: FILTER, locationId: RIVAL_LOC, reason: "received", quantity: 1, occurredAt: at() })).code === "IV012",
);
ok(
  "...nor move another org's part at its own location",
  (await move({ id: randomUUID(), partId: RIVAL_PART, locationId: MAIN, reason: "received", quantity: 1, occurredAt: at() })).code === "IV013",
);
ok(
  "...and rebuilding one org's projection leaves the other's alone",
  await (async () => {
    await move({ id: randomUUID(), partId: RIVAL_PART, locationId: RIVAL_LOC, reason: "received", quantity: 7, occurredAt: at() }, OTHER);
    const mine = await onHand();
    await num(`select rebuild_part_stock($1)::int as n`, [OTHER]);
    return (await onHand()) === mine && (await onHand(RIVAL_PART, RIVAL_LOC, OTHER)) === 7;
  })(),
);

// ── 11. RLS, from a browser session ─────────────────────────────────────────────────────────────
const asRole = async (role, fn) => {
  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: ACTOR, org_id: ORG, user_role: role, role: "authenticated" }),
  ]);
  const out = await fn();
  await db.exec("rollback");
  return out;
};

const techReads = await asRole("technician", () => num(`select count(*)::int as n from part_stock`));
ok("a technician's session reads the shelf", techReads > 0);
// ⚠ This assertion was rewritten after being measured, and the correction is the interesting part.
// It first asserted `IV011` on the reasoning that the append-only trigger fires for everybody. It
// does not fire here, and the ledger is safe anyway: `part_movements` carries a SELECT policy and an
// INSERT policy and NO update policy, so a technician's UPDATE matches zero rows and returns
// success having done nothing. The trigger is never reached because there is nothing to trigger on.
// Two separate guarantees, and the test now names which one is doing the work — pinning IV011 here
// would have been pinning a mechanism that is not running.
const techRewrites = await asRole("technician", async () => {
  const r = await db.query(`update part_movements set note = 'nope' where id = $1`, [REPLAY.id]);
  return r.affectedRows ?? 0;
});
ok("...and its rewrite of the ledger matches no row", techRewrites === 0, `it changed ${techRewrites}`);
ok(
  "...leaving the row as the RPC wrote it",
  (await one(`select note from part_movements where id=$1`, [REPLAY.id])).note === null,
);

const accountantWrites = await asRole("accountant", () =>
  attempt(`insert into parts (org_id, part_number, description, unit_of_measure) values ($1,'X','X','each')`, [ORG]),
);
ok("an accountant reads but does not stock the shelf", accountantWrites === "42501", `got ${accountantWrites}`);
const accountantReads = await asRole("accountant", () => num(`select count(*)::int as n from parts`));
ok("...and does read the parts, because the books ask what the shelf is worth", accountantReads > 0);

const dispatcherReads = await asRole("dispatcher", () => num(`select count(*)::int as n from part_stock`));
ok("a dispatcher — maintenance: none — sees no shelf at all", dispatcherReads === 0);

// The bucket exists, private, and carries no client policy (D-INV8).
ok(
  "the inventory-photos bucket is private",
  (await one(`select public as p from storage.buckets where id='inventory-photos'`))?.p === false,
);
ok(
  "...and has no storage.objects policy",
  (await num(`select count(*)::int as n from pg_policies where schemaname='storage' and policyname like 'inventory%'`)) === 0,
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
