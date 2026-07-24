import { describe, it, expect } from "vitest";
import {
  detectReportKind,
  normalizeTransactionRows,
  normalizeRejectRows,
  reconcileFuelLines,
  driversToProvision,
  parseStationIdentity,
  normalizeAllTransactionLines,
  efsDateToIso,
  efsInstant,
  zonedWallTimeToUtcIso,
  deriveFuelEventsFromEfsStore,
  attributeDeclinedRow,
  learnEfsDriverIds,
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

  it("keys external_ref by Card | Invoice | business date (one fueling event per day)", () => {
    expect(fuelLines[0]!.external_ref).toBe("94507|0801987714|2026-06-29");
    expect(fuelLines[0]!.tran_date).toBe("2026-06-29");
    expect(fuelLines[0]!.fueled_at_precision).toBe("date"); // Tran Date carries no time-of-day
  });

  it("does NOT merge a reused invoice number across days (invoice reuse previously ate whole days)", () => {
    const { fuelLines: fl } = normalizeTransactionRows([
      { "Card #": "1", Invoice: "INV1", Item: "ULSD", Qty: "100", Amt: "400", "Tran Date": "2026-06-01" },
      { "Card #": "1", Invoice: "INV1", Item: "ULSD", Qty: "80", Amt: "320", "Tran Date": "2026-06-03" },
    ]);
    expect(fl).toHaveLength(2);
    expect(fl.map((l) => l.external_ref).sort()).toEqual(["1|INV1|2026-06-01", "1|INV1|2026-06-03"]);
    expect(fl.map((l) => l.gallons).sort((a, b) => a - b)).toEqual([80, 100]); // no gallon inflation
  });

  it("splits reefer (ULSR) from tractor (ULSD) on the same invoice into two events", () => {
    const { fuelLines: fl } = normalizeTransactionRows([
      { "Card #": "1", Invoice: "INV1", Unit: "5", Item: "ULSD", Qty: "120", Amt: "480", "Tran Date": "2026-06-01" },
      { "Card #": "1", Invoice: "INV1", Unit: "5", Item: "ULSR", Qty: "40", Amt: "150", "Tran Date": "2026-06-01" },
    ]);
    expect(fl).toHaveLength(2);
    const tractor = fl.find((l) => l.tank_type === "tractor")!;
    const reefer = fl.find((l) => l.tank_type === "reefer")!;
    expect(tractor.gallons).toBe(120); // tractor no longer inflated by the 40 reefer gallons
    expect(tractor.external_ref).toBe("1|INV1|2026-06-01"); // unchanged (dedup with prior imports intact)
    expect(reefer.gallons).toBe(40);
    expect(reefer.external_ref).toBe("1|INV1|2026-06-01|reefer"); // distinct new ref
  });

  it("prefers the full Card Number for card_ref, but keeps the dedup key on Card #", () => {
    const { fuelLines: fl } = normalizeTransactionRows([
      { "Card #": "1234", "Card Number": "7083440000001234", Invoice: "INV1", Item: "ULSD", Qty: "100", Amt: "400", "Tran Date": "2026-06-01" },
    ]);
    expect(fl).toHaveLength(1);
    expect(fl[0]!.card_ref).toBe("7083440000001234"); // full number preferred → same-last-4 cards stay distinct
    expect(fl[0]!.external_ref).toBe("1234|INV1|2026-06-01"); // dedup key unchanged (stable across imports)
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

  it("keeps a present invoice as the merge key (multi-line invoices stay one fueling event)", () => {
    const { fuelLines: fl } = normalizeTransactionRows([
      { CardNumber: "9", TransactionId: "T1", Invoice: "INV9", Quantity: "50", Amount: "200", TransactionPOSDate: "06/01/2026", ProductDescription: "ULSD DIESEL" },
      { CardNumber: "9", TransactionId: "T2", Invoice: "INV9", Quantity: "70", Amount: "280", TransactionPOSDate: "06/01/2026", ProductDescription: "ULSD DIESEL" },
    ]);
    expect(fl).toHaveLength(1); // same invoice = one event (TransactionId does not override a real invoice)
    expect(fl[0]!.external_ref).toBe("9|INV9|2026-06-01");
  });

  it("only falls back to a unique key when the invoice is blank (no 1-row-per-card collapse)", () => {
    const { fuelLines: fl } = normalizeTransactionRows([
      { "Card #": "9", Invoice: "", Item: "ULSD", Qty: "50", Amt: "200", "Tran Date": "2026-06-01" },
      { "Card #": "9", Invoice: "", Item: "ULSD", Qty: "70", Amt: "280", "Tran Date": "2026-06-02" },
    ]);
    expect(fl).toHaveLength(2); // previously both collapsed into a single "9|" row
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

describe("driversToProvision", () => {
  const existing = [{ full_name: "John Smith" }];
  it("returns EFS names with no matching driver record, one per normalized identity", () => {
    const out = driversToProvision(["ISRAEL PALOMAR", "SMITH, JOHN", "Israel Palomar", "Ramiro Ramirez"], existing);
    // "SMITH, JOHN" already exists (normalized); "ISRAEL PALOMAR" dedupes with "Israel Palomar" → one.
    expect(out).toEqual(["ISRAEL PALOMAR", "Ramiro Ramirez"]);
  });
  it("skips junk / single-token / blank names", () => {
    expect(driversToProvision(["DRIVER", "", null, "  ", "X"], existing)).toEqual([]);
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
    // 14:25 is the STATION's wall clock. Belgrade MT = Mountain (UTC-6 in June/DST) → 20:25Z.
    expect(f.fueled_at).toBe("2026-06-29T20:25:00.000Z");
    expect(f.fueled_at_precision).toBe("instant");
    expect(f.tran_date).toBe("2026-06-29"); // business date stays the printed local date
  });

  it("keeps the exact (tz-converted) time in the faithful line too", () => {
    const [line] = normalizeAllTransactionLines(rows);
    expect(line!.fueled_at).toBe("2026-06-29T20:25:00.000Z");
    expect(line!.tran_date).toBe("2026-06-29");
    expect(line!.qty).toBe(90);
    // tran_time is the printed STATION-LOCAL time (14:25), NOT the UTC instant (20:25) — this is what the
    // Transactions page shows verbatim so it matches the EFS report exactly.
    expect(line!.tran_time).toBe("14:25");
  });

  it("keeps the business date even when the local time crosses the UTC date boundary", () => {
    const { fuelLines: fl } = normalizeTransactionRows([
      { ...rows[0]!, TransactionPOSTime: "23:30:00" }, // 23:30 MDT = 05:30Z NEXT day
    ]);
    expect(fl[0]!.fueled_at).toBe("2026-06-30T05:30:00.000Z");
    expect(fl[0]!.tran_date).toBe("2026-06-29"); // ref + dedupe stay on the printed date
    expect(fl[0]!.external_ref.endsWith("|2026-06-29")).toBe(true);
  });

  it("falls back to naive-UTC (deterministic) when the state has no timezone mapping", () => {
    const { fuelLines: fl } = normalizeTransactionRows([
      { ...rows[0]!, LocationState: "ZZ" },
    ]);
    expect(fl[0]!.fueled_at).toBe("2026-06-29T14:25:00.000Z");
    expect(fl[0]!.fueled_at_precision).toBe("instant");
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
  const { declined, skipped } = normalizeRejectRows(rows);

  it("parses a declined attempt with a real (tz-converted) timestamp and trimmed card", () => {
    const d = declined[0]!;
    // 12:15 station wall clock in GA (Eastern, DST) → 16:15Z.
    expect(d.declined_at).toBe("2026-06-29T16:15:00.000Z");
    expect(d.card_ref).toBe("7083050030485897149");
    expect(d.error_code).toBe("3");
    expect(d.driver_ext_id).toBe("1967");
    expect(d.unit).toBe("702");
    expect(d.external_ref).toBe("7083050030485897149|0808024975|3|2026-06-29");
    expect(skipped).toHaveLength(0);
  });

  it("quarantines a reject row with an unparseable date instead of fabricating 'now'", () => {
    const { declined: d, skipped: sk } = normalizeRejectRows([
      { "Card Number": "1", Invoice: "X", "Error Code": "3", Date: "garbage" },
    ]);
    expect(d).toHaveLength(0);
    expect(sk).toHaveLength(1);
    expect(sk[0]!.reason).toBe("unparseable date");
  });
});

describe("zonedWallTimeToUtcIso (station-local → UTC, DST-correct)", () => {
  it("converts standard vs daylight time correctly for the same wall clock", () => {
    expect(zonedWallTimeToUtcIso("2026-01-15", "12:00:00", "America/Chicago")).toBe("2026-01-15T18:00:00.000Z"); // CST −6
    expect(zonedWallTimeToUtcIso("2026-07-15", "12:00:00", "America/Chicago")).toBe("2026-07-15T17:00:00.000Z"); // CDT −5
  });
  it("handles Arizona (no DST) and Newfoundland (half-hour zone)", () => {
    expect(zonedWallTimeToUtcIso("2026-07-15", "12:00:00", "America/Phoenix")).toBe("2026-07-15T19:00:00.000Z");
    expect(zonedWallTimeToUtcIso("2026-07-15", "12:00:00", "America/St_Johns")).toBe("2026-07-15T14:30:00.000Z");
  });
});

describe("efsInstant precision semantics", () => {
  it("date-only stays the noon-UTC sentinel with 'date' precision (never fabricates a time)", () => {
    const r = efsInstant("2026-06-29", null, "TX");
    expect(r).toEqual({ iso: "2026-06-29T12:00:00.000Z", precision: "date", tranDate: "2026-06-29" });
  });
  it("date+time+state converts the station wall clock to true UTC with 'instant' precision", () => {
    const r = efsInstant("2026-06-29", "07:37:00", "GA"); // EDT −4
    expect(r).toEqual({ iso: "2026-06-29T11:37:00.000Z", precision: "instant", tranDate: "2026-06-29" });
  });
});

describe("deriveFuelEventsFromEfsStore (repair path)", () => {
  const line = (over: Partial<import("./efsImport/index.js").EfsStoreLine>): import("./efsImport/index.js").EfsStoreLine => ({
    card_num: "94507", invoice: "INV1", tran_date: "2026-06-29",
    fueled_at: "2026-06-29T12:00:00.000Z", unit: "691", driver_name: "DONOVAN BOOTHE",
    odometer: 293580, location_name: "PILOT JAMESTOWN 305", city: "JAMESTOWN", state: "NM",
    item: "ULSD", qty: 100, amt: 400, ...over,
  });

  it("produces the same ref/merge semantics as the file parser (card|invoice|date, summed)", () => {
    const r = deriveFuelEventsFromEfsStore([
      line({}),
      line({ qty: 50, amt: 200 }),                                  // same invoice+day → merged
      line({ item: "DEFD", qty: 5, amt: 25 }),                      // non-fuel → skipped
      line({ invoice: "INV1", tran_date: "2026-07-01", fueled_at: "2026-07-01T12:00:00.000Z" }), // reused invoice, other day → separate
    ]);
    expect(r.skippedNonFuel).toBe(1);
    expect(r.events).toHaveLength(2);
    const first = r.events.find((e) => e.tran_date === "2026-06-29")!;
    expect(first.external_ref).toBe("94507|INV1|2026-06-29");
    expect(first.gallons).toBe(150);
    expect(first.total_cost).toBe(600);
    expect(first.price_per_gal).toBe(4);
    expect(first.fueled_at_precision).toBe("date"); // noon sentinel
    expect(r.events.find((e) => e.tran_date === "2026-07-01")!.external_ref).toBe("94507|INV1|2026-07-01");
  });

  it("splits reefer (ULSR) from tractor on backfill with the same refs as the parser", () => {
    const r = deriveFuelEventsFromEfsStore([
      line({ item: "ULSD", qty: 120, amt: 480 }),
      line({ item: "ULSR", qty: 40, amt: 150 }),
    ]);
    expect(r.events).toHaveLength(2);
    const tractor = r.events.find((e) => e.tank_type === "tractor")!;
    const reefer = r.events.find((e) => e.tank_type === "reefer")!;
    expect(tractor.gallons).toBe(120);
    expect(tractor.external_ref).toBe("94507|INV1|2026-06-29");
    expect(reefer.gallons).toBe(40);
    expect(reefer.external_ref).toBe("94507|INV1|2026-06-29|reefer");
  });

  it("marks timed rows as instant and keeps the earliest instant of a merged group", () => {
    const r = deriveFuelEventsFromEfsStore([
      line({ fueled_at: "2026-06-29T18:40:00.000Z" }),
      line({ fueled_at: "2026-06-29T18:25:00.000Z", qty: 10, amt: 40 }),
    ]);
    expect(r.events[0]!.fueled_at).toBe("2026-06-29T18:25:00.000Z");
    expect(r.events[0]!.fueled_at_precision).toBe("instant");
  });

  it("quarantines blank-invoice and unusable rows instead of guessing keys", () => {
    const r = deriveFuelEventsFromEfsStore([
      line({ invoice: null }),
      line({ tran_date: null }),
      line({ qty: 0 }),
    ]);
    expect(r.events).toHaveLength(0);
    expect(r.skippedBlankInvoice).toBe(1);
    expect(r.skippedUnusable).toBe(2);
  });
});

// ── WP1: reject-report golden rows (verbatim from data-samples/RejectTransactionReport-260707092249.xlsx),
// optional EFS alert fields, decline attribution, and the EFS driver-id learner ──────────────────────────
describe("normalizeRejectRows — WP1 golden rows + optional alert fields", () => {
  it("standard 15-column reject export → alert fields are null (they are NOT in this report)", () => {
    const { declined } = normalizeRejectRows([
      {
        Date: "2026-07-17 06:29:00", Time: "2026-07-17 06:29:00",
        "Card Number": "7083050030485867142      ", Invoice: "53790       ", "Location ID": "545350",
        "Location Name": "LOVES #646 TRAVEL STOP", "Location City": "WILLINGTON", "State/Prov": "CT",
        "Error Code": "1", "Error Description": "INVALID TRUCKSTOP IN53790|Failed restrictions|",
        Unit: "667", "Driver ID": "1995", "Driver Name": "YOEL VALLADARES ALBARENG",
        Policy: "1", "Policy Name": "Drivers                       ",
      },
    ]);
    expect(declined).toHaveLength(1);
    const d = declined[0]!;
    expect(d.unit).toBe("667");
    expect(d.driver_ext_id).toBe("1995");
    expect(d.card_assigned_unit).toBeNull();
    expect(d.efs_proximity_miles).toBeNull();
    expect(d.efs_truck_position_at).toBeNull();
  });
  it("a variant that DOES carry the card-assigned truck + proximity is captured faithfully", () => {
    const { declined } = normalizeRejectRows([
      {
        Date: "2026-07-11 15:37:00", Time: "2026-07-11 15:37:00",
        "Card Number": "7083050030281917521", Invoice: "0851226257",
        "Location Name": "PILOT N LAS VEGAS", "Location City": "N LAS VEGAS", "State/Prov": "NV",
        "Error Code": "1", "Error Description": "INVALID TRUCKSTOP|Merchant Position Too Far|",
        Unit: "576", "Driver ID": "1988", "Driver Name": "TEHONE CARTER",
        Truck: "572", Proximity: "644.26", "Truck Location Time": "15:33",
      },
    ]);
    const d = declined[0]!;
    expect(d.card_assigned_unit).toBe("572");
    expect(d.efs_proximity_miles).toBe(644.26);
    expect(d.efs_truck_position_at).toBe("15:33");
  });
});

describe("attributeDeclinedRow (WP1 D2 — revives the decline location check)", () => {
  const vehicles = [
    { id: "vA", unit_number: "0667" },
    { id: "vB", unit_number: "691" },
    { id: "amb1", unit_number: "900" },
    { id: "amb2", unit_number: "0900" }, // collides with 900 after zero-stripping → ambiguous
  ];
  const drivers = [
    { id: "dA", full_name: "Yoel Valladares Albareng", efs_driver_id: "1995" },
    { id: "dB", full_name: "Donovan Boothe", efs_driver_id: null },
  ];
  it("matches the pump Unit with fuel-line tolerance (leading zeros)", () => {
    const a = attributeDeclinedRow({ unit: "667", driver_ext_id: null, driver_name: null }, vehicles, drivers);
    expect(a.vehicle_id).toBe("vA");
  });
  it("prefers the stable EFS Driver ID over the name", () => {
    const a = attributeDeclinedRow({ unit: null, driver_ext_id: "1995", driver_name: "SOMEONE ELSE" }, vehicles, drivers);
    expect(a.driver_id).toBe("dA");
  });
  it("falls back to the tolerant name match (LAST, FIRST ≈ First Last)", () => {
    const a = attributeDeclinedRow({ unit: null, driver_ext_id: null, driver_name: "BOOTHE, DONOVAN" }, vehicles, drivers);
    expect(a.driver_id).toBe("dB");
  });
  it("ambiguous unit keys never guess", () => {
    const a = attributeDeclinedRow({ unit: "900", driver_ext_id: null, driver_name: null }, vehicles, drivers);
    expect(a.vehicle_id).toBeNull();
  });
});

describe("learnEfsDriverIds (WP1 D5)", () => {
  it("learns consistent 1:1 pairings only", () => {
    const m = learnEfsDriverIds([
      { driverExtId: "1981", driverId: "dW" },
      { driverExtId: "1981", driverId: "dW" },
      { driverExtId: "1999", driverId: "dS" },
    ]);
    expect(m.get("1981")).toBe("dW");
    expect(m.get("1999")).toBe("dS");
  });
  it("an ext id seen with two drivers — or a driver with two ext ids — is never learned", () => {
    const conflictingExt = learnEfsDriverIds([
      { driverExtId: "1981", driverId: "dW" },
      { driverExtId: "1981", driverId: "dX" },
    ]);
    expect(conflictingExt.size).toBe(0);
    const conflictingDriver = learnEfsDriverIds([
      { driverExtId: "1981", driverId: "dW" },
      { driverExtId: "1982", driverId: "dW" },
    ]);
    expect(conflictingDriver.size).toBe(0);
  });
  it("blank/unmatched pairs are ignored", () => {
    expect(learnEfsDriverIds([{ driverExtId: null, driverId: "dW" }, { driverExtId: "77", driverId: null }]).size).toBe(0);
  });
});

describe("52-column transexport variant — faithful capture (WP1 D5/F6)", () => {
  const row = {
    TransactionId: "1556179899", CardNumber: "7083050030095947565", TransactionPOSDate: "2026-07-17",
    TransactionPOSTime: "01:33:00", Invoice: "0854555567", Unit: "574", TrailerNumber: "539224",
    Odometer: "586163", DriverName: "CHRISTOPHER WEAVER", DriverId: "1981", Trip: "0132234",
    Control: "WCHRISTO", LocationName: "PILOT RAYVILLE 335", LocationCity: "RAYVILLE", LocationState: "LA",
    ProductCode: "ULSD", ProductDescription: "ULTRA LOW SULFUR DIESEL", PricePerUnit: "4.558",
    Quantity: "190", Amount: "865.94", Hubometer: "", SubFleet: "",
  };
  it("faithful line captures DriverId + TrailerNumber + Trip (reefer-pairing ground truth for WP8)", () => {
    const [l] = normalizeAllTransactionLines([row]);
    expect(l!.driver_ext_id).toBe("1981");
    expect(l!.trailer_number).toBe("539224");
    expect(l!.trip).toBe("0132234");
    expect(l!.control_id).toBe("WCHRISTO");
  });
  it("merged fuel event carries driver_ext_id for the driver-id learner", () => {
    const { fuelLines } = normalizeTransactionRows([row]);
    expect(fuelLines).toHaveLength(1);
    expect(fuelLines[0]!.driver_ext_id).toBe("1981");
  });
});
