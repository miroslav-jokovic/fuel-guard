/**
 * Which truck a toll belongs to (TOLLS-PER-TRUCK-PLAN.md D-TL3, D-TL4). Pure.
 *
 * ── DERIVED, NEVER STORED ────────────────────────────────────────────────────────────────────
 * A toll line carries a tag and a time; the truck is read from the tag's dated assignment history
 * (0622) every time it is asked. Voiding a wrong assignment therefore re-attributes every toll it
 * touched without a re-stamping job.
 *
 * ── WHY A TOLL NEAR A SWAP IS NOT GUESSED ────────────────────────────────────────────────────
 * Statements print the plaza's LOCAL time with no zone, and the fleet runs from Eastern to Pacific:
 * read in the org's zone (Central), a time is right to within two hours either way. A toll that falls
 * within `SWAP_MARGIN_MS` of the moment its tag changed trucks could belong to either truck, and
 * either answer would be a guess with money on it. So it comes back `near_swap` with BOTH trucks
 * named, and the review queue settles it — the office knows which truck went through Ohio that
 * morning; arithmetic does not. Three hours covers the two-hour zone spread plus the slack of a swap
 * logged a little late.
 */

export const SWAP_MARGIN_MS = 3 * 60 * 60 * 1000;

/** One assignment row as attribution needs it. `validTo` null = still on that truck. */
export interface TagAssignment {
  vehicleId: string;
  validFrom: string; // ISO instant
  validTo: string | null;
  voided: boolean;
}

export type TollAttribution =
  | { kind: "matched"; vehicleId: string }
  | { kind: "near_swap"; vehicleIds: string[] }
  | { kind: "unassigned" };

/**
 * Attribute one toll at instant `at` (ms) against one tag's history. Voided rows are ignored. A
 * history that overlaps itself cannot reach here (0622 refuses it, TL001), but if it did, two trucks
 * at one instant is answered as `near_swap` with both — never by picking one.
 */
export function attributeToll(history: readonly TagAssignment[], at: number): TollAttribution {
  const live = history
    .filter((a) => !a.voided)
    .map((a) => ({
      vehicleId: a.vehicleId,
      from: Date.parse(a.validFrom),
      to: a.validTo == null ? Number.POSITIVE_INFINITY : Date.parse(a.validTo),
    }));

  const holding = live.filter((a) => a.from <= at && at < a.to);
  if (holding.length > 1) return { kind: "near_swap", vehicleIds: unique(holding.map((a) => a.vehicleId)) };

  // Every truck whose assignment begins or ends within the margin of this toll is a candidate.
  const nearby = live.filter((a) => Math.abs(at - a.from) <= SWAP_MARGIN_MS || (Number.isFinite(a.to) && Math.abs(at - a.to) <= SWAP_MARGIN_MS));
  const candidates = unique([...holding, ...nearby].map((a) => a.vehicleId));
  const only = holding[0];
  // One truck held it and no OTHER truck's boundary is near: the only answer there is.
  if (only && candidates.length === 1) return { kind: "matched", vehicleId: only.vehicleId };
  // Two trucks near a swap, or no truck at the stamped time but one just before or after (the tag
  // was put on, or taken off, within the zone error): both are the office's call, not ours.
  if (candidates.length > 0) return { kind: "near_swap", vehicleIds: candidates };
  return { kind: "unassigned" };
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}
