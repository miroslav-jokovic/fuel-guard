import { describe, it, expect } from "vitest";
import { normalizeTransactionRows, normalizeAllTransactionLines } from "./parse.js";
import type { RawRow } from "./types.js";

/** A minimal EFS transaction row that normalizes to one fuel line. */
const row = (over: Record<string, unknown>): RawRow => ({
  "Card #": "1234",
  "Tran Date": "2026-07-21",
  "TransactionPOSTime": "10:00",
  Unit: "633",
  "Driver Name": "John Smith",
  Invoice: "A1",
  Item: "ULSD",
  Qty: "100",
  Amt: "400",
  "Location Name": "PILOT OLIVE BRANCH 677",
  City: "Olive Branch",
  "State/ Prov": "MS",
  ...over,
});

describe("Driver Control ID capture", () => {
  it("reads the Control ID column onto the merged fuel line + faithful line", () => {
    const rows = [row({ "Control ID": "CTRL-633" })];
    const { fuelLines } = normalizeTransactionRows(rows);
    expect(fuelLines).toHaveLength(1);
    expect(fuelLines[0]!.control_id).toBe("CTRL-633");
    expect(normalizeAllTransactionLines(rows)[0]!.control_id).toBe("CTRL-633");
  });

  it("matches common header spellings (Driver Control ID, punctuation/case-insensitive)", () => {
    expect(normalizeTransactionRows([row({ "Driver Control ID": "CTRL-1" })]).fuelLines[0]!.control_id).toBe("CTRL-1");
    expect(normalizeTransactionRows([row({ "control number": "CTRL-2" })]).fuelLines[0]!.control_id).toBe("CTRL-2");
  });

  it("is null when the report has no Control ID column", () => {
    expect(normalizeTransactionRows([row({})]).fuelLines[0]!.control_id).toBeNull();
  });

  it("keeps the first non-null Control ID across merged invoice lines", () => {
    const rows = [
      row({ Item: "ULSD", Qty: "60", Amt: "240", "Control ID": "CTRL-633" }),
      row({ Item: "ULSD", Qty: "40", Amt: "160", "Control ID": "" }), // same invoice, blank on the 2nd line
    ];
    const { fuelLines } = normalizeTransactionRows(rows);
    expect(fuelLines).toHaveLength(1);
    expect(fuelLines[0]!.gallons).toBe(100); // merged
    expect(fuelLines[0]!.control_id).toBe("CTRL-633");
  });
});
