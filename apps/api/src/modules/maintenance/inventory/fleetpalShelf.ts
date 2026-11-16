import type { SupabaseClient } from "@supabase/supabase-js";
import type { PartMovementDto } from "@silvicom/shared";
import { traced } from "../inspections/serviceError.js";
import { toMovementDto } from "./movements.js";
import type { ServiceError } from "./types.js";

/**
 * The three doors the FleetPal collector uses to move a shelf (FLEETPAL-INTEGRATION-PLAN.md F13;
 * D-FP2: the collector writes no table it does not own, so `stock_locations`, `parts` and
 * `part_movements` are reached through here and nowhere else).
 *
 * ── D-INV11 STILL HOLDS ───────────────────────────────────────────────────────────────────────
 * A FleetPal receipt carries what the line was invoiced at, and it lands as `unit_cost` and as the
 * part's `last_cost` exactly as a typed receipt does. None of it reaches Finance: parts cost is GL
 * 30230000's, a part issue is not a spend event, and FleetPal money lives in the Maintenance section
 * beside its coverage bound (D-FP3, D-FP4). Nothing in this file writes a financial row.
 */

export interface FleetpalShelf {
  locationId: string;
  /** The instant the shelf started following FleetPal (0621's `fleetpal_from`). */
  from: string;
}

/** The one place that follows FleetPal, or null when none does (then nothing moves). */
export async function getFleetpalShelf(admin: SupabaseClient, orgId: string): Promise<FleetpalShelf | null | ServiceError> {
  const { data, error } = await admin
    .from("stock_locations")
    .select("id, fleetpal_from")
    .eq("org_id", orgId)
    .eq("active", true)
    .not("fleetpal_from", "is", null)
    .maybeSingle();
  if (error) return traced("getFleetpalShelf", "db_error", "Could not find the place that follows FleetPal", error);
  if (!data) return null;
  const row = data as { id: string; fleetpal_from: string };
  return { locationId: row.id, from: row.fleetpal_from };
}

/**
 * Our part ids for FleetPal catalogue ids — only for parts the F12 sweep has written. A FleetPal id
 * with no answer is a line the shelf cannot hold (the numberless VENDOR_HIDDEN quote lines F12 skips,
 * D-FP26), and the caller reports it rather than inventing a part.
 *
 * Chunked at 100: an `.in()` list rides in the URL, and a long one overflows Node 22's header limit.
 */
export async function partIdsByFleetpalId(
  admin: SupabaseClient,
  orgId: string,
  fleetpalIds: readonly string[],
): Promise<Map<string, string> | ServiceError> {
  const out = new Map<string, string>();
  const unique = [...new Set(fleetpalIds)];
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await admin
      .from("parts")
      .select("id, fleetpal_id")
      .eq("org_id", orgId)
      .in("fleetpal_id", unique.slice(i, i + 100));
    if (error) return traced("partIdsByFleetpalId", "db_error", "Could not look up FleetPal parts", error);
    for (const r of (data ?? []) as { id: string; fleetpal_id: string }[]) out.set(r.fleetpal_id, r.id);
  }
  return out;
}

export interface FleetpalMovement {
  /** Derived from FleetPal's own line id, so the next sweep's re-offer is the same movement (D-INV27). */
  id: string;
  partId: string;
  locationId: string;
  reason: "received" | "issued";
  quantity: number;
  /** FleetPal's `created` for the line (D-FP24). */
  occurredAt: string;
  unitCost: number | null;
  vehicleId: string | null;
  trailerId: string | null;
  workOrderRef: string | null;
  note: string | null;
}

export type FleetpalMovementOutcome =
  | { outcome: "recorded"; movement: PartMovementDto }
  /** IV010: the shelf does not hold enough — a counting problem; the sweep retries for a week (D-FP25). */
  | { outcome: "short" }
  /** IV030: before the shelf's start, or the place stopped following FleetPal mid-sweep. */
  | { outcome: "before_start" }
  /** IV013: the part was retired in our catalogue; a retired part takes no receipt or issue. */
  | { outcome: "part_inactive" };

const OUTCOME_BY_CODE: Record<string, FleetpalMovementOutcome["outcome"]> = {
  IV010: "short",
  IV030: "before_start",
  IV013: "part_inactive",
};

/**
 * Writes one FleetPal line through the ledger's only door, marked as FleetPal's and with no actor.
 * The refusals the sweep expects come back as outcomes; anything else is an error, because it means
 * the ledger, not the shelf, is unwell.
 */
export async function recordFleetpalMovement(
  admin: SupabaseClient,
  orgId: string,
  m: FleetpalMovement,
): Promise<FleetpalMovementOutcome | ServiceError> {
  const { data, error } = await admin.rpc("record_part_movement", {
    p_org: orgId,
    p_actor: null,
    p_row: {
      id: m.id,
      partId: m.partId,
      locationId: m.locationId,
      reason: m.reason,
      quantity: m.quantity,
      occurredAt: m.occurredAt,
      unitCost: m.unitCost,
      vehicleId: m.vehicleId,
      trailerId: m.trailerId,
      workOrderRef: m.workOrderRef,
      note: m.note,
      source: "fleetpal",
    },
  });
  if (error) {
    const expected = error.code ? OUTCOME_BY_CODE[error.code] : undefined;
    if (expected) return { outcome: expected } as FleetpalMovementOutcome;
    return traced("recordFleetpalMovement", "db_error", "Could not record the FleetPal movement", error);
  }
  const row = (Array.isArray(data) ? data[0] : data) as Parameters<typeof toMovementDto>[0] | null;
  if (!row) return traced("recordFleetpalMovement", "db_error", "The FleetPal movement was not recorded", null);
  return { outcome: "recorded", movement: toMovementDto(row) };
}
