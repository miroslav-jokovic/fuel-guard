/**
 * ONE resolver for "what does an idled gallon cost this carrier", server-side (Q9,
 * `docs/plans/fuel/DATA-PRECISION-AUDIT-2026-09-20.md` §7.2).
 *
 * ── WHY IT MOVED, AND WHY HERE ─────────────────────────────────────────────────────────────────
 * The basis lived in a Vue composable (`useIdleCostBasis.ts`), which is fine while the browser is
 * the only thing that folds idle dollars. §7.2c step 3 moves the Dashboard's fold onto the server,
 * and `movingSpend = max(0, tractorSpend − idleCostUsd)` makes a FUEL figure depend on the IDLE
 * basis — a server that cannot resolve the basis cannot produce it, and the split fold that would
 * result is exactly the disagreement (8.61 MPG on a tile, 6.8 on the chart beneath it) the audit
 * was opened for. The basis is therefore forced server-side; it lands in `idle` because
 * `idle_settings` is idle's own table, and it is exported from this module's index so the Dashboard
 * endpoint, the Idling endpoint and the fuel-spend report all read ONE answer.
 *
 * ── WHAT THIS CHANGES, MEASURED ────────────────────────────────────────────────────────────────
 * `fuelIdleVerdict.readCostBasis` used to do the bottom two tiers only, so the REPORT charged
 * unpriced days at the configured $4.000/gal while the PAGE charged them at the truck-stop median.
 * Against production 2026-09-21 that median is $5.873/gal and what the fleet actually paid those
 * days was $5.79–$6.22 — so the report's unpriced days were understated by about a third, and this
 * is the number moving toward the fact rather than away from it. Days that HAVE a
 * `fuel_price_days` row are unaffected: they are priced at what the fleet actually paid, and the
 * basis is only the fallback (`readDayPrices`, same file).
 *
 * ── ORG SCOPING ────────────────────────────────────────────────────────────────────────────────
 * The service role bypasses RLS, so the `.eq("org_id")` here IS the tenant boundary — and the
 * median read it calls carries its own, proved in `dieselMedian.test.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { pickIdleCostBasis, type IdleCostBasis } from "@silvicom/shared";
import { readRecentDieselMedian, __resetDieselMedianCache } from "../posted-prices/index.js";

export async function resolveIdleCostBasis(admin: SupabaseClient, orgId: string): Promise<IdleCostBasis> {
  const [settings, truckStopMedian] = await Promise.all([
    readIdleSettings(admin, orgId),
    readRecentDieselMedian(admin, orgId),
  ]);
  return pickIdleCostBasis({ ...settings, truckStopMedian });
}

async function readIdleSettings(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ settingsGalPerHour: number | null; settingsPricePerGal: number | null }> {
  const { data } = await admin
    .from("idle_settings")
    .select("idle_gal_per_hour, fuel_price_per_gal")
    .eq("org_id", orgId)
    .maybeSingle();
  const row = data as { idle_gal_per_hour?: number | string | null; fuel_price_per_gal?: number | string | null } | null;
  // Numerics arrive from PostgREST as strings; `pickIdleCostBasis` owns what a non-positive one means.
  return {
    settingsGalPerHour: row?.idle_gal_per_hour == null ? null : Number(row.idle_gal_per_hour),
    settingsPricePerGal: row?.fuel_price_per_gal == null ? null : Number(row.fuel_price_per_gal),
  };
}

/**
 * Drop everything this resolver reads through a cache. For tests only.
 *
 * It is re-exposed HERE, rather than every consumer reaching for `posted-prices`' own reset,
 * because a module that consumes the basis (the dashboard endpoint) has no business importing the
 * price collector to clear a cache it never knew existed — `lint:boundaries` says so, and it is
 * right: the cache is an implementation detail of THIS resolver as far as its callers are concerned.
 */
export function __resetIdleCostBasisCache(): void {
  __resetDieselMedianCache();
}
