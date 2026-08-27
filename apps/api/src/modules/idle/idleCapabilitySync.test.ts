import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EngineStatesFetcher, SamsaraEngineVehicleRecord } from "../../lib/samsara.js";
import { syncIdleCapabilities } from "./idleCapabilitySync.js";
import { testEnv } from "../../testing/testEnv.js";

const tokenLoader = vi.hoisted(() => ({ loadSamsaraToken: vi.fn() }));
vi.mock("../../lib/samsaraToken.js", () => tokenLoader);

interface VehicleRow {
  id: string;
  samsara_vehicle_id: string;
}

interface EngineDayRow {
  id: string;
  day: string;
}

interface ParkSessionRow {
  id: string;
  started_at: string;
}

interface OperatingHoursRow {
  operating_hours: null;
}

type FakeData = VehicleRow[] | EngineDayRow[] | ParkSessionRow[] | OperatingHoursRow | null;
type FakeScalar = string | number | null;
interface FakeError {
  message: string;
}
interface FakeResponse {
  data: FakeData;
  error: FakeError | null;
}

class FakeSupabaseQuery implements PromiseLike<FakeResponse> {
  private operation: "read" | "upsert" | "update" | "delete" = "read";
  private readonly response: FakeResponse = { data: null, error: null };
  private pendingUpdate: Record<string, FakeScalar> | null = null;

  public constructor(
    private readonly table: string,
    private readonly state: FakeSupabaseState,
  ) {}

  public select(_columns: string): this {
    this.operation = "read";
    return this;
  }

  public eq(column: string, value: string): this {
    if (this.table === "vehicles" && column === "id") this.state.currentVehicleId = value;
    return this;
  }

  public not(_column: string, _operator: string, _value: string): this {
    return this;
  }

  public gte(_column: string, _value: string): this {
    return this;
  }

  public lte(_column: string, _value: string): this {
    return this;
  }

  public lt(_column: string, _value: string): this {
    return this;
  }

  public maybeSingle(): this {
    return this;
  }

  public upsert(rows: readonly Record<string, FakeScalar>[], _options: { onConflict: string }): this {
    this.operation = "upsert";
    if (this.table === "vehicle_engine_days") {
      const incoming = rows.map((row) => ({
        id: `new-day-${String(row.day)}`,
        day: String(row.day),
      }));
      this.state.engineDays = [
        ...this.state.engineDays.filter((existing) => !incoming.some((row) => row.day === existing.day)),
        ...incoming,
      ];
    }
    if (this.table === "idle_park_sessions") {
      this.state.parkUpserts.push(...rows);
      const incoming = rows.map((row) => ({
        id: `new-session-${String(row.started_at)}`,
        started_at: String(row.started_at),
      }));
      this.state.parkSessions = [
        ...this.state.parkSessions.filter(
          (existing) => !incoming.some((row) => row.started_at === existing.started_at),
        ),
        ...incoming,
      ];
    }
    return this;
  }

  public update(values: Record<string, FakeScalar>): this {
    this.operation = "update";
    this.pendingUpdate = values;
    return this;
  }

  public delete(): this {
    this.operation = "delete";
    return this;
  }

  public in(column: string, values: readonly string[]): this {
    if (this.operation !== "delete" || column !== "id") return this;
    if (this.table === "vehicle_engine_days") {
      this.state.deletedEngineDayIds.push(...values);
      this.state.engineDays = this.state.engineDays.filter((row) => !values.includes(row.id));
    }
    if (this.table === "idle_park_sessions") {
      this.state.deletedParkSessionIds.push(...values);
      this.state.parkSessions = this.state.parkSessions.filter((row) => !values.includes(row.id));
    }
    return this;
  }

  public then<TResult1 = FakeResponse, TResult2 = never>(
    onfulfilled?: ((value: FakeResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: never) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    void onrejected;
    let data: FakeData = null;
    if (this.operation === "read" && this.table === "vehicles") data = this.state.vehicles;
    else if (this.operation === "read" && this.table === "organizations") data = { operating_hours: null };
    else if (this.operation === "read" && this.table === "vehicle_engine_days") data = this.state.engineDays;
    else if (this.operation === "read" && this.table === "idle_park_sessions") data = this.state.parkSessions;
    if (this.operation === "update" && this.table === "vehicles" && this.pendingUpdate) {
      const vehicleId = this.state.currentVehicleId;
      if (vehicleId) this.state.vehicleUpdates.set(vehicleId, this.pendingUpdate);
    }
    const response: FakeResponse = { data, error: this.response.error };
    return new Promise<TResult1 | TResult2>((resolve) => {
      if (onfulfilled) resolve(onfulfilled(response));
      else resolve(response as TResult1);
    });
  }
}

interface FakeSupabaseState {
  vehicles: VehicleRow[];
  engineDays: EngineDayRow[];
  parkSessions: ParkSessionRow[];
  deletedEngineDayIds: string[];
  deletedParkSessionIds: string[];
  parkUpserts: Record<string, FakeScalar>[];
  vehicleUpdates: Map<string, Record<string, FakeScalar>>;
  currentVehicleId: string | null;
}

function makeAdmin(state: FakeSupabaseState): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === "vehicles") {
        const original = state.currentVehicleId;
        state.currentVehicleId = state.vehicles[0]?.id ?? null;
        const query = new FakeSupabaseQuery(table, state);
        state.currentVehicleId = original;
        return query;
      }
      return new FakeSupabaseQuery(table, state);
    },
  } as unknown as SupabaseClient;
}

const fetcher = (data: SamsaraEngineVehicleRecord[], complete = true): EngineStatesFetcher =>
  async () => ({ data, complete, pages: 1 });

beforeEach(() => {
  tokenLoader.loadSamsaraToken.mockResolvedValue("test-token");
});

describe("syncIdleCapabilities Phase 1 reconciliation", () => {
  it("resets vehicles absent from the source and removes stale derived rows", async () => {
    const state: FakeSupabaseState = {
      vehicles: [
        { id: "v1", samsara_vehicle_id: "s1" },
        { id: "v2", samsara_vehicle_id: "s2" },
      ],
      engineDays: [{ id: "stale-day", day: "2000-01-01" }],
      parkSessions: [{ id: "stale-session", started_at: "2000-01-01T00:00:00.000Z" }],
      deletedEngineDayIds: [],
      deletedParkSessionIds: [],
      parkUpserts: [],
      vehicleUpdates: new Map(),
      currentVehicleId: null,
    };
    const admin = makeAdmin(state);
    const result = await syncIdleCapabilities(admin, testEnv(), "org-1", {
      sinceDays: 1,
      engineStatesFetcher: fetcher([
        {
          id: "s2",
          engineStates: [
            { time: "2026-08-09T00:00:00.000Z", value: "Idle" },
            { time: "2026-08-09T00:10:00.000Z", value: "Off" },
            { time: "2026-08-09T02:00:00.000Z", value: "On" },
            { time: "2026-08-09T02:10:00.000Z", value: "On" },
          ],
        },
      ]),
    });

    expect(result.vehicles).toBe(2);
    expect(result.vehiclesWithData).toBe(1);
    expect(result.vehiclesWithoutData).toBe(1);
    expect(result.staleEngineDaysDeleted).toBe(1);
    expect(result.staleParkSessionsDeleted).toBe(1);
    expect(state.deletedEngineDayIds).toEqual(["stale-day"]);
    expect(state.deletedParkSessionIds).toEqual(["stale-session"]);
    expect(state.parkUpserts[0]).toMatchObject({
      observed_mode: "engine_off_observed",
      evidence_status: "sufficient",
      evidence_confidence: null,
      evidence_version: "engine-states-v1",
    });
    expect(state.vehicleUpdates.get("v1")).toMatchObject({ idle_capability: "unknown", idle_states_sec: 0 });
    expect(state.vehicleUpdates.get("v2")).toMatchObject({ idle_capability: "unknown" });
  });

  it("fails before reconciliation when Samsara pagination is incomplete", async () => {
    const state: FakeSupabaseState = {
      vehicles: [{ id: "v1", samsara_vehicle_id: "s1" }],
      engineDays: [{ id: "stale-day", day: "2000-01-01" }],
      parkSessions: [{ id: "stale-session", started_at: "2000-01-01T00:00:00.000Z" }],
      deletedEngineDayIds: [],
      deletedParkSessionIds: [],
      parkUpserts: [],
      vehicleUpdates: new Map(),
      currentVehicleId: null,
    };

    await expect(
      syncIdleCapabilities(makeAdmin(state), testEnv(), "org-1", {
        engineStatesFetcher: fetcher([], false),
      }),
    ).rejects.toThrow("history was truncated");
    expect(state.deletedEngineDayIds).toHaveLength(0);
    expect(state.deletedParkSessionIds).toHaveLength(0);
    expect(state.vehicleUpdates.size).toBe(0);
  });

  it("normalizes millisecond-derived session values before integer-column writes", async () => {
    const state: FakeSupabaseState = {
      vehicles: [{ id: "v1", samsara_vehicle_id: "s1" }],
      engineDays: [],
      parkSessions: [],
      deletedEngineDayIds: [],
      deletedParkSessionIds: [],
      parkUpserts: [],
      vehicleUpdates: new Map(),
      currentVehicleId: null,
    };

    await syncIdleCapabilities(makeAdmin(state), testEnv(), "org-1", {
      sinceDays: 1,
      engineStatesFetcher: fetcher([
        {
          id: "s1",
          engineStates: [
            { time: "2026-08-09T00:00:00.000Z", value: "Idle" },
            { time: "2026-08-09T00:30:00.999Z", value: "Off" },
            { time: "2026-08-09T01:00:01.998Z", value: "Idle" },
          ],
        },
      ]),
    });

    const row = state.parkUpserts[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row).toMatchObject({ duration_sec: 3_602, idle_sec: 1_801, off_sec: 1_801, cycles: 1 });
    for (const key of ["duration_sec", "idle_sec", "off_sec", "cycles"]) {
      expect(Number.isInteger(row[key] as number)).toBe(true);
    }
  });
});
