/**
 * Derive the daily fuel-spend rollup (migration 0244) from its three sources. Pure and dataset-free, so
 * the allocation and gating rules below are testable without a database — they are the part of this
 * feature most likely to be wrong in a way nobody notices.
 *
 * ── THE THREE SOURCES, AND WHY THEY LAND DIFFERENTLY ─────────────────────────────────────────────
 *   fills          `fuel_transactions` — tractor and reefer diesel. Money lands on the fill's business
 *                  date, exactly, because a fill happened on a date and belongs to it.
 *   DEF            `efs_transactions`, item DEFD/DEF. `fuel_transactions` carries no DEF at all, and DEF
 *                  is $55,512 of a five-week bill — 3.9% — so a "total fuel spend" without it is wrong
 *                  by more than every discount finding combined. It is keyed to a truck by unit number,
 *                  which matched 2,394 of 2,397 lines on real data; the three that miss go to the
 *                  unattributed row rather than being dropped.
 *   engine days    `vehicle_engine_days` — drive/idle seconds, already per truck per day.
 *
 * ── MILES ARE THE HARD PART ──────────────────────────────────────────────────────────────────────
 * `miles_since_last` measures the interval BETWEEN two fills, and is paired with the gallons bought at
 * the SECOND of them — the tank-to-tank convention, where the fuel you add replaces what you just
 * burned. Both are then spread across the days of that interval in proportion to how much the truck
 * actually drove each day, so a truck that fuels every third day stops booking three days of driving
 * against one date. A day the truck merely drove through therefore carries miles and their gallons
 * while having bought nothing — that is allocation working, not a bug, and migration 0244's
 * `fuel_spend_days_miles_pair` constraint is written to permit exactly it.
 *
 * Intervals are half-open on the left — (previous fill's day, this fill's day] — so every day belongs
 * to exactly one interval and no mile is counted twice.
 */
import { stateTimeZone } from "../efsImport/dateTime.js";

/**
 * The longest interval between two fills we will believe. A Class-8 tractor at 6 MPG would need 417
 * gallons to cover it, which is more than any legal tank configuration holds — so beyond this the
 * odometer rolled over, was re-keyed, or the truck changed hands, and the miles are noise.
 *
 * Measured on production from 2026-06-22: 24 of 4,004 tractor fills exceed it, the worst reporting
 * 12,406 miles. Left in, they are enough on their own to move fleet MPG by whole numbers.
 */
export const MAX_INTERVAL_MILES = 2500;

export type SpendRollupTank = "tractor" | "reefer";

/** A recorded fill, projected to what the rollup needs. */
export interface SpendFill {
  vehicleId: string | null;
  /** ISO instant. The business date is derived from it and the station's state. */
  fueledAt: string;
  state: string | null;
  tank: SpendRollupTank;
  gallons: number;
  totalCost: number | null;
  /** Odometer miles since this truck's previous fill, as recorded. Gated here, never trusted raw. */
  milesSinceLast: number | null;
}

/** A DEF line from the EFS feed, already resolved to a vehicle where its unit number matched one. */
export interface SpendDefLine {
  vehicleId: string | null;
  day: string; // YYYY-MM-DD, the vendor's transaction date
  gallons: number;
  amount: number;
}

export interface SpendEngineDay {
  vehicleId: string;
  day: string;
  driveSec: number;
  idleSec: number;
  offSec: number;
  coverageSec: number;
}

/** One derived row, keyed by (vehicleId, day). Mirrors `fuel_spend_days`. */
export interface SpendRollupRow {
  vehicleId: string | null;
  day: string;
  fills: number;
  gallonsTractor: number;
  gallonsReefer: number;
  gallonsDef: number;
  spendTractor: number;
  spendReefer: number;
  spendDef: number;
  miles: number;
  mpgGallons: number;
  milesBasis: "drive_time" | "even" | "none";
  milesRejected: number;
  driveSec: number;
  idleSec: number;
  offSec: number;
  coverageSec: number;
}

export interface DeriveInput {
  fills: readonly SpendFill[];
  defLines: readonly SpendDefLine[];
  engineDays: readonly SpendEngineDay[];
  /** Inclusive window the caller wants rows for. Sources may (and should) reach further back. */
  from: string;
  to: string;
}

export interface DeriveResult {
  rows: SpendRollupRow[];
  /** Intervals whose miles failed the gate — a data-quality figure the caller should log, not hide. */
  rejectedIntervals: number;
  /** Fills with no vehicle. They are kept, on the unattributed row; this counts them. */
  unattributedFills: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Station-local business date for a fill. The vendor prints its transaction date in station-local time,
 * so a fill just before midnight in Nevada belongs to that day and not to the UTC day after it —
 * a distinction that moves roughly one fill in twenty across a date boundary.
 */
export function businessDate(fueledAt: string, state: string | null): string | null {
  const d = new Date(fueledAt);
  if (Number.isNaN(d.getTime())) return null;
  const tz = stateTimeZone(state) ?? "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The days of a half-open interval (from, to], oldest first. Empty when `to` precedes `from`. */
function intervalDays(fromExclusive: string | null, toInclusive: string): string[] {
  if (!fromExclusive || fromExclusive >= toInclusive) return [toInclusive];
  const out: string[] = [];
  for (let d = addDays(fromExclusive, 1); d <= toInclusive; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > 60) return [toInclusive]; // a gap this long is not one interval; do not smear it
  }
  return out.length > 0 ? out : [toInclusive];
}

const KEY = (vehicleId: string | null, day: string) => `${vehicleId ?? ""}|${day}`;

function blank(vehicleId: string | null, day: string): SpendRollupRow {
  return {
    vehicleId, day, fills: 0,
    gallonsTractor: 0, gallonsReefer: 0, gallonsDef: 0,
    spendTractor: 0, spendReefer: 0, spendDef: 0,
    miles: 0, mpgGallons: 0, milesBasis: "none", milesRejected: 0,
    driveSec: 0, idleSec: 0, offSec: 0, coverageSec: 0,
  };
}

export function deriveFuelSpendRollup(input: DeriveInput): DeriveResult {
  const rows = new Map<string, SpendRollupRow>();
  const at = (vehicleId: string | null, day: string): SpendRollupRow => {
    const k = KEY(vehicleId, day);
    let row = rows.get(k);
    if (!row) rows.set(k, (row = blank(vehicleId, day)));
    return row;
  };

  // Drive seconds per truck-day drive the allocation below, so index them before walking the fills.
  const driveByKey = new Map<string, number>();
  for (const e of input.engineDays) driveByKey.set(KEY(e.vehicleId, e.day), e.driveSec);

  // ── fuel: money on the fill's own business date ────────────────────────────────────────────────
  let unattributedFills = 0;
  const byVehicle = new Map<string, { day: string; fill: SpendFill }[]>();
  for (const f of input.fills) {
    const day = businessDate(f.fueledAt, f.state);
    if (!day) continue;
    if (!f.vehicleId) unattributedFills++;
    if (day >= input.from && day <= input.to) {
      const row = at(f.vehicleId, day);
      row.fills += 1;
      if (f.tank === "reefer") {
        row.gallonsReefer = r3(row.gallonsReefer + f.gallons);
        row.spendReefer = r2(row.spendReefer + (f.totalCost ?? 0));
      } else {
        row.gallonsTractor = r3(row.gallonsTractor + f.gallons);
        row.spendTractor = r2(row.spendTractor + (f.totalCost ?? 0));
      }
    }
    // Only an attributed tractor fill can carry an odometer interval; a reefer tank does not move the
    // truck, and a fill with no vehicle has no previous fill to measure from.
    if (f.vehicleId && f.tank === "tractor") {
      const list = byVehicle.get(f.vehicleId);
      if (list) list.push({ day, fill: f });
      else byVehicle.set(f.vehicleId, [{ day, fill: f }]);
    }
  }

  // ── miles: allocated across the interval they were driven over ─────────────────────────────────
  let rejectedIntervals = 0;
  for (const [vehicleId, list] of byVehicle) {
    list.sort((a, b) => (a.fill.fueledAt < b.fill.fueledAt ? -1 : a.fill.fueledAt > b.fill.fueledAt ? 1 : 0));
    for (let i = 0; i < list.length; i++) {
      const { day, fill } = list[i]!;
      const miles = fill.milesSinceLast;
      if (miles == null || miles <= 0 || miles > MAX_INTERVAL_MILES) {
        // The gallons stay on the fuel side above; only their MILES are refused, and the refusal is
        // counted where it happened so a failing odometer shows up as a number rather than as good MPG.
        if (miles != null && day >= input.from && day <= input.to) {
          at(vehicleId, day).milesRejected += 1;
          rejectedIntervals++;
        }
        continue;
      }
      const previousDay = i > 0 ? list[i - 1]!.day : null;
      allocate(at, driveByKey, vehicleId, intervalDays(previousDay, day), miles, fill.gallons, input);
    }
  }

  // ── DEF: its own source, its own date ──────────────────────────────────────────────────────────
  for (const d of input.defLines) {
    if (d.day < input.from || d.day > input.to) continue;
    const row = at(d.vehicleId, d.day);
    row.gallonsDef = r3(row.gallonsDef + d.gallons);
    row.spendDef = r2(row.spendDef + d.amount);
  }

  // ── engine time: already at this grain ─────────────────────────────────────────────────────────
  for (const e of input.engineDays) {
    if (e.day < input.from || e.day > input.to) continue;
    const row = at(e.vehicleId, e.day);
    row.driveSec += e.driveSec;
    row.idleSec += e.idleSec;
    row.offSec += e.offSec;
    row.coverageSec += e.coverageSec;
  }

  return {
    rows: [...rows.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)),
    rejectedIntervals,
    unattributedFills,
  };
}

/**
 * Spread one interval's miles — and the gallons that replaced them — across its days.
 *
 * Weighted by drive seconds when the engine feed covers the interval, evenly when it does not. Days
 * outside the requested window are still weighted (the truck drove on them) but produce no row, so a
 * window boundary cannot inflate the days inside it.
 */
function allocate(
  at: (vehicleId: string | null, day: string) => SpendRollupRow,
  driveByKey: Map<string, number>,
  vehicleId: string,
  days: string[],
  miles: number,
  gallons: number,
  window: { from: string; to: string },
): void {
  const weights = days.map((d) => driveByKey.get(KEY(vehicleId, d)) ?? 0);
  const total = weights.reduce((a, w) => a + w, 0);
  const basis: SpendRollupRow["milesBasis"] = total > 0 ? "drive_time" : "even";
  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    const share = total > 0 ? weights[i]! / total : 1 / days.length;
    if (share <= 0) continue;
    if (day < window.from || day > window.to) continue;
    const row = at(vehicleId, day);
    row.miles = r2(row.miles + miles * share);
    row.mpgGallons = r3(row.mpgGallons + gallons * share);
    // A day fed by two intervals keeps the stronger claim: an evenly-spread interval should not
    // downgrade a day that another interval measured against real drive time.
    if (row.milesBasis === "none" || (row.milesBasis === "even" && basis === "drive_time")) {
      row.milesBasis = basis;
    }
  }
}
