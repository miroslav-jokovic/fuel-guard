import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { readUnitMaintenance } from "./unitMaintenance.js";

/**
 * FleetPal's half of the board's Warnings column (DISPATCH-BOARD-V2-PLAN D-DBV5).
 *
 * ── THE ASSERTION THIS FILE EXISTS FOR ──────────────────────────────────────────────────────────
 * A unit can carry two schedules of one kind — production has typo'd duplicates ("Oil Change" and
 * "Oil Chnage" on one truck, 2026-10-16) — and the board shows ONE chip per kind. Which one is the
 * whole question: keep the milder and a truck 5,000 mi past its oil change reads "due in 2,000 mi".
 * Each case runs with the schedules in both orders, because a tie-break that merely keeps the first
 * (or the last) it saw passes any single ordering.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-16T15:00:00.000Z");
const MI = 1609.344;
const ODOMETER = 120_000;

const unit = { fleetpal_id: "fp-773", vehicle_id: "veh-773", trailer_id: null };
const schedule = (id: string, name: string, lastDone: string | null = null) =>
  ({ fleetpal_id: id, unit_fleetpal_id: "fp-773", name, last_done: lastDone });
// Every 20,000 mi, warn inside 7,000 — the production oil interval, stored in metres.
const oilInterval = (id: string, lastDoneMiles: number) => ({
  pm_schedule_fleetpal_id: id, interval_type: "ODOMETER", value_int: 20_000 * MI, value_time_type: null,
  threshold_int: 7_000 * MI, threshold_time_type: null, last_done_meter_value: lastDoneMiles * MI,
});
// Every 6 months, warn inside 30 days — the production 6-month interval.
const sixMonthInterval = (id: string) => ({
  pm_schedule_fleetpal_id: id, interval_type: "TIME", value_int: 6, value_time_type: "MONTH",
  threshold_int: 30, threshold_time_type: "DAY", last_done_meter_value: null,
});

async function read(schedules: unknown[], intervals: unknown[]) {
  const rec = createSupabaseRecorder({
    tables: {
      fleetpal_units: { data: [unit] },
      fleetpal_pm_schedules: { data: schedules },
      fleetpal_pm_intervals: { data: intervals },
      fleetpal_work_orders: { data: [] },
    },
  });
  const out = await readUnitMaintenance(rec.client, ORG, new Map([["veh-773", ODOMETER]]), NOW);
  expectOrgScoped(rec, ORG);
  return out.byVehicleId.get("veh-773");
}

const both = <T>(xs: T[]) => [xs, [...xs].reverse()];

describe("two schedules of one kind on one unit", () => {
  it("⚠ show the overdue one, whichever FleetPal lists first", async () => {
    const schedules = [schedule("a", "Oil Change"), schedule("b", "Oil Chnage")];
    // a: due at 122,000 → 2,000 mi left (due). b: due at 115,000 → 5,000 mi past (overdue).
    const intervals = [oilInterval("a", 102_000), oilInterval("b", 95_000)];
    for (const s of both(schedules)) {
      expect(await read(s, intervals)).toEqual([
        { unit: "truck", kind: "oil", verdict: "overdue", dueOn: null, milesLeft: -5_000 },
      ]);
    }
  });

  it("show the one with fewer miles left when both are due", async () => {
    const schedules = [schedule("a", "Oil Change"), schedule("b", "Oil Chnage")];
    // a: 5,000 mi left. b: 2,000 mi left. Both inside the 7,000 mi window.
    const intervals = [oilInterval("a", 105_000), oilInterval("b", 102_000)];
    for (const s of both(schedules)) {
      expect(await read(s, intervals)).toEqual([
        { unit: "truck", kind: "oil", verdict: "due", dueOn: null, milesLeft: 2_000 },
      ]);
    }
  });

  it("show the one falling due sooner when both are dated", async () => {
    // a: due 2026-11-05. b: due 2026-10-20. Both inside the 30-day window.
    const schedules = [schedule("a", "6-Month Inspection", "2026-05-05T00:00:00Z"), schedule("b", "6 Month Insp", "2026-04-20T00:00:00Z")];
    const intervals = [sixMonthInterval("a"), sixMonthInterval("b")];
    for (const s of both(schedules)) {
      expect(await read(s, intervals)).toEqual([
        { unit: "truck", kind: "six_month", verdict: "due", dueOn: "2026-10-20", milesLeft: null },
      ]);
    }
  });
});
