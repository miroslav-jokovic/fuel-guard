import { describe, expect, it } from "vitest";
import { INTAKE_LIMITS, isBlankPage, PAPER_PART_MAX_PAGES, planParts } from "./index.js";

const A = "3f2b9c1e-8d4a-4b6f-9e21-5c7a0d1e2f34";
const B = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const none = new Set<number>();

describe("planParts (PI2)", () => {
  it("gives each driver the pages after their sheet, and the sheet to nobody", () => {
    expect(planParts(6, [{ page: 1, driverId: A }, { page: 4, driverId: B }], none)).toEqual([
      { driverId: A, basis: "cover_sheet", pages: [2, 3] },
      { driverId: B, basis: "cover_sheet", pages: [5, 6] },
    ]);
  });

  it("keeps pages before the first sheet, unowned, rather than giving them to the next driver", () => {
    expect(planParts(4, [{ page: 3, driverId: A }], none)).toEqual([
      { driverId: null, basis: "none", pages: [1, 2] },
      { driverId: A, basis: "cover_sheet", pages: [4] },
    ]);
  });

  it("treats a stack with no sheets as one unowned run", () => {
    expect(planParts(3, [], none)).toEqual([{ driverId: null, basis: "none", pages: [1, 2, 3] }]);
  });

  it("leaves blank pages out wherever they fall", () => {
    expect(planParts(7, [{ page: 1, driverId: A }], new Set([2, 4, 7]))).toEqual([
      { driverId: A, basis: "cover_sheet", pages: [3, 5, 6] },
    ]);
  });

  it("cuts a long folder into pieces the reader takes in one read", () => {
    expect(PAPER_PART_MAX_PAGES).toBe(INTAKE_LIMITS.maxPages);
    const parts = planParts(24, [{ page: 1, driverId: A }], none);
    expect(parts.map((p) => p.pages.length)).toEqual([10, 10, 3]);
    expect(parts.flatMap((p) => p.pages)).toEqual(Array.from({ length: 23 }, (_, i) => i + 2));
    expect(parts.every((p) => p.driverId === A)).toBe(true);
  });

  it("yields no piece for a sheet with nothing after it, and keeps two runs for a folder scanned twice", () => {
    expect(planParts(5, [{ page: 1, driverId: A }, { page: 2, driverId: B }, { page: 4, driverId: A }], none)).toEqual([
      { driverId: B, basis: "cover_sheet", pages: [3] },
      { driverId: A, basis: "cover_sheet", pages: [5] },
    ]);
  });
});

describe("isBlankPage", () => {
  const page = (dark: number, total = 2_103_750) => { // a letter page at 150 dpi
    const g = new Uint8Array(total).fill(250);
    for (let i = 0; i < dark; i++) g[i * Math.floor(total / Math.max(dark, 1))] = 20;
    return g;
  };
  it("calls a page with a few specks of scanner noise blank (14 dark pixels, measured)", () => {
    expect(isBlankPage(page(14))).toBe(true);
  });
  it("keeps a page whose only ink is one short word (296 dark pixels, measured)", () => {
    expect(isBlankPage(page(296))).toBe(false);
  });
  it("never calls an empty image blank", () => {
    expect(isBlankPage(new Uint8Array(0))).toBe(false);
  });
});
