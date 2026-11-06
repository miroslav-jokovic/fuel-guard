import { describe, expect, it } from "vitest";
import {
  COVER_SHEET_PREFIX,
  coverSheetRequestSchema,
  DQ_EXPORT_MAX_DRIVERS,
  formatCoverSheetPayload,
  parseCoverSheetPayload,
  parseTag,
} from "./index.js";

const ID = "3f2b9c1e-8d4a-4b6f-9e21-5c7a0d1e2f34";

describe("driver cover sheet payload (PI1, D-PI1)", () => {
  it("round-trips a driver id through the printed payload", () => {
    expect(formatCoverSheetPayload(ID)).toBe(`${COVER_SHEET_PREFIX}:${ID}`);
    expect(parseCoverSheetPayload(formatCoverSheetPayload(ID))).toBe(ID);
  });

  it("reads a scan regardless of case and surrounding whitespace", () => {
    expect(parseCoverSheetPayload(`  sildqf1:${ID.toUpperCase()}\n`)).toBe(ID);
  });

  it("is never mistaken for a shop tag, and a shop tag is never mistaken for it", () => {
    expect(parseTag(formatCoverSheetPayload(ID))).toBeNull();
    expect(parseCoverSheetPayload("SIL1:VEH:7K3M9P")).toBeNull();
  });

  it("refuses anything that is not exactly prefix and id", () => {
    for (const bad of ["", ID, `${COVER_SHEET_PREFIX}:`, `${COVER_SHEET_PREFIX}:not-an-id`, `${COVER_SHEET_PREFIX}:${ID}:extra`, `OTHER:${ID}`, "012345678905"]) {
      expect(parseCoverSheetPayload(bad), bad).toBeNull();
    }
  });

  it("refuses to print a sheet for something that is not a driver id", () => {
    expect(() => formatCoverSheetPayload("Marcus Reyes")).toThrow(/not a driver id/);
  });

  it("caps one print at the Drivers selection's own limit", () => {
    const ids = (n: number) => Array.from({ length: n }, () => ID);
    expect(coverSheetRequestSchema.safeParse({ driverIds: ids(DQ_EXPORT_MAX_DRIVERS) }).success).toBe(true);
    expect(coverSheetRequestSchema.safeParse({ driverIds: ids(DQ_EXPORT_MAX_DRIVERS + 1) }).success).toBe(false);
    expect(coverSheetRequestSchema.safeParse({ driverIds: [] }).success).toBe(false);
  });
});
