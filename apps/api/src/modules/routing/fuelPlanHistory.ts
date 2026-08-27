import type { SupabaseClient } from "@supabase/supabase-js";
import { planFuelRoute, type PlanRequest } from "./fuelPlanning.js";

/**
 * Persist one generated plan to fuel_plans for the Fuel Planning "History" tab. Only real plans (a route was
 * computed AND an itinerary produced) are saved; failed/aborted attempts are not. Denormalizes the creator
 * email + truck unit number so the list is a single cheap select. Best-effort: the caller ignores errors so a
 * history write never blocks the plan response.
 */
export async function saveFuelPlanHistory(
  admin: SupabaseClient,
  orgId: string,
  userId: string | null,
  req: PlanRequest,
  result: Awaited<ReturnType<typeof planFuelRoute>>,
): Promise<void> {
  if (!result.plan || !result.route) return;
  const pointText = (p: PlanRequest["origin"] | undefined): string | null =>
    p?.text ? p.text : p?.lat != null && p?.lng != null ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : null;

  let createdByLabel: string | null = null;
  if (userId) {
    const { data } = await admin.auth.admin.getUserById(userId);
    createdByLabel = data?.user?.email ?? null;
  }
  let unitNumber: string | null = null;
  if (req.vehicleId) {
    const { data } = await admin.from("vehicles").select("unit_number").eq("id", req.vehicleId).eq("org_id", orgId).maybeSingle();
    unitNumber = (data as { unit_number?: string } | null)?.unit_number ?? null;
  }

  await admin.from("fuel_plans").insert({
    org_id: orgId,
    created_by: userId,
    created_by_label: createdByLabel,
    vehicle_id: req.vehicleId ?? null,
    unit_number: unitNumber,
    origin_label: req.originLabel ?? pointText(req.origin),
    destination_label: req.destinationLabel ?? pointText(req.destination),
    distance_miles: result.route?.distanceMiles ?? null,
    duration_hours: result.route?.durationHours ?? null,
    status: result.status,
    stop_count: result.plan?.stops.length ?? 0,
    total_gallons: result.plan?.totalGallons ?? null,
    total_cost: result.plan?.totalCost ?? null,
    arrival_fuel_pct: result.plan?.arrivalFuelPct ?? null,
    plan: result,
  });
}
