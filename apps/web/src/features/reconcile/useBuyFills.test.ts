import { describe, it, expect } from "vitest";
import { BUY_FILLS_PAGE, readAllBuyFillRows } from "./useBuyFills";

/**
 * `fuel_buy_fills` has 6,484 rows for the default 90-day window on production and PostgREST answers at most
 * 1,000 per request, so the read must page (design verdict 2026-10-03, F5). These pin the loop on its own;
 * the page-level tests mock the hook whole and could not see it.
 */
const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ vehicle_id: "v", fueled_at: `t${from + i}` }));
/** A fake of the RPC that honours `.range()` over a fixed total, and records every request. */
const server = (total: number) => {
  const calls: [number, number][] = [];
  const all = rows(total);
  return {
    calls,
    page: async (start: number, end: number) => {
      calls.push([start, end]);
      return { data: all.slice(start, Math.min(end, BUY_FILLS_PAGE * 99) + 1), error: null };
    },
  };
};

describe("readAllBuyFillRows", () => {
  it("reads past the 1,000-row cap until a short page, and returns every row once and in order", async () => {
    const s = server(6484);
    const got = await readAllBuyFillRows(s.page);
    expect(got).toHaveLength(6484);
    expect(got[0]).toMatchObject({ fueled_at: "t0" });
    expect(got.at(-1)).toMatchObject({ fueled_at: "t6483" });
    expect(new Set(got.map((r) => r.fueled_at)).size).toBe(6484);
    expect(s.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999], [3000, 3999], [4000, 4999], [5000, 5999], [6000, 6999]]);
  });

  it("asks once when the result is under a page, and again when it is exactly one page", async () => {
    const small = server(40);
    expect(await readAllBuyFillRows(small.page)).toHaveLength(40);
    expect(small.calls).toHaveLength(1);
    // Exactly 1,000 rows could be the whole answer or the cap: only an empty second page says which.
    const exact = server(1000);
    expect(await readAllBuyFillRows(exact.page)).toHaveLength(1000);
    expect(exact.calls).toHaveLength(2);
  });

  it("throws when a page fails, instead of returning the rows before it", async () => {
    let n = 0;
    await expect(
      readAllBuyFillRows(async () => (++n === 3 ? { data: null, error: { message: "canceling statement due to statement timeout" } } : { data: rows(1000), error: null })),
    ).rejects.toThrow("statement timeout");
  });
});
