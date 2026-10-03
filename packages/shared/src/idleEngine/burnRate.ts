/**
 * What an idling engine burns, learned from the fleet's own engines (IE4, D-IE5 of
 * FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md). Pure: the measurement comes from `idle_engine_burn_inputs`
 * (0409) — per truck and ambient band, running seconds and the engine counter's millilitres over the
 * parks that have both — and every judgement about it is made here.
 *
 * ── PRIOR, THEN LEARNED ───────────────────────────────────────────────────────────────────────────
 * The prior is 0.72 gal/h: Samsara's per-event idle fuel on our fleet measured 0.705–0.743 across
 * the comfortable bands in September (§1.4), inside Argonne's 0.64–1.0. A cell — declared equipment
 * (IE1) × ambient band — is LEARNED once it holds `IDLE_BURN_MIN_HOURS` (50) running hours; until
 * then it reads the prior, and says so. A rate is gallons over hours summed across the cell's parks,
 * never a mean of per-park rates: a ten-minute park's 500 mL counter step would otherwise weigh as
 * much as a night.
 *
 * ── WHY EQUIPMENT × TEMPERATURE ───────────────────────────────────────────────────────────────────
 * Temperature because a cab held at 70 °F in 95 °F air runs the A/C compressor off the engine and in
 * 35 °F air the heater core and a higher idle (§1.4: 0.806 gal/h at 32–50 °F against 0.705 at
 * 75–90 °F). Equipment because the cohorts are different trucks — battery APU is mostly the
 * 2025–2027 International LT625s and the 2027 Freightliners, no APU mostly the 2020–2025 Cascadias
 * (§1.6) — so engine and accessories differ with the declaration, and D-IE5 names the cohort as its
 * grain. Bands are §1.4's, so a learned cell can
 * be read against the September measurement it replaces.
 *
 * A park with no ambient reading is in no band: it is counted in its cohort's and the fleet's totals
 * and priced at the prior, never guessed into a band.
 */
import { DECLARED_EQUIPMENT, type DeclaredEquipment } from "../idleEquipmentDeclared.js";

/** D-IE5's prior, gal per running hour (§1.4). */
export const IDLE_BURN_PRIOR_GAL_PER_HOUR = 0.72;
/** D-IE5: a cell is believed once it holds this many running hours. */
export const IDLE_BURN_MIN_HOURS = 50;
/**
 * How far back the learner reads. Sixty days, so a season's turn moves a band's rate within two
 * months, and long enough that a cohort's mild bands pass 50 h — the no-APU 50–75 °F cell held 57 h
 * after the engine's first 31 hours (0409's header).
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

/** One row of 0409. */
export interface IdleBurnInputRow {
  vehicleId: string;
  band: number | null;
  parks: number;
  runningSec: number;
  fuelMl: number;
}

/**
 * 0409's `idle_engine_burn_inputs` as PostgREST sends it, and the arguments that ask it for the learner's
 * window. Shared because two services call it — the office API and the platform console (IE-ADMIN) —
 * and the window, the band edges and the bigint handling must be the same in both.
 */
export interface IdleBurnInputRpcRow {
  vehicle_id: string;
  band: number | null;
  parks: number;
  // bigint: PostgREST may send it as a string.
  running_sec: number | string;
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
  return rows.map((r) => ({
    vehicleId: r.vehicle_id,
    band: r.band,
    parks: r.parks,
    runningSec: Number(r.running_sec),
    fuelMl: Number(r.fuel_ml),
  }));
}

export interface IdleBurnMeasure {
  parks: number;
  runningHours: number;
  gallons: number;
  /** Gallons over running hours, null with no running hours. */
  measuredGalPerHour: number | null;
}

export interface IdleBurnCell extends IdleBurnMeasure {
  equipment: DeclaredEquipment;
  band: number | null;
  label: string;
  /** At least `IDLE_BURN_MIN_HOURS`, and in a band. */
  learned: boolean;
  /** What an hour in this cell is priced at: the measured rate when learned, the prior otherwise. */
  galPerHour: number;
}

export interface IdleBurnRates {
  priorGalPerHour: number;
  minHours: number;
  /** Every cell with at least one park, by equipment then band (no temperature last). */
  cells: IdleBurnCell[];
  /** Each cohort across every band, the unbanded parks included. */
  cohorts: (IdleBurnMeasure & { equipment: DeclaredEquipment })[];
  fleet: IdleBurnMeasure;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r1 = (n: number) => Math.round(n * 10) / 10;

function measure(parks: number, runningSec: number, fuelMl: number): IdleBurnMeasure {
  return {
    parks,
    runningHours: r1(runningSec / 3600),
    gallons: r1(fuelMl / ML_PER_GAL),
    measuredGalPerHour: runningSec > 0 ? r3(fuelMl / ML_PER_GAL / (runningSec / 3600)) : null,
  };
}

/** Fold 0409's per-truck rows into cohort × band cells, with each truck's DECLARED equipment. */
export function learnIdleBurnRates(
  rows: readonly IdleBurnInputRow[],
  equipmentOf: (vehicleId: string) => DeclaredEquipment,
): IdleBurnRates {
  type Sum = { parks: number; runningSec: number; fuelMl: number };
  const add = (m: Map<string, Sum>, k: string, r: IdleBurnInputRow) => {
    const s = m.get(k) ?? { parks: 0, runningSec: 0, fuelMl: 0 };
    s.parks += r.parks;
    s.runningSec += r.runningSec;
    s.fuelMl += r.fuelMl;
    m.set(k, s);
  };
  const cellSums = new Map<string, Sum>();
  const cohortSums = new Map<string, Sum>();
  const fleet = new Map<string, Sum>();
  for (const r of rows) {
    const eq = equipmentOf(r.vehicleId);
    add(cellSums, `${eq}|${r.band ?? ""}`, r);
    add(cohortSums, eq, r);
    add(fleet, "", r);
  }

  const bandOrder = (b: number | null) => (b == null ? Number.MAX_SAFE_INTEGER : b);
  const cells: IdleBurnCell[] = [...cellSums].map(([k, s]) => {
    const [eq, b] = k.split("|");
    const band = b === "" ? null : Number(b);
    const m = measure(s.parks, s.runningSec, s.fuelMl);
    const learned = band != null && s.runningSec >= IDLE_BURN_MIN_HOURS * 3600 && m.measuredGalPerHour != null;
    return {
      ...m,
      equipment: eq as DeclaredEquipment,
      band,
      label: idleBurnBandLabel(band),
      learned,
      galPerHour: learned ? m.measuredGalPerHour! : IDLE_BURN_PRIOR_GAL_PER_HOUR,
    };
  });
  const eqOrder = (e: DeclaredEquipment) => DECLARED_EQUIPMENT.indexOf(e);
  cells.sort((a, b) => eqOrder(a.equipment) - eqOrder(b.equipment) || bandOrder(a.band) - bandOrder(b.band));

  const cohorts = [...cohortSums]
    .map(([eq, s]) => ({ equipment: eq as DeclaredEquipment, ...measure(s.parks, s.runningSec, s.fuelMl) }))
    .sort((a, b) => eqOrder(a.equipment) - eqOrder(b.equipment));
  const f = fleet.get("") ?? { parks: 0, runningSec: 0, fuelMl: 0 };

  return {
    priorGalPerHour: IDLE_BURN_PRIOR_GAL_PER_HOUR,
    minHours: IDLE_BURN_MIN_HOURS,
    cells,
    cohorts,
    fleet: measure(f.parks, f.runningSec, f.fuelMl),
  };
}

/** The rate an hour of running is priced at: its cell's, when learned; the prior otherwise. */
export function idleBurnRateFor(
  rates: Pick<IdleBurnRates, "cells" | "priorGalPerHour">,
  equipment: DeclaredEquipment,
  ambientMilliC: number | null,
): number {
  const band = idleBurnBand(ambientMilliC);
  // An unlearned cell's `galPerHour` is already the prior — the unbanded cell is never learned — so
  // the cell answers whenever there is one.
  return rates.cells.find((c) => c.equipment === equipment && c.band === band)?.galPerHour ?? rates.priorGalPerHour;
}

/** `GET /api/idle/engine/burn-rates`: the learned table beside the rate every idle dollar uses today. */
export interface IdleBurnRatesView extends IdleBurnRates {
  /** The learner's window, ISO instants, `IDLE_BURN_LEARN_DAYS` back from the request. */
  from: string;
  to: string;
  /** `idle_settings.idle_gal_per_hour` through the cost basis — what idle hours are priced at today. */
  configuredGalPerHour: number;
}
