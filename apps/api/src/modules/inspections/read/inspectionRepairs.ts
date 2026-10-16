import type { SupabaseClient } from "@supabase/supabase-js";
import {
  REPAIR_VIOLATION_PARTS,
  type RepairCandidate,
  type RepairEngineOutcome,
  type RepairOutcome,
  type RoadsideRepairCertificationDto,
  type RoadsideRepairDto,
} from "@silvicom/shared";
import { labelOf, memberLabels } from "../../../lib/memberLabels.js";
import { kindOf, type DbError } from "./inspectionsList.js";

/**
 * One inspection's repair record for the page's Repair card (IC11, D-IC14): per inspected unit with a
 * Part 393/396 violation, the engine's latest proposal, a person's latest decision, and the row a new
 * decision is made over. Rows are append-only (0482), so "latest" is the newest `created_at` per source.
 */

export interface RepairRow {
  id: string;
  inspection_unit_id: string;
  source: "engine" | "person";
  engine_version: string;
  outcome: RepairOutcome;
  due_on: string;
  candidates: RepairCandidate[];
  decided_by: string | null;
  work_order_fleetpal_id: string | null;
  note: string | null;
  created_at: string;
}

export const REPAIR_COLS = "id, inspection_unit_id, source, engine_version, outcome, due_on, candidates, decided_by, work_order_fleetpal_id, note, created_at";

/** The newest engine row and the newest person row of each unit, and the newest of the two. */
export function latestByUnit(rows: readonly RepairRow[]): Map<string, { engine: RepairRow | null; person: RepairRow | null; newest: RepairRow }> {
  const out = new Map<string, { engine: RepairRow | null; person: RepairRow | null; newest: RepairRow }>();
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  for (const r of sorted) {
    const cur = out.get(r.inspection_unit_id) ?? { engine: null, person: null, newest: r };
    if (r.source === "engine" && !cur.engine) cur.engine = r;
    if (r.source === "person" && !cur.person) cur.person = r;
    out.set(r.inspection_unit_id, cur);
  }
  return out;
}

export async function readInspectionRepairs(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
): Promise<RoadsideRepairDto[] | { error: DbError }> {
  const [repairs, units, violations] = await Promise.all([
    admin.from("inspection_repairs").select(REPAIR_COLS).eq("org_id", orgId).eq("inspection_id", inspectionId),
    admin.from("roadside_inspection_units").select("id, unit_seq, unit_type_id, company_number").eq("org_id", orgId).eq("inspection_id", inspectionId),
    admin
      .from("roadside_violations")
      .select("unit_id, viol_code, description")
      .eq("org_id", orgId)
      .eq("inspection_id", inspectionId)
      .is("vanished_at", null)
      .in("part_no", [...REPAIR_VIOLATION_PARTS]),
  ]);
  for (const r of [repairs, units, violations]) if (r.error) return { error: r.error };
  const rows = (repairs.data ?? []) as RepairRow[];
  if (rows.length === 0) return [];

  const unitOf = new Map(
    ((units.data ?? []) as { id: string; unit_seq: number | null; unit_type_id: string | null; company_number: string | null }[]).map((u) => [u.id, u]),
  );
  const violationsOf = new Map<string, { code: string | null; description: string | null }[]>();
  for (const v of (violations.data ?? []) as { unit_id: string | null; viol_code: string | null; description: string | null }[]) {
    if (v.unit_id) violationsOf.set(v.unit_id, [...(violationsOf.get(v.unit_id) ?? []), { code: v.viol_code, description: v.description }]);
  }
  const latest = latestByUnit(rows);
  const labels = await memberLabels(admin, orgId, [...new Set(rows.flatMap((r) => (r.decided_by ? [r.decided_by] : [])))]);

  const out: RoadsideRepairDto[] = [];
  for (const [unitId, { engine, person, newest }] of latest) {
    // A unit is shown once the engine has read it; a person's row is always over an engine reading.
    if (!engine) continue;
    const u = unitOf.get(unitId);
    out.push({
      unitId,
      unit: { seq: u?.unit_seq ?? null, kind: kindOf(u?.unit_type_id ?? null), companyNumber: u?.company_number ?? null },
      violations: violationsOf.get(unitId) ?? [],
      dueOn: engine.due_on,
      proposal: { outcome: engine.outcome as RepairEngineOutcome, candidates: engine.candidates, readAt: engine.created_at },
      decision: person
        ? {
            outcome: person.outcome as "accepted" | "repaired_outside_fleetpal",
            workOrder: person.candidates.find((c) => c.workOrderId === person.work_order_fleetpal_id) ?? null,
            note: person.note,
            decidedBy: person.decided_by ? labelOf(labels.get(person.decided_by)) : null,
            decidedAt: person.created_at,
          }
        : null,
      basedOn: newest.id,
    });
  }
  return out.sort((a, b) => (a.unit.seq ?? 99) - (b.unit.seq ?? 99));
}

/**
 * The inspection's newest certification by safety (0485, IC11 B2), and whether it still stands: `current`
 * while every unit's newest repair row is the one it certified. A later row — a re-read, a corrected
 * decision — leaves the old certification true of what it named, and asks for a new one.
 */
export async function readRepairCertification(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
): Promise<RoadsideRepairCertificationDto | null | { error: DbError }> {
  const [cert, repairs] = await Promise.all([
    admin
      .from("inspection_repair_certifications")
      .select("id, signer_name, signer_title, signed_on, repairs, document_id, created_at")
      .eq("org_id", orgId)
      .eq("inspection_id", inspectionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("inspection_repairs").select(REPAIR_COLS).eq("org_id", orgId).eq("inspection_id", inspectionId),
  ]);
  if (cert.error) return { error: cert.error };
  if (repairs.error) return { error: repairs.error };
  if (!cert.data) return null;
  const c = cert.data as { id: string; signer_name: string; signer_title: string; signed_on: string; repairs: { repairId: string }[]; document_id: string; created_at: string };
  const newest = [...latestByUnit((repairs.data ?? []) as RepairRow[]).values()].filter((l) => l.engine).map((l) => l.newest.id).sort();
  const certified = c.repairs.map((r) => r.repairId).sort();
  return {
    id: c.id,
    signerName: c.signer_name,
    signerTitle: c.signer_title,
    signedOn: c.signed_on,
    certifiedAt: c.created_at,
    documentId: c.document_id,
    current: JSON.stringify(newest) === JSON.stringify(certified),
  };
}
