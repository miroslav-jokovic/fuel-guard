import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFuelTieOut, type FuelTieOut } from "@silvicom/shared";
import { readLedgerTotals, readGlAccounts, readSettlementsWindow } from "../mcleod/index.js";
import { readEfsLineItemsWindow } from "../efs/index.js";

/**
 * One month's FUEL tie-out, assembled from the three sources it needs (D-FIN12): the FUEL
 * module's per-account totals from the GL sweep, the chart of accounts for names, the settlement
 * sweep for which tractors ran for an owner-operator, and EFS's own card lines by product.
 * The arithmetic is `buildFuelTieOut` in shared; this file only fetches and org-scopes.
 */
export async function getFuelTieOut(
  admin: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
): Promise<FuelTieOut> {
  const [totals, accounts, settlements, lines] = await Promise.all([
    readLedgerTotals(admin, orgId, periodStart),
    readGlAccounts(admin, orgId),
    readSettlementsWindow(admin, orgId, periodStart, periodEnd),
    readEfsLineItemsWindow(admin, orgId, periodStart, periodEnd),
  ]);
  const descr = new Map(accounts.map((a) => [a.glid, a.descr]));
  const glTotals = totals
    .filter((t) => t.post_module === "FUEL")
    .map((t) => ({ glid: t.glid, descr: descr.get(t.glid) ?? null, net_amount: Number(t.net_amount) }));
  const ownerOperatorUnits = new Set(
    settlements
      .filter((s) => !s.is_void && s.payee_type === "owner_operator" && s.tractor_unit)
      .map((s) => String(s.tractor_unit).trim()),
  );
  return buildFuelTieOut({
    lines: lines.map((l) => ({ item: l.item, amount: Number(l.amt ?? 0), unit: l.unit })),
    ownerOperatorUnits,
    glTotals,
  });
}
