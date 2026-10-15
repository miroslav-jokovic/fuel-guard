import {
  fleetpalMeterSchema,
  fleetpalPmScheduleSchema,
  fleetpalUnitSchema,
  type FleetpalMeter,
  type FleetpalPmSchedule,
} from "@silvicom/shared";
import { FleetpalError } from "../errors.js";
import { advance, getSyncState, recordFailure } from "../syncState.js";
import { stageUnit } from "../units.js";
import type { IngestContext, IngestResult, ResourceIngest } from "./types.js";

/**
 * The units themselves — the row every per-unit reader joins through (F2, D-FP7).
 *
 * ⚠ **Until 2026-10-15 nothing called this.** `stageUnit` was written in F2 and the sweep handler's
 * comment said "units first", but neither the handler nor `sweepRepairRecord` ever walked
 * `/v1/units/`. Measured that day on production: 5,512 work orders, their jobs, items, orders and
 * invoices all syncing hourly without an error — and `fleetpal_units` EMPTY, with no `units` row in
 * `fleetpal_sync_state`. So `resolveStagedUnits` resolved nothing, per-unit cost and the shop backlog
 * read no truck, and a roadside inspection's maintenance violation could not be tied to its repair.
 * Every resource reported healthy because the missing one had no position to report.
 *
 * Watermarked like the rest (`Unit` carries `updated`, the endpoint takes `updated_after`, exclusive)
 * and walked WITHOUT `is_archived`: measured 2026-10-15 the bare list answers all 489 units, 81 of
 * them archived — and a sold truck still owns the repairs it had before it was sold.
 *
 * It does not go through `runIngest`, because there is no `stage_fleetpal_units` rpc and the one
 * writer that exists, `stageUnit`, is careful in a way a set-based copy would have to re-learn: it
 * leaves OUR resolution columns alone. One row at a time costs ~489 round trips on the first sweep
 * and a handful an hour after it. The position moves only past a prefix that fully staged.
 */
export async function ingestUnits(ctx: IngestContext): Promise<IngestResult> {
  const { admin, client, orgId } = ctx;
  const resource = "units";
  const state = await getSyncState(admin, orgId, resource);
  const since = state?.watermark ?? null;

  try {
    const rows = await client.walk("/v1/units/", fleetpalUnitSchema, since ? { updated_after: since } : {});
    if (rows.length === 0) {
      return { resource, fetched: 0, staged: 0, advancedTo: null, error: null };
    }
    const ordered = [...rows].sort((a, b) => (a.updated ?? "").localeCompare(b.updated ?? ""));

    let staged = 0;
    let failure: string | null = null;
    for (const unit of ordered) {
      const result = await stageUnit(admin, orgId, unit);
      if ("error" in result) { failure = result.error; break; }
      staged += 1;
    }

    // `updated_after` is exclusive, so the position may only move to a timestamp none of whose rows
    // are still unstaged — the same rule `runIngest` applies at a batch boundary.
    const next = ordered[staged]?.updated ?? null;
    let safe: string | null = null;
    for (let j = staged - 1; j >= 0; j--) {
      const u = ordered[j]!.updated;
      if (u && u !== next) { safe = u; break; }
    }
    let advancedTo: string | null = null;
    if (safe !== null && (since === null || safe > since)) {
      const moved = await advance(admin, orgId, resource, { kind: "watermark", at: safe }, staged);
      if ("error" in moved) return { resource, fetched: rows.length, staged, advancedTo, error: moved.error };
      advancedTo = safe;
    }
    if (failure !== null) {
      // After the move, because `advance` clears `last_error`.
      await recordFailure(admin, orgId, resource, failure);
      return { resource, fetched: rows.length, staged, advancedTo, error: failure };
    }
    return { resource, fetched: rows.length, staged, advancedTo, error: null };
  } catch (e) {
    const message = e instanceof FleetpalError ? `${e.kind}: ${e.message}` : String(e);
    await recordFailure(admin, orgId, resource, message);
    return { resource, fetched: 0, staged: 0, advancedTo: null, error: message };
  }
}

/**
 * Meters and PM schedules (FLEETPAL-INTEGRATION-PLAN.md F6, F11).
 *
 * Meters are an ordinary watermarked resource. PM schedules are not, and the reason is worth
 * stating: their intervals arrive EMBEDDED in the schedule payload rather than from an endpoint of
 * their own, so staging a schedule and staging its intervals are two writes driven by one walk —
 * which `runIngest`'s one-resource-one-rpc shape cannot express. `ingestPmSchedules` below is that
 * exception, written out rather than hidden behind a generalisation that would then fit nothing.
 */

export const metersIngest: ResourceIngest<FleetpalMeter> = {
  resource: "meters",
  path: "/v1/meters/",
  rpc: "stage_fleetpal_meters",
  schema: fleetpalMeterSchema,
  updatedOf: (row) => row.updated,
  map: (row) => ({
    fleetpal_id: row.id,
    unit_fleetpal_id: row.unit,
    meter_type: row.type,
    // ⚠ The UNIT of this number depends on `meter_type`: metres for ODOMETER and HUBOMETER, hours
    // for ENGINE_HOURS and APU_HOURS. One column, because that is one reading in the vendor's model.
    value: row.value,
    source: row.source,
    // The vendor calls it `timestamp`; the column is `measured_at`, because `timestamp` is a type
    // name in Postgres and a quoted column is a trap for the one query somebody writes by hand.
    measured_at: row.timestamp,
    vendor_created_at: row.created,
    vendor_updated_at: row.updated,
  }),
};

/**
 * PM schedules, and the intervals inside them.
 *
 * ⚠ **The schedules are staged BEFORE their intervals, and the watermark moves only if both
 * succeed.** An interval whose schedule is missing is readable — the join is on
 * `(org_id, fleetpal_id)` and tolerates a gap (0349) — but a schedule whose intervals silently
 * failed to write is a PM that never comes due, which is exactly the class of silence F11 exists to
 * end: `vehicles.next_pm_due_odometer` has been dead since 0099 and nobody noticed for a year.
 */
export async function ingestPmSchedules(ctx: IngestContext): Promise<IngestResult> {
  const { admin, client, orgId } = ctx;
  const resource = "pm-schedules";
  const state = await getSyncState(admin, orgId, resource);
  const since = state?.watermark ?? null;

  try {
    const rows = await client.walk(
      "/v1/pm-schedules/",
      fleetpalPmScheduleSchema,
      since ? { updated_after: since } : {},
    );
    if (rows.length === 0) {
      return { resource, fetched: 0, staged: 0, advancedTo: null, error: null };
    }

    const schedules = rows.map((row: FleetpalPmSchedule) => ({
      fleetpal_id: row.id,
      unit_fleetpal_id: row.unit,
      name: row.name,
      description: row.description,
      component: row.component,
      reason_for_repair: row.reason_for_repair,
      auto_create_wo: row.auto_create_wo,
      last_done: row.last_done,
      vendor_created_at: row.created,
      vendor_updated_at: row.updated,
    }));

    const intervals = rows.flatMap((row: FleetpalPmSchedule) =>
      row.intervals.map((interval) => ({
        fleetpal_id: interval.id,
        pm_schedule_fleetpal_id: row.id,
        interval_type: interval.type,
        // The vendor's field is `order`; the column is `order_index` for the reason `measured_at`
        // is not `timestamp`. It is a DISPLAY position and carries no scheduling meaning.
        order_index: interval.order,
        // ⚠ Canonical for a meter interval and a COUNT for a time one: 40,000 miles arrives as its
        // metre equivalent, six months arrives as `value_int: 6` with `value_time_type: "MONTH"`.
        // Reading the two the same way is how a truck comes due every six metres.
        value_int: interval.value_int,
        value_time_type: interval.value_time_type,
        threshold_int: interval.threshold_int,
        threshold_time_type: interval.threshold_time_type,
        last_done_meter_value: interval.last_done_meter_value,
      })),
    );

    const staged = await admin.rpc("stage_fleetpal_pm_schedules", { p_org: orgId, p_rows: schedules });
    if (staged.error) {
      await recordFailure(admin, orgId, resource, staged.error.message);
      return { resource, fetched: rows.length, staged: 0, advancedTo: null, error: staged.error.message };
    }

    if (intervals.length > 0) {
      const child = await admin.rpc("stage_fleetpal_pm_intervals", { p_org: orgId, p_rows: intervals });
      if (child.error) {
        // The watermark stays put, so the next sweep re-reads these schedules and tries the
        // intervals again. A schedule with no intervals never comes due, and a silent one is worse
        // than a failed one.
        await recordFailure(admin, orgId, resource, `intervals: ${child.error.message}`);
        return {
          resource,
          fetched: rows.length,
          staged: rows.length,
          advancedTo: null,
          error: child.error.message,
        };
      }
    }

    const highest = rows
      .map((row) => row.updated)
      .filter((u): u is string => typeof u === "string" && u !== "")
      .sort()
      .at(-1);
    if (highest) {
      const moved = await advance(admin, orgId, resource, { kind: "watermark", at: highest }, rows.length);
      if ("error" in moved) {
        return { resource, fetched: rows.length, staged: rows.length, advancedTo: null, error: moved.error };
      }
    }
    return { resource, fetched: rows.length, staged: rows.length, advancedTo: highest ?? null, error: null };
  } catch (e) {
    const message = e instanceof FleetpalError ? `${e.kind}: ${e.message}` : String(e);
    await recordFailure(admin, orgId, resource, message);
    return { resource, fetched: 0, staged: 0, advancedTo: null, error: message };
  }
}
