import { z } from "zod";

/**
 * Shop inventory — the fungible half (`docs/plans/maintenance/INVENTORY-PLAN.md` §5 I1, tables at
 * I2 and I5). Locations, parts, the per-location stock line, the movement ledger, and the count
 * session that walks a shelf.
 *
 * ── WHY THIS FILE STOPS WHERE IT DOES ───────────────────────────────────────────────────────────
 * §2.1 is the plan's central distinction and it is the seam this file is cut on. A case of oil
 * filters is STOCK: eleven of them, interchangeable, and the only questions are how many and where.
 * A tablet is an ASSET: A-0412, a serial number, in truck 654 and in 611 before that, and when it
 * goes missing the question is which one and from where. They are different shapes and they get
 * different tables, so they get different contract files — assets are in
 * `inventoryAssetContract.ts`, which imports the vocabularies below rather than restating them, and
 * the scan union that spans both is in `inventoryScanContract.ts`. The plan's I1 names one file;
 * three exist because the 500-line budget (`lint:filesize`) is a hard gate and the house comment
 * register is not optional. The seam was chosen to match the plan's own, not to make the numbers
 * work: I2/I5 build what is here, I7 builds the asset file, I6 builds the scan file.
 *
 * ── THE RULE THE SCHEMAS ENCODE ─────────────────────────────────────────────────────────────────
 * A quantity is never typed (D-INV4). There is no `setQuantity` payload anywhere in this file, and
 * there will not be one: `part_movements` is the truth and `part_stock.quantity_on_hand` is a
 * projection the RPC maintains. Every write below is a MOVEMENT with a delta and a reason. A count
 * is a movement too — it carries `countedTotal` and the RPC computes the delta at commit time from
 * whatever is on hand then, so a delivery received during a count is not silently overwritten
 * (§2.2). The one number a person types is the total they can see on the shelf.
 *
 * Every movement carries a client-generated UUID as its primary key (D-INV27). That is the server
 * half of the offline queue: Background Sync will never ship on Safari (research §4.5), so the
 * phone writes to IndexedDB before the network call and replays on reconnect, and the RPC's
 * `on conflict (id) do nothing` is what makes a replay harmless.
 */

// ── vocabularies ─────────────────────────────────────────────────────────────────────────────────

/**
 * Why stock moved. Six reasons, closed, and they are the ledger's whole vocabulary — the answer to
 * "where did the eleventh filter go" is a scan of these rows, so a reason that means two things is
 * a question that cannot be answered.
 *
 * `adjusted` is the only one that admits a manual decrease, and it is the only one that demands a
 * second field (`adjustReason` below). That pairing is deliberate: research §2.5 found that every
 * good product in the category makes an unexplained decrease impossible, because an inventory
 * anybody can quietly write down is an inventory nobody trusts.
 */
export const PART_MOVEMENT_REASONS = [
  "received",
  "issued",
  "adjusted",
  "transferred",
  "counted",
  "returned",
] as const;
export const partMovementReasonSchema = z.enum(PART_MOVEMENT_REASONS);
export type PartMovementReason = (typeof PART_MOVEMENT_REASONS)[number];

export const PART_MOVEMENT_REASON_LABELS: Record<PartMovementReason, string> = {
  received: "Received",
  issued: "Issued",
  adjusted: "Adjusted",
  transferred: "Transferred",
  counted: "Counted",
  returned: "Returned",
};

/** Why an adjustment was made. Mandatory on `adjusted` rows and meaningless on every other reason. */
export const ADJUST_REASONS = ["damaged", "lost", "found", "expired", "correction"] as const;
export const adjustReasonSchema = z.enum(ADJUST_REASONS);
export type AdjustReason = (typeof ADJUST_REASONS)[number];

export const ADJUST_REASON_LABELS: Record<AdjustReason, string> = {
  damaged: "Damaged",
  lost: "Lost",
  found: "Found",
  expired: "Expired",
  correction: "Correction",
};

/**
 * What holds a thing. Shared with the asset contract, which is why it lives in this file rather
 * than that one.
 *
 * `unassigned` is a real state and not a null: an asset in the tool crib on nobody's shelf, or one
 * just created and not yet put anywhere, is a different fact from one whose holder was never
 * recorded. D-INV3 is what fixes the list — a holder is a place or a unit, never a person, so there
 * is deliberately no `driver` member here and no `drivers` foreign key on any inventory table.
 */
export const HOLDER_KINDS = ["location", "vehicle", "trailer", "unassigned"] as const;
export const holderKindSchema = z.enum(HOLDER_KINDS);
export type HolderKind = (typeof HOLDER_KINDS)[number];

export const HOLDER_KIND_LABELS: Record<HolderKind, string> = {
  location: "Location",
  vehicle: "Truck",
  trailer: "Trailer",
  unassigned: "Unassigned",
};

/** The physical state of a thing. Three values; a fourth would need a rule that acts on it. */
export const ITEM_CONDITIONS = ["good", "worn", "damaged"] as const;
export const itemConditionSchema = z.enum(ITEM_CONDITIONS);
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

export const ITEM_CONDITION_LABELS: Record<ItemCondition, string> = {
  good: "Good",
  worn: "Worn",
  damaged: "Damaged",
};

/**
 * How a part is counted.
 *
 * A closed list rather than the free text the plan's table implies, and the reason is that this is
 * the unit every quantity in the product is denominated in. Free text gives "ea", "EA", "each" and
 * "Each" on four parts entered by four people, and then "12" on a stock line means nothing you can
 * put in a sentence. D-INV13 forbids custom FIELDS; it does not require free text in the fields
 * that exist, and a vocabulary is the cheaper half of that ruling. A missing unit is added here in
 * one line, which is the same cost as typing it wrong once.
 */
export const UNITS_OF_MEASURE = [
  "each",
  "pair",
  "set",
  "case",
  "box",
  "roll",
  "foot",
  "gallon",
  "quart",
  "litre",
  "pound",
] as const;
export const unitOfMeasureSchema = z.enum(UNITS_OF_MEASURE);
export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number];

export const UNIT_OF_MEASURE_LABELS: Record<UnitOfMeasure, string> = {
  each: "Each",
  pair: "Pair",
  set: "Set",
  case: "Case",
  box: "Box",
  roll: "Roll",
  foot: "Foot",
  gallon: "Gallon",
  quart: "Quart",
  litre: "Litre",
  pound: "Pound",
};

/** A count session is about one place, and it is open or it is closed. Closing is irreversible. */
export const COUNT_SESSION_KINDS = ["location", "unit"] as const;
export const countSessionKindSchema = z.enum(COUNT_SESSION_KINDS);
export type CountSessionKind = (typeof COUNT_SESSION_KINDS)[number];

export const COUNT_SESSION_STATUSES = ["open", "closed"] as const;
export const countSessionStatusSchema = z.enum(COUNT_SESSION_STATUSES);
export type CountSessionStatus = (typeof COUNT_SESSION_STATUSES)[number];

export const COUNT_SESSION_STATUS_LABELS: Record<CountSessionStatus, string> = {
  open: "Open",
  closed: "Closed",
};

// ── shared field shapes ──────────────────────────────────────────────────────────────────────────

/** Money, as the API renders it. Nullable everywhere: a part with no recorded cost is normal. */
const costSchema = z.number().nonnegative().nullable();
const trimmedText = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => trimmedText(max).nullable();

/**
 * Where on a shelf. Three free-text fragments rather than one, because "aisle 4, row B, bin 12" is
 * how a person is directed to a shelf and a single string cannot be sorted by aisle.
 */
export const binAddressSchema = z.object({
  aisle: optionalText(32),
  row: optionalText(32),
  bin: optionalText(32),
});
export type BinAddress = z.infer<typeof binAddressSchema>;

// ── stock locations ──────────────────────────────────────────────────────────────────────────────

/**
 * A place stock is held (D-INV1). A table and not an enum, because multi-location is a paid tier in
 * MaintainX and UpKeep and the top complaint when it is missing — and because `terminals` was
 * created at 0097 and dropped at 0259 after measuring zero rows, so this product has already paid
 * once for a place concept nobody produced rows for. `stock_locations` points at `terminals` if
 * that is ever rebuilt; it does not wait for it.
 */
export const stockLocationDtoSchema = z.object({
  id: z.uuid(),
  name: trimmedText(120),
  code: trimmedText(24),
  address: optionalText(240),
  active: z.boolean(),
});
export type StockLocationDto = z.infer<typeof stockLocationDtoSchema>;

export const stockLocationInputSchema = z.object({
  name: trimmedText(120).min(1, "Give the location a name."),
  code: trimmedText(24).min(1, "Give the location a short code."),
  address: optionalText(240).optional(),
  active: z.boolean().optional(),
});
export type StockLocationInput = z.infer<typeof stockLocationInputSchema>;

// ── parts ────────────────────────────────────────────────────────────────────────────────────────

/**
 * A part: the definition, not the stock. How many there are and where lives on the stock line
 * below, because the same filter sits on three shelves and its part number does not change per
 * shelf.
 *
 * `upc` is the supplier's barcode and is what makes a scan of a factory carton useful: the resolve
 * endpoint tries `parseTag` first and falls through to this column (D-INV7). It is nullable because
 * most parts will never have one recorded, and indexed because the fall-through queries it on every
 * unrecognised scan.
 *
 * `lastCost` is the only money here (D-INV15, D-INV11). It answers "what is this shelf worth" and
 * nothing else — parts cost never reaches Finance, because GL 30230000 already carries it and a
 * part issue is not a spend event.
 */
export const partDtoSchema = z.object({
  id: z.uuid(),
  partNumber: trimmedText(64),
  description: trimmedText(240),
  manufacturer: optionalText(120),
  category: optionalText(64),
  unitOfMeasure: unitOfMeasureSchema,
  upc: optionalText(32),
  imagePath: optionalText(400),
  lastCost: costSchema,
  active: z.boolean(),
  notes: optionalText(2000),
});
export type PartDto = z.infer<typeof partDtoSchema>;

export const partInputSchema = z.object({
  partNumber: trimmedText(64).min(1, "Give the part a number."),
  description: trimmedText(240).min(1, "Describe the part."),
  manufacturer: optionalText(120).optional(),
  category: optionalText(64).optional(),
  unitOfMeasure: unitOfMeasureSchema,
  upc: optionalText(32).optional(),
  notes: optionalText(2000).optional(),
  active: z.boolean().optional(),
});
export type PartInput = z.infer<typeof partInputSchema>;

// ── stock lines ──────────────────────────────────────────────────────────────────────────────────

/**
 * One part at one location — the row a `BIN` tag is stuck to and the thing a count counts.
 *
 * `quantityOnHand` appears here as a number and is nonetheless never written by a client. It is the
 * projection the RPC maintains from the ledger, and the reason there is no input schema carrying it
 * is D-INV4: the write that would set it is exactly the partial upsert `lint:upserts` forbids, and
 * the question the shop actually asks is where the eleventh filter went, which a typed total
 * destroys the evidence for.
 *
 * `tagCode` is null until a label is printed. A shelf works perfectly well without one — the tag is
 * what makes a scan land on this row, not what makes the row exist.
 */
export const stockLineDtoSchema = binAddressSchema.extend({
  partId: z.uuid(),
  locationId: z.uuid(),
  partNumber: trimmedText(64),
  partDescription: trimmedText(240),
  locationName: trimmedText(120),
  unitOfMeasure: unitOfMeasureSchema,
  quantityOnHand: z.number().int().nonnegative(),
  reorderPoint: z.number().int().nonnegative().nullable(),
  reorderQuantity: z.number().int().nonnegative().nullable(),
  tagCode: optionalText(16),
  lastCost: costSchema,
  active: z.boolean(),
});
export type StockLineDto = z.infer<typeof stockLineDtoSchema>;

/** What a desk user may set on a stock line. Notably absent: the quantity. */
export const stockLineSettingsSchema = binAddressSchema.partial().extend({
  reorderPoint: z.number().int().nonnegative().nullable().optional(),
  reorderQuantity: z.number().int().nonnegative().nullable().optional(),
  active: z.boolean().optional(),
});
export type StockLineSettings = z.infer<typeof stockLineSettingsSchema>;

// ── the movement ledger ──────────────────────────────────────────────────────────────────────────

/**
 * One row of the truth (D-INV4). Append-only, guarded by a trigger that fires for the service role
 * too (`IV011`), and never carrying an `audit_row_change` trigger — a ledger is its own audit.
 *
 * `occurredAt` is the client's clock and `receivedAt` is the server's, and they are two columns
 * rather than one because a phone that counted a shelf in a dead zone submits an hour later. The
 * RPC rejects an `occurredAt` more than 24 hours from now (`IV014`), which catches a device whose
 * clock is wrong without discarding a legitimate replay.
 */
export const partMovementDtoSchema = z.object({
  id: z.uuid(),
  partId: z.uuid(),
  locationId: z.uuid(),
  reason: partMovementReasonSchema,
  adjustReason: adjustReasonSchema.nullable(),
  quantityDelta: z.number().int(),
  countedTotal: z.number().int().nonnegative().nullable(),
  countSessionId: z.uuid().nullable(),
  unitCost: costSchema,
  vehicleId: z.uuid().nullable(),
  trailerId: z.uuid().nullable(),
  workOrderRef: optionalText(64),
  note: optionalText(2000),
  actorUserId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  blind: z.boolean().nullable(),
  /**
   * Who it came from, on a receipt (D-INV14: "receiving takes a supplier name and a cost"). It is
   * NOT vendor management — there is no vendor table and no purchase order, because 5 of 1,464 AP
   * vouchers carry a PO number. It sits on the movement rather than on the part because the same
   * filter bought from two suppliers is one part.
   *
   * ⚠ Added 2026-09-09, after the I0–I3 review found the column was WRITE-ONLY: 0331 stored it and
   * `receiveStockSchema` accepted it, and this DTO did not return it, so the field a technician
   * filled in could never be read back by anything. That is the same class of defect I1 recorded
   * about zod stripping unknown keys — a value accepted at one edge and dropped at the other.
   */
  supplier: optionalText(120),
  /**
   * Set on BOTH legs of a transfer, to the outbound leg's id, so the pair is recoverable. Null on
   * every other reason.
   *
   * ⚠ Also added by the 2026-09-09 review. 0331 wrote the column specifically so "the pair is
   * recoverable from the ledger", and without it on the DTO the pairing was recoverable only by
   * somebody writing SQL: the movements list rendered a transfer as two unexplained rows, one
   * negative and one positive, with nothing tying them together.
   */
  transferGroupId: z.uuid().nullable(),
  occurredAt: z.string(),
  receivedAt: z.string(),
});
export type PartMovementDto = z.infer<typeof partMovementDtoSchema>;

/**
 * The fields every movement write shares. `id` is supplied by the CLIENT and is the idempotency key
 * (D-INV27) — a phone that replays a queued write sends the same UUID and the RPC returns the row
 * it already has rather than moving the shelf twice.
 */
const movementBaseSchema = z.object({
  id: z.uuid(),
  partId: z.uuid(),
  locationId: z.uuid(),
  occurredAt: z.string(),
  note: optionalText(2000).optional(),
});

/**
 * The five desk verbs and the count, as separate payloads rather than one shape with a reason field.
 *
 * A single `movementInputSchema` with every column nullable would accept an `issued` row with no
 * unit and an `adjusted` row with no reason, and push the real rules into a service where no
 * contract can see them. Discriminating here means the shapes ARE the rules: `issue` cannot be
 * built without a unit, `adjust` cannot be built without a reason, and `count` carries an absolute
 * total rather than a delta because that is the only number a person can read off a shelf.
 */
export const receiveStockSchema = movementBaseSchema.extend({
  reason: z.literal("received"),
  quantity: z.number().int().positive(),
  unitCost: z.number().nonnegative().nullable().optional(),
  supplier: optionalText(120).optional(),
});

export const issueStockSchema = movementBaseSchema
  .extend({
    reason: z.literal("issued"),
    quantity: z.number().int().positive(),
    vehicleId: z.uuid().nullable().optional(),
    trailerId: z.uuid().nullable().optional(),
    workOrderRef: optionalText(64).optional(),
  })
  .refine((v) => Boolean(v.vehicleId) !== Boolean(v.trailerId), {
    message: "Issue a part to exactly one unit — a truck or a trailer.",
    path: ["vehicleId"],
  });

export const adjustStockSchema = movementBaseSchema.extend({
  reason: z.literal("adjusted"),
  /** Signed, and non-zero: an adjustment of nothing is a row that explains nothing. */
  quantityDelta: z.number().int().refine((n) => n !== 0, "An adjustment must change the count."),
  adjustReason: adjustReasonSchema,
});

export const transferStockSchema = movementBaseSchema
  .extend({
    reason: z.literal("transferred"),
    quantity: z.number().int().positive(),
    toLocationId: z.uuid(),
  })
  .refine((v) => v.toLocationId !== v.locationId, {
    message: "Transfer to a different location.",
    path: ["toLocationId"],
  });

export const returnStockSchema = movementBaseSchema.extend({
  reason: z.literal("returned"),
  quantity: z.number().int().positive(),
  vehicleId: z.uuid().nullable().optional(),
  trailerId: z.uuid().nullable().optional(),
});

/**
 * A count. `countedTotal` is what is on the shelf, not what changed — the RPC takes the delta
 * against whatever is on hand at commit time (§2.2), so a delivery received mid-count is added to
 * the count rather than erased by it.
 *
 * `blind` records the mode the row was counted in (D-INV20). It is on the movement and not only on
 * the session because a supervisor may reveal the expected figure part-way through, and "was this
 * number typed by someone who could see the answer" is a per-row fact after that.
 */
export const countStockSchema = movementBaseSchema.extend({
  reason: z.literal("counted"),
  countedTotal: z.number().int().nonnegative(),
  countSessionId: z.uuid().nullable().optional(),
  blind: z.boolean(),
});

export const partMovementInputSchema = z.discriminatedUnion("reason", [
  receiveStockSchema,
  issueStockSchema,
  adjustStockSchema,
  transferStockSchema,
  returnStockSchema,
  countStockSchema,
]);
export type PartMovementInput = z.infer<typeof partMovementInputSchema>;

// ── count sessions ───────────────────────────────────────────────────────────────────────────────

/**
 * A walk of one place (D-INV19). One session shape serves a shelf count (I5) and a unit kit check
 * (I9), because they are the same activity against different holders — and because two session
 * tables would mean two review screens that drift.
 *
 * Exactly one of the three holder columns is set, which the migration enforces with a CHECK and
 * this schema enforces with a refinement. The header of that migration cites 0092:137 and 0153:1-7:
 * a session is about one place, not a parallel registry of everything being counted anywhere.
 */
export const countSessionDtoSchema = z.object({
  id: z.uuid(),
  kind: countSessionKindSchema,
  locationId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
  trailerId: z.uuid().nullable(),
  holderLabel: z.string().nullable(),
  startedBy: z.uuid().nullable(),
  startedByName: z.string().nullable(),
  blind: z.boolean(),
  status: countSessionStatusSchema,
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  note: optionalText(2000),
});
export type CountSessionDto = z.infer<typeof countSessionDtoSchema>;

export const countSessionInputSchema = z
  .object({
    kind: countSessionKindSchema,
    locationId: z.uuid().nullable().optional(),
    vehicleId: z.uuid().nullable().optional(),
    trailerId: z.uuid().nullable().optional(),
    blind: z.boolean(),
    note: optionalText(2000).optional(),
  })
  .refine(
    (v) => [v.locationId, v.vehicleId, v.trailerId].filter(Boolean).length === 1,
    { message: "A count is about exactly one place — a location, a truck, or a trailer.", path: ["kind"] },
  )
  .refine((v) => (v.kind === "location" ? Boolean(v.locationId) : !v.locationId), {
    message: "A location count needs a location, and a unit count does not take one.",
    path: ["kind"],
  });
export type CountSessionInput = z.infer<typeof countSessionInputSchema>;
