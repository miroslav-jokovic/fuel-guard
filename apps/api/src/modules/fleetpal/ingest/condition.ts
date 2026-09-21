import {
  fleetpalDefectSchema,
  fleetpalExpirationSchema,
  fleetpalIssueSchema,
  type FleetpalDefect,
  type FleetpalExpiration,
  type FleetpalIssue,
} from "@silvicom/shared";
import { FleetpalError } from "../errors.js";
import { advance, getSyncState, recordFailure } from "../syncState.js";
import type { IngestContext, IngestResult, ResourceIngest } from "./types.js";

/**
 * What is wrong with a unit: defects, issues and expirations (FLEETPAL-INTEGRATION-PLAN.md F7).
 *
 * ── ⚠ THESE THREE SIBLINGS SYNC THREE DIFFERENT WAYS, AND THE VENDOR IS WHY ───────────────────
 * `Issue` carries `updated` and watermarks like everything in F6. `Defect` and `Expiration` carry
 * **no `updated` field at all** — the vendor's own document, re-verified against the live account
 * on 2026-09-21 — and their endpoints offer `detected_after` and `expires_before` instead, which
 * are about when a thing came into existence or falls due and NOT about when it last changed.
 *
 * So there is no high-water mark to store for two of the three, and §2.7's bounded re-read applies.
 * This paragraph exists because three siblings syncing differently is precisely the shape a later
 * maintainer tidies into one — and the tidy version silently stops noticing that a defect was
 * repaired.
 */

/** An issue is ordinary: `updated` exists, so `runIngest` handles it unchanged. */
export const issuesIngest: ResourceIngest<FleetpalIssue> = {
  resource: "issues",
  path: "/v1/issues/",
  rpc: "stage_fleetpal_issues",
  schema: fleetpalIssueSchema,
  updatedOf: (row) => row.updated,
  map: (row) => ({
    fleetpal_id: row.id,
    unit_fleetpal_id: row.unit,
    name: row.name,
    description: row.description,
    priority: row.priority,
    status: row.status,
    component: row.component,
    complaint: row.complaint,
    reason_for_repair: row.reason_for_repair,
    reason_closed: row.reason_closed,
    reported: row.reported,
    vendor_created_at: row.created,
    vendor_updated_at: row.updated,
  }),
};

const mapDefect = (row: FleetpalDefect) => ({
  fleetpal_id: row.id,
  unit_fleetpal_id: row.unit,
  name: row.name,
  description: row.description,
  severity: row.severity,
  component: row.component,
  complaint: row.complaint,
  detected_on: row.detected_on,
  is_resolved: row.is_resolved,
  resolved_on: row.resolved_on,
  driver_comment: row.driver_comment,
  repair_note: row.repair_note,
  // Opaque ids no endpoint resolves (§2.10.1). Kept as evidence of how long a defect went
  // unrepaired — a defect carried across several inspections lists several of them.
  dvir_fleetpal_ids: row.dvirs,
});

/**
 * Defects: the open list in full, PLUS everything detected since the last run.
 *
 * ⚠ **Both halves are needed and neither is enough.** `is_resolved=false` alone never returns a
 * defect that was repaired between two sweeps, so our copy would show it open for ever. And
 * `detected_after` alone misses a defect detected before the window and resolved inside it — the
 * filter is about DETECTION, not about change. Together they cover: anything currently open, and
 * anything that appeared recently whatever state it is in now.
 *
 * The gap that remains, stated rather than hidden: a defect detected LONG before the last run and
 * resolved since is caught by neither half on the run after that, because it is no longer open and
 * was not detected recently. It is caught by the FIRST run after it resolves only if that run's
 * window still covers its detection date. The position written is therefore a **window**, not a
 * watermark, and the window deliberately starts a little before the last run — `OVERLAP_MS` below.
 */
const OVERLAP_MS = 24 * 60 * 60 * 1000;

export async function ingestDefects(ctx: IngestContext): Promise<IngestResult> {
  const { admin, client, orgId } = ctx;
  const resource = "defects";
  const state = await getSyncState(admin, orgId, resource);
  const lastWindowEnd = state?.windowEnd ?? null;

  try {
    const open = await client.walk("/v1/defects/", fleetpalDefectSchema, { is_resolved: "false" });
    // A day of overlap, because the two clocks are not the same clock and a defect detected in the
    // seconds around a sweep boundary must not fall between two windows. Re-reading a day of
    // defects costs one page on a fleet this size and the stage call is idempotent.
    const since = lastWindowEnd
      ? new Date(new Date(lastWindowEnd).getTime() - OVERLAP_MS).toISOString()
      : null;
    const recent = since
      ? await client.walk("/v1/defects/", fleetpalDefectSchema, { detected_after: since })
      : [];

    // The two halves overlap by construction — an open defect detected yesterday is in both — so
    // they are merged by id before staging. Staging twice would be harmless (the function is
    // idempotent) and would report a row count nobody could reconcile with the vendor's list.
    const byId = new Map<string, FleetpalDefect>();
    for (const row of [...open, ...recent]) byId.set(row.id, row);
    const rows = [...byId.values()];

    if (rows.length > 0) {
      const { error } = await admin.rpc("stage_fleetpal_defects", {
        p_org: orgId,
        p_rows: rows.map(mapDefect),
      });
      if (error) {
        await recordFailure(admin, orgId, resource, error.message);
        return { resource, fetched: rows.length, staged: 0, advancedTo: null, error: error.message };
      }
    }

    const now = new Date().toISOString();
    const moved = await advance(admin, orgId, resource, { kind: "window", to: now }, rows.length);
    if ("error" in moved) {
      return { resource, fetched: rows.length, staged: rows.length, advancedTo: null, error: moved.error };
    }
    return { resource, fetched: rows.length, staged: rows.length, advancedTo: now, error: null };
  } catch (e) {
    const message = e instanceof FleetpalError ? `${e.kind}: ${e.message}` : String(e);
    await recordFailure(admin, orgId, resource, message);
    return { resource, fetched: 0, staged: 0, advancedTo: null, error: message };
  }
}

/**
 * Expirations: the outstanding ones, in full, every time.
 *
 * ⚠ **Zero rows on the live account** (F4, 2026-09-21) — this carrier tracks no registration,
 * permit or insurance date in FleetPal. So this path is proved against the vendor's documented
 * shape and against nothing real, and F11 must not present an empty list as "nothing expires".
 * There is no `updated` field and no watermark; `is_completed=false` in full is the whole strategy
 * and it is cheap precisely because the collection is small.
 */
export async function ingestExpirations(ctx: IngestContext): Promise<IngestResult> {
  const { admin, client, orgId } = ctx;
  const resource = "expirations";

  try {
    const rows = await client.walk("/v1/expirations/", fleetpalExpirationSchema, {
      is_completed: "false",
    });
    if (rows.length > 0) {
      const payload = rows.map((row: FleetpalExpiration) => ({
        fleetpal_id: row.id,
        unit_fleetpal_id: row.unit,
        name: row.name,
        description: row.description,
        expiration_date: row.expiration_date,
        threshold_value: row.threshold_value,
        threshold_type: row.threshold_type,
        alters_unit_status: row.alters_unit_status,
        // ⚠ A unit-status id nothing exposes (§2.10.5). Stored opaque; no surface may label it.
        target_status: row.target_status,
        is_completed: row.is_completed,
        status: row.status,
      }));
      const { error } = await admin.rpc("stage_fleetpal_expirations", { p_org: orgId, p_rows: payload });
      if (error) {
        await recordFailure(admin, orgId, resource, error.message);
        return { resource, fetched: rows.length, staged: 0, advancedTo: null, error: error.message };
      }
    }

    const now = new Date().toISOString();
    const moved = await advance(admin, orgId, resource, { kind: "window", to: now }, rows.length);
    if ("error" in moved) {
      return { resource, fetched: rows.length, staged: rows.length, advancedTo: null, error: moved.error };
    }
    return { resource, fetched: rows.length, staged: rows.length, advancedTo: now, error: null };
  } catch (e) {
    const message = e instanceof FleetpalError ? `${e.kind}: ${e.message}` : String(e);
    await recordFailure(admin, orgId, resource, message);
    return { resource, fetched: 0, staged: 0, advancedTo: null, error: message };
  }
}

export { OVERLAP_MS };
