import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { ingestFuelStatement, STATEMENT_BUCKET } from "./fuelStatementIngest.js";
import { splitTextRun, type StatementWord } from "@silvicom/shared";
import { statementWords, w, X } from "./statementWords.fixture.js";

/**
 * Recording a vendor statement (WP4).
 *
 * The property this file exists for: **the server decides whether a statement is true, not the
 * browser.** Only the browser can decode a PDF, so it sends positioned words — but words are evidence,
 * not a conclusion. The service re-parses them and refuses anything that cannot reproduce the totals
 * Pilot printed on its own statement. Everything else here follows from that: a rejected statement
 * writes nothing, an accepted one supersedes rather than overwrites, and the source document is hashed
 * from the bytes we actually stored.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

function seed(over: Record<string, unknown> = {}, storage: Record<string, (...a: never[]) => unknown> = {}): SupabaseRecorder {
  return createSupabaseRecorder({
    tables: {
      fuel_stations: [
        { id: "st-41", brand: "pilot", store_number: "41", state: "KY" },
        { id: "st-1057", brand: "flying_j", store_number: "1057", state: "TX" },
        { id: "st-37", brand: "one9", store_number: "37", state: "IN" },
      ],
      fuel_statements: { data: { id: "stmt-new" } },
      fuel_statement_lines: [],
      ...over,
    },
    storage: { upload: () => ({ data: { path: "p" }, error: null }), ...storage },
  });
}

describe("ingestFuelStatement", () => {
  it("records a statement that reproduces the vendor's own printed totals", async () => {
    const rec = seed();
    const r = await ingestFuelStatement(rec.client, ORG, USER, { words: statementWords(), filename: "db139445F.pdf" });
    expect(r.ok).toBe(true);
    expect(r.invoiceNo).toBe("795506105");
    expect(r.periodStart).toBe("2026-08-17");
    expect(r.periodEnd).toBe("2026-08-23");
    expect(r.lines).toBe(3);
    expect(r.fills).toBe(2); // the 033 reefer line is NOT a tractor fill
  });

  it("REFUSES a statement whose money does not tie, and writes nothing", async () => {
    // One line's Amount shifted into the neighbouring column — the drift a layout change causes.
    const broken = statementWords().map((x) => (x.text === "833.39" && x.x === X.amount ? { ...x, x: X.amount + 40 } : x));
    const rec = seed();
    const r = await ingestFuelStatement(rec.client, ORG, USER, { words: broken });
    expect(r.ok).toBe(false);
    expect(r.tieOutFailures?.join(" ")).toMatch(/does not match the statement's printed/);
    // Nothing may be written on a refusal — not the statement, not a line, not the source document.
    expect(rec.queries.some((q) => q.table === "fuel_statements" && q.write)).toBe(false);
    expect(rec.queries.some((q) => q.table === "fuel_statement_lines" && q.write)).toBe(false);
    expect(rec.storageCalls()).toHaveLength(0);
  });

  it("refuses a PDF that isn't a statement at all", async () => {
    const rec = seed();
    const r = await ingestFuelStatement(rec.client, ORG, USER, { words: [w("Some", 10, 10), w("other", 40, 10)] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/isn't a Pilot weekly statement or invoice/);
    expect(rec.queries.some((q) => q.write)).toBe(false);
  });

  it("resolves each line's brand from (store number, state), not the store number alone", async () => {
    const rec = seed();
    await ingestFuelStatement(rec.client, ORG, USER, { words: statementWords() });
    const lines = rec.queries.find((q) => q.table === "fuel_statement_lines" && q.write)?.write?.payload as Array<Record<string, unknown>>;
    expect(lines.map((l) => l.brand)).toEqual(["pilot", "flying_j", "one9"]);
    expect(lines.map((l) => l.station_id)).toEqual(["st-41", "st-1057", "st-37"]);
    // The old statement layout prints no Vehicle or Driver ID; its lines carry null, never a guess.
    expect(lines.every((l) => l.pilot_vehicle_id === null && l.pilot_driver_id === null)).toBe(true);
    // 033 is REEFER fuel — filing it as tractor fuel is what makes reefer gallons corrupt MPG.
    expect(lines.map((l) => l.tank_type)).toEqual(["tractor", "tractor", "reefer"]);
  });

  it("reports sites it could not resolve instead of guessing a brand", async () => {
    const rec = seed({ fuel_stations: [{ id: "st-41", brand: "pilot", store_number: "41", state: "KY" }] });
    const r = await ingestFuelStatement(rec.client, ORG, USER, { words: statementWords() });
    expect(r.unresolvedSites).toEqual(["1057|TX", "37|IN"]);
    const lines = rec.queries.find((q) => q.table === "fuel_statement_lines" && q.write)?.write?.payload as Array<Record<string, unknown>>;
    expect(lines[1]!.brand).toBeNull();
  });

  it("keeps fuel cost separate from bundled merchandise on the statement total", async () => {
    const rec = seed();
    await ingestFuelStatement(rec.client, ORG, USER, { words: statementWords() });
    const stmt = rec.queries.find((q) => q.table === "fuel_statements" && q.write)?.write?.payload as Record<string, unknown>;
    expect(stmt.fuel_amount).toBeCloseTo(1495.32, 2);
    expect(stmt.invoice_total).toBeCloseTo(1495.32, 2); // no misc on this fixture
    expect(stmt.retail_total).toBeCloseTo(1718.2, 2);
    expect(stmt.savings).toBeCloseTo(222.88, 2);
    // the vendor's own figures are stored beside ours so the tie-out stays auditable
    expect(stmt.printed_amount).toBeCloseTo(1495.32, 2);
    expect(stmt.printed_savings).toBeCloseTo(222.88, 2);
  });

  it("stores the source PDF and hashes the bytes it actually stored", async () => {
    const rec = seed();
    const pdf = Buffer.from("%PDF-1.3 pretend", "utf8");
    const r = await ingestFuelStatement(rec.client, ORG, USER, {
      words: statementWords(), filename: "db139445F.pdf", sourceBase64: pdf.toString("base64"),
    });
    expect(r.sourceStored).toBe(true);
    const call = rec.storageCalls()[0]!;
    expect(call.bucket).toBe(STATEMENT_BUCKET);
    expect(call.fn).toBe("upload");
    expect(String(call.args[0])).toMatch(new RegExp(`^${ORG}/795506105-[0-9a-f]{12}\\.pdf$`));
    const stmt = rec.queries.find((q) => q.table === "fuel_statements" && q.write)?.write?.payload as Record<string, unknown>;
    // The digest must be of the bytes the SERVER stored — a client-supplied one attests to nothing.
    expect(stmt.source_sha256).toBe(createHash("sha256").update(pdf).digest("hex"));
    expect(stmt.source_bytes).toBe(pdf.length);
    // and the object name embeds that digest, so two uploads of the same week cannot collide
    expect(String(call.args[0])).toContain(String(stmt.source_sha256).slice(0, 12));
  });

  it("supersedes the previous statement for the same invoice rather than overwriting it", async () => {
    const rec = seed({
      fuel_statements: (q: RecordedQuery) => (q.write ? { data: { id: "stmt-new" } } : { data: { id: "stmt-old" } }),
    });
    const r = await ingestFuelStatement(rec.client, ORG, USER, { words: statementWords() });
    expect(r.supersededStatementId).toBe("stmt-old");
    const upd = rec.queries.find((q) => q.table === "fuel_statements" && q.write?.method === "update");
    expect((upd?.write?.payload as Record<string, unknown>).superseded_by).toBe("stmt-new");
    expect(upd?.filters()).toContainEqual({ col: "id", val: "stmt-old" });
    // the supersede runs AFTER the lines land, so a failed upload never retires a good statement
    const idxLines = rec.queries.findIndex((q) => q.table === "fuel_statement_lines" && q.write);
    expect(rec.queries.indexOf(upd!)).toBeGreaterThan(idxLines);
  });

  it("takes the statement back out if its lines fail, so no total is left with nothing behind it", async () => {
    const rec = seed({ fuel_statement_lines: { data: [], writeError: { message: "boom" } } });
    const r = await ingestFuelStatement(rec.client, ORG, USER, { words: statementWords() });
    expect(r.ok).toBe(false);
    const del = rec.queries.find((q) => q.table === "fuel_statements" && q.write?.method === "delete");
    expect(del).toBeDefined();
    expect(del!.filters()).toContainEqual({ col: "id", val: "stmt-new" });
  });

  it("scopes every query to the org — the service role bypasses RLS, so the filter IS the boundary", async () => {
    const rec = seed({ fuel_statements: (q: RecordedQuery) => (q.write ? { data: { id: "stmt-new" } } : { data: { id: "stmt-old" } }) });
    await ingestFuelStatement(rec.client, ORG, USER, { words: statementWords() });
    // `fuel_stations` is the GLOBAL station registry — public reference facts, shared across orgs.
    expectOrgScoped(rec, ORG, { exempt: ["fuel_stations"] });
  });

  it("records Pilot's 2026-11 invoice layout, which prints no period, retail total or savings total", async () => {
    const rec = seed({ fuel_stations: [{ id: "st-612", brand: "pilot", store_number: "612", state: "AZ" }] });
    const r = await ingestFuelStatement(rec.client, ORG, USER, { words: invoiceWords(), filename: "Standard_Invoice_Gen_Template_INV-59656.pdf" });
    expect(r.ok).toBe(true);
    expect(r.invoiceNo).toBe("INV-59656");
    expect([r.periodStart, r.periodEnd]).toEqual(["2026-11-17", "2026-11-22"]);
    const stmt = rec.queries.find((q) => q.table === "fuel_statements" && q.write)?.write?.payload as Record<string, unknown>;
    expect(stmt).toMatchObject({ invoice_no: "INV-59656", billing_date: "2026-11-23", invoice_total: 811.92,
      retail_total: 948.54, savings: 136.62, printed_amount: 811.92, printed_retail: null, printed_savings: null });
    const lines = rec.queries.find((q) => q.table === "fuel_statement_lines" && q.write)?.write?.payload as Array<Record<string, unknown>>;
    expect(lines.map((l) => [l.ticket_no, l.site_number, l.state, l.station_id, l.tank_type])).toEqual([
      ["0883000001", "4569", "SC", null, "reefer"],
      ["0564000003", "612", "AZ", "st-612", "tractor"],
    ]);
    expect(lines.map((l) => [l.pilot_vehicle_id, l.pilot_driver_id])).toEqual([["530001", "1234"], ["530003", "1234"]]);
  });
});

/** Two lines of the 2026-11 invoice in its measured geometry (pilotInvoice.test.ts has the full layout). */
function invoiceWords(): StatementWord[] {
  const run = (text: string, x: number, y: number): StatementWord[] => splitTextRun({ text, x, y, page: 1, width: text.length * 3.3 });
  const cols = [19.0, 57.6, 107.3, 168.3, 241.8, 313.5, 372.3, 431.4, 490.2, 549.3, 589.9, 645.3, 707.5];
  const row = (y: number, cells: string[]) => cells.flatMap((c, i) => run(c, cols[i]!, y));
  const header: [string, number][] = [["Card#", 19.0], ["Unit Number", 57.9], ["Date", 125.1], ["Transaction #", 178.6],
    ["Store Location", 249.4], ["Vehicle ID", 322.4], ["Driver ID", 383.4], ["Odometer", 440.0], ["Product", 502.5],
    ["Qty", 558.9], ["Sales Tax", 598.2], ["Retail $", 659.7]];
  return [
    ...run("Acct No: 139445", 13.4, 22.8), ...run("Invoice No: INV-59656", 13.4, 83.8), ...run("Billing Date: 11/23/2026", 13.4, 96),
    ...header.flatMap(([t, x]) => run(t, x, 161.4)),
    ...row(170.5, ["111111", "813", "11/17/2026", "0883000001", "4569 Hardeeville", "530001", "1234", "13445", "Reefer", "11.44", "$0.00", "$60.03", "$59.37"]),
    ...run("SC", 240.3, 178.9),
    ...row(207.2, ["333333", "708", "11/22/2026", "0564000003", "612 Winslow AZ", "530003", "1234", "246618", "Truck Diesel", "107.65", "$0.00", "$888.51", "$752.55"]),
    ...run("Amount Purchased: $811.92", 13.4, 300), ...run("USD Total: $811.92", 13.4, 312), ...run("Transaction Tax: $0.00", 13.4, 324),
  ];
}
