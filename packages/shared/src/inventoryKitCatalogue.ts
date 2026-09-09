import type { UnitKind } from "./inventoryAssetContract.js";

/**
 * The starting kit a shop can adopt in one tap — A4, answered by the owner 2026-09-09.
 *
 * ── WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────────────────────────
 * A4 ("kit contents per unit kind") had blocked I9 from closing since the plan was written, and its
 * §6.2 fallback was "ship empty; the first unit check populates them". Shipping empty turned out to
 * be worse than it sounds: a fresh org has zero asset types, `assetInputSchema.assetTypeId` is
 * required, and there was no screen in the product that could create one — so the entire asset and
 * unit half was unreachable on day one, and two drawers told the reader to "add one on Assets
 * first" where nothing could. Measured 2026-09-09.
 *
 * So the answer to A4 is not a spreadsheet somebody types in: it is a named starting point the shop
 * adopts and then edits, in the same drawer, in seconds. That is also what makes it safe to be
 * wrong — every number here is a default, none of it is a rule the product enforces, and the Kit
 * rules drawer overwrites any of it.
 *
 * ── WHERE THE NUMBERS COME FROM ───────────────────────────────────────────────────────────────
 * The tractor list is anchored on §393.95, which requires a fire extinguisher, spare fuses and
 * three bidirectional emergency reflective triangles on every CMV — those five rows are the ones a
 * roadside inspection actually asks about, and a kit that omitted them would be a kit about
 * convenience rather than compliance. The trailer lists are this fleet's own load-securement
 * practice. The owner approved all three on 2026-09-09.
 *
 * ── ⚠ THE REEFER LIST REPEATS THE DRY VAN'S, AND THAT IS THE DATA MODEL, NOT AN OVERSIGHT ─────
 * `trailer` and `reefer_trailer` are two `UNIT_KINDS`, and a fleet rule matches its kind EXACTLY —
 * `resolveExpected` (api) looks for `unit_kind = <this unit's kind>` and `move_asset` does the same
 * in SQL to decide `IV020`. So a reefer does not inherit the dry van's rules, and writing "the
 * reefer carries everything the dry van does" as a comment while listing only the extras would ship
 * a reefer whose kit was three items long. Inheritance was considered and rejected: a kind that
 * silently carried another kind's rules would make "why does this reefer expect a seal kit"
 * unanswerable from the rules screen, which shows one kind at a time.
 */

export interface StandardKitType {
  /** The type's name. Matched case-insensitively against existing types, which is `idx_asset_types_name`. */
  name: string;
  category: string;
  /**
   * Whether individual identity is worth tracking (§2.1). A tablet is serialized — which tablet
   * matters, because it has a serial number and a warranty. Straps are not: four straps are four
   * straps, and insisting on a tag per strap is how an inventory discipline gets abandoned in week
   * two. `move_asset` reads this: `IV020` fires only for a serialized type.
   */
  serialized: boolean;
}

export interface StandardKitLine {
  typeName: string;
  unitKind: UnitKind;
  quantity: number;
}

/** Every kind of thing the standard kit names, in the order a person would list them. */
export const STANDARD_KIT_TYPES: readonly StandardKitType[] = [
  { name: "Tablet", category: "Electronics", serialized: true },
  { name: "Fire extinguisher", category: "Safety", serialized: true },
  { name: "Warning triangles", category: "Safety", serialized: false },
  { name: "Spare fuse kit", category: "Safety", serialized: false },
  { name: "Wheel chocks", category: "Safety", serialized: false },
  { name: "Load bar", category: "Securement", serialized: false },
  { name: "Ratchet strap", category: "Securement", serialized: false },
  { name: "Corner protectors", category: "Securement", serialized: false },
  { name: "Seal kit", category: "Securement", serialized: false },
  { name: "Reefer download cable", category: "Reefer", serialized: false },
  { name: "Fuel cap key", category: "Reefer", serialized: false },
  { name: "Temperature probe", category: "Reefer", serialized: true },
] as const;

/** The dry van's securement items, listed once and used by both trailer kinds — see the header. */
const TRAILER_SECUREMENT: readonly StandardKitLine[] = [
  { typeName: "Load bar", unitKind: "trailer", quantity: 2 },
  { typeName: "Ratchet strap", unitKind: "trailer", quantity: 4 },
  { typeName: "Corner protectors", unitKind: "trailer", quantity: 4 },
  { typeName: "Seal kit", unitKind: "trailer", quantity: 1 },
] as const;

export const STANDARD_KIT_LINES: readonly StandardKitLine[] = [
  // ── the tractor: §393.95's five, plus the tablet the ELD runs on ──────────────────────────────
  { typeName: "Tablet", unitKind: "tractor", quantity: 1 },
  { typeName: "Fire extinguisher", unitKind: "tractor", quantity: 1 },
  { typeName: "Warning triangles", unitKind: "tractor", quantity: 3 },
  { typeName: "Spare fuse kit", unitKind: "tractor", quantity: 1 },
  { typeName: "Wheel chocks", unitKind: "tractor", quantity: 2 },

  // ── the dry van ───────────────────────────────────────────────────────────────────────────────
  ...TRAILER_SECUREMENT,

  // ── the reefer: the dry van's list re-stated for its own kind, plus the three that are its own.
  //    Derived from `TRAILER_SECUREMENT` rather than retyped, so the two can never drift.
  ...TRAILER_SECUREMENT.map((l) => ({ ...l, unitKind: "reefer_trailer" as UnitKind })),
  { typeName: "Reefer download cable", unitKind: "reefer_trailer", quantity: 1 },
  { typeName: "Fuel cap key", unitKind: "reefer_trailer", quantity: 1 },
  { typeName: "Temperature probe", unitKind: "reefer_trailer", quantity: 1 },
] as const;
