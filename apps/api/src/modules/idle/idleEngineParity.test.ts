import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { readIdleEngineParity } from "./idleEngineParity.js";

/**
 * D-IE9's gate, read (IE5). The gate is `parity.test.ts`'s; what is only testable here is the reading:
 * that finality comes from the latest finished nightly's window start on the org's clock, that ours and
 * Samsara's rows pair by truck AND day, how running and stopped running are assembled from the buckets,
 * and that every read is the org's.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const H = 3600;
const ours = (vehicle_id: string, day: string, o: Record<string, unknown> = {}) => ({
  vehicle_id, day, hours: 24, driving_sec: 6 * H, stopped_running_sec: 3 * H, brief_stop_sec: H,
  engine_sec: String(10 * H + 360), engine_sec_hours: 24, ...o,
});

function seed(o: { nightlyFrom?: string | null; tz?: string; days?: Record<string, unknown>[]; samsara?: Record<string, unknown>[] } = {}) {
  const days = o.days ?? [ours("v1", "2026-10-01"), ours("v2", "2026-10-01")];
  return createSupabaseRecorder({
    tables: {
      organizations: [{ id: ORG, operating_hours: { tz: o.tz ?? "America/Chicago" } }],
      jobs: o.nightlyFrom === null ? [] : [{ stats: { mode: "nightly", from: o.nightlyFrom ?? "2026-10-01T05:00:00.000Z" } }],
      // A FUNCTION fixture: the recorder applies no filter, and which days are final is the question.
      idle_engine_days: (q) => {
        const hi = q.ops.find((x) => x.method === "lte")?.args[1] as string;
        return days.filter((d) => (d.day as string) <= hi);
      },
      vehicle_engine_days: o.samsara ?? [
        { vehicle_id: "v1", day: "2026-10-01", idle_sec: 4 * H + 360, coverage_sec: 24 * H },
        // v2's Samsara row is for ANOTHER day: it must not pair with v2's 10/01.
        { vehicle_id: "v2", day: "2026-09-30", idle_sec: 4 * H, coverage_sec: 24 * H },
      ],
      vehicles: [{ id: "v1", unit_number: "650" }, { id: "v2", unit_number: "661" }],
    },
  });
}

describe("readIdleEngineParity", () => {
  it("judges through the local day the latest nightly started on, pairing rows by truck and day", async () => {
    const r = await readIdleEngineParity(seed({ days: [ours("v1", "2026-10-01"), ours("v2", "2026-10-01"), ours("v1", "2026-10-02")] }).client, ORG);
    expect(r.finalThrough).toBe("2026-10-01");
    expect(r.days).toEqual(["2026-10-01"]);
    // v1: running 10 h vs ECU 10.1 h, stopped 4 h vs Samsara 4.1 h → both checks; v2: running only.
    expect(r.truckDays).toMatchObject({ judged: 2, passed: 2, runningJudged: 2, stoppedJudged: 1 });
  });

  it("reads the final day on the ORG's clock: east of UTC, local midnight is the previous UTC day", async () => {
    // 10/01 00:00 in Tokyo is 09/30 15:00Z; in UTC that instant is still 09/30.
    const r = await readIdleEngineParity(seed({ tz: "Asia/Tokyo", nightlyFrom: "2026-09-30T15:00:00.000Z" }).client, ORG);
    expect(r.finalThrough).toBe("2026-10-01");
  });

  it("a Samsara day that does not cover the whole local day is not compared", async () => {
    // 775 on 10/01: its last state ran on past the sync, so 15.4 h were covered and the idle was short.
    const samsara = (coverage_sec: number) => [{ vehicle_id: "v1", day: "2026-10-01", idle_sec: H, coverage_sec }];
    const days = [ours("v1", "2026-10-01")];
    const partial = await readIdleEngineParity(seed({ days, samsara: samsara(24 * H - 1) }).client, ORG);
    expect(partial.truckDays).toMatchObject({ judged: 1, stoppedJudged: 0 });
    const whole = await readIdleEngineParity(seed({ days, samsara: samsara(24 * H) }).client, ORG);
    expect(whole.truckDays).toMatchObject({ judged: 1, stoppedJudged: 1, stoppedPassed: 0 });
  });

  it("running is all three moving-or-not buckets; stopped running is stopped plus brief", async () => {
    // Drop driving to 5 h: running 9 h vs 10.1 h fails; stopped (3 + 1 = 4 h) still passes.
    const r = await readIdleEngineParity(seed({ days: [ours("v1", "2026-10-01", { driving_sec: 5 * H })] }).client, ORG);
    expect(r.disagreements).toEqual([expect.objectContaining({ unit: "650", failedDays: 1, worstStoppedDiff: expect.closeTo(-0.0244, 4) })]);
    expect(r.disagreements[0]!.worstRunningDiff).toBeCloseTo(9 / 10.1 - 1, 4);
  });

  it("with no finished nightly, nothing is final and nothing else is read", async () => {
    const rec = seed({ nightlyFrom: null });
    const r = await readIdleEngineParity(rec.client, ORG);
    expect(r).toMatchObject({ finalThrough: null, days: [], share: null, pass: false, daysNeeded: 14 });
    expect(rec.forTable("idle_engine_days")).toHaveLength(0);
  });

  it("reads only the latest FINISHED nightly", async () => {
    const rec = seed();
    await readIdleEngineParity(rec.client, ORG);
    const ops = rec.forTable("jobs")[0]!.ops;
    expect(ops).toEqual(expect.arrayContaining([
      { method: "eq", args: ["kind", "idle_engine"] },
      { method: "eq", args: ["status", "done"] },
      { method: "eq", args: ["stats->>mode", "nightly"] },
      { method: "order", args: ["finished_at", { ascending: false }] },
    ]));
  });

  it("scopes every tenant read to the org", async () => {
    const rec = seed();
    await readIdleEngineParity(rec.client, ORG);
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });
});
