import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { FleetpalClient } from "../client.js";
import { ingestUnits } from "./equipment.js";
import { sweepRepairRecord } from "./index.js";

/**
 * The units walk (FLEETPAL-INTEGRATION-PLAN.md F2, wired into the sweep 2026-10-15).
 *
 * Until that day `stageUnit` had no caller and production's `fleetpal_units` was empty while every
 * other resource synced. These tests pin the four things that made it worth writing on its own:
 * the sweep walks it at all, it walks archived units too, the vendor's fields never carry our
 * resolution columns, and a refused row holds the position behind it.
 */

const ORG = "11111111-1111-1111-1111-111111111111";
const FIXTURES = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "__fixtures__");
const base = (JSON.parse(readFileSync(path.join(FIXTURES, "units.json"), "utf8")) as { results: Record<string, unknown>[] }).results[0]!;
const unit = (over: Record<string, unknown> = {}) => ({ ...base, ...over });

function clientWith(bodies: unknown[]) {
  const urls: string[] = [];
  let i = 0;
  const impl = (async (input: unknown) => {
    urls.push(String(input));
    const body = bodies[Math.min(i++, bodies.length - 1)];
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { client: new FleetpalClient({ apiKey: "fp_test_key", baseUrl: "https://openapi.fleetpal.io", fetchImpl: impl }), urls };
}

const page = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results });

/** `fleetpal_units` answers an UPDATE with no row (so `stageUnit` inserts), and refuses the VIN named. */
const recorderWith = (opts: { state?: Record<string, unknown>[]; refuseVin?: string } = {}) =>
  createSupabaseRecorder({
    tables: {
      fleetpal_sync_state: () => ({ data: opts.state ?? [], error: null }),
      fleetpal_units: (q: RecordedQuery) => {
        const vin = (q.write?.payload as { vin?: string } | undefined)?.vin;
        return opts.refuseVin && vin === opts.refuseVin
          ? { data: null, writeError: { message: "permission denied for table fleetpal_units" } }
          : { data: [] };
      },
    },
    rpc: () => ({ data: 1, error: null }),
  });

describe("the units walk", () => {
  it("⚠ walks every unit, archived ones included — a sold truck still owns its repairs", async () => {
    const { client, urls } = clientWith([page([unit({ id: "A", vin: "VIN-A" }), unit({ id: "B", vin: "VIN-B", archived: "2026-06-01T00:00:00Z" })])]);
    const rec = recorderWith();
    const result = await ingestUnits({ admin: rec.client, client, orgId: ORG });
    expect(result).toMatchObject({ resource: "units", fetched: 2, staged: 2, error: null });
    expect(urls[0]).toContain("/v1/units/");
    expect(urls[0]).not.toContain("is_archived");
    const inserted = rec.writtenRows("fleetpal_units").filter((r) => r.fleetpal_id);
    expect(inserted.map((r) => r.fleetpal_id)).toEqual(["A", "B"]);
    expectOrgScoped(rec, ORG);
  });

  it("⚠ never sends our resolution columns — a sweep must not unmatch a unit a person linked", async () => {
    const { client } = clientWith([page([unit()])]);
    const rec = recorderWith();
    await ingestUnits({ admin: rec.client, client, orgId: ORG });
    for (const row of rec.writtenRows("fleetpal_units")) {
      for (const col of ["vehicle_id", "trailer_id", "match_method", "matched_at"]) expect(row).not.toHaveProperty(col);
    }
  });

  it("asks for a delta from the stored watermark and moves it to the highest `updated` seen", async () => {
    const { client, urls } = clientWith([
      page([unit({ id: "A", updated: "2026-10-02T00:00:00Z" }), unit({ id: "B", updated: "2026-10-09T00:00:00Z" })]),
    ]);
    const rec = recorderWith({
      state: [{ resource: "units", watermark: "2026-10-01T00:00:00Z", window_end: null, last_run_at: null, last_error: null, rows_seen: 0 }],
    });
    const result = await ingestUnits({ admin: rec.client, client, orgId: ORG });
    expect(urls[0]).toContain("updated_after=");
    expect(result.advancedTo).toBe("2026-10-09T00:00:00Z");
  });

  it("⚠ stops at a refused unit and moves the position only past the units before it", async () => {
    const { client } = clientWith([
      page([
        unit({ id: "A", vin: "VIN-A", updated: "2026-10-02T00:00:00Z" }),
        unit({ id: "B", vin: "VIN-B", updated: "2026-10-05T00:00:00Z" }),
        unit({ id: "C", vin: "VIN-C", updated: "2026-10-09T00:00:00Z" }),
      ]),
    ]);
    const rec = recorderWith({ refuseVin: "VIN-B" });
    const result = await ingestUnits({ admin: rec.client, client, orgId: ORG });
    expect(result.staged).toBe(1);
    expect(result.advancedTo).toBe("2026-10-02T00:00:00Z");
    expect(result.error).toContain("permission denied");
    const state = rec.writtenRows("fleetpal_sync_state");
    expect(state.some((r) => typeof r.last_error === "string")).toBe(true);
    expect(state.some((r) => r.watermark === "2026-10-09T00:00:00Z")).toBe(false);
  });
});

describe("the sweep", () => {
  it("⚠ walks units FIRST — until 2026-10-15 it never walked them at all", async () => {
    const { client, urls } = clientWith([page([])]);
    const rec = recorderWith();
    const results = await sweepRepairRecord({ admin: rec.client, client, orgId: ORG });
    expect(results[0]!.resource).toBe("units");
    expect(urls[0]).toContain("/v1/units/");
  });
});
