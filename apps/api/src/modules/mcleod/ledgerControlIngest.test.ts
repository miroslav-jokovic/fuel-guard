import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { ingestLedgerTotals } from "./ledgerControlIngest.js";
import { tmsLedgerTotalsPayloadSchema } from "@silvicom/shared";

const ORG = "11111111-1111-1111-1111-111111111111";

const total = (over: Record<string, unknown> = {}) => ({
  post_module: "SET",
  glid: "20500010",
  lines: 2751,
  net_amount: 0,
  abs_amount: 2525787.48,
  ...over,
});

describe("ingestLedgerTotals", () => {
  it("upserts the month's totals under one batch stamp, then deletes the month's stale rows — org-scoped throughout", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_gl_totals: [{ id: "x" }] } });
    const payload = tmsLedgerTotalsPayloadSchema.parse({
      period_start: "2026-06-01",
      period_end: "2026-07-01",
      totals: [total(), total({ post_module: "FUEL", glid: "20550000", lines: 57486, abs_amount: 2383148.18 })],
    });
    const r = await ingestLedgerTotals(rec.client, ORG, payload);
    expect(r.received).toBe(2);
    const rows = rec.writtenRows("mcleod_gl_totals");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      org_id: ORG,
      period_start: "2026-06-01",
      post_module: "SET",
      glid: "20500010",
      line_count: 2751,
      net_amount: 0,
      abs_amount: 2525787.48,
    });
    // Every row of one ingest carries the SAME stamp — the stale delete keys on it, so a
    // half-stamped batch would delete its own second chunk.
    expect(rows[0]!.swept_at).toBe(rows[1]!.swept_at);
    // The replace-set delete ran, scoped to org AND period AND older-than-stamp: a reclassified
    // entry's abandoned (module, glid) row must go, but never another month's and never another
    // org's (pinned by this test's expectOrgScoped over the delete query too).
    const del = rec.queries.find((q) => q.table === "mcleod_gl_totals" && q.ops.some((o) => o.method === "delete"));
    expect(del).toBeDefined();
    const filters = Object.fromEntries(del!.ops.filter((o) => o.method === "eq").map((o) => o.args as [string, unknown]));
    expect(filters).toMatchObject({ org_id: ORG, period_start: "2026-06-01" });
    expect(del!.ops.some((o) => o.method === "lt" && (o.args as unknown[])[0] === "swept_at")).toBe(true);
    expectOrgScoped(rec, ORG);
  });
});
