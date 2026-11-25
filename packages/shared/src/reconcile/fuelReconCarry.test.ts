import { describe, it, expect } from "vitest";
import { billedLateFingerprints, matchedFillIds, matchLateRecorded, reconReadRange, type OpenUnrecordedFinding } from "./fuelReconCarry.js";
import { reconcileFuelReport, type SystemFill } from "./fuelMatch.js";
import type { PilotReportFill } from "./pilotFuelReport.js";

const WEEK = { from: "2026-11-16", to: "2026-11-22" };

const line = (o: Partial<PilotReportFill> & { rowNumber: number }): PilotReportFill => ({
  authNo: null, unit: "786", cardRef: "222222", site: "332", city: null, state: "AR", gallons: 150, netAmount: 600,
  retailAmount: 700, tranDate: "2026-11-20", time: null, product: "diesel", productCode: "020", productDescription: "Truck Diesel",
  ...o,
});
const fill = (o: Partial<SystemFill> & { id: string }): SystemFill => ({
  cardRef: "7083050099040222222", controlId: null, unit: "786", fueledAt: null, tranDate: "2026-11-20", tank: "tractor",
  gallons: 150, totalCost: 600, ...o,
});

describe("reconReadRange", () => {
  it("is the billing week when every line sits inside it", () => {
    expect(reconReadRange(WEEK, ["2026-11-16", "2026-11-22"])).toEqual(WEEK);
  });
  it("widens to a line billed late or early, so its fill can still be matched", () => {
    expect(reconReadRange(WEEK, ["2026-11-09", "2026-11-23", null])).toEqual({ from: "2026-11-09", to: "2026-11-23" });
  });
  it("does not chase a line dated beyond the lookback", () => {
    expect(reconReadRange(WEEK, ["2025-01-01"])).toEqual(WEEK);
  });
});

describe("matchedFillIds", () => {
  it("takes only fills a line was matched to — not a fill the check called unbilled", () => {
    const ids = matchedFillIds([
      { report: line({ rowNumber: 1 }), system: fill({ id: "a" }) },
      { report: null, system: fill({ id: "b" }) },
      { report: line({ rowNumber: 2 }), system: null },
    ]);
    expect([...ids]).toEqual(["a"]);
  });
});

describe("billedLateFingerprints", () => {
  it("names the unbilled finding of a fill dated before this week that a line on this invoice matched", () => {
    const r = reconcileFuelReport(
      [line({ rowNumber: 1, tranDate: "2026-11-14" }), line({ rowNumber: 2 })],
      [fill({ id: "late", tranDate: "2026-11-14" }), fill({ id: "inweek" })],
      { window: WEEK },
    );
    expect(billedLateFingerprints(r, WEEK)).toEqual(["recon_missing_on_report|late"]);
  });
  it("names nothing for a fill this check still calls unbilled", () => {
    const r = reconcileFuelReport([], [fill({ id: "late", tranDate: "2026-11-14" })], { window: WEEK });
    expect(billedLateFingerprints(r, WEEK)).toEqual([]);
  });
});

describe("matchLateRecorded", () => {
  const finding = (o: Partial<OpenUnrecordedFinding> = {}): OpenUnrecordedFinding => ({
    fingerprint: "recon_missing_in_system|2026-11-10|-|020|222222|150",
    occurredOn: "2026-11-10",
    evidence: { billedGallons: 150, billedAmount: 600, card: "222222", productCode: "020" },
    ...o,
  });

  it("closes a finding when the fill has since been recorded on the same card, gallons and amount", () => {
    expect(matchLateRecorded([finding()], [fill({ id: "f1", tranDate: "2026-11-10" })])).toEqual([
      { fingerprint: finding().fingerprint, transactionId: "f1" },
    ]);
  });

  it("matches a reefer finding only to a reefer fill", () => {
    const reefer = finding({ evidence: { billedGallons: 40, billedAmount: 160, card: "222222", productCode: "033" } });
    expect(matchLateRecorded([reefer], [fill({ id: "t", tranDate: "2026-11-10", gallons: 40, totalCost: 160 })])).toEqual([]);
    expect(matchLateRecorded([reefer], [fill({ id: "r", tank: "reefer", tranDate: "2026-11-10", gallons: 40, totalCost: 160 })])).toHaveLength(1);
  });

  it("leaves it open when only date and gallons agree — a different card is not proof", () => {
    expect(matchLateRecorded([finding()], [fill({ id: "f1", tranDate: "2026-11-10", cardRef: "999999" })])).toEqual([]);
  });

  it("leaves it open when the amount or the gallons disagree, so a person decides", () => {
    expect(matchLateRecorded([finding()], [fill({ id: "f1", tranDate: "2026-11-10", totalCost: 640 })])).toEqual([]);
    expect(matchLateRecorded([finding()], [fill({ id: "f1", tranDate: "2026-11-10", gallons: 140 })])).toEqual([]);
  });

  it("uses one fill for one finding", () => {
    const two = [finding(), finding({ fingerprint: "recon_missing_in_system|2026-11-10|x|020|222222|150" })];
    expect(matchLateRecorded(two, [fill({ id: "f1", tranDate: "2026-11-10" })])).toHaveLength(1);
  });

  it("skips a finding whose evidence cannot rebuild the line", () => {
    expect(matchLateRecorded([finding({ evidence: null })], [fill({ id: "f1", tranDate: "2026-11-10" })])).toEqual([]);
    expect(matchLateRecorded([finding({ occurredOn: null })], [fill({ id: "f1", tranDate: "2026-11-10" })])).toEqual([]);
  });
});
