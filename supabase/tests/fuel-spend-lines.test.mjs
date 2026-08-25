// FuelGuard — fuel_spend_lines matrix (migration 0246).
//
// The function joins each recorded fill to the price that applied at that station on that day, so
// discount capture — "how much of the pump price does our contract actually take off" — can be answered
// from the EFS feed instead of from a hand-uploaded statement.
//
// Two of its properties fail QUIETLY, and each corrupts a different number:
//
//   1. ONE PRICE PER STATION-DAY. A station can carry several price rows for one day: the daily email
//      and the EFS layer are separate sources, and a re-issued report supersedes by observation rather
//      than by deletion. A plain join would emit the FILL once per price and double-count its gallons —
//      inflating the fuel total on a page whose whole claim is that it ties to the bill.
//   2. NO PRICE IS NULL, NEVER ZERO. 17% of fills in the first real window matched no same-day price.
//      Returned as 0 they read as "this fill captured no discount at all" and manufacture a shortfall
//      out of a missing upload. `analyzeDiscountCapture` drops null rows; it cannot drop zeroes.
//
// Run:  node supabase/tests/fuel-spend-lines.test.mjs
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
const rows = async (q, p = []) => (await db.query(q, p)).rows;

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text,
    owner uuid, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const ST = (await one(`insert into fuel_stations (brand,store_number,name,lat,lng,state,city)
  values ('pilot','436','Pilot #436',35,-101,'TX','Amarillo') returning id`)).id;
const VEH = (await one(`insert into vehicles (org_id,unit_number,tank_capacity_gal) values ($1,'754',150) returning id`, [ORG])).id;

const fill = (day, gallons, cost, stationId = ST) =>
  db.query(
    `insert into fuel_transactions (org_id, vehicle_id, station_id, fueled_at, gallons, total_cost, state, tank_type, source)
     values ($1,$2,$3,$4::timestamptz,$5,$6,'TX','tractor','import')`,
    [ORG, VEH, stationId, `${day}T15:00:00Z`, gallons, cost],
  );
const price = (day, posted, net, source = "pilot_email", at = "12:00:00") =>
  db.query(
    `insert into fuel_prices (org_id, station_id, product, posted_price, net_price, source, observed_at)
     values ($1,$2,'diesel',$3,$4,$5,$6::timestamptz)`,
    [ORG, ST, posted, net, source, `${day}T${at}Z`],
  );

const call = (from, to, vehicles = null) =>
  rows(`select * from fuel_spend_lines($1::date, $2::date, $3::uuid[])`, [from, to, vehicles]);

// ── 1. the join ──────────────────────────────────────────────────────────────────────────────────
await fill("2026-08-11", 100, 500);
await price("2026-08-11", 5.5, 5.0);
let r = await call("2026-08-01", "2026-08-31");
ok("a fill is joined to the price that applied that day", r.length === 1 && Number(r[0].retail_amount) === 550);
ok("and carries what it actually cost", Number(r[0].net_amount) === 500 && Number(r[0].gallons) === 100);
ok("with the station's brand, so the policy reports work off the same rows", r[0].brand === "pilot");
ok("and the unit, because a dispatcher speaks in unit numbers", r[0].unit === "754");

// ── 2. one price per station-day, whatever the sources say ──────────────────────────────────────
await price("2026-08-11", 9.99, 9.0, "efs", "18:00:00"); // a second source, same station, same day
r = await call("2026-08-01", "2026-08-31");
ok("a second price for the same station-day does NOT duplicate the fill", r.length === 1, `got ${r.length} rows`);
ok("and the newest observation wins", Number(r[0].retail_amount) === 999, JSON.stringify(r[0].retail_amount));
ok(
  "so the gallons cannot be double-counted by a re-upload",
  Number((await one(`select sum(gallons) g from fuel_spend_lines('2026-08-01','2026-08-31',null)`)).g) === 100,
);

// ── 3. no price is NULL, never zero ─────────────────────────────────────────────────────────────
await fill("2026-08-20", 80, 420); // a day nobody uploaded a report for
r = await call("2026-08-20", "2026-08-20");
ok("a fill with no same-day price returns NULL retail", r.length === 1 && r[0].retail_amount === null);
ok("and NOT zero, which would read as a fill that captured no discount at all", r[0].retail_amount !== 0);
ok("while still reporting what it cost", Number(r[0].net_amount) === 420);

// A price on a DIFFERENT day must not be borrowed for this fill.
await price("2026-08-19", 6.0, 5.4);
ok(
  "yesterday's price is not applied to today's fill",
  (await call("2026-08-20", "2026-08-20"))[0].retail_amount === null,
);

// ── 4. the window and the truck filter ──────────────────────────────────────────────────────────
ok("the window is inclusive of its last day", (await call("2026-08-11", "2026-08-11")).length === 1);
ok("and excludes a fill outside it", (await call("2026-08-12", "2026-08-19")).length === 0);
ok("a null vehicle list means the whole fleet", (await call("2026-08-01", "2026-08-31")).length === 2);
ok("naming the truck keeps its fills", (await call("2026-08-01", "2026-08-31", [VEH])).length === 2);
ok(
  "naming a different truck returns none of them",
  (await call("2026-08-01", "2026-08-31", ["00000000-0000-0000-0000-000000000000"])).length === 0,
);

// ── 5. reachability ─────────────────────────────────────────────────────────────────────────────
const grants = await rows(
  `select grantee from information_schema.role_routine_grants where routine_name='fuel_spend_lines'`,
);
ok("authenticated sessions may call it", grants.some((g) => g.grantee === "authenticated"));
ok("anonymous ones may not", !grants.some((g) => g.grantee === "anon"));
ok(
  "and it is security INVOKER, so RLS decides what a caller sees",
  (await one(`select prosecdef from pg_proc where proname='fuel_spend_lines'`)).prosecdef === false,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
