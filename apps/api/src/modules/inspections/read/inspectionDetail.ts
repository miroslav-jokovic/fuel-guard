import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFECT_VERIFICATION_NAMES,
  VIOLATION_CATEGORY_NAMES,
  type RoadsideInspectionDetailDto,
  type RoadsideMatchMethod,
  type RoadsideUnitDetailDto,
  type RoadsideViolationDto,
} from "@silvicom/shared";
import { INSPECTION_COLS, MATCHED, inspectionDto, kindOf, type DbError, type InspectionRow } from "./inspectionsList.js";

/**
 * One roadside inspection with its units, violations and court results — the Inspection page's first
 * slice (INSPECTION-CHALLENGE-PLAN §6), opened from a row of the list `inspectionsList.ts` reads.
 *
 * ── THE SAME RECORD THE LIST SHOWS, AND NOTHING THE LIST LEAVES OUT ────────────────────────────
 * A vanished inspection is off the list (it is no longer on the carrier's record), so it is not found
 * here either: a bookmark to one answers 404 rather than a page that reads as current. Its units,
 * violations and citations are read with the same `vanished_at is null`, so a violation FMCSA removed
 * from a live inspection (a granted DataQs request, D-IC2) is off the page as it is off the record.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────────────────────────
 * The county is a FIPS code with no name table here. (The violation category and the defect
 * verification ARE shown, named from FMCSA's data dictionary — plan Q-IC5.)
 * The driver is not on FMCSA's public record at all (attribution is IC5, D-IC7).
 */

interface DetailRow extends InspectionRow {
  start_hhmm: string | null;
  end_hhmm: string | null;
  facility: string | null;
  post_accident: boolean | null;
  shipper_name: string | null;
  gross_weight_lb: number | null;
  oos_total: number | null;
}
interface UnitRow {
  unit_seq: number | null;
  unit_type_id: string | null;
  make: string | null;
  company_number: string | null;
  plate: string | null;
  plate_state: string | null;
  vin: string | null;
  decal: boolean | null;
  vehicle_id: string | null;
  match_method: string;
}
interface ViolationRow {
  id: string;
  seq_no: number | null;
  viol_code: string | null;
  description: string | null;
  viol_unit: string | null;
  out_of_service: boolean | null;
  category_id: number | null;
  defect_verification_id: string | null;
  citation_number: string | null;
}

const DETAIL_COLS = `${INSPECTION_COLS}, start_hhmm, end_hhmm, facility, post_accident, shipper_name, gross_weight_lb, oos_total`;

/** `viol_unit` is `D` for the driver or the unit's position on the report; anything else is shown as unknown. */
function againstOf(v: string | null): RoadsideViolationDto["against"] {
  const t = v?.trim().toUpperCase();
  if (t === "D") return { driver: true };
  return t && /^[0-9]{1,3}$/.test(t) ? { unitSeq: Number(t) } : null;
}

/** A code's name from one of FMCSA's tables, its number when the table lacks it, null when blank. */
function named(table: Readonly<Record<number, string>>, code: number | string | null): string | null {
  if (code == null || String(code).trim() === "") return null;
  const n = Number(String(code).trim());
  return Number.isInteger(n) && table[n] ? table[n]! : String(code).trim();
}

const facilityOf = (f: string | null): RoadsideInspectionDetailDto["facility"] =>
  f === "F" ? "fixed" : f === "R" ? "roadside" : null;

/** The inspection, or null when this org has no current one with that id. Errors are the route's to log. */
export async function readRoadsideInspection(
  admin: SupabaseClient,
  orgId: string,
  id: string,
): Promise<RoadsideInspectionDetailDto | null | { error: DbError }> {
  const head = await admin
    .from("roadside_inspections")
    .select(DETAIL_COLS)
    .eq("org_id", orgId)
    .eq("id", id)
    .is("vanished_at", null)
    .maybeSingle();
  if (head.error) return { error: head.error };
  if (!head.data) return null;
  const r = head.data as unknown as DetailRow;

  const [units, violations, citations] = await Promise.all([
    admin
      .from("roadside_inspection_units")
      .select("unit_seq, unit_type_id, make, company_number, plate, plate_state, vin, decal, vehicle_id, match_method")
      .eq("org_id", orgId)
      .eq("inspection_id", id)
      .is("vanished_at", null)
      .order("unit_seq", { ascending: true }),
    admin
      .from("roadside_violations")
      .select("id, seq_no, viol_code, description, viol_unit, out_of_service, category_id, defect_verification_id, citation_number")
      .eq("org_id", orgId)
      .eq("inspection_id", id)
      .is("vanished_at", null)
      .order("seq_no", { ascending: true }),
    admin
      .from("roadside_citations")
      .select("violation_id, adjseq, citation_result")
      .eq("org_id", orgId)
      .eq("inspection_id", id)
      .is("vanished_at", null)
      .order("adjseq", { ascending: true }),
  ]);
  const failed = units.error ?? violations.error ?? citations.error;
  if (failed) return { error: failed };

  const results = new Map<string, string[]>();
  for (const c of (citations.data ?? []) as { violation_id: string | null; citation_result: string | null }[]) {
    if (!c.violation_id || !c.citation_result) continue;
    results.set(c.violation_id, [...(results.get(c.violation_id) ?? []), c.citation_result]);
  }

  return {
    ...inspectionDto(r),
    startTime: r.start_hhmm,
    endTime: r.end_hhmm,
    facility: facilityOf(r.facility),
    postAccident: r.post_accident,
    shipperName: r.shipper_name,
    grossWeightLb: r.gross_weight_lb,
    oosTotal: r.oos_total,
    units: ((units.data ?? []) as UnitRow[]).map(
      (u): RoadsideUnitDetailDto => ({
        seq: u.unit_seq,
        kind: kindOf(u.unit_type_id),
        companyNumber: u.company_number,
        plate: u.plate,
        plateState: u.plate_state,
        matched: MATCHED.has(u.match_method),
        make: u.make,
        vin: u.vin,
        decal: u.decal,
        matchedBy: MATCHED.has(u.match_method) ? (u.match_method as RoadsideMatchMethod) : null,
        vehicleId: u.vehicle_id,
      }),
    ),
    violationList: ((violations.data ?? []) as ViolationRow[]).map((v) => ({
      id: v.id,
      seq: v.seq_no,
      code: v.viol_code,
      description: v.description,
      against: againstOf(v.viol_unit),
      outOfService: v.out_of_service,
      category: named(VIOLATION_CATEGORY_NAMES, v.category_id),
      defectVerification: named(DEFECT_VERIFICATION_NAMES, v.defect_verification_id),
      citationNumber: v.citation_number,
      courtResults: results.get(v.id) ?? [],
    })),
  };
}
