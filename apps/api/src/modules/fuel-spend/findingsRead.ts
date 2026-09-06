import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FINDING_ASSIGNABLE_SECTIONS,
  anomalyStatusesIn,
  byOccurredDesc,
  canViewSection,
  exceptionStatusesIn,
  findingFromAnomaly,
  findingFromException,
  type AppSection,
  type FindingQueueState,
  type FindingRow,
  type UserRole,
} from "@silvicom/shared";

/**
 * One inbox over two case tables (C7b).
 *
 * ── WHY THIS READS BOTH AND MERGES IN MEMORY ────────────────────────────────────────────────────
 * D-FX2 keeps the tables apart and C7a maps them onto one axis; somewhere the two have to meet, and
 * this is that place. A database view would be the other option and is refused for the reason D-FX2
 * gives: the two rows genuinely differ, and a view would have to null-pad one of them into the
 * other's shape, which is the flattening D-FUI7 forbids expressed in SQL instead of TypeScript.
 *
 * ⚠ THE COST IS BOUNDED AND MEASURED, NOT ASSUMED. Merging in memory means fetching before slicing,
 * so it is only honest while a carrier's whole finding set fits in one read. Measured 2026-09-06:
 * 82 open anomalies and 77 ledger rows, 159 in total. `READ_CAP` is 500 per source — comfortably
 * above that and comfortably below PostgREST's own 1,000-row ceiling, which silently truncates and
 * is the trap this repo has already paid for once. When a source hits the cap the response says so
 * in `truncated` rather than quietly showing a short list, because a queue that is missing rows and
 * does not say so is worse than one that refuses to load.
 */
const READ_CAP = 500;

export interface FindingsFilters {
  /** Queue states to include. Empty means every state. */
  states?: FindingQueueState[];
  /**
   * Vehicle IDS, which is what every other fuel surface sends (`useSpendFilters`). Resolved ONCE
   * here into the unit numbers the ledger stores and the ids the anomaly feed stores, because those
   * two tables disagree about how to name a truck and the caller should not have to know that.
   */
  vehicleIds?: string[] | null;
  from?: string | null;
  to?: string | null;
  assignedTo?: string | null;
  limit?: number;
  offset?: number;
}

export interface FindingsPage {
  rows: FindingRow[];
  total: number;
  /** True when a source hit `READ_CAP` and this page may be missing findings. */
  truncated: boolean;
}

/**
 * The sections this caller may see findings in.
 *
 * Q-FUI1's ruling made concrete: the inbox lives in Fuel and each kind carries its own section, so a
 * `safety` row is filtered out for anyone without `safety`. The accountant and the dispatcher see
 * policy findings; the safety manager sees theft cases; admin and fleet_manager see both. Derived
 * from the matrix — there is no list of roles here and there must never be one.
 */
export const visibleSections = (role: UserRole | null | undefined): AppSection[] =>
  FINDING_ASSIGNABLE_SECTIONS.filter((s) => canViewSection(role, s));

export async function readFindings(
  admin: SupabaseClient,
  orgId: string,
  role: UserRole | null | undefined,
  f: FindingsFilters = {},
): Promise<FindingsPage> {
  const sections = new Set(visibleSections(role));
  const states = f.states?.length ? f.states : (["open", "investigating", "working", "closed"] as FindingQueueState[]);

  // Each source is asked only for the statuses the requested queue states cover, translated through
  // C7a rather than restated here — which is the whole reason that module maps back as well as forth.
  const anomalyStatuses = [...new Set(states.flatMap((s) => anomalyStatusesIn(s)))];
  const exceptionStatuses = [...new Set(states.flatMap((s) => exceptionStatusesIn(s)))];

  /*
   * ⚠ `anomalies` HAS NO `unit_number`. It carries `vehicle_id`, and the ledger carries the unit
   * string, because `fuel_exceptions.vehicle_id` has never been written by anything (P3 measured
   * this and resolved it the other way for that table). So a truck filter has to be translated for
   * one source, and translating it is not optional: silently ignoring `?trucks=` for half the inbox
   * would be the exact defect P3 closed — a filter the page writes, the URL keeps, and the data
   * ignores. One roster read serves both the filter and the unit label.
   */
  const fleet = f.vehicleIds?.length ? await fleetScope(admin, orgId, f.vehicleIds) : null;

  const [anomalies, exceptions] = await Promise.all([
    sections.has("safety") && anomalyStatuses.length
      ? readAnomalies(admin, orgId, anomalyStatuses, f, fleet)
      : Promise.resolve([]),
    sections.has("fuel") && exceptionStatuses.length
      ? readExceptions(admin, orgId, exceptionStatuses, f, fleet)
      : Promise.resolve([]),
  ]);

  const merged = [...anomalies, ...exceptions].sort(byOccurredDesc);
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const offset = Math.max(f.offset ?? 0, 0);
  return {
    rows: merged.slice(offset, offset + limit),
    total: merged.length,
    truncated: anomalies.length >= READ_CAP || exceptions.length >= READ_CAP,
  };
}

/**
 * One truck filter, in both vocabularies.
 *
 * Resolved against the caller's OWN roster, so a hand-edited id cannot name another org's vehicle —
 * the same rule `unitsForVehicles` follows for the ledger's own route.
 */
async function fleetScope(
  admin: SupabaseClient,
  orgId: string,
  vehicleIds: string[],
): Promise<{ ids: string[]; units: string[]; unitOf: Map<string, string> }> {
  const { data } = await admin
    .from("vehicles")
    .select("id, unit_number")
    .eq("org_id", orgId)
    .in("id", vehicleIds);
  const rows = (data ?? []) as { id: string; unit_number: string | null }[];
  return {
    ids: rows.map((v) => v.id),
    units: rows.map((v) => v.unit_number).filter((u): u is string => Boolean(u)),
    unitOf: new Map(rows.filter((v) => v.unit_number).map((v) => [v.id, v.unit_number as string])),
  };
}

async function readAnomalies(
  admin: SupabaseClient,
  orgId: string,
  statuses: string[],
  f: FindingsFilters,
  fleet: { ids: string[]; unitOf: Map<string, string> } | null,
): Promise<FindingRow[]> {
  // A truck filter that matched no vehicle of this org must return nothing, not everything.
  if (fleet && fleet.ids.length === 0) return [];
  let q = admin
    .from("anomalies")
    // The service role bypasses RLS; this query carries its own tenant scope.
    .select("id, status, disposition, message, fueled_at, created_at, assigned_to, vehicle_id")
    .eq("org_id", orgId)
    .in("status", statuses);
  if (fleet) q = q.in("vehicle_id", fleet.ids);
  if (f.assignedTo) q = q.eq("assigned_to", f.assignedTo);
  // ⚠ `fueled_at` and not a business date — Q-FUI13 (b). Filtering the two sources on dates that mean
  // slightly different things is a known and recorded inconsistency, not one introduced here.
  if (f.from) q = q.gte("fueled_at", f.from);
  if (f.to) q = q.lte("fueled_at", `${f.to}T23:59:59.999Z`);
  const { data } = await q.order("fueled_at", { ascending: false }).limit(READ_CAP);
  const rows = (data ?? []) as (Parameters<typeof findingFromAnomaly>[0] & { vehicle_id?: string | null })[];
  return rows.map((r) => findingFromAnomaly({ ...r, unit_number: unitFor(r.vehicle_id, fleet) }));
}

async function readExceptions(
  admin: SupabaseClient,
  orgId: string,
  statuses: string[],
  f: FindingsFilters,
  fleet: { units: string[] } | null,
): Promise<FindingRow[]> {
  // Same rule as the anomaly side: a truck filter matching no vehicle returns nothing, not everything.
  if (fleet && fleet.units.length === 0) return [];
  let q = admin
    .from("fuel_exceptions")
    .select("id, kind, status, occurred_on, amount, credited_amount, unit_number, assigned_to, first_seen_at")
    .eq("org_id", orgId)
    .in("status", statuses);
  if (f.assignedTo) q = q.eq("assigned_to", f.assignedTo);
  if (fleet) q = q.in("unit_number", fleet.units);
  if (f.from) q = q.gte("occurred_on", f.from);
  if (f.to) q = q.lte("occurred_on", f.to);
  const { data } = await q.order("occurred_on", { ascending: false }).limit(READ_CAP);
  return ((data ?? []) as Parameters<typeof findingFromException>[0][]).map(findingFromException);
}

/**
 * The unit a theft case is about, when we already know it.
 *
 * Null unless a truck filter was applied, and deliberately so: labelling every anomaly would mean
 * reading the whole roster on every unfiltered page load to fill a column, and this read exists to be
 * cheap. The page shows the unit when it scoped to one and leaves it blank otherwise, which is
 * honest; C7b's surface merge can decide whether the column is worth a roster read.
 */
const unitFor = (
  vehicleId: string | null | undefined,
  fleet: { unitOf: Map<string, string> } | null,
): string | null => (vehicleId && fleet ? (fleet.unitOf.get(vehicleId) ?? null) : null);
