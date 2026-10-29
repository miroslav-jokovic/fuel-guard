import type { AssetDto, AssetMovementReason, AssetTypeDto } from "@silvicom/shared";

/**
 * A driver-held thing's moves, as the move drawer offers them (DE2b; D-DE1, owner 2026-10-27).
 *
 * ── THE TYPE DECIDES, NEVER THE NAME ──────────────────────────────────────────────────────────
 * `asset_types.held_by` says who may hold a kind of thing, and 0524's `IV025` refuses the other kind of
 * holder. So the drawer asks the type — a shop may rename "Tablet" to "ELD" and nothing here changes.
 * Until the types have loaded, a thing a driver already holds is driver-held by definition (the
 * database put it there); anything else waits for the type rather than guessing from its name.
 *
 * ── THREE VERBS, NOT SEVEN REASONS ────────────────────────────────────────────────────────────
 * A truck's equipment is placed, removed and transferred between units — the seven-reason combobox is
 * the right shape for it. A tablet has three things that happen to it: it is given to a driver, it
 * comes back to the shop, or it is retired. The verb picks the reason, so the ledger reads exactly as
 * it would for a truck (`assigned` / `transferred` / `removed`), and the person never has to know
 * which of those a hand-over is.
 */

export type TabletVerb = "give" | "return" | "retire";

/**
 * One word each: three segments share a 390 px phone, and "Give to a driver" was cut to "Give to a drive"
 * in the browser pass (2026-10-29). The drawer's title ("Give or return") and the field under the control
 * ("Driver" / "Where it goes in the shop") say the rest.
 */
export const TABLET_VERB_LABELS: Record<TabletVerb, string> = {
  give: "Give",
  return: "Return",
  retire: "Retire",
};

export function isDriverHeld(asset: Pick<AssetDto, "assetTypeId" | "holder">, types: readonly AssetTypeDto[] | undefined): boolean {
  if (asset.holder.kind === "driver") return true;
  return types?.find((t) => t.id === asset.assetTypeId)?.heldBy === "driver";
}

/** Return is offered only while a driver holds it — a tablet on the shelf has nowhere to come back from. */
export function tabletVerbs(asset: Pick<AssetDto, "holder">): TabletVerb[] {
  return asset.holder.kind === "driver" ? ["give", "return", "retire"] : ["give", "retire"];
}

/** What the drawer opens on: the one thing a person holding a driver's tablet came to do is take it back. */
export function defaultTabletVerb(asset: Pick<AssetDto, "holder">): TabletVerb {
  return asset.holder.kind === "driver" ? "return" : "give";
}

/**
 * The ledger's reason for a verb. Give from one driver straight to another is a transfer — the same word
 * a strap moving trailer to trailer gets — and give from the shelf is an assignment.
 */
export function tabletReason(verb: TabletVerb, asset: Pick<AssetDto, "holder">): AssetMovementReason {
  if (verb === "retire") return "retired";
  if (verb === "return") return "removed";
  return asset.holder.kind === "driver" ? "transferred" : "assigned";
}

/**
 * Where Return puts it when the person does not choose: the shop's only bay, when it has exactly one.
 * With two or more nothing is preselected — "the crib" is not a column, and picking the first by name
 * would be a guess the ledger then records as fact.
 */
export function defaultReturnBay(locations: readonly { id: string }[]): string {
  return locations.length === 1 ? locations[0]!.id : "";
}
