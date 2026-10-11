import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";
import { syncHosClocks } from "./hosClocksFeed.js";

/**
 * The dispatch board's HOS clocks poll (DISPATCH-BOARD-PLAN DB3, 0450): every driver Samsara returns is
 * written with one stamp, and the org's older rows go — a driver Samsara stopped returning must not
 * leave "11 h of drive left" behind for the board to read.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-09T20:00:00Z");
const env = testEnv();
const clocks = (data: unknown[]) => async () => ({ data });

const VINNIE_DRIVER = {
  driver: { id: "5551" },
  currentVehicle: { id: "281474", name: "773" },
  currentDutyStatus: { hosStatusType: "driving" },
  clocks: {
    drive: { driveRemainingDurationMs: 18_000_000 },
    shift: { shiftRemainingDurationMs: 25_200_000 },
    cycle: { cycleRemainingDurationMs: 151_200_000 },
    break: { timeUntilBreakDurationMs: 7_200_000 },
  },
};

describe("syncHosClocks", () => {
  it("writes each driver's four clocks verbatim, stamped with the poll, and prunes older rows", async () => {
    const rec = createSupabaseRecorder({ tables: { driver_hos_clocks: { data: [], count: 2 } } });
    const r = await syncHosClocks(rec.client, env, ORG, { clocksFetcher: clocks([VINNIE_DRIVER]), now: NOW });
    expect(rec.writtenRows("driver_hos_clocks")).toEqual([
      {
        org_id: ORG,
        samsara_driver_id: "5551",
        samsara_vehicle_id: "281474",
        duty_status: "driving",
        drive_remaining_ms: 18_000_000,
        shift_remaining_ms: 25_200_000,
        cycle_remaining_ms: 151_200_000,
        break_remaining_ms: 7_200_000,
        fetched_at: NOW.toISOString(),
      },
    ]);
    const prune = rec.forTable("driver_hos_clocks").find((q) => q.write?.method === "delete")!;
    expect(prune.filters()).toEqual([
      { col: "org_id", val: ORG },
      { col: "fetched_at", val: NOW.toISOString() },
    ]);
    expect(prune.ops.map((o) => o.method)).toContain("lt");
    expect(r).toEqual({ drivers: 1, removed: 2 });
    expectOrgScoped(rec, ORG);
  });

  it("keeps a missing clock as null, never as zero hours left", async () => {
    const rec = createSupabaseRecorder({ tables: { driver_hos_clocks: [] } });
    await syncHosClocks(rec.client, env, ORG, {
      clocksFetcher: clocks([{ driver: { id: "5552" }, currentDutyStatus: { hosStatusType: "offDuty" } }]),
      now: NOW,
    });
    expect(rec.writtenRows("driver_hos_clocks")[0]).toMatchObject({
      samsara_vehicle_id: null,
      duty_status: "off_duty",
      drive_remaining_ms: null,
      shift_remaining_ms: null,
    });
  });

  it("deletes nothing when Samsara fails — the last good set stays for the reader to call stale", async () => {
    const rec = createSupabaseRecorder({ tables: { driver_hos_clocks: [] } });
    const failing = async () => {
      throw new Error("Samsara API 503");
    };
    await expect(syncHosClocks(rec.client, env, ORG, { clocksFetcher: failing, now: NOW })).rejects.toThrow("503");
    expect(rec.forTable("driver_hos_clocks")).toEqual([]);
  });
});
