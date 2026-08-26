import { describe, it, expect } from "vitest";
import {
  contractFindings, fuelExceptionFingerprint, reconFindings,
  FUEL_EXCEPTION_KIND_LABELS, FUEL_EXCEPTION_KINDS,
  FUEL_EXCEPTION_STATUS_LABELS, FUEL_EXCEPTION_STATUSES,
} from "./exceptions.js";
import { reconcileFuelReport, type SystemFill } from "../reconcile/fuelMatch.js";
import { analyzeContractCapture } from "./contractCapture.js";
import type { PilotReportFill } from "../reconcile/pilotFuelReport.js";
import type { SpendLine } from "./types.js";

/**
 * The ledger's whole promise is that a finding found again is the SAME finding. That rests entirely on
 * the fingerprint being derived from what a finding is rather than from which run produced it, so most
 * of what is asserted here is stability across re-runs.
 */

const rf = (o: Partial<PilotReportFill> & { rowNumber: number }): PilotReportFill => ({
  authNo: "373364", unit: "701", cardRef: "367971", site: "436", city: "Amarillo", state: "TX",
  gallons: 100, netAmount: 500, retailAmount: 560, tranDate: "2026-08-17", time: "12:00",
  product: "diesel", productCode: "020", productDescription: "Truck Diesel", ...o,
});
const sf = (o: Partial<SystemFill> & { id: string }): SystemFill => ({
  cardRef: "7083050030490367971", controlId: null, unit: "701", fueledAt: "2026-08-17T18:00:00Z",
  tranDate: "2026-08-17", tank: "tractor", gallons: 100, totalCost: 500, ...o,
});
const WINDOW = { from: "2026-08-17", to: "2026-08-23" };

describe("the vocabulary", () => {
  it("has a reader's words for every kind and every status", () => {
    for (const k of FUEL_EXCEPTION_KINDS) {
      expect(FUEL_EXCEPTION_KIND_LABELS[k], `no label for ${k}`).toBeTruthy();
      expect(FUEL_EXCEPTION_KIND_LABELS[k]).not.toContain("_");
    }
    for (const s of FUEL_EXCEPTION_STATUSES) {
      expect(FUEL_EXCEPTION_STATUS_LABELS[s], `no label for ${s}`).toBeTruthy();
      expect(FUEL_EXCEPTION_STATUS_LABELS[s]).not.toContain("_");
    }
  });
});

describe("fuelExceptionFingerprint", () => {
  it("is not moved by case or surrounding space", () => {
    expect(fuelExceptionFingerprint("recon_amount", [" ABC "])).toBe(
      fuelExceptionFingerprint("recon_amount", ["abc"]),
    );
  });
  it("rounds a number to the cent, so float noise cannot mint a second identity", () => {
    // 100.001 and 100.0009 are the same fill measured twice, not two findings. (A value sitting
    // exactly on the .005 boundary genuinely can fall either way — that is rounding, not instability,
    // and no real gallon or dollar figure lands there.)
    expect(fuelExceptionFingerprint("recon_amount", [100.001])).toBe(
      fuelExceptionFingerprint("recon_amount", [100.0009]),
    );
  });
  it("keeps a missing part in place rather than letting the rest shift left", () => {
    // Without the placeholder, ["a", null, "b"] and ["a", "b"] would collide — two different findings
    // sharing an identity, and the second would silently inherit the first's status and owner.
    expect(fuelExceptionFingerprint("recon_amount", ["a", null, "b"]))
      .not.toBe(fuelExceptionFingerprint("recon_amount", ["a", "b"]));
  });
  it("never lets a part's own separator split it", () => {
    expect(fuelExceptionFingerprint("recon_amount", ["a|b"]).split("|")).toHaveLength(2);
  });
});

describe("reconFindings", () => {
  const result = () =>
    reconcileFuelReport(
      [
        rf({ rowNumber: 1 }),                                                        // clean
        rf({ rowNumber: 2, authNo: "999", cardRef: "999999", gallons: 70, netAmount: 350 }), // never recorded
        rf({ rowNumber: 3, cardRef: "317971", gallons: 90, netAmount: 500 }),        // billed $50 over
        rf({ rowNumber: 4, cardRef: "447971", tranDate: "2026-08-18" }),             // a day of drift
      ],
      [
        sf({ id: "s1" }),
        sf({ id: "s3", cardRef: "7083050030490317971", gallons: 90, totalCost: 450 }),
        sf({ id: "s4", cardRef: "7083050030490447971", tranDate: "2026-08-17" }),
        sf({ id: "s9", cardRef: "7083050030490555555", gallons: 60, totalCost: 300, tranDate: "2026-08-20" }), // never billed
      ],
      { window: WINDOW },
    );

  it("files only the rows that need somebody", () => {
    const f = reconFindings(result());
    const kinds = f.map((x) => x.kind).sort();
    expect(kinds).toEqual(["recon_amount", "recon_missing_in_system", "recon_missing_on_report"]);
    // A clean row is not a finding, and neither is a drifted match: it AGREES about the money and is
    // only labelled about how it was placed. Filing it would put an unactionable row on a work queue.
    expect(kinds).not.toContain("recon_date_drift");
  });

  it("names the four kinds of money apart, and never sums them", () => {
    const f = reconFindings(result());
    const byKind = Object.fromEntries(f.map((x) => [x.kind, x]));
    expect(byKind.recon_missing_in_system!.amountKind).toBe("unrecorded");
    expect(byKind.recon_missing_in_system!.amount).toBe(350);
    expect(byKind.recon_missing_on_report!.amountKind).toBe("unbilled");
    expect(byKind.recon_missing_on_report!.amount).toBe(300);
    expect(byKind.recon_amount!.amountKind).toBe("overbilled");
    expect(byKind.recon_amount!.amount).toBe(50);
  });

  it("carries the evidence a reader needs without opening the file", () => {
    const missing = reconFindings(result()).find((x) => x.kind === "recon_missing_in_system")!;
    expect(missing.evidence).toMatchObject({ billedGallons: 70, authNo: "999" });
    expect(missing.transactionId).toBeNull(); // D-FX2: there IS no transaction — that is the finding
    expect(missing.occurredOn).toBe("2026-08-17");
  });

  // ── D-FX10 ───────────────────────────────────────────────────────────────────────────────────
  it("produces the same fingerprints when the same period is reconciled again", () => {
    const a = reconFindings(result()).map((x) => x.fingerprint).sort();
    const b = reconFindings(result()).map((x) => x.fingerprint).sort();
    expect(b).toEqual(a);
  });

  it("keys on our own row id wherever we have one, so nothing about the file can move it", () => {
    const over = reconFindings(result()).find((x) => x.kind === "recon_amount")!;
    expect(over.fingerprint).toBe("recon_amount|s3");
    const unbilled = reconFindings(result()).find((x) => x.kind === "recon_missing_on_report")!;
    expect(unbilled.fingerprint).toBe("recon_missing_on_report|s9");
  });

  it("gives two findings on one card and day distinct identities", () => {
    const r = reconcileFuelReport(
      [
        rf({ rowNumber: 1, authNo: "a1", cardRef: "999999", gallons: 70, netAmount: 350 }),
        rf({ rowNumber: 2, authNo: "a2", cardRef: "999999", gallons: 80, netAmount: 400 }),
      ],
      [], { window: WINDOW },
    );
    const fps = reconFindings(r).map((x) => x.fingerprint);
    expect(new Set(fps).size).toBe(2);
  });
});

describe("contractFindings", () => {
  const line = (o: Partial<SpendLine> = {}): SpendLine => ({
    tranDate: "2026-08-17", brand: "pilot", state: "TX", site: "436", city: "Amarillo",
    unit: "701", driver: "A DRIVER", product: "diesel", tank: "tractor",
    gallons: 100, netAmount: 520, retailAmount: 560, contractAmount: 500, quoteStaleDays: 0,
    miscAmount: null, salesTax: null, ...o,
  });

  it("files a fill billed above its quoted price", () => {
    const f = contractFindings(analyzeContractCapture([line()]));
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe("contract_variance");
    expect(f[0]!.amountKind).toBe("overbilled");
    expect(f[0]!.amount).toBe(20);
    expect(f[0]!.evidence).toMatchObject({ paid: 520, expected: 500 });
  });

  it("does not file a fill billed BELOW contract — that is not somebody's work", () => {
    // Money in the carrier's favour. Putting it on a queue asks somebody to go and hand it back;
    // `ContractCapture` already reports the under figure beside the over one.
    const f = contractFindings(analyzeContractCapture([line({ netAmount: 480 })]));
    expect(f).toHaveLength(0);
  });

  it("is stable across re-runs", () => {
    const once = contractFindings(analyzeContractCapture([line()]))[0]!.fingerprint;
    const twice = contractFindings(analyzeContractCapture([line()]))[0]!.fingerprint;
    expect(twice).toBe(once);
  });
});
