/** Pure math / time / predicate helpers shared by the rules. */
import { MPG_FUEL_TYPES } from "../constants.js";
import type { TxnView, VehicleView, OperatingHours, RuleResult, FueledAtPrecision } from "./types.js";
import type { RuleId } from "./ids.js";

// ── helpers ───────────────────────────────────────────────────────────────────

export const r2 = (n: number) => Math.round(n * 100) / 100;

export function hoursBetween(aIso: string, bIso: string): number {
  return Math.abs(new Date(bIso).getTime() - new Date(aIso).getTime()) / 3_600_000;
}

export function daysBetween(aIso: string, bIso: string): number {
  return hoursBetween(aIso, bIso) / 24;
}

/** The OBD/ECU odometer for a fill, ONLY when it's a real ECU reading (source 'obd') — the ~99.9%-precise one.
 *  GPS/reconstructed readings carry a per-truck bias and are never used as the miles source. */
export function obdOdometer(t: TxnView): number | null {
  return t.samsaraOdometerSource === "obd" && t.samsaraOdometer != null ? t.samsaraOdometer : null;
}

/**
 * Miles driven since the previous fill. PREFERS the OBD/ECU odometer SPAN when BOTH fills have one — the ECU
 * odometer is ~99.9% precise, while driver-entered readings are only ~80% within 2 mi and add noise to every
 * consumption/efficiency rule (mpg, expected-band, top-off). The dash↔ECU offset cancels in a span, and we
 * NEVER mix sources (both OBD, or both entered). Falls back to the entered span when OBD isn't available for
 * both fills, or if the OBD span is non-positive (a reconstruction gap / rollback) — the entered span then
 * governs, exactly as before.
 */
export function milesSinceLast(txn: TxnView, prev: TxnView | null): number | null {
  if (!prev) return null;
  const tObd = obdOdometer(txn);
  const pObd = obdOdometer(prev);
  if (tObd != null && pObd != null) {
    const d = tObd - pObd;
    if (d > 0) return d;
  }
  if (txn.odometer == null || prev.odometer == null) return null;
  const d = txn.odometer - prev.odometer;
  return d > 0 ? d : null;
}

export function computedMpg(txn: TxnView, prev: TxnView | null): number | null {
  const miles = milesSinceLast(txn, prev);
  if (miles == null || txn.gallons <= 0) return null;
  return r2(miles / txn.gallons);
}

/**
 * Extra percentage points of MPG drop to ALLOW for cold weather, by month, so a legitimate winter economy hit
 * doesn't false-fire mpg_deviation. Documented effect: diesel highway MPG runs ~5–10% worse in severe cold
 * (fueleconomy.gov / fleet studies). This ONLY widens the tolerance (never tightens it), so an imperfect
 * season map can never CREATE a false alarm — worst case it's slightly more lenient in winter. Northern-
 * hemisphere / US calendar (this fleet is ~99.9% US); month read in UTC. Tune per fleet if needed.
 */
export function coldWeatherDeratePct(fueledAtIso: string): number {
  const m = new Date(fueledAtIso).getUTCMonth(); // 0=Jan … 11=Dec
  if (m === 11 || m === 0 || m === 1) return 10; // Dec–Feb: deep winter
  if (m === 10 || m === 2) return 5; // Nov, Mar: shoulder
  return 0;
}

export function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Sensor tolerance for the advisory tank-fill-short check. Samsara's OBD tank-% reading is coarse, so a
 * billed-vs-observed gap under the LARGER of {floor gal, pct of the bill} is treated as noise, not a
 * shortfall. Mirrors reconcileTankFill's defaults. Exposed so it's discoverable and tunable in one place.
 */
export const TANK_FILL_MIN_TOLERANCE_GAL = 15;
export const TANK_FILL_TOLERANCE_PCT = 0.3;

export function recentMpgSeries(ordered: TxnView[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const mpg = computedMpg(ordered[i]!, ordered[i - 1]!);
    if (mpg != null) out.push(mpg);
  }
  return out;
}

export function effectiveBaseline(vehicle: VehicleView, recentTxns: TxnView[]): number | null {
  const series = recentMpgSeries(recentTxns);
  if (series.length >= 3) return r2(median(series.slice(-5)));
  return vehicle.baselineMpg ?? null;
}

export function localHourMinute(iso: string, tz: string): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { h, m };
}

export function isOffHours(iso: string, oh: OperatingHours): boolean {
  const [sh, sm] = oh.start.split(":").map(Number);
  const [eh, em] = oh.end.split(":").map(Number);
  const start = (sh ?? 0) * 60 + (sm ?? 0);
  const end = (eh ?? 0) * 60 + (em ?? 0);
  // start === end means OPEN 24/7 (e.g. a fleet running around the clock) — there are no off-hours, so the
  // off_hours rule never fires. This is how the settings UI expresses "24/7".
  if (start === end) return false;
  const { h, m } = localHourMinute(iso, oh.tz);
  const cur = h * 60 + m;
  return start <= end ? cur < start || cur >= end : cur < start && cur >= end;
}

export const isFuelVehicle = (v: VehicleView) => MPG_FUEL_TYPES.includes(v.fuelType);
export const precision = (t: TxnView): FueledAtPrecision => t.fueledAtPrecision ?? "instant";
/** The instant to use for time-of-day / interval math — the telematics-recovered stop time when present. */
export const eventTime = (t: TxnView): string => t.eventAt ?? t.fueledAt;
/** True when the fueling INSTANT is trustworthy: a real time-of-day AND corroborated (or manual). A
 *  date-only sentinel or an uncorroborated EFS posted time (timeConfirmed===false) is not reliable. */
export const timeReliable = (t: TxnView): boolean => precision(t) === "instant" && t.timeConfirmed !== false;

// ── the rules ─────────────────────────────────────────────────────────────────

export const none = (ruleId: RuleId): RuleResult => ({ ruleId, fired: false, severity: "low", message: "", evidence: {} });

