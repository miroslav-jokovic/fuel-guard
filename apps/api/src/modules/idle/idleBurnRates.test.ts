import { beforeEach, describe, expect, it } from "vitest";
import { IDLE_BURN_BAND_EDGES_MILLI_C } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { __resetIdleCostBasisCache } from "./idleCostBasis.js";
import { readIdleBurnRates } from "./idleBurnRates.js";

/**
 * The burn-rate reader (IE4). The fold is `burnRate.test.ts`'s; what is only testable here is the
 * reading: what 0409 is asked for, that each truck's rows are filed under ITS declaration (retired
 * trucks included), that PostgREST's string bigints are numbers by the time they are summed, and that
 * the configured rate comes from the org's settings.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-02T20:00:00Z");
const H = 3600;
const GAL = 3785.411784;

function seed() {
  return createSupabaseRecorder({
    tables: {
      idle_settings: [{ idle_gal_per_hour: "0.85", fuel_price_per_gal: "4.000" }],
      fuel_prices: [],
      vehicles: [
        { id: "vB", has_apu: true, apu_type: "battery_hvac" },
        { id: "vR", has_apu: true, apu_type: "battery_hvac" }, // retired; still a battery-APU truck's parks
        { id: "vN", has_apu: false, apu_type: "none" },
      ],
    },
    rpc: {
      // vB 30 h at 0.70 + vR 30 h at 0.90 → battery APU 50–75 °F learned at 0.80 over 60 h.
      // vN 20 h at 1.00 → no APU 50–75 °F, unlearned. bigints as strings, as PostgREST may send them.
      idle_engine_burn_inputs: [
        { vehicle_id: "vB", band: 2, parks: 12, running_sec: String(30 * H), fuel_ml: String(30 * 0.7 * GAL) },
        { vehicle_id: "vN", band: 2, parks: 7, running_sec: String(20 * H), fuel_ml: String(20 * 1.0 * GAL) },
        { vehicle_id: "vR", band: 2, parks: 9, running_sec: 30 * H, fuel_ml: 30 * 0.9 * GAL },
      ],
    },
  });
}

beforeEach(() => __resetIdleCostBasisCache());

describe("readIdleBurnRates", () => {
  it("asks 0409 for the org's last 60 days on the shared band edges", async () => {
    const rec = seed();
    const r = await readIdleBurnRates(rec.client, ORG, NOW);
    expect(rec.rpcs()).toEqual([{
      fn: "idle_engine_burn_inputs",
      args: { p_org: ORG, p_from: "2026-08-03T20:00:00.000Z", p_to: "2026-10-02T20:00:00.000Z", p_band_edges_milli_c: [...IDLE_BURN_BAND_EDGES_MILLI_C] },
    }]);
    expect(r).toMatchObject({ from: "2026-08-03T20:00:00.000Z", to: "2026-10-02T20:00:00.000Z" });
  });

  it("files each truck's rows under its own declaration and sums them as numbers", async () => {
    const r = await readIdleBurnRates(seed().client, ORG, NOW);
    expect(r.cells).toEqual([
      expect.objectContaining({ equipment: "battery_apu", band: 2, parks: 21, runningHours: 60, measuredGalPerHour: 0.8, learned: true, galPerHour: 0.8 }),
      expect.objectContaining({ equipment: "no_apu", band: 2, parks: 7, runningHours: 20, measuredGalPerHour: 1, learned: false, galPerHour: 0.72 }),
    ]);
    expect(r.fleet).toMatchObject({ parks: 28, runningHours: 80 });
  });

  it("reports the configured rate every idle dollar uses today, beside the prior", async () => {
    const r = await readIdleBurnRates(seed().client, ORG, NOW);
    expect(r).toMatchObject({ configuredGalPerHour: 0.85, priorGalPerHour: 0.72, minHours: 50 });
  });

  it("scopes every tenant read to the org", async () => {
    const rec = seed();
    await readIdleBurnRates(rec.client, ORG, NOW);
    expectOrgScoped(rec, ORG);
  });
});
