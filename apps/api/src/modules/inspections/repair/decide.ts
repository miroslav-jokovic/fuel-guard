import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoadsideRepairDecision } from "@silvicom/shared";
import { writeAudit } from "../../../lib/audit.js";
import { REPAIR_COLS, latestByUnit, type RepairRow } from "../read/inspectionRepairs.js";
import type { DbError } from "../read/inspectionsList.js";

/**
 * Maintenance names THE repair of an inspected unit (IC11, D-IC14; Q-IC13: maintenance accepts, safety
 * certifies). The engine only proposes (Q-IC14, measured 2026-10-16: one-in-the-window is 38%), so this is
 * the row that says which work order closed the violations — or that the repair was done outside FleetPal,
 * and where.
 *
 * ── A DECISION RESTATES THE PROPOSAL IT WAS MADE OVER ──────────────────────────────────────────
 * `inspection_repairs` is append-only (0482). The person's row copies the engine's latest candidates and
 * due day, so it says on its own what the person was shown; an accepted work order must be one of those
 * candidates — a work order the proposal did not list is not one the page could have offered.
 *
 * ── TWO PEOPLE NEVER OVERWRITE EACH OTHER UNSEEN ───────────────────────────────────────────────
 * `basedOn` is the unit's newest row as the page showed it; anything newer (a re-read when a work order
 * opened, or someone else's decision) refuses with `changed`, and the page reloads. A later decision over a
 * person's own is allowed — a correction is a new row — but only over the row the page showed.
 */

export type RepairDecideOutcome =
  | { ok: true; id: string }
  | { ok: false; status: 404 | 409 | 422; code: string; message: string }
  | { error: DbError };

const refuse = (status: 404 | 409 | 422, code: string, message: string): RepairDecideOutcome => ({ ok: false, status, code, message });

export async function decideRepair(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
  actorId: string,
  input: RoadsideRepairDecision,
): Promise<RepairDecideOutcome> {
  const rows = await admin
    .from("inspection_repairs")
    .select(REPAIR_COLS)
    .eq("org_id", orgId)
    .eq("inspection_id", inspectionId)
    .eq("inspection_unit_id", input.unitId);
  if (rows.error) return { error: rows.error };
  const latest = latestByUnit((rows.data ?? []) as RepairRow[]).get(input.unitId);
  if (!latest?.engine) return refuse(404, "not_found", "There is no repair record for that unit on this inspection.");
  if (latest.newest.id !== input.basedOn) {
    return refuse(409, "changed", "This repair has changed since the page was loaded. Reload to see it before deciding.");
  }
  const proposal = latest.engine;

  let workOrderId: string | null = null;
  if (input.action === "accept") {
    if (!proposal.candidates.some((c) => c.workOrderId === input.workOrderId)) {
      return refuse(422, "not_proposed", "That work order is not one proposed for this unit.");
    }
    workOrderId = input.workOrderId;
  }

  const { data, error } = await admin
    .from("inspection_repairs")
    .insert({
      org_id: orgId,
      inspection_id: inspectionId,
      inspection_unit_id: input.unitId,
      source: "person",
      engine_version: proposal.engine_version,
      outcome: input.action === "accept" ? "accepted" : "repaired_outside_fleetpal",
      due_on: proposal.due_on,
      candidates: proposal.candidates,
      decided_by: actorId,
      work_order_fleetpal_id: workOrderId,
      note: input.action === "outside" ? input.note : null,
    })
    .select("id")
    .single();
  if (error) return { error };

  await writeAudit(admin, {
    orgId,
    actorId,
    action: input.action === "accept" ? "roadside.repair_accepted" : "roadside.repair_outside_fleetpal",
    entity: "roadside_inspection",
    entityId: inspectionId,
    meta: {
      repairId: data.id,
      unitId: input.unitId,
      workOrderId,
      previous: { repairId: latest.newest.id, source: latest.newest.source, outcome: latest.newest.outcome },
    },
  });
  return { ok: true, id: data.id as string };
}
