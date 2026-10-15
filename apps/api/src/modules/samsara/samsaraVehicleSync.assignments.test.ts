// The driver-assignment pass of the vehicle sync: one truck per driver (driverTrucks.ts). Built from
// the production state of 2026-10-12, when 23 drivers were assigned to two trucks each.
import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { syncVehiclesFromSamsara } from "./samsaraVehicleSync.js";

const ORG = "org-1";
const noVehicles = async () => [];
const noStats = async () => ({ data: [] });

const driver = (id: string, samsaraId: string | null, over: Record<string, unknown> = {}) => ({
  id, samsara_driver_id: samsaraId, status: "active", archived_at: null, ...over,
});
const ROSTER = [driver("d-gromeo", "s-gromeo"), driver("d-bmorgan", "s-bmorgan"), driver("d-elsewhere", "s-elsewhere")];

function run(vehicles: unknown[], assignments: unknown[], drivers: unknown[] = ROSTER) {
  const rec = createSupabaseRecorder({
    tables: {
      vehicles: { data: vehicles },
      drivers: { data: drivers },
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

  it("does not let a trailer hooked in the same second take a driver off their truck", async () => {
    // JBURK on 2026-10-12: truck 796 and trailer R533129, both 13:11. The trailer is no vehicle we carry.
    const { rec, done } = run(
      [truck("550", "sv-550", "d-gromeo"), truck("796", "281475006180758", null)],
      [
        { vehicle: { id: "281474978756816" }, driver: { id: "s-gromeo" }, startTime: "2026-10-12T13:11:00Z" },
        { vehicle: { id: "281475006180758" }, driver: { id: "s-gromeo" }, startTime: "2026-10-12T13:11:00Z" },
        { vehicle: { id: "sv-550" }, driver: { id: "s-gromeo" }, startTime: "2026-09-09T10:00:00Z" },
      ],
    );
    await done;
    expect(driverWrites(rec)).toEqual([
      { driver: "d-gromeo", filters: { id: "796", org_id: ORG } },
      { driver: null, filters: { id: "550", org_id: ORG, assigned_driver_id: "d-gromeo" } },
    ]);
  });

  it("keeps a team driver in the truck they share and takes them off the one they left (799, 2026-10-12)", async () => {
    // d-bmorgan stands in for Keno Williams; s-teammate is JFERGUSO, whom our roster does not carry.
    const { rec, done } = run(
      [truck("586", "sv-586", "d-bmorgan"), truck("799", "sv-799", "d-bmorgan")],
      [
        { vehicle: { id: "sv-799" }, driver: { id: "s-teammate" }, startTime: "2026-10-10T16:36:00Z" },
        { vehicle: { id: "sv-799" }, driver: { id: "s-bmorgan" }, startTime: "2026-10-10T04:22:00Z" },
        { vehicle: { id: "sv-586" }, driver: { id: "s-bmorgan" }, startTime: "2026-09-15T17:06:00Z" },
      ],
    );
    await done;
    expect(driverWrites(rec)).toEqual([
      { driver: null, filters: { id: "586", org_id: ORG, assigned_driver_id: "d-bmorgan" } },
    ]);
  });

  it("never seats a driver who is terminated, inactive or archived — and seats the active one behind them", async () => {
    // 2026-10-12: a retire run would have terminated KBOISSEA, the latest driver Samsara had in 647.
    const { rec, done } = run(
      [truck("647", "sv-647", null)],
      [
        { vehicle: { id: "sv-647" }, driver: { id: "s-former" }, startTime: "2026-10-08T20:09:00Z" },
        { vehicle: { id: "sv-647" }, driver: { id: "s-archived" }, startTime: "2026-10-07T20:09:00Z" },
        { vehicle: { id: "sv-647" }, driver: { id: "s-gromeo" }, startTime: "2026-09-14T19:47:00Z" },
      ],
      [driver("d-former", "s-former", { status: "terminated" }), driver("d-archived", "s-archived", { archived_at: "2026-10-01T00:00:00Z" }), driver("d-gromeo", "s-gromeo")],
    );
    await done;
    expect(driverWrites(rec)).toEqual([{ driver: "d-gromeo", filters: { id: "647", org_id: ORG } }]);
  });

  it("takes a former driver off a truck they still hold, whoever wrote it — 563, 578, 809 on 2026-10-12", async () => {
    const { rec, done } = run(
      [truck("563", "sv-563", "d-mabrown"), truck("809", null, "d-term"), truck("700", "sv-700", "d-leave")],
      [{ vehicle: { id: "sv-807" }, driver: { id: "s-gromeo" }, startTime: "2026-10-12T12:05:02Z" }],
      [
        driver("d-mabrown", "s-mabrown", { status: "inactive", archived_at: "2026-09-14T19:11:20Z" }),
        driver("d-term", null, { status: "terminated" }),
        // On leave: still ours, still their truck.
        driver("d-leave", "s-leave", { status: "on_leave" }),
        driver("d-gromeo", "s-gromeo"),
      ],
    );
    await done;
    expect(driverWrites(rec)).toEqual([
      { driver: null, filters: { id: "563", org_id: ORG, assigned_driver_id: "d-mabrown" } },
      { driver: null, filters: { id: "809", org_id: ORG, assigned_driver_id: "d-term" } },
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("leaves a truck alone when its driver is not in the roster read — unknown is not former", async () => {
    const { rec, done } = run(
      [truck("700", "sv-700", "d-unknown")],
      [{ vehicle: { id: "sv-807" }, driver: { id: "s-gromeo" }, startTime: "2026-10-12T12:05:02Z" }],
    );
    await done;
    expect(driverWrites(rec)).toEqual([]);
  });

  it("leaves every truck alone when Samsara returns no assignments", async () => {
    const { rec, done } = run([truck("506", "sv-506", "d-gromeo")], []);
    await done;
    expect(driverWrites(rec)).toEqual([]);
  });

  it("records a team truck's second driver, naming the value it expects to replace (0475)", async () => {
    // 729 on 2026-10-15: both of the team in the truck; one seat; the teammate had no truck at all.
    const team = [driver("d-feagin", "s-feagin"), driver("d-sital", "s-sital")];
    const { rec, done } = run(
      [{ ...truck("729", "sv-729", "d-feagin"), co_driver_id: null }],
      [
        { vehicle: { id: "sv-729" }, driver: { id: "s-feagin" }, startTime: "2026-09-15T15:22:00Z" },
        { vehicle: { id: "sv-729" }, driver: { id: "s-sital" }, startTime: "2026-10-09T11:48:00Z" },
        { vehicle: { id: "sv-729" }, driver: { id: "s-feagin" }, startTime: "2026-10-10T06:00:00Z" },
      ],
      team,
    );
    await done;
    const writes = rec
      .forTable("vehicles")
      .filter((q) => q.write?.method === "update" && "co_driver_id" in (q.write.payload as object))
      .map((q) => ({ payload: q.write!.payload, filters: Object.fromEntries(q.filters().map((f) => [f.col, f.val])), ops: q.ops.map((o) => o.method) }));
    expect(writes).toHaveLength(1);
    expect(writes[0]!.payload).toEqual({ co_driver_id: "d-sital" });
    expect(writes[0]!.filters).toMatchObject({ id: "729", org_id: ORG });
    expect(writes[0]!.ops).toContain("is"); // expects the seat still empty
    expect(driverWrites(rec)).toEqual([]); // the first seat was already right
    expectOrgScoped(rec, ORG);
  });
});
