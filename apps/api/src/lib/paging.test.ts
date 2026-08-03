import { describe, expect, it, vi } from "vitest";
import { eachPage, fetchAllPaged } from "./paging.js";

/** A fake paged source: `total` rows of {id}, served in pages sized by the caller (via .range bounds),
 *  matching PostgREST. Records each [from,to] it was asked for. */
function source(total: number, err?: string) {
  const calls: Array<[number, number]> = [];
  const make = (from: number, to: number) => {
    calls.push([from, to]);
    if (err) return Promise.resolve({ data: null, error: { message: err } });
    const rows = [];
    for (let i = from; i <= to && i < total; i++) rows.push({ id: i });
    return Promise.resolve({ data: rows, error: null });
  };
  return { make, calls };
}

describe("fetchAllPaged", () => {
  it("collects every row across pages and stops on the first short page", async () => {
    const { make, calls } = source(2500);
    const rows = await fetchAllPaged<{ id: number }>(make, 1000);
    expect(rows).toHaveLength(2500);
    expect(rows[0]).toEqual({ id: 0 });
    expect(rows[2499]).toEqual({ id: 2499 });
    // 3 pages: [0,999] full, [1000,1999] full, [2000,2999] short (500) → stop.
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("makes exactly one page-read when the first page is already short", async () => {
    const { make, calls } = source(10);
    expect(await fetchAllPaged(make, 1000)).toHaveLength(10);
    expect(calls).toHaveLength(1);
  });

  it("runs one more read when the total is an exact multiple of the page size", async () => {
    const { make, calls } = source(2000);
    expect(await fetchAllPaged(make, 1000)).toHaveLength(2000);
    // The 2nd page is full (1000) so it can't know it's done → a 3rd (empty) read confirms the end.
    expect(calls).toHaveLength(3);
  });

  it("throws the PostgREST error message on a page error", async () => {
    const { make } = source(100, "permission denied");
    await expect(fetchAllPaged(make, 50)).rejects.toThrow("permission denied");
  });
});

describe("eachPage", () => {
  it("invokes onPage per batch (incremental — never materializes the whole set)", async () => {
    const { make } = source(2500);
    const onPage = vi.fn();
    await eachPage<{ id: number }>(make, onPage, 1000);
    expect(onPage).toHaveBeenCalledTimes(3);
    expect(onPage.mock.calls[0]![0]).toHaveLength(1000);
    expect(onPage.mock.calls[2]![0]).toHaveLength(500);
  });
});
