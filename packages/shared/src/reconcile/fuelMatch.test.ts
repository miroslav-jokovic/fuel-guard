import { describe, it, expect } from "vitest";
import {
  reconcileFuelReport,
  RECON_STATUS_LABELS,
  type ReconStatus,
  type SystemFill,
} from "./fuelMatch.js";
import type { PilotReportFill } from "./pilotFuelReport.js";

/**
 * The matcher's matrix. The suite it replaces had eight single-row cases and could not see any of the
 * defects the 2026-08-25 audit found — every one of them needs two rows, two dates, or two orderings.
 *
 * Real card numbers matter here: the whole of D-FR6 is that the last FOUR digits collide (39 groups
 * across the 171 cards actually in use, 460 day-buckets holding more than one physical card) and the
 * last six do not. So the PANs below share their last four on purpose.
 */

const PAN_A = "7083050030490367971"; // last6 367971, last4 7971
const PAN_B = "7083050030490317971"; // last6 317971, last4 7971  ← same last four, different truck

const rf = (o: Partial<PilotReportFill> & { rowNumber: number }): PilotReportFill => ({
  authNo: "a1", unit: "701", cardRef: "367971", site: "436", city: "Amarillo", state: "TX",
  gallons: 100, netAmount: 500, retailAmount: 560, tranDate: "2026-08-17", time: "12:00",
  product: "diesel", productCode: "020", productDescription: "Truck Diesel", ...o,
});

const sf = (o: Partial<SystemFill> & { id: string }): SystemFill => ({
  cardRef: PAN_A, controlId: null, unit: "701", fueledAt: "2026-08-17T18:00:00Z",
  tranDate: "2026-08-17", tank: "tractor", gallons: 100, totalCost: 500, ...o,
});

const WINDOW = { from: "2026-08-17", to: "2026-08-23" };
const run = (r: PilotReportFill[], s: SystemFill[], o = {}) =>
  reconcileFuelReport(r, s, { window: WINDOW, ...o });
const statuses = (r: ReturnType<typeof run>): ReconStatus[] => r.rows.map((x) => x.status).sort();

describe("reconcileFuelReport", () => {
  it("matches a fill that agrees, and says which key placed it", () => {
    const r = run([rf({ rowNumber: 1 })], [sf({ id: "s1" })]);
    expect(r.summary.clean).toBe(1);
    expect(r.summary.matchedOnCard6).toBe(1);
    expect(r.summary.matchedOnCard4).toBe(0);
    expect(r.rows[0]!.basis).toBe("card6");
  });

  // ── D-FR6: the last four digits are not a key ────────────────────────────────────────────────
  it("does not pair two trucks whose cards share their last four digits", () => {
    // Both fills on the same day, both cards ending 7971, different gallons. On last-4 the report line
    // could take either; on last-6 there is exactly one right answer.
    const r = run(
      [rf({ rowNumber: 1, cardRef: "317971", gallons: 80, netAmount: 400 })],
      [sf({ id: "sA", cardRef: PAN_A, gallons: 100, totalCost: 500 }),
       sf({ id: "sB", cardRef: PAN_B, gallons: 80, totalCost: 400 })],
    );
    const matched = r.rows.find((x) => x.system != null && x.report != null);
    expect(matched?.system?.id).toBe("sB"); // the truck whose card actually ends 317971
    expect(matched?.status).toBe("clean");
    expect(r.summary.matchedOnCard6).toBe(1);
  });

  it("falls back to four digits when the report prints only four, and labels the weaker claim", () => {
    const r = run([rf({ rowNumber: 1, cardRef: "7971" })], [sf({ id: "s1", cardRef: PAN_A })]);
    expect(r.summary.clean).toBe(1);
    expect(r.summary.matchedOnCard4).toBe(1);
    expect(r.summary.matchedOnCard6).toBe(0);
  });

  // ── L5: order independence ───────────────────────────────────────────────────────────────────
  it("pairs two fills on one card and day by cost, not by which row came first", () => {
    // Row 1 is nearer to s2, row 2 is nearer to s1. A first-come scan gives row 1 the wrong fill and
    // mis-flags both; cost-ordered matching cannot.
    const report = [
      rf({ rowNumber: 1, gallons: 60, netAmount: 300 }),
      rf({ rowNumber: 2, gallons: 140, netAmount: 700 }),
    ];
    const system = [sf({ id: "s1", gallons: 140, totalCost: 700 }), sf({ id: "s2", gallons: 60, totalCost: 300 })];
    const r = run(report, system);
    expect(r.summary.clean).toBe(2);
    expect(r.rows.find((x) => x.report?.rowNumber === 1)?.system?.id).toBe("s2");
    expect(r.rows.find((x) => x.report?.rowNumber === 2)?.system?.id).toBe("s1");
  });

  it("gives the same answer whatever order the file arrives in", () => {
    const report = [
      rf({ rowNumber: 1, gallons: 60, netAmount: 300 }),
      rf({ rowNumber: 2, gallons: 140, netAmount: 700 }),
      rf({ rowNumber: 3, gallons: 100, netAmount: 500, cardRef: "317971" }),
    ];
    const system = [
      sf({ id: "s1", gallons: 140, totalCost: 700 }),
      sf({ id: "s2", gallons: 60, totalCost: 300 }),
      sf({ id: "s3", gallons: 100, totalCost: 500, cardRef: PAN_B }),
    ];
    const canonical = JSON.stringify(
      run(report, system).rows.map((x) => [x.report?.rowNumber ?? null, x.system?.id ?? null, x.status]).sort(),
    );
    // Every permutation of a three-row file must reconcile identically. A vendor cannot be sent a
    // finding that depends on how their own export happened to be sorted.
    // Both sides permuted INDEPENDENTLY: shuffling them in step can leave a first-come scan looking
    // stable by coincidence, which is how a weaker version of this test passed against the old matcher.
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const pr of perms) {
      for (const ps of perms) {
        const got = JSON.stringify(
          run(pr.map((i) => report[i]!), ps.map((i) => system[i]!))
            .rows.map((x) => [x.report?.rowNumber ?? null, x.system?.id ?? null, x.status]).sort(),
        );
        expect(got, `report ${pr.join("")} / system ${ps.join("")} reconciled differently`).toBe(canonical);
      }
    }
  });

  // ── D-FX4: a day of drift is one finding, not two ────────────────────────────────────────────
  it("reports a fill dated a day apart as ONE matched row, not a pair of false findings", () => {
    const r = run([rf({ rowNumber: 1, tranDate: "2026-08-18" })], [sf({ id: "s1", tranDate: "2026-08-17" })]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.status).toBe("date_drift");
    expect(r.rows[0]!.dayDelta).toBe(1);
    expect(r.summary.missingInSystem).toBe(0);
    expect(r.summary.missingOnReport).toBe(0);
    // And it contributes nothing to exposure, because the two sides agree about the money.
    expect(r.summary.exposure.unrecorded).toBe(0);
    expect(r.summary.exposure.unbilled).toBe(0);
  });

  it("drifts in both directions", () => {
    const back = run([rf({ rowNumber: 1, tranDate: "2026-08-17" })], [sf({ id: "s1", tranDate: "2026-08-18" })]);
    expect(back.rows[0]!.status).toBe("date_drift");
    expect(back.rows[0]!.dayDelta).toBe(-1);
  });

  it("prefers a same-day fill over a drifted one even when the drifted one is nearer on gallons", () => {
    const r = run(
      [rf({ rowNumber: 1, gallons: 100, netAmount: 500 })],
      [sf({ id: "sameDay", gallons: 103, totalCost: 515, tranDate: "2026-08-17" }),
       sf({ id: "drifted", gallons: 100, totalCost: 500, tranDate: "2026-08-16" })],
    );
    expect(r.rows.find((x) => x.report != null)?.system?.id).toBe("sameDay");
  });

  it("does not reach two days for a match", () => {
    const r = run([rf({ rowNumber: 1, tranDate: "2026-08-19" })], [sf({ id: "s1", tranDate: "2026-08-17" })]);
    expect(statuses(r)).toEqual(["missing_in_system", "missing_on_report"]);
  });

  // ── L4: unknown is not disagreement ──────────────────────────────────────────────────────────
  it("says the amount was never recorded rather than calling it a mismatch worth nothing", () => {
    const r = run([rf({ rowNumber: 1 })], [sf({ id: "s1", totalCost: null })]);
    expect(r.rows[0]!.status).toBe("amount_unknown");
    expect(r.summary.amountMismatch).toBe(0);
    expect(r.summary.exposure.overbilled).toBe(0);
    expect(r.summary.exposure.underbilled).toBe(0);
  });

  // ── L7 / D-FR7: product classes never cross ──────────────────────────────────────────────────
  it("never pairs a reefer line with a tractor fill", () => {
    const r = run(
      [rf({ rowNumber: 1, productCode: "033", productDescription: "Reefer", gallons: 30, netAmount: 160 })],
      [sf({ id: "s1", tank: "tractor", gallons: 30, totalCost: 160 })],
    );
    expect(statuses(r)).toEqual(["missing_in_system", "missing_on_report"]);
  });

  it("pairs a reefer line with the reefer fill", () => {
    const r = run(
      [rf({ rowNumber: 1, productCode: "033", productDescription: "Reefer", gallons: 30, netAmount: 160 })],
      [sf({ id: "s1", tank: "reefer", gallons: 30, totalCost: 160 })],
    );
    expect(r.summary.clean).toBe(1);
  });

  it("sets DEF and merchandise aside instead of calling them fuel we never recorded", () => {
    // `fuel_transactions` carries no DEF at all, so a DEF line has nothing on our side to match and
    // must never be scored as a billed-but-unrecorded fill.
    const r = run(
      [rf({ rowNumber: 1, productCode: "140", productDescription: "Diesel Exhaust Fluid", gallons: 9, netAmount: 45 }),
       rf({ rowNumber: 2, productCode: "400", productDescription: "Miscellaneous", gallons: 1, netAmount: 12.99 })],
      [],
    );
    expect(r.rows).toHaveLength(0);
    expect(r.unmatchable).toHaveLength(2);
    expect(r.summary.exposure.unrecorded).toBe(0);
  });

  // ── L9: a card-less line stands alone ────────────────────────────────────────────────────────
  it("does not bucket two card-less lines together just because neither has a card", () => {
    const r = run(
      [rf({ rowNumber: 1, cardRef: null, gallons: 100, netAmount: 500 })],
      [sf({ id: "s1", cardRef: null, gallons: 100, totalCost: 500 })],
    );
    // It may still be placed on date and gallons — but the claim is labelled, never called clean.
    expect(r.rows[0]!.status).toBe("card_drift");
    expect(r.rows[0]!.basis).toBe("date_gallons");
    expect(r.summary.matchedOnCard6).toBe(0);
  });

  // ── L6: the window is the report's, not the fills' ───────────────────────────────────────────
  it("flags a recorded fill on a day the report billed nothing", () => {
    // The old matcher took min/max of the fills it FOUND, so a fill on a day with no report line was
    // silently dropped from `missing_on_report` — the exact opposite of flagging it.
    const r = run([rf({ rowNumber: 1, tranDate: "2026-08-17" })], [
      sf({ id: "s1", tranDate: "2026-08-17" }),
      sf({ id: "s2", tranDate: "2026-08-22", cardRef: PAN_B, gallons: 90, totalCost: 450 }),
    ]);
    expect(r.summary.clean).toBe(1);
    expect(r.summary.missingOnReport).toBe(1);
  });

  it("leaves a fill outside the report's window alone", () => {
    const r = run([rf({ rowNumber: 1 })], [
      sf({ id: "s1" }),
      sf({ id: "s2", tranDate: "2026-09-05", cardRef: PAN_B }),
    ]);
    expect(r.summary.missingOnReport).toBe(0);
  });

  // ── D-FX5: four exposures, never their sum ───────────────────────────────────────────────────
  it("reports the four kinds of money apart", () => {
    const r = run(
      [
        rf({ rowNumber: 1, netAmount: 540 }),                                       // billed $40 over
        rf({ rowNumber: 2, cardRef: "317971", gallons: 90, netAmount: 430 }),        // billed $20 under
        rf({ rowNumber: 3, cardRef: "999999", gallons: 70, netAmount: 350, tranDate: "2026-08-20" }), // never recorded
      ],
      [
        sf({ id: "s1", totalCost: 500 }),
        sf({ id: "s2", cardRef: PAN_B, gallons: 90, totalCost: 450 }),
        sf({ id: "s3", cardRef: "7083050030490355555", gallons: 60, totalCost: 300, tranDate: "2026-08-21" }), // never billed
      ],
    );
    const e = r.summary.exposure;
    expect(e.overbilled).toBe(40);
    expect(e.overbilledLines).toBe(1);
    expect(e.underbilled).toBe(20);
    expect(e.underbilledLines).toBe(1);
    expect(e.unrecorded).toBe(350);
    expect(e.unrecordedLines).toBe(1);
    expect(e.unbilled).toBe(300);
    expect(e.unbilledLines).toBe(1);
    // The figure this replaces would have read $710 "at stake" — recoverable, owed and unexplained
    // money added together. Nothing in the result is that number.
    expect(Object.values(e)).not.toContain(710);
  });

  it("does not call a cent of rounding an overbill", () => {
    // EFS bills a four-decimal per-gallon rate and rounds the total to the cent, so a cent of
    // disagreement is arithmetic. Measured against the five real statements, an earlier version of this
    // summary reported "85 lines overbilled" on a week whose overbilling came to ONE DOLLAR. The line
    // count is the part a reader reacts to.
    const r = run([rf({ rowNumber: 1, netAmount: 500.01 })], [sf({ id: "s1", totalCost: 500 })]);
    expect(r.rows[0]!.status).toBe("clean");
    expect(r.summary.exposure.overbilledLines).toBe(0);
    expect(r.summary.exposure.overbilled).toBe(0);
  });

  it("counts a $50 overbill and a $50 underbill as two facts, not as $100 of exposure", () => {
    const r = run(
      [rf({ rowNumber: 1, netAmount: 550 }), rf({ rowNumber: 2, cardRef: "317971", gallons: 90, netAmount: 400 })],
      [sf({ id: "s1", totalCost: 500 }), sf({ id: "s2", cardRef: PAN_B, gallons: 90, totalCost: 450 })],
    );
    expect(r.summary.exposure.overbilled).toBe(50);
    expect(r.summary.exposure.underbilled).toBe(50);
  });

  // ── the vocabulary ───────────────────────────────────────────────────────────────────────────
  it("has a reader's word for every status it can produce", () => {
    const produced: ReconStatus[] = [
      "clean", "amount_mismatch", "gallon_mismatch", "amount_unknown",
      "date_drift", "card_drift", "missing_in_system", "missing_on_report", "other",
    ];
    for (const s of produced) {
      expect(RECON_STATUS_LABELS[s], `no label for ${s}`).toBeTruthy();
      expect(RECON_STATUS_LABELS[s]).not.toContain("_");
    }
  });

  /**
   * ── THE GOLDEN CORPUS ─────────────────────────────────────────────────────────────────────────
   * A week at the real fleet's shape: ~450 fuel lines a week over 171 cards, a DEF line on most
   * tickets, a handful of reefer, and the defects that actually occur — a drifted day, an overbill, a
   * fill we never recorded, a fill the vendor never billed.
   *
   * It is GENERATED rather than copied. The five real statements and the production fills they were
   * verified against are a carrier's billing records, and this repository is not where those live —
   * `data-samples/` is gitignored for the same reason. What the generator preserves is the SHAPE: the
   * card distribution (last-4 collisions and all), the product mix, and the failure modes. What it
   * gives up is the right to claim the numbers are Silvicom's.
   *
   * Its job is to make a change to the matcher state what it moved. Any edit that shifts a bucket
   * turns this red with the old and new counts side by side.
   */
  describe("a full week, golden", () => {
    const WEEK = { from: "2026-08-17", to: "2026-08-23" };
    const day = (i: number) => ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"][i % 7]!;
    // 40 trucks whose cards deliberately collide on their last four, as the real fleet's do.
    const pan = (i: number) => `70830500304903${String(10 + (i % 40)).padStart(2, "0")}7971`;

    function corpus() {
      const report: PilotReportFill[] = [];
      const system: SystemFill[] = [];
      for (let i = 0; i < 300; i++) {
        const gallons = 80 + (i % 60);
        const net = Math.round(gallons * 5.12 * 100) / 100;
        const d = day(i);
        report.push(rf({ rowNumber: i + 1, cardRef: pan(i).slice(-6), gallons, netAmount: net, tranDate: d, unit: `u${i % 40}` }));
        system.push(sf({ id: `s${String(i).padStart(4, "0")}`, cardRef: pan(i), gallons, totalCost: net, tranDate: d }));
        // A DEF line on every third ticket — billed, and never present in `fuel_transactions`.
        if (i % 3 === 0) {
          report.push(rf({ rowNumber: 1000 + i, cardRef: pan(i).slice(-6), gallons: 9, netAmount: 45, tranDate: d, productCode: "140", productDescription: "Diesel Exhaust Fluid" }));
        }
        // Reefer on every twentieth, matched against a reefer fill.
        if (i % 20 === 0) {
          report.push(rf({ rowNumber: 2000 + i, cardRef: pan(i).slice(-6), gallons: 30, netAmount: 160, tranDate: d, productCode: "033", productDescription: "Reefer" }));
          system.push(sf({ id: `r${String(i).padStart(4, "0")}`, cardRef: pan(i), tank: "reefer", gallons: 30, totalCost: 160, tranDate: d }));
        }
      }
      return { report, system };
    }

    it("holds its counts", () => {
      const { report, system } = corpus();
      // Four planted defects. The two "missing" ones use cards belonging to no truck in the corpus and
      // sharing no last-four with it — otherwise the last-4 fallback finds them a partner, which is
      // realistic behaviour but makes a golden about something else.
      const LONE_A = "7083050030490990123";
      const LONE_B = "7083050030490990456";
      report.push(rf({ rowNumber: 9001, cardRef: LONE_A.slice(-6), gallons: 120, netAmount: 700, tranDate: "2026-08-19" })); // billed, never recorded
      system.push(sf({ id: "z001", cardRef: LONE_B, gallons: 111, totalCost: 560, tranDate: "2026-08-20" }));                // recorded, never billed
      // Row 5 is i=4, which the generator dated the 21st. One day earlier, and exactly one.
      const drifted = report.find((r) => r.rowNumber === 5)!;
      (drifted as { tranDate: string | null }).tranDate = "2026-08-20";
      const over = report.find((r) => r.rowNumber === 9)!;
      (over as { netAmount: number | null }).netAmount = (over.netAmount ?? 0) + 60;  // billed $60 over

      const r = reconcileFuelReport(report, system, { window: WEEK });
      const s = r.summary;

      expect(s.reportLines).toBe(316);       // 300 tractor + 15 reefer + the planted unrecorded line
      expect(r.unmatchable).toHaveLength(100); // every DEF line, set aside rather than scored
      expect(s.clean).toBe(313);
      expect(s.dateDrift).toBe(1);
      expect(s.amountMismatch).toBe(1);
      expect(s.missingInSystem).toBe(1);
      expect(s.missingOnReport).toBe(1);
      expect(s.cardDrift).toBe(0);
      expect(s.gallonMismatch).toBe(0);
      expect(s.amountUnknown).toBe(0);
      // Every match placed on six digits, exactly as the five real statements did (2,314 of 2,314).
      expect(s.matchedOnCard6).toBe(315);     // every pairing; the one unmatched line has no partner
      expect(s.matchedOnCard4).toBe(0);
      expect(s.matchedOnDateGallons).toBe(0);

      expect(s.exposure.overbilled).toBe(60);
      expect(s.exposure.overbilledLines).toBe(1);
      expect(s.exposure.unrecorded).toBe(700);
      expect(s.exposure.unbilled).toBe(560);
      expect(s.exposure.underbilled).toBe(0);
    });

    it("is stable when the whole week arrives reversed", () => {
      const { report, system } = corpus();
      const forward = reconcileFuelReport(report, system, { window: WEEK }).summary;
      const backward = reconcileFuelReport([...report].reverse(), [...system].reverse(), { window: WEEK }).summary;
      expect(backward).toEqual(forward);
    });
  });

  it("reconciles an empty report against an empty system without inventing anything", () => {
    const r = run([], []);
    expect(r.rows).toHaveLength(0);
    expect(r.summary.exposure.unrecorded).toBe(0);
  });
});
