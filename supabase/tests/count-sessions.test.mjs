// Silvicom 360 — count session matrix (migration 0332, INVENTORY-PLAN.md step I5 PR 1).
//
// A count session is the row a shelf walk hangs off, and everything downstream of it — the review
// screen's Short/Over buckets, the recount badge, I9's unit check — reads its shape rather than
// re-deriving one. So what is pinned here is the shape, not the walk:
//
//   1.  A session is about EXACTLY one place. Two holders, none, or a `kind` that disagrees with
//       the holder that is set are all refused by CHECK. 0092:137's shape; 0153's lesson about what
//       a row that can name two things turns into.
//   2.  `blind` defaults to true (D-INV20) and is RECORDED, because "was the expected figure on
//       screen" is the first question asked about a variance nobody believes.
//   3.  A closed session has a closing time and an open one has none — one fact, not two columns
//       that can disagree.
//   4.  IV017 — closing is one-way, for the SERVICE ROLE too. This is the guarantee a screen cannot
//       give: the API bypasses RLS, so a policy alone would leave a closed walk editable by the one
//       caller that can reach it.
//   5.  ...and everything else about a session is fixed once it exists. The place, the counter and
//       the blind flag cannot be edited, because a variance is only readable against the conditions
//       it was recorded under.
//   6.  The FK 0331 left open: a `counted` movement carries its session, and the session cannot be
//       deleted out from under it.
//   7.  Two overlapping sessions on one bay do NOT corrupt the shelf. This is the measurement behind
//       0332's decision not to add a "one open session per place" unique index — the cost of overlap
//       is a confusing review, and the cost of the index is a bay nobody can ever count again.
//   8.  Cross-tenant isolation: a session cannot be opened against another org's bay.
//   9.  RLS: a technician opens and closes; an auditor reads and cannot; a dispatcher sees nothing.
//
// Run:  node supabase/tests/count-sessions.test.mjs
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
/** Run a statement and report the SQLSTATE it raised, or null when it succeeded. */
const refuses = async (q, p = []) => {
  try {
    await db.query(q, p);
    return null;
  } catch (e) {
    return e.code ?? "unknown";
  }
};

// Supabase-managed schemas, shimmed identically to inventory-stock.test.mjs and rls.test.mjs.
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

const MAIN = await location("MAIN");
const RIVAL_BAY = await location("RMAIN", OTHER);
const FILTER = (
  await one(
    `insert into parts (org_id, part_number, description, unit_of_measure)
     values ($1,'LF-9009','Oil filter','each') returning id`,
    [ORG],
  )
).id;
const TRAILER = (
  await one(`insert into trailers (org_id, unit_number) values ($1,'T-4102') returning id`, [ORG])
).id;

const openSession = async (cols, org = ORG) =>
  one(
    `insert into stock_count_sessions (org_id, kind, location_id, vehicle_id, trailer_id, started_by, blind, note)
     values ($1,$2,$3,$4,$5,$6,coalesce($7,true),$8) returning *`,
    [org, cols.kind, cols.locationId ?? null, cols.vehicleId ?? null, cols.trailerId ?? null,
     cols.startedBy ?? ACTOR, cols.blind ?? null, cols.note ?? null],
  );

const at = (hoursAgo = 0) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();
const move = async (row, org = ORG) => {
  try {
    return { ok: true, row: await one(`select * from record_part_movement($1,$2,$3::jsonb)`, [org, ACTOR, JSON.stringify(row)]) };
  } catch (e) {
    return { ok: false, code: e.code ?? null, message: e.message };
  }
};

// ── 1. Exactly one place ────────────────────────────────────────────────────────────────────────
// The three refusals below are the whole reason `num_nonnulls` is in the schema rather than a
// service-side check: the API holds the service key, so a constraint is the only thing that is true
// for every caller.
const bay = await openSession({ kind: "location", locationId: MAIN });
ok("a session about one bay is accepted", Boolean(bay?.id));

ok(
  "a session naming a bay AND a trailer is refused",
  (await refuses(
    `insert into stock_count_sessions (org_id, kind, location_id, trailer_id) values ($1,'location',$2,$3)`,
    [ORG, MAIN, TRAILER],
  )) === "23514",
);
ok(
  "a session naming nothing at all is refused",
  (await refuses(`insert into stock_count_sessions (org_id, kind) values ($1,'location')`, [ORG])) === "23514",
);
// The discriminator cannot lie about the row it is on: `kind='unit'` with a bay, or `kind='location'`
// with a trailer, would each make one query return the other kind's sessions.
ok(
  "a `unit` session holding a bay is refused",
  (await refuses(
    `insert into stock_count_sessions (org_id, kind, location_id) values ($1,'unit',$2)`,
    [ORG, MAIN],
  )) === "23514",
);
const kit = await openSession({ kind: "unit", trailerId: TRAILER });
ok("...and a unit session about a trailer is accepted (D-INV19, one shape for I9 too)", kit?.kind === "unit");

// ── 2. Blind is the default, and it is recorded ─────────────────────────────────────────────────
ok("a session is blind unless somebody says otherwise (D-INV20)", bay.blind === true);
const revealed = await openSession({ kind: "location", locationId: MAIN, blind: false });
ok("...and a revealed count records that it was revealed", revealed.blind === false);

// ── 3. Open and closed each carry their own time ────────────────────────────────────────────────
ok("a new session is open with no closing time", bay.status === "open" && bay.closed_at === null);
ok(
  "a session cannot be closed without a closing time",
  (await refuses(`update stock_count_sessions set status='closed' where id=$1`, [bay.id])) === "23514",
);
ok(
  "...nor carry a closing time while open",
  (await refuses(`update stock_count_sessions set closed_at=now() where id=$1`, [bay.id])) === "23514",
);

// ── 4. Closing is one-way, for the service role too (IV017) ─────────────────────────────────────
await db.query(`update stock_count_sessions set status='closed', closed_at=now() where id=$1`, [bay.id]);
const closed = await one(`select status, closed_at from stock_count_sessions where id=$1`, [bay.id]);
ok("a walk can be closed", closed.status === "closed" && closed.closed_at !== null);
ok(
  "...and a closed walk cannot be reopened, by anybody",
  (await refuses(`update stock_count_sessions set status='open', closed_at=null where id=$1`, [bay.id])) === "IV017",
);
// ⚠ The role here is the SERVICE ROLE — the default in this file, and the one the API uses. A policy
// would not have stopped this; the trigger is what does.
ok(
  "...not even by editing its note, because the row is closed and that is the whole rule",
  (await refuses(`update stock_count_sessions set note='after the fact' where id=$1`, [bay.id])) === "IV017",
);

// ── 5. The conditions of a walk are fixed while it is open, too ─────────────────────────────────
// A variance of −3 means one thing if the counter could see "12 expected" and another if they could
// not. Letting `blind` be edited afterwards would make every closed count unreadable.
ok(
  "an open session's blind flag cannot be flipped afterwards",
  (await refuses(`update stock_count_sessions set blind=false where id=$1`, [kit.id])) === "IV017",
);
ok(
  "...nor can the place it is about be moved",
  (await refuses(`update stock_count_sessions set trailer_id=null, location_id=$1 where id=$2`, [MAIN, kit.id])) === "IV017",
);
ok(
  "...but its note may still be written while it is open",
  (await refuses(`update stock_count_sessions set note='walked the top shelf first' where id=$1`, [kit.id])) === null,
);

// ── 6. The reference 0331 left open ─────────────────────────────────────────────────────────────
const walk = await openSession({ kind: "location", locationId: MAIN });
await move({ id: randomUUID(), partId: FILTER, locationId: MAIN, reason: "received", quantity: 12, occurredAt: at() });
const countRow = await move({
  id: randomUUID(), partId: FILTER, locationId: MAIN, reason: "counted",
  countedTotal: 9, countSessionId: walk.id, blind: true, occurredAt: at(),
});
ok("a counted movement carries its session", countRow.ok && countRow.row.count_session_id === walk.id);
ok("...and its variance is the delta, not the total", countRow.row?.quantity_delta === -3);
// 23001 restrict_violation, not 23503 foreign_key_violation: `on delete restrict` refuses at the
// statement, where `no action` would defer and raise 23503. The distinction is worth pinning by code
// rather than by "it threw" — a constraint quietly changed to `no action` would still throw, and
// would still let a deferred transaction delete the walk.
const deleteCode = await refuses(`delete from stock_count_sessions where id=$1`, [walk.id]);
ok("...and the session cannot be deleted out from under it", deleteCode === "23001", `got ${deleteCode}`);
ok(
  "a movement cannot point at a session that does not exist",
  (await refuses(
    `insert into part_movements (id, org_id, part_id, location_id, reason, quantity_delta, counted_total, count_session_id, occurred_at)
     values (gen_random_uuid(), $1, $2, $3, 'counted', 0, 9, gen_random_uuid(), now())`,
    [ORG, FILTER, MAIN],
  )) === "23503",
);

// ── 7. Why there is no "one open session per place" unique index ────────────────────────────────
// 0332's header claims two overlapping walks cannot corrupt the shelf, because a count's delta is
// taken at commit time against the row it locked. That is a claim about behaviour, so it is measured
// here rather than asserted in a comment.
const walkA = await openSession({ kind: "location", locationId: MAIN });
const walkB = await openSession({ kind: "location", locationId: MAIN });
ok("two walks of one bay can be open at once", walkA.status === "open" && walkB.status === "open");
const onHand = async () =>
  num(`select quantity_on_hand as n from part_stock where org_id=$1 and part_id=$2 and location_id=$3`, [ORG, FILTER, MAIN]);
await move({ id: randomUUID(), partId: FILTER, locationId: MAIN, reason: "counted", countedTotal: 7, countSessionId: walkA.id, occurredAt: at() });
await move({ id: randomUUID(), partId: FILTER, locationId: MAIN, reason: "counted", countedTotal: 5, countSessionId: walkB.id, occurredAt: at() });
ok("...and the shelf ends at the LAST count, not at a sum of two", (await onHand()) === 5, `got ${await onHand()}`);
const sum = await num(
  `select coalesce(sum(quantity_delta),0)::int as n from part_movements where org_id=$1 and part_id=$2 and location_id=$3`,
  [ORG, FILTER, MAIN],
);
ok("...and the ledger still sums to the shelf, so neither walk corrupted it", sum === (await onHand()), `ledger ${sum}`);

// ── 8. Cross-tenant ─────────────────────────────────────────────────────────────────────────────
// ⚠ This assertion FAILED when it was first written, and the migration changed rather than the test.
// The three holder FKs reference `id` alone — those tables carry no `(id, org_id)` unique constraint
// to point a composite key at — so a session in one org naming another org's bay satisfied every FK
// and every CHECK. `part_movements` has the same shape and is saved by `record_part_movement`'s own
// org check; a session has no RPC in front of it, so 0332 grew a trigger.
const foreignBay = await refuses(
  `insert into stock_count_sessions (org_id, kind, location_id) values ($1,'location',$2)`,
  [ORG, RIVAL_BAY],
);
ok("a session cannot be opened against another org's bay", foreignBay === "IV012", `got ${foreignBay}`);

const RIVAL_TRAILER = (
  await one(`insert into trailers (org_id, unit_number) values ($1,'R-9') returning id`, [OTHER])
).id;
ok(
  "...nor against another org's trailer, which is the same hole in the other holder",
  (await refuses(
    `insert into stock_count_sessions (org_id, kind, trailer_id) values ($1,'unit',$2)`,
    [ORG, RIVAL_TRAILER],
  )) === "IV012",
);

// A closed bay accepts no movements (`record_part_movement` raises IV012), so a walk of one would be
// an afternoon of refusals. The session is refused at the start instead.
const CLOSED_BAY = await location("SHUT");
await db.query(`update stock_locations set active = false where id = $1`, [CLOSED_BAY]);
ok(
  "...nor against a bay that has been closed",
  (await refuses(
    `insert into stock_count_sessions (org_id, kind, location_id) values ($1,'location',$2)`,
    [ORG, CLOSED_BAY],
  )) === "IV012",
);

// ── 9. RLS ──────────────────────────────────────────────────────────────────────────────────────
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

ok(
  "a technician's session reads the walks",
  (await asRole("technician", () => num(`select count(*)::int as n from stock_count_sessions`))) > 0,
);
ok(
  "...and may open one",
  (await asRole("technician", () =>
    refuses(`insert into stock_count_sessions (org_id, kind, location_id) values ($1,'location',$2)`, [ORG, MAIN]),
  )) === null,
);
ok(
  "...and may close one",
  (await asRole("technician", () =>
    refuses(`update stock_count_sessions set status='closed', closed_at=now() where id=$1`, [walkA.id]),
  )) === null,
);
// An auditor reads the record and does not make one — the same split `part_movements` draws.
ok(
  "an auditor reads the walks",
  (await asRole("auditor", () => num(`select count(*)::int as n from stock_count_sessions`))) > 0,
);
ok(
  "...and cannot open one",
  (await asRole("auditor", () =>
    refuses(`insert into stock_count_sessions (org_id, kind, location_id) values ($1,'location',$2)`, [ORG, MAIN]),
  )) === "42501",
);
ok(
  "a dispatcher — maintenance: none — sees no walks at all",
  (await asRole("dispatcher", () => num(`select count(*)::int as n from stock_count_sessions`))) === 0,
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
