import { describe, expect, it } from "vitest";
import {
  CERTIFICATION_KINDS,
  INTAKE_LIMITS,
  isBlankPage,
  PAPER_FILE_CERTIFICATION_KINDS,
  PAPER_FILE_HIRED_ONLY_KINDS,
  PAPER_FILE_RECORD_KINDS,
  PAPER_PART_MAX_PAGES,
  paperFilePlan,
  planParts,
  QUALIFICATION_RECORD_KINDS,
} from "./index.js";

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

describe("paperFilePlan (PI5)", () => {
  const hired = { status: "active" };
  it("files a medical card as a certification, needing a date", () => {
    expect(paperFilePlan({ kind: "medical_card", date: null, expiresOn: "2027-06-30" }, hired)).toEqual({ ok: true, path: "certification" });
    expect(paperFilePlan({ kind: "medical_card", date: null, expiresOn: null }, hired)).toMatchObject({ ok: false });
  });
  it("files an MVR or a road test as a dated record, and refuses one with no date", () => {
    expect(paperFilePlan({ kind: "mvr", date: "2026-01-05", expiresOn: null }, hired)).toEqual({ ok: true, path: "record" });
    expect(paperFilePlan({ kind: "road_test", date: null, expiresOn: null }, hired)).toMatchObject({ ok: false, message: expect.stringContaining("date") });
  });
  it("files a hired driver's paper application and road test, never an applicant's (Q-PI3)", () => {
    expect(paperFilePlan({ kind: "employment_application", date: "2019-03-01", expiresOn: null }, hired)).toEqual({ ok: true, path: "record" });
    for (const kind of PAPER_FILE_HIRED_ONLY_KINDS) {
      expect(paperFilePlan({ kind, date: "2026-11-01", expiresOn: null }, { status: "applicant" })).toMatchObject({ ok: false, message: expect.stringContaining("applicant") });
    }
  });
  it("sends the kinds with their own door to that door, and keeps anything else as an other paper", () => {
    expect(paperFilePlan({ kind: "psp_report", date: "2026-01-01", expiresOn: null }, hired)).toMatchObject({ ok: false, message: expect.stringContaining("Employment tab") });
    expect(paperFilePlan({ kind: "unicorn", date: null, expiresOn: null }, hired)).toMatchObject({ ok: false });
    expect(paperFilePlan({ kind: "other", date: null, expiresOn: null }, hired)).toEqual({ ok: true, path: "document" });
  });
  it("offers only kinds the database admits", () => {
    for (const k of PAPER_FILE_RECORD_KINDS) expect(QUALIFICATION_RECORD_KINDS as readonly string[]).toContain(k);
    for (const k of PAPER_FILE_CERTIFICATION_KINDS) expect(CERTIFICATION_KINDS as readonly string[]).toContain(k);
  });
});
