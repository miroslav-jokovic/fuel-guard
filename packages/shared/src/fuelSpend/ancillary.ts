/**
 * Everything on the fuel bill that is not tractor fuel (WP5, plan §4.7).
 *
 * Reported because it is invisible today and adds up: in one 2026-08 week the EFS feed carried 172 CAT
 * Scale weighings ($2,208 — roughly $115k/year), and the statement itself carried in-store merchandise
 * billed straight onto fuel tickets.
 *
 * ── THE DEF RATIO IS THE ONE WORTH WATCHING ──────────────────────────────────────────────────────
 * Modern diesels consume DEF at 2–3% of fuel volume. Silvicom bought 2,412 gal of DEF against 57,903
 * gal of diesel in the 2026-08-17 week — 4.2%, meaningfully above what the engines can burn. That gap
 * is either over-purchase, spillage, or DEF leaving in containers, and none of the three is visible
 * from a fuel-only report.
 */
import { totalsOf, type SpendLine } from "./types.js";

/** Where dosing normally lands, as a share of diesel volume. Outside this band is worth a look. */
export const DEF_EXPECTED_RATIO = { low: 0.02, high: 0.03 } as const;

export interface AncillarySpend {
  tractorFuel: { gallons: number; spend: number };
  reeferFuel: { gallons: number; spend: number; lines: number };
  def: {
    gallons: number;
    spend: number;
    lines: number;
    perGal: number | null;
    /** DEF volume ÷ tractor diesel volume. */
    ratio: number | null;
    /** true when the ratio sits outside DEF_EXPECTED_RATIO — a prompt to look, not a verdict. */
    outsideExpected: boolean;
  };
  /** In-store purchases billed to the fuel card, including those bundled onto a fuel ticket. */
  merchandise: { lines: number; spend: number };
  salesTax: number;
  /** Non-fuel share of the total bill. */
  nonFuelShare: number | null;
}

export function analyzeAncillary(lines: readonly SpendLine[]): AncillarySpend {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const tractor = totalsOf(lines.filter((l) => l.product === "diesel" && l.tank !== "reefer" && l.gallons > 0));
  const reefer = totalsOf(lines.filter((l) => l.tank === "reefer" && l.gallons > 0));
  const defLines = lines.filter((l) => l.product === "def" && l.gallons > 0);
  const def = totalsOf(defLines);

  // Merchandise is a CHARGE, not a line type: a fuel line can carry one on the same ticket, so this
  // sums the column rather than counting standalone rows.
  const merchLines = lines.filter((l) => (l.miscAmount ?? 0) > 0);
  const merchandise = r2(merchLines.reduce((a, l) => a + (l.miscAmount ?? 0), 0));
  const salesTax = r2(lines.reduce((a, l) => a + (l.salesTax ?? 0), 0));

  const ratio = tractor.gallons > 0 ? def.gallons / tractor.gallons : null;
  const total = tractor.net + reefer.net + def.net + merchandise + salesTax;

  return {
    tractorFuel: { gallons: tractor.gallons, spend: tractor.net },
    reeferFuel: { gallons: reefer.gallons, spend: reefer.net, lines: reefer.lines },
    def: {
      gallons: def.gallons,
      spend: def.net,
      lines: def.lines,
      perGal: def.netPerGal,
      ratio,
      outsideExpected: ratio != null && (ratio < DEF_EXPECTED_RATIO.low || ratio > DEF_EXPECTED_RATIO.high),
    },
    merchandise: { lines: merchLines.length, spend: merchandise },
    salesTax,
    nonFuelShare: total > 0 ? (reefer.net + def.net + merchandise + salesTax) / total : null,
  };
}
