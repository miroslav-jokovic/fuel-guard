/** Pure math / time / predicate helpers shared by the rules. */
import { MPG_FUEL_TYPES } from "../constants.js";
import type {
  TxnView,
  VehicleView,
  OperatingHours,
  RuleResult,
  FueledAtPrecision,
} from "./types.js";
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
  return milesSinceLastSourced(txn, prev)?.miles ?? null;
}

/**
 * milesSinceLast WITH its provenance (WP2). Which source actually produced the span matters: when the
 * miles came from the OBD span, they are INDEPENDENT of the driver-entered odometer — so a bogus entry
 * (odometer_mismatch / entry_suspect) must NOT suppress the consumption rules built on them (see
 * runAllRules P-1). Same preference/fallback semantics as before, in one place.
 */
export function milesSinceLastSourced(
  txn: TxnView,
  prev: TxnView | null,
): { miles: number; basis: "obd" | "entered" } | null {
  if (!prev) return null;
  const tObd = obdOdometer(txn);
  const pObd = obdOdometer(prev);
  if (tObd != null && pObd != null) {
    const d = tObd - pObd;
    if (d > 0) return { miles: d, basis: "obd" };
  }
  if (txn.odometer == null || prev.odometer == null) return null;
  const d = txn.odometer - prev.odometer;
  return d > 0 ? { miles: d, basis: "entered" } : null;
}

/**
 * Per-fill MPG = miles-since-last ÷ fuel consumed over that span. WP4: `extraGallons` is the fuel from
 * INTERMEDIATE fills that carry no odometer (they're skipped when picking previousTxn, but their fuel
 * WAS burned inside the span) — omitting it inflated MPG and masked deviations after a blank-odometer
 * fill. Callers without intermediate data (recentMpgSeries) pass 0 — unchanged behavior.
 */
export function computedMpg(txn: TxnView, prev: TxnView | null, extraGallons = 0): number | null {
  const miles = milesSinceLast(txn, prev);
  const gallons = txn.gallons + Math.max(0, extraGallons);
  if (miles == null || gallons <= 0) return null;
  return r2(miles / gallons);
}

/**
 * Extra percentage points of MPG drop to ALLOW for cold weather, so a legitimate winter economy hit
 * doesn't false-fire mpg_deviation. Documented effect: diesel highway MPG runs ~5–10% worse in severe
 * cold (fueleconomy.gov / fleet studies).
 *
 * WP6: when the fill's REAL ambient temperature is known (Open-Meteo backfill via weather_cache →
 * fuel_transactions.ambient_temp_f), it drives the derate: ≤20°F → 10, ≤32°F → 5. The result is the
 * MAX of the temperature derate and the calendar-month fallback — real cold outside winter months now
 * gets its allowance, while a warm winter day KEEPS the old leniency (this function only ever WIDENS
 * tolerance vs the pre-WP6 behavior; it can never create a new false alarm). Month read in UTC;
 * northern-hemisphere / US calendar (this fleet is ~99.9% US).
 */
export function coldWeatherDeratePct(fueledAtIso: string, ambientTempF?: number | null): number {
  const m = new Date(fueledAtIso).getUTCMonth(); // 0=Jan … 11=Dec
  const calendar = m === 11 || m === 0 || m === 1 ? 10 : m === 10 || m === 2 ? 5 : 0;
  const temp = ambientTempF == null ? 0 : ambientTempF <= 20 ? 10 : ambientTempF <= 32 ? 5 : 0;
  return Math.max(calendar, temp);
}

/** Baseline-contamination test (WP6): a fill with physical VOLUME-axis evidence (over-capacity /
 *  tank-space / top-off / over-fuel / fill-short) or a full alert-level case must never train the MPG
 *  baseline — sustained theft would drag the baseline down until its own deviations stop firing
 *  (self-normalizing drift). A lone consumption-axis signal (mpg_deviation itself) does NOT
 *  contaminate: excluding those would ratchet the baseline and alert-storm on legitimate efficiency
 *  loss (mpg_sustained_decline covers gradual decline). Pure. */
const VOLUME_AXIS_RULE_IDS = new Set([
  "exceeds_tank_capacity",
  "tank_space_exceeded",
  "implausible_topoff",
  "cumulative_overfuel",
  "tank_fill_short",
]);
export function contaminatesBaseline(
  caseLevel: string | null | undefined,
  caseSignals: { ruleId: string }[] | null | undefined,
): boolean {
  if (caseLevel === "alert") return true;
  return (caseSignals ?? []).some((s) => VOLUME_AXIS_RULE_IDS.has(s.ruleId));
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
/** WP-BEH — precision-scaled bounds for the LEARNED tank-short tolerance: never tighter than 8% of the
 *  bill (J1939 level resolution + plateau timing keep that much irreducible noise), never wider than the
 *  legacy blanket 30%. */
export const TANK_FILL_TOLERANCE_MIN_PCT = 0.08;
export const TANK_FILL_SIGMA_MULT = 3;

/**
 * WP-BEH — per-truck tank-short tolerance (fraction of billed gallons). The blanket 30% existed because
 * sensors vary; now each truck's own measured ratio noise (learnTankSensorReliability.ratioSigma) sizes
 * the band: 3σ of THIS truck's history, clamped to [8%, 30%]. A clean single-tank truck (σ ≈ 0.02–0.03)
 * drops to the 8–9% floor — a ~29-gal skim on a 100-gal bill, invisible under the old blanket, now
 * clears the band — while a noisy sensor keeps the full 30%. No sigma learned → legacy 30% (unchanged).
 */
export function tankShortTolerancePct(ratioSigma: number | null | undefined): number {
  if (ratioSigma == null || !Number.isFinite(ratioSigma) || ratioSigma <= 0)
    return TANK_FILL_TOLERANCE_PCT;
  return Math.min(
    TANK_FILL_TOLERANCE_PCT,
    Math.max(TANK_FILL_TOLERANCE_MIN_PCT, TANK_FILL_SIGMA_MULT * ratioSigma),
  );
}

/**
 * Plausible per-fill MPG band for a heavy diesel tractor. A value outside it is a DATA ARTIFACT, never a real
 * efficiency: a partial / DEF / splash fill still carries the FULL miles since the last real fill
 * (big miles ÷ tiny gallons → impossibly high MPG), or a missed / short odometer entry (tiny miles ÷ normal
 * gallons → near-zero MPG). Such values must never train the baseline — one of them dragged a truck's learned
 * MPG to 64, which made every honest fill read as massive over-fuel (three false consumption signals on one
 * fill). This is a TRAINING guard only: a fill's own computedMpg is still reported verbatim for the
 * deviation check and the UI. Tunable in one place.
 */
/** Class-8 tractor idle burn (gal/engine-idle-hour) used to convert MEASURED idle seconds into the
 *  cumulative_overfuel ceiling allowance. Industry range is ~0.6–1.0 gph (ATRI/DOE); 0.8 is the
 *  midpoint — conservative in both directions, and only ever applied to measured idle time. */
export const IDLE_BURN_GPH = 0.8;

export const MIN_TRAINABLE_MPG = 2;
export const MAX_TRAINABLE_MPG = 15;

export function recentMpgSeries(ordered: TxnView[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const mpg = computedMpg(ordered[i]!, ordered[i - 1]!, ordered[i]!.intermediateGallons ?? 0);
    if (mpg != null && mpg >= MIN_TRAINABLE_MPG && mpg <= MAX_TRAINABLE_MPG) out.push(mpg);
  }
  return out;
}

export function effectiveBaseline(vehicle: VehicleView, recentTxns: TxnView[]): number | null {
  const series = recentMpgSeries(recentTxns);
  if (series.length >= 3) return r2(median(series.slice(-5)));
  // Fallback to the stored baseline ONLY if it is itself plausible — a corrupted stored value (e.g. a 64 MPG
  // learned before the training guard existed) must never drive a rule. Implausible → null → the rule skips.
  const stored = vehicle.baselineMpg;
  return stored != null && stored >= MIN_TRAINABLE_MPG && stored <= MAX_TRAINABLE_MPG
    ? stored
    : null;
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
export const timeReliable = (t: TxnView): boolean =>
  precision(t) === "instant" && t.timeConfirmed !== false;

// ── the rules ─────────────────────────────────────────────────────────────────

export const none = (ruleId: RuleId): RuleResult => ({
  ruleId,
  fired: false,
  severity: "low",
  message: "",
  evidence: {},
});
