import type { PmScheduleDto, TruckPmVerdict } from "@silvicom/shared";

/**
 * The words and tones for a PM verdict — one definition for the truck's Due card (a schedule's
 * verdict) and the Vehicles list's "Next PM due" column (a truck's, FleetPal Q11), so "Due soon" cannot
 * come to mean two things on two screens. A schedule's NULL verdict and a truck's `unknown` are the same
 * fact — a schedule exists that cannot be judged — and both read "Can't tell", never "OK".
 */
type Verdict = PmScheduleDto["verdict"] | TruckPmVerdict;
export const pmVerdictLabel = (v: Verdict): string =>
  v === "overdue" ? "Overdue" : v === "due" ? "Due soon" : v === "ok" ? "OK" : "Can't tell";
export const pmVerdictTone = (v: Verdict): "danger" | "caution" | "success" | "neutral" =>
  v === "overdue" ? "danger" : v === "due" ? "caution" : v === "ok" ? "success" : "neutral";
/** List order: what needs the shop first, a truck with no schedule last. */
export const pmVerdictRank = (v: TruckPmVerdict | null | undefined): number =>
  v === "overdue" ? 0 : v === "due" ? 1 : v === "unknown" ? 2 : v === "ok" ? 3 : 4;
