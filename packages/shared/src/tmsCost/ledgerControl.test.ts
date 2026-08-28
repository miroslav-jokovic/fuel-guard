import { describe, it, expect } from "vitest";
import {
  buildLedgerCoverageReport,
  tmsOfficeSettlementLineSchema,
  type GlModuleTotal,
} from "./index.js";

/**
 * Double-entry: a $100 posting appears twice, as a +100 debit and a -100 credit, so `abs_amount` is
 * 200 and `net_amount` is 0. Building fixtures this way rather than hand-picking numbers is what
 * makes the halving assertion mean something.
 */
const module_ = (post_module: string, glid: string, value: number, lines = 2): GlModuleTotal => ({
  post_module,
  glid,
  lines,
  net_amount: 0,
  abs_amount: value * 2,
});

describe("buildLedgerCoverageReport", () => {
  it("reports the one-sided value, not the signed sum", () => {
    // A complete module nets to zero. Reporting that would show $0.00 for a month in which the
    // carrier spent a million dollars.
    const r = buildLedgerCoverageReport([module_("FUEL", "20550000", 1_000_000)]);
    expect(r.modules[0]!.oneSidedValue).toBe(1_000_000);
    expect(r.ledgerThroughput).toBe(1_000_000);
  });

  it("sums several accounts within one module", () => {
    const r = buildLedgerCoverageReport([
      module_("SET", "20500010", 900),
      module_("SET", "20500020", 100),
    ]);
    expect(r.modules).toHaveLength(1);
    expect(r.modules[0]!.oneSidedValue).toBe(1000);
    expect(r.modules[0]!.lines).toBe(4);
  });

  it("leaves an uncovered module null rather than zero", () => {
    // A zero would read as "we extracted nothing and that is correct". Null says nobody looked.
    const r = buildLedgerCoverageReport([module_("GJ", "40000000", 5_000_000)]);
    expect(r.modules[0]!.source).toBeNull();
    expect(r.modules[0]!.extracted).toBeNull();
    expect(r.modules[0]!.drift).toBeNull();
    expect(r.uncoveredThroughput).toBe(5_000_000);
    expect(r.throughputCoveragePct).toBe(0);
  });

  it("records drift for a covered module without claiming it balances", () => {
    // June 2026: the FUEL module moved $1,191,574 one-sided while the payable leg was $1,017,602.
    // The gap is the card discount posting through its own accounts, not missing rows.
    const r = buildLedgerCoverageReport(
      [module_("FUEL", "20550000", 1_191_574)],
      [{ post_module: "FUEL", source: "expenses.mjs", extracted: 1_017_602 }],
    );
    expect(r.modules[0]!.drift).toBe(-173_972);
    expect(r.driftingModules).toEqual(["FUEL"]);
    expect(r.throughputCoveragePct).toBe(100);
  });

  it("reports no drift when a claim matches exactly", () => {
    const r = buildLedgerCoverageReport(
      [module_("SET", "20500010", 1000)],
      [{ post_module: "SET", source: "settlements.mjs", extracted: 1000 }],
    );
    expect(r.modules[0]!.drift).toBe(0);
    expect(r.driftingModules).toEqual([]);
  });

  it("computes coverage across covered and uncovered modules", () => {
    const r = buildLedgerCoverageReport(
      [module_("FUEL", "20550000", 250), module_("GJ", "40000000", 750)],
      [{ post_module: "FUEL", source: "expenses.mjs", extracted: 250 }],
    );
    expect(r.ledgerThroughput).toBe(1000);
    expect(r.coveredThroughput).toBe(250);
    expect(r.uncoveredThroughput).toBe(750);
    expect(r.throughputCoveragePct).toBe(25);
  });

  it("ignores a claim for a module the window does not contain", () => {
    // A stale claim must not invent coverage for a module that posted nothing.
    const r = buildLedgerCoverageReport(
      [module_("FUEL", "20550000", 100)],
      [{ post_module: "PAYROLL", source: "ghost.mjs", extracted: 999 }],
    );
    expect(r.modules).toHaveLength(1);
    expect(r.coveredThroughput).toBe(0);
  });

  it("ranks modules by size, so the biggest gap is read first", () => {
    const r = buildLedgerCoverageReport([
      module_("FUEL", "20550000", 100),
      module_("GJ", "40000000", 5000),
      module_("SET", "20500010", 900),
    ]);
    expect(r.modules.map((m) => m.post_module)).toEqual(["GJ", "SET", "FUEL"]);
  });

  it("returns zero coverage rather than dividing by zero on an empty window", () => {
    const r = buildLedgerCoverageReport([], []);
    expect(r.ledgerThroughput).toBe(0);
    expect(r.throughputCoveragePct).toBe(0);
  });
});

describe("tmsOfficeSettlementLineSchema", () => {
  it("carries descr verbatim, including an embedded truck number", () => {
    // OFF has no subledger: the ledger line IS the record. The truck number in the note is NOT
    // parsed out — a unit scraped from a 40-character truncated string is a guess, and D-MC12
    // forbids the extraction layer from asserting an attribution McLeod does not make itself.
    const line = tmsOfficeSettlementLineSchema.parse({
      // `gl_ledger.id`, required since 0276 made these lines STAGED rather than report-only: the
      // sweep re-reads a rolling window, so the upsert needs the line's own identity or every pass
      // would stack another copy of the same month's payroll.
      external_id: "GL-2291",
      glid: "30290000",
      descr: "BIGRIG, Towing (truck # 506) reimbur",
      amount: 1203,
    });
    expect(line.descr).toBe("BIGRIG, Towing (truck # 506) reimbur");
    expect(line).not.toHaveProperty("tractor_unit");
  });

  // The identity is not optional. A line without it cannot be upserted idempotently, and silently
  // accepting one would mean the payroll table grows a duplicate set of rows on every sweep.
  it("refuses a line with no identity", () => {
    expect(
      tmsOfficeSettlementLineSchema.safeParse({ glid: "30290000", amount: 1203 }).success,
    ).toBe(false);
  });
});
