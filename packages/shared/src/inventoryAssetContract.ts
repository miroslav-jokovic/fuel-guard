import { z } from "zod";
import { holderKindSchema, itemConditionSchema } from "./inventoryContract.js";

/**
 * Truck inventory — the half with identities (`docs/plans/maintenance/INVENTORY-PLAN.md` §5 I1,
 * tables at I7). Asset types, assets, the movement ledger that follows one, and the kit a unit is
 * expected to hold.
 *
 * This file is the other side of §2.1's seam from `inventoryContract.ts`, whose vocabularies it
 * imports rather than restating. A case of oil filters is stock; a tablet is A-0412, and when it
 * goes missing the question is which one and from where. "Truck inventory" is not a second feature
 * with a second table — it is this table with a unit as the holder, which is Snipe-IT's
 * "check out to another asset" and the reason one asset model covers the tool crib and the truck.
 *
 * ── THE RULING THAT SHAPES EVERY COLUMN HERE (D-INV3) ───────────────────────────────────────────
 * An asset's holder is a vehicle, a trailer, or a stock location. Never a person. The driver is
 * shown by INFERENCE from `vehicles.assigned_driver_id` at read time and is not stored, no table
 * below takes a `drivers` foreign key, and there is no signature anywhere in this contract.
 *
 * That is a legal position, not a modelling shortcut. Deductions for unreturned equipment are a
 * live dispute area in trucking, and a signed handover is an instrument that invites the argument
 * it appears to settle. Shelf, the best-designed product in the category, made the same choice. A
 * missing tablet is answered by a dated movement history showing which unit held it and when it
 * left — which is stronger evidence than a signature and costs the driver nothing. Q7 carries the
 * revisit path if a real dispute ever needs one: an `esign_consents`-shaped acknowledgement against
 * the existing movement row, not a new column here.
 *
 * A practical consequence: `actorDriverId` on a movement is TEXT and not a foreign key. The driver
 * app reports a missing or damaged item (I13) and the person who said so is worth recording, but
 * recording it as an FK would put a `drivers` reference on an inventory table and drag every one of
 * these rows into `merge_driver_v2`'s cascade (0264). It stays text on purpose.
 */

// ── vocabularies ─────────────────────────────────────────────────────────────────────────────────

/**
 * Where an asset stands. Five states, and the interesting one is `in_repair`.
 *
 * **`in_repair` does not clear the holder (D-INV24.)** A tablet at the repair shop is still unit
 * 654's tablet, and it is still missing FROM unit 654 — which is exactly what a driver doing a kit
 * check needs to be told. Modelling repair as "unassigned" would make the truck look correctly
 * equipped while the equipment sits in a box across town, and would lose the only fact that
 * explains the gap. The same reasoning covers `reported_missing` and `reported_damaged` below: a
 * report is a claim about a thing, not a move of it.
 *
 * `lost` and `retired` are terminal in different ways — `lost` is an unresolved fact and `retired`
 * is a decision. `retired` is what `IV023` refuses further movements against.
 */
export const ASSET_STATUSES = ["in_service", "in_repair", "spare", "lost", "retired"] as const;
export const assetStatusSchema = z.enum(ASSET_STATUSES);
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  in_service: "In service",
  in_repair: "In repair",
  spare: "Spare",
  lost: "Lost",
  retired: "Retired",
};

/**
 * Why an asset moved, or why somebody said something about it.
 *
 * The list divides in two and the division is load-bearing. `assigned`, `removed`, `transferred`
 * and `retired` CHANGE the holder columns. `reported_missing`, `reported_damaged` and `found` do
 * not — they are a person's claim, written by the driver app or by a technician mid-check, and the
 * holder stays exactly where it was until somebody actually moves the thing. `move_asset` enforces
 * that split rather than trusting a caller to pass the right holder alongside the right reason.
 */
export const ASSET_MOVEMENT_REASONS = [
  "assigned",
  "removed",
  "transferred",
  "reported_missing",
  "reported_damaged",
  "found",
  "retired",
] as const;
export const assetMovementReasonSchema = z.enum(ASSET_MOVEMENT_REASONS);
export type AssetMovementReason = (typeof ASSET_MOVEMENT_REASONS)[number];

export const ASSET_MOVEMENT_REASON_LABELS: Record<AssetMovementReason, string> = {
  assigned: "Assigned",
  removed: "Removed",
  transferred: "Transferred",
  reported_missing: "Reported missing",
  reported_damaged: "Reported damaged",
  found: "Found",
  retired: "Retired",
};

/** The reasons that leave the holder columns untouched. `move_asset` reads this, and so does the UI. */
export const HOLDER_PRESERVING_REASONS = [
  "reported_missing",
  "reported_damaged",
] as const satisfies readonly AssetMovementReason[];

export function movesHolder(reason: AssetMovementReason): boolean {
  return !(HOLDER_PRESERVING_REASONS as readonly AssetMovementReason[]).includes(reason);
}

/**
 * What kind of unit a kit expectation is written against (D-INV12).
 *
 * `reefer_trailer` is its own kind rather than a flag on `trailer` because a reefer's kit genuinely
 * differs — and because 234 active trailers against 207 tractors means trailers are the majority of
 * the fleet, so getting their kits wrong is the larger error. The kind is derived from
 * `trailers.is_reefer`, which the roster already carries.
 */
export const UNIT_KINDS = ["tractor", "trailer", "reefer_trailer"] as const;
export const unitKindSchema = z.enum(UNIT_KINDS);
export type UnitKind = (typeof UNIT_KINDS)[number];

export const UNIT_KIND_LABELS: Record<UnitKind, string> = {
  tractor: "Truck",
  trailer: "Trailer",
  reefer_trailer: "Reefer trailer",
};

// ── shared field shapes ──────────────────────────────────────────────────────────────────────────

const trimmedText = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => trimmedText(max).nullable();

/**
 * The holder, as a screen reads it. Assembled by the API from whichever of the three columns is
 * set, so no caller has to know that "unassigned" is spelled as three nulls in the database.
 */
export const assetHolderSchema = z.object({
  kind: holderKindSchema,
  id: z.uuid().nullable(),
  label: z.string().nullable(),
  /**
   * The driver of the holding vehicle, by inference and never stored (D-INV3). Null for a trailer,
   * a location, an unassigned asset, or a truck nobody is assigned to.
   */
  inferredDriverName: z.string().nullable(),
  /** When the current holder took it — the answer to "since when", read off the last movement. */
  since: z.string().nullable(),
});
export type AssetHolder = z.infer<typeof assetHolderSchema>;

// ── asset types ──────────────────────────────────────────────────────────────────────────────────

/**
 * A kind of thing: "tablet", "load bar", "ratchet strap".
 *
 * `serialized` is the distinction that decides whether individual identity is tracked. A tablet is
 * serialized — which tablet matters. Ratchet straps are not — four straps are four straps, and
 * insisting on a tag per strap is how an inventory discipline gets abandoned in week two.
 * `defaultKitQuantity` is what a unit is expected to hold when no explicit expectation row exists,
 * which is what makes A4's "ship empty and let the first check populate it" survivable.
 */
export const assetTypeDtoSchema = z.object({
  id: z.uuid(),
  name: trimmedText(120),
  category: optionalText(64),
  serialized: z.boolean(),
  defaultKitQuantity: z.number().int().nonnegative(),
  imagePath: optionalText(400),
});
export type AssetTypeDto = z.infer<typeof assetTypeDtoSchema>;

export const assetTypeInputSchema = z.object({
  name: trimmedText(120).min(1, "Give the type a name."),
  category: optionalText(64).optional(),
  serialized: z.boolean(),
  defaultKitQuantity: z.number().int().nonnegative(),
});
export type AssetTypeInput = z.infer<typeof assetTypeInputSchema>;

// ── assets ───────────────────────────────────────────────────────────────────────────────────────

/**
 * One thing with an identity (D-INV18).
 *
 * Two identifiers, and neither is configurable. `tagCode` is the opaque Crockford id inside the QR,
 * assigned once and never reprinted — reprinting it is how two objects end up answering to one
 * code. `displayNo` is the per-org sequence (`A-0412`) printed in text beside the symbol and spoken
 * aloud, because nobody reads `SIL1:AST:7K3M9P` over a radio. There is deliberately no setting that
 * lets an org design its own numbering: the identifier scheme is the one thing that must survive
 * every later feature that prints, scans or cites it.
 */
export const assetDtoSchema = z.object({
  id: z.uuid(),
  tagCode: optionalText(16),
  displayNo: trimmedText(16),
  assetTypeId: z.uuid(),
  assetTypeName: z.string(),
  name: trimmedText(120),
  serialNumber: optionalText(64),
  model: optionalText(64),
  manufacturer: optionalText(120),
  status: assetStatusSchema,
  condition: itemConditionSchema,
  holder: assetHolderSchema,
  purchasedAt: z.string().nullable(),
  purchaseCost: z.number().nonnegative().nullable(),
  warrantyExpiresAt: z.string().nullable(),
  imagePath: optionalText(400),
  notes: optionalText(2000),
});
export type AssetDto = z.infer<typeof assetDtoSchema>;

export const assetInputSchema = z.object({
  assetTypeId: z.uuid(),
  name: trimmedText(120).min(1, "Name the asset."),
  serialNumber: optionalText(64).optional(),
  model: optionalText(64).optional(),
  manufacturer: optionalText(120).optional(),
  status: assetStatusSchema,
  condition: itemConditionSchema,
  purchasedAt: z.string().nullable().optional(),
  purchaseCost: z.number().nonnegative().nullable().optional(),
  warrantyExpiresAt: z.string().nullable().optional(),
  notes: optionalText(2000).optional(),
});
export type AssetInput = z.infer<typeof assetInputSchema>;

// ── asset movements ──────────────────────────────────────────────────────────────────────────────

export const assetMovementDtoSchema = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  reason: assetMovementReasonSchema,
  fromHolder: assetHolderSchema.nullable(),
  toHolder: assetHolderSchema.nullable(),
  condition: itemConditionSchema.nullable(),
  note: optionalText(2000),
  actorUserId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  /** Text, not an FK — see the file header on D-INV3 and `merge_driver_v2`. */
  actorDriverId: optionalText(64),
  countSessionId: z.uuid().nullable(),
  occurredAt: z.string(),
  receivedAt: z.string(),
});
export type AssetMovementDto = z.infer<typeof assetMovementDtoSchema>;

/**
 * A move, or a report about one. Idempotent by the client-generated `id` exactly as part movements
 * are (D-INV27), because the unit check that writes these runs on the same phone in the same dead
 * zone as the shelf count that writes those.
 *
 * The refinement is `movesHolder`'s rule made unconstructable rather than merely documented: a
 * `reported_missing` row carrying a destination would be a claim and a move at once, and whichever
 * of the two the RPC honoured would be a surprise to the caller who wrote the other.
 */
export const assetMovementInputSchema = z
  .object({
    id: z.uuid(),
    assetId: z.uuid(),
    reason: assetMovementReasonSchema,
    toLocationId: z.uuid().nullable().optional(),
    toVehicleId: z.uuid().nullable().optional(),
    toTrailerId: z.uuid().nullable().optional(),
    condition: itemConditionSchema.optional(),
    note: optionalText(2000).optional(),
    countSessionId: z.uuid().nullable().optional(),
    occurredAt: z.string(),
  })
  .refine(
    (v) => [v.toLocationId, v.toVehicleId, v.toTrailerId].filter(Boolean).length <= 1,
    { message: "An asset is in one place at a time.", path: ["toLocationId"] },
  )
  .refine(
    (v) =>
      movesHolder(v.reason) ||
      [v.toLocationId, v.toVehicleId, v.toTrailerId].filter(Boolean).length === 0,
    {
      message: "Reporting an item missing or damaged does not move it — leave the destination empty.",
      path: ["reason"],
    },
  );
export type AssetMovementInput = z.infer<typeof assetMovementInputSchema>;

// ── kit expectations ─────────────────────────────────────────────────────────────────────────────

/**
 * What a unit is expected to hold (D-INV12, plan I9).
 *
 * Two layers: an org-wide default per asset type per unit kind, and per-unit override rows. Held
 * against expected is DERIVED by `deriveKitStatus` and stored nowhere — a stored kit status is a
 * second source of truth that goes stale the moment an asset moves, which is the workaround this
 * repo's own CDL/medical dual-source already demonstrated the cost of.
 *
 * `vehicleId`/`trailerId` null means this is the fleet default for `unitKind`; either one set makes
 * it an override for that unit alone.
 */
export const kitExpectationDtoSchema = z.object({
  id: z.uuid(),
  assetTypeId: z.uuid(),
  assetTypeName: z.string(),
  unitKind: unitKindSchema,
  vehicleId: z.uuid().nullable(),
  trailerId: z.uuid().nullable(),
  quantity: z.number().int().nonnegative(),
});
export type KitExpectationDto = z.infer<typeof kitExpectationDtoSchema>;

export const kitExpectationInputSchema = z
  .object({
    assetTypeId: z.uuid(),
    unitKind: unitKindSchema,
    vehicleId: z.uuid().nullable().optional(),
    trailerId: z.uuid().nullable().optional(),
    /** Zero is meaningful: an override that says this truck carries none of something. */
    quantity: z.number().int().nonnegative(),
  })
  .refine((v) => [v.vehicleId, v.trailerId].filter(Boolean).length <= 1, {
    message: "An override is for one unit.",
    path: ["vehicleId"],
  });
export type KitExpectationInput = z.infer<typeof kitExpectationInputSchema>;
