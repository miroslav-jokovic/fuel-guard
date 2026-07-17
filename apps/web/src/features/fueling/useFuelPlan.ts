import { useMutation } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

export interface PlanPoint { lat?: number | null; lng?: number | null; text?: string | null }
export interface PlanRequest {
  vehicleId: string;
  origin: PlanPoint;
  destination: PlanPoint;
  waypoints?: PlanPoint[];
  loadGrossLb?: number | null;
  equipmentType?: string | null;
  hazmat?: string[];
  tunnelCategory?: string | null;
  manualFuelPct?: number | null;
  manualHos?: { driveHours?: number | null; breakHours?: number | null; shiftHours?: number | null; cycleHours?: number | null } | null;
}

export type TelematicsReason = "not_linked" | "not_connected" | "unavailable" | "no_fuel_reading";
export interface PlanStopView {
  kind: "fuel" | "rest";
  milesAhead: number;
  stationLat: number | null; stationLng: number | null;
  stationName: string | null; brand: string | null; state: string | null; exit: string | null; storeNumber: string | null;
  detourMiles: number; gallons: number; netPrice: number | null; priceAgeHours: number | null;
  cost: number | null; arrivalGal: number; isEmergency: boolean;
  coversBreak: boolean; isOvernight: boolean; driveHoursLeftOnArrival: number | null;
  isBorderTopOff: boolean;
  borderState: string | null;
  isMinFill: boolean;
  priceEstimated: boolean;
  priceConfidence: "high" | "medium" | "low" | null;
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
  telematicsReason?: TelematicsReason;
  manualFuelUsed?: boolean;
  origin?: { lat: number; lng: number };
  destination?: { lat: number; lng: number };
}

/** HERE hazmat classes (audit-confirmed) with friendly labels for the dispatcher form. */
export const HAZMAT_OPTIONS: { value: string; label: string }[] = [
  { value: "explosive", label: "Class 1 — Explosives" },
  { value: "gas", label: "Class 2 — Gases" },
  { value: "flammable", label: "Class 3 — Flammable liquids" },
  { value: "combustible", label: "Combustible liquids" },
  { value: "organic", label: "Class 5 — Oxidizer / Organic peroxide" },
  { value: "poison", label: "Class 6.1 — Poison / Toxic" },
  { value: "poisonousInhalation", label: "Poison Inhalation Hazard (PIH)" },
  { value: "radioactive", label: "Class 7 — Radioactive" },
  { value: "corrosive", label: "Class 8 — Corrosive" },
  { value: "harmfulToWater", label: "Class 9 — Environmentally hazardous / marine pollutant" },
  { value: "other", label: "Other placarded material" },
];

/** HERE ADR tunnel category (B least → E most restrictive). Relevant for hazmat loads through tunnels. */
export const TUNNEL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "None / US route (leave blank)" },
  { value: "B", label: "B — most restrictive (EU tunnels)" },
  { value: "C", label: "C (EU tunnels)" },
  { value: "D", label: "D (EU tunnels)" },
  { value: "E", label: "E — least restrictive (EU tunnels)" },
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
