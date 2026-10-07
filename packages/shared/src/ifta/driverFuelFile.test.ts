import { describe, expect, it } from "vitest";
import { disagreeingTotals, fileDayAndTime, jurisdictionCode, parseDriverFuelFile } from "./driverFuelFile.js";

/**
 * The two files the office sends (IP8), reproduced in shape from the real ones of 2026-10-07 — same
 * headers, same quirks (blank Truck #, a totals block under the fills, Excel date cells, placeholder
 * invoice numbers) — with invented names and values.
 */
const APP_HEADER = [
  "Transaction ID", "Date of Visit", "Street", "City", "State", "Zip", "Gallons Dispensed", "Fuel Type", "Retail",
  "Cost", "Credit Card Fee", "Retail Cost", "Paid", "Truck Stop", "Name", "Truck #", "Card Last4",
];
const app = (id: string, when: string, state: string, gallons: string, over: Partial<Record<string, string>> = {}) => {
  const row: Record<string, string> = {
    "Transaction ID": id, "Date of Visit": when, Street: "1 Main", City: "Yukon", State: state, Zip: "73099",
    "Gallons Dispensed": gallons, "Fuel Type": "Diesel", Retail: "$5.60", Cost: "$5.50", "Credit Card Fee": "$1.00",
    "Retail Cost": "$561.08", Paid: "$597.85", "Truck Stop": "OnCue #145", Name: "Driver A", "Truck #": "", "Card Last4": "",
    ...over,
  };
  return APP_HEADER.map((h) => row[h] ?? "");
};
const total = (state: string, gallons: string) => ["", "", "", "", state, "Total Gallons", gallons, "", "", "", "", "Total Paid", "$1.00", "", "", "", ""];

const MCLEOD_HEADER = [
  "Date", "Tractor Number", "Trailer Number", "Driver Number", "Driver Name", "Fuel Stop Code", "Fuel Stop Name", "City",
  "State", "Zip Code", "Gallons Purchased", "Highway", "Hub Reading", "Invoice Number", "Order", "Price Per Gallon",
  "Reefer Number", "Total", "User", "Void Date", "Problem",
];
const ticket = (day: string, unit: string, state: string, gallons: string, over: Partial<Record<string, string>> = {}) => {
  const row: Record<string, string> = {
    Date: `${day}T00:00:00.000Z`, "Tractor Number": unit, City: "JOPLIN", State: state, "Zip Code": "64801",
    "Gallons Purchased": gallons, Highway: "Yes", "Invoice Number": "123456", "Price Per Gallon": "5.115", Total: "729.09",
    User: "office", "Void Date": "", Problem: "No", ...over,
  };
  return MCLEOD_HEADER.map((h) => row[h] ?? "");
};

describe("parseDriverFuelFile — the fuel app's IFTA report", () => {
  const grid = [
    APP_HEADER,
    app("T1", "2026-09-26 13:42", "Oklahoma", "100.211"),
    app("T2", "2026-09-28 18:18", "Texas", "117.147"),
    app("T3", "2026-10-04 07:26", "Oklahoma", "75.595"),
    ["", "", "", "", "", "Total Gallons", "292.953", "", "", "", "", "Total Paid", "$1.00", "", "", "", ""],
    total("OK", "175.806"),
    total("TX", "117.147"),
  ];

  it("reads every fill: state spelled out → code, day and wall-clock time, gallons to the thousandth", () => {
    const r = parseDriverFuelFile(grid);
    if (!r.ok) throw new Error(r.reason);
    expect(r.format).toBe("fuel_app_csv");
    expect(r.rows.map((x) => [x.line, x.jurisdiction, x.fueledOn, x.fueledTimeLocal, x.gallons])).toEqual([
      [2, "OK", "2026-09-26", "13:42", 100.211],
      [3, "TX", "2026-09-28", "18:18", 117.147],
      [4, "OK", "2026-10-04", "07:26", 75.595],
    ]);
    expect(r.rows[0]).toMatchObject({
      fingerprint: "fuel_app:T1", externalRef: "T1", unitAsFiled: null, driverAsFiled: "Driver A",
      station: "OnCue #145", pricePerGal: 5.5, amountPaid: 597.85, postalCode: "73099",
    });
    expect(r.rows[0]!.raw["Transaction ID"]).toBe("T1");
    expect(r.refused).toEqual([]);
  });

  it("reads the totals block as the file's own arithmetic, not as fills — and it agrees", () => {
    const r = parseDriverFuelFile(grid);
    if (!r.ok) throw new Error(r.reason);
    expect(r.statedTotals).toEqual([
      { jurisdiction: null, stated: 292.953, parsed: 292.953 },
      { jurisdiction: "OK", stated: 175.806, parsed: 175.806 },
      { jurisdiction: "TX", stated: 117.147, parsed: 117.147 },
    ]);
    expect(disagreeingTotals(r)).toEqual([]);
  });

  it("says when the rows do not add up to the file's own total — a fill the file claims but we did not read", () => {
    const short = grid.filter((_, i) => i !== 2); // drop the Texas fill, keep the totals
    const r = parseDriverFuelFile(short);
    if (!r.ok) throw new Error(r.reason);
    expect(disagreeingTotals(r).map((t) => t.jurisdiction)).toEqual([null, "TX"]);
  });

  it("refuses DEF and reefer lines, an unknown state, a bad date and zero gallons — each with its line", () => {
    const r = parseDriverFuelFile([
      APP_HEADER,
      app("T1", "2026-09-26 13:42", "Oklahoma", "20", { "Fuel Type": "DEF" }),
      app("T2", "2026-09-26 13:42", "Oklahoma", "20", { "Fuel Type": "Reefer Diesel" }),
      app("T3", "2026-09-26 13:42", "Narnia", "20"),
      app("T4", "next tuesday", "Oklahoma", "20"),
      app("T5", "2026-09-26 13:42", "Oklahoma", "0"),
      app("T6", "2026-02-30 10:00", "Oklahoma", "20"),
    ]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.rows).toEqual([]);
    expect(r.refused.map((x) => x.line)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(r.refused[0]!.reason).toMatch(/DEF/);
    expect(r.refused[1]!.reason).toMatch(/reefer/);
    expect(r.refused[2]!.reason).toMatch(/Narnia/);
  });

  it("refuses the second copy of a transaction repeated inside one file", () => {
    const r = parseDriverFuelFile([APP_HEADER, app("T1", "2026-09-26 13:42", "Oklahoma", "20"), app("T1", "2026-09-26 13:42", "Oklahoma", "20")]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.rows).toHaveLength(1);
    expect(r.refused).toEqual([{ line: 3, reason: "the same row appears earlier in this file" }]);
  });

  it("finds the header below a title row", () => {
    const r = parseDriverFuelFile([["IFTA Report"], [], APP_HEADER, app("T1", "2026-09-26 13:42", "OK", "20")]);
    expect(r.ok && r.rows[0]!.line).toBe(4);
  });
});

describe("parseDriverFuelFile — McLeod's Fuel Ticket Hist Listing", () => {
  it("reads the unit, the Excel date cell as its calendar day, and keeps placeholder invoices apart by unit, day, state and gallons", () => {
    const r = parseDriverFuelFile([
      MCLEOD_HEADER,
      ticket("2026-08-21", "718", "MO", "142.54"),
      ticket("2026-09-18", "718", "MO", "120.76"),
      ticket("2026-09-18", "777", "OK", "133.28"),
    ]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.format).toBe("mcleod_ticket_export");
    expect(r.rows.map((x) => [x.unitAsFiled, x.fueledOn, x.fueledTimeLocal, x.jurisdiction, x.gallons])).toEqual([
      ["718", "2026-08-21", null, "MO", 142.54],
      ["718", "2026-09-18", null, "MO", 120.76],
      ["777", "2026-09-18", null, "OK", 133.28],
    ]);
    // Three rows, one invoice number: three fingerprints.
    expect(new Set(r.rows.map((x) => x.fingerprint)).size).toBe(3);
    expect(r.rows[0]!.fingerprint).toBe("mcleod_ticket:718|2026-08-21|MO|142.540|123456");
    expect(r.statedTotals).toEqual([]);
  });

  it("skips a ticket voided in McLeod (counted), and refuses an off-highway ticket and one with no tractor", () => {
    const r = parseDriverFuelFile([
      MCLEOD_HEADER,
      ticket("2026-08-21", "718", "MO", "142.54", { "Void Date": "2026-08-22T00:00:00.000Z" }),
      ticket("2026-08-21", "718", "MO", "40", { Highway: "No" }),
      ticket("2026-08-21", "", "MO", "40"),
    ]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.voidedInSource).toBe(1);
    expect(r.rows).toEqual([]);
    expect(r.refused.map((x) => [x.line, x.reason])).toEqual([
      [3, "marked off-highway in McLeod, so no road tax was paid on it"],
      [4, "no tractor number"],
    ]);
  });
});

describe("parseDriverFuelFile — anything else", () => {
  it("says which files it can read rather than guessing at columns", () => {
    const r = parseDriverFuelFile([["Date", "Truck", "Gallons"], ["2026-08-01", "512", "100"]]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/Transaction ID.*Tractor Number/);
  });
});

describe("the cell readers", () => {
  it("jurisdictionCode: names and codes, any case, US and Canada; nothing else", () => {
    expect(["Oklahoma", "oklahoma", "OK", "ok", "New  Mexico", "Ontario"].map(jurisdictionCode)).toEqual(["OK", "OK", "OK", "OK", "NM", "ON"]);
    expect([null, "", "XX", "Oklahoma City"].map(jurisdictionCode)).toEqual([null, null, null, null]);
  });

  it("fileDayAndTime: an Excel midnight is a day with no time; a real time is kept; US dates read as MM/DD", () => {
    expect(fileDayAndTime("2026-08-18T00:00:00.000Z")).toEqual({ day: "2026-08-18", time: null });
    expect(fileDayAndTime("2026-10-04 07:26")).toEqual({ day: "2026-10-04", time: "07:26" });
    expect(fileDayAndTime("10/04/2026 7:26")).toEqual({ day: "2026-10-04", time: "07:26" });
    expect(fileDayAndTime("13/04/2026")).toBeNull();
  });
});
