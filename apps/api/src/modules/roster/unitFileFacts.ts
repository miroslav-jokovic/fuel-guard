import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged, OWNERSHIP_TYPES, type OwnershipType, type UnitSubjectType } from "@silvicom/shared";

/**
 * What a truck's or trailer's FILE needs to know about the unit itself (UNIT-FILES-PLAN UF2) — read
 * here because `vehicles` and `trailers` are this module's, and the file rollup (evidence) asks
 * through this index rather than reaching past the owner (the `maintenance -> roster` shape).
 *
 * Every unit, every status: the Vehicles and Trailers lists show retired and ordered units behind
 * their status filter, and a list cell with no file behind it would read as an empty file. Which
 * units a file is DEMANDED of is the reader's question, not this read's.
 *
 * `registration_expires_at` / `dot_annual_inspection_expires_at` are McLeod's (or the inspection
 * projection's) typed dates — the file shows them as "date only" beside an item with no paper
 * (D-UF3), never as evidence. `ownership_type` (0099/0100) decides title vs lease (D-UF11).
 */
export interface UnitFileFacts {
  id: string;
  unitNumber: string;
  status: string;
  ownership: OwnershipType | null;
  registrationExpiresAt: string | null;
  annualInspectionExpiresAt: string | null;
}

type Row = {
  id: string;
  unit_number: string;
  status: string;
  ownership_type: string | null;
  registration_expires_at: string | null;
  dot_annual_inspection_expires_at: string | null;
};

const COLUMNS = "id, unit_number, status, ownership_type, registration_expires_at, dot_annual_inspection_expires_at";

const asOwnership = (v: string | null): OwnershipType | null =>
  v !== null && (OWNERSHIP_TYPES as readonly string[]).includes(v) ? (v as OwnershipType) : null;

export async function listUnitFileFacts(
  admin: SupabaseClient,
  orgId: string,
  kind: UnitSubjectType,
): Promise<UnitFileFacts[]> {
  // Two literal `.from()` calls rather than one over a variable: a dynamic table name is invisible to
  // every string-literal gate in this repo (`lint:table-access` check 2).
  const rows = await fetchAllPaged<Row>((from, to) =>
    (kind === "tractor" ? admin.from("vehicles") : admin.from("trailers"))
      .select(COLUMNS)
      .eq("org_id", orgId)
      .order("unit_number")
      .order("id")
      .range(from, to),
  );
  return rows.map((r) => ({
    id: r.id,
    unitNumber: r.unit_number,
    status: r.status,
    ownership: asOwnership(r.ownership_type),
    registrationExpiresAt: r.registration_expires_at,
    annualInspectionExpiresAt: r.dot_annual_inspection_expires_at,
  }));
}
