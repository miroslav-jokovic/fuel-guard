import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { ingestLedgerKeyLines, readLedgerKeyLines } from "./ledgerKeyLines.js";

/** The ledger per posting key (0509, TRUCK-DRIVER-PNL-PLAN P0c): the month replace and the paged read. */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const LINE = { txn_date: "2026-07-14", post_module: "BILL", post_key: "1001", glid: "12000000", lines: 1, net_amount: 4864.64 };

describe("ingestLedgerKeyLines", () => {
  it("replaces the month through one function call, for this org and company", async () => {
    const rec = createSupabaseRecorder({ rpc: { replace_mcleod_gl_key_lines: [{ upserted: 1, stale_removed: 3 }] } });
    const r = await ingestLedgerKeyLines(rec.client as unknown as SupabaseClient, ORG, {
      period_start: "2026-07-01", period_end: "2026-08-01", company_id: "TMS", lines: [LINE],
    });
    expect(r).toEqual({ received: 1, upserted: 1, staleRemoved: 3 });
    const call = rec.rpcs().find((c) => c.fn === "replace_mcleod_gl_key_lines")!;
    expect(call.args).toMatchObject({ p_org: ORG, p_company_id: "TMS", p_period_start: "2026-07-01", p_period_end: "2026-08-01" });
    expect((call.args as { p_rows: unknown[] }).p_rows).toEqual([LINE]);
  });

  it("calls nothing for an empty month and says why (D-FIN6)", async () => {
    const rec = createSupabaseRecorder({ rpc: { replace_mcleod_gl_key_lines: [{ upserted: 0, stale_removed: 99 }] } });
    const r = await ingestLedgerKeyLines(rec.client as unknown as SupabaseClient, ORG, { period_start: "2026-07-01", period_end: "2026-08-01", lines: [] });
    expect(r.skipped).toBe("empty");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("surfaces a failed replace instead of reporting a sweep that did not land", async () => {
    const rec = createSupabaseRecorder({ rpc: { replace_mcleod_gl_key_lines: { error: { message: "boom" } } } });
    await expect(
      ingestLedgerKeyLines(rec.client as unknown as SupabaseClient, ORG, { period_start: "2026-07-01", period_end: "2026-08-01", lines: [LINE] }),
    ).rejects.toThrow(/replace_mcleod_gl_key_lines failed: boom/);
  });
});

describe("readLedgerKeyLines", () => {
  const pagedFixture = (rows: unknown[]) => (q: RecordedQuery) => {
    const range = q.ops.find((o) => o.method === "range");
    const [from, to] = range ? (range.args as [number, number]) : [0, rows.length - 1];
    return rows.slice(from, to + 1);
  };
  const stored = (i: number) => ({ txn_date: "2026-07-14", post_module: "SET", post_key: String(i), glid: "20500010", line_count: 1, net_amount: "-900.00" });

  it("reads every page of a month, past PostgREST's 1,000-row cap, org-scoped and windowed", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_gl_key_lines: pagedFixture(Array.from({ length: 2500 }, (_, i) => stored(i))) } });
    const out = await readLedgerKeyLines(rec.client as unknown as SupabaseClient, ORG, "2026-07-01", "2026-08-01");
    expect(out).toHaveLength(2500);
    expect(out[0]).toEqual({ txn_date: "2026-07-14", post_module: "SET", post_key: "0", glid: "20500010", lines: 1, net_amount: -900 });
    expect(rec.queries.filter((q) => q.table === "mcleod_gl_key_lines")).toHaveLength(3);
    const ops = rec.queries[0]!.ops;
    expect(ops.find((o) => o.method === "gte")?.args).toEqual(["txn_date", "2026-07-01"]);
    expect(ops.find((o) => o.method === "lt")?.args).toEqual(["txn_date", "2026-08-01"]);
    expectOrgScoped(rec, ORG);
  });

  it("orders the pages on the whole identity, so they are a total order", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_gl_key_lines: pagedFixture([stored(1)]) } });
    await readLedgerKeyLines(rec.client as unknown as SupabaseClient, ORG, "2026-07-01", "2026-08-01");
    expect(rec.queries[0]!.ops.filter((o) => o.method === "order").map((o) => o.args[0])).toEqual([
      "company_id", "post_module", "post_key", "glid", "txn_date",
    ]);
  });
});
