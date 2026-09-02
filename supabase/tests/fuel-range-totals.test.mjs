// Silvicom 360 — fuel_range_totals matrix (migration 0289, FUEL-T3a / D-AG1).
//
// These six figures sit directly above the Fuel Log's table, and until this function they were summed
// in the BROWSER by paging 1,000 rows at a time until a short page arrived. That loop is correct only
// while it is allowed to finish: PostgREST's `max_rows` is a server setting the client does not
// control, and a carrier already holding 14,500 fills is fifteen round trips into it. If that ceiling
// moves, every tile reads LOW with no error beside it.
//
// So the property this matrix exists for is the one the plan named: **the answer must not depend on
// how many rows there are.** It is asserted over 2,400 rows — past two page boundaries — against
// totals accumulated row by row in JavaScript, the same way the browser did it.
//
// Four more that fail quietly:
//   1. THE TILES AND THE LIST MUST COUNT THE SAME SET. Non-canonical rows are excluded here because
//      they are excluded there; a tile counting rows the table beneath it does not show is the exact
//      disagreement FUEL-T3a exists to end.
//   2. `flagged + clear = fills`, BY CONSTRUCTION. A null `has_anomaly` is not flagged. If these ever
//      stop summing to the total, two tiles disagree about one window and neither says which is right.
//   3. `has_cost` IS NOT `spend > 0`. "No fill carried a cost" and "the costs sum to zero" are
//      different facts and the tile renders them differently — "—" against "$0".
//   4. ORG SCOPE, and it must hold with `p_org` OMITTED, because that is the call a browser makes
//      (D-FC1; three functions shipped unreachable on exactly this in 0258).
//
// Run:  node supabase/tests/fuel-range-totals.test.mjs
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
const VEH = (await one(
  `insert into vehicles (org_id, unit_number, status, tank_capacity_gal) values ($1,'701','active',150) returning id`, [ORG])).id;
const VEH2 = (await one(
  `insert into vehicles (org_id, unit_number, status, tank_capacity_gal) values ($1,'702','active',150) returning id`, [ORG])).id;

// ── The fixture: 2,400 canonical fills, past two 1,000-row page boundaries ──────────────────────
// Every value is deterministic from the index, so JavaScript can accumulate the expected totals the
// same way the browser's loop did — which is what makes this a PARITY assertion and not a restatement
// of the SQL in a different syntax.
const N = 2400;
const expected = { fills: 0, gallons: 0, spend: 0, flagged: 0, clear: 0 };
const values = [];
for (let i = 0; i < N; i++) {
  const gallons = 10 + (i % 90);            // 10..99
  const cost = (i % 7 === 0) ? null : 3 + (i % 5); // ~1 in 7 carries no cost at all
  const flagged = i % 11 === 0;
  const day = `2026-0${1 + (i % 6)}-15`;    // spread across six months, all inside the window below
  values.push(`(gen_random_uuid(), '${ORG}', '${day}T12:00:00Z', '${day}', 'TX', ${gallons}, ${cost === null ? "null" : cost * gallons}, ${flagged}, true, '${i % 2 ? VEH : VEH2}', 'Pilot ${i}', 'C${1000 + i}')`);
  expected.fills++;
  expected.gallons += gallons;
  if (cost !== null) expected.spend += cost * gallons;
  if (flagged) expected.flagged++;
}
expected.clear = expected.fills - expected.flagged;

for (let i = 0; i < values.length; i += 400) {
  await db.exec(
    `insert into fuel_transactions (id, org_id, fueled_at, business_date, state, gallons, total_cost, has_anomaly, is_canonical, vehicle_id, location_text, card_ref)
     values ${values.slice(i, i + 400).join(",")}`,
  );
}

const call = async (args = "") =>
  one(`select * from fuel_range_totals(p_from => '2026-01-01', p_to => '2026-12-31'${args}, p_org => $1)`, [ORG]);

// ── 1. the answer does not depend on how many rows there are ────────────────────────────────────
const total = await call();
ok(
  `all ${N} fills are counted — past two 1,000-row page boundaries, which is the cap the browser loop was one config change from hitting`,
  Number(total.fills) === expected.fills,
  `${total.fills} vs ${expected.fills}`,
);
ok("gallons match the row-by-row accumulation exactly", Number(total.gallons) === expected.gallons, `${total.gallons} vs ${expected.gallons}`);
ok("spend matches, with the cost-less fills contributing nothing rather than zero-filling", Number(total.spend) === expected.spend, `${total.spend} vs ${expected.spend}`);
ok("flagged matches", Number(total.flagged) === expected.flagged, `${total.flagged} vs ${expected.flagged}`);

// ── 2. flagged + clear = fills, by construction ─────────────────────────────────────────────────
ok(
  "clear is the complement of flagged, so the two tiles can never disagree about one window",
  Number(total.clear) === expected.clear && Number(total.flagged) + Number(total.clear) === Number(total.fills),
);
// ⚠ `has_anomaly` is NOT NULL in the schema, so the `coalesce(has_anomaly, false)` in 0289 can never
// actually fire. It is kept as a statement of intent — an unflagged fill is clear — and the case is
// asserted the only way the database permits: an explicit `false`, added after the fixture, must move
// `clear` and leave `flagged` alone. Writing a test that inserts a null here would not be a stricter
// test, it would be a test that cannot run.
await db.query(
  `insert into fuel_transactions (org_id, fueled_at, business_date, state, gallons, has_anomaly, is_canonical)
   values ($1,'2026-02-02T12:00:00Z','2026-02-02','TX',10,false,true)`, [ORG]);
const withNull = await call();
ok(
  "an unflagged fill lands in clear and never in flagged",
  Number(withNull.flagged) === expected.flagged && Number(withNull.clear) === expected.clear + 1,
);
// A ZERO-GALLON unflagged fill. Without it, `clear` counted by any incidental extra condition — say
// `gallons > 0` — is indistinguishable from the true complement, because every other fixture row has
// gallons. This is the row that makes `flagged + clear = fills` an assertion rather than a coincidence.
await db.query(
  `insert into fuel_transactions (org_id, fueled_at, business_date, state, gallons, has_anomaly, is_canonical)
   values ($1,'2026-02-04T12:00:00Z','2026-02-04','TX',0,false,true)`, [ORG]);
const withZero = await call();
ok(
  "the identity holds for a zero-gallon fill too — clear is the COMPLEMENT, not a count with its own conditions",
  Number(withZero.flagged) + Number(withZero.clear) === Number(withZero.fills) &&
    Number(withZero.clear) === Number(withNull.clear) + 1,
  `${withZero.flagged}+${withZero.clear} vs ${withZero.fills}`,
);

// ── 3. the tiles count what the list shows ──────────────────────────────────────────────────────
await db.query(
  `insert into fuel_transactions (org_id, fueled_at, business_date, state, gallons, total_cost, is_canonical)
   values ($1,'2026-02-03T12:00:00Z','2026-02-03','TX',999,9999,false)`, [ORG]);
const afterDup = await call();
ok(
  "a non-canonical fill is invisible here, because it is invisible in the table these tiles sit above",
  Number(afterDup.fills) === Number(withZero.fills) && Number(afterDup.gallons) === Number(withZero.gallons),
  `${afterDup.fills} vs ${withZero.fills}`,
);

// ── 4. has_cost is a different question from spend > 0 ──────────────────────────────────────────
const EMPTY_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Empty') returning id`)).id;
await db.query(
  `insert into fuel_transactions (org_id, fueled_at, business_date, state, gallons, total_cost, is_canonical)
   values ($1,'2026-03-03T12:00:00Z','2026-03-03','TX',40,null,true)`, [EMPTY_ORG]);
const noCost = await one(
  `select * from fuel_range_totals(p_from => '2026-01-01', p_to => '2026-12-31', p_org => $1)`, [EMPTY_ORG]);
ok("a window where nothing carried a cost reports has_cost false, so the tile can print '—' rather than $0",
  noCost.has_cost === false && Number(noCost.spend) === 0 && Number(noCost.fills) === 1);
await db.query(
  `insert into fuel_transactions (org_id, fueled_at, business_date, state, gallons, total_cost, is_canonical)
   values ($1,'2026-03-04T12:00:00Z','2026-03-04','TX',40,0,true)`, [EMPTY_ORG]);
const zeroCost = await one(
  `select * from fuel_range_totals(p_from => '2026-01-01', p_to => '2026-12-31', p_org => $1)`, [EMPTY_ORG]);
ok("...and a genuine $0 cost reports has_cost TRUE — sum() alone cannot tell those two apart",
  zeroCost.has_cost === true && Number(zeroCost.spend) === 0);
const empty = await one(
  `select * from fuel_range_totals(p_from => '2030-01-01', p_to => '2030-12-31', p_org => $1)`, [ORG]);
ok("an empty window is zeros and false, never nulls — bool_or over no rows is null and would render as 'unknown'",
  Number(empty.fills) === 0 && Number(empty.gallons) === 0 && Number(empty.spend) === 0 && empty.has_cost === false);

// ── 5. the filters, each one ────────────────────────────────────────────────────────────────────
const perVehicle = await call(`, p_vehicle => '${VEH}'`);
ok("filtering to one truck counts only that truck's fills",
  Number(perVehicle.fills) === N / 2, `${perVehicle.fills} vs ${N / 2}`);
// A fill ON the closing date, so "inclusive" is actually exercised. Every fixture row sits on the
// 15th, so a `<` bound would have changed nothing and the assertion would have passed either way —
// the vacuous shape this repo keeps finding.
await db.query(
  `insert into fuel_transactions (org_id, fueled_at, business_date, state, gallons, total_cost, has_anomaly, is_canonical)
   values ($1,'2026-03-31T23:30:00Z','2026-03-31','TX',77,300,false,true)`, [ORG]);
const windowed = await one(
  `select * from fuel_range_totals(p_from => '2026-03-01', p_to => '2026-03-31', p_org => $1)`, [ORG]);
ok("the window is the station-local business date, and p_to is INCLUSIVE because a date compared to a date is",
  Number(windowed.fills) === N / 6 + 1, `${windowed.fills} vs ${N / 6 + 1}`);
const openEnded = await one(
  `select * from fuel_range_totals(p_from => '2026-03-01', p_org => $1)`, [ORG]);
ok("an omitted bound means unbounded, not zero — the filters are optional the way the UI's are",
  Number(openEnded.fills) > Number(windowed.fills));

// An underscore is a single-character wildcard to `ilike`. 'C_001' must find nothing, because no card
// ref contains that literal string — if it is not escaped it matches C1001, C2001, and so on.
const underscore = await one(
  `select * from fuel_range_totals(p_from => '2026-01-01', p_to => '2026-12-31', p_search => 'C_001', p_org => $1)`, [ORG]);
ok("a literal underscore is a character, not a single-character wildcard",
  Number(underscore.fills) === 0, `${underscore.fills}`);
const searched = await one(
  `select * from fuel_range_totals(p_from => '2026-01-01', p_to => '2026-12-31', p_search => 'Pilot 7', p_org => $1)`, [ORG]);
ok("a search term matches the station text", Number(searched.fills) > 0);
// A `%` in the term is a character somebody typed, not a wildcard that matches the whole fleet.
const wildcard = await one(
  `select * from fuel_range_totals(p_from => '2026-01-01', p_to => '2026-12-31', p_search => '%', p_org => $1)`, [ORG]);
ok("a literal % matches nothing rather than everything — it is escaped, not stripped",
  Number(wildcard.fills) === 0, `${wildcard.fills}`);

// ── 6. org scope, and it must hold on the call a browser actually makes ─────────────────────────
// Captured HERE rather than reused from an earlier assertion: rows have been added since, and a
// baseline that has drifted turns a scope test into an arithmetic test.
const mineBefore = await call();
await db.query(
  `insert into fuel_transactions (org_id, fueled_at, business_date, state, gallons, total_cost, is_canonical)
   values ($1,'2026-02-02T12:00:00Z','2026-02-02','TX',5000,50000,true)`, [OTHER]);
const stillMine = await call();
ok("another carrier's fills never enter these totals",
  Number(stillMine.fills) === Number(mineBefore.fills) && Number(stillMine.gallons) === Number(mineBefore.gallons),
  `${stillMine.fills} vs ${mineBefore.fills}`);

const USER = (await one(`insert into auth.users (email) values ('ops@silvicom.test') returning id`)).id;
await db.exec("begin");
await db.exec("set local role authenticated");
await db.query("select set_config('request.jwt.claims', $1, true)", [
  JSON.stringify({ sub: USER, org_id: ORG, user_role: "admin", role: "authenticated" }),
]);
// ⚠ p_org OMITTED — the form PostgREST resolves for a browser. A function that only works when the
// argument is supplied positionally is dead on arrival for the client and green in every test (0258).
const asBrowser = (await db.query(
  `select * from fuel_range_totals(p_from => '2026-01-01', p_to => '2026-12-31')`)).rows[0];
await db.exec("rollback");
ok("a signed-in user gets their OWN org's totals with p_org omitted, which is the only call the browser can make",
  Number(asBrowser.fills) === Number(mineBefore.fills), `${asBrowser?.fills} vs ${mineBefore.fills}`);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
