/**
 * The vehicle-stats DELTA FEED — parsing, and the fuel-level drops only a delta feed can see.
 *
 * ── WHY THIS IS NOT THE SNAPSHOT PARSER ────────────────────────────────────────────────────────
 * `parseVehicleStatsOdometer` / `parseVehicleFuelPercents` read `GET /fleet/vehicles/stats`, where each
 * stat is a SINGULAR object: `fuelPercents: { time, value }`. The feed
 * (`GET /fleet/vehicles/stats/feed`) returns the same field names as ARRAYS of samples — every change
 * since the caller's cursor, not the current value. Measured against the live API 2026-09-01: 192 of
 * 192 vehicles came back with `fuelPercents` as an array. Pointing the old parsers at the feed reads
 * `.value` off an Array and yields `undefined` for every truck, silently, which is why the shapes get
 * separate functions rather than one defensive one.
 *
 * ── WHY A DROP IS WORTH ITS OWN FUNCTION ───────────────────────────────────────────────────────
 * A snapshot poll shows where a value IS, never where it WAS: a truck that loses 40 gallons at 10:07
 * and is refilled by 10:19 is identical, at 10:00 and 10:20, to a truck nothing happened to
 * (SAMSARA-COLLECTION-PLAN §0.2). The delta feed is the first mechanism in this product that can see
 * that event at all. `fuel_events` has carried `fuel_pct_before` / `fuel_pct_after` since migration
 * 0021 and nothing has ever written them — the webhook, the only producer, populates neither, and has
 * received zero deliveries besides (§0.5 check 2). This is the function that finally fills them
 * (Q-SAM5, answered (a) on 2026-09-01).
 */

/** One tank-level reading from the feed. `percent` is 0–100 as Samsara reports it. */
export interface FuelLevelSample {
  time: string;
  percent: number;
}

/** A contiguous descent in tank level, converted to gallons against the truck's resolved capacity. */
export interface FuelLevelDrop {
  /** Time of the last reading BEFORE the descent — the level it fell from. */
  startedAt: string;
  /** Time of the reading the descent bottomed out at. */
  endedAt: string;
  pctBefore: number;
  pctAfter: number;
  /** Percentage POINTS lost, not a ratio. */
  dropPct: number;
  /** `dropPct` against the resolved capacity. The figure an operator actually reacts to. */
  gallons: number;
}

/**
 * The longest gap between two readings that can still be one EVENT rather than a shift's driving.
 *
 * This is the number that stands in for a fuel-burn model, and it is stated rather than tuned — the
 * honest version of a threshold nobody has evidence for yet. The reasoning it has to survive: over 30
 * minutes a class-8 tractor at highway speed covers ~30 miles and burns ~5 gallons at a 6 mpg
 * baseline, so the gallons floor below (15) sits at about 3x the largest consumption this window can
 * legitimately contain. Widen the window and that headroom disappears — at two hours, ordinary driving
 * burns ~20 gallons and every truck on the road files a theft event.
 *
 * SAM-S6 re-scores with real data behind it and is the step allowed to change this. Until then, a
 * value that is defensible from arithmetic beats one that looks tuned and is not.
 */
export const FUEL_DROP_MAX_GAP_MINUTES = 30;

export interface FuelDropOptions {
  /** From `resolveCapacity(vehicle).gallons` — never the raw entered figure (101 of 145 disagree). */
  capacityGal: number;
  /** Smallest loss worth filing. Defaults to the per-fill sensor floor the tank rules already use. */
  minGallons: number;
  maxGapMinutes?: number;
}

const isPct = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;

/** Ascending by time, with unusable readings dropped rather than coerced. */
export function normalizeFuelSamples(samples: readonly FuelLevelSample[]): FuelLevelSample[] {
  return samples
    .filter((s) => isPct(s.percent) && typeof s.time === "string" && Number.isFinite(Date.parse(s.time)))
    .slice()
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

/**
 * Every contiguous descent in a truck's tank level that clears the gallons floor.
 *
 * ── ONE ROW PER DESCENT, NOT PER SAMPLE ────────────────────────────────────────────────────────
 * A siphon observed as 92 → 78 → 61 is ONE event seen three times, not three events. Filing a row per
 * adjacent pair would triple-count it and put three partial magnitudes in front of an operator instead
 * of the one number that happened. So adjacent non-increasing readings accumulate while the gap stays
 * inside the window, and the run is judged once, on its total.
 *
 * The converse is what makes S2's Done-when true: two SEPARATE descents between two polls — separated
 * by a refill, a plateau, or a gap wider than the window — are two distinct events and produce two
 * rows. That is the case a snapshot poll structurally cannot represent, because `vehicles`
 * .`samsara_fuel_percent` holds one number and the second descent overwrites the first.
 */
export function findFuelLevelDrops(
  samples: readonly FuelLevelSample[],
  opts: FuelDropOptions,
): FuelLevelDrop[] {
  const cap = opts.capacityGal;
  // No usable capacity → the level is a percentage of an unknown volume, and "12% of we-don't-know" is
  // not a finding. The volume rules take the same position (resolveCapacity returns 0 → rules stay off).
  if (!Number.isFinite(cap) || cap <= 0) return [];
  const maxGapMs = (opts.maxGapMinutes ?? FUEL_DROP_MAX_GAP_MINUTES) * 60_000;

  const ordered = normalizeFuelSamples(samples);
  const drops: FuelLevelDrop[] = [];
  let runStart: FuelLevelSample | null = null;
  let runEnd: FuelLevelSample | null = null;

  const close = () => {
    if (!runStart || !runEnd) return;
    const dropPct = runStart.percent - runEnd.percent;
    const gallons = (dropPct / 100) * cap;
    if (gallons >= opts.minGallons) {
      drops.push({
        startedAt: runStart.time,
        endedAt: runEnd.time,
        pctBefore: round1(runStart.percent),
        pctAfter: round1(runEnd.percent),
        dropPct: round1(dropPct),
        gallons: round1(gallons),
      });
    }
    runStart = null;
    runEnd = null;
  };

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!;
    const cur = ordered[i]!;
    const gap = Date.parse(cur.time) - Date.parse(prev.time);
    const falling = cur.percent < prev.percent;
    // A gap wider than the window breaks the run even when the level is still falling: beyond it the
    // decrease is a shift's driving, and attributing consumption to an event is how a detector earns
    // the reputation the 2.9%-precision queue already has (FUEL-SECTION-CONSOLIDATION-PLAN §0.3a).
    if (!falling || gap > maxGapMs) {
      close();
      continue;
    }
    if (!runStart) runStart = prev;
    runEnd = cur;
  }
  close();
  return drops;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ── Feed page parsing ───────────────────────────────────────────────────────────────────────────

/** One vehicle's entry in a feed page. Every stat is an array; absent stats are absent, not empty. */
interface RawFeedVehicle {
  id?: string | number;
  fuelPercents?: unknown;
  obdOdometerMeters?: unknown;
  gpsOdometerMeters?: unknown;
}

export interface StatsFeedPage {
  data?: unknown;
  pagination?: { endCursor?: string; hasNextPage?: boolean };
}

/** What one vehicle contributed across every page of a run. */
export interface VehicleFeedSeries {
  fuel: FuelLevelSample[];
  /** Odometer readings in MILES, ascending, OBD preferred over GPS at equal time. */
  odometer: { time: string; miles: number; source: "obd" | "gps" }[];
}

const METERS_PER_MILE = 1609.344;

function readSamples(raw: unknown): { time: string; value: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { time: string; value: number }[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const { time, value } = s as { time?: unknown; value?: unknown };
    if (typeof time !== "string" || typeof value !== "number" || !Number.isFinite(value)) continue;
    out.push({ time, value });
  }
  return out;
}

/**
 * Merge one feed page into an accumulator keyed by Samsara vehicle id.
 *
 * Accumulating ACROSS pages rather than judging each page alone is not an optimisation. Measured on
 * the live feed 2026-09-01: a seed walk returned 396 samples on page 1 and then eleven pages of one to
 * ten samples each. A descent that straddles a page boundary is one event, and judging pages
 * independently would either split it in two or lose the half that never cleared the floor alone.
 */
export function accumulateStatsFeedPage(
  page: StatsFeedPage,
  into: Map<string, VehicleFeedSeries>,
): Map<string, VehicleFeedSeries> {
  const rows = Array.isArray(page.data) ? (page.data as RawFeedVehicle[]) : [];
  for (const v of rows) {
    if (v?.id == null) continue;
    const key = String(v.id);
    let series = into.get(key);
    if (!series) {
      series = { fuel: [], odometer: [] };
      into.set(key, series);
    }
    for (const s of readSamples(v.fuelPercents)) {
      if (isPct(s.value)) series.fuel.push({ time: s.time, percent: s.value });
    }
    // Same precedence the snapshot parser uses: OBD is dash-accurate, GPS is the fallback for trucks
    // with no ECU coverage. Both are kept and resolved at read time rather than here, so a page that
    // carries only GPS cannot evict an OBD reading accumulated from an earlier page.
    for (const s of readSamples(v.obdOdometerMeters))
      series.odometer.push({ time: s.time, miles: s.value / METERS_PER_MILE, source: "obd" });
    for (const s of readSamples(v.gpsOdometerMeters))
      series.odometer.push({ time: s.time, miles: s.value / METERS_PER_MILE, source: "gps" });
  }
  return into;
}

/** The reading a truck's `current_odometer` should carry: newest wins, OBD breaking a time tie. */
export function latestOdometerMiles(series: VehicleFeedSeries): number | null {
  let best: { t: number; miles: number; source: "obd" | "gps" } | null = null;
  for (const o of series.odometer) {
    const t = Date.parse(o.time);
    if (!Number.isFinite(t)) continue;
    if (!best || t > best.t || (t === best.t && o.source === "obd" && best.source === "gps")) {
      best = { t, miles: o.miles, source: o.source };
    }
  }
  return best ? Math.round(best.miles) : null;
}

/** The truck's latest tank level, for the current-value columns on `vehicles`. */
export function latestFuelLevel(series: VehicleFeedSeries): FuelLevelSample | null {
  const ordered = normalizeFuelSamples(series.fuel);
  return ordered.length ? ordered[ordered.length - 1]! : null;
}

/**
 * Whether a page walk should ask for another page.
 *
 * ⚠ **`hasNextPage` is ALWAYS true on this feed and must never be the loop condition.** The plan's
 * §0.5 check 3 recorded `hasNextPage: false`; that does not reproduce. Measured 2026-09-01, walking
 * the live feed twelve pages deep: it was `true` on every single one, including pages carrying a
 * single sample, and including an immediate re-poll. On a delta feed the flag means "this stream
 * continues", not "there is more data right now" — a `while (hasNextPage)` walk, which is the shape
 * the plan's Build bullet implies, would never terminate.
 *
 * A page with no vehicles in it is the real end of the available delta.
 */
export function feedPageHasData(page: StatsFeedPage): boolean {
  return Array.isArray(page.data) && page.data.length > 0;
}
