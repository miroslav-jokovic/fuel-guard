import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { supabase } from "@/lib/supabase";

/** The burn rate + $/gal the idle cost is computed with, plus where the price came from. */
export interface IdleCostBasis {
  idleGalPerHour: number;
  fuelPricePerGal: number;
  priceSource: "truck_stops" | "settings" | "default";
}

const DEFAULT_BURN = 0.8; // Class-8 main-engine idle
const DEFAULT_PRICE = 4.0;
const PRICE_LOOKBACK_DAYS = 14;

/** Idle burn rate + the configured fallback price from the org's idle settings. */
function useIdleSettingsCost() {
  return useQuery({
    queryKey: ["idle_settings_cost"],
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data } = await supabase.from("idle_settings").select("idle_gal_per_hour, fuel_price_per_gal").maybeSingle();
      return {
        idleGalPerHour: data?.idle_gal_per_hour != null ? Number(data.idle_gal_per_hour) : null,
        fuelPricePerGal: data?.fuel_price_per_gal != null ? Number(data.fuel_price_per_gal) : null,
      };
    },
  });
}

/** A fleet-representative CURRENT diesel price: median of the org's recent posted truck-stop diesel prices
 *  (net price preferred, else posted). Null when there are no recent prices to draw on. */
function useFleetDieselPrice() {
  return useQuery({
    queryKey: ["fleet_diesel_price"],
    refetchInterval: 300_000,
    queryFn: async (): Promise<number | null> => {
      const since = new Date(Date.now() - PRICE_LOOKBACK_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("fuel_prices")
        .select("posted_price, net_price")
        .eq("product", "diesel")
        .gte("observed_at", since)
        .order("observed_at", { ascending: false })
        .limit(5000);
      if (error) throw new Error(error.message);
      const prices = ((data ?? []) as { net_price: number | string | null; posted_price: number | string | null }[])
        .map((r) => Number(r.net_price ?? r.posted_price))
        .filter((p) => Number.isFinite(p) && p > 0);
      if (!prices.length) return null;
      prices.sort((a, b) => a - b);
      const mid = Math.floor(prices.length / 2);
      return prices.length % 2 ? prices[mid]! : (prices[mid - 1]! + prices[mid]!) / 2;
    },
  });
}

/**
 * The cost basis for idle $: the burn rate from idle settings, and the price from your daily truck-stop
 * diesel prices (falling back to the settings price, then a $4.00 default). Reactive — the idle numbers
 * recompute when the daily prices refresh.
 */
export function useIdleCostBasis() {
  const { data: settings } = useIdleSettingsCost();
  const { data: dieselPrice } = useFleetDieselPrice();
  return computed<IdleCostBasis>(() => {
    const idleGalPerHour = settings.value?.idleGalPerHour ?? DEFAULT_BURN;
    if (dieselPrice.value != null) return { idleGalPerHour, fuelPricePerGal: Math.round(dieselPrice.value * 1000) / 1000, priceSource: "truck_stops" };
    if (settings.value?.fuelPricePerGal != null) return { idleGalPerHour, fuelPricePerGal: settings.value.fuelPricePerGal, priceSource: "settings" };
    return { idleGalPerHour, fuelPricePerGal: DEFAULT_PRICE, priceSource: "default" };
  });
}
