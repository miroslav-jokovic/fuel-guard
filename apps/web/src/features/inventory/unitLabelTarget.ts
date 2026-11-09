import type { LabelTarget, UnitKitDto } from "@silvicom/shared";

/**
 * A truck's or trailer's label target (DE4). A tractor is a `vehicles` row; a trailer and a reefer are
 * `trailers` rows (`unitKindOf`'s split), and a label target names the TABLE — so this is the one place
 * the fleet's word becomes the table's, for the Labels list and the Equipment list's row menu alike.
 */
export const unitLabelTable = (u: Pick<UnitKitDto, "kind">): "vehicle" | "trailer" => (u.kind === "tractor" ? "vehicle" : "trailer");

export const unitLabelTarget = (u: Pick<UnitKitDto, "kind" | "unitId">): LabelTarget => ({
  kind: "unit",
  unitKind: unitLabelTable(u),
  unitId: u.unitId,
});
