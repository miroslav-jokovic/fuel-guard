import type { HiringPhase } from "./hiringStepGraph.js";
import { LINK_ANY } from "./linkContract.js";

/**
 * The Applicants board's URL (`/recruitment`), read by the board and by Ask AI's `recruiting_counts`
 * link (F21 R4b, D-AI6; why a query string gets a contract: `fuelCostsLinkContract.ts`).
 *
 * ⚠ The board OPENS on "waiting on you" (`waiting` absent means `us`, §4.1), so a link for an answer
 * about EVERYBODY must say so: `waiting=any`. A link that left the key out would open on a smaller
 * list than the answer counted, with nothing on screen saying why.
 */
export const APPLICANTS_QUERY_KEYS = { waiting: "waiting", phase: "phase" } as const;

export interface ApplicantsLinkFilters {
  /** `null` = everybody on the board; written as `any` because the board's default is `us`. */
  waiting: "us" | "them" | null;
  phase?: HiringPhase | null;
}

export function applicantsToQuery(f: ApplicantsLinkFilters): Record<string, string> {
  const K = APPLICANTS_QUERY_KEYS;
  const q: Record<string, string> = { [K.waiting]: f.waiting ?? LINK_ANY };
  if (f.phase) q[K.phase] = f.phase;
  return q;
}
