import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShopDefectDto, ShopSummary, ShopWorkOrderDto } from "@silvicom/shared";

/**
 * What FleetPal says is waiting on the shop: open work orders and unresolved defects
 * (FLEET-MANAGER-HOME-PLAN.md FM3, Q-FM6 (a)). Read here because this module owns the staging tables
 * F6 and F7 fill (D-FP2); the maintenance router composes them.
 *
 * ── THE COUNT IS THE LIST'S LENGTH, BY CONSTRUCTION ────────────────────────────────────────────
 * The Operations tab's Shop card shows a number and links to a page listing exactly those rows
 * (D-FM7, D-FM9). So there is one predicate per list, here, and the summary is `readShopBacklog`
 * measuring the two lists rather than a `count` query beside them that could be filtered differently
 * the day somebody edits one. Reading the rows to count them is affordable because both sets are
 * bounded by what is OUTSTANDING (24 and 52 on 2026-10-13), not by the 5,400 rows of history.
 *
 * ── "OPEN" IS THE VENDOR'S `OPEN`, AND NOTHING WIDER ───────────────────────────────────────────
 * `COMPLETED` is finished work not yet settled and `CLOSED` is settled (`FLEETPAL_WORK_ORDER_STATUSES`
 * says why both exist), so neither is waiting on a technician. `PENDING` is in the vendor's vocabulary
 * and held zero rows on 2026-10-13 (24 OPEN, 5,432 CLOSED, 6 CANCELED, 3 COMPLETED); whether a pending
 * order counts as waiting on the shop is a question for the day one exists, not a guess made now.
 *
 * ── THE UNIT IS FLEETPAL'S NUMBER, NOT A JOIN TO OUR ROSTER ────────────────────────────────────
 * The FleetPal → vehicle mapping is one-to-many and can be unmatched (`unitCost.ts`). A work order on
 * a unit nobody has linked is still a work order the shop owes, so the row carries the vendor's fleet
 * number from `fleetpal_units` and never drops out for want of a match.
 *
 * ── `severity` IS NOT READ ─────────────────────────────────────────────────────────────────────
 * It is null on every staged defect (52 of 52, 2026-10-13), so a severity column or a "critical"
 * figure would be a permanent blank that reads as good news.
 */
export const OPEN_WORK_ORDER_STATUS = "OPEN";

/** PostgREST caps a response at 1,000 rows; a page this size is always answered whole. */
const PAGE = 500;
/** Ids per `.in()`: a long list overflows Node 22's request-header limit and fails as "fetch failed". */
const IN_CHUNK = 100;

type DbError = { message: string };
export type ShopBacklog = Pick<ShopSummary, "openWorkOrders" | "oldestOpenWorkOrderAt" | "unresolvedDefects">;

interface WorkOrderRow {
  id: string;
  reference_number: string | null;
  unit_fleetpal_id: string | null;
  description: string | null;
  priority: string | null;
  vendor_created_at: string | null;
}
interface DefectRow {
  id: string;
  unit_fleetpal_id: string | null;
  name: string | null;
  description: string | null;
  driver_comment: string | null;
  detected_on: string | null;
}

/**
 * Every row a query matches, a page at a time to the end. `build` is called per page so each page is
 * a fresh builder carrying the same filters. Ordered by the caller's date and then `id`, so a page
 * boundary between two equal timestamps neither skips nor repeats a row.
 */
async function readAll<T>(
  build: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: DbError | null }> },
): Promise<T[] | { error: DbError }> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build().range(offset, offset + PAGE - 1);
    if (error) return { error };
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** FleetPal's fleet number for each staged unit id the rows name. Missing ids simply map to nothing. */
async function unitNumbers(
  admin: SupabaseClient,
  orgId: string,
  fleetpalIds: readonly (string | null)[],
): Promise<Map<string, string | null> | { error: DbError }> {
  const ids = [...new Set(fleetpalIds.filter((id): id is string => !!id))];
  const out = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await admin
      .from("fleetpal_units")
      .select("fleetpal_id, number")
      .eq("org_id", orgId)
      .in("fleetpal_id", ids.slice(i, i + IN_CHUNK));
    if (error) return { error };
    for (const u of (data ?? []) as { fleetpal_id: string; number: string | null }[]) out.set(u.fleetpal_id, u.number);
  }
  return out;
}

const unitOf = (units: Map<string, string | null>, id: string | null) => (id ? (units.get(id) ?? null) : null);

/** Open work orders, oldest first. Errors carry the database's cause for the route to LOG, never to send. */
export async function readOpenWorkOrders(
  admin: SupabaseClient,
  orgId: string,
): Promise<ShopWorkOrderDto[] | { error: DbError }> {
  const rows = await readAll<WorkOrderRow>(() =>
    admin
      .from("fleetpal_work_orders")
      .select("id, reference_number, unit_fleetpal_id, description, priority, vendor_created_at")
      .eq("org_id", orgId)
      .eq("status", OPEN_WORK_ORDER_STATUS)
      .order("vendor_created_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }),
  );
  if ("error" in rows) return rows;
  const units = await unitNumbers(admin, orgId, rows.map((r) => r.unit_fleetpal_id));
  if ("error" in units) return units;
  return rows.map((r) => ({
    id: r.id,
    referenceNumber: r.reference_number,
    unitNumber: unitOf(units, r.unit_fleetpal_id),
    description: r.description,
    priority: r.priority,
    openedAt: r.vendor_created_at,
  }));
}

/** Unresolved defects, oldest first. A null `is_resolved` is not "unresolved" — the vendor never said. */
export async function readUnresolvedDefects(
  admin: SupabaseClient,
  orgId: string,
): Promise<ShopDefectDto[] | { error: DbError }> {
  const rows = await readAll<DefectRow>(() =>
    admin
      .from("fleetpal_defects")
      .select("id, unit_fleetpal_id, name, description, driver_comment, detected_on")
      .eq("org_id", orgId)
      .eq("is_resolved", false)
      .order("detected_on", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }),
  );
  if ("error" in rows) return rows;
  const units = await unitNumbers(admin, orgId, rows.map((r) => r.unit_fleetpal_id));
  if ("error" in units) return units;
  return rows.map((r) => ({
    id: r.id,
    unitNumber: unitOf(units, r.unit_fleetpal_id),
    name: r.name,
    description: r.description,
    driverComment: r.driver_comment,
    detectedAt: r.detected_on,
  }));
}

/**
 * The two lists, measured. The oldest open order is the first dated row of the list, because the list
 * is oldest first with undated rows last — so the card's "open since" is the top row of the page.
 */
export async function readShopBacklog(admin: SupabaseClient, orgId: string): Promise<ShopBacklog | { error: DbError }> {
  const [orders, defects] = await Promise.all([readOpenWorkOrders(admin, orgId), readUnresolvedDefects(admin, orgId)]);
  if ("error" in orders) return orders;
  if ("error" in defects) return defects;
  return {
    openWorkOrders: orders.length,
    oldestOpenWorkOrderAt: orders[0]?.openedAt ?? null,
    unresolvedDefects: defects.length,
  };
}
