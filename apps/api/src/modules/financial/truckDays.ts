import type { SupabaseClient } from "@supabase/supabase-js";
import { truckDays, type TruckDays } from "@silvicom/shared";
import { readTractorPeriods } from "../mcleod/index.js";

/**
 * The truck-day census for a window (TRUCK-DRIVER-PNL-PLAN P2, D-TP3) — each truck's days in
 * service, split carrier / owner-operator, with the rows left out and why.
 *
 * Lives in `financial`, like the projection and the ledger coverage: the collector exports its raw
 * staging through its interface (D-SEP1) and this module owns what a truck-day MEANS. The per-truck
 * P&L (P3) divides lease, insurance and GPS over `carrierDays` and the per-mile overhead over every
 * truck; this function only counts.
 *
 * `to` is exclusive, like every window on the accounting surface.
 */
export async function getTruckDays(admin: SupabaseClient, orgId: string, from: string, to: string): Promise<TruckDays> {
  return truckDays(await readTractorPeriods(admin, orgId), from.slice(0, 10), to.slice(0, 10));
}
