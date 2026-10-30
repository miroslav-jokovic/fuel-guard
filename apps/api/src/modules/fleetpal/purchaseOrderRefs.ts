import type { SupabaseClient } from "@supabase/supabase-js";
import type { FleetpalOrderRef } from "@silvicom/shared";
import { orFilterValue } from "../../lib/postgrestFilters.js";

/**
 * FleetPal's purchase orders as an equipment bill names them (MAINTENANCE-SECTION-REDESIGN-PROPOSAL
 * §7a.4, M10b; Q-MX10: 33 orders, ≈ $13.5k of straps and chains, bought as shop stock).
 *
 * Here and not in `maintenance` because the staged rows are this module's (`maintenance -> fleetpal`,
 * D-FP2): a bill links an order by its id and shows FleetPal's reference, and nothing on the
 * maintenance side parses or reads FleetPal's table itself.
 *
 * The finder leaves out a cancelled order — a strap nobody received was not paid for — and offers the
 * newest first, because a bill is typed the week its order closes. It searches the reference the shop
 * holds ("RS-1042") and the description ("ratchet straps 2in").
 */

const COLUMNS = "id, reference_number, description, total_invoices, vendor_created_at";
type Row = {
  id: string;
  reference_number: string | null;
  description: string | null;
  total_invoices: unknown;
  vendor_created_at: string | null;
};

const toRef = (r: Row): FleetpalOrderRef => ({
  id: r.id,
  referenceNumber: r.reference_number,
  description: r.description,
  total: r.total_invoices == null ? null : Number(r.total_invoices),
  createdAt: r.vendor_created_at,
});

export const PURCHASE_ORDER_CHOICES_MAX = 20;

export async function findPurchaseOrders(
  admin: SupabaseClient,
  orgId: string,
  search: string | undefined,
): Promise<FleetpalOrderRef[] | { error: string }> {
  let q = admin.from("fleetpal_purchase_orders").select(COLUMNS).eq("org_id", orgId).is("canceled_on", null);
  if (search?.trim()) {
    const term = orFilterValue(`%${search.trim()}%`);
    q = q.or(`reference_number.ilike.${term},description.ilike.${term}`);
  }
  const { data, error } = await q
    .order("vendor_created_at", { ascending: false, nullsFirst: false })
    .limit(PURCHASE_ORDER_CHOICES_MAX);
  if (error) return { error: error.message };
  return ((data ?? []) as Row[]).map(toRef);
}

/** The orders a page of bills names, by id — one query for the page, never one per row. */
export async function purchaseOrderRefs(
  admin: SupabaseClient,
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, FleetpalOrderRef> | { error: string }> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await admin.from("fleetpal_purchase_orders").select(COLUMNS).eq("org_id", orgId).in("id", unique);
  if (error) return { error: error.message };
  return new Map(((data ?? []) as Row[]).map((r) => [r.id, toRef(r)]));
}
