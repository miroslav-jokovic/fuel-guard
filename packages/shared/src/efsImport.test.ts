import { describe, it, expect } from "vitest";
import {
  detectReportKind,
  normalizeTransactionRows,
  normalizeRejectRows,
  reconcileFuelLines,
  parseStationIdentity,
  normalizeAllTransactionLines,
  efsDateToIso,
} from "./index.js";

// Real column headers from the Silvicom EFS exports (docs/08 §0).
const TXN_HEADERS = [
  "Card #", "Tran Date", "Invoice", "Unit", "Driver Name", "Odometer", "Location Name",
  "City", "State/ Prov", "Fees", "Item", "Unit Price", "Qty", "Amt", "DB", "Currency",
];
const REJECT_HEADERS = [
  "Date", "Time", "Card Number", "Invoice", "Location ID", "Location Name", "Location City",
  "State/Prov", "Error Code", "Error Description", "Unit", "Driver ID", "Driver Name", "Policy", "Policy Name",
];

// A real multi-line invoice: one ULSD (fuel) row + one DEFD (non-fuel) row.
const txnRows = [
  {
    "Card #": "94507", "Tran Date": "2026-06-29", Invoice: "0801987714", Unit: "691",
    "Driver Name": "DONOVAN BOOTHE", Odometer: "293580", "Location Name": "PILOT JAMESTOWN 305",
    City: "JAMESTOWN", "State/ Prov": "NM", Fees: "0.0", Item: "ULSD", "Unit Price": "4.227",
    Qty: "141.7", Amt: "598.91", DB: "Y", Currency: "USD/Gallons",
  },
  {
    "Card #": "94507", "Tran Date": "2026-06-29", Invoice: "0801987714", Unit: "691",
    "Driver Name": "DONOVAN BOOTHE", Odometer: "293580", "Location Name": "PILOT JAMESTOWN 305",
    City: "JAMESTOWN", "State/ Prov": "NM", Fees: "0.0", Item: "DEFD", "Unit Price": "4.999",
    Qty: "5.24", Amt: "26.18", DB: "Y", Currency: "USD/Gallons",
  },
  {
    "Card #": "94036", "Tran Date": "2026-06-29", Invoice: "0482599384", Unit: "704",
    "Driver Name": "DANTE CORTES", Odometer: "220772", Item: "SCLE", "Unit Price": "0.0",
    Qty: "1.0", Amt: "15.25", Currency: "USD/Gallons",
  },
];

describe("detectReportKind", () => {
  it("identifies the Transaction Report", () => {
    expect(detectReportKind(TXN_HEADERS)).toBe("transaction");
  });
  it("identifies the Reject Report", () => {
    expect(detectReportKind(REJECT_HEADERS)).toBe("reject");
  });
  it("returns unknown for unrelated headers", () => {
    expect(detectReportKind(["foo", "bar"])).toBe("unknown");
  });
});

describe("efsDateToIso", () => {
  it("anchors a date-only value at noon UTC (docs/08 §4)", () => {
    expect(efsDateToIso("2026-06-29")).toBe("2026-06-29T12:00:00.000Z");
  });
  it("handles a datetime string", () => {
    expect(efsDateToIso("2026-06-29 07:37:00")).toBe("2026-06-29T12:00:00.000Z");
  });
});

describe("normalizeTransactionRows", () => {
  const { fuelLines, skipped } = normalizeTransactionRows(txnRows);

  it("keeps only fuel lines (ULSD) and skips DEF + scales", () => {
    expect(fuelLines).toHaveLength(1);
    expect(skipped.map((s) => s.item)).toEqual(expect.arrayContaining(["DEFD", "SCLE"]));
  });

  it("maps fuel fields and a diesel product correctly", () => {
    const line = fuelLines[0]!;
    expect(line.unit).toBe("691");
    expect(line.gallons).toBe(141.7);
    expect(line.total_cost).toBe(598.91);
    expect(line.price_per_gal).toBe(4.227);
    expect(line.odometer).toBe(293580);
    expect(line.fuel_type).toBe("diesel");
    expect(line.driver_name).toBe("DONOVAN BOOTHE");
    expect(line.card_ref).toBe("94507");
    expect(line.city).toBe("JAMESTOWN");
    expect(line.state).toBe("NM");
  });

  it("keys external_ref by Card | Invoice (one fueling event) and merges fuel lines", () => {
    expect(fuelLines[0]!.external_ref).toBe("94507|0801987714");
  });

  it("merges multiple fuel lines on the same invoice (sum gallons, re-derive price)", () => {
    const merged = normalizeTransactionRows([
      { "Card #": "1", Invoice: "INV1", Unit: "5", Odometer: "1000", Item: "ULSD", "Unit Price": "4.0", Qty: "100", Amt: "400", "Tran Date": "2026-06-01" },
      { "Card #": "1", Invoice: "INV1", Unit: "5", Odometer: "1000", Item: "ULSD", "Unit Price": "4.0", Qty: "50", Amt: "200", "Tran Date": "2026-06-01" },
    ]).fuelLines;
    expect(merged).toHaveLength(1);
    expect(merged[0]!.gallons).toBe(150);
    expect(merged[0]!.total_cost).toBe(600);
    expect(merged[0]!.price_per_gal).toBe(4);
  });

  it("quarantines rows with an unparseable date", () => {
    const { fuelLines: fl, skipped: sk } = normalizeTransactionRows([
      { "Card #": "1", Invoice: "INV2", Item: "ULSD", Qty: "100", Amt: "400", "Tran Date": "not-a-date" },
    ]);
    expect(fl).toHaveLength(0);
    expect(sk.some((s) => s.reason === "unparseable date")).toBe(true);
  });
});

describe("normalizeAllTransactionLines (faithful — docs/10)", () => {
  const lines = normalizeAllTransactionLines(txnRows);

  it("keeps every line verbatim (no merge, no fuel filter)", () => {
    expect(lines).toHaveLength(3); // ULSD + DEFD + SCLE all retained
    expect(lines.map((l) => l.item)).toEqual(["ULSD", "DEFD", "SCLE"]);
  });

  it("maps all columns faithfully", () => {
    const l = lines[0]!;
    expect(l.card_num).toBe("94507");
    expect(l.tran_date).toBe("2026-06-29");
    expect(l.unit).toBe("691");
    expect(l.driver_name).toBe("DONOVAN BOOTHE");
    expect(l.odometer).toBe(293580);
    expect(l.qty).toBe(141.7);
    expect(l.amt).toBe(598.91);
    expect(l.unit_price).toBe(4.227);
    expect(l.location_name).toBe("PILOT JAMESTOWN 305");
    expect(l.city).toBe("JAMESTOWN");
    expect(l.state).toBe("NM");
    expect(l.currency).toBe("USD/Gallons");
    expect(l.line_number).toBe(1);
  });
});

describe("reconcileFuelLines", () => {
  const { fuelLines } = normalizeTransactionRows(txnRows);
  const vehicles = [{ id: "veh-691", unit_number: "691" }];
  const drivers = [{ id: "drv-1", full_name: "Donovan Boothe" }];

  it("matches Unit→vehicle and Driver Name→driver (case-insensitive)", () => {
    const [r] = reconcileFuelLines(fuelLines, vehicles, drivers);
    expect(r!.vehicle_id).toBe("veh-691");
    expect(r!.driver_id).toBe("drv-1");
  });

  it("leaves vehicle_id null when the unit is unknown (unattributed)", () => {
    const [r] = reconcileFuelLines(fuelLines, [], drivers);
    expect(r!.vehicle_id).toBeNull();
  });

  it("matches 'LAST, FIRST' vs 'First Last', casing, punctuation, and middle initials", () => {
    const drv = [{ id: "d1", full_name: "John Smith" }];
    const veh = [{ id: "v1", unit_number: "042" }];
    const line = { ...fuelLines[0]!, unit: "42", driver_name: "SMITH, JOHN A." };
    const [r] = reconcileFuelLines([line], veh, drv);
    expect(r!.driver_id).toBe("d1"); // name order/initial/punctuation tolerant
    expect(r!.vehicle_id).toBe("v1"); // leading-zero tolerant unit match
  });

  it("does not guess when a name key is ambiguous (two drivers collapse to the same key)", () => {
    const drv = [
      { id: "d1", full_name: "John Smith" },
      { id: "d2", full_name: "Smith John" },
    ];
    const line = { ...fuelLines[0]!, driver_name: "John Smith" };
    const [r] = reconcileFuelLines([line], vehicles, drv);
    expect(r!.driver_id).toBeNull();
  });
});

describe("parseStationIdentity", () => {
  it("extracts brand + store number and a nationwide-unique site key", () => {
    const s = parseStationIdentity("PILOT JAMESTOWN 305", "Jamestown", "NY");
    expect(s.brand).toBe("pilot");
    expect(s.storeNumber).toBe("305");
    expect(s.siteKey).toBe("pilot#305"); // brand+store# → unique regardless of city spelling
  });

  it("handles Flying J before matching a stray 'J', and Love's apostrophe", () => {
    expect(parseStationIdentity("FLYING J 617", "Ogden", "UT").brand).toBe("flying_j");
    expect(parseStationIdentity("LOVES TRAVEL STOP 452", "Amarillo", "TX").brand).toBe("loves");
    expect(parseStationIdentity("LOVE'S #452", "Amarillo", "TX").brand).toBe("loves");
  });

  it("falls back to name|city|state for independents with no store number", () => {
    const s = parseStationIdentity("JOE'S TRUCK PLAZA", "Reno", "NV");
    expect(s.brand).toBeNull();
    expect(s.siteKey).toBe("joe's truck plaza|reno|nv");
  });
});

describe("detectReportKind — reject report without an obvious reason column", () => {
  it("classifies a card+date report with NO fuel quantity as a reject", () => {
    // A decline: card was used but nothing was pumped → no product/quantity columns.
    const headers = ["TransactionId", "CardNumber", "TransactionPOSDate", "TransactionPOSTime", "Unit", "DriverName", "LocationName", "LocationCity", "LocationState"];
    expect(detectReportKind(headers)).toBe("reject");
  });
  it("still classifies a report with product + quantity as a transaction", () => {
    expect(detectReportKind(["CardNumber", "TransactionPOSDate", "ProductCode", "Quantity", "Amount"])).toBe("transaction");
  });
});

describe("new PascalCase report format (timed)", () => {
  const NEW_HEADERS = [
    "TransactionId", "CardNumber", "TransactionPOSDate", "TransactionPOSTime", "Invoice", "SubFleet",
    "Unit", "Odometer", "DriverName", "DriverId", "LocationId", "LocationName", "LocationCity",
    "LocationState", "TransactionFee", "TransactionCurrency", "ProductCode", "ProductDescription",
    "PricePerUnit", "Quantity", "Amount",
  ];
  const rows = [
    {
      TransactionId: "T1", CardNumber: "70830500304 ", TransactionPOSDate: "06/29/2026",
      TransactionPOSTime: "14:25:00", Invoice: "INV1", Unit: "637", Odometer: "438820",
      DriverName: "Marcus Reyes", DriverId: "1001", LocationName: "PILOT BELGRADE",
      LocationCity: "BELGRADE", LocationState: "MT", ProductCode: "001", ProductDescription: "ULSD DIESEL",
      PricePerUnit: "4.10", Quantity: "90", Amount: "369.00", TransactionCurrency: "USD",
    },
  ];

  it("detects the new format as a transaction report", () => {
    expect(detectReportKind(NEW_HEADERS)).toBe("transaction");
  });

  it("maps the PascalCase columns and recovers the exact fueling time", () => {
    const { fuelLines, skipped } = normalizeTransactionRows(rows);
    expect(skipped).toHaveLength(0);
    expect(fuelLines).toHaveLength(1);
    const f = fuelLines[0]!;
    expect(f.unit).toBe("637");
    expect(f.driver_name).toBe("Marcus Reyes");
    expect(f.card_ref).toBe("70830500304");
    expect(f.odometer).toBe(438820);
    expect(f.gallons).toBe(90);
    expect(f.city).toBe("BELGRADE");
    expect(f.state).toBe("MT");
    expect(f.fuel_type).toBe("diesel"); // from ProductDescription (ProductCode is numeric)
    expect(f.fueled_at).toBe("2026-06-29T14:25:00.000Z"); // exact date + time
  });

  it("keeps the exact time in the faithful line too", () => {
    const [line] = normalizeAllTransactionLines(rows);
    expect(line!.fueled_at).toBe("2026-06-29T14:25:00.000Z");
    expect(line!.tran_date).toBe("2026-06-29");
    expect(line!.qty).toBe(90);
  });
});

describe("normalizeRejectRows", () => {
  const rows = [
    {
      Date: "2026-06-29 12:15:00", Time: "2026-06-29 12:15:00",
      "Card Number": "7083050030485897149      ", Invoice: "0808024975  ", "Location ID": "516025",
      "Location Name": "PILOT CARTERSVILLE 067", "Location City": "CARTERSVILLE", "State/Prov": "GA",
      "Error Code": "3", "Error Description": "INACTIVE CARD IN0808024975|Non-Active Card|",
      Unit: "702", "Driver ID": "1967", "Driver Name": "DERRICK KELLY",
    },
  ];
  const declined = normalizeRejectRows(rows);

  it("parses a declined attempt with a real timestamp and trimmed card", () => {
    const d = declined[0]!;
    expect(d.declined_at).toBe("2026-06-29T12:15:00.000Z");
    expect(d.card_ref).toBe("7083050030485897149");
    expect(d.error_code).toBe("3");
    expect(d.driver_ext_id).toBe("1967");
    expect(d.unit).toBe("702");
    expect(d.external_ref).toBe("7083050030485897149|0808024975|3");
  });
});
