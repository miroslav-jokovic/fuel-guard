import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { projectDispatchMovements, relinkDispatchMovements } from "./dispatchProjection.js";

/**
 * LOADS-ACTIVITY-PLAN D-LA2 (both seats of a team) and D-LA3 (a link that resolves later is re-made).
 * The shapes are production's of 2026-10-19: team movement KDIXON + MHOUSTON, a delivered load whose
 * driver joined the roster after it closed, and JFERGUSO, a code the roster never carries.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DIXON = "d0000000-0000-4000-8000-000000000001";
const HOUSTON = "d0000000-0000-4000-8000-000000000002";
const TRUCK = "v0000000-0000-4000-8000-000000000001";
const SINCE = "2026-08-20T00:00:00.000Z";

const movement = (id: string, codes: string[], over: Record<string, unknown> = {}) => ({
  company_id: "TMS", movement_id: id, order_id: `0136${id}`, movement_status: "D", loaded: "L",
  dispatcher_user_id: "romann", driver_codes: codes, tractor_id: "809", trailer_id: null, trailer_type: "V",
  commodity: null, customer_id: null, customer_name: null, weight: null, weight_um: null, pieces: null,
  consignee_refno: null, move_distance: null, closed_at: "2026-10-14T18:00:00.000Z", ...over,
});
const filter = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;

function rig(opts: { movements: ReturnType<typeof movement>[]; links: Record<string, unknown>[] }) {
  return createSupabaseRecorder({
    tables: {
      // The relink pass pages the codes; the projection reads movements back by id.
      mcleod_dispatch_movements: (q) => {
        const ids = filter(q, "movement_id") as string[] | undefined;
        return ids ? opts.movements.filter((m) => ids.includes(m.movement_id)) : { pages: [opts.movements] };
      },
      mcleod_dispatch_stops: [],
      drivers: { pages: [[{ id: DIXON, employee_id: null, mcleod_driver_id: "KDIXON" }, { id: HOUSTON, employee_id: null, mcleod_driver_id: "MHOUSTON" }]] },
      vehicles: { pages: [[{ id: TRUCK, unit_number: "809" }]] },
      trailers: { pages: [[]] },
      loads: (q) => (q.write ? [] : q.ops.some((o) => o.method === "select" && String(o.args[0]).includes("co_driver_id")) ? opts.links : opts.links.map((l) => ({ id: `id-${String(l.external_id)}`, status: "delivered", external_id: l.external_id }))),
      load_stops: [],
      load_events: [],
    },
  });
}

describe("projectDispatchMovements, a team movement (D-LA2)", () => {
  it("writes the second McLeod driver as the load's co-driver, beside the first as its driver", async () => {
    const rec = rig({ movements: [movement("293773", ["KDIXON", "MHOUSTON"])], links: [{ external_id: "TMS:293773" }] });
    await projectDispatchMovements(rec.client, ORG, "mcleod", "TMS", ["293773"]);
    const written = rec.writtenRows("loads");
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ driver_id: DIXON, co_driver_id: HOUSTON, vehicle_id: TRUCK });
    expectOrgScoped(rec, ORG);
  });

  it("writes no co-driver on a solo run", async () => {
    const rec = rig({ movements: [movement("293774", ["KDIXON"])], links: [{ external_id: "TMS:293774" }] });
    await projectDispatchMovements(rec.client, ORG, "mcleod", "TMS", ["293774"]);
    expect(rec.writtenRows("loads")[0]).toMatchObject({ driver_id: DIXON, co_driver_id: null });
  });
});

describe("relinkDispatchMovements (D-LA3)", () => {
  const links = (over: Record<string, unknown>) => ({ external_id: "TMS:293773", driver_id: DIXON, co_driver_id: HOUSTON, vehicle_id: TRUCK, trailer_id: null, ...over });

  it("re-projects a closed load whose driver code now resolves to a driver it does not hold", async () => {
    const rec = rig({ movements: [movement("293773", ["KDIXON", "MHOUSTON"])], links: [links({ driver_id: null })] });
    expect(await relinkDispatchMovements(rec.client, ORG, "mcleod", SINCE)).toEqual({ relinked: 1 });
    expect(rec.writtenRows("loads")[0]).toMatchObject({ driver_id: DIXON, co_driver_id: HOUSTON });
    expectOrgScoped(rec, ORG);
  });

  it.each([
    ["the co-driver", { co_driver_id: null }],
    ["the truck", { vehicle_id: null }],
  ])("re-projects when %s is the stale link", async (_what, over) => {
    const rec = rig({ movements: [movement("293773", ["KDIXON", "MHOUSTON"])], links: [links(over)] });
    expect(await relinkDispatchMovements(rec.client, ORG, "mcleod", SINCE)).toEqual({ relinked: 1 });
  });

  it("leaves a load alone when every link already matches", async () => {
    const rec = rig({ movements: [movement("293773", ["KDIXON", "MHOUSTON"])], links: [links({})] });
    expect(await relinkDispatchMovements(rec.client, ORG, "mcleod", SINCE)).toEqual({ relinked: 0 });
    expect(rec.writtenRows("loads")).toEqual([]);
  });

  it("does not re-project a code the roster does not carry, which would only write the same null again", async () => {
    const rec = rig({ movements: [movement("293775", ["JFERGUSO"])], links: [links({ external_id: "TMS:293775", driver_id: null, co_driver_id: null })] });
    expect(await relinkDispatchMovements(rec.client, ORG, "mcleod", SINCE)).toEqual({ relinked: 0 });
  });

  // D-RLY12: the pass runs on a clock, not after one company's batch, so it reads every company the org's
  // raw rows hold and projects each stale movement under its own company.
  it("covers every company, projecting each stale movement under its own", async () => {
    const rec = rig({
      movements: [movement("293773", ["KDIXON", "MHOUSTON"]), movement("500001", ["KDIXON"], { company_id: "TMS2" })],
      links: [links({ driver_id: null }), links({ external_id: "TMS2:500001", driver_id: null, co_driver_id: null })],
    });
    expect(await relinkDispatchMovements(rec.client, ORG, "mcleod", SINCE)).toEqual({ relinked: 2 });
    const projected = rec.forTable("mcleod_dispatch_movements").filter((q) => filter(q, "movement_id") !== undefined);
    expect(projected.map((q) => [filter(q, "company_id"), filter(q, "movement_id")])).toEqual([["TMS", ["293773"]], ["TMS2", ["500001"]]]);
  });

  it("reads only open movements and those closed inside the window", async () => {
    const rec = rig({ movements: [], links: [] });
    await relinkDispatchMovements(rec.client, ORG, "mcleod", SINCE);
    const read = rec.forTable("mcleod_dispatch_movements")[0]!;
    expect(read.ops.find((o) => o.method === "or")?.args[0]).toBe(`closed_at.is.null,closed_at.gte.${SINCE}`);
    expect(filter(read, "company_id")).toBeUndefined();
  });
});
