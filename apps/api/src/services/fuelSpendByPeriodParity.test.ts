import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sumSpendDays, spendSeries, type SpendDay } from "@silvicom/shared";

/**
 * `fuel_spend_by_period` (0252) and `sumSpendDays` must not drift.
 *
 * ── WHY THIS TEST EXISTS AT ALL ──────────────────────────────────────────────────────────────────
 * F9 moved the SUMMATION of ~13,000 truck-day rows into SQL so the browser stops fetching all of them
 * to display thirteen weekly figures. That creates a second place the same arithmetic happens, which
 * is exactly the thing the plan warns against: "the page and the database must not become a second
 * place arithmetic happens." The only thing making it safe is running both over identical rows and
 * comparing them field for field, which is what this does.
 *
 * ── WHY IT IS HERE, AND NOT IN `supabase/tests` OR IN `shared` ───────────────────────────────────
 * The PGlite matrices run under plain `node`, so a matrix cannot import a TypeScript module — and a
 * parity test that reimplemented the fold to get around that would be testing a THIRD copy. The
 * matrix keeps the SQL's own contract (clamping, active trucks, org scope); this keeps the two
 * implementations honest about each other.
 *
 * It does not live beside the fold in `packages/shared` either, tempting as that is: shared compiles
 * for the React Native driver app and its tsconfig carries no node types, so importing `node:fs` to
 * read the migrations would loosen a boundary that exists for a real reason. `apps/api` already does
 * I/O, already has PGlite, and already imports from shared.
 *
 * The derivation — the MPG plausibility band, implied miles, the idle coverage gate — was never moved
 * and has one implementation, which is the whole point of the split.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "../../../../supabase/migrations");

const db = new PGlite({ extensions: { pg_trgm } });
let ORG = "";
const rows: SpendDay[] = [];

/** Deterministic but irregular: equal rows would hide an off-by-one in either implementation. */
function makeDays(): Array<SpendDay & { orgDay: string }> {
  const out: Array<SpendDay & { orgDay: string }> = [];
  const start = Date.UTC(2026, 5, 1); // 2026-06-01, a Monday
  for (let i = 0; i < 70; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    for (let v = 0; v < 4; v++) {
      // Every fourth truck-day is a parked truck: a row with no fuel and no driving, which must not
      // count as an active truck but must still count as an observable truck-day.
      const parked = (i + v) % 4 === 0;
      out.push({
        orgDay: day, day, vehicleId: `v${v}`,
        fills: parked ? 0 : 1 + ((i + v) % 2),
        gallonsTractor: parked ? 0 : 80 + ((i * 7 + v * 13) % 60),
        gallonsReefer: v === 3 ? (i % 5) * 2 : 0,
        gallonsDef: (i % 3) * 1.5,
        spendTractor: parked ? 0 : 400 + ((i * 11 + v * 3) % 300),
        spendReefer: v === 3 ? (i % 5) * 9 : 0,
        spendDef: (i % 3) * 7,
        miles: parked ? 0 : 500 + ((i * 17 + v * 5) % 400),
        mpgGallons: parked ? 0 : 70 + ((i * 3 + v) % 50),
        milesRejected: i % 11 === 0 ? 120 : 0,
        driveSec: parked ? 0 : 20_000 + ((i * 97 + v * 31) % 15_000),
        idleSec: (i * 53 + v * 17) % 9_000,
        offSec: 0,
        coverageSec: 60_000 + ((i * 41 + v * 7) % 26_400),
      } as SpendDay & { orgDay: string });
    }
    // One unattributed row a week: fuel with no truck behind it and no engine time to observe.
    if (i % 7 === 3) {
      out.push({
        orgDay: day, day, vehicleId: null, fills: 1,
        gallonsTractor: 45, gallonsReefer: 0, gallonsDef: 0,
        spendTractor: 230, spendReefer: 0, spendDef: 0,
        miles: 0, mpgGallons: 0, milesRejected: 0,
        driveSec: 0, idleSec: 0, offSec: 0, coverageSec: 0,
      } as SpendDay & { orgDay: string });
    }
  }
  return out;
}

beforeAll(async () => {
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
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8").replace(/create extension if not exists pgcrypto;?/gi, ""));
  }

  ORG = ((await db.query<{ id: string }>(
    `insert into organizations (id,name) values (gen_random_uuid(),'Parity') returning id`)).rows[0]!).id;
  const vids: Record<string, string> = {};
  for (let v = 0; v < 4; v++) {
    vids[`v${v}`] = ((await db.query<{ id: string }>(
      `insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,$2,150) returning id`,
      [ORG, `70${v}`])).rows[0]!).id;
  }

  for (const d of makeDays()) {
    const vid = d.vehicleId ? vids[d.vehicleId]! : null;
    await db.query(
      `insert into fuel_spend_days (org_id, day, vehicle_id, fills, gallons_tractor, gallons_reefer,
         gallons_def, spend_tractor, spend_reefer, spend_def, miles, mpg_gallons, miles_rejected,
         drive_sec, idle_sec, off_sec, coverage_sec)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [ORG, d.day, vid, d.fills, d.gallonsTractor, d.gallonsReefer, d.gallonsDef,
       d.spendTractor, d.spendReefer, d.spendDef, d.miles, d.mpgGallons, d.milesRejected,
       d.driveSec, d.idleSec, d.offSec, d.coverageSec],
    );
    // The shared fold reads the vehicle's real id, exactly as `useSpendDaysQuery` projects it.
    rows.push({ ...d, vehicleId: vid });
  }
}, 120_000);

const ymd = (d: unknown): string => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));

const FIELDS: Array<[string, keyof ReturnType<typeof sumSpendDays>]> = [
  ["active_trucks", "activeTrucks"], ["days", "days"], ["fills", "fills"],
  ["gallons_tractor", "gallonsTractor"], ["spend_tractor", "spendTractor"],
  ["gallons_reefer", "gallonsReefer"], ["spend_reefer", "spendReefer"],
  ["gallons_def", "gallonsDef"], ["spend_def", "spendDef"],
  ["miles", "miles"], ["mpg_gallons", "mpgGallons"], ["miles_rejected", "milesRejected"],
  ["drive_sec", "driveSec"], ["idle_sec", "idleSec"], ["coverage_sec", "coverageSec"],
  ["truck_days", "truckDays"],
];

async function sql(from: string, to: string, grain: string) {
  return (await db.query<Record<string, unknown>>(
    `select * from fuel_spend_by_period($1::date,$2::date,$3,null,$4)`, [from, to, grain, ORG])).rows;
}

describe("fuel_spend_by_period agrees with sumSpendDays", () => {
  // Windows chosen to exercise the edges: whole weeks, a window cut mid-bucket at both ends, and one
  // that opens and closes inside a single week.
  for (const [grain, from, to] of [
    ["week", "2026-06-01", "2026-08-09"],
    ["week", "2026-06-03", "2026-08-06"],
    ["week", "2026-06-10", "2026-06-12"],
    ["month", "2026-06-01", "2026-08-09"],
    ["day", "2026-06-01", "2026-06-14"],
  ] as const) {
    it(`${grain} grain, ${from} → ${to}`, async () => {
      const got = await sql(from, to, grain);
      expect(got.length).toBeGreaterThan(0);

      const drift: string[] = [];
      for (const r of got) {
        const pf = ymd(r.period_from), pt = ymd(r.period_to);
        const mine = rows.filter((d) => d.day >= pf && d.day <= pt);
        const sums = sumSpendDays(mine);
        for (const [sqlKey, tsKey] of FIELDS) {
          const a = Number(r[sqlKey]);
          const b = Number(sums[tsKey]);
          if (Math.abs(a - b) > 1e-6) drift.push(`${pf}..${pt} ${sqlKey}: sql=${a} shared=${b}`);
        }
      }
      expect(drift, drift.join("\n")).toHaveLength(0);
    });
  }

  it("buckets the window the same way `spendSeries` does", async () => {
    // Not only the sums: which days land in which bucket, and which buckets are partial. A period the
    // two disagreed about would produce matching totals against mismatched labels.
    const from = "2026-06-03", to = "2026-08-06";
    const got = await sql(from, to, "week");
    const series = spendSeries(rows, "week", { from, to });
    expect(got.map((r) => `${ymd(r.period_from)}..${ymd(r.period_to)}`)).toEqual(
      series.map((p) => `${p.from}..${p.to}`),
    );
    expect(got.map((r) => r.partial === true)).toEqual(series.map((p) => p.partial));
  });

  it("narrows to a truck the same way the fold does when handed only its rows", async () => {
    const vid = rows.find((r) => r.vehicleId)!.vehicleId!;
    const got = (await db.query<Record<string, unknown>>(
      `select * from fuel_spend_by_period($1::date,$2::date,'week',$3,$4)`,
      ["2026-06-01", "2026-06-14", [vid], ORG])).rows;
    for (const r of got) {
      const pf = ymd(r.period_from), pt = ymd(r.period_to);
      const sums = sumSpendDays(rows.filter((d) => d.vehicleId === vid && d.day >= pf && d.day <= pt));
      expect(Number(r.gallons_tractor)).toBeCloseTo(sums.gallonsTractor, 6);
      expect(Number(r.active_trucks)).toBe(sums.activeTrucks);
      expect(Number(r.truck_days)).toBe(sums.truckDays);
    }
  });
});
