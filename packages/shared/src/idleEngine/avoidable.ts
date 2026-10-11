/**
 * Which of a park's engine-running seconds were avoidable (IE3, D-IE4 of
 * FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md). Pure: the park's measurements come from `idle_engine_stops`
 * (0404 + 0407), the truck's equipment from its declaration (IE1), the band and the shares from the
 * org's settings — and the verdict is made here, on read, never stored, so the 50% battery-APU
 * allowance the owner will revisit (Q-IE3) moves every past park the day it changes.
 *
 * ── THE RULES, AS RULED, AND WHAT EACH ONE READS ──────────────────────────────────────────────────
 *  1. Ambient outside the comfort band (Q-IE2, 20–85 °F) → every running second is allowed. PTO is in
 *     the ruling and NOT here: nothing we collect says when a PTO was engaged (Q-IE11).
 *  2. On duty (on duty not driving, or "driving" logged while the truck stood) → the first hour of
 *     running is allowed, every second past it avoidable (R10), whatever the equipment.
 *  3. Rest (off duty, sleeper) on a battery-APU truck → running up to `batteryApuShare` (50%) of the
 *     PARK's duration is allowed, the rest avoidable (Q-IE3: a share of parked time, not a run cap).
 *  4. Rest on a truck with no APU → not the driver's to avoid: an EQUIPMENT OPPORTUNITY, what an APU
 *     would save on this truck, reported apart (R7: no diesel APUs, units 500–635 have none).
 *  5. Anything else → avoidable. Two parts of "anything else" are ruled here (Q-IE12): yard move and
 *     personal conveyance are ALLOWED (the truck is in use, not parked — the old model excluded them
 *     too); running with no usable duty status is AVOIDABLE, as rule 5 reads, but counted apart as
 *     `avoidableNoLogSec`, so a reader can see how much of the figure rests on a missing log.
 *  A rest on a truck whose equipment is not declared (or is "other") is UNJUDGED, not guessed.
 *
 * Every part is seconds of the park's running time, and the parts add up to it — `allowedSec +
 * avoidableSec + equipmentOpportunitySec + unjudgedSec = runningSec` — so a fleet total can be split
 * without a remainder nobody can name.
 */
import type { DeclaredEquipment } from "../idleEquipmentDeclared.js";

export interface IdleStopMeasure {
  durationSec: number;
  runningSec: number;
  /** The 0407 split; all null = not measured (an ie2-v1 park). */
  runningRestSec: number | null;
  runningOnDutySec: number | null;
  runningExcludedSec: number | null;
  runningUnknownSec: number | null;
  ambientMilliC: number | null;
}

export interface IdleAvoidableSettings {
  /** `idle_settings.comfort_low_f` / `comfort_high_f` (Q-IE2: 20 and 85). */
  comfortLowF: number;
  comfortHighF: number;
  /** Q-IE3: the share of a park a battery-APU truck may run through a rest. */
  batteryApuShare: number;
  /** R10: the running on duty that is allowed before the rest of it is avoidable. */
  onDutyGraceSec: number;
}

export const DEFAULT_IDLE_AVOIDABLE_SETTINGS: IdleAvoidableSettings = {
  comfortLowF: 20,
  comfortHighF: 85,
  batteryApuShare: 0.5,
  onDutyGraceSec: 3600,
};

export interface IdleStopVerdict {
  /** False for a park the 0407 split never reached: its running time is in no part below. */
  measured: boolean;
  /** Rule 1 fired: the whole park is allowed for the temperature. */
  outsideComfort: boolean;
  allowedSec: number;
  avoidableSec: number;
  /** Of `avoidableSec`, the seconds with no usable duty status behind them (rule 5's weak half). */
  avoidableNoLogSec: number;
  equipmentOpportunitySec: number;
  unjudgedSec: number;
}

const toF = (milliC: number) => (milliC / 1000) * 1.8 + 32;

export function idleStopVerdict(
  stop: IdleStopMeasure,
  equipment: DeclaredEquipment,
  settings: IdleAvoidableSettings = DEFAULT_IDLE_AVOIDABLE_SETTINGS,
): IdleStopVerdict {
  const none = { allowedSec: 0, avoidableSec: 0, avoidableNoLogSec: 0, equipmentOpportunitySec: 0, unjudgedSec: 0 };
  const rest = stop.runningRestSec;
  const onDuty = stop.runningOnDutySec;
  const excluded = stop.runningExcludedSec;
  const unknown = stop.runningUnknownSec;
  if (rest == null || onDuty == null || excluded == null || unknown == null) {
    return { measured: false, outsideComfort: false, ...none };
  }
  // Rule 1. An unknown temperature exempts nothing: it is not evidence the cab needed the engine.
  if (stop.ambientMilliC != null) {
    const f = toF(stop.ambientMilliC);
    if (f < settings.comfortLowF || f > settings.comfortHighF) {
      return { measured: true, outsideComfort: true, ...none, allowedSec: stop.runningSec };
    }
  }
  const v = { measured: true, outsideComfort: false, ...none };
  // Rule 2.
  const graced = Math.min(onDuty, settings.onDutyGraceSec);
  v.allowedSec += graced;
  v.avoidableSec += onDuty - graced;
  // Rules 3 and 4, and the unjudged rest.
  if (equipment === "battery_apu") {
    const allowance = Math.min(rest, Math.floor(settings.batteryApuShare * stop.durationSec));
    v.allowedSec += allowance;
    v.avoidableSec += rest - allowance;
  } else if (equipment === "no_apu") {
    v.equipmentOpportunitySec += rest;
  } else {
    v.unjudgedSec += rest;
  }
  // Rule 5, both halves (Q-IE12).
  v.allowedSec += excluded;
  v.avoidableSec += unknown;
  v.avoidableNoLogSec += unknown;
  return v;
}

export interface IdleAvoidableTotals extends Omit<IdleStopVerdict, "measured" | "outsideComfort"> {
  parks: number;
  runningSec: number;
  /** Parks and running seconds the split never reached — reported, never read as zero. */
  unmeasuredParks: number;
  unmeasuredRunningSec: number;
  /** Running seconds allowed because the temperature was outside the band (rule 1). */
  outsideComfortSec: number;
}

/** Sum verdicts. Unmeasured parks are counted apart, so a total says how much of the running it covers. */
export function idleAvoidableTotals(
  rows: readonly { stop: IdleStopMeasure; verdict: IdleStopVerdict }[],
): IdleAvoidableTotals {
  const t: IdleAvoidableTotals = {
    parks: 0, runningSec: 0, unmeasuredParks: 0, unmeasuredRunningSec: 0, outsideComfortSec: 0,
    allowedSec: 0, avoidableSec: 0, avoidableNoLogSec: 0, equipmentOpportunitySec: 0, unjudgedSec: 0,
  };
  for (const { stop, verdict } of rows) {
    t.parks += 1;
    t.runningSec += stop.runningSec;
    if (!verdict.measured) {
      t.unmeasuredParks += 1;
      t.unmeasuredRunningSec += stop.runningSec;
      continue;
    }
    if (verdict.outsideComfort) t.outsideComfortSec += verdict.allowedSec;
    t.allowedSec += verdict.allowedSec;
    t.avoidableSec += verdict.avoidableSec;
    t.avoidableNoLogSec += verdict.avoidableNoLogSec;
    t.equipmentOpportunitySec += verdict.equipmentOpportunitySec;
    t.unjudgedSec += verdict.unjudgedSec;
  }
  return t;
}
