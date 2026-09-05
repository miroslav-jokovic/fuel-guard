// FuelGuard — fuel price history matrix (migration 0245).
//
// Until 0245 every upload of the daily Pilot price report DELETED the one before it, and the table held
// exactly one day: 683 rows for 683 stations, min(observed_at) = max(observed_at). Months of posted and
// net prices were destroyed on arrival — the retail series that makes discount capture answerable from
// the EFS feed rather than from a hand-uploaded PDF.
//
// Three properties now carry that, and each fails in a way that looks like success:
//
//   1. IDEMPOTENT BY OBSERVATION. `observed_at` is the report's own Effective Date, so re-uploading a
//      file must be a no-op while a NEW day accumulates beside it. Without the unique key a backfill of
//      three months of reports multiplies rows on every retry and every median drawn from them is wrong.
//   2. DENY-ALL CLIENT WRITES. 0058 gave admins a direct write policy. A price series a browser session
//      can rewrite is not a benchmark anyone can take to a vendor.
//   3. THE PLANNING READ STAYS BOUNDED. `fuel_prices_for_planning` must cap samples PER STATION and
//      still return each station's most recent row however old — a station last priced two months ago
//      has to keep its price rather than vanish from the Truck Stops list.
//
// Applies EVERY migration, same as rls.test.mjs.
//
// Run:  node supabase/tests/fuel-price-history.test.mjs
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
const sqlstate = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
};

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
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;
const station = async (brand, store) =>
  (await one(`insert into fuel_stations (brand, store_number, name, lat, lng, state) values ($1,$2,$3,40,-80,'TX') returning id`,
    [brand, store, `${brand} #${store}`])).id;
const S1 = await station("pilot", "436");
const S2 = await station("flying_j", "1005");
const S3 = await station("pilot", "999"); // priced once, long ago

/**
 * Write a day's report the way the ingest does — upsert on the observation key, at the report's
 * Effective Date NOON UTC. The explicit `Z` matters: `'2026-08-20'::date + interval '12 hours'` resolves
 * in the session's time zone, so a test written that way disagrees with production by the server's UTC
 * offset and the key stops meaning "one report, one day".
 */
const noonUtc = (day) => `${day}T12:00:00Z`;
const upload = (org, stationId, day, net, posted = null) =>
  db.query(
    `insert into fuel_prices (org_id, station_id, product, posted_price, net_price, source, observed_at)
     values ($1,$2,'diesel',$3,$4,'pilot_email',$5::timestamptz)
     on conflict (org_id, source, station_id, product, observed_at) do update
       set posted_price = excluded.posted_price, net_price = excluded.net_price`,
    [org, stationId, posted, net, noonUtc(day)],
  );

// ── 1. a re-upload is a no-op; a new day accumulates ─────────────────────────────────────────────
await upload(ORG, S1, "2026-08-20", 4.51);
await upload(ORG, S1, "2026-08-20", 4.51); // the same file dropped twice
ok("re-uploading the same report does not duplicate its rows",
  Number((await one(`select count(*) c from fuel_prices where org_id=$1 and station_id=$2`, [ORG, S1])).c) === 1);

await upload(ORG, S1, "2026-08-20", 4.55); // a corrected re-issue of the SAME day
ok("a corrected re-issue of the same day updates in place rather than accumulating",
  Number((await one(`select count(*) c from fuel_prices where org_id=$1 and station_id=$2`, [ORG, S1])).c) === 1);
ok("and carries the corrected price",
  Number((await one(`select net_price n from fuel_prices where org_id=$1 and station_id=$2`, [ORG, S1])).n) === 4.55);

for (const [d, p] of [["2026-08-21", 4.60], ["2026-08-22", 4.71], ["2026-08-23", 4.68]]) await upload(ORG, S1, d, p);
ok("a new day accumulates beside the old ones — the series this migration exists for",
  Number((await one(`select count(*) c from fuel_prices where org_id=$1 and station_id=$2`, [ORG, S1])).c) === 4);

// The key includes source: the EFS feed and the daily email observe the same station on the same day.
await db.query(
  `insert into fuel_prices (org_id, station_id, product, net_price, source, observed_at)
   values ($1,$2,'diesel',4.49,'efs','2026-08-20T12:00:00Z')`, [ORG, S1]);
ok("two sources may observe the same station on the same day without colliding",
  Number((await one(`select count(*) c from fuel_prices where org_id=$1 and station_id=$2 and observed_at='2026-08-20T12:00:00Z'`, [ORG, S1])).c) === 2);

ok("one org's series cannot collide with another's",
  (await sqlstate(
    `insert into fuel_prices (org_id, station_id, product, net_price, source, observed_at)
     values ($1,$2,'diesel',9.99,'pilot_email','2026-08-20T12:00:00Z')`, [OTHER, S1])) === null);

// ── 2. writes belong to the service role alone (D-FP2) ───────────────────────────────────────────
const policies = await rows(`select cmd from pg_policies where tablename='fuel_prices'`);
ok("the only policy left on fuel_prices is SELECT", policies.length === 1 && policies[0].cmd === "SELECT",
  JSON.stringify(policies));
ok("the 0058 client write policy is gone — a browser cannot rewrite the price series",
  (await rows(`select 1 from pg_policies where tablename='fuel_prices' and policyname='fuel_prices_write'`)).length === 0);
ok("row level security is still enabled",
  (await one(`select relrowsecurity b from pg_class where relname='fuel_prices'`)).b === true);

// ── 3. the planning read is bounded, and keeps a stale station visible ───────────────────────────
await upload(ORG, S2, "2026-08-22", 4.80);
await upload(ORG, S2, "2026-08-23", 4.83);
await upload(ORG, S3, "2026-06-01", 3.95); // priced once, months ago

const since = "2026-08-21T00:00:00Z";
const planning = await rows(`select * from fuel_prices_for_planning($1, $2::timestamptz, 40, 'diesel')`, [ORG, since]);
const forStation = (id) => planning.filter((r) => r.station_id === id);

ok("a station priced only months ago still returns its last known price",
  forStation(S3).length === 1 && Number(forStation(S3)[0].net_price) === 3.95);
ok("a station inside the window returns its recent samples",
  forStation(S1).length === 3, `got ${forStation(S1).length}`); // 08-21, 08-22, 08-23; 08-20 is outside
ok("rows arrive newest first per station, so the first row IS the latest",
  forStation(S1)[0].observed_at >= forStation(S1)[forStation(S1).length - 1].observed_at);
// `observed_at` arrives as a Date; compare instants, not a Date against a string.
ok("nothing from before the window leaks in except a station's single latest row",
  planning.every((r) => new Date(r.observed_at).getTime() >= new Date(since).getTime() || r.station_id === S3));
ok("another org's prices are never returned",
  planning.every((r) => forStation(r.station_id).length > 0) &&
    (await rows(`select * from fuel_prices_for_planning($1, $2::timestamptz, 40, 'diesel')`, [OTHER, since])).length === 1);

const capped = await rows(`select * from fuel_prices_for_planning($1, '2026-01-01'::timestamptz, 2, 'diesel')`, [ORG]);
ok("the per-station cap bounds the read as history grows",
  capped.filter((r) => r.station_id === S1).length === 2, `got ${capped.filter((r) => r.station_id === S1).length}`);

ok("the function is not executable by anonymous sessions",
  (await rows(`select 1 from information_schema.role_routine_grants
               where routine_name='fuel_prices_for_planning' and grantee='anon'`)).length === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
