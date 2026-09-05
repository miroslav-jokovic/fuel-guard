// FuelGuard — fuel_buy_fills matrix (migration 0254).
//
// F13 asks what happened BETWEEN two fills. Everything that makes that question answerable is a
// property of this function, and each one fails quietly:
//
//   1. THE LOOKBACK. A pair needs a fill on both sides. Return only the window and every truck's first
//      in-window fill loses its predecessor, so the leg that crossed INTO the window is unscored — one
//      pair per truck, about 3% of the answer, and invisible. The context rows come back flagged
//      `in_window = false` so the caller can score a pair on where its ARRIVING fill landed.
//   2. THE INSTANT, NOT THE DAY. Two fills on one business date is exactly the cross-border case. A
//      function returning only a date leaves them unorderable and the pair silently reversed.
//   3. AN UNCONFIRMED TANK LEVEL IS NOT A TANK LEVEL. `samsara_fuel_pct_before` is only as good as the
//      fill's placement in time; the level is nulled unless `fueling_time_basis = 'tank_confirmed'`,
//      here rather than downstream, so no caller can use one by forgetting to check.
//   4. ORG SCOPE, FAILING CLOSED. `security invoker` + `coalesce(p_org, auth_org_id())` — no org, no
//      rows (D-FC1), the same contract `fuel_spend_lines` has.
//
// Run:  node supabase/tests/fuel-buy-fills.test.mjs
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
/** The SQLSTATE a statement raises, or null when it succeeds. */
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

const truck = async (org, unit, o = {}) =>
  (await one(
    `insert into vehicles (org_id, unit_number, tank_capacity_gal, sensor_capacity_gal, observed_max_fill_gal, baseline_mpg)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [org, unit, o.cap ?? 240, o.sensorCap ?? null, o.observedMax ?? null, o.mpg ?? 6.9])).id;

const V1 = await truck(ORG, "701");
const V2 = await truck(ORG, "702", { cap: 200, mpg: 7.4 });
const VOTHER = await truck(OTHER, "999");

/** One fill. `at` is a full instant, because that is the point. */
const fillAt = async (org, vehicle, at, state, o = {}) =>
  db.query(
    `insert into fuel_transactions
       (org_id, vehicle_id, fueled_at, state, gallons, total_cost, tank_type,
        miles_since_last, samsara_fuel_pct_before, fueling_time_basis)
     values ($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10)`,
    [org, vehicle, at, state, o.gallons ?? 120, o.cost ?? 600, o.tank ?? "tractor",
     o.miles ?? null, o.pct ?? null, o.basis ?? null]);

// A California→Arizona leg inside the window, plus a leg that STARTS before it.
await fillAt(ORG, V1, "2026-08-10T12:00:00Z", "CA", { gallons: 150, cost: 990, pct: 40, basis: "tank_confirmed" });
await fillAt(ORG, V1, "2026-08-11T12:00:00Z", "AZ", { gallons: 100, cost: 520, pct: 50, basis: "tank_confirmed", miles: 350 });
await fillAt(ORG, V1, "2026-07-28T12:00:00Z", "CA", { gallons: 140, cost: 900, pct: 30, basis: "tank_confirmed" });
// Two fills on ONE business date, inserted in the opposite order to the one they happened in. The
// instants are chosen so BOTH land on 2026-08-15 locally: 16:00Z is 09:00 in California and 23:00Z is
// 16:00 in Arizona. (05:00Z would have been the 14th in California — `fuel_business_date` is doing
// real work here, which is the reason the window filter runs on it rather than on the raw instant.)
await fillAt(ORG, V2, "2026-08-15T23:00:00Z", "AZ", { gallons: 90, cost: 470, miles: 300 });
await fillAt(ORG, V2, "2026-08-15T16:00:00Z", "CA", { gallons: 160, cost: 1050 });
// An unconfirmed level, and a reefer fill that must never appear.
await fillAt(ORG, V2, "2026-08-18T12:00:00Z", "TX", { gallons: 110, cost: 480, pct: 62, basis: "stop_estimated", miles: 700 });
await fillAt(ORG, V2, "2026-08-19T12:00:00Z", "TX", { gallons: 55, cost: 240, tank: "reefer" });
await fillAt(OTHER, VOTHER, "2026-08-12T12:00:00Z", "TX", { gallons: 100, cost: 430 });

const rows = async (from, to, org = ORG) =>
  await all(`select * from fuel_buy_fills($2::date, $3::date, $1)`, [org, from, to]);

// ── 1. the lookback ─────────────────────────────────────────────────────────────────────────────
const win = await rows("2026-08-01", "2026-08-31");
const july = win.filter((r) => r.tran_date.toISOString().slice(0, 10) === "2026-07-28");
ok("a fill from before the window comes back as CONTEXT, so the leg into the window has a predecessor",
  july.length === 1, `got ${july.length}`);
ok("and it is flagged out of window, so the caller does not score it as its own pair",
  july[0]?.in_window === false, JSON.stringify(july[0]));
ok("every fill inside the window is flagged in-window",
  win.filter((r) => r.tran_date.toISOString().slice(0, 10) >= "2026-08-01").every((r) => r.in_window === true));
ok("the lookback stops at fourteen days",
  (await rows("2026-08-20", "2026-08-31")).every((r) => r.tran_date.toISOString().slice(0, 10) >= "2026-08-06"),
  JSON.stringify((await rows("2026-08-20", "2026-08-31")).map((r) => r.tran_date.toISOString().slice(0, 10))));

// ── 2. the instant, not the day ─────────────────────────────────────────────────────────────────
const v2 = win.filter((r) => r.unit === "702");
const sameDay = v2.filter((r) => r.tran_date.toISOString().slice(0, 10) === "2026-08-15");
ok("two fills on one business date both come back", sameDay.length === 2, `got ${sameDay.length}`);
ok("and they are ordered by the INSTANT, so the cross-border pair is the right way round",
  sameDay[0].state === "CA" && sameDay[1].state === "AZ",
  JSON.stringify(sameDay.map((r) => [r.state, r.fueled_at])));

// ── 3. an unconfirmed tank level is not a tank level ────────────────────────────────────────────
const confirmed = win.find((r) => r.unit === "701" && r.state === "AZ");
const estimated = win.find((r) => r.unit === "702" && r.state === "TX");
ok("a tank-confirmed fill carries its level", Number(confirmed.level_before_pct) === 50);
ok("an unconfirmed tank level comes back null, because a level is only as good as the fill's timing",
  estimated.level_before_pct === null, JSON.stringify(estimated));
ok("but the rest of that fill is still returned — an unconfirmed level is not an unusable fill",
  Number(estimated.miles_since_last) === 700 && Number(estimated.gallons) === 110);

// ── 4. what it returns, and what it deliberately does not ───────────────────────────────────────
ok("reefer fuel never appears — it is not the tractor's buying decision",
  win.every((r) => Number(r.gallons) !== 55));
ok("capacity comes back RAW, all three columns, for `resolveCapacity` to reconcile in shared",
  Number(confirmed.entered_capacity_gal) === 240 &&
  "sensor_capacity_gal" in confirmed && "observed_max_fill_gal" in confirmed);
ok("the truck's own baseline mpg comes with it, and it is not derived from this fill",
  Number(confirmed.baseline_mpg) === 6.9);
ok("`computed_mpg` is NOT returned — it equals miles/gallons and would collapse the burn estimate",
  !("computed_mpg" in confirmed));

// ── 5. org scope, failing closed ────────────────────────────────────────────────────────────────
ok("another carrier's fills never appear", win.every((r) => r.unit !== "999"));
ok("the other carrier sees its own", (await rows("2026-08-01", "2026-08-31", OTHER)).some((r) => r.unit === "999"));

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
const asOrg = await asClient(ORG, "admin",
  `select count(*)::int n from fuel_buy_fills('2026-08-01'::date, '2026-08-31'::date, null)`);
ok("a browser passing no org is scoped by its JWT", (asOrg.rows[0]?.n ?? 0) > 0, JSON.stringify(asOrg));
const crossed = await asClient(ORG, "admin",
  `select count(*)::int n from fuel_buy_fills('2026-08-01'::date, '2026-08-31'::date, $1)`, [OTHER]);
// `security invoker` means RLS still applies to the rows underneath, so naming another org yields
// nothing rather than that org's fills — the property that makes p_org safe to expose at all.
ok("and naming another carrier's org returns nothing, because RLS still applies underneath",
  crossed.rows[0]?.n === 0, JSON.stringify(crossed));


// ── THE CALL THE BROWSER ACTUALLY MAKES (0257) ──────────────────────────────────────────────────
// Every assertion above passes `p_org` explicitly, which is the API's call — and it is exactly why
// this file was green while `fuel_buy_fills` was unreachable from the only surface that uses it. PostgREST
// resolves an RPC on the set of NAMED arguments supplied, so a parameter with no DEFAULT means there
// is no form that omits it, and the browser gets "could not find the function ... in the schema
// cache". D-FC1 says `coalesce(p_org, auth_org_id())`; the coalesce was there and the default was not.
// Named arguments with p_org OMITTED — not passed as null, OMITTED. That distinction is the whole
// defect: a positional `(…, null)` resolves fine without a default, which is why every existing
// assertion here passed while the browser could not call the function at all.
const browserCall = await asClient(ORG, "admin",
  `select count(*)::int n from fuel_buy_fills(p_from => '2026-08-01'::date, p_to => '2026-08-31'::date)`);
ok("the browser's call — named arguments, p_org omitted entirely — resolves",
  browserCall.error === null, String(browserCall.error));
ok("and returns this org's rows, so the default really does fall through to auth_org_id()",
  (browserCall.rows[0]?.n ?? 0) > 0, JSON.stringify(browserCall.rows[0]));

// Release the WASM database before the verdict. This matrix exits explicitly only when it FAILS, so
// on the green path Node had to drain PGlite's handles on its own — ~10 seconds of idle wait after
// the last assertion, paid once per matrix per run. Measured 2026-09-05: 11.33s -> 1.32s here.
await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
