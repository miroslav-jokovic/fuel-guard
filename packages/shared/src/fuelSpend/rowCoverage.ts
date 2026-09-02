/**
 * How much of a fuel list is attributed to a truck, said in words (FUEL-T5).
 *
 * ── THE FACT T5 ASKS FOR, AND WHY IT IS NOT DECORATION ─────────────────────────────────────────
 * T5 asks every fuel list to carry "rows in window, share attributed to a vehicle, and last feed
 * poll". The middle one is the only one of the three that a reader cannot get from anything else on
 * the page: the count is in the filter bar and the poll time is its own line, but nothing says how
 * much of that count reaches a truck. Every per-truck figure in this section — a unit filter, a
 * per-truck total, the Fuel Log's miles tile — silently covers the attributed subset only, and says
 * so nowhere.
 *
 * Measured in production 2026-09-02, and none of the three is negligible:
 *   • `fuel_transactions` (canonical): **300 of 14,868** fills name no truck — 2.0%.
 *   • `efs_transactions`: **339 of 28,620** lines name no truck on the fleet — 1.2%. 283 of those
 *     carry no unit at all, and they are NOT the fee/footer lines one would guess: ULSR (137),
 *     ULSD (117) and DEFD (29) — real fuel purchases EFS printed with an empty unit column.
 *   • `declined_transactions`: **696 of 3,445** declines resolve to no truck — 20.2%. On a page whose
 *     whole job is a fraud signal, one decline in five cannot be pinned to a vehicle.
 *
 * ── THE SHARE IS FLOORED, NEVER ROUNDED ────────────────────────────────────────────────────────
 * 1,204 of 1,205 rounds to 100%, and "100% of these name a truck" beside a row that does not is the
 * confident lie this whole step exists to remove. Flooring costs a percentage point of flattery and
 * buys the guarantee that a complete-looking share means a complete set. The count of the remainder
 * is printed exactly for the same reason — a share is a summary, and the reader acts on the number.
 *
 * ── ONE MODULE OWNS THE WHOLE SENTENCE ─────────────────────────────────────────────────────────
 * The surface is named, not described: callers pass `"transactions"`, not a noun and a consequence
 * clause. `fuelSpendReport.ts` carries the scar that argues for this — its price-line query drifted
 * from the screen's and the document contradicted the page beside it. A caller that supplies half the
 * wording is a second copy of the wording with a delay fuse.
 */

/** The lists this line can qualify. Each one's wording lives in the tables below, not at its call site. */
export type CoverageSurface = "transactions" | "rejections";

/** What the rows are called, matched to the count label the filter bar prints directly beneath. */
const ROW_NOUN: Record<CoverageSurface, { one: string; many: string }> = {
  transactions: { one: "transaction", many: "transactions" },
  rejections: { one: "decline", many: "declines" },
};

/**
 * What the reader loses by the remainder being unattributed — the half that makes this a caveat
 * rather than a statistic.
 *
 * Both raw-feed pages get the same clause because it IS the same fact: these are EFS's own rows, and
 * a row EFS printed against no unit (or against a unit naming no truck on this fleet) cannot be
 * reached by anything that groups or totals by vehicle. It is deliberately ONE constant rather than a
 * per-surface map — the Fuel Log's consequence is a different sentence (its unattributed fills carry
 * gallons and spend into the tiles but contribute no miles), and it arrives with the migration that
 * lets that page count them at all. A map with two identical entries would be a shape invented for a
 * caller that does not exist yet.
 */
const CONSEQUENCE = "absent from any figure counted per truck";

export interface RowCoverage {
  /** Rows matching the current filters — the denominator, and the whole set rather than one page. */
  rows: number;
  /** Of those, how many name a truck on this fleet. */
  attributed: number;
  /** The remainder. Printed exactly: a share is a summary, the count is what a reader acts on. */
  unattributed: number;
  /** Attributed share as a whole percent, FLOORED. Null when there are no rows to take a share of. */
  attributedPercent: number | null;
  /** True when every matching row names a truck — the reassuring half of the same fact. */
  complete: boolean;
  /** One sentence. Null when there is nothing to qualify, i.e. the list is empty. */
  lead: string | null;
}

const fmt = (n: number): string => n.toLocaleString("en-US");

/**
 * @param surface which list is being qualified — selects the noun and the consequence clause
 * @param rows    rows matching the current filters (not one page of them)
 * @param attributed how many of those name a truck
 */
export function describeRowCoverage(surface: CoverageSurface, rows: number, attributed: number): RowCoverage {
  // A negative or over-large `attributed` can only come from two counts read a moment apart while the
  // feed was writing. Clamping keeps a transient race from printing "104% of these name a truck",
  // which would discredit the line permanently for a state that lasts one refresh.
  const safeRows = Math.max(0, Math.floor(rows));
  const safeAttributed = Math.min(safeRows, Math.max(0, Math.floor(attributed)));
  const unattributed = safeRows - safeAttributed;

  if (safeRows === 0) {
    // The empty state under the table already explains an empty list, and it explains it better —
    // it names the filters. A second sentence saying nothing happened is noise above a blank table.
    return { rows: 0, attributed: 0, unattributed: 0, attributedPercent: null, complete: true, lead: null };
  }

  // Floored, so a share can never read as complete while the remainder is not zero. See the header.
  const attributedPercent = Math.floor((safeAttributed / safeRows) * 100);
  const noun = ROW_NOUN[surface];
  const rowWord = safeRows === 1 ? noun.one : noun.many;

  if (unattributed === 0) {
    return {
      rows: safeRows, attributed: safeAttributed, unattributed: 0, attributedPercent, complete: true,
      lead: `All ${fmt(safeRows)} ${rowWord} in this list name a truck on the fleet.`,
    };
  }

  // "The other 1 decline are absent" is the sentence a naive plural produces, and it is the tell that
  // nobody read the output. One row gets its own clause rather than a pluralisation patch.
  const remainder =
    unattributed === 1
      ? `The one that does not is ${CONSEQUENCE}.`
      : `The other ${fmt(unattributed)} ${noun.many} are ${CONSEQUENCE}.`;

  return {
    rows: safeRows, attributed: safeAttributed, unattributed, attributedPercent, complete: false,
    lead: `${attributedPercent}% of the ${fmt(safeRows)} ${rowWord} in this list name a truck on the fleet. ${remainder}`,
  };
}
