import { beforeEach, describe, expect, it, vi } from "vitest";
import { ledgerPosition, type IftaPeriodReceipts } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/** The tool's answer is `unknown` to its caller (it goes to the model as JSON); tests read named fields. */
type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Ask AI's `ifta_report` (F21 R6b). Its header promises the figures are the IFTA ledger page's:
 * `readIftaPeriod` for the quarter asked, turned into a position by the page's own `ledgerPosition`.
 * So the read is a spy answering rows in Samsara's units (metres), with a McLeod receipt, and the
 * tool's per-state figures are held against `ledgerPosition` over the same rows — plus fixed values
 * for the ones a reader would quote, so a tool that skipped the shared function and re-derived MPG or
 * tax would differ.
 */
const readIftaPeriod = vi.fn();
vi.mock("./periodReads.js", () => ({ readIftaPeriod: (...a: unknown[]) => readIftaPeriod(...a) }));
const { assistantIftaReport, IFTA_SOURCE } = await import("./assistantIftaReport.js");

const ORG = "org-1";
const NOV_10 = new Date("2026-11-10T15:00:00Z");
const MI = 1609.344;

const RECEIPTS: IftaPeriodReceipts = {
  jurisdictions: [{ jurisdiction: "OK", gallons: 120.5 }] as IftaPeriodReceipts["jurisdictions"],
  sources: [], duplicatesDropped: 0, duplicateGallons: 0, unmatched: 0, unmatchedUnits: [],
};
const JURISDICTIONS = [
  { jurisdiction: "TX", taxable_meters: 412_345 * MI, total_meters: 413_000 * MI, tax_paid_liters: 1, purchased_gallons: 61_234.4 },
  { jurisdiction: "OK", taxable_meters: 98_765 * MI, total_meters: 98_800 * MI, tax_paid_liters: 0, purchased_gallons: 9_100.2 },
  { jurisdiction: "IL", taxable_meters: 55_555 * MI, total_meters: 55_600 * MI, tax_paid_liters: 0, purchased_gallons: 0 },
];
const SUMMARY = { odometer_miles: 480_000, months_fetched: 3, any_provisional: false, vehicles: 187, max_unmapped: 2, last_fetched_at: "2026-10-06T11:00:00Z" };

const recorder = () => createSupabaseRecorder({ tables: { organizations: [{ operating_hours: { tz: "America/Chicago" } }] } });

beforeEach(() => {
  readIftaPeriod.mockReset();
  readIftaPeriod.mockResolvedValue({ jurisdictions: JURISDICTIONS, summary: SUMMARY, receipts: RECEIPTS });
});

describe("ifta_report — the IFTA ledger page's quarter", () => {
  it("reads last quarter on the carrier's clock by default, for this org", async () => {
    const rec = recorder();
    const out = (await assistantIftaReport(rec.client, ORG, {}, NOV_10)) as Out;
    expect(readIftaPeriod.mock.calls[0]!.slice(1)).toEqual([ORG, 2026, 3]);
    expect(out.quarter).toBe("Q3 2026");
    expect(out.source).toBe(IFTA_SOURCE);
    expectOrgScoped(rec, ORG);
  });

  it("asks the quarter on the carrier's clock, not UTC's: 30 September, 10 pm in Chicago, is still Q3", async () => {
    await assistantIftaReport(recorder().client, ORG, { period: "this_quarter" }, new Date("2026-10-01T03:00:00Z"));
    expect(readIftaPeriod.mock.calls[0]!.slice(2)).toEqual([2026, 3]);
  });

  it("an explicit quarter, and this quarter, are asked as given", async () => {
    await assistantIftaReport(recorder().client, ORG, { year: 2025, quarter: 4 }, NOV_10);
    await assistantIftaReport(recorder().client, ORG, { period: "this_quarter" }, NOV_10);
    expect(readIftaPeriod.mock.calls.map((c) => c.slice(2))).toEqual([[2025, 4], [2026, 4]]);
  });

  it("refuses a quarter that has not started, without reading", async () => {
    const out = (await assistantIftaReport(recorder().client, ORG, { year: 2027, quarter: 1 }, NOV_10)) as Out;
    expect(out).toEqual({ error: "Q1 2027 has not started yet." });
    expect(readIftaPeriod).not.toHaveBeenCalled();
  });

  it("every state's figures are the page's ledgerPosition over the same rows, receipts included", async () => {
    const out = (await assistantIftaReport(recorder().client, ORG, {}, NOV_10)) as Out;
    const { position } = ledgerPosition(JURISDICTIONS, RECEIPTS, { year: 2026, quarter: 3 });
    expect(out.by_jurisdiction.map((j: Out) => j.jurisdiction)).toEqual(position.jurisdictions.map((j) => j.jurisdiction));
    for (const j of position.jurisdictions) {
      const row = out.by_jurisdiction.find((r: Out) => r.jurisdiction === j.jurisdiction);
      expect(row.taxable_miles).toBe(Math.round(j.taxableMiles));
      expect(row.net).toBe(j.net == null ? null : Math.round(j.net * 100) / 100);
      expect(row.rate_per_gallon).toBe(j.ratePerGal);
    }
    const ok = out.by_jurisdiction.find((r: Out) => r.jurisdiction === "OK");
    expect(ok).toMatchObject({ taxable_miles: 98_765, gallons_bought: 9_220.7, gallons_bought_from_receipts: 120.5 });
    // Fleet MPG: 566,665 Samsara miles over 70,455.1 gallons bought (cards + the receipt).
    expect(out.fleet_mpg_used).toMatchObject({ total_miles: 566_665, total_gallons: 70_455.1 });
    expect(out.fleet_mpg_used.mpg).toBe(position.mpg.fleetMpg);
    expect(out.totals.net).toBe(Math.round(position.net * 100) / 100);
  });

  it("states the page's completeness facts and the miles tie-out", async () => {
    const out = (await assistantIftaReport(recorder().client, ORG, {}, NOV_10)) as Out;
    expect(out.completeness).toMatchObject({
      months_pulled_from_samsara: 3, of_months: 3, any_month_provisional: false, trucks: 187,
      vehicles_samsara_reported_we_could_not_map: 2, samsara_last_fetched_at: "2026-10-06T11:00:00Z",
    });
    expect(out.miles_tie_out).toMatchObject({ samsara_miles: 566_665, odometer_miles: 480_000 });
    // Samsara's miles over ALL gallons bought, cards and the receipt: 566,665 ÷ 70,455.1.
    expect(out.miles_tie_out.implied_mpg).toBeCloseTo(566_665 / 70_455.1, 6);
    expect(out.incomplete_note).toBeUndefined();
  });

  it("a quarter Samsara has not finished says so, never as the return", async () => {
    readIftaPeriod.mockResolvedValue({ jurisdictions: JURISDICTIONS, summary: { ...SUMMARY, months_fetched: 1, any_provisional: true }, receipts: RECEIPTS });
    const out = (await assistantIftaReport(recorder().client, ORG, { period: "this_quarter" }, NOV_10)) as Out;
    expect(out.incomplete_note ?? "").toMatch(/^Only 1 of 3 months are in/);
    expect(out.completeness.any_month_provisional).toBe(true);
  });

  it("named states: only those, and a state with nothing recorded is named back", async () => {
    const out = (await assistantIftaReport(recorder().client, ORG, { jurisdictions: ["tx", "NM"] }, NOV_10)) as Out;
    expect(out.by_jurisdiction.map((j: Out) => j.jurisdiction)).toEqual(["TX"]);
    expect(out.no_miles_or_fuel_in).toEqual(["NM"]);
  });
});
