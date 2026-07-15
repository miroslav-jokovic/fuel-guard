/**
 * Compose the validated TruckFuelState the solver consumes (pure). Combines fuel level, HOS, and the burn
 * model into: gallons on hand, reserve floor, usable-above-reserve, the fuel range and the HOS range, and the
 * BINDING reachable miles = min(fuel, HOS). Confidence flags surface every degraded input so the solver can
 * abstain / widen reserve rather than plan on data we can't stand behind (assumption-free posture).
 */
import { smoothFuelPercent, effectiveTankCapacityGal, gallonsOnHand, type FuelSample } from "./fuelLevel.js";
import { legalDriveMs, combineTeamLegalDriveMs, hosReachableMiles, type HosClocks } from "./hos.js";
import { effectiveMpg, rangeMilesOnGallons, weightLegalFillGal, DEFAULT_IDLE_GAL_PER_HOUR, DEFAULT_REEFER_GAL_PER_HOUR, type BurnModel } from "./consumption.js";

export interface TruckStateConfig {
  reservePct: number;
  mpgSafetyFactor: number;
  usableFraction?: number; // default 0.95
  avgSpeedMph?: number; // conservative, default 55
  maxGrossLb?: number; // legal cap, default 80000
  idleGalPerHour?: number;
  reeferGalPerHour?: number;
  freshnessMinutes?: number; // fuel/HOS staleness threshold, default 60
  postFillMinutes?: number; // distrust a reading this close to a fill, default 60
}

export interface TruckStateInput {
  fuelSamples: FuelSample[];
  tankCapacityGal: number;
  observedMaxFillGal?: number | null;
  baselineMpg: number | null;
  hos: HosClocks;
  teamHos?: HosClocks[] | null; // present only when a team override is set
  isReefer: boolean;
  loadGrossLb?: number | null; // from the dispatcher form; null -> assume the legal max
  lastFillTimeMs?: number | null;
  nowMs: number;
}

export interface TruckFuelState {
  gallonsOnHand: number | null;
  effectiveTankCapacityGal: number;
  usableGal: number;
  reserveGal: number;
  usableAboveReserveGal: number | null;
  belowReserve: boolean;
  weightLegalFillGal: number;
  burn: BurnModel;
  legalDriveMs: number | null;
  timeUntilBreakMs: number | null;
  hosReachableMiles: number | null;
  fuelRangeMiles: number | null;
  /** The binding constraint: how far the truck can actually go = min(fuel range, HOS range). */
  reachableMiles: number | null;
  confidence: {
    fuelPresent: boolean;
    fuelFresh: boolean;
    postFillDistrust: boolean;
    hosPresent: boolean;
    hosFromTeam: boolean;
    mpgPresent: boolean;
  };
  flags: string[];
}

const minutesBetween = (aMs: number, bMs: number) => Math.abs(aMs - bMs) / 60000;

export function buildTruckFuelState(input: TruckStateInput, cfg: TruckStateConfig): TruckFuelState {
  const usableFraction = cfg.usableFraction ?? 0.95;
  const avgSpeed = cfg.avgSpeedMph ?? 55;
  const maxGross = cfg.maxGrossLb ?? 80000;
  const freshMin = cfg.freshnessMinutes ?? 60;
  const postFillMin = cfg.postFillMinutes ?? 60;
  const flags: string[] = [];

  // Fuel level
  const smoothed = smoothFuelPercent(input.fuelSamples);
  const effCap = effectiveTankCapacityGal(input.tankCapacityGal, input.observedMaxFillGal);
  const usableGal = effCap * usableFraction;
  const onHand = gallonsOnHand(smoothed, effCap);
  const reserveGal = usableGal * (cfg.reservePct / 100);
  const usableAboveReserve = onHand == null ? null : onHand - reserveGal;
  const belowReserve = usableAboveReserve != null && usableAboveReserve <= 0;

  // Confidence: freshness + post-fill distrust
  const latest = input.fuelSamples[input.fuelSamples.length - 1];
  const fuelFresh = !!latest && minutesBetween(Date.parse(latest.time), input.nowMs) <= freshMin;
  const postFillDistrust = !!latest && input.lastFillTimeMs != null && minutesBetween(Date.parse(latest.time), input.lastFillTimeMs) <= postFillMin;
  if (onHand == null) flags.push("no_fuel_reading");
  else if (!fuelFresh) flags.push("stale_fuel_reading");
  if (postFillDistrust) flags.push("post_fill_reading_distrusted");
  if (belowReserve) flags.push("below_reserve");

  // Burn model — reefer only burns when hauling a reefer
  const burn: BurnModel = {
    effMpg: effectiveMpg(input.baselineMpg, cfg.mpgSafetyFactor),
    idleGalPerHour: cfg.idleGalPerHour ?? DEFAULT_IDLE_GAL_PER_HOUR,
    reeferGalPerHour: input.isReefer ? (cfg.reeferGalPerHour ?? DEFAULT_REEFER_GAL_PER_HOUR) : 0,
  };
  if (input.baselineMpg == null || input.baselineMpg <= 0) flags.push("no_baseline_mpg");

  // HOS — team override when provided, else single driver
  const hosFromTeam = !!(input.teamHos && input.teamHos.length > 1);
  const legalMs = hosFromTeam ? combineTeamLegalDriveMs(input.teamHos!) : legalDriveMs(input.hos);
  if (legalMs == null) flags.push("no_hos");
  const hosMiles = hosReachableMiles(legalMs, avgSpeed);

  // Ranges — fuel range on the gallons above reserve; reachable = the binding constraint
  const fuelRange = usableAboveReserve == null ? null : rangeMilesOnGallons(Math.max(0, usableAboveReserve), burn, avgSpeed);
  const reachable =
    fuelRange == null && hosMiles == null ? null : Math.min(fuelRange ?? Infinity, hosMiles ?? Infinity);

  const fillCap = weightLegalFillGal(input.loadGrossLb ?? maxGross, maxGross);

  return {
    gallonsOnHand: onHand,
    effectiveTankCapacityGal: effCap,
    usableGal,
    reserveGal,
    usableAboveReserveGal: usableAboveReserve,
    belowReserve,
    weightLegalFillGal: fillCap,
    burn,
    legalDriveMs: legalMs,
    timeUntilBreakMs: input.hos.timeUntilBreakMs,
    hosReachableMiles: hosMiles,
    fuelRangeMiles: fuelRange,
    reachableMiles: reachable === Infinity ? null : reachable,
    confidence: {
      fuelPresent: onHand != null,
      fuelFresh,
      postFillDistrust,
      hosPresent: legalMs != null,
      hosFromTeam,
      mpgPresent: !!(input.baselineMpg && input.baselineMpg > 0),
    },
    flags,
  };
}
