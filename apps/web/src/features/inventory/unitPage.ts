import type { UnitScanResult } from "@silvicom/shared";

/**
 * Where a scanned truck or trailer label goes (DE4; DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md D-DE5).
 *
 * The unit's own page, with its Assign list already open for somebody who may assign (`?assign=1`,
 * read by `HolderEquipmentCard`) — the owner's "scan the truck's label → its Assign list opens → scan
 * the items → Confirm" (2026-10-30). A viewer gets the page without the list, which they could not use.
 * One spelling for the Scan page and its card, so the two never disagree about the door.
 */
type ScannedUnit = UnitScanResult["unit"];

export function unitName(unit: Pick<ScannedUnit, "kind" | "unitNumber">): string {
  return `${unit.kind === "trailer" ? "Trailer" : "Truck"} ${unit.unitNumber}`;
}

export function unitPage(unit: ScannedUnit, assign: boolean) {
  return {
    name: unit.kind === "trailer" ? "trailer-detail" : "vehicle-detail",
    params: { id: unit.id },
    query: assign ? { assign: "1" } : {},
  };
}
