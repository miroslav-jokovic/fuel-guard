import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { ReceiptUploadError, runReceiptUpload } from "./receiptUpload.js";

/**
 * A driver-paid fuel file through preview and commit (IP8). The shapes are the two real files of
 * 2026-10-07: the fuel app's CSV names only the driver, McLeod's export names the unit. Fixtures are
 * functions of the query — the recorder does not filter, so a flat array would prove nothing about
 * which driver, day or truck was asked for.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const V512 = "5a1b2c3d-4e5f-4a6b-8c7d-000000000512";
const V718 = "5a1b2c3d-4e5f-4a6b-8c7d-000000000718";
const V101 = "5a1b2c3d-4e5f-4a6b-8c7d-000000000101";
const FOREIGN = "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const VEHICLES = [
  { id: V512, unit_number: "512", mcleod_tractor_id: "512", samsara_vehicle_id: "sv512" },
  { id: V718, unit_number: "718", mcleod_tractor_id: "718", samsara_vehicle_id: "sv718" },
  { id: V101, unit_number: "101", mcleod_tractor_id: "101", samsara_vehicle_id: "sv101" },
];
const DRIVERS = [
  { id: "d1", full_name: "DRIVER A", other_names: null, samsara_driver_id: "s1" },
  { id: "d2", full_name: "Same Name", other_names: null, samsara_driver_id: "s2" },
  { id: "d3", full_name: "Somebody Else", other_names: ["same name"], samsara_driver_id: "s3" },
];
// Driver A: in 512 from May, except one September day spent in 101 as well (a swap mid-day).
const ASSIGNMENTS = [
  { driver_samsara_id: "s1", vehicle_samsara_id: "sv512", start_at: "2026-05-06T12:00:00Z", end_at: "2026-09-20T14:00:00Z" },
  { driver_samsara_id: "s1", vehicle_samsara_id: "sv101", start_at: "2026-09-20T15:00:00Z", end_at: "2026-09-20T20:00:00Z" },
  { driver_samsara_id: "s1", vehicle_samsara_id: "sv512", start_at: "2026-09-20T21:00:00Z", end_at: null },
];

const opsOf = (q: RecordedQuery) => q.ops.map((o) => [o.method, ...o.args] as unknown[]);
const arg = (q: RecordedQuery, m: string, c: string) => opsOf(q).find((o) => o[0] === m && o[1] === c)?.[2];

function recorder(liveFingerprints: string[] = []) {
  return createSupabaseRecorder({
    tables: {
      vehicles: (q) => {
        for (const col of ["id", "mcleod_tractor_id", "unit_number", "samsara_vehicle_id"] as const) {
          const list = arg(q, "in", col) as string[] | undefined;
          if (list) return VEHICLES.filter((v) => v[col] != null && list.includes(v[col]!));
        }
        return [];
      },
      drivers: DRIVERS,
      driver_vehicle_assignments: (q) => ASSIGNMENTS.filter((a) => a.driver_samsara_id === arg(q, "eq", "driver_samsara_id")),
      ifta_fuel_receipts: (q) => {
        const asked = arg(q, "in", "fingerprint") as string[] | undefined;
        return asked ? liveFingerprints.filter((f) => asked.includes(f)).map((fingerprint) => ({ fingerprint })) : [];
      },
      ifta_fuel_receipt_uploads: [{ id: "u-1" }],
    },
  });
}

const APP_HEADER = "Transaction ID,Date of Visit,Street,City,State,Zip,Gallons Dispensed,Fuel Type,Retail,Cost,Credit Card Fee,Retail Cost,Paid,Truck Stop,Name,Truck #,Card Last4";
const appRow = (id: string, when: string, state: string, gal: string, name = "Driver A") =>
  `${id},${when},1 Main,Yukon,${state},73099,${gal},Diesel,$5.60,$5.50,$1.00,$561.08,$597.85,OnCue #145,${name},,`;
const csv = (...rows: string[]) => Buffer.from(`\uFEFF${[APP_HEADER, ...rows].join("\r\n")}\r\n`).toString("base64");

const run = (rec: ReturnType<typeof recorder>, contentBase64: string, over: Partial<{ commit: boolean; truckChoices: Record<string, string>; fileName: string }> = {}) =>
  runReceiptUpload(rec.client as unknown as SupabaseClient, ORG, {
    fileName: "IFTA Report_report.csv", contentBase64, commit: false, truckChoices: {}, actorId: null, ...over,
  });

describe("runReceiptUpload — the fuel app's CSV (driver named, truck not)", () => {
  it("finds the truck from the driver's Samsara assignment on the day of each fill, and writes nothing on a preview", async () => {
    const rec = recorder();
    const r = await run(rec, csv(appRow("T1", "2026-09-26 13:42", "Oklahoma", "100.211"), appRow("T2", "2026-07-23 12:18", "Texas", "117.147")));
    expect(r.format).toBe("fuel_app_csv");
    expect(r.rows.map((x) => [x.line, x.status, x.unitNumber, x.truckBasis])).toEqual([
      [2, "new", "512", "driver_assignment"],
      [3, "new", "512", "driver_assignment"],
    ]);
    expect(r.truckQuestions).toEqual([]);
    expect(r.committed).toBeNull();
    expect(r.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.writes()).toEqual([]);
    expectOrgScoped(rec, ORG);
  });

  it("asks — never guesses — when the driver sat in two trucks that day, suggesting the truck the rest of the file used", async () => {
    const rec = recorder();
    const r = await run(rec, csv(appRow("T1", "2026-09-20 16:00", "Oklahoma", "50"), appRow("T2", "2026-09-26 13:42", "Oklahoma", "100.211")));
    expect(r.rows.map((x) => x.status)).toEqual(["needs_truck", "new"]);
    expect(r.truckQuestions).toEqual([
      expect.objectContaining({ key: "driver:driver a", rows: 1, suggestion: { vehicleId: V512, unitNumber: "512" } }),
    ]);
  });

  it("asks when no driver, or two drivers, carry the name", async () => {
    const rec = recorder();
    const r = await run(rec, csv(appRow("T1", "2026-09-26 13:42", "Oklahoma", "20", "Nobody Known"), appRow("T2", "2026-09-26 13:42", "Texas", "20", "Same Name")));
    expect(r.truckQuestions.map((q) => [q.key, q.why])).toEqual([
      ["driver:nobody known", "No driver here has this name."],
      ["driver:same name", "More than one driver has this name."],
    ]);
  });

  it("refuses to commit while a row has no truck, then lands it once a truck is chosen — saying the truck was chosen", async () => {
    const content = csv(appRow("T1", "2026-09-26 13:42", "Oklahoma", "20", "Nobody Known"));
    await expect(run(recorder(), content, { commit: true })).rejects.toBeInstanceOf(ReceiptUploadError);

    const rec = recorder();
    const r = await run(rec, content, { commit: true, truckChoices: { "driver:nobody known": V718 } });
    expect(r.committed).toEqual({ uploadId: "u-1", imported: 1, alreadyPresent: 0 });
    const [row] = rec.writtenRows("ifta_fuel_receipts");
    expect(row).toMatchObject({
      org_id: ORG, upload_id: "u-1", vehicle_id: V718, truck_basis: "chosen_at_upload", jurisdiction: "OK",
      fueled_on: "2026-09-26", fueled_time_local: "13:42", gallons: 20, fingerprint: "fuel_app:T1", driver_as_filed: "Nobody Known",
    });
    expect(rec.writtenRows("ifta_fuel_receipt_uploads")[0]).toMatchObject({
      org_id: ORG, format: "fuel_app_csv", rows_in_file: 1, rows_imported: 1, rows_already_present: 0, rows_refused: 0,
    });
    expectOrgScoped(rec, ORG);
  });

  it("lands only what is new when the same file comes back with more rows", async () => {
    const rec = recorder(["fuel_app:T1"]);
    const r = await run(rec, csv(appRow("T1", "2026-09-26 13:42", "Oklahoma", "100.211"), appRow("T2", "2026-07-23 12:18", "Texas", "117.147")), { commit: true });
    expect(r.rows.map((x) => x.status)).toEqual(["already_present", "new"]);
    expect(r.committed).toMatchObject({ imported: 1, alreadyPresent: 1 });
    expect(rec.writtenRows("ifta_fuel_receipts").map((x) => x.fingerprint)).toEqual(["fuel_app:T2"]);
  });

  it("refuses a chosen truck that is not this organization's", async () => {
    await expect(
      run(recorder(), csv(appRow("T1", "2026-09-26 13:42", "Oklahoma", "20", "Nobody Known")), { truckChoices: { "driver:nobody known": FOREIGN } }),
    ).rejects.toThrow(/not one of this organization's trucks/);
  });
});

describe("runReceiptUpload — McLeod's Fuel Ticket Hist Listing (.xlsx, unit named)", () => {
  async function workbook(rows: Array<[Date, string, string, number]>): Promise<string> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("FUEL TICKET HIST LISTING");
    ws.addRow(["Date", "Tractor Number", "City", "State", "Gallons Purchased", "Highway", "Invoice Number", "Price Per Gallon", "Total", "Void Date"]);
    for (const [d, unit, st, gal] of rows) ws.addRow([d, unit, "JOPLIN", st, gal, "Yes", "123456", 5.115, 729.09, null]);
    return Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
  }

  it("matches the unit to the truck and reads Excel's date cells as calendar days", async () => {
    const rec = recorder();
    const content = await workbook([[new Date(Date.UTC(2026, 7, 21)), "718", "MO", 142.54], [new Date(Date.UTC(2026, 8, 18)), "999", "OK", 40]]);
    const r = await run(rec, content, { fileName: "MARIJA CASH FUEL.xlsx" });
    expect(r.format).toBe("mcleod_ticket_export");
    expect(r.rows.map((x) => [x.fueledOn, x.status, x.unitNumber, x.truckBasis])).toEqual([
      ["2026-08-21", "new", "718", "unit_in_file"],
      ["2026-09-18", "needs_truck", null, null],
    ]);
    expect(r.truckQuestions.map((q) => [q.key, q.label])).toEqual([["unit:999", "unit 999"]]);
  });

  it("refuses a file that is not .csv or .xlsx, and an .xlsx that is not a workbook", async () => {
    await expect(run(recorder(), csv(), { fileName: "receipts.pdf" })).rejects.toThrow(/\.csv or \.xlsx/);
    await expect(run(recorder(), Buffer.from("not a zip").toString("base64"), { fileName: "x.xlsx" })).rejects.toThrow(/not a valid \.xlsx/);
  });
});
