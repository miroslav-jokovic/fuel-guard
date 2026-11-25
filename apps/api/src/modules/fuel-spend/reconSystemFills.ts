/**
 * The org's own recorded fills, projected for a reconciliation — moved out of `fuelReconRun.ts` when the
 * carry-forward (`fuelReconCarry.ts`) became its second reader, so neither imports the other.
 *
 * Every read carries its own `.eq("org_id", …)`: the service role bypasses RLS and that filter is the only
 * tenant boundary this code has (`expectOrgScoped`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { stateTimeZone, type SystemFill } from "@silvicom/shared";
import { eachPage } from "../../lib/paging.js";

/** Station-local business date — the vendor bills on it, and `fueled_at` is an instant. */
export function localBusinessDate(iso: string | null, state: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: stateTimeZone(state) ?? "UTC",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The org's recorded fills over the report's window, BOTH tanks.
 *
 * Widened a day each side on the instant, because a station-local business date can sit either side of
 * its UTC instant; the matcher filters on the business date afterwards.
 */
export async function readSystemFills(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<SystemFill[]> {
  // Unit numbers first, so a rendered row can name a truck rather than a uuid. `vehicle_id` is the
  // link; `control_id` is the DRIVER's card control and would resolve nothing.
  const { data: vehicles } = await admin.from("vehicles").select("id, unit_number").eq("org_id", orgId);
  const unitOf = new Map(
    (vehicles ?? []).map((v) => [String((v as { id: string }).id), (v as { unit_number: string | null }).unit_number]),
  );

  const out: SystemFill[] = [];
  await eachPage<Record<string, unknown>>(
    (lo, hi) =>
      admin
        .from("fuel_transactions")
        .select("id, card_ref, control_id, vehicle_id, fueled_at, gallons, total_cost, state, tank_type")
        .eq("org_id", orgId)
        .gte("fueled_at", `${addDays(from, -1)}T00:00:00.000Z`)
        .lte("fueled_at", `${addDays(to, 1)}T23:59:59.999Z`)
        .order("fueled_at", { ascending: true })
        .range(lo, hi),
    (rows) => {
      for (const raw of rows) {
        const vehicleId = raw.vehicle_id == null ? null : String(raw.vehicle_id);
        out.push({
          id: String(raw.id),
          cardRef: raw.card_ref == null ? null : String(raw.card_ref),
          controlId: raw.control_id == null ? null : String(raw.control_id),
          unit: vehicleId ? (unitOf.get(vehicleId) ?? null) : null,
          fueledAt: raw.fueled_at == null ? null : String(raw.fueled_at),
          tranDate: localBusinessDate(
            raw.fueled_at == null ? null : String(raw.fueled_at),
            raw.state == null ? null : String(raw.state),
          ),
          tank: raw.tank_type === "reefer" ? "reefer" : "tractor",
          gallons: raw.gallons == null ? 0 : Number(raw.gallons),
          totalCost: raw.total_cost == null ? null : Number(raw.total_cost),
        });
      }
    },
  );
  return out;
}
