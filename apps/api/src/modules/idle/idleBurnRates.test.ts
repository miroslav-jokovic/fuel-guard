import { beforeEach, describe, expect, it } from "vitest";
import { IDLE_BURN_BAND_EDGES_MILLI_C, IDLE_BURN_RPC } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { __resetIdleCostBasisCache } from "./idleCostBasis.js";
import { readIdleBurnRates } from "./idleBurnRates.js";

/**
 * The burn-rate reader (IE4). The fold is `burnRate.test.ts`'s; what is only testable here is the
 * reading: what 0419 is asked for, that each truck's rows are filed under ITS declaration (retired
 * trucks included), that PostgREST's string bigints are numbers by the time they are summed, and that
 * the configured rate comes from the org's settings.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-02T20:00:00Z");
const GAL = 3785.411784;

function seed() {
  return createSupabaseRecorder({
    tables: {
      idle_settings: [{ idle_gal_per_hour: "0.85", fuel_price_per_gal: "4.000" }],
      fuel_prices: [],
      vehicles: [
        ...["vB1", "vB2", "vB3", "vB4"].map((id) => ({ id, has_apu: true, apu_type: "battery_hvac" })),
        { id: "vR", has_apu: true, apu_type: "battery_hvac" }, // retired; still a battery-APU truck's hours
        { id: "vN", has_apu: false, apu_type: "none" },
      ],
    },
    rpc: {
      // Five battery-APU trucks × 12 h at 0.78–0.82 → 50–75 °F learned at 0.80 over 60 h. vN 20 h at 1.10 →
      // no APU 50–75 °F, unlearned; its cohort is one truck; the fleet (70 gal / 80 h = 0.875) is ±15%,
      // so it reads the prior. bigints as strings, as PostgREST may send them.
      [IDLE_BURN_RPC]: [
        ...[0.78, 0.79, 0.8, 0.81].map((r, i) => ({ vehicle_id: `vB${i + 1}`, band: 2, hours: 12, fuel_ml: String(12 * r * GAL) })),
        { vehicle_id: "vN", band: 2, hours: 20, fuel_ml: String(20 * 1.1 * GAL) },
        { vehicle_id: "vR", band: 2, hours: 12, fuel_ml: 12 * 0.82 * GAL },
      ],
    },
  });
}

beforeEach(() => __resetIdleCostBasisCache());

describe("readIdleBurnRates", () => {
  it("asks 0419 for the org's last 60 days on the shared band edges", async () => {
    const rec = seed();
    const r = await readIdleBurnRates(rec.client, ORG, NOW);
    expect(rec.rpcs()).toEqual([{
      fn: "idle_engine_burn_hours",
      args: { p_org: ORG, p_from: "2026-08-03T20:00:00.000Z", p_to: "2026-10-02T20:00:00.000Z", p_band_edges_milli_c: [...IDLE_BURN_BAND_EDGES_MILLI_C] },
    }]);
    expect(r).toMatchObject({ from: "2026-08-03T20:00:00.000Z", to: "2026-10-02T20:00:00.000Z" });
  });

  it("files each truck's rows under its own declaration and sums them as numbers", async () => {
    const r = await readIdleBurnRates(seed().client, ORG, NOW);
    expect(r.cells).toEqual([
      expect.objectContaining({ equipment: "battery_apu", band: 2, trucks: 5, runningHours: 60, measuredGalPerHour: 0.8, learned: true, galPerHour: 0.8, source: "cell" }),
      expect.objectContaining({ equipment: "no_apu", band: 2, trucks: 1, runningHours: 20, measuredGalPerHour: 1.1, learned: false, galPerHour: 0.72, source: "prior" }),
    ]);
    expect(r.fleet).toMatchObject({ trucks: 6, runningHours: 80, measuredGalPerHour: 0.875, learned: false });
  });

  it("reports the configured rate every idle dollar uses today, beside the prior", async () => {
    const r = await readIdleBurnRates(seed().client, ORG, NOW);
    expect(r).toMatchObject({ configuredGalPerHour: 0.85, priorGalPerHour: 0.72, minTrucks: 5, maxCi95: 0.1 });
  });

  it("scopes every tenant read to the org", async () => {
    const rec = seed();
    await readIdleBurnRates(rec.client, ORG, NOW);
    expectOrgScoped(rec, ORG);
  });
});
