/**
 * Was each fill billed at the price Pilot contracted for it?
 *
 * ── WHY THIS REPLACED THE MEDIAN BENCHMARK ON THE FEED ───────────────────────────────────────────
 * `discountCapture.ts` scores a fill against the MEDIAN discount of the fills around it, because for a
 * parsed vendor statement that is the only benchmark that exists. It is still the right analyzer for
 * that source, and it is still exported for it.
 *
 * It is the wrong one for the EFS feed, because the feed has something better. The daily Pilot "Better
 * Of Pricing Report" carries "Your Price" — the fleet's net per-gallon with the contract discount
 * already applied — for all 683 sites, and since 0245 those are kept rather than deleted by the next
 * upload. `fuel_spend_lines` (0247) joins it onto every fill. So the question stops being "did this
 * fill do as well as our other fills" and becomes "did this fill cost what we were quoted", which is
 * the question the carrier actually has and the only one a vendor can be held to.
 *
 * The median cannot answer it, and not by a small margin. A median measures the carrier against itself:
 * a week where every station billed uniformly over contract moves the median with it and reports
 * nothing wrong. Measured on production over 2026-08-02 → 2026-08-25, tractor diesel:
 *
 *     1,479 fills · 1,409 quoted (95.3%) · 1,314 billed at contract to $0.0005/gal (93.3% of quoted)
 *     19 fills over contract  +$177.76      10 under  −$75.30      net +$96.10 on $849,912.65 (0.011%)
 *     captured against posted retail: $93,281.86
 *
 * $177.76 spread across 1,409 fills does not move a median by anything a report could show. Against the
 * contract each of those 19 fills has a station, a date and a dollar figure attached — the difference
 * between a number to worry about and a line to take to the vendor.
 *
 * ── WHAT IS NOT MEASURED IS SAID, NOT ASSUMED ────────────────────────────────────────────────────
 * A fill with no quote in range (off-network, an unresolved site, a station missing from the report) is
 * UNMEASURED. It is counted and reported separately, never folded into the variance as though it had
 * been billed correctly. Zero variance and no measurement look identical in a total and mean opposite
 * things, which is the failure this module is built around.
 */
import { weekOf, type SpendLine } from "./types.js";

/**
 * Per-gallon deviation below which a fill counts as billed AT contract.
 *
 * Not zero: EFS bills a per-gallon price at four decimals and a total rounded to the cent, so exact
 * equality is not a property the arithmetic can guarantee. Measured on production, 1,314 of 1,409
 * quoted fills land within $0.0005/gal and a further 66 sit between that and a cent — vendor rounding,
 * not a repricing. Only 29 exceed a cent, and those are the ones worth a reader's attention. A cent on
 * a 150-gallon fill is $1.50; the threshold is deliberately low enough that a real repricing cannot
 * hide under it.
 */
export const CONTRACT_TOLERANCE_PER_GAL = 0.01;

/** A fill measured against its own contracted price. */
export interface ContractLine {
  line: SpendLine;
  gallons: number;
  /** What EFS billed. */
  paid: number;
  /** "Your Price" × gallons. */
  expected: number;
  /** paid − expected. POSITIVE means billed above contract; negative means below it. */
  variance: number;
  paidPerGal: number;
  contractPerGal: number;
  variancePerGal: number;
  /** Posted retail − paid, i.e. the discount actually taken. Null when no posted price was in range. */
  captured: number | null;
  /** 0 when the quote was that day's, 1 when carried forward from the day before. */
  staleDays: number | null;
}

export interface ContractRollup {
  key: string;
  lines: number;
  gallons: number;
  paid: number;
  expected: number;
  variance: number;
  variancePerGal: number;
}

export interface ContractCapture {
  /** Fills that had a quote and could therefore be measured at all. */
  measuredLines: number;
  measuredGallons: number;
  paid: number;
  expected: number;
  /** paid − expected across every measured fill. Positive is money billed above contract. */
  netVariance: number;
  /** Weighted actual and contracted cost per gallon — the two headline rates. */
  paidPerGal: number | null;
  contractPerGal: number | null;

  /** Billed at contract, within `CONTRACT_TOLERANCE_PER_GAL`. */
  honouredLines: number;
  /** Share of measured fills billed at contract, 0–1. Null when nothing was measurable. */
  honouredShare: number | null;

  overLines: number;
  /** Dollars billed above contract, counting only fills beyond tolerance. Always ≥ 0. */
  overDollars: number;
  underLines: number;
  /** Dollars billed below contract, counting only fills beyond tolerance. Always ≤ 0. */
  underDollars: number;

  /** Posted retail − paid, over the fills that had a posted price. What the deal is worth. */
  captured: number;
  capturedPerGal: number | null;
  capturedLines: number;

  /** Fills with no quote in range. Reported, never scored. */
  unmeasuredLines: number;
  unmeasuredGallons: number;
  unmeasuredPaid: number;
  /**
   * ── THE FIGURE THAT TELLS THE READER HOW BIG THE ANSWER IS ────────────────────────────────────
   *
   * `paid ÷ (paid + unmeasuredPaid)` — the share of in-scope fuel spend this whole analysis covers.
   * Null when nothing is in scope.
   *
   * The module already reports `unmeasuredLines` and the surface already prints it, but as a caveat
   * BELOW the headline rather than as part of it, and as a count of fills rather than a share of
   * dollars. Measured on production 2026-08-25 over the default 90-day window, that gap is not
   * cosmetic:
   *
   *     5,552 tractor fills · $3,056,926 paid
   *     1,409 quoted (25.4% of fills) · $849,913 measurable (27.8% of SPEND)
   *
   * `fuel_prices` held 20 days, 2026-08-02 → 2026-08-25, and nothing before it — a historical gap,
   * not an operational one, and one a backfill closes without any code. Until it is closed, a net
   * variance rendered as a fleet-wide finding describes just over a quarter of the bill. A dollar
   * figure whose denominator is not beside it is the same defect as `totalsOf` dividing a partial
   * retail sum by every gallon; this is the field that lets a consumer avoid it.
   */
  measuredSpendShare: number | null;
  /** Of the measured fills, how many used a quote carried forward from the previous day. */
  carriedForwardLines: number;

  /** Every fill beyond tolerance, worst overcharge first. This is the actionable list. */
  exceptions: ContractLine[];
  bySite: ContractRollup[];
  byBrand: ContractRollup[];
  byState: ContractRollup[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Measurable means: propulsion diesel, real gallons, a price we were billed, and a quote to compare it
 * to. Reefer fuel is excluded for the same reason it is excluded everywhere else in this module — it is
 * dyed off-road diesel bought under different terms and must never be scored as tractor fuel.
 */
const isMeasurable = (l: SpendLine): boolean =>
  l.product === "diesel" &&
  l.tank !== "reefer" &&
  l.gallons > 0 &&
  l.netAmount != null &&
  l.contractAmount != null;

/** In scope for the question, whether or not a quote turned up for it. */
const isInScope = (l: SpendLine): boolean =>
  l.product === "diesel" && l.tank !== "reefer" && l.gallons > 0 && l.netAmount != null;

function rollup(lines: readonly ContractLine[], key: (l: SpendLine) => string | null): ContractRollup[] {
  const m = new Map<string, ContractLine[]>();
  for (const c of lines) {
    const k = key(c.line);
    if (k == null) continue;
    const b = m.get(k);
    if (b) b.push(c);
    else m.set(k, [c]);
  }
  return [...m.entries()]
    .map(([k, cs]) => {
      const gallons = cs.reduce((a, c) => a + c.gallons, 0);
      const variance = cs.reduce((a, c) => a + c.variance, 0);
      return {
        key: k,
        lines: cs.length,
        gallons: r2(gallons),
        paid: r2(cs.reduce((a, c) => a + c.paid, 0)),
        expected: r2(cs.reduce((a, c) => a + c.expected, 0)),
        variance: r2(variance),
        variancePerGal: gallons > 0 ? r4(variance / gallons) : 0,
      };
    })
    .sort((a, b) => b.variance - a.variance);
}

export function analyzeContractCapture(lines: readonly SpendLine[]): ContractCapture {
  const inScope = lines.filter(isInScope);
  const measured = inScope.filter(isMeasurable);
  const unmeasured = inScope.filter((l) => !isMeasurable(l));

  const scored: ContractLine[] = measured.map((l) => {
    const paid = l.netAmount!;
    const expected = l.contractAmount!;
    const variance = paid - expected;
    return {
      line: l,
      gallons: l.gallons,
      paid,
      expected,
      variance,
      paidPerGal: paid / l.gallons,
      contractPerGal: expected / l.gallons,
      variancePerGal: variance / l.gallons,
      captured: l.retailAmount == null ? null : l.retailAmount - paid,
      staleDays: l.quoteStaleDays ?? null,
    };
  });

  const beyond = scored.filter((c) => Math.abs(c.variancePerGal) > CONTRACT_TOLERANCE_PER_GAL);
  const over = beyond.filter((c) => c.variancePerGal > 0);
  const under = beyond.filter((c) => c.variancePerGal < 0);
  const withRetail = scored.filter((c) => c.captured != null);

  const measuredGallons = scored.reduce((a, c) => a + c.gallons, 0);
  const paid = scored.reduce((a, c) => a + c.paid, 0);
  const expected = scored.reduce((a, c) => a + c.expected, 0);
  const capturedGallons = withRetail.reduce((a, c) => a + c.gallons, 0);
  const captured = withRetail.reduce((a, c) => a + c.captured!, 0);
  // The denominator the headline is measured against: every in-scope dollar, priced or not.
  const unmeasuredPaid = unmeasured.reduce((a, l) => a + (l.netAmount ?? 0), 0);
  const inScopePaid = paid + unmeasuredPaid;

  return {
    measuredLines: scored.length,
    measuredGallons: r2(measuredGallons),
    paid: r2(paid),
    expected: r2(expected),
    netVariance: r2(paid - expected),
    paidPerGal: measuredGallons > 0 ? r4(paid / measuredGallons) : null,
    contractPerGal: measuredGallons > 0 ? r4(expected / measuredGallons) : null,

    honouredLines: scored.length - beyond.length,
    honouredShare: scored.length > 0 ? (scored.length - beyond.length) / scored.length : null,

    overLines: over.length,
    overDollars: r2(over.reduce((a, c) => a + c.variance, 0)),
    underLines: under.length,
    underDollars: r2(under.reduce((a, c) => a + c.variance, 0)),

    captured: r2(captured),
    capturedPerGal: capturedGallons > 0 ? r4(captured / capturedGallons) : null,
    capturedLines: withRetail.length,

    unmeasuredLines: unmeasured.length,
    unmeasuredGallons: r2(unmeasured.reduce((a, l) => a + l.gallons, 0)),
    unmeasuredPaid: r2(unmeasuredPaid),
    measuredSpendShare: inScopePaid > 0 ? paid / inScopePaid : null,
    carriedForwardLines: scored.filter((c) => (c.staleDays ?? 0) > 0).length,

    exceptions: [...beyond].sort((a, b) => b.variance - a.variance),
    bySite: rollup(scored, (l) => (l.site ? `${l.site} ${l.city ?? ""} ${l.state ?? ""}`.trim() : null)),
    byBrand: rollup(scored, (l) => l.brand ?? "(independent)"),
    byState: rollup(scored, (l) => l.state),
  };
}

/** Per-week reconciliation — the series behind the tab's "by week" card. */
export function weeklyContractCapture(
  lines: readonly SpendLine[],
): Array<{ week: string; paidPerGal: number | null; contractPerGal: number | null; netVariance: number; overLines: number; measuredLines: number }> {
  const byWeek = new Map<string, SpendLine[]>();
  for (const l of lines) {
    if (!l.tranDate) continue;
    const k = weekOf(l.tranDate);
    const b = byWeek.get(k);
    if (b) b.push(l);
    else byWeek.set(k, [l]);
  }
  return [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([week, ls]) => {
      const c = analyzeContractCapture(ls);
      return {
        week,
        paidPerGal: c.paidPerGal,
        contractPerGal: c.contractPerGal,
        netVariance: c.netVariance,
        overLines: c.overLines,
        measuredLines: c.measuredLines,
      };
    });
}
