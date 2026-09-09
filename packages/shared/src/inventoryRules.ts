/**
 * Inventory's pure decisions — the four questions whose answer must be identical on the API, on the
 * desk screen and on the phone in the bay (`docs/plans/maintenance/INVENTORY-PLAN.md` §5 I1).
 *
 * Is this shelf low? Is this truck's kit complete? Is this count far enough off to stop the
 * technician? What is the next asset number? None of them touch a clock, a database or a random
 * source, and all four are here rather than in a service because each has at least two callers who
 * must agree: the low-stock card and the low-stock filter, the units list and the home shortfall
 * count, the count screen's confirm and the ledger row it writes, the issuance route and the label
 * it prints. Two implementations of "short by two" is how a page and its badge disagree.
 *
 * The shapes below are structural interfaces rather than the Zod types in `inventoryContract.ts`,
 * on `chooseVehicleIdentification`'s precedent: a rule should be callable with the three fields it
 * reads, not with a whole DTO the caller has to fabricate in a test.
 */

// ── low stock ────────────────────────────────────────────────────────────────────────────────────

export interface StockLevel {
  quantityOnHand: number;
  /** Null until somebody sets one. See below — that is a real state, not a zero. */
  reorderPoint: number | null;
}

/**
 * Whether a stock line has fallen to its reorder point.
 *
 * A null reorder point is NOT low, however empty the shelf is, and that is the deliberate half of
 * this function. It follows `inspectionExpiry`'s ruling that missing and lapsed are different
 * facts: nobody has said what "enough" means for this part, so the system has not established that
 * there is too little of it, and colouring it red would report a shortage the shop never defined.
 * An empty shelf with no reorder point is visible as a zero on-hand, which is the honest signal.
 *
 * A reorder point of ZERO is meaningful and is honoured — "tell me when this hits nothing" is a
 * legitimate thing to ask for, so the comparison is `<=` and the null check is separate from it.
 */
export function isLowStock(stock: StockLevel): boolean {
  if (stock.reorderPoint === null) return false;
  return stock.quantityOnHand <= stock.reorderPoint;
}

// ── kit completeness ─────────────────────────────────────────────────────────────────────────────

export const KIT_STATES = ["complete", "short", "extra"] as const;
export type KitState = (typeof KIT_STATES)[number];

export const KIT_STATE_LABELS: Record<KitState, string> = {
  complete: "Complete",
  short: "Short",
  extra: "Extra items",
};

export interface KitLine {
  assetTypeId: string;
  quantity: number;
}

export interface KitLineStatus {
  assetTypeId: string;
  expected: number;
  held: number;
  /** held − expected. Negative is a shortfall, which is the number the shop acts on. */
  delta: number;
}

export interface KitStatus {
  state: KitState;
  /** Total units missing across every line. The figure the home page counts. */
  shortBy: number;
  /** Total units held beyond what the kit calls for. */
  extraBy: number;
  lines: KitLineStatus[];
}

/**
 * What a unit's kit looks like against what it should hold (D-INV12, plan I9).
 *
 * ── WHY `short` BEATS `extra` WHEN BOTH ARE TRUE ────────────────────────────────────────────────
 * A trailer missing one strap and carrying a spare chain is short, not "extra". The state is what
 * a person is asked to do something about, and only the shortfall is actionable — a spare chain in
 * a trailer is at worst untidy, a missing strap is a load that cannot be secured. The `lines` array
 * carries both facts either way, so a screen that wants to show the spare still can; what the
 * single word must not do is let a shortfall hide behind a surplus somewhere else in the kit.
 *
 * An asset type held but not expected appears as a line with `expected: 0`, after the expected
 * lines and in the order it was held. That is how "unexpected" is rendered during a unit check
 * (research §2.7's three buckets) without a second traversal.
 *
 * Duplicate lines for one asset type are summed rather than rejected. The expectation table has an
 * org-wide default row and a per-unit override row (I9), and the caller that concatenates them
 * without merging is the likely one — summing is the answer that cannot silently drop a row.
 */
export function deriveKitStatus(expected: KitLine[], held: KitLine[]): KitStatus {
  const sum = (lines: KitLine[]): Map<string, number> => {
    const totals = new Map<string, number>();
    for (const line of lines) {
      totals.set(line.assetTypeId, (totals.get(line.assetTypeId) ?? 0) + line.quantity);
    }
    return totals;
  };

  const expectedTotals = sum(expected);
  const heldTotals = sum(held);

  const lines: KitLineStatus[] = [];
  for (const [assetTypeId, expectedQty] of expectedTotals) {
    const heldQty = heldTotals.get(assetTypeId) ?? 0;
    lines.push({ assetTypeId, expected: expectedQty, held: heldQty, delta: heldQty - expectedQty });
  }
  for (const [assetTypeId, heldQty] of heldTotals) {
    if (expectedTotals.has(assetTypeId)) continue;
    lines.push({ assetTypeId, expected: 0, held: heldQty, delta: heldQty });
  }

  let shortBy = 0;
  let extraBy = 0;
  for (const line of lines) {
    if (line.delta < 0) shortBy += -line.delta;
    else extraBy += line.delta;
  }

  const state: KitState = shortBy > 0 ? "short" : extraBy > 0 ? "extra" : "complete";
  return { state, shortBy, extraBy, lines };
}

// ── count variance ───────────────────────────────────────────────────────────────────────────────

export const COUNT_VARIANCE_TIERS = ["none", "confirm", "recount"] as const;
export type CountVarianceTier = (typeof COUNT_VARIANCE_TIERS)[number];

/**
 * The absolute floor below which a variance is never worth interrupting a count for, and the
 * proportion above it. D-INV21: "above max(5, 5 %)" a confirm, "above 10 %" a second counter.
 */
export const COUNT_CONFIRM_FLOOR = 5;
export const COUNT_CONFIRM_FRACTION = 0.05;
export const COUNT_RECOUNT_FRACTION = 0.1;

/**
 * How hard to push back on a counted figure (D-INV21, research §2.8).
 *
 * ── THE LADDER IS MONOTONE, AND MAKING IT SO TOOK A DECISION ────────────────────────────────────
 * D-INV21 states two thresholds that were written independently: a confirm above max(5, 5 %), and
 * a flag for a second counter above 10 %. Applied literally and separately they cross each other on
 * small numbers. Twelve expected, ten counted is a variance of 2 — that is 16.7 %, over the recount
 * line, but only 2, under the confirm floor of 5. A technician would be told a second person must
 * recount a bin they were never even asked to confirm.
 *
 * So `recount` requires the confirm condition to hold as well: it is the higher rung of one ladder,
 * not a parallel test. The absolute floor of 5 is what the plan put there to stop small-number
 * nagging, and it has to protect both rungs or it protects neither. No new constant was invented to
 * do this — 10 % is still 10 %, it just cannot fire on a variance the floor already forgave.
 *
 * ── ZERO AGAINST NON-ZERO STOPS AT `confirm` ────────────────────────────────────────────────────
 * "Counted 0 of 3" is worth a confirm — an empty shelf where the system expects stock is the shape
 * of a real error, and 3 is under the floor so nothing else would catch it. It is NOT worth a
 * second counter. Demanding another person walk over for three of something is how a discipline
 * gets ignored, and D-INV21's own instruction is that the confirm is consequence-labelled ("Record
 * 0 of 12 / Keep counting") rather than a nag. So the zero rule raises the tier to `confirm` and
 * the recount rung stays gated on the numeric floor.
 *
 * `expected` of zero with something counted is left to the ordinary arithmetic: finding six of a
 * part the system says you have none of clears the floor and is worth stopping for; finding three
 * is not.
 */
export function countVarianceTier(expected: number, counted: number): CountVarianceTier {
  const variance = Math.abs(counted - expected);
  const overFloor = variance > Math.max(COUNT_CONFIRM_FLOOR, expected * COUNT_CONFIRM_FRACTION);
  const zeroAgainstNonZero = expected > 0 && counted === 0;

  if (overFloor && variance > expected * COUNT_RECOUNT_FRACTION) return "recount";
  if (overFloor || zeroAgainstNonZero) return "confirm";
  return "none";
}

// ── asset display numbers ────────────────────────────────────────────────────────────────────────

/** Digits after the letter. Four, because `A-0412` is the shape the plan spells out (D-INV18). */
export const DISPLAY_NO_DIGITS = 4;
const DISPLAY_NO_BLOCK = 10 ** DISPLAY_NO_DIGITS - 1; // 9999 per letter
const DISPLAY_NO_LETTERS = 26;
export const DISPLAY_NO_MAX_SEQUENCE = DISPLAY_NO_BLOCK * DISPLAY_NO_LETTERS;

/**
 * The next human-readable asset number from a 1-based sequence (D-INV18): 1 → `A-0001`,
 * 412 → `A-0412`.
 *
 * This is the identifier a technician says out loud and writes on a work order, which is the whole
 * reason it exists beside the opaque `tag_code`: nobody reads `SIL1:AST:7K3M9P` over a radio. It is
 * assigned once and never reused, so it is a sequence and not a slot.
 *
 * ── WHY THE LETTER ROLLS INSTEAD OF THE DIGITS GROWING ──────────────────────────────────────────
 * The obvious behaviour past 9999 is `A-10000`. It was rejected because these numbers are sorted
 * and listed, and a width change breaks lexical ordering — `A-10000` sorts before `A-9999` in every
 * list, filter and printed sheet in the product. Rolling the letter keeps the width fixed forever:
 * 10000 → `B-0001`.
 *
 * A carrier with 440 units will not reach 9999 assets, and that is exactly why this is written down
 * rather than left to whatever happens. This repo has been bitten twice by a boundary nobody was
 * ever going to reach — McLeod's year-2215 sentinel dates and PostgREST's 1,000-row cap, which cost
 * nine filter menus 30 % of their values in silence. Past `Z-9999` this throws rather than emitting
 * a number that collides or sorts wrongly; 259,974 assets is a problem worth an exception.
 */
export function nextDisplayNo(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Display numbers start at 1; got ${sequence}.`);
  }
  if (sequence > DISPLAY_NO_MAX_SEQUENCE) {
    throw new Error(
      `Display number sequence exhausted at ${DISPLAY_NO_MAX_SEQUENCE} (Z-${DISPLAY_NO_BLOCK}); got ${sequence}.`,
    );
  }
  const block = Math.floor((sequence - 1) / DISPLAY_NO_BLOCK);
  const within = sequence - block * DISPLAY_NO_BLOCK;
  const letter = String.fromCharCode("A".charCodeAt(0) + block);
  return `${letter}-${String(within).padStart(DISPLAY_NO_DIGITS, "0")}`;
}
