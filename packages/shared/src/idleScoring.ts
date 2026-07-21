/**
 * Idle classification + driver fuel scoring (pure, testable). Samsara's Idling Events API already isolates
 * engine-on/not-moving idle (>2 min, PTO-aware); we classify each event by whether it was AVOIDABLE and
 * aggregate per driver so the fleet can coach the wasteful idlers and quantify the savings. The behavioral
 * goal: during sleep / load / wait, use APU or optimized idle — not continuous main-engine idle.
 */

export type IdleClassification =
  "productive" | "justified" | "discretionary" | "brief" | "undetermined";

export interface IdleThresholds {
  /** Idle shorter than this is a normal stop, not scored. Default 300 s (5 min). */
  minIdleSec?: number;
  /** Below this ambient °F, cab heating justifies idle. Default 20. */
  climateLowF?: number;
  /** Above this ambient °F, cab cooling justifies idle. Default 85. */
  climateHighF?: number;
  /** Idle fuel burn when the event has no measured fuel, gal/hr. Default 0.8 (Class-8 main-engine idle). */
  idleGalPerHour?: number;
  /** $/gal for the cost estimate when the event has no measured cost. Default 4.00. */
  fuelPricePerGal?: number;
}

const DEFAULTS: Required<IdleThresholds> = {
  minIdleSec: 300,
  climateLowF: 20,
  climateHighF: 85,
  idleGalPerHour: 0.8,
  fuelPricePerGal: 4.0,
};

export interface IdleEventInput {
  durationSec: number;
  ptoActive: boolean;
  /** Ambient air temperature °F, or null when Samsara couldn't read it. */
  airTempF: number | null;
  /** Manual has_apu for the truck. When true, extreme-temp idle is NOT climate-excused — the driver should run
   *  the APU for cab climate, so main-engine idle is still avoidable. null/false → the extreme-temp excuse
   *  applies (the main engine is the only climate source). */
  hasApu?: boolean | null;
}

/**
 * Classify one idle event:
 *  - `brief`         — below the minimum duration → a normal stop, ignored.
 *  - `productive`    — PTO active (equipment/work) → not the driver's waste.
 *  - `justified`     — ambient temperature outside the comfort band → cab climate is legitimate, BUT only on a
 *                      truck with no APU. On an APU-equipped truck the driver should run the APU, so climate
 *                      idle on the main engine stays discretionary (audit A1.3 — makes the score capability-fair).
 *  - `discretionary` — engine idling, no PTO, comfortable weather (or APU truck in any weather) → AVOIDABLE.
 *  - `undetermined`  — no PTO, no APU, and temperature UNKNOWN → can't judge weather, so not counted as waste.
 */
export function classifyIdleEvent(
  e: IdleEventInput,
  opts: IdleThresholds = {},
): IdleClassification {
  const o = { ...DEFAULTS, ...opts };
  if (e.durationSec < o.minIdleSec) return "brief";
  if (e.ptoActive) return "productive";
  // A truck with no APU relies on the MAIN ENGINE for cab climate, so extreme-weather idle is legitimate — but
  // only when we actually KNOW the weather. If the temperature is unknown (Samsara didn't report it and the
  // weather backfill couldn't fill it), we must NOT assume it was comfortable and call it waste. Classify it
  // `undetermined` (tracked, never counted against a driver) — the honest state (CP2). On an APU truck the
  // temperature is moot (the driver should run the APU either way), so unknown temp there stays discretionary.
  if (e.hasApu !== true) {
    if (e.airTempF == null) return "undetermined";
    if (e.airTempF < o.climateLowF || e.airTempF > o.climateHighF) return "justified";
  }
  return "discretionary";
}

export interface ComfortBandResult {
  /** Below this °F, idle is treated as justified (cab heating). */
  lowF: number;
  /** Above this °F, idle is treated as justified (cab cooling). */
  highF: number;
  samples: number;
}

/**
 * LEARN the fleet's comfort band from its own idle-vs-temperature pattern. Drivers idle far more at temperature
 * EXTREMES (cab heating/cooling) and little in comfortable weather — so binning idle HOURS by temperature shows
 * a low-idle valley in the middle and high-idle tails. The learned band = the low-idle valley (idle there is
 * behavioral/avoidable → discretionary); outside it, idle is climate-justified. Returns null until there's
 * enough data. This is the data-driven alternative to a fixed 20–85°F guess.
 */
export function learnComfortBand(
  events: { tempF: number; hours: number }[],
  opts: {
    binSizeF?: number;
    minEvents?: number;
    comfortFrac?: number;
    minBandWidthF?: number;
  } = {},
): ComfortBandResult | null {
  const binSize = opts.binSizeF ?? 5;
  const minEvents = opts.minEvents ?? 30;
  const comfortFrac = opts.comfortFrac ?? 0.5;
  const minBandWidth = opts.minBandWidthF ?? 20; // a band narrower than this isn't a trustworthy comfort zone
  const valid = events.filter((e) => Number.isFinite(e.tempF) && e.hours > 0);
  if (valid.length < minEvents) return null;

  const bins = new Map<number, number>();
  for (const e of valid) {
    const b = Math.floor(e.tempF / binSize) * binSize;
    bins.set(b, (bins.get(b) ?? 0) + e.hours);
  }
  const starts = [...bins.keys()].sort((a, b) => a - b);
  if (starts.length < 3) return null;

  const threshold = comfortFrac * Math.max(...bins.values());
  // Comfort center = the lowest-idle bin; expand outward while bins stay in the low-idle valley.
  let center = starts[0]!;
  let minH = Infinity;
  for (const s of starts) {
    const h = bins.get(s)!;
    if (h < minH) {
      minH = h;
      center = s;
    }
  }
  const ci = starts.indexOf(center);
  // Reject a valley sitting on an EDGE bin: a real comfort zone has high-idle tails on BOTH sides. If the
  // minimum-idle bin is the coldest or hottest observed bin, we only saw one tail — not enough to place a band
  // (audit A1.6). Returning null keeps the previous configured band rather than suggesting a lopsided one.
  if (ci === 0 || ci === starts.length - 1) return null;
  let low = center;
  for (let i = ci - 1; i >= 0; i--) {
    if (bins.get(starts[i]!)! <= threshold) low = starts[i]!;
    else break;
  }
  let highStart = center;
  for (let i = ci + 1; i < starts.length; i++) {
    if (bins.get(starts[i]!)! <= threshold) highStart = starts[i]!;
    else break;
  }
  const highF = highStart + binSize;
  // A too-narrow valley (e.g. one 5°F bin) would make almost all idle "discretionary" if adopted — don't
  // suggest it. Require a minimum plausible comfort width.
  if (highF - low < minBandWidth) return null;
  return { lowF: low, highF, samples: valid.length };
}

// ── unit conversions (Samsara → our storage) ────────────────────────────────
export const milliCToF = (mc: number | null | undefined): number | null =>
  mc == null ? null : Math.round(((mc / 1000) * 9) / 5 + 32);
export const mlToGal = (ml: number | null | undefined): number | null =>
  ml == null ? null : Math.round((ml / 3785.411784) * 1000) / 1000;

// ── Samsara /idling/events → normalized event (pure, testable) ──────────────
export interface ParsedIdleEvent {
  eventUuid: string;
  startTime: string;
  durationSec: number;
  /** Samsara vehicle id (asset.id). */
  assetId: string | null;
  /** Samsara driver id (operator.id) — present only when a driver was assigned. */
  operatorId: string | null;
  ptoActive: boolean;
  airTempF: number | null;
  fuelGal: number | null;
  costUsd: number | null;
  lat: number | null;
  lng: number | null;
  geofenceTypes: string[];
}

export function parseIdlingEvents(response: { data?: unknown[] }): ParsedIdleEvent[] {
  const out: ParsedIdleEvent[] = [];
  for (const raw of response.data ?? []) {
    const e = raw as {
      eventUuid?: string;
      startTime?: string;
      durationMilliseconds?: number;
      asset?: { id?: string | number };
      operator?: { id?: string | number };
      ptoState?: string;
      airTemperatureMillicelsius?: number;
      fuelConsumedMilliliters?: number;
      fuelCost?: { amount?: string | number };
      latitude?: number;
      longitude?: number;
      address?: { addressTypes?: string[] };
    };
    if (!e.eventUuid || !e.startTime) continue;
    out.push({
      eventUuid: String(e.eventUuid),
      startTime: e.startTime,
      durationSec: Math.round((e.durationMilliseconds ?? 0) / 1000),
      assetId: e.asset?.id != null ? String(e.asset.id) : null,
      operatorId: e.operator?.id != null ? String(e.operator.id) : null,
      ptoActive: e.ptoState === "active",
      airTempF: milliCToF(e.airTemperatureMillicelsius ?? null),
      fuelGal: mlToGal(e.fuelConsumedMilliliters ?? null),
      costUsd: e.fuelCost?.amount != null ? Number(e.fuelCost.amount) : null,
      lat: e.latitude ?? null,
      lng: e.longitude ?? null,
      geofenceTypes: e.address?.addressTypes ?? [],
    });
  }
  return out;
}

export interface IdleScoreRow {
  driverId: string;
  driverName: string;
  /** The truck (unit number) this driver idled on most in the range; null if unknown. */
  primaryUnit: string | null;
  /** How many distinct trucks the driver's idle spanned (1 for the usual single-truck case). */
  unitCount: number;
  events: number;
  totalIdleHours: number;
  discretionaryHours: number;
  justifiedHours: number;
  productiveHours: number;
  discretionaryGal: number;
  discretionaryCost: number;
  /** Discretionary idle as a share of ALL idle (0–100) — the coaching signal, temperature/PTO-fair. */
  discretionaryPct: number;
  /** Idle events longer than 1 hour (overnight/long waits — where the money is). */
  longIdleCount: number;
  /** 0–100, higher = better (less avoidable idle). */
  score: number;
  /** Discretionary idle hours in the most recent 7-day window (needs startedAt on the rows). */
  recentDiscHours: number;
  /** Discretionary idle hours in the prior 7-day window (8–14 days ago). */
  priorDiscHours: number;
  /** Week-over-week direction: "down" = improving (less waste), "up" = worsening, "flat"/"na" otherwise. */
  trend: "up" | "down" | "flat" | "na";
}

export interface IdleSummary {
  drivers: IdleScoreRow[];
  fleetIdleHours: number;
  fleetDiscretionaryHours: number;
  fleetDiscretionaryCost: number;
  fleetDiscretionaryGal: number;
  events: number;
  /** Discretionary $ that could NOT be attributed to a driver (Samsara had no operator, or the driver isn't in
   *  our records). Surfaced so the "Unattributed" leaderboard row is understood as a data-coverage gap, not a
   *  person to coach (audit A1.5). */
  unattributedDiscretionaryCost: number;
  /** Share (0–100) of discretionary $ attributed to a real driver. 100 when there's no idle $ at all. */
  attributedPct: number;
}

export interface IdleRow {
  driverId: string | null;
  driverName: string | null;
  durationSec: number;
  classification: IdleClassification;
  fuelGal: number | null;
  costUsd: number | null;
  /** Resolved idle gallons (measured, or the CP3 per-truck / temperature estimate) — preferred for the gal total. */
  idleGal?: number | null;
  /** ISO start time — used for the week-over-week trend. Optional (trend is skipped when absent). */
  startedAt?: string;
  /** The truck (unit number) this idle event happened on, for the per-driver primary-truck column. */
  unitNumber?: string | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Fuel gallons for an event: measured value if present, else duration × idle burn rate. */
function galFor(row: IdleRow, o: Required<IdleThresholds>): number {
  if (row.idleGal != null) return row.idleGal;
  if (row.fuelGal != null) return row.fuelGal;
  return (row.durationSec / 3600) * o.idleGalPerHour;
}
function costFor(row: IdleRow, gal: number, o: Required<IdleThresholds>): number {
  return row.costUsd != null ? row.costUsd : gal * o.fuelPricePerGal;
}

/**
 * Aggregate idle events into a per-driver leaderboard + fleet summary. Only DISCRETIONARY idle drives the
 * score and the "wasted $" — productive (PTO) and justified (extreme-temp) idle are tracked but not penalized.
 * Score = 100 at 0% discretionary idle, scaling down as the discretionary share of a driver's idle rises.
 */
export function aggregateDriverIdle(
  rows: IdleRow[],
  opts: IdleThresholds & { nowMs?: number } = {},
): IdleSummary {
  const o = { ...DEFAULTS, ...opts };
  // Week-over-week trend windows, anchored on the latest event (or now) so it works on backfilled data.
  const anchor =
    opts.nowMs ??
    (rows.reduce((mx, r) => (r.startedAt ? Math.max(mx, Date.parse(r.startedAt)) : mx), 0) ||
      Date.now());
  const DAY = 86_400_000;
  const recentFrom = anchor - 7 * DAY;
  const priorFrom = anchor - 14 * DAY;
  const byDriver = new Map<
    string,
    {
      name: string;
      events: number;
      total: number;
      disc: number;
      just: number;
      prod: number;
      discGal: number;
      discCost: number;
      long: number;
      recentDisc: number;
      priorDisc: number;
      units: Map<string, number>;
    }
  >();
  let fleetIdle = 0;
  let fleetDiscHours = 0;
  let fleetDiscGal = 0;
  let fleetDiscCost = 0;
  let unattrDiscCost = 0;
  let events = 0;

  for (const row of rows) {
    if (row.classification === "brief") continue; // not scored
    events += 1;
    const hours = row.durationSec / 3600;
    fleetIdle += hours;
    const key = row.driverId ?? "__unattributed__";
    const name = row.driverName ?? "Unattributed";
    const d = byDriver.get(key) ?? {
      name,
      events: 0,
      total: 0,
      disc: 0,
      just: 0,
      prod: 0,
      discGal: 0,
      discCost: 0,
      long: 0,
      recentDisc: 0,
      priorDisc: 0,
      units: new Map<string, number>(),
    };
    d.events += 1;
    d.total += hours;
    if (row.unitNumber) d.units.set(row.unitNumber, (d.units.get(row.unitNumber) ?? 0) + hours);
    if (row.durationSec >= 3600) d.long += 1;
    if (row.classification === "discretionary") {
      const gal = galFor(row, o);
      const cost = costFor(row, gal, o);
      d.disc += hours;
      d.discGal += gal;
      d.discCost += cost;
      fleetDiscHours += hours;
      fleetDiscGal += gal;
      fleetDiscCost += cost;
      if (row.driverId == null) unattrDiscCost += cost;
      if (row.startedAt) {
        const t = Date.parse(row.startedAt);
        if (t >= recentFrom) d.recentDisc += hours;
        else if (t >= priorFrom) d.priorDisc += hours;
      }
    } else if (row.classification === "justified") d.just += hours;
    else if (row.classification === "productive") d.prod += hours;
    byDriver.set(key, d);
  }

  const drivers: IdleScoreRow[] = [...byDriver.entries()]
    .map(([driverId, d]) => {
      const discretionaryPct = d.total > 0 ? (d.disc / d.total) * 100 : 0;
      // Trend: need meaningful activity in either window; ≥15% swing to avoid noise.
      const both = d.recentDisc + d.priorDisc;
      let trend: IdleScoreRow["trend"] = "na";
      if (both >= 0.5) {
        const delta = d.recentDisc - d.priorDisc;
        const rel = d.priorDisc > 0 ? delta / d.priorDisc : delta > 0 ? 1 : 0;
        trend = rel > 0.15 ? "up" : rel < -0.15 ? "down" : "flat";
      }
      let primaryUnit: string | null = null;
      let unitMax = -1;
      for (const [u, h] of d.units) if (h > unitMax) { unitMax = h; primaryUnit = u; }
      return {
        driverId,
        driverName: d.name,
        primaryUnit,
        unitCount: d.units.size,
        events: d.events,
        totalIdleHours: r1(d.total),
        discretionaryHours: r1(d.disc),
        justifiedHours: r1(d.just),
        productiveHours: r1(d.prod),
        discretionaryGal: r1(d.discGal),
        discretionaryCost: r2(d.discCost),
        discretionaryPct: r1(discretionaryPct),
        longIdleCount: d.long,
        score: Math.max(0, Math.round(100 - discretionaryPct)),
        recentDiscHours: r1(d.recentDisc),
        priorDiscHours: r1(d.priorDisc),
        trend,
      };
    })
    // Worst first: most $ wasted, then most discretionary hours.
    .sort(
      (a, b) =>
        b.discretionaryCost - a.discretionaryCost || b.discretionaryHours - a.discretionaryHours,
    );

  return {
    drivers,
    fleetIdleHours: r1(fleetIdle),
    fleetDiscretionaryHours: r1(fleetDiscHours),
    fleetDiscretionaryGal: r1(fleetDiscGal),
    fleetDiscretionaryCost: r2(fleetDiscCost),
    events,
    unattributedDiscretionaryCost: r2(unattrDiscCost),
    attributedPct:
      fleetDiscCost > 0 ? r1(((fleetDiscCost - unattrDiscCost) / fleetDiscCost) * 100) : 100,
  };
}

// ── Longest avoidable idles (coaching targets) ──────────────────────────────
export interface LongIdleInput {
  driverName: string | null;
  unitNumber: string | null;
  startedAt: string;
  durationSec: number;
  classification: IdleClassification;
  costUsd: number | null;
  fuelGal: number | null;
  /** Resolved idle gallons (measured, or the CP3 per-truck / temperature estimate) — preferred for cost/gallons. */
  idleGal?: number | null;
  /** MANUAL source of truth: is the truck ENGINE-OFF capable at rest (real APU / battery HVAC / shore power)? null = unknown/unset. */
  hasApu: boolean | null;
  /** MANUAL: does the truck have OEM optimized idle (e.g. Cascadia)? The engine cycling is the feature, so these
   *  idles are NOT called avoidable. Distinct from hasApu. null = unknown/unset. */
  hasOptimizedIdle?: boolean | null;
  /** Learned per-truck capability, kept as a cross-check only: 'apu' | 'ecu_optimized' | 'continuous_only' | 'unknown' | null. */
  idleCapability: string | null;
}

export interface LongIdleRow {
  driverName: string;
  unitNumber: string;
  startedAt: string;
  hours: number;
  costUsd: number;
  /** True when the truck is ENGINE-OFF capable (manual has_apu) — the driver could have shut the main engine off
   *  and run the APU. Only true when has_apu is explicitly true; unknown/unset AND optimized-idle are NOT avoidable
   *  (optimized idle runs the engine on purpose, so its idling is the feature working, not driver waste). */
  avoidable: boolean;
  /** Plain-language equipment for the coaching list: 'apu' (engine-off capable → avoidable), 'optimized_idle'
   *  (OEM cycling → the feature, not avoidable), 'none' (no equipment), 'unknown' (not recorded). */
  equipment: "apu" | "optimized_idle" | "none" | "unknown";
  /** Manual APU flag as recorded on the vehicle (source of truth). */
  hasApu: boolean | null;
  /** Learned capability (cross-check/display). */
  idleCapability: string;
}

/**
 * Surface the longest DISCRETIONARY idle events for coaching. These are the single biggest wins: one 10-hour
 * overnight idle on a truck that has an APU is pure waste. `avoidable` is driven by the MANUAL `hasApu` flag —
 * the reliable source of truth, since a diesel APU can't be detected from telematics (audit A1.2). The learned
 * capability is kept only as a secondary cross-check. A truck with has_apu unset (null) is NOT called avoidable,
 * so we never accuse a driver of wasting an APU the truck may not have.
 */
export function topAvoidableIdles(
  rows: LongIdleInput[],
  opts: IdleThresholds & { minHours?: number; limit?: number } = {},
): LongIdleRow[] {
  const o = { ...DEFAULTS, ...opts };
  const minHours = opts.minHours ?? 2;
  const limit = opts.limit ?? 25;
  return (
    rows
      .filter((r) => r.classification === "discretionary" && r.durationSec / 3600 >= minHours)
      .map((r) => {
        const hours = r.durationSec / 3600;
        const gal = r.idleGal != null ? r.idleGal : r.fuelGal != null ? r.fuelGal : hours * o.idleGalPerHour;
        const cost = r.costUsd != null ? r.costUsd : gal * o.fuelPricePerGal;
        return {
          driverName: r.driverName ?? "Unattributed",
          unitNumber: r.unitNumber ?? "—",
          startedAt: r.startedAt,
          hours: r1(hours),
          costUsd: r2(cost),
          avoidable: r.hasApu === true,
          // Equipment label for the coaching list. APU first (engine-off capable → avoidable); then optimized idle
          // (OEM cycling, never avoidable); then an explicit "none"; else unrecorded.
          equipment: (r.hasApu === true
            ? "apu"
            : r.hasOptimizedIdle === true
              ? "optimized_idle"
              : r.hasApu === false
                ? "none"
                : "unknown") as LongIdleRow["equipment"],
          hasApu: r.hasApu,
          idleCapability: r.idleCapability ?? "unknown",
        };
      })
      // Avoidable first (had the equipment), then longest.
      .sort((a, b) => Number(b.avoidable) - Number(a.avoidable) || b.hours - a.hours)
      .slice(0, limit)
  );
}
