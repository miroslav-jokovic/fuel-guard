import type { SupabaseClient } from "@supabase/supabase-js";
import { traced } from "./serviceError.js";
import type { InspectionSubjectType } from "@silvicom/shared";
import { getEquipmentIdentities } from "../../roster/index.js";
import type { ServiceError } from "./inspectors.js";
import { REPORT_COLUMNS, type ReportRow } from "./inspections.js";

/**
 * Reading the register — the list, and the two names it has to resolve to be readable.
 *
 * ── WHY IT IS ITS OWN FILE ─────────────────────────────────────────────────────────────────────
 * Split out of `inspections.ts` when that file crossed the 500-line budget (`lint:filesize`), and
 * this was the seam rather than an arbitrary cut: everything here answers ONE question — "what is on
 * the register and what does a reader need to see" — and it is the only part of the module that
 * reaches into another module's tables at all. The lifecycle file next door creates, reads one,
 * patches and discards; none of that needs any of this.
 *
 * ── THE SUBJECT IS POLYMORPHIC, SO THE JOIN IS A SECOND QUERY, ONCE (B1) ───────────────────────
 * A report points at either a tractor or a trailer, in two different tables, so PostgREST has no
 * join to offer. The unit numbers are fetched in ONE batch through `roster`'s
 * `getEquipmentIdentities` — 50 rows must not become 50 queries — and the same for inspector names.
 * Search is applied in TypeScript over the resolved page, because searching a column in another
 * module's table is not something one query can reach from here without a raw read the gates forbid.
 *
 * ── EVERY QUERY ORG-FILTERS ITSELF ─────────────────────────────────────────────────────────────
 * The API reads with the service role, which BYPASSES RLS (docs/ARCHITECTURE.md §3), so the `.eq` on
 * `org_id` below is the actual tenancy boundary. `expectOrgScoped` asserts it per query.
 */

export interface InspectionFilter {
  subjectType?: InspectionSubjectType;
  subjectId?: string;
  status?: "draft" | "final";
  outcome?: "pass" | "fail";
  /** Free text over the unit number and the decal serial — what somebody actually searches by. */
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** A list row, with the two names a reader needs instead of the two uuids the table stores. */
export interface InspectionListRow {
  id: string;
  subject_type: InspectionSubjectType;
  subject_id: string;
  unit_number: string | null;
  inspector_name: string | null;
  inspected_on: string;
  status: "draft" | "final";
  outcome: "pass" | "fail" | null;
  next_due_on: string | null;
  decal_serial: string | null;
  document_id: string | null;
}

/**
 * The list, resolved into something readable.
 *
 * ── WHY THE UNIT NUMBER IS FETCHED SEPARATELY ──────────────────────────────────────────────────
 * `subject_id` is polymorphic across `vehicles` and `trailers` (the `documents` precedent), so
 * PostgREST has no join to offer. The ids on the page are read in ONE batch through `roster`'s
 * interface rather than per row — and through the interface rather than `.from("vehicles")`,
 * because those tables are not this module's (D-ARC3).
 *
 * ── AND WHY SEARCH IS APPLIED IN TYPESCRIPT ────────────────────────────────────────────────────
 * Searching by unit number means searching a column in another module's table, which a single
 * query cannot reach from here without either a join this schema does not allow or a raw read this
 * repo's gates forbid. The page size is 50; filtering that in memory after the batch resolve is
 * honest and cheap. If it ever needs to be a database concern, it becomes an RPC that `roster`
 * owns — not a `.from("vehicles")` in this file.
 */
export async function listInspections(
  admin: SupabaseClient,
  orgId: string,
  filter: InspectionFilter,
): Promise<{ rows: InspectionListRow[]; total: number } | ServiceError> {
  let query = admin
    .from("vehicle_inspections")
    .select(REPORT_COLUMNS, { count: "exact" })
    .eq("org_id", orgId);
  if (filter.subjectType) query = query.eq("subject_type", filter.subjectType);
  if (filter.subjectId) query = query.eq("subject_id", filter.subjectId);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.outcome) query = query.eq("outcome", filter.outcome);
  if (filter.from) query = query.gte("inspected_on", filter.from);
  if (filter.to) query = query.lte("inspected_on", filter.to);

  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  const { data, error, count } = await query
    .order("inspected_on", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return traced("listInspections", "db_error", "Could not load inspections", error);

  const reports = (data ?? []) as unknown as ReportRow[];
  const inspectors = await inspectorNames(admin, orgId, reports.map((r) => r.inspector_id));
  if ("code" in inspectors) return inspectors;

  const rows: InspectionListRow[] = [];
  for (const subjectType of ["tractor", "trailer"] as const) {
    const forType = reports.filter((r) => r.subject_type === subjectType);
    if (forType.length === 0) continue;
    const units = await getEquipmentIdentities(admin, orgId, subjectType, forType.map((r) => r.subject_id));
    if ("code" in units) return { error: units.error, code: units.code };
    for (const r of forType) {
      rows.push({
        id: r.id,
        subject_type: subjectType,
        subject_id: r.subject_id,
        unit_number: units.get(r.subject_id)?.unitNumber ?? null,
        inspector_name: inspectors.get(r.inspector_id) ?? null,
        inspected_on: r.inspected_on,
        status: r.status,
        outcome: (r.outcome as "pass" | "fail" | null) ?? null,
        next_due_on: (r.next_due_on as string | null) ?? null,
        decal_serial: (r.decal_serial as string | null) ?? null,
        document_id: (r.document_id as string | null) ?? null,
      });
    }
  }
  rows.sort((a, b) => b.inspected_on.localeCompare(a.inspected_on));

  const q = filter.q?.trim().toLowerCase();
  if (!q) return { rows, total: count ?? 0 };
  const matched = rows.filter(
    (r) =>
      r.unit_number?.toLowerCase().includes(q) ||
      r.decal_serial?.toLowerCase().includes(q) ||
      r.inspector_name?.toLowerCase().includes(q),
  );
  // The count describes what the reader is looking at. Reporting the unfiltered total beside a
  // filtered list is how a page tells somebody a search found nothing when it found four.
  return { rows: matched, total: matched.length };
}

async function inspectorNames(
  admin: SupabaseClient,
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, string> | ServiceError> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await admin
    .from("maintenance_inspectors")
    .select("id, full_name")
    .eq("org_id", orgId)
    .in("id", unique);
  if (error) return traced("inspectorNames", "db_error", "Could not load inspectors", error);
  return new Map((data as Array<{ id: string; full_name: string }>).map((r) => [r.id, r.full_name]));
}
