/**
 * The org's recorded fills, projected to the analytics' `SpendLine`.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * The ONE9, California and off-network tabs were built on parsed vendor STATEMENTS, which meant they
 * showed nothing at all until somebody uploaded a PDF — and they answer questions the carrier asks far
 * more often than a statement arrives. `fuel_transactions` has the same fills continuously from the EFS
 * feed, and since the station backfill 98.5% of them carry a `station_id`, so the brand dimension those
 * reports are built on is finally available without a statement.
 *
 * ── WHAT THIS SOURCE CANNOT DO, AND WHY THAT IS FINE HERE ───────────────────────────────────────
 * `retailAmount` is null: EFS records what we PAID and never the posted price. Discount capture
 * therefore CANNOT be computed from these rows and stays on the statement source — see
 * `DiscountCaptureTab`. The three policy reports do not need it, because `analyzePolicyExceptions`
 * prices every exception against what the rest of the fleet paid over the SAME period, not against
 * retail. A ONE9 fill is expensive relative to the Pilot fills around it whether or not we know what
 * ONE9 posted that day.
 *
 * ── UNRESOLVED STATIONS COUNT AS OFF-NETWORK, DELIBERATELY ──────────────────────────────────────
 * A fill whose site could not be matched has `brand: null`. `analyzePolicyExceptions` treats that as
 * off-network rather than as compliant, which is the honest reading: an unidentified site is certainly
 * not a preferred one.
 */
import type { Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import type { SpendLine } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import type { SpendQueryFilters } from "./useSpendDays";

const PAGE = 1000;
const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
const str = (v: unknown): string | null => (v == null ? null : String(v));

/** PostgREST returns an embedded to-one relation as an object or a single-element array by version. */
const embed = <T,>(v: unknown): T | null =>
  Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null);

export function useSpendLinesQuery(filters: Ref<SpendQueryFilters>) {
  return useQuery({
    queryKey: ["fuel_spend_lines", filters],
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SpendLine[]> => {
      const f = filters.value;
      const out: SpendLine[] = [];
      for (let start = 0; ; start += PAGE) {
        let q = supabase
          .from("fuel_transactions")
          .select(
            "fueled_at, state, gallons, total_cost, tank_type, location_text, fuel_stations(brand, store_number, city), vehicles(unit_number), drivers(full_name)",
          )
          .gte("fueled_at", `${f.from}T00:00:00.000Z`)
          .lte("fueled_at", `${f.to}T23:59:59.999Z`);
        if (f.vehicleIds.length) q = q.in("vehicle_id", f.vehicleIds);
        const { data, error } = await q.order("fueled_at", { ascending: true }).range(start, start + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as Record<string, unknown>[];
        for (const r of batch) {
          const station = embed<{ brand: string | null; store_number: string | null; city: string | null }>(r.fuel_stations);
          const vehicle = embed<{ unit_number: string | null }>(r.vehicles);
          const driver = embed<{ full_name: string | null }>(r.drivers);
          out.push({
            tranDate: r.fueled_at ? String(r.fueled_at).slice(0, 10) : null,
            brand: station?.brand ?? null,
            state: str(r.state),
            site: station?.store_number ?? null,
            // Fall back to the location string so an unresolved site is still nameable in the table.
            city: station?.city ?? str(r.location_text),
            unit: vehicle?.unit_number ?? null,
            driver: driver?.full_name ?? null,
            product: "diesel",
            tank: r.tank_type === "reefer" ? "reefer" : "tractor",
            gallons: num(r.gallons),
            netAmount: r.total_cost == null ? null : num(r.total_cost),
            retailAmount: null, // the feed never carries posted price — see the header
          });
        }
        if (batch.length < PAGE) break;
      }
      return out;
    },
  });
}
