import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { ingestFuelStatement, STATEMENT_BUCKET } from "./fuelStatementIngest.js";
import type { StatementWord } from "@silvicom/shared";

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

// ── a miniature statement in the REAL geometry of db139445F.pdf (invoice 795506105) ──────────────
const X = { card: 19, unit: 79, loc: 95, city: 116, state: 167, ticket: 177, auth: 221, po: 264,
  date: 337, odo: 365, prod: 414, units: 448, cost: 471, amount: 511, invoice: 706, retail: 748 };
const HEADER_X = [24, 61, 97, 115, 156, 184, 227, 283, 339, 370, 409, 437, 472, 503, 543, 566, 600, 641, 674, 704, 744];
const HEADER_T = ["Number", "Number", "Loc.", "City", "State", "Number", "Number", "Number", "Date", "Reading",
  "Prod", "Units", "Cost", "Amount", "Qts", "Amount", "Advance", "Disc.", "Tax", "Total", "Total"];
const w = (text: string, x: number, y: number, page = 1): StatementWord => ({ text, x, y, page });

/** Two tractor fills and one reefer line; totals below are their exact arithmetic. */
function statementWords(): StatementWord[] {
  const line = (y: number, c: string[], prod: string, units: string, cost: string, amt: string, ret: string) => [
    w(c[0]!, X.card, y), w(c[1]!, X.unit, y), w(c[2]!, X.loc, y), w(c[3]!, X.city, y), w(c[4]!, X.state, y),
    w("051033249", X.ticket, y), w("367611", X.auth, y), w("HENRY SMITH", X.po, y),
    w("08/17", X.date, y), w("335019", X.odo, y), w(prod, X.prod, y), w(units, X.units, y),
    w(cost, X.cost, y), w(amt, X.amount, y), w(amt, X.invoice, y), w(ret, X.retail, y),
  ];
  return [
    w("Acct", 22, 20), w("No:", 44, 20), w("139445", 83, 20),
    w("Invoice", 24, 30), w("Number:", 58, 30), w("795506105", 99, 30),
    w("For", 287, 30), w("Period", 305, 30), w("Beginning", 337, 30), w("08/17/26,", 384, 30),
    w("Ending", 428, 30), w("08/23/26", 462, 30),
    w("Billing", 579, 20), w("Date:", 609, 20), w("08/24/26", 636, 20),
    ...HEADER_T.map((t, i) => w(t, HEADER_X[i]!, 133)),
    ...line(150, ["957562", "684", "041", "Mt", "KY"], "020", "168.6", "4.9442", "833.39", "977.50"),
    ...line(161, ["987568", "648", "1057", "Pasadena", "TX"], "020", "100.0", "5.0000", "500.00", "560.00"),
    ...line(172, ["327974", "699", "037", "Whiteland", "IN"], "033", "30.6", "5.2865", "161.93", "180.70"),
    // printed totals: units 299.2, fuel 1495.32, retail 1718.20, savings 1718.20 − 1495.32 = 222.88
    w("268.6", 432, 300), w("1,333.39", 495, 300), w("020", 96, 302), w("Customer", 117, 302), w("Total", 154, 302),
    w("30.6", 443, 313), w("161.93", 504, 313), w("033", 96, 315), w("Customer", 117, 315), w("Total", 154, 315),
    w("**", 94, 340), w("Customer", 102, 340), w("Total", 139, 340),
    w("299.2", 433, 340), w("1,495.32", 496, 340), w(".00", 622, 340), w(".00", 679, 340), w("1,718.20", 734, 340),
    w("Savings", 94, 372), w("Total", 124, 372), w("222.88", 500, 372),
    w("020", 620, 400), w("Truck", 640, 400), w("Diesel", 665, 400),
    w("033", 620, 411), w("Reefer", 640, 411),
  ];
}

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
    expect(r.error).toMatch(/isn't a Pilot statement/);
    expect(rec.queries.some((q) => q.write)).toBe(false);
  });

  it("resolves each line's brand from (store number, state), not the store number alone", async () => {
    const rec = seed();
    await ingestFuelStatement(rec.client, ORG, USER, { words: statementWords() });
    const lines = rec.queries.find((q) => q.table === "fuel_statement_lines" && q.write)?.write?.payload as Array<Record<string, unknown>>;
    expect(lines.map((l) => l.brand)).toEqual(["pilot", "flying_j", "one9"]);
    expect(lines.map((l) => l.station_id)).toEqual(["st-41", "st-1057", "st-37"]);
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
});
