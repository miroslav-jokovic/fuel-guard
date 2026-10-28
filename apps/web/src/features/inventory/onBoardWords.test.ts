import { describe, expect, it } from "vitest";
import type { UnitKitLineDto } from "@silvicom/shared";
import { missingWords, onBoardSentence } from "./onBoardWords";

const line = (over: Partial<UnitKitLineDto>): UnitKitLineDto => ({
  assetTypeId: "t",
  assetTypeName: "Load bar",
  heldBy: "unit",
  expected: 2,
  held: 2,
  delta: 0,
  source: "fleet",
  ...over,
});

describe("what a truck carries, in one sentence", () => {
  it("names a tablet's driver from the type's heldBy, counts the rest, and skips what is not aboard", () => {
    const lines = [
      line({ assetTypeName: "Tablet", heldBy: "driver", expected: 1, held: 1 }),
      line({ assetTypeName: "Load bar", held: 2 }),
      line({ assetTypeName: "Fire extinguisher", expected: 1, held: 1 }),
      line({ assetTypeName: "Reefer cable", expected: 1, held: 0, delta: -1 }),
    ];
    expect(onBoardSentence({ lines, inferredDriverName: "Dana Reyes" })).toBe("Tablet (Dana Reyes), 2 × Load bar, Fire extinguisher");
  });

  it("does not hang a driver on a unit-held thing, whatever it is called", () => {
    const lines = [line({ assetTypeName: "Tablet holder", heldBy: "unit", held: 1 })];
    expect(onBoardSentence({ lines, inferredDriverName: "Dana Reyes" })).toBe("Tablet holder");
  });

  it("leaves the name off a tablet nobody is assigned to, and says nothing for an empty unit", () => {
    expect(onBoardSentence({ lines: [line({ assetTypeName: "Tablet", heldBy: "driver", held: 1 })], inferredDriverName: null })).toBe("Tablet");
    expect(onBoardSentence({ lines: [line({ held: 0, delta: -2 })], inferredDriverName: null })).toBeNull();
  });
});

describe("how much is missing", () => {
  it("counts a checked unit's shortfall, and calls an unchecked one nothing (R10)", () => {
    expect(missingWords({ shortBy: 2, lastCheckedAt: "2026-10-20T12:00:00.000Z" })).toBe("2 missing");
    expect(missingWords({ shortBy: 2, lastCheckedAt: null })).toBeNull();
    expect(missingWords({ shortBy: 0, lastCheckedAt: "2026-10-20T12:00:00.000Z" })).toBeNull();
  });
});
