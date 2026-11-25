import { describe, it, expect } from "vitest";
import { RECON_EXCEPTION_KINDS, reconcileFuelReport, type PilotReportFill, type SystemFill } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { carryForward, readBilledElsewhere, type CarryContext } from "./fuelReconCarry.js";

/**
 * The reads and closes behind the invoice check's carry-forward. What each close DECIDES is tested pure in
 * `packages/shared/src/reconcile/fuelReconCarry.test.ts`; what is only testable here is which findings get
 * named to `close_fuel_exceptions`, with which kinds and note, and that every read is one org's.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const WEEK = { from: "2026-11-16", to: "2026-11-22" };
const PAN = "7083050099040222222";

const line = (o: Partial<PilotReportFill> & { rowNumber: number }): PilotReportFill => ({
  authNo: null, unit: "786", cardRef: "222222", site: "332", city: null, state: "AR", gallons: 150, netAmount: 600,
  retailAmount: 700, tranDate: "2026-11-20", time: null, product: "diesel", productCode: "020", productDescription: "Truck Diesel",
  ...o,
});
const sys = (o: Partial<SystemFill> & { id: string }): SystemFill => ({
  cardRef: PAN, controlId: null, unit: "786", fueledAt: null, tranDate: "2026-11-20", tank: "tractor", gallons: 150, totalCost: 600, ...o,
});
const txn = (o: Record<string, unknown>) => ({
  card_ref: PAN, control_id: null, vehicle_id: "v1", fueled_at: "2026-11-10T18:00:00.000Z", gallons: 150, total_cost: 600,
  state: "AR", tank_type: "tractor", ...o,
});

const ctx = (o: Partial<CarryContext> = {}): CarryContext => ({
  runId: "run-new", actorId: "user-1", invoiceNo: "INV-59656", window: WEEK, supersededRunIds: [],
  result: reconcileFuelReport([line({ rowNumber: 1 })], [sys({ id: "inweek" })], { window: WEEK }),
  tolerances: { gallons: 1, amountAbs: 1, amountPct: 0.01 }, maxDayDrift: 1,
  ...o,
});

const filtersOf = (q: RecordedQuery) => Object.fromEntries(q.filters().map((x) => [x.col, x.val]));

/** `fuel_exceptions` answered by which of the two reads asked: leftovers filter `run_id IN`, late-recorded `kind =`. */
function recorder(opts: {
  leftovers?: Array<{ fingerprint: string }>;
  unrecorded?: Array<{ fingerprint: string; occurred_on: string; evidence: Record<string, unknown> }>;
  fills?: Record<string, unknown>[];
  liveRuns?: Array<{ id: string; invoice_no: string }>;
  savedRows?: Array<{ run_id: string; rows: unknown[] }>;
  rpc?: (fn: string, args: unknown) => unknown;
} = {}) {
  return createSupabaseRecorder({
    tables: {
      fuel_exceptions: (q) => (filtersOf(q).kind === "recon_missing_in_system" ? opts.unrecorded ?? [] : opts.leftovers ?? []),
      fuel_transactions: opts.fills ?? [],
      vehicles: [{ id: "v1", unit_number: "786" }],
      fuel_recon_runs: opts.liveRuns ?? [],
      fuel_recon_run_rows: opts.savedRows ?? [],
    },
    rpc: opts.rpc ?? ((_fn, args) => (args as { p_fingerprints: string[] }).p_fingerprints.length),
  });
}
const closes = (rec: ReturnType<typeof recorder>) =>
  rec.rpcs().filter((c) => c.fn === "close_fuel_exceptions").map((c) => c.args as Record<string, unknown>);

describe("carryForward", () => {
  it("closes what an earlier check of the same invoice filed and this one no longer finds", async () => {
    const rec = recorder({ leftovers: [{ fingerprint: "recon_missing_on_report|f-1123" }] });
    const out = await carryForward(rec.client, ORG, ctx({ supersededRunIds: ["run-old"] }));
    expect(out.recheckDropped).toBe(1);
    const [c] = closes(rec);
    expect(c).toMatchObject({
      p_org: ORG, p_fingerprints: ["recon_missing_on_report|f-1123"], p_kinds: RECON_EXCEPTION_KINDS,
      p_note: "Re-checking invoice INV-59656 no longer found this.", p_actor: "user-1", p_run: "run-new",
    });
    const read = rec.forTable("fuel_exceptions").find((q) => Array.isArray(filtersOf(q).run_id));
    expect(filtersOf(read!)).toMatchObject({ run_id: ["run-old"], status: ["open", "investigating"] });
  });

  it("reads no leftovers when nothing was superseded", async () => {
    const rec = recorder({ leftovers: [{ fingerprint: "x" }] });
    const out = await carryForward(rec.client, ORG, ctx());
    expect(out.recheckDropped).toBe(0);
    expect(rec.forTable("fuel_exceptions").some((q) => Array.isArray(filtersOf(q).run_id))).toBe(false);
  });

  it("closes the unbilled finding of an earlier week's fill that this invoice billed late", async () => {
    const result = reconcileFuelReport(
      [line({ rowNumber: 1, tranDate: "2026-11-14" })], [sys({ id: "late", tranDate: "2026-11-14" })], { window: WEEK },
    );
    const rec = recorder();
    const out = await carryForward(rec.client, ORG, ctx({ result }));
    expect(out.billedLate).toBe(1);
    expect(closes(rec)[0]).toMatchObject({
      p_fingerprints: ["recon_missing_on_report|late"], p_kinds: ["recon_missing_on_report"], p_note: "Billed on invoice INV-59656.",
    });
  });

  const unrecorded = [{
    fingerprint: "recon_missing_in_system|2026-11-10|-|020|222222|150", occurred_on: "2026-11-10",
    evidence: { billedGallons: 150, billedAmount: 600, card: "222222", productCode: "020" },
  }];

  it("closes an earlier unrecorded line once its fill has been recorded", async () => {
    const rec = recorder({ unrecorded, fills: [txn({ id: "f-late" })] });
    const out = await carryForward(rec.client, ORG, ctx());
    expect(out.recordedLate).toBe(1);
    expect(closes(rec).at(-1)).toMatchObject({
      p_fingerprints: [unrecorded[0]!.fingerprint], p_kinds: ["recon_missing_in_system"], p_note: "Our record of this fill arrived later.",
    });
    // Never this run's own findings: those it just filed are genuinely unrecorded.
    const read = rec.forTable("fuel_exceptions").find((q) => filtersOf(q).kind === "recon_missing_in_system")!;
    expect(read.ops.some((o) => o.method === "neq" && o.args[0] === "run_id" && o.args[1] === "run-new")).toBe(true);
  });

  it("does not close it with a fill another invoice already matched", async () => {
    const rec = recorder({
      unrecorded,
      fills: [txn({ id: "f-billed" })],
      liveRuns: [{ id: "run-wk1", invoice_no: "INV-59600" }],
      savedRows: [{ run_id: "run-wk1", rows: [{ report: line({ rowNumber: 1 }), system: sys({ id: "f-billed" }) }] }],
    });
    const out = await carryForward(rec.client, ORG, ctx());
    expect(out.recordedLate).toBe(0);
    expect(closes(rec)).toHaveLength(0);
  });

  it("reports a failed close and still runs the other steps", async () => {
    const result = reconcileFuelReport(
      [line({ rowNumber: 1, tranDate: "2026-11-14" })], [sys({ id: "late", tranDate: "2026-11-14" })], { window: WEEK },
    );
    const rec = recorder({
      leftovers: [{ fingerprint: "x" }],
      rpc: (_fn, args) => ((args as { p_note: string }).p_note.startsWith("Re-checking") ? { error: { message: "boom" } } : 1),
    });
    const out = await carryForward(rec.client, ORG, ctx({ result, supersededRunIds: ["run-old"] }));
    expect(out.error).toContain("re-check leftovers: boom");
    expect(out.billedLate).toBe(1);
  });

  it("scopes every read it makes to one organization", async () => {
    const rec = recorder({ leftovers: [{ fingerprint: "x" }], unrecorded, fills: [txn({ id: "f" })], liveRuns: [{ id: "r", invoice_no: "I" }] });
    await carryForward(rec.client, ORG, ctx({ supersededRunIds: ["run-old"] }));
    expectOrgScoped(rec, ORG);
  });
});

describe("readBilledElsewhere", () => {
  it("takes the fills other live weekly invoices matched, and leaves out the invoice being checked", async () => {
    const rec = recorder({
      liveRuns: [{ id: "run-wk1", invoice_no: "INV-1" }, { id: "run-same", invoice_no: "INV-2" }],
      savedRows: [{ run_id: "run-wk1", rows: [{ report: line({ rowNumber: 1 }), system: sys({ id: "a" }) }, { report: null, system: sys({ id: "b" }) }] }],
    });
    const ids = await readBilledElsewhere(rec.client, ORG, WEEK, "INV-2");
    expect([...ids]).toEqual(["a"]);
    const rows = rec.forTable("fuel_recon_run_rows")[0]!;
    expect(filtersOf(rows).run_id).toEqual(["run-wk1"]);
    expect(filtersOf(rec.forTable("fuel_recon_runs")[0]!)).toMatchObject({ source_kind: "weekly_statement" });
    expectOrgScoped(rec, ORG);
  });
});
