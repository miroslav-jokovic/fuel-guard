import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { rolesThatManage, type TmsRosterCheckpoint } from "@silvicom/shared";
import { runFleetParity } from "./fleetParity.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-02T12:00:00Z");

const notifyCalls: Array<Record<string, unknown>> = [];
vi.mock("../messaging/index.js", () => ({
  notify: async (_admin: unknown, input: Record<string, unknown>) => {
    notifyCalls.push(input);
    return "n-1";
  },
}));
beforeEach(() => {
  notifyCalls.length = 0;
});

/** McLeod's 506 as the agent reads it; ours, as the sweep and 0399 stored it. */
const T506 = { external_id: "506", unit_number: "506", vin: "3AKJHHDR0LSLL7398", make: "FRHT", model: "CA", year: 2020, purchased_at: "2020-07-01", in_shop: false };
const V506 = { id: "v-506", unit_number: "506", mcleod_tractor_id: "506", status: "active", vin: "3AKJHHDR0LSLL7398", year: 2020, purchased_at: "2020-07-01", make: "Freightliner", model: "Cascadia", samsara_name: "506" };
const TR1 = { external_id: "532159", unit_number: "532159", vin: "1JJV532W0KL000001", year: 2019, purchased_at: "2019-05-01" };
const R1 = { id: "t-1", unit_number: "R532159", mcleod_trailer_id: "532159", status: "active", vin: "1JJV532W0KL000001", year: 2019, purchased_at: "2019-05-01" };

const checkpoint = (over: Partial<TmsRosterCheckpoint> = {}): TmsRosterCheckpoint => ({
  counts: { drivers: 0, vehicles: 1, trailers: 1 },
  tractors: [T506],
  trailers: [TR1],
  ...over,
});
const recorder = (vehicles: Record<string, unknown>[], trailers: Record<string, unknown>[] = [R1]) =>
  createSupabaseRecorder({
    tables: {
      vehicles,
      trailers,
      memberships: [{ user_id: "u-admin" }, { user_id: "u-fleet" }],
    },
    // 0402's function, answering for whatever keys it is asked about.
    rpc: (fn, args) =>
      fn === "vehicle_make_model_derive"
        ? (args as { p_rows: { key: string }[] }).p_rows.map((r) => ({ key: r.key, make: "Freightliner", model: "Cascadia" }))
        : null,
  });

describe("runFleetParity (FL2, D-FL2)", () => {
  it("is silent when McLeod and we agree: no notification, the pass recorded", async () => {
    const rec = recorder([V506]);
    const s = await runFleetParity(rec.client, ORG, checkpoint(), NOW);
    expect(s).toEqual({ checked: true, at: NOW.toISOString(), findings: [], known: [], notified: false });
    expect(notifyCalls).toEqual([]);
  });

  it("derives McLeod's make and model through 0402's function, with every tractor in one call", async () => {
    const rec = recorder([V506]);
    await runFleetParity(rec.client, ORG, checkpoint(), NOW);
    expect(rec.rpcs()).toEqual([
      { fn: "vehicle_make_model_derive", args: { p_rows: [{ key: "506", vin: "3AKJHHDR0LSLL7398", make: "FRHT", model: "CA" }] } },
    ]);
  });

  it("tells every equipment manager once, listing what differs and the sold trucks as expected", async () => {
    const rec = recorder([
      { ...V506, year: 2021 },
      { ...V506, id: "v-632", unit_number: "632", mcleod_tractor_id: "632", status: "retired", samsara_name: "632 - SOLD" },
    ]);
    const s = await runFleetParity(rec.client, ORG, checkpoint({ tractors: [T506, { ...T506, external_id: "632", unit_number: "632" }] }), NOW);
    expect(s).toMatchObject({ checked: true, findings: ["Truck 506: model year is 2020 in McLeod, 2021 here."], known: ["632"], notified: true });
    expect(notifyCalls.map((c) => c.userId)).toEqual(["u-admin", "u-fleet"]);
    expect(notifyCalls[0]).toMatchObject({
      orgId: ORG,
      category: "system",
      severity: "warning",
      title: "Fleet list differs from McLeod",
      body: "Truck 506: model year is 2020 in McLeod, 2021 here.\nSold, awaiting pickup (expected, not a problem): 632.",
    });
    // The recipients are derived from the section matrix, never listed.
    const roles = rec.queries.find((q) => q.table === "memberships")!.ops.find((o) => o.method === "in")!.args[1];
    expect(roles).toEqual(rolesThatManage("equipment"));
  });

  it("keys the notification on the whole picture: the same findings dedupe, a changed one does not", async () => {
    const run = async (year: number) => {
      notifyCalls.length = 0;
      await runFleetParity(recorder([{ ...V506, year }]).client, ORG, checkpoint(), NOW);
      return notifyCalls[0]!.dedupeKey as string;
    };
    const a = await run(2021);
    expect(await run(2021)).toBe(a);
    expect(await run(2022)).not.toBe(a);
    expect(a).toMatch(new RegExp(`^fleet-parity:${ORG}:[0-9a-f]{16}$`));
  });

  it("caps a long list and says how many more", async () => {
    const tractors = Array.from({ length: 15 }, (_, i) => ({ ...T506, external_id: `9${i}`, unit_number: `9${i}` }));
    await runFleetParity(recorder([]).client, ORG, checkpoint({ tractors }), NOW);
    const body = notifyCalls[0]!.body as string;
    expect(body.split("\n")).toHaveLength(13);
    expect(body).toContain("…and 3 more.");
    expect(notifyCalls[0]!.title).toBe("Fleet list differs from McLeod in 15 places");
  });

  it("does not run, and says why, for an agent that sent counts only", async () => {
    const rec = recorder([V506]);
    const s = await runFleetParity(rec.client, ORG, { counts: { drivers: 0, vehicles: 1, trailers: 1 } }, NOW);
    expect(s).toEqual({ checked: false, reason: expect.stringContaining("counts only") });
    expect(rec.queries).toEqual([]);
    expect(notifyCalls).toEqual([]);
  });

  it("scopes every read to one org — the API reads with the service role, which bypasses RLS", async () => {
    const rec = recorder([V506]);
    await runFleetParity(rec.client, ORG, checkpoint(), NOW);
    expectOrgScoped(rec, ORG);
  });
});
