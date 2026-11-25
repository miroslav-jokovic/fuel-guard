import { describe, it, expect, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/**
 * "Check again" reads the PDF we KEPT and re-runs the check on it. The check itself is
 * `runFuelReconciliation` (its own tests); here: it reads one org's statement, refuses a superseded copy or
 * one with no stored PDF, and hands the stored bytes' words to the check with the statement's id.
 */
vi.mock("../../lib/pdfWords.js", () => ({
  readPdfWords: vi.fn(async () => ({ ok: true, words: [{ text: "x", x: 0, y: 0, page: 1 }] })),
}));
const run = vi.fn(async (..._args: unknown[]) => ({ ok: true, runId: "run-new" }));
vi.mock("./fuelReconRun.js", () => ({ runFuelReconciliation: (...a: unknown[]) => run(...a) }));

const { recheckFuelStatement } = await import("./fuelStatementRecheck.js");

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ST = "11111111-2222-4333-8444-555555555555";

const rec = (row: Record<string, unknown> | null) =>
  createSupabaseRecorder({
    tables: { fuel_statements: row ? [row] : [] },
    storage: { download: async () => ({ data: new Blob([new Uint8Array([37, 80, 68, 70])]), error: null }) },
  });

describe("recheckFuelStatement", () => {
  it("re-checks the stored PDF of one org's statement, pointing the run at that statement", async () => {
    const r0 = rec({ id: ST, source_path: `${ORG}/inv.pdf`, source_filename: "INV-59656.pdf", superseded_by: null });
    const out = await recheckFuelStatement(r0.client, ORG, "user-1", ST);
    expect(out.ok).toBe(true);
    expect(r0.storageCalls()).toEqual([{ bucket: "fuel-statements", fn: "download", args: [`${ORG}/inv.pdf`] }]);
    expect(run).toHaveBeenCalledWith(r0.client, ORG, "user-1", expect.objectContaining({ statementId: ST, filename: "INV-59656.pdf" }));
    expectOrgScoped(r0, ORG);
  });

  it("is not found for a statement this org does not hold", async () => {
    const out = await recheckFuelStatement(rec(null).client, ORG, "user-1", ST);
    expect(out).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses a superseded copy, so an old copy cannot replace the newer check", async () => {
    const out = await recheckFuelStatement(rec({ id: ST, source_path: "p", source_filename: null, superseded_by: "newer" }).client, ORG, null, ST);
    expect(out).toMatchObject({ ok: false, status: 409, code: "superseded" });
  });

  it("refuses a statement that kept no PDF", async () => {
    const out = await recheckFuelStatement(rec({ id: ST, source_path: null, source_filename: null, superseded_by: null }).client, ORG, null, ST);
    expect(out).toMatchObject({ ok: false, status: 409, code: "no_source" });
  });
});
