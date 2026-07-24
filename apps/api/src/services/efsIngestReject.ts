/** Reject (decline) report ingest — split from efsIngest.ts (file-size budget); behaviour unchanged
 * except WP1 D2/D3: declines are attributed to a vehicle/driver at ingest (same tolerant matcher as
 * fuel lines) and optional EFS alert fields are captured when a variant carries them. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRejectRows, attributeDeclinedRow } from "@fuelguard/shared";
import type { Env } from "../env.js";
import {
  emptyResult, existingRefs, countByImport, createImport, dateSpan, countByDay, computeShortfall,
} from "./efsIngestShared.js";
import type { IngestInput, IngestResult } from "./efsIngestShared.js";
import type { IngestDeps } from "./efsIngest.js";

export async function ingestReject(
  admin: SupabaseClient,
  env: Env,
  input: IngestInput,
  deps: IngestDeps,
  vehicles: unknown[],
  drivers: unknown[],
): Promise<IngestResult> {
  const { declined, skipped } = normalizeRejectRows(input.rows);
  const seen = await existingRefs(admin, "declined_transactions", declined.map((d) => d.external_ref));
  const newDeclined = declined.filter((d) => !seen.has(d.external_ref));
  const span = dateSpan(declined.map((d) => d.declined_at));
  const rowsByDay = countByDay(declined.map((d) => d.declined_at));

  const importId = await createImport(
    admin,
    {
      org_id: input.orgId,
      source: input.source,
      kind: "reject",
      filename: input.filename,
      status: "completed",
      total_rows: input.rows.length,
      inserted_rows: newDeclined.length,
      duplicate_rows: declined.length - newDeclined.length,
      skipped_rows: skipped.length,
      created_by: input.requestedBy,
    },
    input.fileHash,
  );

  let scoreError: string | null = null;
  if (newDeclined.length) {
    // WP1 D2 — attribute each decline to a vehicle (pump Unit) + driver (EFS Driver ID, else name)
    // with the same tolerant/never-guess matcher as fuel lines. This is what makes the decline
    // location check (declinedScoring) actually run — the columns existed since 0007 but were never set.
    const declinedRows = newDeclined.map((d) => {
      const attr = attributeDeclinedRow(
        d,
        vehicles as { id: string; unit_number: string }[],
        drivers as { id: string; full_name: string; efs_driver_id?: string | null }[],
      );
      return {
        org_id: input.orgId,
        import_id: importId,
        declined_at: d.declined_at,
        card_ref: d.card_ref,
        invoice: d.invoice,
        location_id: d.location_id,
        unit: d.unit,
        vehicle_id: attr.vehicle_id,
        driver_ext_id: d.driver_ext_id,
        driver_id: attr.driver_id,
        driver_name: d.driver_name,
        location_text: d.location_text,
        city: d.city,
        state: d.state,
        error_code: d.error_code,
        error_description: d.error_description,
        policy: d.policy,
        policy_name: d.policy_name,
        // WP1 D3 — optional EFS alert fields (null for the standard reject export).
        card_assigned_unit: d.card_assigned_unit,
        efs_proximity_miles: d.efs_proximity_miles,
        efs_truck_position_at: d.efs_truck_position_at,
        external_ref: d.external_ref,
      };
    });
    const { error } = await admin
      .from("declined_transactions")
      .upsert(declinedRows, { onConflict: "org_id,external_ref", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    try {
      await deps.scoreDeclined(admin, env, input.orgId, importId);
    } catch (e) {
      scoreError = e instanceof Error ? e.message : String(e);
    }
  }

  const dbDeclined = await countByImport(admin, "declined_transactions", importId);
  const shortfallRows = computeShortfall(newDeclined.length, dbDeclined);

  await admin
    .from("imports")
    .update({
      summary: {
        channel: input.channel ?? "auto",
        report_from: span.from,
        report_to: span.to,
        rows_by_day: rowsByDay,
        expected_new_declines: newDeclined.length,
        db_declines: dbDeclined,
        shortfall_declines: shortfallRows,
        score_error: scoreError,
      },
    })
    .eq("id", importId);

  return {
    ...emptyResult("reject"),
    importId,
    newDeclined: newDeclined.length,
    duplicateDeclined: declined.length - newDeclined.length,
    skipped: skipped.length,
    reportFrom: span.from,
    reportTo: span.to,
    shortfallRows,
    scoreError,
  };
}
