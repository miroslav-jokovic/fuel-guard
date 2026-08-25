/**
 * Why the fuel bill moved — the OPERATING bridge (pure, dataset-free).
 *
 * `varianceBridge` in this same folder answers the procurement half of the question: of a change in
 * spend, how much was the market, and how much was buying the same gallons in worse places. It cannot
 * answer the other half, because a vendor statement does not know how far the trucks went. This module
 * takes the daily rollup (`fuel_spend_days`, migration 0244) and answers that half:
 *
 *     Δspend  =  price effect  +  volume effect
 *     volume  =  more miles  +  worse (or better) MPG  +  gallons whose miles we cannot measure
 *     miles   =  more trucks  +  more miles per truck
 *
 * Every split is an IDENTITY, not an estimate — each returns its residual so a chart can assert it
 * rather than trust it. On the real 2026-08-10 → 2026-08-17 pair the first split reproduces the
 * $41,251 change to the dollar.
 *
 * ── WHY MILES ARE SCALED TO THE MEASURED MPG ─────────────────────────────────────────────────────
 * Fleet MPG is Σ`milesMeasured` ÷ Σ`mpgGallons`, never ÷ Σ`gallonsTractor` (migration 0244, D-FS3): an
 * odometer interval that failed its plausibility gate loses its miles but keeps its gallons, because
 * the fuel was still bought. That leaves the two bases different, and the first draft of this module
 * carried the difference as a third "unmeasured gallons" term.
 *
 * That was exact and useless. Measured coverage on the real 2026-08-10 → 08-17 pair moved 92.2% → 97.5%,
 * and a five-point coverage drift alone produced a −$13,400 bar. Nothing about the fuel bill changed by
 * $13,400; our ability to MEASURE it did. A boss reading that bar learns nothing and mistrusts the rest.
 *
 * So `miles` on a period is the measured miles scaled up by the measured share — the distance those
 * gallons imply at the MPG we actually observed. `milesMeasured` keeps the provable figure beside it and
 * `measuredShare` says how much is extrapolation. The assumption is explicit and mild: gallons we could
 * not pair with an odometer interval were burned at the same MPG as the ones we could. It buys an exact
 * two-term identity on TOTAL gallons — gal = miles ÷ MPG holds by construction — and it means the miles
 * figure the report divides cost by is an estimate of miles actually driven rather than of miles we
 * happened to be able to prove. When coverage is too thin for that assumption to carry, the split is
 * withheld rather than extrapolated (`MIN_MEASURED_SHARE`).
 *
 * ── WHY MPG IS GATED ─────────────────────────────────────────────────────────────────────────────
 * Weekly fleet MPG over 2026-06 reads 85.7, 55.4, 35.8, then 6.94. Only the last is real; the rest is
 * odometer contamination that survived into `miles_since_last`. A bridge that consumed those numbers
 * would report a spectacular efficiency collapse that never happened, and it would be believed. When a
 * period's MPG falls outside what a Class-8 can physically do, the split is withheld with a reason
 * instead of published with a caveat nobody reads.
 */

/** Physically possible fleet MPG for a Class-8 tractor. Outside this, the odometer is wrong, not the truck. */
export const PLAUSIBLE_FLEET_MPG = { low: 3, high: 12 } as const;

/**
 * How much of a period's fuel must be paired with usable mileage before miles are scaled to cover the
 * rest. Below this the extrapolation is carrying more of the answer than the measurement is, and the
 * miles/efficiency split is withheld instead.
 */
export const MIN_MEASURED_SHARE = 0.6;

/** One truck-day from the rollup. A `null` vehicle is the day's unattributed fuel, kept so totals tie. */
export interface SpendDay {
  day: string; // YYYY-MM-DD
  vehicleId: string | null;
  fills: number;
  gallonsTractor: number;
  gallonsReefer: number;
  gallonsDef: number;
  spendTractor: number;
  spendReefer: number;
  spendDef: number;
  /** Miles allocated to this day, already plausibility-gated upstream. */
  miles: number;
  /** The gallons those miles belong to — the ONLY denominator MPG may use. */
  mpgGallons: number;
  milesRejected: number;
  driveSec: number;
  idleSec: number;
  offSec: number;
  coverageSec: number;
}

export interface SpendPeriod {
  from: string;
  to: string;
  days: number;
  fills: number;
  /** Tractor propulsion fuel — the basis of every $/gal and MPG figure here. */
  gallons: number;
  spend: number;
  gallonsReefer: number;
  spendReefer: number;
  gallonsDef: number;
  spendDef: number;
  /** Everything on the fuel bill this rollup covers. Reefer and DEF are fuel; they are not tractor fuel. */
  totalSpend: number;
  /** Miles the period's gallons imply at the measured MPG — the estimate of distance actually driven. */
  miles: number;
  /** Miles we can prove from gated odometer intervals. `miles` scales this up by `measuredShare`. */
  milesMeasured: number;
  /** Gallons paired with trustworthy miles — the ONLY denominator MPG may use. */
  mpgGallons: number;
  milesRejected: number;
  /** Trucks that fuelled or drove. A truck parked all period is not diluting miles-per-truck. */
  activeTrucks: number;
  driveSec: number;
  idleSec: number;
  coverageSec: number;
  // ── derived; null rather than 0, because 0 reads as "free" or "stationary" ──
  pricePerGal: number | null;
  mpg: number | null;
  costPerMile: number | null;
  milesPerTruck: number | null;
  /** Idle seconds as a share of engine-on (idle + drive) time. */
  idleShare: number | null;
  /** Share of tractor gallons whose miles are measurable — how much of `miles` is proven, not implied. */
  measuredShare: number | null;
  /** False when MPG is missing, physically impossible, or too thinly measured to scale. */
  mpgUsable: boolean;
}

// `Math.round(-0.001 * 100) / 100` is -0, which prints as "-0" and fails an === 0 check. A bridge term
// that is exactly nothing must read as nothing.
const unsign = (n: number) => (n === 0 ? 0 : n);
const r2 = (n: number) => unsign(Math.round(n * 100) / 100);
const r3 = (n: number) => unsign(Math.round(n * 1000) / 1000);

/**
 * How far a decomposition may miss the total it explains before it stops claiming to tie out.
 *
 * The residual is computed BEFORE the terms are rounded for display, so it measures the identity rather
 * than the rounding: a correct split lands within float noise of zero, and a broken one misses by
 * dollars. Rounding each displayed bar to the cent can still leave the drawn bars a cent or two from the
 * drawn total — that is arithmetic and beneath any figure this report shows — but folding it into the
 * residual would mean the one number that is supposed to catch a broken bridge could no longer be
 * asserted exactly.
 */
export const BRIDGE_TIE_TOLERANCE = 0.005;
const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/** Aggregate truck-days into one period. Empty input yields a zeroed period, never a throw. */
export function periodTotals(days: readonly SpendDay[], from: string, to: string): SpendPeriod {
  const trucks = new Set<string>();
  const dates = new Set<string>();
  let fills = 0, gallonsRaw = 0, spendRaw = 0, gReefer = 0, sReeferRaw = 0, gDef = 0, sDefRaw = 0;
  let milesRaw = 0, mpgGallonsRaw = 0, rejected = 0, driveSec = 0, idleSec = 0, coverageSec = 0;

  for (const d of days) {
    dates.add(d.day);
    // A truck counts as ACTIVE on a day it fuelled or drove — not on a day it merely had an engine-day
    // row. The rollup emits a row for every truck the telematics feed covers, including ones parked all
    // week, and counting those dilutes miles-per-truck and turns the fleet-size term of the bridge into
    // coverage noise: on real 2026-08 data the naive count moved 172 → 166 while the working fleet grew.
    if (d.vehicleId && (d.fills > 0 || d.driveSec > 0)) trucks.add(d.vehicleId);
    fills += d.fills;
    gallonsRaw += d.gallonsTractor;
    spendRaw += d.spendTractor;
    gReefer += d.gallonsReefer;
    sReeferRaw += d.spendReefer;
    gDef += d.gallonsDef;
    sDefRaw += d.spendDef;
    milesRaw += d.miles;
    mpgGallonsRaw += d.mpgGallons;
    rejected += d.milesRejected;
    driveSec += d.driveSec;
    idleSec += d.idleSec;
    coverageSec += d.coverageSec;
  }

  // Derive every ratio from the values this object will actually EXPOSE, not from the raw sums behind
  // them. A bridge built on `pricePerGal` and `spend` has to see one consistent pair, or the identity it
  // asserts is off by the difference between them — which is small, invisible, and exactly the kind of
  // thing that makes a residual check unassertable.
  const gallons = r3(gallonsRaw);
  const spend = r2(spendRaw);
  const sReefer = r2(sReeferRaw);
  const sDef = r2(sDefRaw);
  const milesMeasured = r2(milesRaw);
  const mpgGallons = r3(mpgGallonsRaw);

  const mpg = ratio(milesMeasured, mpgGallons);
  const measuredShare = ratio(mpgGallons, gallons);
  const mpgUsable =
    mpg != null &&
    mpg >= PLAUSIBLE_FLEET_MPG.low &&
    mpg <= PLAUSIBLE_FLEET_MPG.high &&
    measuredShare != null &&
    measuredShare >= MIN_MEASURED_SHARE;
  // gal = miles ÷ MPG by construction, which is what makes the volume split an identity on TOTAL
  // gallons rather than on the measured subset. See the header.
  const impliedMiles = mpg != null ? gallons * mpg : milesMeasured;
  const totalSpend = r2(spend + sReefer + sDef);
  return {
    from,
    to,
    days: dates.size,
    fills,
    gallons,
    spend,
    gallonsReefer: r3(gReefer),
    spendReefer: sReefer,
    gallonsDef: r3(gDef),
    spendDef: sDef,
    totalSpend,
    miles: r2(impliedMiles),
    milesMeasured,
    mpgGallons,
    milesRejected: rejected,
    activeTrucks: trucks.size,
    driveSec,
    idleSec,
    coverageSec,
    pricePerGal: ratio(spend, gallons),
    mpg,
    // Cost per mile deliberately uses TOTAL spend against IMPLIED miles: a boss asking what a mile costs
    // is not asking about tractor diesel alone (reefer and DEF are on the same invoice), and dividing by
    // only the miles we could prove would overstate the cost of every mile by the coverage gap.
    costPerMile: ratio(totalSpend, impliedMiles),
    milesPerTruck: trucks.size > 0 ? impliedMiles / trucks.size : null,
    idleShare: ratio(idleSec, idleSec + driveSec),
    measuredShare,
    mpgUsable,
  };
}

/** One signed term of a bridge, in dollars, with the physical change behind it. */
export interface BridgeTerm {
  key: string;
  label: string;
  /** Dollars. Positive means it pushed spend UP. */
  dollars: number;
  /** The underlying movement — gallons, miles, $/gal, MPG, trucks — for the tooltip beneath the bar. */
  detail: string;
}

export interface MilesSplit {
  /** Δmiles attributable to running more (or fewer) trucks. */
  trucks: number;
  /** Δmiles attributable to each truck covering more (or fewer) miles. */
  perTruck: number;
  residual: number;
}

export interface VolumeSplit {
  /** Dollars explained by driving further, holding MPG and price at the prior period's. */
  miles: number;
  /** Dollars explained by MPG moving. Negative means efficiency improved and saved money. */
  efficiency: number;
  residual: number;
  /** True when miles + efficiency reach the volume term within `BRIDGE_TIE_TOLERANCE`. */
  tiesOut: boolean;
  /** Δmiles, itself split into more trucks vs each truck covering more ground. */
  milesFrom: MilesSplit;
  /** Share of current-period gallons whose miles are proven rather than implied. */
  measuredShare: number | null;
}

export interface OperatingBridge {
  prior: SpendPeriod;
  current: SpendPeriod;
  /** current.spend − prior.spend, tractor fuel only. */
  deltaSpend: number;
  /** Δgallons × prior $/gal. */
  volume: number;
  /** Δ$/gal × current gallons. */
  price: number;
  /** volume + price − deltaSpend, from the ROUNDED terms — what the drawn bars actually miss by. */
  residual: number;
  /** True when the bars sum to the total within `BRIDGE_TIE_TOLERANCE`. A false here is a real defect. */
  tiesOut: boolean;
  /** Null when either period cannot support an MPG figure; `withheld` says which. */
  volumeSplit: VolumeSplit | null;
  withheld: string | null;
  terms: BridgeTerm[];
}

const usd = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const signed = (n: number, unit: string, dp = 0) =>
  `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: dp })}${unit}`;

/**
 * Decompose the change in tractor-fuel spend between two periods.
 *
 * First split is Laspeyres on volume and Paasche on price — Δgal at the OLD price plus Δprice on the
 * NEW gallons — which is exact by construction and puts the interaction term with price, where a
 * rising market belongs. The alternative convention hides a rising market inside the volume bar.
 */
export function operatingBridge(prior: SpendPeriod, current: SpendPeriod): OperatingBridge {
  const deltaSpend = r2(current.spend - prior.spend);
  const price0 = prior.pricePerGal;
  const price1 = current.pricePerGal;

  // Raw first, rounded second: the residual has to see the arithmetic, not the presentation.
  const volumeRaw = price0 == null ? 0 : (current.gallons - prior.gallons) * price0;
  const priceRaw = price0 == null || price1 == null ? 0 : (price1 - price0) * current.gallons;
  const volume = r2(volumeRaw);
  const priceTerm = r2(priceRaw);
  const residual = volumeRaw + priceRaw - (current.spend - prior.spend);

  const { split, withheld } = volumeSplitOf(prior, current, price0);

  const terms: BridgeTerm[] = [
    {
      key: "price",
      label: "Pump price",
      dollars: priceTerm,
      detail:
        price0 != null && price1 != null
          ? `${signed(price1 - price0, "/gal", 4)} on ${current.gallons.toLocaleString("en-US", { maximumFractionDigits: 0 })} gal`
          : "no price basis",
    },
  ];
  if (split) {
    terms.push(
      {
        key: "miles",
        label: "Miles driven",
        dollars: split.miles,
        detail: `${signed(current.miles - prior.miles, " mi")} at ${prior.mpg?.toFixed(2)} MPG`,
      },
      {
        key: "efficiency",
        label: "Fuel efficiency",
        dollars: split.efficiency,
        detail: `${signed((current.mpg ?? 0) - (prior.mpg ?? 0), " MPG", 2)} — ${split.efficiency <= 0 ? "saved" : "cost"} ${usd(split.efficiency)}`,
      },
    );
  } else {
    terms.push({ key: "volume", label: "Gallons bought", dollars: volume, detail: signed(current.gallons - prior.gallons, " gal") });
  }

  return {
    prior,
    current,
    deltaSpend,
    volume,
    price: priceTerm,
    residual: r2(residual),
    tiesOut: Math.abs(residual) <= BRIDGE_TIE_TOLERANCE,
    volumeSplit: split,
    withheld,
    terms,
  };
}

/**
 * Split the volume term into distance and efficiency.
 *
 * `miles` is already scaled so that gal = miles ÷ MPG holds on TOTAL gallons (see the header), which
 * makes this exact:
 *   Δgal_miles      = Δmiles ÷ MPG₀
 *   Δgal_efficiency = miles₁ ÷ MPG₁ − miles₁ ÷ MPG₀
 * summing to miles₁÷MPG₁ − miles₀÷MPG₀ = Δgallons, with no third term to explain away.
 */
function volumeSplitOf(
  prior: SpendPeriod,
  current: SpendPeriod,
  price0: number | null,
): { split: VolumeSplit | null; withheld: string | null } {
  if (price0 == null) return { split: null, withheld: "No prior-period price to value the change at." };
  if (prior.mpg == null || current.mpg == null) {
    return { split: null, withheld: "No usable odometer mileage in one of the periods." };
  }
  if (!prior.mpgUsable || !current.mpgUsable) {
    const bad = !prior.mpgUsable ? prior : current;
    const thin = bad.measuredShare != null && bad.measuredShare < MIN_MEASURED_SHARE;
    return {
      split: null,
      withheld: thin
        ? `Only ${Math.round((bad.measuredShare ?? 0) * 100)}% of the fuel for ${bad.from} → ${bad.to} could be paired with usable odometer mileage, so miles and efficiency would be mostly extrapolation. Withheld until odometer coverage improves.`
        : `Fleet MPG of ${bad.mpg?.toFixed(1)} for ${bad.from} → ${bad.to} is outside what a tractor can do, so the odometer is wrong rather than the fuel. Miles and efficiency are withheld until it is fixed.`,
    };
  }

  // gal = miles ÷ MPG, so Δgal splits exactly into the miles term at the OLD efficiency plus what the
  // change in efficiency did to the NEW distance. The two reconstruct Δgallons with no residual.
  //
  // Distance is taken as gallons × MPG rather than from the rounded `miles` field on purpose: `miles` is
  // that product rounded to two places, and dividing a rounded product back out leaves a residual that
  // is tiny, real, and impossible to assert away. Reading it from the two stored quantities the identity
  // is actually defined over keeps the split exact.
  const miles0 = prior.gallons * prior.mpg;
  const miles1 = current.gallons * current.mpg;
  const dGalMiles = (miles1 - miles0) / prior.mpg;
  const dGalEff = miles1 / current.mpg - miles1 / prior.mpg;

  const milesRaw = dGalMiles * price0;
  const effRaw = dGalEff * price0;
  const residual = milesRaw + effRaw - (current.gallons - prior.gallons) * price0;
  const split: VolumeSplit = {
    miles: r2(milesRaw),
    efficiency: r2(effRaw),
    residual: r2(residual),
    tiesOut: Math.abs(residual) <= BRIDGE_TIE_TOLERANCE,
    milesFrom: milesSplit(prior, current),
    measuredShare: current.measuredShare,
  };
  return { split, withheld: null };
}

/** Δmiles = more trucks (at the old miles per truck) + each truck covering more ground. Exact. */
function milesSplit(prior: SpendPeriod, current: SpendPeriod): MilesSplit {
  const mpt0 = prior.milesPerTruck;
  const mpt1 = current.milesPerTruck;
  if (mpt0 == null || mpt1 == null) return { trucks: 0, perTruck: r2(current.miles - prior.miles), residual: 0 };
  const trucksRaw = (current.activeTrucks - prior.activeTrucks) * mpt0;
  const perTruckRaw = current.activeTrucks * (mpt1 - mpt0);
  return {
    trucks: r2(trucksRaw),
    perTruck: r2(perTruckRaw),
    residual: r2(trucksRaw + perTruckRaw - (current.miles - prior.miles)),
  };
}

// ── periods ─────────────────────────────────────────────────────────────────────────────────────
export type SpendGrain = "day" | "week" | "month";

const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The period a business date belongs to, as [start, end] inclusive.
 *
 * Weeks start Monday to match how the fleet's vendors bill and how the carrier already talks about a
 * "week"; a Sunday-start series would silently disagree with every statement on the desk.
 */
export function periodBounds(ymd: string, grain: SpendGrain): { from: string; to: string } {
  if (grain === "day") return { from: ymd, to: ymd };
  if (grain === "month") {
    const from = `${ymd.slice(0, 7)}-01`;
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return { from, to: addDays(d.toISOString().slice(0, 10), -1) };
  }
  const d = new Date(`${ymd}T00:00:00Z`);
  const from = addDays(ymd, -((d.getUTCDay() + 6) % 7)); // Monday-start
  return { from, to: addDays(from, 6) };
}

/**
 * Bucket truck-days into periods, oldest first. Periods with no fuel at all are omitted rather than
 * emitted as zeroes — a gap in the data is not a week the fleet bought nothing, and a zero bar would
 * claim it was.
 */
export function spendSeries(days: readonly SpendDay[], grain: SpendGrain): SpendPeriod[] {
  const buckets = new Map<string, { from: string; to: string; rows: SpendDay[] }>();
  for (const d of days) {
    if (!d.day) continue;
    const b = periodBounds(d.day, grain);
    const existing = buckets.get(b.from);
    if (existing) existing.rows.push(d);
    else buckets.set(b.from, { ...b, rows: [d] });
  }
  return [...buckets.values()]
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
    .map((b) => periodTotals(b.rows, b.from, b.to));
}

/**
 * The two periods a "this vs last" comparison should use: the most recent COMPLETE period and the one
 * before it.
 *
 * The newest bucket is normally still filling — comparing a two-day week against a finished one is the
 * single easiest way to publish a fake 60% drop in spend — so it is excluded unless `includePartial`
 * says the caller knows what it is asking for.
 */
export function comparablePeriods(
  series: readonly SpendPeriod[],
  today: string,
  includePartial = false,
): { prior: SpendPeriod; current: SpendPeriod } | null {
  const usable = includePartial ? [...series] : series.filter((p) => p.to < today);
  if (usable.length < 2) return null;
  return { prior: usable[usable.length - 2]!, current: usable[usable.length - 1]! };
}
