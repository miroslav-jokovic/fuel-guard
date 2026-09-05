import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyDeclinedFilters,
  applyFuelLogFilters,
  fuelTxnStatus,
  matchSearchIds,
  vehicleIdsForUnits,
  type EfsListFilters,
  type FuelLogFilters,
  type FuelTransaction,
} from "@silvicom/shared";
import { pageAll, renderCsv, type CsvExport, type ExportScope } from "../../lib/csvExport.js";

/**
 * The Fuel Log's lists, as a file (FUEL-P2, D-FUI15).
 *
 * ── WHY THE SERVER RENDERS IT AND THE BROWSER DOES NOT ──────────────────────────────────────────
 * Every export in this section before P2 was `downloadCsv(rows.value)` — the rows the browser was
 * holding. On the fuel lists that is ONE PAGE of twenty out of a filtered set that reaches five
 * figures, so "truck 654's August, as a file" would have produced twenty rows and said nothing about
 * the rest. The ledger's own CSV still does exactly that today, over its 25-row page.
 *
 * So the export re-runs the query. And the only way a re-run cannot disagree with the screen is for
 * both to apply the SAME filters, which is why `applyFuelLogFilters` and `applyDeclinedFilters` moved
 * into `@silvicom/shared` rather than being written a second time here — the drift `fuelSpendReport.ts`
 * carries a scar about.
 *
 * ── THE SERVICE ROLE BYPASSES RLS ───────────────────────────────────────────────────────────────
 * Every query below carries its own `.eq("org_id", …)`. That filter is the only tenant boundary this
 * code has, and `expectOrgScoped` asserts it.
 *
 * The paging, the row ceiling and the scope line are `lib/csvExport.ts`, shared with the other module
 * that owns a fuel list (`efs_transactions` belongs to the efs collector, D-SEP1).
 */

/* ── Fills ──────────────────────────────────────────────────────────────────────────────────────── */

const FILL_COLS =
  "id, vehicle_id, driver_id, fueled_at, business_date, odometer, miles_since_last, gallons, price_per_gal, " +
  "total_cost, location_text, state, computed_mpg, has_anomaly, max_severity, ai_risk_level, " +
  "samsara_location_confidence, tank_type, case_level";

/**
 * The columns a fill exports as.
 *
 * ⚠ Not character-for-character the table's nine columns, and that is deliberate. The screen renders
 * the instant in the STATION's zone through `Intl` because that is what the EFS report printed; a
 * spreadsheet wants a date it can sort and a number it can sum. So the file carries the BUSINESS DATE
 * (the day every filter in this section means, D-FUI11) and the raw instant beside it, and adds the
 * dollars and the location the table has no room for. What must not differ — and what the export tests
 * assert — is the SET of rows and every figure in them.
 */
const FILL_HEADERS = [
  "Unit", "Business date", "Fueled at (UTC)", "Driver", "Odometer", "Miles", "Gallons",
  "$/gal", "Total cost", "MPG", "Fuel", "Status", "Location", "State",
] as const;

export interface FillExportInput {
  orgId: string;
  filters: FuelLogFilters;
  scope: ExportScope;
}

interface NamedVehicle { id: string; unit_number: string }
interface NamedDriver { id: string; full_name: string }

/** The org's fleet and roster, for the labels and for resolving what a typed search names. */
export async function readRosters(admin: SupabaseClient, orgId: string): Promise<{ vehicles: NamedVehicle[]; drivers: NamedDriver[] }> {
  const [v, d] = await Promise.all([
    admin.from("vehicles").select("id, unit_number").eq("org_id", orgId),
    admin.from("drivers").select("id, full_name").eq("org_id", orgId),
  ]);
  if (v.error) throw new Error(v.error.message);
  if (d.error) throw new Error(d.error.message);
  return { vehicles: (v.data ?? []) as NamedVehicle[], drivers: (d.data ?? []) as NamedDriver[] };
}

/**
 * Turn the page's own URL parameters into the filters the fills query takes.
 *
 * The unit numbers and the search term are resolved against the fleet HERE, exactly as the browser
 * resolves them for the screen, through the same two shared functions — so one URL produces one answer
 * whether it is opened or downloaded.
 */
export function fillFiltersFromQuery(
  q: { units: string[]; from: string | null; to: string | null; driverId: string | null; tankType: "tractor" | "reefer" | null; search: string | null },
  rosters: { vehicles: readonly NamedVehicle[]; drivers: readonly NamedDriver[] },
): FuelLogFilters {
  return {
    vehicleIds: vehicleIdsForUnits(q.units, rosters.vehicles),
    ...(q.driverId ? { driverId: q.driverId } : {}),
    ...(q.from ? { from: q.from } : {}),
    ...(q.to ? { to: q.to } : {}),
    ...(q.tankType ? { tankType: q.tankType } : {}),
    ...(q.search ? { search: q.search } : {}),
    ...matchSearchIds(q.search, rosters.vehicles, rosters.drivers),
  };
}

export async function exportFills(admin: SupabaseClient, input: FillExportInput): Promise<CsvExport> {
  // Read a second time rather than threaded through from the route: the labels below are a different
  // need from the resolution the route did, both are one cheap org-scoped read, and a roster passed as
  // an argument is a roster a caller can pass stale.
  const { vehicles, drivers } = await readRosters(admin, input.orgId);
  const unitOf = new Map(vehicles.map((v) => [v.id, v.unit_number]));
  const nameOf = new Map(drivers.map((d) => [d.id, d.full_name]));

  const rows = await pageAll<FuelTransaction & { business_date: string | null; location_text: string | null }>((from, to) =>
    applyFuelLogFilters(
      admin
        .from("fuel_transactions")
        .select(FILL_COLS, { count: "exact" })
        .eq("org_id", input.orgId)
        // `is_canonical` is what makes a row a fill rather than a duplicate — the query's identity,
        // not the reader's narrowing, which is why it is stated here and not in the shared filters.
        .eq("is_canonical", true)
        .order("business_date", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, to),
      input.filters,
    ),
  );

  return renderCsv(
    input.scope,
    FILL_HEADERS,
    rows.map((r) => [
      r.vehicle_id ? (unitOf.get(r.vehicle_id) ?? "—") : "Unattributed",
      r.business_date,
      r.fueled_at,
      r.driver_id ? (nameOf.get(r.driver_id) ?? "—") : "",
      r.odometer,
      r.miles_since_last,
      r.gallons,
      r.price_per_gal,
      r.total_cost,
      r.computed_mpg,
      r.tank_type,
      // The same verdict the Status column renders, from the same shared function — a file that
      // disagreed with the badge beside it would be worse than a file with no verdict at all.
      fuelTxnStatus(r).label,
      r.location_text,
      r.state,
    ]),
  );
}

/* ── Declines ───────────────────────────────────────────────────────────────────────────────────── */

const DECLINE_COLS =
  "id, declined_at, card_ref, invoice, location_text, city, state, unit, driver_name, error_code, " +
  "error_description, policy_name, suspicion_level";

const DECLINE_HEADERS = [
  "Unit", "Declined at (UTC)", "Risk", "Card", "Invoice", "Driver", "Location", "City", "State",
  "Error", "Description", "Policy",
] as const;

export interface DeclineExportInput {
  orgId: string;
  filters: EfsListFilters;
  scope: ExportScope;
}

export async function exportDeclines(admin: SupabaseClient, input: DeclineExportInput): Promise<CsvExport> {
  const rows = await pageAll<Record<string, unknown>>((from, to) =>
    applyDeclinedFilters(
      admin
        .from("declined_transactions")
        .select(DECLINE_COLS, { count: "exact" })
        .eq("org_id", input.orgId)
        .order("declined_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, to),
      input.filters,
    ),
  );

  return renderCsv(
    input.scope,
    DECLINE_HEADERS,
    rows.map((r) => [
      r.unit, r.declined_at, r.suspicion_level, r.card_ref, r.invoice, r.driver_name,
      r.location_text, r.city, r.state, r.error_code, r.error_description, r.policy_name,
    ]),
  );
}
