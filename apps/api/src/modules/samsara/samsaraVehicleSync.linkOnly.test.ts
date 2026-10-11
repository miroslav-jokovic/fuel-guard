import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";
import { syncVehiclesFromSamsara } from "./samsaraVehicleSync.js";

/**
 * The Samsara vehicle sync when the carrier's TMS masters the roster (D-MR5).
 *
 * The rule here is STRICTER than the driver sync's, and the difference is a measurement rather than
 * a symmetry argument. `syncDriversFromSamsara` keeps writing phone in link-only mode because McLeod
 * holds none for any of its 1,463 driver rows. No vehicle column is like that: measured 2026-08-24,
 * McLeod carries a plate for 175 of 190 active tractors against Samsara's 21 of 194, a plate STATE
 * for all of them against Samsara's zero (its API has no such field), and make/model/year/VIN for
 * every active tractor. So link-only mode writes the link and the gateway's measurements, and no
 * identity at all.
 *
 * The failure this guards against is silent. `identity` in the sync is built unconditionally and the
 * Samsara parser returns null for an absent field, so leaving the write as it was would have McLeod
 * set 175 plates and this sync null them on its next tick, with nothing raising.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = testEnv();

/** One truck Samsara knows: no plate, no year — the shape 173 of 194 production rows actually have. */
const SAMSARA = [{ id: "SV1", name: "104", vin: "1FUJGLD54LLAA1234", make: "Freightliner", model: "Cascadia" }];
const STATS = { data: [{ id: "SV1", obdOdometerMeters: { value: 1609344 }, fuelPercents: { value: 62.5, time: "2026-08-24T10:00:00Z" } }] };

const seed = (vehicles: Record<string, unknown>[], master: boolean) =>
  createSupabaseRecorder({
    tables: {
      vehicles,
      org_integrations: master
        ? [{ org_id: ORG, provider: "mcleod", enabled: true, config: { roster_master: true } }]
        : [],
    },
  });

const run = (rec: ReturnType<typeof seed>) =>
  syncVehiclesFromSamsara(rec.client, env, ORG, async () => SAMSARA, async () => STATS, async () => ({ data: [] }));

/** A McLeod-owned truck, already carrying the identity McLeod wrote and not yet linked to Samsara. */
const mcleodTruck = {
  id: "v-1",
  org_id: ORG,
  unit_number: "104",
  vin: "1FUJGLD54LLAA1234",
  status: "active",
  samsara_vehicle_id: null,
  samsara_missing_since: null,
};

describe("samsara vehicle sync under TMS roster mastery", () => {
  it("writes the telematics link and the gateway's measurements", async () => {
    const rec = seed([mcleodTruck], true);
    await run(rec);
    const p = rec.writtenRows("vehicles")[0]!;
    expect(p.samsara_vehicle_id).toBe("SV1"); // the join key idle, HOS and scoring all follow
    expect(p.current_odometer).toBe(1000);
    expect(p.samsara_fuel_percent).toBe(62.5);
  });

  it("writes no identity at all, so it cannot null a plate McLeod owns", async () => {
    const rec = seed([mcleodTruck], true);
    await run(rec);
    const p = rec.writtenRows("vehicles")[0]!;
    // Samsara returned no plate and no year for this truck. In full mode those become explicit nulls.
    expect(p).not.toHaveProperty("plate");
    expect(p).not.toHaveProperty("year");
    expect(p).not.toHaveProperty("make");
    expect(p).not.toHaveProperty("model");
    expect(p).not.toHaveProperty("vin");
  });

  it("reports a truck the fleet list does not contain instead of inventing a row and a tank capacity", async () => {
    const rec = seed([], true);
    const r = await run(rec);
    expect(r.created).toBe(0);
    expect(r.unlinked).toEqual(["104"]);
    expect(rec.writes()).toEqual([]); // no insert, and no tank_capacity_gal: 0 for learnVehicle to unlearn
  });

  it("still stamps a truck that stopped reporting — that is a telematics fact, not a roster one", async () => {
    const rec = seed(
      [{ ...mcleodTruck, id: "v-dark", unit_number: "999", vin: "OTHER", samsara_vehicle_id: "SV-GONE" }],
      true,
    );
    const r = await run(rec);
    expect(r.samsaraMissing).toEqual(["999"]);
    expect(rec.writtenRows("vehicles").some((w) => w.samsara_missing_since != null)).toBe(true);
    // ...but its status is untouched. Retirement belongs to McLeod, with the guard that goes with it.
    expect(rec.writtenRows("vehicles").some((w) => "status" in w)).toBe(false);
  });

  it("is completely inert for an org with no TMS — full behaviour is unchanged", async () => {
    const rec = seed([], false);
    const r = await run(rec);
    expect(r.created).toBe(1);
    expect(r.unlinked).toBeUndefined();
    expect(rec.writtenRows("vehicles")[0]).toMatchObject({ unit_number: "104", tank_capacity_gal: 0 });
  });

  it("scopes every query to one org — the API reads with the service role, which bypasses RLS", async () => {
    const rec = seed([mcleodTruck], true);
    await run(rec);
    // org_integrations is read by org_id + provider; the mastery lookup is exempt from nothing.
    expectOrgScoped(rec, ORG);
  });
});

describe("a VIN or name match never takes a row from another device Samsara still lists (FL1b, Q-FL6)", () => {
  // Unit 568, 2026-10-01: Samsara keeps two records for one truck, both carrying VIN …9642.
  const VIN = "3AKJHHDR5MSMS9642";
  const twoRecords = [
    { id: "SV-NEW", name: "568 - SOLD", vin: VIN, make: "FREIGHTLINER", model: "CASCADIA" },
    { id: "SV-OLD", name: "568 - OLD", vin: VIN, make: "FREIGHTLINER", model: "CASCADIA" },
  ];
  const truck568 = { ...mcleodTruck, id: "v-568", unit_number: "568", vin: VIN, samsara_vehicle_id: "SV-NEW" };
  const runWith = (rec: ReturnType<typeof seed>, list: Record<string, unknown>[]) =>
    syncVehiclesFromSamsara(rec.client, env, ORG, async () => list, async () => ({ data: [] }), async () => ({ data: [] }));

  for (const master of [true, false]) {
    it(`holds the second record instead of re-linking the row (${master ? "link-only" : "full"} mode)`, async () => {
      const rec = seed([truck568], master);
      const r = await runWith(rec, twoRecords);
      expect(r.heldByOtherDevice).toEqual(["568 - OLD"]);
      expect(r.created).toBe(0);
      const links = rec.writtenRows("vehicles").map((w) => w.samsara_vehicle_id);
      expect(links).not.toContain("SV-OLD");
      expect(links).toContain("SV-NEW");
      expect(rec.writes().filter((w) => w.write?.method === "insert")).toEqual([]);
    });
  }

  it("holds a NAME match on a row another listed device holds, too", async () => {
    const rec = seed([{ ...truck568, vin: null }], true);
    const r = await runWith(rec, [twoRecords[0]!, { id: "SV-OTHER", name: "568", vin: null }]);
    expect(r.heldByOtherDevice).toEqual(["568"]);
    expect(rec.writtenRows("vehicles").map((w) => w.samsara_vehicle_id)).not.toContain("SV-OTHER");
  });

  it("still follows a gateway swap: a row whose device Samsara no longer lists is re-linked by VIN", async () => {
    const rec = seed([{ ...truck568, samsara_vehicle_id: "SV-GONE" }], true);
    const r = await runWith(rec, [twoRecords[1]!]);
    expect(r.heldByOtherDevice).toEqual([]);
    expect(rec.writtenRows("vehicles").map((w) => w.samsara_vehicle_id)).toContain("SV-OLD");
  });
});

describe("the Samsara record's name is kept on the truck (FL2, Q-FL8, migration 0401)", () => {
  const runWith = (rec: ReturnType<typeof seed>, list: Record<string, unknown>[]) =>
    syncVehiclesFromSamsara(rec.client, env, ORG, async () => list, async () => ({ data: [] }), async () => ({ data: [] }));

  for (const master of [true, false]) {
    it(`writes the name exactly as Samsara holds it (${master ? "link-only" : "full"} mode)`, async () => {
      const rec = seed([{ ...mcleodTruck, samsara_vehicle_id: "SV1" }], master);
      await runWith(rec, [{ ...SAMSARA[0]!, name: "104 - SOLD" }]);
      expect(rec.writtenRows("vehicles").map((w) => w.samsara_name)).toEqual(["104 - SOLD"]);
    });
  }

  it("writes it on a truck it creates, too", async () => {
    const rec = seed([], false);
    await runWith(rec, SAMSARA);
    expect(rec.writtenRows("vehicles")[0]).toMatchObject({ unit_number: "104", samsara_name: "104" });
  });

  it("stores null, not the id, for a record Samsara gave no name", async () => {
    const rec = seed([{ ...mcleodTruck, samsara_vehicle_id: "SV1" }], true);
    await runWith(rec, [{ ...SAMSARA[0]!, name: "" }]);
    const w = rec.writtenRows("vehicles")[0]!;
    expect(w).toHaveProperty("samsara_name");
    expect(w.samsara_name).toBeNull();
  });

  it("never writes a held record's name onto the row another device holds", async () => {
    const rec = seed([{ ...mcleodTruck, samsara_vehicle_id: "SV1" }], true);
    await runWith(rec, [SAMSARA[0]!, { id: "SV-OLD", name: "104 - OLD", vin: mcleodTruck.vin }]);
    expect(rec.writtenRows("vehicles").map((w) => w.samsara_name)).toEqual(["104"]);
  });
});
