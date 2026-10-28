import type { SupabaseClient } from "@supabase/supabase-js";
import type { UnitShopFileDto } from "@silvicom/shared";

/**
 * One truck's or trailer's identity for the shop's page (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md
 * §4.3, M3): what the header prints, the meter every PM interval is judged against, and the two
 * expiries the roster keeps. `vehicles` and `trailers` are this module's tables, so `maintenance`
 * reads them through here (D-AVI9's arrangement), as the annual inspection does.
 *
 * Both tables named as LITERALS and the branch written out twice — `equipmentInspection.ts` says why
 * a `.from(TABLE[kind])` is the tidier version every ownership gate would be blind to.
 */
export type UnitShopFacts = UnitShopFileDto["unit"];

type Row = {
  id: string;
  unit_number: string;
  year: number | null;
  make: string | null;
  model: string | null;
  plate: string | null;
  vin: string | null;
  status: string;
  current_odometer?: number | string | null;
  dot_annual_inspection_expires_at: string | null;
  registration_expires_at: string | null;
};

const COMMON = "id, unit_number, year, make, model, plate, vin, status, dot_annual_inspection_expires_at, registration_expires_at";

export async function getUnitShopFacts(admin: SupabaseClient, orgId: string, kind: "tractor" | "trailer", id: string): Promise<UnitShopFacts | null> {
  const { data, error } =
    kind === "tractor"
      ? await admin.from("vehicles").select(`${COMMON}, current_odometer`).eq("org_id", orgId).eq("id", id).maybeSingle()
      : await admin.from("trailers").select(COMMON).eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error) throw new Error(`${kind === "tractor" ? "vehicles" : "trailers"} read failed: ${error.message}`);
  if (!data) return null;
  const r = data as Row;
  // The roster's odometer is 0 until Samsara has read the truck (`fleetIdentityReads.ts` reads it the same way).
  const odometer = Number(r.current_odometer ?? 0);
  return {
    kind,
    id: r.id,
    unitNumber: r.unit_number,
    year: r.year,
    make: r.make,
    model: r.model,
    plate: r.plate,
    vin: r.vin,
    status: r.status,
    odometerMiles: kind === "tractor" && odometer > 0 ? odometer : null,
    annualInspectionExpiresOn: r.dot_annual_inspection_expires_at,
    registrationExpiresOn: r.registration_expires_at,
  };
}
