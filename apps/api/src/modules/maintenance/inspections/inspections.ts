import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INSPECTION_CATALOGUE_VERSION,
  defaultInspectionItems,
  type InspectionCreateRequest,
  type InspectionItemDto,
  type InspectionPatchRequest,
  type InspectionSubjectType,
} from "@silvicom/shared";
import type { ServiceError } from "./inspectors.js";

/**
 * The §396.17 inspection draft lifecycle (plan step A4). Create, read, list, patch — no finalize,
 * no PDF; those are A6.
 *
 * ── EVERY QUERY ORG-FILTERS ITSELF ──────────────────────────────────────────────────────────────
 * The API reads with the service role, which BYPASSES RLS (docs/ARCHITECTURE.md §3), so the `.eq`
 * on `org_id` in each call below is the actual tenancy boundary and not a belt-and-braces extra.
 * `expectOrgScoped` in the test suite asserts it per query rather than by review.
 *
 * ── A DRAFT IS SEEDED COMPLETE, WHICH IS WHAT MAKES D-AVI5 AFFORDABLE ───────────────────────────
 * Creating a report writes all 56 component rows at once, each at the catalogue's opening answer for
 * that kind of equipment (D-AVI13). So "every component must have a result before finalize" costs
 * the inspector nothing — the form opens satisfied and they change what they find — while the rule
 * itself is still enforced against the payload rather than against the screen.
 */

const REPORT_COLUMNS =
  "id, org_id, subject_type, subject_id, inspector_id, inspected_on, catalogue_version, " +
  "vehicle_identification_method, vehicle_identification_value, inspection_agency_location, " +
  "stock_serial, other_conditions, status, outcome, next_due_on, supersedes_id, certification_id, " +
  "document_id, finalized_at, created_at";

interface ReportRow {
  id: string;
  subject_type: InspectionSubjectType;
  subject_id: string;
  inspector_id: string;
  inspected_on: string;
  status: "draft" | "final";
  [k: string]: unknown;
}

interface ItemRow {
  item_key: string;
  result: "ok" | "needs_repair" | "na";
  source: "default" | "inspector";
  repaired_at: string | null;
  note: string | null;
}

/**
 * Create the draft and seed its components in one insert each.
 *
 * The id is CLIENT-generated, so a retried submit replays onto the same row instead of producing a
 * second report for the same inspection — the `documents`/`certifications` pattern. A replay is
 * answered with the existing report rather than an error, because from the caller's side the
 * request succeeded either way.
 */
export async function createInspectionDraft(
  admin: SupabaseClient,
  orgId: string,
  createdBy: string | null,
  input: InspectionCreateRequest,
): Promise<{ id: string; replayed: boolean } | ServiceError> {
  const existing = await admin
    .from("vehicle_inspections")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", input.id)
    .maybeSingle();
  if (existing.error) return { error: "Could not create inspection", code: "db_error" };
  if (existing.data) return { id: input.id, replayed: true };

  const { error } = await admin.from("vehicle_inspections").insert({
    id: input.id,
    org_id: orgId,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    inspector_id: input.inspectorId,
    inspected_on: input.inspectedOn,
    catalogue_version: INSPECTION_CATALOGUE_VERSION,
    created_by: createdBy,
  });
  if (error) return { error: "Could not create inspection", code: "insert_failed" };

  const seeded = defaultInspectionItems(input.subjectType).map((item) => ({
    org_id: orgId,
    inspection_id: input.id,
    item_key: item.key,
    result: item.result,
    source: "default" as const,
  }));
  const itemsErr = await admin.from("vehicle_inspection_items").insert(seeded);
  if (itemsErr.error) return { error: "Could not seed inspection components", code: "insert_failed" };
  return { id: input.id, replayed: false };
}

export async function getInspection(
  admin: SupabaseClient,
  orgId: string,
  id: string,
): Promise<{ report: ReportRow; items: InspectionItemDto[] } | null | ServiceError> {
  const { data, error } = await admin
    .from("vehicle_inspections")
    .select(REPORT_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: "Could not load inspection", code: "db_error" };
  if (!data) return null;

  const items = await admin
    .from("vehicle_inspection_items")
    .select("item_key, result, source, repaired_at, note")
    .eq("org_id", orgId)
    .eq("inspection_id", id)
    .order("item_key", { ascending: true });
  if (items.error) return { error: "Could not load inspection components", code: "db_error" };

  return {
    report: data as unknown as ReportRow,
    items: ((items.data ?? []) as ItemRow[]).map((i) => ({
      key: i.item_key,
      result: i.result,
      source: i.source,
      repairedAt: i.repaired_at,
      note: i.note,
    })),
  };
}

export interface InspectionFilter {
  subjectType?: InspectionSubjectType;
  subjectId?: string;
  status?: "draft" | "final";
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export async function listInspections(
  admin: SupabaseClient,
  orgId: string,
  filter: InspectionFilter,
): Promise<{ rows: ReportRow[]; total: number } | ServiceError> {
  let query = admin
    .from("vehicle_inspections")
    .select(REPORT_COLUMNS, { count: "exact" })
    .eq("org_id", orgId);
  if (filter.subjectType) query = query.eq("subject_type", filter.subjectType);
  if (filter.subjectId) query = query.eq("subject_id", filter.subjectId);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.from) query = query.gte("inspected_on", filter.from);
  if (filter.to) query = query.lte("inspected_on", filter.to);

  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  const { data, error, count } = await query
    .order("inspected_on", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return { error: "Could not list inspections", code: "db_error" };
  return { rows: (data ?? []) as unknown as ReportRow[], total: count ?? 0 };
}

/** The header fields a draft patch may move. Absent means "leave alone", null means "clear". */
const HEADER_COLUMNS: Record<string, string> = {
  inspectorId: "inspector_id",
  inspectedOn: "inspected_on",
  vehicleIdentificationMethod: "vehicle_identification_method",
  vehicleIdentificationValue: "vehicle_identification_value",
  inspectionAgencyLocation: "inspection_agency_location",
  stockSerial: "stock_serial",
  otherConditions: "other_conditions",
};

/**
 * Patch a draft. Refuses a finalized report — and the database refuses it a second time (0280's
 * trigger), which is deliberate: this check produces a useful 409 and the trigger is what holds when
 * a future caller forgets to ask.
 *
 * ── WHY THE COMPONENTS ARE GROUPED UPDATES AND NOT AN UPSERT ────────────────────────────────────
 * The rows already exist — a draft is seeded complete — so this is an UPDATE, which is also what the
 * repo's upsert rule requires: `.upsert()` with a partial payload has Postgres check NOT NULL before
 * conflict arbitration (`lint:upserts`). Patched components are grouped by their (result, repairedAt,
 * note) tuple so a realistic save — "these three failed" — is one statement rather than three.
 *
 * ── AND WHY THE CALLER IS HANDED THE WHOLE REPORT BACK ──────────────────────────────────────────
 * The groups are separate statements, so a failure part-way through leaves some components moved and
 * some not. Rather than pretend otherwise, every patch answers with the report as the DATABASE now
 * holds it: the client's state becomes DB truth on every save, so a lost write shows up immediately
 * instead of living on in a form that believes it saved. On a compliance record that difference
 * matters more than the round trip it costs.
 */
export async function patchInspection(
  admin: SupabaseClient,
  orgId: string,
  id: string,
  patch: InspectionPatchRequest,
): Promise<{ ok: true } | ServiceError> {
  const current = await admin
    .from("vehicle_inspections")
    .select("id, status")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (current.error) return { error: "Could not load inspection", code: "db_error" };
  if (!current.data) return { error: "Inspection not found", code: "not_found" };
  if ((current.data as { status: string }).status === "final") {
    return {
      error: "A finalized inspection is evidence and cannot be edited. Record a new inspection instead.",
      code: "already_final",
    };
  }

  const header: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(HEADER_COLUMNS)) {
    if (field in patch) header[column] = (patch as Record<string, unknown>)[field];
  }
  if (Object.keys(header).length > 0) {
    const { error } = await admin
      .from("vehicle_inspections")
      .update(header)
      .eq("org_id", orgId)
      .eq("id", id);
    if (error) return { error: "Could not update inspection", code: "update_failed" };
  }

  for (const [, group] of groupItems(patch.items ?? [])) {
    const { error } = await admin
      .from("vehicle_inspection_items")
      .update({
        result: group.result,
        repaired_at: group.repairedAt ?? null,
        note: group.note ?? null,
        // Every patched component is the inspector's answer by definition — this is the endpoint a
        // person's edit arrives through. Only the seed writes `default` (D-AVI13).
        source: "inspector",
      })
      .eq("org_id", orgId)
      .eq("inspection_id", id)
      .in("item_key", group.keys);
    if (error) return { error: "Could not update inspection components", code: "update_failed" };
  }
  return { ok: true };
}

interface ItemGroup {
  result: string;
  repairedAt: string | null | undefined;
  note: string | null | undefined;
  keys: string[];
}

/** Components sharing an answer become one statement. Keyed on the values, not on the order. */
function groupItems(items: NonNullable<InspectionPatchRequest["items"]>): Map<string, ItemGroup> {
  const groups = new Map<string, ItemGroup>();
  for (const item of items) {
    const key = JSON.stringify([item.result, item.repairedAt ?? null, item.note ?? null]);
    const group = groups.get(key);
    if (group) group.keys.push(item.key);
    else groups.set(key, { result: item.result, repairedAt: item.repairedAt, note: item.note, keys: [item.key] });
  }
  return groups;
}
