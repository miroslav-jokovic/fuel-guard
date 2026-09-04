import { describe, it, expect } from "vitest";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { ingestLedgerTotals } from "./ledgerControlIngest.js";
import { tmsLedgerTotalsPayloadSchema } from "@silvicom/shared";

const ORG = "11111111-1111-1111-1111-111111111111";

const total = (over: Record<string, unknown> = {}) => ({
  txn_date: "2026-06-15",
  post_module: "SET",
  glid: "20500010",
  lines: 2751,
  net_amount: 0,
  abs_amount: 2525787.48,
  ...over,
});

describe("ingestLedgerTotals", () => {
  it("replaces the month in ONE statement — the RPC carries the org, the company, the month and every row", async () => {
    const rec = createSupabaseRecorder({
      tables: { mcleod_gl_totals: [] },
      rpc: { replace_mcleod_gl_days: [{ day_upserted: 2, day_stale_removed: 1, month_upserted: 2, month_stale_removed: 0 }] },
    });
    const payload = tmsLedgerTotalsPayloadSchema.parse({
      period_start: "2026-06-01",
      period_end: "2026-07-01",
      company_id: "TMS",
      totals: [total(), total({ txn_date: "2026-06-03", post_module: "FUEL", glid: "20550000", lines: 57486, abs_amount: 2383148.18 })],
    });
    const r = await ingestLedgerTotals(rec.client, ORG, payload);
    expect(r).toEqual({ received: 2, upserted: 2, staleRemoved: 1, monthRows: 2 });
    // Nothing touches the table directly any more: no upsert, no delete — the function owns both.
    expect(rec.queries.filter((q) => q.table === "mcleod_gl_totals" && q.write)).toHaveLength(0);
    const call = rec.rpcs().find((c) => c.fn === "replace_mcleod_gl_days")!;
    expect(call).toBeDefined();
    const args = call.args as Record<string, unknown>;
    expect(args).toMatchObject({ p_org: ORG, p_company_id: "TMS", p_period_start: "2026-06-01", p_period_end: "2026-07-01" });
    // The DATE is on every row — the grain the source asserts, which is the whole point of W1.
    expect(args.p_rows).toEqual([
      { txn_date: "2026-06-15", post_module: "SET", glid: "20500010", lines: 2751, net_amount: 0, abs_amount: 2525787.48 },
      { txn_date: "2026-06-03", post_module: "FUEL", glid: "20550000", lines: 57486, net_amount: 0, abs_amount: 2383148.18 },
    ]);
  });

  it("a payload without a company passes null — the function scopes its stale delete to rows with no company", async () => {
    const rec = createSupabaseRecorder({ rpc: { replace_mcleod_gl_days: [{ day_upserted: 1, day_stale_removed: 0, month_upserted: 1, month_stale_removed: 0 }] } });
    await ingestLedgerTotals(rec.client, ORG, tmsLedgerTotalsPayloadSchema.parse({ period_start: "2026-06-01", period_end: "2026-07-01", totals: [total()] }));
    expect((rec.rpcs()[0]!.args as Record<string, unknown>).p_company_id).toBeNull();
  });

  it("an RPC error fails the ingest by name", async () => {
    const rec = createSupabaseRecorder({ rpc: () => ({ data: null, error: { message: "boom" } }) });
    await expect(
      ingestLedgerTotals(rec.client, ORG, tmsLedgerTotalsPayloadSchema.parse({ period_start: "2026-06-01", period_end: "2026-07-01", totals: [total()] })),
    ).rejects.toThrow(/replace_mcleod_gl_days failed: boom/);
  });
});

describe("ingestLedgerTotals — zero rows never delete (D-FIN6)", () => {
  // Before 2026-09-03 an empty payload upserted nothing and then deleted every row of the month
  // bearing an older stamp — which is every row. A transient empty read erased a month's control
  // totals and the CPM page's fleet truth with them.
  it("an empty payload leaves the month untouched and says why, instead of erasing it", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_gl_totals: [{ id: "x" }] } });
    const payload = tmsLedgerTotalsPayloadSchema.parse({ period_start: "2026-06-01", period_end: "2026-07-01", totals: [] });
    const r = await ingestLedgerTotals(rec.client, ORG, payload);
    expect(r).toEqual({ received: 0, upserted: 0, staleRemoved: 0, skipped: "empty" });
    expect(rec.writtenRows("mcleod_gl_totals")).toHaveLength(0);
    const del = rec.queries.find((q) => q.table === "mcleod_gl_totals" && q.ops.some((o) => o.method === "delete"));
    expect(del).toBeUndefined();
  });
});
