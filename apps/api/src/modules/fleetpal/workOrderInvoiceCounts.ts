import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@silvicom/shared";

/**
 * How many vendor invoices FleetPal records against each work order — the "2 vendor invoices" a roadside
 * repair's proposed work orders show (ROADSIDE-REPAIR-FLOW-PLAN RR2), so a person sees where the paper is
 * before opening anything.
 *
 * ── A COUNT, NEVER A SUM ─────────────────────────────────────────────────────────────────────────────
 * D-FP27 lets one invoice's own amount be shown and forbids adding invoices up; a total of several would be
 * exactly that. The drawer still shows each invoice's amount. An invoice reaches a work order only through a
 * purchase order raised on it (0351), so both hops are read, each org-scoped, in chunks (Node 22's header
 * limit, `IN_CHUNK`). A work order with none is absent from the map — the caller reads that as 0.
 */

const IN_CHUNK = 150;

function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += IN_CHUNK) out.push(xs.slice(i, i + IN_CHUNK));
  return out;
}

export async function countWorkOrderInvoices(admin: SupabaseClient, orgId: string, workOrderIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(workOrderIds)];
  if (ids.length === 0) return out;
  const woOfPo = new Map<string, string>();
  for (const c of chunks(ids)) {
    const pos = await fetchAllPaged<{ fleetpal_id: string; work_order_fleetpal_id: string }>((from, to) =>
      admin.from("fleetpal_purchase_orders").select("fleetpal_id, work_order_fleetpal_id").eq("org_id", orgId).in("work_order_fleetpal_id", c).order("id").range(from, to),
    );
    for (const p of pos) woOfPo.set(p.fleetpal_id, p.work_order_fleetpal_id);
  }
  for (const c of chunks([...woOfPo.keys()])) {
    const invoices = await fetchAllPaged<{ purchase_order_fleetpal_id: string }>((from, to) =>
      admin.from("fleetpal_po_invoices").select("purchase_order_fleetpal_id").eq("org_id", orgId).in("purchase_order_fleetpal_id", c).order("id").range(from, to),
    );
    for (const i of invoices) {
      const wo = woOfPo.get(i.purchase_order_fleetpal_id)!;
      out.set(wo, (out.get(wo) ?? 0) + 1);
    }
  }
  return out;
}
