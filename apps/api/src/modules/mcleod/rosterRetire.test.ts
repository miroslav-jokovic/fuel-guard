import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { reconcileAbsentFromTms, retireFromTms } from "./rosterRetire.js";

/**
 * Retirement is the one operation here that takes capability away from a person, so nearly every test
 * below is about what it REFUSES to do.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const d = (over: Record<string, unknown> = {}) => ({
  id: "d-1", org_id: ORG, mcleod_driver_id: "D0001", status: "active",
  identity_source: "mcleod", termination_date: null, ...over,
});
const seed = (rows: Record<string, unknown>[]) => createSupabaseRecorder({ tables: { drivers: rows } });

describe("retiring a driver McLeod says has left", () => {
  it("sets the status and stamps the termination date", async () => {
    const rec = seed([d()]);
    const r = await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D0001", status: "terminated", termination_date: "2026-08-18" },
    ]);
    expect(r.retired).toBe(1);
    const p = rec.writtenRows("drivers")[0]!;
    expect(p.status).toBe("terminated");
    expect(p.termination_date).toBe("2026-08-18");
  });

  it("NEVER clears a termination date — a re-hire is reported, not applied", async () => {
    // D-MR7: that date starts a §391.51 retention clock and the evidence tables are append-only.
    const rec = seed([d({ status: "terminated", termination_date: "2025-01-01" })]);
    const r = await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D0001", status: "inactive", termination_date: null },
    ]);
    expect(r.rehires).toEqual(["D0001"]);
    expect(rec.writes()).toEqual([]);
  });

  it("does not move a termination date that is already set", async () => {
    const rec = seed([d({ status: "active", termination_date: "2025-01-01" })]);
    await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D0001", status: "terminated", termination_date: "2026-08-18" },
    ]);
    expect(rec.writtenRows("drivers")[0]!).not.toHaveProperty("termination_date");
  });

  it("stands off a row the office owns", async () => {
    const rec = seed([d({ identity_source: "manual" })]);
    const r = await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D0001", status: "terminated", termination_date: "2026-08-18" },
    ]);
    expect(r.skippedOwned).toEqual(["D0001"]);
    expect(rec.writes()).toEqual([]);
  });

  it("stands off a row the recruiting pipeline owns", async () => {
    // 0213's lifecycle guard exempts the service role, so nothing below this would object.
    const rec = seed([d({ status: "applicant", identity_source: "manual" })]);
    const r = await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D0001", status: "terminated", termination_date: "2026-08-18" },
    ]);
    expect(r.skippedOwned).toEqual(["D0001"]);
    expect(rec.writes()).toEqual([]);
  });

  it("ignores a retirement for a record it never linked — there is nothing to retire", async () => {
    const rec = seed([]);
    const r = await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D9999", status: "terminated", termination_date: "2026-08-18" },
    ]);
    expect(r.unknown).toEqual(["D9999"]);
    expect(rec.writes()).toEqual([]);
  });

  it("is a no-op when the row is already in that state", async () => {
    const rec = seed([d({ status: "terminated", termination_date: "2026-08-18" })]);
    const r = await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D0001", status: "terminated", termination_date: "2026-08-18" },
    ]);
    expect(r.unchanged).toBe(1);
    expect(rec.writes()).toEqual([]);
  });
});

describe("the bad-fetch guard", () => {
  it("refuses the WHOLE call when it would retire more rows than are active", async () => {
    // McLeod holds 1,299 non-active driver records against 164 active ones, so a mis-scoped sweep has
    // an eight-to-one lever on the roster. Refusing wholesale rather than trimming is the point: a
    // payload this size is a broken query, not a layoff, and applying the first N would be worse.
    const rows = [d({ id: "d-1", mcleod_driver_id: "D1" }), d({ id: "d-2", mcleod_driver_id: "D2" })];
    const rec = seed(rows);
    const r = await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D1", status: "terminated", termination_date: "2026-01-01" },
      { external_id: "D2", status: "terminated", termination_date: "2026-01-01" },
      { external_id: "D3", status: "terminated", termination_date: "2026-01-01" },
    ]);
    expect(r.refused).toMatch(/bad fetch/);
    expect(r.retired).toBe(0);
    expect(rec.writes()).toEqual([]);
  });

  it("allows a retirement that stays within the active count", async () => {
    const rows = [
      d({ id: "d-1", mcleod_driver_id: "D1" }),
      d({ id: "d-2", mcleod_driver_id: "D2" }),
      d({ id: "d-3", mcleod_driver_id: "D3" }),
    ];
    const rec = seed(rows);
    const r = await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D1", status: "terminated", termination_date: "2026-01-01" },
    ]);
    expect(r.refused).toBeUndefined();
    expect(r.retired).toBe(1);
  });

  it("org-scopes its read and its writes", async () => {
    const rec = seed([d()]);
    await retireFromTms(rec.client, ORG, "drivers", [
      { external_id: "D0001", status: "terminated", termination_date: "2026-08-18" },
    ]);
    expectOrgScoped(rec, ORG);
  });
});

/**
 * ── THE RETIREMENT PAYLOAD, FOR EQUIPMENT ───────────────────────────────────────────────────────
 * `retireFromTms` had coverage for drivers only, and the vehicle half was a silent no-op the whole
 * time: `tmsRetireInputSchema` carries `inactive | terminated`, `vehicles.status` is the
 * `vehicle_status` enum, and writing the one into the other fails with 22P02 — an error the old
 * `if (!upErr) out.retired++` discarded, so the endpoint reported `retired: 0` and no failure.
 * The reconcile path below maps correctly, which is why nothing noticed.
 */
const veh = (over: Record<string, unknown> = {}) => ({
  id: "v-1", org_id: ORG, mcleod_tractor_id: "T900", status: "active", identity_source: "mcleod", ...over,
});
/** A position row as PostgREST renders one: `timestamptz` with a `+00:00` offset, never a `Z`. */
const fixAt = (msAgo: number) =>
  new Date(Date.now() - msAgo).toISOString().replace("T", " ").replace("Z", "+00:00");
const seedVehicle = (rows: Record<string, unknown>[], positions: Record<string, unknown>[] = []) =>
  createSupabaseRecorder({ tables: { vehicles: rows, vehicle_positions: positions } });

describe("retiring a truck McLeod says has gone", () => {
  it("writes the vocabulary the column actually holds, not the payload's word for a person", async () => {
    const rec = seedVehicle([veh()]);
    const r = await retireFromTms(rec.client, ORG, "vehicles", [
      { external_id: "T900", status: "inactive" },
    ]);
    expect(r.retired).toBe(1);
    expect(r.failed).toEqual([]);
    expect(rec.writtenRows("vehicles")[0]!.status).toBe("retired");
  });

  it("refuses to retire a truck whose gateway reported inside the last 24 hours", async () => {
    // F6. The predicate that produced this payload read `outservice_date`, which this McLeod instance
    // never clears — so it nominated units 552, 555 and 569 while drivers were running them, three
    // trucks whose fixes were minutes old when the plan was measured on 2026-09-22.
    const rec = seedVehicle([veh()], [{ vehicle_id: "v-1", sampled_at: fixAt(2 * 60 * 60 * 1000) }]);
    const r = await retireFromTms(rec.client, ORG, "vehicles", [
      { external_id: "T900", status: "inactive" },
    ]);
    expect(r.heldMoving).toEqual(["T900"]);
    expect(r.retired).toBe(0);
    expect(rec.writtenRows("vehicles")).toHaveLength(0);
  });

  it("retires a truck whose last fix is older than the window", async () => {
    // The guard is a contradiction test, not a veto: a gateway that came out three days ago no longer
    // says anything, and the truck retires with no human in the loop.
    const rec = seedVehicle([veh()], [{ vehicle_id: "v-1", sampled_at: fixAt(3 * 24 * 60 * 60 * 1000) }]);
    const r = await retireFromTms(rec.client, ORG, "vehicles", [
      { external_id: "T900", status: "inactive" },
    ]);
    expect(r.heldMoving).toEqual([]);
    expect(r.retired).toBe(1);
  });

  it("leaves a truck that is already out of the operating fleet alone", async () => {
    // An `ordered` row whose reservation McLeod cancelled: nothing to take away, and clearing a
    // reservation is F5/E6's question rather than a side effect of a retirement sweep.
    const rec = seedVehicle([veh({ status: "ordered" })]);
    const r = await retireFromTms(rec.client, ORG, "vehicles", [
      { external_id: "T900", status: "inactive" },
    ]);
    expect(r.retired).toBe(0);
    expect(r.unchanged).toBe(1);
    expect(rec.writtenRows("vehicles")).toHaveLength(0);
  });

  it("counts a truck in the shop as part of the fleet the bad-fetch cap is measured against", async () => {
    /**
     * Three of this org's four trucks are in a shop, and the payload asks for all three. That is a
     * broken query however the trucks are parked, and the cap refuses the whole call.
     *
     * Spelling the denominator `=== "active"` instead of asking `IN_SERVICE_VEHICLE_STATUSES` — which
     * is what this file said until 2026-09-22, and what the E3 audit converted line 191 but not line
     * 97 for — makes the cap read a one-truck fleet and a payload of zero: the guard falls silent and
     * all three are retired. That is the mutation this test exists to fail on (D-FC11).
     */
    const rec = seedVehicle([
      veh({ id: "v-1", mcleod_tractor_id: "T1", status: "maintenance" }),
      veh({ id: "v-2", mcleod_tractor_id: "T2", status: "maintenance" }),
      veh({ id: "v-3", mcleod_tractor_id: "T3", status: "maintenance" }),
      veh({ id: "v-4", mcleod_tractor_id: "T4" }),
    ]);
    const r = await retireFromTms(rec.client, ORG, "vehicles", [
      { external_id: "T1", status: "inactive" },
      { external_id: "T2", status: "inactive" },
      { external_id: "T3", status: "inactive" },
    ]);
    expect(r.refused).toMatch(/bad fetch/);
    expect(r.retired).toBe(0);
    expect(rec.writtenRows("vehicles")).toHaveLength(0);
  });

  it("org-scopes its read and its writes", async () => {
    const rec = seedVehicle([veh()]);
    await retireFromTms(rec.client, ORG, "vehicles", [
      { external_id: "T900", status: "inactive" },
    ]);
    expectOrgScoped(rec, ORG);
  });
});

/**
 * `reconcileAbsentFromTms` had NO coverage, and the one-way trap it carried could only have been
 * found by reading it: the vehicle branch asked `row.status === "active"`, so the first row ever
 * written with `maintenance` — a value that has sat in the `vehicle_status` enum since migration
 * 0001 with nothing ever writing it — would have become permanently un-retirable. McLeod reports 12
 * trucks in a shop; the sweep would have declined to touch them, silently, every day, for as long
 * as McLeod kept reporting them gone (D-FC11, plan §4a G2).
 */
const ORG2 = ORG;
const v = (over: Record<string, unknown> = {}) => ({
  id: "v-1", org_id: ORG2, mcleod_tractor_id: "T900", status: "active", ...over,
});
/** The reconcile refuses a roster under 50 rows outright, so the payload has to clear that floor. */
const fiftyOthers = Array.from({ length: 50 }, (_, i) => `T${i + 1}`);

describe("reconciling vehicles McLeod no longer carries", () => {
  it("retires a truck that is in the SHOP, not only one that is on the road", async () => {
    const rec = createSupabaseRecorder({ tables: { vehicles: [v({ status: "maintenance" })] } });
    const r = await reconcileAbsentFromTms(rec.client, ORG2, "vehicles", fiftyOthers);
    expect(r.refused).toBeUndefined();
    expect(r.retired).toBe(1);
    expect(rec.writtenRows("vehicles")[0]!.status).toBe("retired");
  });

  it("still retires an ordinary active truck", async () => {
    const rec = createSupabaseRecorder({ tables: { vehicles: [v()] } });
    const r = await reconcileAbsentFromTms(rec.client, ORG2, "vehicles", fiftyOthers);
    expect(r.retired).toBe(1);
  });

  it("leaves a truck alone once it is already retired", async () => {
    const rec = createSupabaseRecorder({ tables: { vehicles: [v({ status: "retired" })] } });
    const r = await reconcileAbsentFromTms(rec.client, ORG2, "vehicles", fiftyOthers);
    expect(r.retired).toBe(0);
    expect(rec.writtenRows("vehicles")).toHaveLength(0);
  });

  it("holds back a truck the telematics feed saw this morning, and says so", async () => {
    // F6 matters MORE here than on the payload path: absence is a weaker claim than a nomination, and
    // a truck falls out of this reconciliation for any reason the ACTIVE predicate is narrow — which
    // is exactly what F1 changed in the same merge.
    const rec = createSupabaseRecorder({
      tables: {
        vehicles: [v()],
        vehicle_positions: [{ vehicle_id: "v-1", sampled_at: fixAt(90 * 60 * 1000) }],
      },
    });
    const r = await reconcileAbsentFromTms(rec.client, ORG2, "vehicles", fiftyOthers);
    expect(r.retired).toBe(0);
    expect(r.heldMoving).toEqual(["v-1"]);
    expect(rec.writtenRows("vehicles")).toHaveLength(0);
  });

  it("records the contradiction in the audit row even when nothing changed", async () => {
    // A sweep that changed nothing BECAUSE the guard held everything is what a wrong predicate looks
    // like from the inside, and the agent's response is read on the carrier's network and discarded.
    const rec = createSupabaseRecorder({
      tables: {
        vehicles: [v()],
        vehicle_positions: [{ vehicle_id: "v-1", sampled_at: fixAt(60 * 1000) }],
      },
    });
    await reconcileAbsentFromTms(rec.client, ORG2, "vehicles", fiftyOthers);
    const audit = rec.writtenRows("audit_logs")[0] as { meta?: { heldMoving?: string[] } } | undefined;
    expect(audit?.meta?.heldMoving).toEqual(["v-1"]);
  });

  it("org-scopes its read and its writes", async () => {
    const rec = createSupabaseRecorder({ tables: { vehicles: [v({ status: "maintenance" })] } });
    await reconcileAbsentFromTms(rec.client, ORG2, "vehicles", fiftyOthers);
    expectOrgScoped(rec, ORG2);
  });
});
