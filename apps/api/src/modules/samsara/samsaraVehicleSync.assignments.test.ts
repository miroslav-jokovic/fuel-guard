// The driver-assignment pass of the vehicle sync: one truck per driver (driverTrucks.ts). Built from
// the production state of 2026-10-12, when 23 drivers were assigned to two trucks each.
import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { syncVehiclesFromSamsara } from "./samsaraVehicleSync.js";

const ORG = "org-1";
const noVehicles = async () => [];
const noStats = async () => ({ data: [] });

function run(vehicles: unknown[], assignments: unknown[]) {
  const rec = createSupabaseRecorder({
    tables: {
      vehicles: { data: vehicles },
      drivers: {
        data: [
          { id: "d-gromeo", samsara_driver_id: "s-gromeo" },
          { id: "d-bmorgan", samsara_driver_id: "s-bmorgan" },
          { id: "d-elsewhere", samsara_driver_id: "s-elsewhere" },
        ],
      },
      driver_vehicle_assignments: { data: [] },
    },
  });
  const done = syncVehiclesFromSamsara(rec.client, {} as never, ORG, noVehicles as never, noStats as never, async () => ({
    data: assignments,
  }));
  return { rec, done };
}

/** Every write to `vehicles.assigned_driver_id`, with the filters it carried. */
function driverWrites(rec: ReturnType<typeof createSupabaseRecorder>) {
  return rec
    .forTable("vehicles")
    .filter((q) => q.write?.method === "update" && "assigned_driver_id" in (q.write.payload as object))
    .map((q) => ({
      driver: (q.write!.payload as { assigned_driver_id: string | null }).assigned_driver_id,
      filters: Object.fromEntries(q.filters().map((f) => [f.col, f.val])),
    }));
}

const truck = (id: string, samsaraId: string | null, driver: string | null) => ({
  id,
  samsara_vehicle_id: samsaraId,
  assigned_driver_id: driver,
  unit_number: id,
  status: "active",
  vin: null,
  samsara_missing_since: null,
});

describe("syncVehiclesFromSamsara — driver assignments", () => {
  it("moves a driver onto their current truck and takes them off the truck they left", async () => {
    const { rec, done } = run(
      [
        truck("506", "sv-506", "d-gromeo"),
        truck("807", "sv-807", null),
        truck("552", "sv-552", "d-bmorgan"),
        truck("669", "sv-669", "d-bmorgan"),
      ],
      [
        // Newest first, so a pass that let the last row win would keep the trucks they LEFT.
        { vehicle: { id: "sv-807" }, driver: { id: "s-gromeo" }, startTime: "2026-10-12T12:05:02Z" },
        { vehicle: { id: "sv-669" }, driver: { id: "s-bmorgan" }, startTime: "2026-10-12T12:27:43Z" },
        { vehicle: { id: "sv-552" }, driver: { id: "s-bmorgan" }, startTime: "2026-09-29T21:37:39Z" },
        { vehicle: { id: "sv-506" }, driver: { id: "s-gromeo" }, startTime: "2026-09-18T20:14:11Z" },
      ],
    );
    const result = await done;

    expect(result.assigned).toBe(2);
    expect(driverWrites(rec)).toEqual([
      // 807 gains George; 669 already carries Byron, so it is not rewritten.
      { driver: "d-gromeo", filters: { id: "807", org_id: ORG } },
      // The trucks they left are cleared — each write repeats the driver it expects to find.
      { driver: null, filters: { id: "506", org_id: ORG, assigned_driver_id: "d-gromeo" } },
      { driver: null, filters: { id: "552", org_id: ORG, assigned_driver_id: "d-bmorgan" } },
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("clears a driver from a truck with no Samsara link once Samsara places them elsewhere", async () => {
    const { rec, done } = run(
      [truck("manual", null, "d-gromeo"), truck("807", "sv-807", "d-gromeo")],
      [{ vehicle: { id: "sv-807" }, driver: { id: "s-gromeo" }, startTime: "2026-10-12T12:05:02Z" }],
    );
    await done;
    expect(driverWrites(rec)).toEqual([
      { driver: null, filters: { id: "manual", org_id: ORG, assigned_driver_id: "d-gromeo" } },
    ]);
  });

  it("leaves a driver alone when the truck Samsara puts them in is not one we carry", async () => {
    const { rec, done } = run(
      [truck("700", "sv-700", "d-elsewhere")],
      [{ vehicle: { id: "sv-not-ours" }, driver: { id: "s-elsewhere" }, startTime: "2026-10-12T00:00:00Z" }],
    );
    const result = await done;
    expect(result.assigned).toBe(0);
    expect(driverWrites(rec)).toEqual([]);
  });

  it("leaves every truck alone when Samsara returns no assignments", async () => {
    const { rec, done } = run([truck("506", "sv-506", "d-gromeo")], []);
    await done;
    expect(driverWrites(rec)).toEqual([]);
  });
});
