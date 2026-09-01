import type { SupabaseClient } from "@supabase/supabase-js";
import { traced } from "./serviceError.js";
import {
  INSPECTION_CATALOGUE_VERSION,
  defaultInspectionItems,
  type InspectionCreateRequest,
  type InspectionItemDto,
  type InspectionPatchRequest,
  type InspectionSubjectType,
} from "@silvicom/shared";
import { getEquipmentIdentities } from "../../roster/index.js";
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
  "decal_serial, other_conditions, status, outcome, next_due_on, supersedes_id, certification_id, " +
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
  if (existing.error) return traced("createInspectionDraft.replayCheck", "db_error", "Could not start the inspection", existing.error);
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
  if (error) return traced("createInspectionDraft", "insert_failed", "Could not start the inspection", error);

  const seeded = defaultInspectionItems(input.subjectType).map((item) => ({
    org_id: orgId,
    inspection_id: input.id,
    item_key: item.key,
    result: item.result,
    source: "default" as const,
  }));
  const itemsErr = await admin.from("vehicle_inspection_items").insert(seeded);
  if (itemsErr.error) return traced("createInspectionDraft.seedItems", "insert_failed", "Could not set up the inspection's parts", itemsErr.error);
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
  if (error) return traced("getInspection", "db_error", "Could not load the inspection", error);
  if (!data) return null;

  const items = await admin
    .from("vehicle_inspection_items")
    .select("item_key, result, source, repaired_at, note")
    .eq("org_id", orgId)
    .eq("inspection_id", id)
    .order("item_key", { ascending: true });
  if (items.error) return traced("getInspection.items", "db_error", "Could not load the inspection's parts", items.error);

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

/** The header fields a draft patch may move. Absent means "leave alone", null means "clear". */
const HEADER_COLUMNS: Record<string, string> = {
  inspectorId: "inspector_id",
  inspectedOn: "inspected_on",
  vehicleIdentificationMethod: "vehicle_identification_method",
  vehicleIdentificationValue: "vehicle_identification_value",
  inspectionAgencyLocation: "inspection_agency_location",
  decalSerial: "decal_serial",
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
  if (current.error) return traced("patchInspection.load", "db_error", "Could not load the inspection", current.error);
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
    if (error) return traced("patchInspection.header", "update_failed", "Could not save the inspection", error);
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
    if (error) return traced("patchInspection.items", "update_failed", "Could not save those parts", error);
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

/**
 * Correct a completed inspection by starting the report that supersedes it (D-AVI4).
 *
 * ── THE HALF OF D-AVI4 THAT WAS MISSING ────────────────────────────────────────────────────────
 * A finalized report is frozen, and the justification for freezing it was always "a correction is a
 * NEW report carrying `supersedes_id`". The column shipped in 0280 and **nothing ever wrote it**, so
 * for a week the rule was half true: an inspector who noticed a mistake could start an unrelated
 * inspection, and nothing tied it to the one it replaced. An immutability rule whose escape hatch
 * does not exist is not immutability, it is a dead end.
 *
 * The new draft is seeded from the SUPERSEDED report's answers rather than from the catalogue
 * defaults. Somebody correcting one wrong mark should not have to walk 56 rows again — and the ones
 * they do not touch are genuinely what the previous inspection found, which is the honest starting
 * point. Every seeded row keeps its original `source`, so a component the first inspector actually
 * set does not silently become a default again.
 */
export async function createCorrection(
  admin: SupabaseClient,
  orgId: string,
  supersedesId: string,
  newId: string,
  createdBy: string | null,
): Promise<{ id: string } | ServiceError> {
  const loaded = await getInspection(admin, orgId, supersedesId);
  if (loaded && "code" in loaded) return loaded;
  if (!loaded) return { error: "Inspection not found", code: "not_found" };
  if (loaded.report.status !== "final") {
    return { error: "That inspection is still in progress — edit it rather than correcting it.", code: "not_final" };
  }

  const existing = await admin
    .from("vehicle_inspections")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", newId)
    .maybeSingle();
  if (existing.error) return traced("createCorrection.replayCheck", "db_error", "Could not start the correction", existing.error);
  if (existing.data) return { id: newId };

  const prior = loaded.report;
  const { error } = await admin.from("vehicle_inspections").insert({
    id: newId,
    org_id: orgId,
    subject_type: prior.subject_type,
    subject_id: prior.subject_id,
    inspector_id: prior.inspector_id,
    // Today, not the superseded date: this is a new inspection of the vehicle, and back-dating it to
    // the report it replaces would put two inspections on one day and make the expiry ambiguous.
    inspected_on: new Date().toISOString().slice(0, 10),
    catalogue_version: INSPECTION_CATALOGUE_VERSION,
    vehicle_identification_method: prior.vehicle_identification_method ?? "vin",
    vehicle_identification_value: prior.vehicle_identification_value ?? null,
    supersedes_id: supersedesId,
    created_by: createdBy,
  });
  if (error) return traced("createCorrection", "insert_failed", "Could not start the correction", error);

  const seeded = loaded.items.map((i) => ({
    org_id: orgId,
    inspection_id: newId,
    item_key: i.key,
    result: i.result,
    source: i.source,
    repaired_at: i.repairedAt,
    note: i.note,
  }));
  const itemsErr = await admin.from("vehicle_inspection_items").insert(seeded);
  if (itemsErr.error) return traced("createCorrection.seedItems", "insert_failed", "Could not copy the previous answers", itemsErr.error);
  return { id: newId };
}

/**
 * Discard a draft.
 *
 * ── DRAFTS ONLY, AND THE GUARD IS HERE BECAUSE RLS CANNOT BE ───────────────────────────────────
 * `vehicle_inspections` has no DELETE policy, which stops a client — but the API reads with the
 * service role and bypasses RLS, so this function is the only thing between a mis-typed id and a
 * deleted §396.21 record. A finalized report is evidence and is pinned in `RETENTION_FORBIDDEN`;
 * the same argument that keeps `documents` and `certifications` deletable only as an explicit,
 * audited service-role act applies here, and a route is not that.
 *
 * A trigger would be the belt to this braces, and is deliberately NOT added: `org_id` cascades from
 * `organizations`, so a BEFORE DELETE that raised would make deleting an organisation impossible —
 * the same reason the other evidence tables rely on policy and discipline rather than a trigger.
 */
export async function discardDraft(
  admin: SupabaseClient,
  orgId: string,
  id: string,
): Promise<{ ok: true } | ServiceError> {
  const current = await admin
    .from("vehicle_inspections")
    .select("id, status")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (current.error) return traced("discardDraft.load", "db_error", "Could not load the inspection", current.error);
  if (!current.data) return { error: "Inspection not found", code: "not_found" };
  if ((current.data as { status: string }).status === "final") {
    return {
      error: "A completed inspection is a record and cannot be deleted. Record a correction instead.",
      code: "already_final",
    };
  }
  // Items go with it through 0280's `on delete cascade`.
  const { error } = await admin
    .from("vehicle_inspections")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id)
    .eq("status", "draft");
  if (error) return traced("discardDraft", "delete_failed", "Could not discard the inspection", error);
  return { ok: true };
}
