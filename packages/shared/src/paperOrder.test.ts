import { describe, expect, it } from "vitest";
import { newestPaperFirst, paperDate } from "./paperOrder.js";

const p = (id: string, capturedAt: string | null, createdAt: string) => ({ id, capturedAt, createdAt });

describe("newestPaperFirst (Q-UF10)", () => {
  it("orders by the paper's own date, so an import written later does not outrank a newer paper", () => {
    // Truck 697 on 2026-10-21: the 07/27 annual uploaded on 10/06, and cab cards imported on 10/20.
    const annual = p("annual", "2026-07-27T00:00:00+00:00", "2026-10-06T14:00:00+00:00");
    const cab2026 = p("cab26", "2026-02-23T00:00:00+00:00", "2026-10-20T20:29:56+00:00");
    const cab2021 = p("cab21", "2021-03-26T00:00:00+00:00", "2026-10-20T20:31:00+00:00");
    expect([cab2021, cab2026, annual].sort(newestPaperFirst).map((d) => d.id)).toEqual(["annual", "cab26", "cab21"]);
  });

  it("falls back to when the row was written for a paper that never said when it was scanned", () => {
    expect(paperDate(p("a", null, "2026-10-01T00:00:00Z"))).toBe("2026-10-01T00:00:00Z");
    const undated = p("undated", null, "2026-10-01T00:00:00Z");
    const dated = p("dated", "2026-09-01", "2026-10-15T00:00:00Z");
    expect([dated, undated].sort(newestPaperFirst).map((d) => d.id)).toEqual(["undated", "dated"]);
  });

  it("breaks a same-day tie by the later row, then the id, so every read agrees", () => {
    const a = p("a", "2026-02-23", "2026-10-20T20:00:00Z");
    const b = p("b", "2026-02-23", "2026-10-20T21:00:00Z");
    const c = p("c", "2026-02-23", "2026-10-20T21:00:00Z");
    expect([a, c, b].sort(newestPaperFirst).map((d) => d.id)).toEqual(["b", "c", "a"]);
  });
});
