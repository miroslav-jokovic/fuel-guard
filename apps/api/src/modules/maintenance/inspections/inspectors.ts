import type { SupabaseClient } from "@supabase/supabase-js";
import type { InspectorQualificationBasis } from "@silvicom/shared";

/**
 * The §396.19 inspector register (plan step A4, D-AVI6).
 *
 * ── WHY THIS IS A TABLE AND NOT A CHECKBOX ──────────────────────────────────────────────────────
 * The Keller form carries the pre-printed line "THIS INSPECTOR MEETS THE QUALIFICATION REQUIREMENTS
 * IN SECTION 396.19", and on paper the office ticks YES. That tick is a legal assertion about a
 * person, and §396.19(b) gives exactly two ways it can be true: a State or Federal training
 * programme, or a year of combined training and experience. §396.25 adds a separate one for anybody
 * who inspects brakes — which is thirteen of the catalogue's fifty-six components, so not a detail.
 *
 * So the assertion is DERIVED from a current row here and never typed. A6 refuses to finalize a
 * report whose inspector has no current qualification, which is the only thing that makes the
 * printed line worth the paper.
 *
 * The regulation also wants the underlying evidence kept for the inspector's employment plus one
 * year, which is what `evidence_document_id` and `effective_to` are for — retirement is a date, not
 * a deletion, and 0280's `on delete restrict` makes that structural rather than a convention.
 */

export interface InspectorRow {
  id: string;
  full_name: string;
  address: string | null;
  user_id: string | null;
  qualification_basis: InspectorQualificationBasis;
  brake_qualified: boolean;
  evidence_document_id: string | null;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  created_at: string;
}

const COLUMNS =
  "id, full_name, address, user_id, qualification_basis, brake_qualified, evidence_document_id, effective_from, effective_to, notes, created_at";

export interface InspectorDto extends InspectorRow {
  /** Whether §396.19 can be asserted for this person on `asOf` — derived, never stored. */
  qualified: boolean;
}

export type ServiceError = { error: string; code: string };

/**
 * Qualified on a date iff the register row covers it. Deliberately a pure comparison over the two
 * dates rather than a `status` column: a status would have to be recomputed by something, and the
 * something would eventually be a scheduler that had not run when the report was signed.
 */
export function isQualifiedOn(row: Pick<InspectorRow, "effective_from" | "effective_to">, onDate: string): boolean {
  if (onDate < row.effective_from) return false;
  return row.effective_to === null || onDate <= row.effective_to;
}

export async function listInspectors(
  admin: SupabaseClient,
  orgId: string,
  opts: { asOf: string; includeRetired?: boolean } = { asOf: new Date().toISOString().slice(0, 10) },
): Promise<InspectorDto[] | ServiceError> {
  const { data, error } = await admin
    .from("maintenance_inspectors")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .order("full_name", { ascending: true });
  if (error) return { error: "Could not load inspectors", code: "db_error" };
  const rows = (data ?? []) as InspectorRow[];
  return rows
    .map((r) => ({ ...r, qualified: isQualifiedOn(r, opts.asOf) }))
    .filter((r) => opts.includeRetired || r.qualified);
}

/** The one an inspection cites. Returns null when the person is unknown or not qualified that day. */
export async function inspectorFor(
  admin: SupabaseClient,
  orgId: string,
  inspectorId: string,
  onDate: string,
): Promise<InspectorDto | null | ServiceError> {
  const { data, error } = await admin
    .from("maintenance_inspectors")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("id", inspectorId)
    .maybeSingle();
  if (error) return { error: "Could not load inspector", code: "db_error" };
  if (!data) return null;
  const row = data as InspectorRow;
  return { ...row, qualified: isQualifiedOn(row, onDate) };
}

export interface InspectorInput {
  fullName: string;
  address?: string | null;
  userId?: string | null;
  qualificationBasis: InspectorQualificationBasis;
  brakeQualified: boolean;
  evidenceDocumentId?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  notes?: string | null;
}

export async function createInspector(
  admin: SupabaseClient,
  orgId: string,
  createdBy: string | null,
  input: InspectorInput,
): Promise<{ id: string } | ServiceError> {
  const { data, error } = await admin
    .from("maintenance_inspectors")
    .insert({
      org_id: orgId,
      full_name: input.fullName.trim(),
      address: input.address ?? null,
      user_id: input.userId ?? null,
      qualification_basis: input.qualificationBasis,
      brake_qualified: input.brakeQualified,
      evidence_document_id: input.evidenceDocumentId ?? null,
      effective_from: input.effectiveFrom,
      effective_to: input.effectiveTo ?? null,
      notes: input.notes ?? null,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error || !data) return { error: "Could not create inspector", code: "insert_failed" };
  return { id: (data as { id: string }).id };
}

/**
 * Retire an inspector, or bring one back.
 *
 * ── A RETIREMENT IS A DATE, NOT A DELETION ─────────────────────────────────────────────────────
 * 0280's `on delete restrict` already makes deleting somebody who has signed a report impossible,
 * and that is deliberate: §396.21(a)(1) requires the report to identify who performed the
 * inspection, so a report whose inspector vanished no longer says what it must. §396.19 also wants
 * the qualification evidence kept for employment plus one year, which needs the row to still exist.
 *
 * So `effective_to` is the whole mechanism. It closes the window in which this person could be
 * chosen for a NEW inspection and changes nothing about the reports they already signed — those
 * asserted a qualification that was current on the day, and still did.
 */
export async function setInspectorPeriod(
  admin: SupabaseClient,
  orgId: string,
  inspectorId: string,
  effectiveTo: string | null,
): Promise<{ ok: true } | ServiceError> {
  const { error, count } = await admin
    .from("maintenance_inspectors")
    .update({ effective_to: effectiveTo }, { count: "exact" })
    .eq("org_id", orgId)
    .eq("id", inspectorId);
  if (error) return { error: "Could not update the inspector", code: "update_failed" };
  if (!count) return { error: "Inspector not found", code: "not_found" };
  return { ok: true };
}
