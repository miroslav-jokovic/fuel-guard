import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { judgeSchedule, readPmDueFleet } from "./pmDue.js";

/**
 * Every PM schedule judged for the truck's page and the worklist (F11, M3).
 *
 *   1. A schedule's verdict is the WORST of its intervals — "every 6 months or 20,000 mi" is due
 *      when either is.
 *   2. A schedule nobody can judge has verdict NULL, not "ok": never done, or a mileage interval on a
 *      unit with no odometer. F11's done-when, one level down.
 *   3. The annual is left out (Q-DBV2); "PM Reefer" is in, under its own name.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-28T15:00:00.000Z");
const MI = 1609.344;

const schedule = (id: string, name: string, lastDone: string | null = null, unit = "fp-1") => ({ fleetpal_id: id, unit_fleetpal_id: unit, name, last_done: lastDone });
const odo = (id: string, lastDoneMiles: number) => ({
  pm_schedule_fleetpal_id: id, interval_type: "ODOMETER", value_int: 20_000 * MI, value_time_type: null, threshold_int: 7_000 * MI, threshold_time_type: null, last_done_meter_value: lastDoneMiles * MI,
});
const months = (id: string, n: number) => ({
  pm_schedule_fleetpal_id: id, interval_type: "TIME", value_int: n, value_time_type: "MONTH", threshold_int: 30, threshold_time_type: "DAY", last_done_meter_value: null,
});

describe("judgeSchedule", () => {
  it("takes the worst interval as the schedule's verdict", () => {
    // Time: done 2026-05-01, every 6 months → due 2026-11-01, inside the 30-day window → due.
    // Miles: done at 100,000, due at 120,000, odometer 125,000 → overdue by 5,000.
    const s = judgeSchedule(schedule("a", "6-Month Inspection", "2026-05-01T00:00:00Z"), [months("a", 6), odo("a", 100_000)], 125_000, NOW);
    expect(s.verdict).toBe("overdue");
    expect(s.intervals).toEqual([
      { intervalType: "time", verdict: "due", dueOn: "2026-11-01", dueAtMiles: null, milesLeft: null },
      { intervalType: "odometer", verdict: "overdue", dueOn: null, dueAtMiles: 120_000, milesLeft: -5_000 },
    ]);
  });

  it("⚠ says null, not ok, for a schedule it cannot judge", () => {
    expect(judgeSchedule(schedule("a", "Oil Change"), [odo("a", 100_000)], null, NOW).verdict).toBeNull();
    expect(judgeSchedule(schedule("a", "Oil Change", null), [months("a", 6)], 100, NOW).verdict).toBeNull();
    expect(judgeSchedule(schedule("a", "Oil Change", "2026-10-01T00:00:00Z"), [], 100, NOW).verdict).toBeNull();
  });

  it("is ok with room left, and keeps FleetPal's own name and kind", () => {
    const s = judgeSchedule(schedule("a", "PM Reefer", "2026-10-01T00:00:00Z"), [months("a", 6)], null, NOW);
    expect(s).toMatchObject({ name: "PM Reefer", kind: "other", verdict: "ok" });
  });
});

describe("readPmDueFleet", () => {
  it("judges every matched unit's non-annual schedules on the roster's odometer, skips the annual, and lists a matched unit with none", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        fleetpal_units: { data: [{ fleetpal_id: "fp-1", vehicle_id: "veh-1", trailer_id: null }, { fleetpal_id: "fp-2", vehicle_id: null, trailer_id: "tr-2" }, { fleetpal_id: "fp-x", vehicle_id: null, trailer_id: null }, { fleetpal_id: "fp-3", vehicle_id: "veh-3", trailer_id: null }] },
        fleetpal_pm_schedules: { data: [schedule("a", "Oil Change"), schedule("b", "Annual DOT Inspection", "2026-01-01T00:00:00Z"), schedule("c", "PM Reefer", "2026-03-01T00:00:00Z", "fp-2"), schedule("d", "Oil Change", null, "fp-x")] },
        fleetpal_pm_intervals: { data: [odo("a", 100_000), months("b", 12), months("c", 6)] },
      },
    });
    const out = await readPmDueFleet(rec.client, ORG, new Map([["veh-1", 118_000]]), NOW);
    expectOrgScoped(rec, ORG);
    expect(out.map((u) => [u.unit.fleetpal_id, u.schedules.map((s) => [s.name, s.verdict])])).toEqual([
      ["fp-1", [["Oil Change", "due"]]],
      ["fp-2", [["PM Reefer", "overdue"]]],
      ["fp-3", []],
    ]);
  });
});
