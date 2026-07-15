import { useMutation } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

export interface PlanPoint { lat?: number | null; lng?: number | null; text?: string | null }
export interface PlanRequest {
  vehicleId: string;
  origin: PlanPoint;
  destination: PlanPoint;
  waypoints?: PlanPoint[];
  loadGrossLb?: number | null;
  hazmat?: string[];
  tunnelCategory?: string | null;
}
export interface PlanStopView {
  kind: "fuel" | "rest";
  milesAhead: number;
  stationLat: number | null; stationLng: number | null;
  stationName: string | null; brand: string | null; state: string | null; exit: string | null; storeNumber: string | null;
  detourMiles: number; gallons: number; netPrice: number | null; priceAgeHours: number | null;
  cost: number | null; arrivalGal: number; isEmergency: boolean;
  coversBreak: boolean; isOvernight: boolean; driveHoursLeftOnArrival: number | null;
}
export type PlanResultStatus = "ok" | "emergency_used" | "infeasible" | "routing_unavailable" | "no_stations" | "telematics_unavailable" | "error";
export interface PlanResult {
  status: PlanResultStatus;
  message?: string;
  plan?: {
    stops: PlanStopView[]; totalGallons: number; totalCost: number | null; savingsVsNaive: number | null;
    arrivalFuelPct: number | null; reachesDestination: boolean; flags: string[];
  };
  route?: { distanceMiles: number; durationHours: number; polyline: { lat: number; lng: number }[]; directions: { instruction: string; miles: number }[] };
  truck?: {
    fuelPct: number | null;
    gallonsOnHand: number | null;
    tankCapacityGal: number;
    driveRemainingHours: number | null;
    breakInHours: number | null;
    shiftRemainingHours: number | null;
    cycleRemainingHours: number | null;
    reachableMiles: number | null;
    fuelRangeMiles: number | null;
  };
  breakAdvice?: { breakDueMiles: number | null; breakDueHours: number | null; coincidesStopIndex: number | null; savesMinutes: number };
  origin?: { lat: number; lng: number };
  destination?: { lat: number; lng: number };
}

/** HERE hazmat classes (audit-confirmed) with friendly labels for the dispatcher form. */
export const HAZMAT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "explosive", label: "Explosive" },
  { value: "gas", label: "Gas" },
  { value: "flammable", label: "Flammable" },
  { value: "combustible", label: "Combustible" },
  { value: "organic", label: "Organic" },
  { value: "poison", label: "Poison" },
  { value: "radioactive", label: "Radioactive" },
  { value: "corrosive", label: "Corrosive" },
  { value: "poisonousInhalation", label: "Poison (inhalation)" },
  { value: "harmfulToWater", label: "Harmful to water" },
  { value: "other", label: "Other" },
];

/** HERE ADR tunnel category (B least → E most restrictive). Relevant for hazmat loads through tunnels. */
export const TUNNEL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Not restricted" },
  { value: "B", label: "B" },
  { value: "C", label: "C" },
  { value: "D", label: "D" },
  { value: "E", label: "E" },
];

export interface AddressSuggestion { label: string; lat: number; lng: number }

/** Address autocomplete via our server-proxied geocoder (keeps the geocoder key/rate off the browser). */
export async function fetchAddressSuggestions(q: string): Promise<AddressSuggestion[]> {
  const res = await apiFetch<{ suggestions: AddressSuggestion[] }>(`/api/fueling/geocode-suggest?q=${encodeURIComponent(q)}`);
  return res.ok && res.data ? res.data.suggestions : [];
}

export interface VehicleLocation { lat: number; lng: number; time: string | null; label: string | null }
/** Current GPS of a vehicle from Samsara (reverse-geocoded). Null if unavailable. */
export async function fetchVehicleLocation(vehicleId: string): Promise<VehicleLocation | null> {
  const res = await apiFetch<VehicleLocation>(`/api/fueling/vehicle-location?vehicleId=${encodeURIComponent(vehicleId)}`);
  return res.ok && res.data ? res.data : null;
}

/** Whether an interactive HERE tile map is available (key configured server-side). Falls back to false. */
export async function fetchMapConfig(): Promise<boolean> {
  const res = await apiFetch<{ tilesEnabled: boolean }>("/api/fueling/map-config");
  return res.ok && res.data ? res.data.tilesEnabled : false;
}

/** On-demand smart-fuel plan for one truck + route (read-only). */
export function useFuelPlan() {
  return useMutation({
    mutationFn: async (req: PlanRequest): Promise<PlanResult> => {
      const res = await apiFetch<PlanResult>("/api/fueling/plan", { method: "POST", body: req });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not generate a plan");
      return res.data;
    },
  });
}
