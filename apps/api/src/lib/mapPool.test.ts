import { describe, expect, it } from "vitest";
import { mapPool } from "./mapPool.js";

/** The roadside reads lean on both halves (D-RLY10): never more than the bound in flight, and rows in order. */
describe("mapPool", () => {
  it("keeps the items' order however the work finishes, and never runs more than the bound at once", async () => {
    let inFlight = 0;
    let most = 0;
    const out = await mapPool([30, 5, 20, 1, 10, 2, 15], 3, async (ms, i) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      return `${i}:${ms}`;
    });
    expect(out).toEqual(["0:30", "1:5", "2:20", "3:1", "4:10", "5:2", "6:15"]);
    expect(most).toBe(3);
  });

  it("answers nothing for nothing, and rejects when a worker throws", async () => {
    expect(await mapPool([], 3, async () => 1)).toEqual([]);
    await expect(mapPool([1, 2], 2, async (n) => {
      if (n === 2) throw new Error("chunk failed");
      return n;
    })).rejects.toThrow("chunk failed");
  });
});
