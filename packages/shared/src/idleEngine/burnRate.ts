/**
 * What an idling engine burns, learned from the fleet's own engines (IE4, D-IE5 of
 * FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md). Pure: the measurement comes from `idle_engine_burn_hours`
 * (0419) — per truck and ambient band, whole idle hours whose neighbours hold no driving, and the
 * engine counter's millilitres over them — and every judgement about it is made here.
 *
 * ── WHY INTERIOR HOURS, NOT PARKS (Q-IE14 research, 2026-10-03) ──────────────────────────────────
 * The counter reads every 6–12 min while running and is spread over running time, so the reading pair
 * that straddles an arrival or a departure books driving fuel into the park beside it: over 1,603 parks,
 * fuel = 0.666 gal/h × hours + ~350 mL per park (R² 0.93). 0409's per-park sums therefore read short
 * parks — and the battery-APU trucks, whose engine runs are short — high (0.749 pooled against a 0.546
 * slope). Interior hours measure 0.658 on no-APU trucks, the slope 0.666: the method agrees with itself.
 *
 * ── WHEN A CELL IS BELIEVED: TRUCKS, NOT HOURS ──────────────────────────────────────────────────
 * D-IE5 believed a cell at 50 running hours. Hours are the wrong unit: trucks in one cell differ (on the
 * per-park method 0.36–3.8 gal/h), so a cell of 180 hours from ten trucks was still ±19% at 95%. A cell
 * is LEARNED when it holds at least `IDLE_BURN_MIN_TRUCKS` trucks and the 95% interval of its rate,
 * clustered by truck (the ratio estimator's sandwich variance over per-truck rows), is within
 * `IDLE_BURN_MAX_CI95` of the rate. A rate is gallons over hours summed across the cell, never a mean
 * of per-truck rates, so a truck counts by its hours.
 *
 * ── WHAT AN UNLEARNED CELL READS ────────────────────────────────────────────────────────────────
 * The nearest level that passes the same bar: the cohort (that equipment, every band), else the fleet,
 * else the prior. Each cell says which (`source`). The prior, 0.72 gal/h, is Samsara's per-event idle
 * fuel on our fleet in September (§1.4) and is reached only when the whole fleet has under five trucks
 * with interior hours — a new tenant's first days.
 *
 * ── WHY EQUIPMENT × TEMPERATURE ───────────────────────────────────────────────────────────────────
 * Temperature because a cab held at 70 °F in 95 °F air runs the A/C compressor off the engine and in
 * 35 °F air the heater core and a higher idle (§1.4: 0.806 gal/h at 32–50 °F against 0.705 at
 * 75–90 °F). Equipment because the cohorts are different trucks — battery APU is mostly the
 * 2025–2027 International LT625s and the 2027 Freightliners, no APU mostly the 2020–2025 Cascadias
 * (§1.6) — so engine and accessories differ with the declaration, and D-IE5 names the cohort as its
 * grain. An hour with no ambient reading is in no band: it counts in its cohort's and the fleet's
 * totals, and its cell is never learned on its own.
 */
import { DECLARED_EQUIPMENT, type DeclaredEquipment } from "../idleEquipmentDeclared.js";

/** D-IE5's prior, gal per running hour (§1.4); the last fall-back, see the header. */
export const IDLE_BURN_PRIOR_GAL_PER_HOUR = 0.72;
/** A level (cell, cohort, fleet) is believed with at least this many trucks… */
export const IDLE_BURN_MIN_TRUCKS = 5;
/** …and a 95% interval, clustered by truck, within this share of its rate. */
export const IDLE_BURN_MAX_CI95 = 0.1;
/**
 * How far back the learner reads. Sixty days, so a season's turn moves a band's rate within two
 * months; it is also `idle_engine_hours`' retention (0404, Q-IE8), so nothing older exists to read.
 */
export const IDLE_BURN_LEARN_DAYS = 60;
/** Band edges in °F, ascending: below 32 · 32–50 · 50–75 · 75–90 · 90 and above (§1.4). */
export const IDLE_BURN_BAND_EDGES_F = [32, 50, 75, 90] as const;
/**
 * The same edges in the engine's unit, milli-°C, as 0409 takes them. Rounded to the whole
 * milli-degree the sensor reports, so a reading lands in the band its own integer says.
 */
export const IDLE_BURN_BAND_EDGES_MILLI_C: readonly number[] = IDLE_BURN_BAND_EDGES_F.map((f) =>
  Math.round(((f - 32) / 1.8) * 1000),
);

const ML_PER_GAL = 3785.411784;

/** 0409's `width_bucket`: how many edges lie at or below the reading; null without one. */
export function idleBurnBand(ambientMilliC: number | null): number | null {
  if (ambientMilliC == null) return null;
  return IDLE_BURN_BAND_EDGES_MILLI_C.filter((e) => e <= ambientMilliC).length;
}

/** A band's words, for a reader: "Below 32 °F", "32–50 °F", …, "90 °F and above", "No temperature". */
export function idleBurnBandLabel(band: number | null): string {
  const e = IDLE_BURN_BAND_EDGES_F;
  if (band == null) return "No temperature";
  if (band <= 0) return `Below ${e[0]} °F`;
  if (band >= e.length) return `${e[e.length - 1]} °F and above`;
  return `${e[band - 1]}–${e[band]} °F`;
}

/** One row of 0419: a truck's interior idle hours in a band, and their fuel. */
export interface IdleBurnInputRow {
  vehicleId: string;
  band: number | null;
  hours: number;
  fuelMl: number;
}

/**
 * 0419's `idle_engine_burn_hours` as PostgREST sends it, and the arguments that ask it for the learner's
 * window. Shared because two services call it — the office API and the platform console (IE-ADMIN) —
 * and the window, the band edges and the bigint handling must be the same in both.
 */
export const IDLE_BURN_RPC = "idle_engine_burn_hours";

export interface IdleBurnInputRpcRow {
  vehicle_id: string;
  band: number | null;
  hours: number;
  // bigint: PostgREST may send it as a string.
  fuel_ml: number | string;
}

export function idleBurnInputsArgs(
  orgId: string,
  now: Date,
): { from: string; to: string; args: { p_org: string; p_from: string; p_to: string; p_band_edges_milli_c: number[] } } {
  const to = now.toISOString();
  const from = new Date(now.getTime() - IDLE_BURN_LEARN_DAYS * 86_400_000).toISOString();
  return { from, to, args: { p_org: orgId, p_from: from, p_to: to, p_band_edges_milli_c: [...IDLE_BURN_BAND_EDGES_MILLI_C] } };
}

export function idleBurnInputRows(rows: readonly IdleBurnInputRpcRow[]): IdleBurnInputRow[] {
  return rows.map((r) => ({ vehicleId: r.vehicle_id, band: r.band, hours: Number(r.hours), fuelMl: Number(r.fuel_ml) }));
}

export interface IdleBurnMeasure {
  trucks: number;
  /** Interior idle hours. */
  runningHours: number;
  gallons: number;
  /** Gallons over hours, null with no hours. */
  measuredGalPerHour: number | null;
  /** Half-width of the 95% interval as a share of the rate, clustered by truck; null under two trucks. */
  ci95: number | null;
  /** At least `IDLE_BURN_MIN_TRUCKS` trucks and `ci95` within `IDLE_BURN_MAX_CI95`. */
  learned: boolean;
}

/** Where an hour's rate came from: its own cell, its cohort, the whole fleet, or the prior. */
export type IdleBurnSource = "cell" | "cohort" | "fleet" | "prior";

/** The same, in the reader's words — one wording for the office panel and the platform console. */
export const IDLE_BURN_SOURCE_LABELS: Record<IdleBurnSource, string> = {
  cell: "Yes — measured rate",
  cohort: "Not yet — uses this equipment's rate",
  fleet: "Not yet — uses the fleet's rate",
  prior: "Not yet — estimate",
};

export interface IdleBurnCell extends IdleBurnMeasure {
  equipment: DeclaredEquipment;
  band: number | null;
  label: string;
  /** What an hour in this cell is priced at, and from which level. */
  galPerHour: number;
  source: IdleBurnSource;
}

export interface IdleBurnRates {
  priorGalPerHour: number;
  minTrucks: number;
  maxCi95: number;
  /** Every cell with at least one hour, by equipment then band (no temperature last). */
  cells: IdleBurnCell[];
  /** Each cohort across every band, the unbanded hours included. */
  cohorts: (IdleBurnMeasure & { equipment: DeclaredEquipment })[];
  fleet: IdleBurnMeasure;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * One level's rate and its precision from per-truck rows (hours h_i, gallons g_i). The rate is
 * r = Σg / Σh; its variance, clustered by truck, is n/(n−1) · Σ(g_i − r·h_i)² / (Σh)² — the ratio
 * estimator's sandwich form, so a truck that burns unlike the rest widens the interval however many
 * hours the others hold.
 */
function measure(perTruck: ReadonlyMap<string, { hours: number; fuelMl: number }>): IdleBurnMeasure {
  const t = [...perTruck.values()];
  const hours = t.reduce((a, x) => a + x.hours, 0);
  const gal = t.reduce((a, x) => a + x.fuelMl, 0) / ML_PER_GAL;
  const rate = hours > 0 ? gal / hours : null;
  const n = t.length;
  let ci95: number | null = null;
  if (rate != null && rate > 0 && n >= 2) {
    const ss = t.reduce((a, x) => a + (x.fuelMl / ML_PER_GAL - rate * x.hours) ** 2, 0);
    ci95 = r3((1.96 * Math.sqrt((ss * n) / (n - 1))) / hours / rate);
  }
  return {
    trucks: n,
    runningHours: r1(hours),
    gallons: r1(gal),
    measuredGalPerHour: rate == null ? null : r3(rate),
    ci95,
    learned: rate != null && n >= IDLE_BURN_MIN_TRUCKS && ci95 != null && ci95 <= IDLE_BURN_MAX_CI95,
  };
}

/** Fold 0419's per-truck rows into cohort × band cells, with each truck's DECLARED equipment. */
export function learnIdleBurnRates(
  rows: readonly IdleBurnInputRow[],
  equipmentOf: (vehicleId: string) => DeclaredEquipment,
): IdleBurnRates {
  type PerTruck = Map<string, { hours: number; fuelMl: number }>;
  const add = (m: Map<string, PerTruck>, k: string, r: IdleBurnInputRow) => {
    const level = m.get(k) ?? new Map();
    const s = level.get(r.vehicleId) ?? { hours: 0, fuelMl: 0 };
    s.hours += r.hours;
    s.fuelMl += r.fuelMl;
    level.set(r.vehicleId, s);
    m.set(k, level);
  };
  const cellRows = new Map<string, PerTruck>();
  const cohortRows = new Map<string, PerTruck>();
  const fleetRows = new Map<string, PerTruck>();
  for (const r of rows) {
    const eq = equipmentOf(r.vehicleId);
    add(cellRows, `${eq}|${r.band ?? ""}`, r);
    add(cohortRows, eq, r);
    add(fleetRows, "", r);
  }

  const eqOrder = (e: DeclaredEquipment) => DECLARED_EQUIPMENT.indexOf(e);
  const cohorts = [...cohortRows]
    .map(([eq, t]) => ({ equipment: eq as DeclaredEquipment, ...measure(t) }))
    .sort((a, b) => eqOrder(a.equipment) - eqOrder(b.equipment));
  const fleet = measure(fleetRows.get("") ?? new Map());
  const fallback = fallbackRate(cohorts, fleet);

  const bandOrder = (b: number | null) => (b == null ? Number.MAX_SAFE_INTEGER : b);
  const cells: IdleBurnCell[] = [...cellRows].map(([k, t]) => {
    const [eq, b] = k.split("|");
    const band = b === "" ? null : Number(b);
    const m = measure(t);
    // The unbanded cell is never believed on its own: it is not a temperature.
    const learned = band != null && m.learned;
    const rate = learned ? { galPerHour: m.measuredGalPerHour!, source: "cell" as const } : fallback(eq as DeclaredEquipment);
    return { ...m, learned, equipment: eq as DeclaredEquipment, band, label: idleBurnBandLabel(band), ...rate };
  });
  cells.sort((a, b) => eqOrder(a.equipment) - eqOrder(b.equipment) || bandOrder(a.band) - bandOrder(b.band));

  return { priorGalPerHour: IDLE_BURN_PRIOR_GAL_PER_HOUR, minTrucks: IDLE_BURN_MIN_TRUCKS, maxCi95: IDLE_BURN_MAX_CI95, cells, cohorts, fleet };
}

/** Cohort, else fleet, else prior — the first level that passes the bar. */
function fallbackRate(
  cohorts: readonly (IdleBurnMeasure & { equipment: DeclaredEquipment })[],
  fleet: IdleBurnMeasure,
): (equipment: DeclaredEquipment) => { galPerHour: number; source: IdleBurnSource } {
  return (equipment) => {
    const c = cohorts.find((x) => x.equipment === equipment);
    if (c?.learned) return { galPerHour: c.measuredGalPerHour!, source: "cohort" };
    if (fleet.learned) return { galPerHour: fleet.measuredGalPerHour!, source: "fleet" };
    return { galPerHour: IDLE_BURN_PRIOR_GAL_PER_HOUR, source: "prior" };
  };
}

/** The rate an hour of running is priced at: its cell's (already resolved to a level), else the fall-back. */
export function idleBurnRateFor(
  rates: Pick<IdleBurnRates, "cells" | "cohorts" | "fleet">,
  equipment: DeclaredEquipment,
  ambientMilliC: number | null,
): number {
  const band = idleBurnBand(ambientMilliC);
  const cell = rates.cells.find((c) => c.equipment === equipment && c.band === band);
  return cell ? cell.galPerHour : fallbackRate(rates.cohorts, rates.fleet)(equipment).galPerHour;
}

/**
 * `idle_settings.idle_burn_source` (0420, §4 Q-IE14): which rate prices the idle engine's hours.
 * `configured` — every hour at `idle_gal_per_hour`; `learned` — each park at `idleBurnRateFor` (its cell,
 * else the nearest believed level, else the prior). The carrier chooses; the default is `configured`.
 */
export const IDLE_BURN_PRICINGS = ["configured", "learned"] as const;
export type IdleBurnPricing = (typeof IDLE_BURN_PRICINGS)[number];

/**
 * The stored value as the money reads it. Anything but `learned` is `configured`: no row (an org whose
 * settings were never written) prices as the column's default does, and an unknown word never moves
 * money onto the learned table, which is the one choice that changes a carrier's figures.
 */
export function idleBurnPricing(raw: unknown): IdleBurnPricing {
  return raw === "learned" ? "learned" : "configured";
}

/** `GET /api/idle/engine/burn-rates`: the learned table beside the rate every idle dollar uses today. */
export interface IdleBurnRatesView extends IdleBurnRates {
  /** The learner's window, ISO instants, `IDLE_BURN_LEARN_DAYS` back from the request. */
  from: string;
  to: string;
  /** `idle_settings.idle_gal_per_hour` through the cost basis — what idle hours are priced at today. */
  configuredGalPerHour: number;
  /** The carrier's choice between the two (`idleBurnPricing` over `idle_settings.idle_burn_source`). */
  pricing: IdleBurnPricing;
}
