import type { SupabaseClient } from "@supabase/supabase-js";
import { ROADSIDE_MATCH_METHODS, type CalendarDay, type RoadsideInspectionDto, type RoadsideInspectionUnitDto } from "@silvicom/shared";

/**
 * Our roadside inspections as FMCSA records them today, newest first — the Inspections inbox's first
 * slice (INSPECTION-CHALLENGE-PLAN §6; FLEET-MANAGER-HOME-PLAN Q-FM7 (a), ruled 2026-10-13). The first
 * reader of the 0458 projection; this module owns those tables, so nothing else reads them.
 *
 * ── THE CARD COUNTS THIS LIST, IT DOES NOT QUERY BESIDE IT ─────────────────────────────────────
 * The Operations tab's Roadside card is `summarizeRoadside` over `readRoadsideInspections` with the
 * card's window, so a figure on the card is the row count of the page it opens (D-FM7/D-FM9, the
 * `shopBacklog.ts` arrangement). Reading 90 days of rows to count them is cheap: 111 on 2026-10-13.
 *
 * ── A VANISHED RECORD IS LEFT OUT, NOT DELETED ─────────────────────────────────────────────────
 * `vanished_at is null` keeps only records FMCSA still serves. An aged-out or removed one is kept in
 * the table (0458 says why) but is off the carrier's record, so it is off this list. When IC4 needs
 * removals in front of a person (a granted RDR), that is a filter of its own, not this one widened.
 *
 * ── UNITS ARE ATTACHED, NEVER JOINED INTO A GUESS ──────────────────────────────────────────────
 * Each unit carries whether the projection matched it to our roster, and nothing more: an unmatched
 * unit (about 229 measured, Q-IC8) shows as unmatched (D-IC7). The match itself is 0458's.
 */

/** PostgREST caps a response at 1,000 rows; a page this size is always answered whole. */
const PAGE = 500;
/** Ids per `.in()`: a long list overflows Node 22's request-header limit and fails as "fetch failed". */
const IN_CHUNK = 100;
export const MATCHED: ReadonlySet<string> = new Set(ROADSIDE_MATCH_METHODS);

export type DbError = { message: string };

export interface InspectionRow {
  id: string;
  report_number: string | null;
  report_state: string | null;
  inspection_date: string | null;
  level: number | null;
  location_desc: string | null;
  hazmat_placard_required: boolean | null;
  violations_total: number | null;
  driver_oos_total: number | null;
  vehicle_oos_total: number | null;
  hazmat_oos_total: number | null;
}
interface UnitRow {
  inspection_id: string;
  unit_seq: number | null;
  unit_type_id: string | null;
  company_number: string | null;
  plate: string | null;
  plate_state: string | null;
  match_method: string;
}

export const INSPECTION_COLS =
  "id, report_number, report_state, inspection_date, level, location_desc, hazmat_placard_required, " +
  "violations_total, driver_oos_total, vehicle_oos_total, hazmat_oos_total";

export const kindOf = (typeId: string | null): RoadsideInspectionUnitDto["kind"] =>
  typeId === "11" ? "tractor" : typeId === "9" ? "trailer" : "other";

/** The units of these inspections, by inspection, in report order. Vanished units are off, as their inspection would be. */
async function unitsByInspection(
  admin: SupabaseClient,
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, RoadsideInspectionUnitDto[]> | { error: DbError }> {
  const out = new Map<string, RoadsideInspectionUnitDto[]>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await admin
      .from("roadside_inspection_units")
      .select("inspection_id, unit_seq, unit_type_id, company_number, plate, plate_state, match_method")
      .eq("org_id", orgId)
      .is("vanished_at", null)
      .in("inspection_id", ids.slice(i, i + IN_CHUNK))
      .order("unit_seq", { ascending: true });
    if (error) return { error };
    for (const u of (data ?? []) as UnitRow[]) {
      const list = out.get(u.inspection_id) ?? [];
      list.push({
        seq: u.unit_seq,
        kind: kindOf(u.unit_type_id),
        companyNumber: u.company_number,
        plate: u.plate,
        plateState: u.plate_state,
        matched: MATCHED.has(u.match_method),
      });
      out.set(u.inspection_id, list);
    }
  }
  return out;
}

export interface ReadRoadsideOptions {
  /** First calendar day included (`inspection_date >= from`); omitted for the whole record. */
  from?: CalendarDay | null;
  /** Last calendar day included (`inspection_date <= to`); omitted for up to today. */
  to?: CalendarDay | null;
  /** Attach each inspection's units. The summary counts rows and skips the extra reads. */
  withUnits?: boolean;
}

/** The list. Errors carry the database's cause for the route to LOG, never to send. */
export async function readRoadsideInspections(
  admin: SupabaseClient,
  orgId: string,
  opts: ReadRoadsideOptions = {},
): Promise<RoadsideInspectionDto[] | { error: DbError }> {
  const rows: InspectionRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = admin.from("roadside_inspections").select(INSPECTION_COLS).eq("org_id", orgId).is("vanished_at", null);
    if (opts.from) q = q.gte("inspection_date", opts.from);
    if (opts.to) q = q.lte("inspection_date", opts.to);
    const { data, error } = await q
      .order("inspection_date", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) return { error };
    const page = (data ?? []) as unknown as InspectionRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const units = opts.withUnits ? await unitsByInspection(admin, orgId, rows.map((r) => r.id)) : null;
  if (units && "error" in units) return units;

  return rows.map((r) => ({ ...inspectionDto(r), ...(units ? { units: units.get(r.id) ?? [] } : {}) }));
}

/** One row as the list shows it; the detail read extends the same shape, so the two cannot drift. */
export function inspectionDto(r: InspectionRow): Omit<RoadsideInspectionDto, "units"> {
  return {
    id: r.id,
    reportNumber: r.report_number,
    reportState: r.report_state,
    inspectionDate: r.inspection_date,
    level: r.level,
    locationDesc: r.location_desc,
    hazmatPlacardRequired: r.hazmat_placard_required,
    violations: r.violations_total,
    driverOos: r.driver_oos_total,
    vehicleOos: r.vehicle_oos_total,
    hazmatOos: r.hazmat_oos_total,
  };
}
