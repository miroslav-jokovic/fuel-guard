import { describe, expect, it } from "vitest";
import { TAG_KIND_LABELS, formatTag, parseTag } from "./tagContract.js";
import { isResolvedScan, scanResultSchema } from "./inventoryScanContract.js";
import { UNIT_LABEL_PLACEMENT, labelTargetSchema } from "./inventoryLabelContract.js";

/**
 * A truck's and a trailer's own label, in the shared vocabulary (DE4; DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md
 * D-DE5). The grammar is `tagContract.ts`'s and unchanged; what is new is two kinds, the answer a scan of
 * one gives, the label target that names a unit by its TABLE, and the sentence printed on it.
 */
describe("truck and trailer tags", () => {
  it("formats and reads back VEH and TRL like any other kind", () => {
    expect(formatTag("VEH", "7K3M9P")).toBe("SIL1:VEH:7K3M9P");
    expect(parseTag("SIL1:TRL:x4q2vw")).toEqual({ version: "SIL1", kind: "TRL", id: "X4Q2VW" });
    expect(TAG_KIND_LABELS.VEH).toBe("Truck");
    expect(TAG_KIND_LABELS.TRL).toBe("Trailer");
  });

  it("answers a scan with the unit, and counts it as found", () => {
    const r = scanResultSchema.parse({ kind: "unit", code: "SIL1:VEH:7K3M9P", unit: { kind: "vehicle", id: "v-1", unitNumber: "654" } });
    expect(isResolvedScan(r)).toBe(true);
    expect(() => scanResultSchema.parse({ kind: "unit", code: "x", unit: { kind: "tractor", id: "v-1", unitNumber: "654" } })).toThrow();
  });

  it("names a unit to label by its table, since a truck and a trailer may share a number", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(labelTargetSchema.parse({ kind: "unit", unitKind: "trailer", unitId: id })).toEqual({ kind: "unit", unitKind: "trailer", unitId: id });
    expect(() => labelTargetSchema.parse({ kind: "unit", unitKind: "reefer_trailer", unitId: id })).toThrow();
  });

  it("prints where the label goes — inside, out of the sun (owner 2026-10-30)", () => {
    expect(UNIT_LABEL_PLACEMENT).toEqual({ vehicle: "Inside cab — driver door jamb", trailer: "Inside front wall" });
  });
});
