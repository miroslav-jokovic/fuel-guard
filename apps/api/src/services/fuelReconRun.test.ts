import { describe, it, expect } from "vitest";
import { RECON_EXCEPTION_KINDS } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { runFuelReconciliation } from "./fuelReconRun.js";

/**
 * The server side of a reconciliation. Its arithmetic is `reconcileFuelReport`, tested in
 * `packages/shared`; what is only testable here is everything that makes the run a RECORD rather than
 * a screen:
 *
 *   • it reads the org's own fills and nothing else — `admin` is the service role and bypasses RLS, so
 *     the `.eq("org_id", …)` on every query is the only tenant boundary this code has;
 *   • it REFUSES a file that cannot reproduce its own printed totals, rather than reconciling it;
 *   • it writes the tolerances it used, so a run stays readable after somebody widens the setting.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const PAN = "7083050030490367971";

/** The `All Transactions` sheet's real shape: metadata rows, then the header, then lines. */
const grid = (rows: unknown[][] = []): unknown[][] => [
  ["Query Name", "DBTransactionsByAccountandTransactionDate"],
  ["StartDate", "2026-08-17"],
  ["EndDate", "2026-08-23"],
  ["StandardAcctNo", 139445],
  ["CompanyId", "StandardAcctNo", "CustomerName", "Authorization_No", "UnitNo", "Card_No", "Site", "SiteDescr", "Quantity", "InvoiceTotal", "RetailTotal", "TransactionDate", "TransactionTime", "ProductCode", "ProductDescription"],
  ...rows,
];
const line = (qty: number, amt: number, code = 20, desc = "Truck Diesel", card = "367971") =>
  [2, 139445, "Silvicom Inc", 354187, 701, card, 436, "436 Amarillo TX", qty, amt, amt + 40, "2026-08-17", "12:00", code, desc];

/** A PivotTable sheet printing the grand total the export's tie-out gate checks against. */
const pivot = (gallons: number): unknown[][] => [
  ["Row Labels", "Average of Disc PPU", "Average of Retail PPU", "Average of Savings", "Sum of Quantity"],
  ["Aug", 4.35, 5.03, -0.68, gallons],
  ["Grand Total", 4.35, 5.03, -0.68, gallons],
];

const fill = (o: Record<string, unknown> = {}) => ({
  id: "s1", card_ref: PAN, control_id: null, vehicle_id: "v1",
  fueled_at: "2026-08-17T18:00:00.000Z", gallons: 100, total_cost: 500, state: "TX", tank_type: "tractor",
  ...o,
});

const seed = (fills: Record<string, unknown>[] = [fill()]) =>
  createSupabaseRecorder({
    tables: {
      fuel_transactions: fills,
      vehicles: [{ id: "v1", unit_number: "701" }],
      fuel_recon_runs: { data: { id: "run-1" } },
    },
  });

describe("runFuelReconciliation", () => {
  it("reconciles an export and records what it concluded", async () => {
    const rec = seed();
    const r = await runFuelReconciliation(rec.client, ORG, "user-1", {
      grid: grid([line(100, 500)]),
      pivotGrid: pivot(100),
      filename: "aug.xlsx",
    });
    expect(r.ok, r.error).toBe(true);
    expect(r.runId).toBe("run-1");
    expect(r.periodStart).toBe("2026-08-17");
    expect(r.result?.summary.clean).toBe(1);
  });

  it("scopes every query it makes to one organization", async () => {
    // The service role bypasses RLS. Without these filters the reconciliation would read every
    // carrier's fills — the same leak `fuel_spend_lines` had before 0247.
    const rec = seed();
    await runFuelReconciliation(rec.client, ORG, "user-1", { grid: grid([line(100, 500)]), pivotGrid: pivot(100) });
    expectOrgScoped(rec, ORG);
  });

  it("writes the tolerances it used, so the run stays readable after the setting moves", async () => {
    const rec = seed();
    await runFuelReconciliation(rec.client, ORG, "user-1", { grid: grid([line(100, 500)]), pivotGrid: pivot(100) });
    const [row] = rec.writtenRows("fuel_recon_runs");
    expect(row).toMatchObject({
      org_id: ORG,
      source_kind: "monthly_export",
      period_start: "2026-08-17",
      tol_gallons: 1,
      tol_amount_abs: 1,
      max_day_drift: 1,
    });
    expect(row!.matcher_version).toBeTruthy();
    expect(row!.summary).toBeTruthy();
    // The figure this replaces added recoverable money to money we may owe. Nothing writes it now.
    expect(row).not.toHaveProperty("dollars_at_stake");
  });

  // ── the gate (L8) ─────────────────────────────────────────────────────────────────────────────
  it("refuses an export whose gallons disagree with its own printed total", async () => {
    const rec = seed();
    const r = await runFuelReconciliation(rec.client, ORG, "user-1", {
      grid: grid([line(100, 500)]),
      pivotGrid: pivot(4200), // the file says 4,200 gallons; the rows say 100
    });
    expect(r.ok).toBe(false);
    expect(r.tieOutFailures?.join(" ")).toContain("PivotTable");
    expect(rec.writtenRows("fuel_recon_runs")).toHaveLength(0);
  });

  it("records that a file was ungated rather than pretending it passed", async () => {
    // An older export with no PivotTable sheet. It still reconciles — refusing it would help nobody —
    // but "we checked and it agreed" and "there was nothing to check" must not look the same.
    const rec = seed();
    const r = await runFuelReconciliation(rec.client, ORG, "user-1", { grid: grid([line(100, 500)]) });
    expect(r.ok).toBe(true);
    expect(r.tieOutGated).toBe(false);
    expect(rec.writtenRows("fuel_recon_runs")[0]).toMatchObject({ tie_out_gated: false });
    expect(r.tieOutNotes?.join(" ")).toContain("no printed total");
  });

  it("refuses a file that is not a Pilot report at all", async () => {
    const rec = seed();
    const r = await runFuelReconciliation(rec.client, ORG, "user-1", { grid: [["some", "other", "sheet"]] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("All Transactions");
    expect(rec.writtenRows("fuel_recon_runs")).toHaveLength(0);
  });

  it("refuses a request carrying neither words nor a grid", async () => {
    const rec = seed();
    const r = await runFuelReconciliation(rec.client, ORG, "user-1", {});
    expect(r.ok).toBe(false);
    expect(rec.writtenRows("fuel_recon_runs")).toHaveLength(0);
  });

  // ── what the matcher must not be asked to do ──────────────────────────────────────────────────
  it("sets DEF aside rather than reporting it as fuel we never recorded", async () => {
    // `fuel_transactions` carries no DEF at all — it arrives on `efs_transactions` as item DEFD — so a
    // DEF line has nothing on our side to match and must never be scored as a billed-but-missing fill.
    const rec = seed();
    const r = await runFuelReconciliation(rec.client, ORG, "user-1", {
      grid: grid([line(100, 500), line(9, 45, 140, "Diesel Exhaust Fluid")]),
      pivotGrid: pivot(100), // the pivot totals DIESEL only, so 100 is still right
    });
    expect(r.ok, r.error).toBe(true);
    expect(r.result?.summary.missingInSystem).toBe(0);
    expect(r.result?.unmatchable).toHaveLength(1);
  });

  it("names the truck on a recorded fill rather than leaving a uuid", async () => {
    const rec = seed();
    const r = await runFuelReconciliation(rec.client, ORG, "user-1", { grid: grid([line(100, 500)]), pivotGrid: pivot(100) });
    expect(r.result?.rows[0]?.system?.unit).toBe("701");
  });

  /**
   * ── THE CLOSE SCOPE, WHICH THE PGlite MATRIX CANNOT SEE FROM HERE (0253) ──────────────────────
   * `sync_fuel_exceptions` closes what a producer no longer finds, and it can only do that if it is
   * TOLD which kinds this producer owns. Omit `p_kinds` and the RPC — by the deliberate default that
   * keeps the pre-deploy four-argument call safe — closes nothing at all, silently, forever. That is
   * the exact failure 0250 shipped with, in a different disguise, so it is pinned on the argument
   * rather than left to the migration's own matrix.
   *
   * It is asserted against the shared constant, not a literal list: a producer that closes kinds it
   * does not own retires somebody else's money, and copying the list here is how the two drift.
   */
  it("tells the ledger which kinds this run is authoritative for, or nothing could ever close", async () => {
    const rec = seed();
    await runFuelReconciliation(rec.client, ORG, "user-1", { grid: grid([line(100, 500)]), pivotGrid: pivot(100) });
    const sync = rec.rpcs().find((c) => c.fn === "sync_fuel_exceptions");
    expect(sync, "the run never filed its findings").toBeTruthy();
    const args = (sync?.args ?? {}) as Record<string, unknown>;
    expect(args.p_kinds).toEqual(RECON_EXCEPTION_KINDS);
    expect(args.p_org).toBe(ORG);
    expect(args.p_run).toBe("run-1");
  });
});
