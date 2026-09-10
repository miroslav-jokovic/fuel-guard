import { z } from "zod";

/**
 * FleetPal wire primitives — the four conventions of the vendor's API that everything else here
 * depends on, and the three that are easy to get wrong (FLEETPAL-INTEGRATION-PLAN.md §1.5, D-FP9).
 *
 * ── ⚠ 1. MONEY IS A NUMBER IN CURRENCY UNITS, NOT CENTS AND NOT A STRING ─────────────────────
 * The vendor is explicit: `"total": 125.5` is $125.50, with up to three decimal places, and their
 * own documentation says to parse it into a decimal type rather than a binary float if you intend
 * to do arithmetic on it. We obey by never doing arithmetic here: `money` validates and carries the
 * number through to a Postgres `numeric` column, where the addition happens. A collector that
 * summed job items in JavaScript would drift by cents over a fleet's year of repairs, and the
 * drift would show up as a coverage ratio nobody could reconcile (D-FP4).
 *
 * ── ⚠ 2. DISTANCES ARE CANONICAL METRES ──────────────────────────────────────────────────────
 * Meter readings — `ODOMETER` and `HUBOMETER` values, and the `odometer` / `hubometer` fields on a
 * service-history row — are metres, never converted to the company's display units. `ENGINE_HOURS`
 * and `APU_HOURS` are hours. A truck at 412,000 on its dash reads 663,049,728 here. `metresToMiles`
 * is the ONE conversion site in the integration; nothing divides by 1609.344 inline.
 *
 * ── ⚠ 3. AN ENUM IS A KNOWN SET, NOT A CLOSED ONE ────────────────────────────────────────────
 * Within v1 the vendor reserves the right to add endpoints, add optional request fields and add
 * response fields, and instructs consumers to IGNORE fields they do not recognise rather than
 * reject them. A `z.enum` over a status would therefore take the whole feed down the day FleetPal
 * adds a sixth work-order state — an outage caused by a change they told us to expect. So every
 * vocabulary below is `z.string()` plus an exported `const` of the members we know, and
 * `fleetpalContract.test.ts` pins those members against the generated manifest. The parser accepts
 * an unknown member; the test notices one appeared. That is the split that keeps both properties.
 *
 * Note that several of these vocabularies are typed as bare `string` by the vendor's own schema
 * (work-order `status`, job `source`, defect `severity`, expiration `status`) while others are
 * declared enums. We treat them identically, because the distinction is an artefact of how their
 * serializers were written and not a promise about stability.
 *
 * ── 4. OBJECTS ARE LOOSE ─────────────────────────────────────────────────────────────────────
 * `z.looseObject` for the same reason: an added response field is an allowed change, and a strict
 * object would silently strip it (zod 4 strips by default) or a strict-mode one would throw.
 */

/** A FleetPal object id. Opaque text — never parsed, never sorted by, never assumed to be a shape. */
export const fleetpalId = z.string().min(1);

/**
 * Money as the vendor sends it. Bare `z.number()` and not `.finite()`: zod 4 already rejects `NaN`
 * and `Infinity` here (measured, and `fleetpalContract.test.ts` pins it), and `.finite()` is
 * deprecated in that version. The property matters either way — neither value survives a JSON round
 * trip into a `numeric` column, and both would land as a null nobody could explain.
 */
export const money = z.number();

/** A meter reading or distance, in canonical units. Integral metres, or integral hours. */
export const canonicalMeter = z.number().int();

/** ISO 8601 with a UTC offset. Kept as text: the ingest hands it to Postgres, which owns the parse. */
export const timestamp = z.string().min(1);

/** Metres to miles. The one conversion site in this integration (D-FP9). */
export const METRES_PER_MILE = 1609.344;
export function metresToMiles(metres: number): number {
  return metres / METRES_PER_MILE;
}

// ── the vocabularies ────────────────────────────────────────────────────────────────────────────

export const FLEETPAL_OWNERSHIP = ["OWN", "LEASED", "RENTED", "CUSTOMER"] as const;
export const FLEETPAL_LINE_ITEM_TYPES = ["PART", "LABOR", "FEE", "TAX", "SERVICE"] as const;
export const FLEETPAL_METER_TYPES = ["ODOMETER", "ENGINE_HOURS", "HUBOMETER", "APU_HOURS"] as const;
export const FLEETPAL_REPAIR_PRIORITY_CLASSES = ["SCHEDULED", "NON_SCHEDULED", "EMERGENCY"] as const;
export const FLEETPAL_WORK_ORDER_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export const FLEETPAL_ISSUE_STATUSES = ["OPEN", "SCHEDULED", "IN_PROGRESS", "CLOSED"] as const;
export const FLEETPAL_ISSUE_PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export const FLEETPAL_RECEIPT_ITEM_TYPES = ["RECEIVE", "CANCEL"] as const;
export const FLEETPAL_ORDER_STATUSES = ["OPEN", "CANCELED", "CLOSED", "DRAFT"] as const;
export const FLEETPAL_ORDER_TYPES = ["WORK_ORDER", "STANDARD", "CREDIT"] as const;
export const FLEETPAL_PO_ITEM_TYPES = ["PART", "FEE", "TAX"] as const;
export const FLEETPAL_PO_INVOICE_TYPES = ["STANDARD", "CREDIT"] as const;
export const FLEETPAL_VENDOR_TYPES = ["SERVICE", "FINANCIAL"] as const;
/**
 * Written out rather than `[...FLEETPAL_METER_TYPES, "TIME"]`, which is the tidier expression and
 * the wrong one: `check-fleetpal-contract.mjs` reads these consts as source text, so a spread-built
 * array is one it cannot pin — and an unpinned vocabulary is exactly the one that silently gains a
 * member. Deriving beats restating everywhere the derivation is checkable; here it is not.
 */
export const FLEETPAL_INTERVAL_TYPES = [
  "ODOMETER", "ENGINE_HOURS", "HUBOMETER", "APU_HOURS", "TIME",
] as const;
export const FLEETPAL_TIME_INTERVALS = ["DAY", "WEEK", "MONTH", "YEAR"] as const;

/**
 * 23 units of measure against our 8 (`each`…`pound`), and metric-heavy. The mapping is F12's
 * business and lives with the catalogue sync, because an unmappable unit must surface AS unmappable
 * on the part rather than defaulting to `each` — a wrong unit of measure is a wrong reorder
 * quantity, and it is invisible until somebody orders a box thinking it is one.
 */
export const FLEETPAL_UNITS_OF_MEASURE = [
  "bx", "cs", "disp", "ea", "m", "L", "hr", "cm", "kg", "km", "g", "pk",
  "pr", "set", "ml", "ft", "gal", "in", "lb", "mi", "oz", "pt", "qt",
] as const;

/**
 * Work-order lifecycle. Typed as a bare string by the vendor. `COMPLETED` is when the work is
 * finished and `CLOSED` is when it is financially settled — the distinction matters to us because
 * `/v1/service-history` only carries jobs on CLOSED work orders (D-FP5), so a completed-but-unclosed
 * repair is visible through `/v1/work-orders` and nowhere else.
 */
export const FLEETPAL_WORK_ORDER_STATUSES = [
  "PENDING", "OPEN", "COMPLETED", "CLOSED", "CANCELED",
] as const;

/** What caused a job line to exist. The matching id field on the job points at the origin. */
export const FLEETPAL_JOB_SOURCES = ["MANUAL", "PM_SCHEDULE", "DEFECT", "ISSUE"] as const;

/** Where an expiration stands, derived by the vendor from its date and threshold. */
export const FLEETPAL_EXPIRATION_STATUSES = [
  "PLANNED", "DUE_SOON", "OVERDUE", "COMPLETED",
] as const;

/**
 * Every vocabulary above, by the name the generated manifest uses, so the contract test can walk
 * them without a hand-maintained second list — which would be the copy this repo's "deriving beats
 * restating" rule exists to refuse. The four with no `*Enum` schema in the spec are absent here on
 * purpose: the manifest cannot carry what the vendor did not declare.
 */
export const FLEETPAL_ENUMS: Record<string, readonly string[]> = {
  OwnershipEnum: FLEETPAL_OWNERSHIP,
  LineItemTypeEnum: FLEETPAL_LINE_ITEM_TYPES,
  MeterTypeEnum: FLEETPAL_METER_TYPES,
  RepairPriorityClassEnum: FLEETPAL_REPAIR_PRIORITY_CLASSES,
  WorkOrderPriorityEnum: FLEETPAL_WORK_ORDER_PRIORITIES,
  IssueStatusEnum: FLEETPAL_ISSUE_STATUSES,
  IssuePriorityEnum: FLEETPAL_ISSUE_PRIORITIES,
  POReceiptItemTypeEnum: FLEETPAL_RECEIPT_ITEM_TYPES,
  OrderStatusEnum: FLEETPAL_ORDER_STATUSES,
  OrderTypeEnum: FLEETPAL_ORDER_TYPES,
  POItemTypeEnum: FLEETPAL_PO_ITEM_TYPES,
  POInvoiceTypeEnum: FLEETPAL_PO_INVOICE_TYPES,
  VendorTypeEnum: FLEETPAL_VENDOR_TYPES,
  IntervalTypeEnum: FLEETPAL_INTERVAL_TYPES,
  TimeIntervalEnum: FLEETPAL_TIME_INTERVALS,
  UnitOfMeasureEnum: FLEETPAL_UNITS_OF_MEASURE,
};

// ── the envelope ────────────────────────────────────────────────────────────────────────────────

/**
 * The list envelope. **`next` is the only correct way to walk a collection** — the vendor orders
 * results newest-first and warns that rows added mid-walk shift items between pages, so offset
 * arithmetic silently skips and repeats. `limit` defaults to 50 and is clamped (not rejected) at
 * 200. For a stable full sync, page by `updated_after` instead; §2.7 of the plan says which
 * resources can and which cannot.
 */
export function paginated<T extends z.ZodType>(item: T) {
  return z.looseObject({
    count: z.number().int().nonnegative(),
    next: z.string().nullable(),
    previous: z.string().nullable(),
    results: z.array(item),
  });
}

/**
 * A `4xx` body. Validation failures are keyed by field name with whole-object errors under
 * `non_field_errors`; every other status returns a bare `detail` string.
 *
 * ⚠ **Branch on `code`, never on `message`.** The vendor states that codes (`invalid`, `duplicate`,
 * `required`, …) are stable and safe to branch on, and that messages are human-readable and may be
 * reworded. A client keying off message text works until a copy edit.
 */
export const fleetpalFieldErrorSchema = z.looseObject({
  message: z.string(),
  code: z.string(),
});
export const fleetpalErrorSchema = z.looseObject({
  detail: z.string().optional(),
  non_field_errors: fleetpalFieldErrorSchema.optional(),
});
export type FleetpalFieldError = z.infer<typeof fleetpalFieldErrorSchema>;
