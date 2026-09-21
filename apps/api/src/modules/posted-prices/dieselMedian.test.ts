import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { readRecentDieselMedian, DIESEL_MEDIAN_TTL_MS, __resetDieselMedianCache } from "./dieselMedian.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "11111111-2222-4333-8444-555555555555";

/** A page of `fuel_prices` rows at one price, so a median is easy to reason about. */
const rows = (n: number, price: number) => Array.from({ length: n }, () => ({ net_price: price, posted_price: null }));

beforeEach(() => {
  __resetDieselMedianCache();
});

describe("readRecentDieselMedian", () => {
  it("scopes every read to one org — the service role bypasses RLS, so the filter IS the boundary", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_prices: rows(3, 5.8) } });
    await readRecentDieselMedian(rec.client, ORG);
    expectOrgScoped(rec, ORG);
  });

  it("asks for diesel only, over the lookback window, and prefers net price over posted", async () => {
    const rec = createSupabaseRecorder({
      tables: { fuel_prices: [{ net_price: 5.5, posted_price: 9.9 }, { net_price: null, posted_price: 6.5 }] },
    });
    const nowMs = Date.parse("2026-09-21T12:00:00Z");
    const median = await readRecentDieselMedian(rec.client, ORG, { nowMs, lookbackDays: 14 });

    expect(median).toBe(6); // (5.5 + 6.5) / 2 — the posted row only counts where net is missing
    const filters = rec.forTable("fuel_prices")[0]!.filters();
    expect(filters).toContainEqual({ col: "product", val: "diesel" });
    expect(filters).toContainEqual({ col: "observed_at", val: "2026-09-07T12:00:00.000Z" });
  });

  /**
   * The defect this move fixes. The browser asked for `.limit(5000)` and PostgREST answered with
   * 1,000, so the Idling page's median has always been of the most recent 1,000 rows rather than of
   * the window (measured against production 2026-09-21: $5.978 capped, $5.873 over the window).
   * Here the first page is FULL and the second is short, which is the only signal `eachPage` has.
   */
  it("pages past PostgREST's 1,000-row cap instead of taking a median of the first page", async () => {
    const rec = createSupabaseRecorder({
      tables: { fuel_prices: { pages: [rows(1000, 4), rows(1000, 6), rows(2, 6)] } },
    });
    const median = await readRecentDieselMedian(rec.client, ORG);

    // 1,000 rows at $4 and 1,002 at $6: the whole window's median is $6 and the first page's alone
    // is $4, so a read that stopped at the cap could not produce this number.
    expect(median).toBe(6);
    expect(rec.forTable("fuel_prices")).toHaveLength(3);
    expect(rec.forTable("fuel_prices")[1]!.ops.some((o) => o.method === "range" && o.args[0] === 1000)).toBe(true);
  });

  it("answers null when the window collected no prices, rather than inventing one", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_prices: [] } });
    expect(await readRecentDieselMedian(rec.client, ORG)).toBeNull();
  });

  it("throws the upstream message rather than reporting a price the board did not give", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_prices: { error: { message: "boom" } } } });
    await expect(readRecentDieselMedian(rec.client, ORG)).rejects.toThrow("boom");
  });

  describe("the cache", () => {
    it("serves a second caller inside the TTL without a second read", async () => {
      const rec = createSupabaseRecorder({ tables: { fuel_prices: rows(3, 5.8) } });
      const nowMs = Date.parse("2026-09-21T12:00:00Z");

      expect(await readRecentDieselMedian(rec.client, ORG, { nowMs })).toBe(5.8);
      expect(await readRecentDieselMedian(rec.client, ORG, { nowMs: nowMs + DIESEL_MEDIAN_TTL_MS - 1 })).toBe(5.8);
      expect(rec.forTable("fuel_prices")).toHaveLength(1);
    });

    it("reads again once the entry expires", async () => {
      const rec = createSupabaseRecorder({ tables: { fuel_prices: rows(3, 5.8) } });
      const nowMs = Date.parse("2026-09-21T12:00:00Z");

      await readRecentDieselMedian(rec.client, ORG, { nowMs });
      await readRecentDieselMedian(rec.client, ORG, { nowMs: nowMs + DIESEL_MEDIAN_TTL_MS });
      expect(rec.forTable("fuel_prices")).toHaveLength(2);
    });

    /**
     * The tenancy half. An entry keyed by nothing — or by "the last median" — would price one
     * carrier's idled diesel off another carrier's board, and no RLS policy would stop it because
     * the API reads with the service role.
     */
    it("never serves one org's median to another", async () => {
      const rec = createSupabaseRecorder({
        tables: {
          fuel_prices: (q) => (q.filters().some((f) => f.col === "org_id" && f.val === ORG) ? rows(3, 5.8) : rows(3, 3.1)),
        },
      });
      const nowMs = Date.parse("2026-09-21T12:00:00Z");

      expect(await readRecentDieselMedian(rec.client, ORG, { nowMs })).toBe(5.8);
      expect(await readRecentDieselMedian(rec.client, OTHER_ORG, { nowMs })).toBe(3.1);
    });

    it("does not cache a failure, so one blip is not replayed for five minutes", async () => {
      let fail = true;
      const rec = createSupabaseRecorder({
        tables: { fuel_prices: () => (fail ? { error: { message: "boom" } } : rows(1, 6.2)) },
      });
      const nowMs = Date.parse("2026-09-21T12:00:00Z");

      await expect(readRecentDieselMedian(rec.client, ORG, { nowMs })).rejects.toThrow("boom");
      fail = false;
      expect(await readRecentDieselMedian(rec.client, ORG, { nowMs })).toBe(6.2);
    });
  });
});
