import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VehicleTelemetryFetcher } from "../samsara/lib/samsara.js";
import { syncIdleTelemetry } from "./idleTelemetrySync.js";
import { testEnv } from "../../testing/testEnv.js";

const tokenLoader = vi.hoisted(() => ({ loadSamsaraToken: vi.fn() }));
vi.mock("../samsara/lib/samsaraToken.js", () => tokenLoader);

type Scalar = string | number | null;
type VehicleRow = { id: string; samsara_vehicle_id: string };

class FakeQuery implements PromiseLike<{ data: VehicleRow[] | null; error: null }> {
  public readonly rows: Record<string, Scalar>[] = [];
  public constructor(private readonly table: string, private readonly vehicles: VehicleRow[]) {}

  public select(_columns: string): this {
    return this;
  }

  public eq(_column: string, _value: string): this {
    return this;
  }

  public not(_column: string, _operator: string, _value: string): this {
    return this;
  }

  public upsert(row: Record<string, Scalar>, _options: { onConflict: string }): this {
    if (this.table === "idle_telemetry_windows") this.rows.push(row);
    return this;
  }

  public then<TResult1 = { data: VehicleRow[] | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: VehicleRow[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: never) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    void onrejected;
    const response = this.table === "vehicles" ? { data: this.vehicles, error: null } : { data: null, error: null };
    return onfulfilled ? Promise.resolve(onfulfilled(response)) : Promise.resolve(response as TResult1);
  }
}

function makeAdmin(vehicles: VehicleRow[]): { admin: SupabaseClient; upserts: Record<string, Scalar>[] } {
  const upserts: Record<string, Scalar>[] = [];
  return {
    admin: {
      from: (table: string) => {
        const query = new FakeQuery(table, vehicles);
        const originalUpsert = query.upsert.bind(query);
        query.upsert = (row, options) => {
          originalUpsert(row, options);
          upserts.push(row);
          return query;
        };
        return query;
      },
    } as unknown as SupabaseClient,
    upserts,
  };
}

const telemetry: VehicleTelemetryFetcher = async () => ({
  complete: true,
  pages: 1,
  data: [
    {
      id: "s1",
      batteryMilliVolts: [
        { time: "2026-08-09T00:00:00.000Z", value: 12_600 },
        { time: "2026-08-09T00:05:00.000Z", value: 12_400 },
      ],
      engineRpm: [{ time: "2026-08-09T00:00:00.000Z", value: 700 }],
      engineLoadPercent: [{ time: "2026-08-09T00:00:00.000Z", value: 18 }],
      ecuSpeedMph: [{ time: "2026-08-09T00:00:00.000Z", value: 0 }],
    },
  ],
});

beforeEach(() => tokenLoader.loadSamsaraToken.mockResolvedValue("test-token"));

describe("syncIdleTelemetry", () => {
  it("writes observed evidence and an explicit insufficient row for a vehicle omitted by Samsara", async () => {
    const { admin, upserts } = makeAdmin([
      { id: "v1", samsara_vehicle_id: "s1" },
      { id: "v2", samsara_vehicle_id: "s2" },
    ]);

    const result = await syncIdleTelemetry(admin, testEnv(), "org-1", { sinceDays: 7, telemetryFetcher: telemetry });

    expect(result.vehicles).toBe(2);
    expect(result.vehiclesWithTelemetry).toBe(1);
    expect(result.windowsWritten).toBe(2);
    expect(result.samples).toEqual({ battery: 2, rpm: 1, engineLoad: 1, ecuSpeed: 1 });
    expect(upserts).toHaveLength(2);
    expect(upserts.find((row) => row.vehicle_id === "v1")).toMatchObject({
      data_status: "observed",
      battery_sample_count: 2,
      battery_min_mv: 12400,
      battery_max_mv: 12600,
      engine_load_avg_pct: 18,
      evidence_version: "vehicle-stats-v1",
    });
    expect(upserts.find((row) => row.vehicle_id === "v2")).toMatchObject({
      data_status: "insufficient",
      battery_sample_count: 0,
      rpm_sample_count: 0,
      ecu_speed_sample_count: 0,
    });
  });

  it("does not write reconciliation rows when the paginated source is incomplete", async () => {
    const { admin, upserts } = makeAdmin([{ id: "v1", samsara_vehicle_id: "s1" }]);
    const incomplete: VehicleTelemetryFetcher = async () => ({ data: [], complete: false, pages: 120 });

    await expect(syncIdleTelemetry(admin, testEnv(), "org-1", { telemetryFetcher: incomplete })).rejects.toThrow(
      "history was truncated",
    );
    expect(upserts).toHaveLength(0);
  });
});
