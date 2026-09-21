import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { FleetpalClient } from "../client.js";
import { runIngest } from "./run.js";
import { workOrdersIngest, jobItemsIngest, serviceHistoryIngest } from "./repair.js";
import { ingestPmSchedules } from "./equipment.js";
import { ingestShops } from "./reference.js";

/**
 * The repair-record ingest (FLEETPAL-INTEGRATION-PLAN.md F6).
 *
 * 0349's matrix proves the DATABASE cannot double a history or take its tenant from a payload. This
 * file proves the four things above it that the database cannot see:
 *
 *   1. The walk starts from the stored watermark, so a delta sweep asks for a delta.
 *   2. The watermark moves to the highest `updated` SEEN — never to `now()`, which would skip every
 *      row the vendor stamped while we were walking, and never at all when the stage call failed.
 *   3. A resource with no `updated` field writes a WINDOW position rather than a watermark; reading
 *      one as the other is the bug `fleetpal_sync_state`'s two columns exist to prevent.
 *   4. A payload the contract rejects surfaces as a named error on the sync state, not as a throw
 *      inside a scheduler tick — the difference between "validation: Part.type ..." on an operator's
 *      screen and "the sync stopped" with nothing to read.
 */

const ORG = "11111111-1111-1111-1111-111111111111";

const workOrder = (over: Record<string, unknown> = {}) => ({
  url: "https://openapi.fleetpal.io/v1/work-orders/dAP6VYUL",
  id: "dAP6VYUL",
  number: 5331,
  reference_number: "WO-5331",
  status: "CLOSED",
  unit: "zeabsRcL",
  shop: "farh5tje",
  priority: "LOW",
  repair_priority_class: "EMERGENCY",
  description: "CHECK TRUCK JUMP START",
  scheduled_start: null,
  started: "2026-09-20T17:00:00Z",
  expected_completion: null,
  completed: "2026-09-20T21:30:00Z",
  cancellation_reason: "",
  created: "2026-09-21T20:36:38Z",
  updated: "2026-09-21T21:30:29Z",
  ...over,
});

/** A `fetch` that answers one page and records what it was asked for. */
function scriptedFetch(bodies: unknown[]) {
  const urls: string[] = [];
  let i = 0;
  const impl = (async (input: unknown) => {
    urls.push(String(input));
    const body = bodies[Math.min(i++, bodies.length - 1)];
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, urls };
}

const page = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results });

const clientWith = (bodies: unknown[]) => {
  const { impl, urls } = scriptedFetch(bodies);
  return {
    client: new FleetpalClient({ apiKey: "fp_test_key", baseUrl: "https://openapi.fleetpal.io", fetchImpl: impl }),
    urls,
  };
};

/** The state row a sweep reads before it starts, and the rpc answer it gets when it stages. */
const recorderWith = (opts: { state?: Record<string, unknown>[]; rpcError?: string } = {}) =>
  createSupabaseRecorder({
    tables: { fleetpal_sync_state: () => ({ data: opts.state ?? [], error: null }) },
    rpc: () =>
      opts.rpcError ? { data: null, error: { message: opts.rpcError } } : { data: 1, error: null },
  });

describe("walking from the stored position", () => {
  it("asks for a delta when a watermark exists", async () => {
    const { client, urls } = clientWith([page([workOrder()])]);
    const rec = recorderWith({
      state: [{ resource: "work-orders", watermark: "2026-09-01T00:00:00Z", window_end: null, last_run_at: null, last_error: null, rows_seen: 0 }],
    });
    await runIngest({ admin: rec.client, client, orgId: ORG }, workOrdersIngest);
    expect(urls[0]).toContain("updated_after=2026-09-01T00%3A00%3A00Z");
  });

  it("⚠ asks for everything on the first run — a missing row means 'never run', not an error", async () => {
    const { client, urls } = clientWith([page([workOrder()])]);
    const rec = recorderWith();
    await runIngest({ admin: rec.client, client, orgId: ORG }, workOrdersIngest);
    expect(urls[0]).not.toContain("updated_after");
  });

  it("reads and writes the sync state org-scoped — the service role bypasses RLS", async () => {
    const { client } = clientWith([page([workOrder()])]);
    const rec = recorderWith();
    await runIngest({ admin: rec.client, client, orgId: ORG }, workOrdersIngest);
    expectOrgScoped(rec, ORG);
  });
});

describe("the watermark", () => {
  it("⚠ moves to the highest `updated` SEEN, not to the clock", async () => {
    const { client } = clientWith([
      page([
        workOrder({ id: "A", updated: "2026-09-10T00:00:00Z" }),
        workOrder({ id: "B", updated: "2026-09-19T12:00:00Z" }),
        workOrder({ id: "C", updated: "2026-09-15T00:00:00Z" }),
      ]),
    ]);
    const rec = recorderWith();
    const result = await runIngest({ admin: rec.client, client, orgId: ORG }, workOrdersIngest);
    expect(result.advancedTo).toBe("2026-09-19T12:00:00Z");
    // `now()` would have skipped everything the vendor stamped between the last page and the read:
    // `updated_after` is exclusive, so those rows would never be delivered again.
    const written = rec.writtenRows("fleetpal_sync_state");
    expect(written.some((row) => row.watermark === "2026-09-19T12:00:00Z")).toBe(true);
  });

  it("⚠ does not move when the stage call failed", async () => {
    const { client } = clientWith([page([workOrder()])]);
    const rec = recorderWith({ rpcError: "duplicate key value violates unique constraint" });
    const result = await runIngest({ admin: rec.client, client, orgId: ORG }, workOrdersIngest);
    expect(result.error).toContain("duplicate key");
    expect(result.advancedTo).toBeNull();
    const writes = rec.writtenRows("fleetpal_sync_state");
    // The only write is the failure note; nothing carries a watermark.
    expect(writes.every((row) => row.watermark === undefined)).toBe(true);
    expect(writes.some((row) => typeof row.last_error === "string")).toBe(true);
  });

  it("⚠ does not move when the page was empty", async () => {
    const { client } = clientWith([page([])]);
    const rec = recorderWith();
    const result = await runIngest({ admin: rec.client, client, orgId: ORG }, workOrdersIngest);
    expect(result).toEqual({ resource: "work-orders", fetched: 0, staged: 0, advancedTo: null, error: null });
    expect(rec.queries.filter((q) => q.table === "fleetpal_sync_state" && q.write)).toEqual([]);
  });
});

describe("a resource with no `updated` field", () => {
  it("⚠ writes a WINDOW position, never a watermark", async () => {
    // `Shop` has no `updated` and its endpoint takes no `updated_after`. A window position read back
    // as a watermark would make a later sweep filter by when we last looked, which for this
    // resource means asking for a parameter the vendor ignores — and for a resource that DOES
    // filter, skipping everything that changed without being re-created.
    const { client, urls } = clientWith([
      page([
        {
          url: "https://openapi.fleetpal.io/v1/shops/farh5tje",
          id: "farh5tje", name: "Silvicom, Inc", code: null, contact: "", email: "", phone: "",
          website: "", address: "", address_2: "", city: "Melrose Park", state: "IL",
          zip_code: "60160", country: "USA", hourly_labor_rate: 95, created: "2025-03-17T19:20:18Z",
        },
      ]),
    ]);
    const rec = recorderWith();
    const result = await ingestShops({ admin: rec.client, client, orgId: ORG });
    expect(result.error).toBeNull();
    expect(urls[0]).not.toContain("updated_after");
    const written = rec.writtenRows("fleetpal_sync_state")[0]!;
    expect(written.window_end).toEqual(expect.any(String));
    expect(written.watermark).toBeUndefined();
  });
});

describe("PM schedules carry their intervals", () => {
  const schedule = {
    url: "https://openapi.fleetpal.io/v1/pm-schedules/PM1",
    id: "PM1", unit: "zeabsRcL", name: "A Service", description: "", component: "ABC",
    reason_for_repair: "", last_done: "2026-08-01T00:00:00Z", auto_create_wo: true,
    created: "2025-03-17T19:20:18Z", updated: "2026-09-01T00:00:00Z",
    intervals: [
      { id: "IV1", type: "METER", value_int: 40233600, value_time_type: null, threshold_int: 1609344, threshold_time_type: null, last_done_meter_value: 600000000, order: 0 },
      { id: "IV2", type: "TIME", value_int: 6, value_time_type: "MONTH", threshold_int: 14, threshold_time_type: "DAY", last_done_meter_value: null, order: 1 },
    ],
  };

  it("stages the schedule and each interval, flattened out of one walk", async () => {
    const { client } = clientWith([page([schedule])]);
    const rec = recorderWith();
    const result = await ingestPmSchedules({ admin: rec.client, client, orgId: ORG });
    expect(result.error).toBeNull();
    const calls = rec.rpcs();
    expect(calls.map((c) => c.fn)).toEqual(["stage_fleetpal_pm_schedules", "stage_fleetpal_pm_intervals"]);
    const intervals = calls[1]!.args as { p_rows: Record<string, unknown>[] };
    expect(intervals.p_rows).toHaveLength(2);
    // ⚠ The metre interval keeps metres and the time interval keeps a COUNT. Reading the two the
    // same way is how a truck comes due every six metres.
    expect(intervals.p_rows[0]!.value_int).toBe(40233600);
    expect(intervals.p_rows[1]!.value_int).toBe(6);
    expect(intervals.p_rows[1]!.value_time_type).toBe("MONTH");
  });

  it("⚠ leaves the watermark where it was when the intervals failed to stage", async () => {
    // A schedule with no intervals never comes due. Advancing past it would make that permanent and
    // silent — which is precisely how `vehicles.next_pm_due_odometer` stayed dead from 0099.
    const rec = createSupabaseRecorder({
      tables: { fleetpal_sync_state: () => ({ data: [], error: null }) },
      rpc: (fn: string) =>
        fn === "stage_fleetpal_pm_intervals"
          ? { data: null, error: { message: "interval write failed" } }
          : { data: 1, error: null },
    });
    const { client } = clientWith([page([schedule])]);
    const result = await ingestPmSchedules({ admin: rec.client, client, orgId: ORG });
    expect(result.error).toContain("interval write failed");
    expect(result.advancedTo).toBeNull();
    const writes = rec.writtenRows("fleetpal_sync_state");
    expect(writes.every((row) => row.watermark === undefined)).toBe(true);
  });
});

describe("a payload the contract rejects", () => {
  it("⚠ becomes a named error on the sync state, not a throw in a scheduler tick", async () => {
    const { client } = clientWith([page([{ id: "X", number: "not-a-number" }])]);
    const rec = recorderWith();
    const result = await runIngest({ admin: rec.client, client, orgId: ORG }, workOrdersIngest);
    expect(result.error).toContain("validation");
    expect(result.advancedTo).toBeNull();
    const failure = rec.writtenRows("fleetpal_sync_state")[0]!;
    expect(String(failure.last_error)).toContain("validation");
  });
});

describe("what the mapping carries", () => {
  it("stages the human-facing work-order reference, not just the sequential number", async () => {
    const mapped = workOrdersIngest.map(workOrder() as never) as Record<string, unknown>;
    expect(mapped.reference_number).toBe("WO-5331");
    expect(mapped.unit_fleetpal_id).toBe("zeabsRcL");
  });

  it("⚠ keeps the odometer in canonical METRES", async () => {
    const mapped = serviceHistoryIngest.map({
      id: "SH1", work_order: "W", work_order_reference: "WO-1", unit: "U", unit_owner_name: "Silvicom",
      shop: null, customer: null, vendor: null, started: null, completed: "2026-09-20T21:30:00Z",
      name: "", description: "", source: "MANUAL", component: "", complaint: null,
      reason_for_repair: null, defect: null, issue: null, pm_schedule: null, billable: false,
      items_count: 1, total: 100, total_parts: 100, total_labor: null, total_fees: null,
      total_tax: null, total_services: null, total_labor_hours: null, odometer: 663_000_000,
      engine_hours: null, hubometer: null, apu_hours: null, created: "2026-09-21T00:00:00Z",
      updated: "2026-09-21T00:00:00Z",
    } as never) as Record<string, unknown>;
    expect(mapped.odometer).toBe(663_000_000);
    // ⚠ And it does NOT carry the owner's name: for an owner-operator's truck that is a person, and
    // the id beside it answers every question a maintenance report asks.
    expect(Object.keys(mapped)).not.toContain("unit_owner_name");
  });

  it("keeps a labour line's quantity as hours rather than normalising it to a count", () => {
    const mapped = jobItemsIngest.map({
      url: "u", id: "JI1", job: "J1", type: "LABOR", description: "Diagnose", part: null,
      part_number: null, universal_product_code: null, manufacturer: null,
      manufacturer_part_number: "", component: "", cause: null, unit_of_measure: "hr",
      quantity: 2.5, price: 95, total: 237.5, created: "2026-09-21T00:00:00Z",
      updated: "2026-09-21T00:00:00Z",
    } as never) as Record<string, unknown>;
    expect(mapped.quantity).toBe(2.5);
    expect(mapped.unit_of_measure).toBe("hr");
  });
});
