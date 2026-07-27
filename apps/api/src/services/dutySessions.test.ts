import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { changeEquipment, endShift, getEquipmentPickList, startShift } from "./dutySessions.js";

/**
 * The conflict envelope is user-facing: when a driver picks a truck someone else is in, the sheet
 * renders WHO has it and SINCE WHEN, and only then may offer take-over (D44.6). A silent steal
 * corrupts a week of fuel and idle attribution for two drivers at once, so the mapping from the
 * SQLSTATEs raised by 0086 to that envelope is worth pinning down.
 *
 * These use a hand-rolled Supabase stub rather than a live DB — the SQL logic itself is covered by
 * `supabase/tests/duty-sessions.test.mjs` against real Postgres.
 */

type TableRows = Record<string, unknown[]>;

/** Minimal chainable stand-in for the PostgREST builder: every filter is a no-op, the rows are fixed. */
function stubAdmin(opts: { rpcError?: { code: string; message: string }; tables?: TableRows }): SupabaseClient {
  const tables = opts.tables ?? {};
  const builder = (rows: unknown[]): Record<string, unknown> => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "order", "not", "neq", "gte", "lte"]) {
      self[m] = () => self;
    }
    self.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    self.single = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    self.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null });
    return self;
  };
  return {
    from: (table: string) => builder(tables[table] ?? []),
    rpc: () => Promise.resolve({ data: null, error: opts.rpcError ?? null }),
  } as unknown as SupabaseClient;
}

const ORG = "00000000-0000-4000-8000-0000000000f0";
const DRIVER = "00000000-0000-4000-8000-0000000000d1";
const VEH = "00000000-0000-4000-8000-000000000001";
const TRL = "00000000-0000-4000-8000-000000000011";

const startInput = {
  session_id: "00000000-0000-4000-8000-0000000000a1",
  segment_id: "00000000-0000-4000-8000-0000000000a2",
  vehicle_id: VEH,
  take_over: false,
};

describe("startShift — conflict mapping", () => {
  it("turns DG001 into a 409 naming the unit, the holder and the time", async () => {
    const admin = stubAdmin({
      rpcError: { code: "DG001", message: "vehicle 214 in use" },
      tables: {
        vehicles: [{ unit_number: "214" }],
        duty_equipment_segments: [
          { from_at: "2026-07-27T06:12:00.000Z", drivers: { full_name: "J. Rivera" } },
        ],
      },
    });

    const res = await startShift(admin, ORG, DRIVER, startInput);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.code).toBe("vehicle_in_use");
    expect(res.conflict).toEqual({
      code: "vehicle_in_use",
      unit_number: "214",
      held_by: "J. Rivera",
      held_since: "2026-07-27T06:12:00.000Z",
    });
    expect(res.message).toContain("214");
  });

  it("turns DG002 into a trailer conflict", async () => {
    const admin = stubAdmin({
      rpcError: { code: "DG002", message: "trailer in use" },
      tables: {
        trailers: [{ unit_number: "5521" }],
        duty_equipment_segments: [{ from_at: "2026-07-27T09:00:00.000Z", drivers: [{ full_name: "A. Kim" }] }],
      },
    });

    const res = await startShift(admin, ORG, DRIVER, { ...startInput, trailer_id: TRL });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("trailer_in_use");
    expect(res.conflict?.held_by).toBe("A. Kim");
  });

  it("reports an already-open shift without inventing a holder", async () => {
    const admin = stubAdmin({ rpcError: { code: "DG003", message: "shift already open" } });
    const res = await startShift(admin, ORG, DRIVER, startInput);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.conflict).toEqual({
      code: "shift_already_open",
      unit_number: null,
      held_by: null,
      held_since: null,
    });
  });

  it("maps an out-of-fleet unit to 404, not a conflict", async () => {
    const admin = stubAdmin({ rpcError: { code: "DG005", message: "vehicle not found in org" } });
    const res = await startShift(admin, ORG, DRIVER, startInput);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(404);
    expect(res.code).toBe("equipment_not_found");
  });

  it("rethrows an unrecognised database error instead of swallowing it as a conflict", async () => {
    const admin = stubAdmin({ rpcError: { code: "57014", message: "statement timeout" } });
    await expect(startShift(admin, ORG, DRIVER, startInput)).rejects.toThrow("statement timeout");
  });
});

describe("changeEquipment / endShift", () => {
  it("tells a driver with no open shift to check in first", async () => {
    const admin = stubAdmin({ rpcError: { code: "DG004", message: "no active shift" } });
    const res = await changeEquipment(admin, ORG, DRIVER, {
      segment_id: startInput.segment_id,
      trailer_id: TRL,
      clear_trailer: false,
      take_over: false,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("no_active_shift");
    expect(res.status).toBe(409);
  });

  it("treats a replayed sign-off as success, not an error", async () => {
    const res = await endShift(stubAdmin({}), ORG, DRIVER, {});
    expect(res).toEqual({ ok: true, session: null });
  });
});

describe("getEquipmentPickList", () => {
  const admin = stubAdmin({
    tables: {
      vehicles: [
        { id: VEH, unit_number: "214", make: "Freightliner", model: "Cascadia", status: "active", assigned_driver_id: DRIVER },
        { id: "v2", unit_number: "219", make: null, model: null, status: "active", assigned_driver_id: null },
        { id: "v3", unit_number: "900", make: null, model: null, status: "retired", assigned_driver_id: null },
        { id: "v4", unit_number: "901", make: null, model: null, status: "maintenance", assigned_driver_id: null },
      ],
      trailers: [{ id: TRL, unit_number: "5521", make: null, model: null, status: "active" }],
      duty_equipment_segments: [
        { vehicle_id: "v2", trailer_id: TRL, from_at: "2026-07-27T06:12:00.000Z", drivers: { full_name: "J. Rivera" } },
      ],
    },
  });

  it("pins the driver's domicile truck as the default", async () => {
    const list = await getEquipmentPickList(admin, ORG, DRIVER);
    expect(list.vehicles.find((v) => v.unit_number === "214")?.is_default).toBe(true);
    expect(list.vehicles.find((v) => v.unit_number === "219")?.is_default).toBe(false);
  });

  it("marks units already checked out so the sheet can warn before the 409", async () => {
    const list = await getEquipmentPickList(admin, ORG, DRIVER);
    expect(list.vehicles.find((v) => v.unit_number === "219")).toMatchObject({
      in_use_by: "J. Rivera",
      in_use_since: "2026-07-27T06:12:00.000Z",
    });
    expect(list.trailers[0]?.in_use_by).toBe("J. Rivera");
  });

  it("hides retired equipment but keeps units in maintenance selectable", async () => {
    const list = await getEquipmentPickList(admin, ORG, DRIVER);
    const units = list.vehicles.map((v) => v.unit_number);
    expect(units).not.toContain("900");
    expect(units).toContain("901");
  });

  it("carries no odometer, capacity or cost data — RLS stays closed for a reason", async () => {
    const list = await getEquipmentPickList(admin, ORG, DRIVER);
    expect(Object.keys(list.vehicles[0] ?? {}).sort()).toEqual(
      ["id", "in_use_by", "in_use_since", "is_default", "make", "model", "unit_number"].sort(),
    );
  });
});
