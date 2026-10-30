import { readStickerCode, type AssetDto, type AssetMovementReason, type AssetTypeDto, type ScanResult } from "@silvicom/shared";
import type { AssetFormSeed } from "./AssetForm.vue";
import { isDriverHeld } from "./driverHeldMove";
import { unitName } from "./unitPage";

/**
 * What one scan means on the Assign equipment list (EQUIPMENT-ASSIGN-BY-SCAN-PROPOSAL.md §3.1, EA1).
 *
 * ── THE LIST STARTS FROM THE HOLDER, SO EVERY SCAN IS JUDGED AGAINST ONE DESTINATION ──────────
 * Until EA1 a move started from the item and ended in one list of every bay, truck and trailer — 400
 * rows to find the truck the person was standing at. Here the truck (or the driver) is already
 * chosen by the page the drawer was opened from, so a scan can only mean "put this here", and this
 * file says whether it can, in the words the line shows.
 *
 * ── THE TYPE DECIDES WHO MAY HOLD IT, AND THE LINE REFUSES RATHER THAN ASKS ───────────────────
 * `asset_types.held_by` (0524, D-DE1) says a tablet goes to a driver and everything else to a truck
 * or trailer, and `move_asset` refuses the other with `IV025`. Offering the move and letting the
 * database refuse it would put an error toast after the Confirm; asking "are you sure?" would offer
 * a choice the database overrules. So the line says no up front — and offers the one move that is
 * almost always what was meant: the truck's driver for a tablet, the driver's truck for a strap
 * (`instead`). `isDriverHeld` is the drawer's and the move drawer's one reading of the type.
 *
 * ── SOMETHING ON ANOTHER TRUCK MOVES, AND THE LINE SAYS FROM WHERE (Q-EA2) ────────────────────
 * Owner 2026-10-30, as recommended: refusing would send the person to the other truck's page first.
 * The move is a `transferred` row, so the other truck's history still says where it went.
 */

/** Where the list puts things: the truck, trailer or driver whose page opened it. */
export interface AssignTarget {
  kind: "vehicle" | "trailer" | "driver";
  id: string;
  /** "Truck 654", "Trailer 1203", "Dana Reyes" — what the line and the toast say. */
  label: string;
}

export type AssignVerdict =
  /** It can go here. `fromLabel` set = it is with somebody else now, and the line says so. */
  | { kind: "assign"; asset: AssetDto; to: AssignTarget; fromLabel: string | null; reason: AssetMovementReason }
  | { kind: "here"; asset: AssetDto; to: AssignTarget }
  | { kind: "wrong_holder"; asset: AssetDto; message: string; instead: AssignTarget | null }
  | { kind: "retired"; asset: AssetDto }
  /** Nothing on file carries it, and it reads like a device's own code — the line offers Add it. */
  | { kind: "new"; code: string; seed: AssetFormSeed; message: string }
  /** Another truck's or trailer's own label (DE5): the list moves on to that unit. */
  | { kind: "switch"; code: string; to: AssignTarget }
  | { kind: "refused"; code: string; message: string };

/**
 * `assigned` from the shelf (or from nowhere), `transferred` from another holder — the words the
 * move drawer's `tabletReason` writes for the same two cases, so the ledger reads the same whichever
 * door the move came through.
 */
export function assignReason(asset: Pick<AssetDto, "holder">): AssetMovementReason {
  const from = asset.holder;
  return from.id && from.kind !== "location" ? "transferred" : "assigned";
}

function sameHolder(asset: AssetDto, to: AssignTarget): boolean {
  return asset.holder.kind === to.kind && asset.holder.id === to.id;
}

/** Where it is now, as a person would say it — null for the shop's shelf, which is not a warning. */
function fromLabel(asset: AssetDto): string | null {
  const h = asset.holder;
  if (!h.id || h.kind === "location") return null;
  return h.label ?? (h.kind === "driver" ? "a driver" : h.kind === "trailer" ? "another trailer" : "another truck");
}

export function judgeAsset(
  asset: AssetDto,
  to: AssignTarget,
  types: readonly AssetTypeDto[] | undefined,
  partner: AssignTarget | null,
): AssignVerdict {
  if (asset.status === "retired") return { kind: "retired", asset };
  const forDriver = isDriverHeld(asset, types);
  if (to.kind === "driver" && !forDriver) {
    return { kind: "wrong_holder", asset, message: "This goes on a truck or trailer, not to a driver.", instead: partner };
  }
  if (to.kind !== "driver" && forDriver) {
    return {
      kind: "wrong_holder",
      asset,
      message: `A ${asset.assetTypeName.toLowerCase()} goes to a driver, not on a ${to.kind === "trailer" ? "trailer" : "truck"}.`,
      instead: partner,
    };
  }
  if (sameHolder(asset, to)) return { kind: "here", asset, to };
  return { kind: "assign", asset, to, fromLabel: fromLabel(asset), reason: assignReason(asset) };
}

/** Every answer `/api/tags/resolve` can give, read as a line on this list. */
export function judgeScan(
  result: ScanResult,
  to: AssignTarget,
  types: readonly AssetTypeDto[] | undefined,
  partner: AssignTarget | null,
): AssignVerdict {
  switch (result.kind) {
    case "asset":
      return judgeAsset(result.asset, to, types, partner);
    case "unit": {
      // A truck's or trailer's own label (DE4) names where things go, so it is never equipment. Another
      // unit's switches the list to it (DE5, owner 2026-10-30): standing at the next truck, its label is
      // the quickest way to say so. This one's own label changes nothing.
      const name = unitName(result.unit);
      if (result.unit.kind === to.kind && result.unit.id === to.id) {
        return { kind: "refused", code: result.code, message: `That is ${name}'s own label.` };
      }
      return { kind: "switch", code: result.code, to: { kind: result.unit.kind, id: result.unit.id, label: name } };
    }
    case "stock_line":
    case "part_by_upc":
      // Shop parts are FleetPal's and never ride on a truck as equipment (the two inventories, §0).
      return { kind: "refused", code: result.code, message: "That is a shop part, not equipment." };
    case "unknown_tag":
      return {
        kind: "refused",
        code: result.code,
        message:
          result.tagKind === null
            ? "The scanner misread that label — set it to the US English keyboard layout and scan again."
            : "That label is not on file in this account.",
      };
    case "malformed":
      return judgeUnknownCode(result.code);
  }
}

/** A code nothing on file carries: a device's IMEI, serial or model offers Add it (M9b's reading). */
function judgeUnknownCode(code: string): AssignVerdict {
  const s = readStickerCode(code);
  if (s.kind === "imei") return { kind: "new", code, seed: { imei: s.imei }, message: "A tablet not on file yet." };
  if (s.kind === "serial") return { kind: "new", code, seed: { serialNumber: s.serial }, message: "No equipment carries this code." };
  if (s.kind === "model") {
    return { kind: "new", code, seed: { model: s.model, manufacturer: s.manufacturer }, message: "No equipment carries this code." };
  }
  if (s.kind === "bad_imei") return { kind: "refused", code, message: "The IMEI was misread — scan it again." };
  if (s.kind === "sim") return { kind: "refused", code, message: "That is the SIM card's number — scan the barcode marked IMEI." };
  return { kind: "refused", code, message: "Not recognised — no equipment carries this code." };
}

interface VehicleLink {
  id: string;
  unit_number: string;
  assigned_driver_id: string | null;
  co_driver_id?: string | null;
}
interface DriverLink {
  id: string;
  full_name: string;
}

/**
 * The holder a refused line offers instead: a truck's assigned driver, or a driver's truck.
 *
 * Read off `vehicles.assigned_driver_id` — the same link D-DE4 counts a truck's tablet through and
 * D-INV3 names a truck's driver by. A trailer has no driver of its own, so it offers nothing; a
 * driver who is the co-driver of a team truck is offered that truck, because that is the truck the
 * strap in their hand is going on.
 */
export function holderPartner(
  target: AssignTarget,
  vehicles: readonly VehicleLink[] | undefined,
  drivers: readonly DriverLink[] | undefined,
): AssignTarget | null {
  if (target.kind === "trailer") return null;
  if (target.kind === "vehicle") {
    const driverId = vehicles?.find((v) => v.id === target.id)?.assigned_driver_id;
    const driver = driverId ? drivers?.find((d) => d.id === driverId) : undefined;
    return driver ? { kind: "driver", id: driver.id, label: driver.full_name } : null;
  }
  const truck =
    vehicles?.find((v) => v.assigned_driver_id === target.id) ?? vehicles?.find((v) => v.co_driver_id === target.id);
  return truck ? { kind: "vehicle", id: truck.id, label: `Truck ${truck.unit_number}` } : null;
}

/** The move a confirmed line writes. `id` is the line's, minted when the scan landed (D-INV27). */
export function assignPayload(id: string, v: Extract<AssignVerdict, { kind: "assign" }>, occurredAt: string) {
  return {
    id,
    assetId: v.asset.id,
    reason: v.reason,
    toLocationId: null,
    toVehicleId: v.to.kind === "vehicle" ? v.to.id : null,
    toTrailerId: v.to.kind === "trailer" ? v.to.id : null,
    toDriverId: v.to.kind === "driver" ? v.to.id : null,
    note: null,
    occurredAt,
  };
}
