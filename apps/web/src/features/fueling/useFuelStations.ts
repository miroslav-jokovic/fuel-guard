import { useQuery } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

export interface FuelStationRow {
  id: string;
  brand: string;
  storeNumber: string | null;
  name: string | null;
  state: string | null;
  lat: number;
  lng: number;
  exit: string | null;
  netPrice: number | null;
  priceEstimated: boolean;
  priceConfidence: "high" | "medium" | "low" | null;
  postedPrice: number | null;
  observedAt: string;
  ageHours: number;
  stale: boolean;
}

/** All loaded truck stops + their current diesel price for the org. */
export function useFuelStations() {
  return useQuery({
    queryKey: ["fuel_stations_list"],
    queryFn: async (): Promise<{ stations: FuelStationRow[]; ttlHours: number }> => {
      const res = await apiFetch<{ stations: FuelStationRow[]; ttlHours: number }>("/api/fueling/stations");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load stations");
      return res.data;
    },
    refetchInterval: 300_000,
  });
}
