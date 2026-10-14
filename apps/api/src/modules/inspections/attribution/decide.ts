import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoadsideAttributionDecision } from "@silvicom/shared";
import { writeAudit } from "../../../lib/audit.js";
import { currentRow, readLatestAttribution } from "../read/inspectionAttribution.js";
import type { DbError } from "../read/inspectionsList.js";

/**
 * A person's decision over the engine's reading of who was driving (INSPECTION-CHALLENGE-PLAN §6's
 * "confirm" action, D-IC7: anything but one driver at high confidence goes to a person).
 *
 * ── A DECISION IS A NEW ROW THAT RESTATES THE READING IT WAS MADE OVER ─────────────────────────
 * `inspection_attributions` is append-only (0473, IA010). The person's row copies the engine's latest
 * reading column for column — its instant, its location check, Samsara's driver and the version — and
 * adds who decided, the note, and for a correction our driver. So the row says on its own what the
 * person saw when deciding, and 0473's checks hold for it exactly as they do for the engine's row.
 *
 *   confirm   stands behind the reading as it is; only a reading of ONE driver can be confirmed. The
 *             row carries no `driver_id`: the driver is Samsara's, resolved to the roster on read.
 *   correct   names one of our drivers, with a note saying what shows it was them. Naming the driver
 *             the reading already resolves to is a confirmation and is refused as a correction.
 *
 * ── TWO PEOPLE NEVER OVERWRITE EACH OTHER UNSEEN ───────────────────────────────────────────────
 * `basedOn` is the row the page showed. When it is no longer the latest (someone decided, or the
 * engine re-read at a new version), the decision is refused and the page reloads what changed.
 *
 * The audit row (plan §6 "Audit": attribution confirmation, with the actor and the previous value) is
 * written after the decision. The decision row already names its author, so an audit outage is logged
 * by `writeAudit` and does not undo it.
 */

export type DecideOutcome =
  | { ok: true; id: string }
  | { ok: false; status: 404 | 409 | 422; code: string; message: string }
  | { error: DbError };

const refuse = (status: 404 | 409 | 422, code: string, message: string): DecideOutcome => ({ ok: false, status, code, message });

export async function decideAttribution(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
  actorId: string,
  input: RoadsideAttributionDecision,
): Promise<DecideOutcome> {
  const insp = await admin
    .from("roadside_inspections")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", inspectionId)
    .is("vanished_at", null)
    .maybeSingle();
  if (insp.error) return { error: insp.error };
  if (!insp.data) return refuse(404, "not_found", "Roadside inspection not found");

  const latest = await readLatestAttribution(admin, orgId, inspectionId);
  if ("error" in latest) return latest;
  const reading = latest.engine;
  if (!reading) return refuse(409, "not_read", "Samsara has not been read for this inspection yet, so there is nothing to decide over.");
  const current = currentRow(latest)!;
  if (current.id !== input.basedOn) {
    return refuse(409, "changed", "Who was driving has changed since this page was loaded. Reload to see it before deciding.");
  }

  let driverId: string | null = null;
  if (input.action === "confirm") {
    if (reading.outcome !== "one_driver") return refuse(409, "nothing_to_confirm", "The reading names no single driver to confirm. Choose the driver instead.");
  } else {
    const d = await admin
      .from("drivers")
      .select("id, samsara_driver_id, status")
      .eq("org_id", orgId)
      .eq("id", input.driverId)
      .neq("status", "applicant")
      .maybeSingle();
    if (d.error) return { error: d.error };
    if (!d.data) return refuse(422, "unknown_driver", "That driver is not on our roster.");
    if (reading.samsara_driver_id && d.data.samsara_driver_id === reading.samsara_driver_id) {
      return refuse(422, "same_as_reading", "That is the driver the reading already names. Confirm the reading instead.");
    }
    driverId = d.data.id as string;
  }

  const { data, error } = await admin
    .from("inspection_attributions")
    .insert({
      org_id: orgId,
      inspection_id: inspectionId,
      source: "person",
      engine_version: reading.engine_version,
      zone: reading.zone,
      zone_method: reading.zone_method,
      started_at: reading.started_at,
      ended_at: reading.ended_at,
      location_check: reading.location_check,
      vehicle_id: reading.vehicle_id,
      samsara_vehicle_id: reading.samsara_vehicle_id,
      outcome: reading.outcome,
      samsara_driver_id: reading.samsara_driver_id,
      samsara_driver_name: reading.samsara_driver_name,
      basis: reading.basis,
      confidence: reading.confidence,
      candidates: reading.candidates,
      decided_by: actorId,
      driver_id: driverId,
      note: input.note ? input.note : null,
    })
    .select("id")
    .single();
  if (error) return { error };

  await writeAudit(admin, {
    orgId,
    actorId,
    action: input.action === "confirm" ? "roadside.attribution_confirmed" : "roadside.attribution_corrected",
    entity: "roadside_inspection",
    entityId: inspectionId,
    meta: {
      attributionId: data.id,
      engineVersion: reading.engine_version,
      driverId,
      samsaraDriverId: reading.samsara_driver_id,
      previous: { attributionId: current.id, source: current.source, driverId: current.driver_id, samsaraDriverId: current.samsara_driver_id },
    },
  });
  return { ok: true, id: data.id as string };
}
