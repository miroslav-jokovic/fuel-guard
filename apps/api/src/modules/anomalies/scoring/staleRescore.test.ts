import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { collectTxnIds } from "./loaders.js";

/**
 * The stale-stamp claim (0318) — the queue that replaced two bad options.
 *
 * Before it, applying a derivation change meant either the nightly's 180-day sweep (measured on
 * production 2026-09-05: 10,443 fills, 8,982s — two and a half hours a night to change almost nothing)
 * or a manual full-history rebuild (three hours, cancelled at 14,400 of 15,972). These pin the claim
 * that makes the cheap option exist.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const opsOf = (q: RecordedQuery, method: string) => q.ops.filter((o) => o.method === method);

describe("collectTxnIds — the stale scoring_version claim", () => {
  it("claims NULL stamps as well as low ones, or the first sweep skips the whole backlog", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_transactions: [] } });
    await collectTxnIds(rec.client, ORG, { staleScoringVersion: 3, limit: 10 });
    const filter = opsOf(rec.queries[0]!, "or")[0]!.args[0] as string;
    // `lt` alone never matches NULL, and NULL is every fill scored before the column existed — i.e.
    // precisely the rows with the most catching up to do.
    expect(filter).toContain("scoring_version.is.null");
    expect(filter).toContain("scoring_version.lt.3");
  });

  it("takes the oldest stamps first, so a bounded nightly batch drains in a stable order", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_transactions: [] } });
    await collectTxnIds(rec.client, ORG, { staleScoringVersion: 2, limit: 10 });
    const order = opsOf(rec.queries[0]!, "order");
    expect(order[0]!.args[0]).toBe("scoring_version");
    expect(order[0]!.args[1]).toMatchObject({ ascending: true, nullsFirst: true });
  });

  it("never claims more than the limit — a stale pass without a cap IS the full-history sweep", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ id: `f${i}` }));
    const rec = createSupabaseRecorder({ tables: { fuel_transactions: page } });
    const ids = await collectTxnIds(rec.client, ORG, { staleScoringVersion: 2, limit: 250 });
    expect(ids).toHaveLength(250);
    const range = opsOf(rec.queries[0]!, "range")[0]!.args;
    expect(range).toEqual([0, 249]);
  });

  it("leaves the ordinary claim untouched — no stamp filter, no stamp ordering", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_transactions: [] } });
    await collectTxnIds(rec.client, ORG, { sinceDays: 30 });
    expect(opsOf(rec.queries[0]!, "or")).toHaveLength(0);
    expect(opsOf(rec.queries[0]!, "order")[0]!.args[0]).toBe("vehicle_id");
  });

  it("scopes every claim to the org — the service role bypasses RLS", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_transactions: [] } });
    await collectTxnIds(rec.client, ORG, { staleScoringVersion: 1, limit: 5 });
    expect(rec.queries[0]!.filters()).toContainEqual({ col: "org_id", val: ORG });
  });
});
