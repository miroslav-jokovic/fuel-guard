/**
 * The Dashboard's second line — one sentence about what moved, one about what is waiting
 * (FLEET-OVERVIEW-REDESIGN-PROPOSAL Q-FO6, ruled (a) 2026-10-06).
 *
 * ── DERIVED, NOT GENERATED ───────────────────────────────────────────────────────────────────────
 * This is the one "AI-native" gesture the v3 proposal makes, and it is arithmetic over figures the
 * page already shows: the largest period-over-period movement among the three period measures,
 * and the count of rail rows that are not zero. No model, no prose over numbers that have no
 * reference — the sentence exists only once DR2b's deltas do, and until then it is the static
 * line the page has carried since D-DR14.
 *
 * ── WORDS, NOT ARROWS ────────────────────────────────────────────────────────────────────────────
 * The reader of this page is not a native English speaker (D-FRUI3's finding on the finance pages,
 * and the same office). "running ahead of" and "down on" read in one pass; "↑12%" beside a noun
 * does not, and the tiles below already carry the pills.
 */
import { deltaLabel, type PeriodDelta } from "./dashboardComparison.js";

export interface FleetLeadInput {
  spend: PeriodDelta | null;
  mpg: PeriodDelta | null;
  idleHours: PeriodDelta | null;
  /** Rows on the attention rail that are above zero. */
  waiting: number;
  /** "the previous 31 days" — the page knows the window's length, this file does not. */
  against: string;
}

export const FLEET_LEAD_DEFAULT = "Here's what's happening with your fleet today.";

function movement(i: FleetLeadInput): string | null {
  const candidates: { d: PeriodDelta | null; phrase: (d: PeriodDelta) => string }[] = [
    {
      d: i.spend,
      phrase: (d) => `Fuel spend is ${d.direction === "up" ? "running" : "down"} ${deltaLabel(d)} ${d.direction === "up" ? "ahead of" : "on"} ${i.against}.`,
    },
    {
      d: i.idleHours,
      phrase: (d) => `Idle hours are ${d.direction === "up" ? "up" : "down"} ${deltaLabel(d)} on ${i.against}.`,
    },
    {
      d: i.mpg,
      phrase: (d) => `Fleet MPG is ${d.direction === "up" ? "up" : "down"} ${deltaLabel(d, "abs")} on ${i.against}.`,
    },
  ];
  // The movement a reader would mention first: the biggest, by percent. MPG competes on its percent
  // and is SPOKEN in its own unit, which is the pill's rule too.
  const moved = candidates
    .filter((c): c is { d: PeriodDelta; phrase: (d: PeriodDelta) => string } => c.d != null && c.d.direction !== "flat" && c.d.pct != null)
    .sort((a, b) => Math.abs(b.d.pct!) - Math.abs(a.d.pct!));
  return moved[0] ? moved[0].phrase(moved[0].d) : null;
}

function waiting(n: number): string {
  if (n <= 0) return "Nothing is waiting on you.";
  return n === 1 ? "One thing needs a decision today." : `${n} things need a decision today.`;
}

export function fleetLead(i: FleetLeadInput): string {
  const moved = movement(i);
  // No comparison yet means no sentence about movement, and no claim about what is waiting either:
  // the rail's counts load with the same request, so a confident "Nothing is waiting on you" here
  // would be read before the figures it describes exist.
  if (!moved) return FLEET_LEAD_DEFAULT;
  return `${moved} ${waiting(i.waiting)}`;
}
