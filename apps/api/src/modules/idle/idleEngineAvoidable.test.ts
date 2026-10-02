import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { __resetIdleCostBasisCache } from "./idleCostBasis.js";
import { readIdleEngineAvoidable } from "./idleEngineAvoidable.js";

/**
 * The idle engine's avoidable idling for a range (IE3). The rules are `avoidable.test.ts`'s; what is
 * only testable here is the reading: which parks a range holds (the local day a park STARTED on), that
 * each is judged by ITS truck's declared equipment and the org's comfort band, how hours become money,
 * and that every read is the org's.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const park = (vehicle_id: string, started_at: string, o: Record<string, unknown> = {}) => ({
  vehicle_id, started_at, duration_sec: 20_000, running_sec: 13_000,
  running_rest_sec: 7_000, running_on_duty_sec: 5_000, running_excluded_sec: 300, running_unknown_sec: 700,
  ambient_milli_c: 15_000, ...o,
});
// 09/01 00:00 CDT = 05:00Z; 09/02 00:00 CDT = 09/02 05:00Z.
const PARKS = [
  park("vB", "2026-09-01T04:59:00Z"), // 08/31 local — outside
  park("vB", "2026-09-01T05:00:00Z"), // battery APU
  park("vN", "2026-09-01T20:00:00Z"), // no APU
  park("vN", "2026-09-02T04:00:00Z", { running_rest_sec: null, running_on_duty_sec: null, running_excluded_sec: null, running_unknown_sec: null }), // still 09/01 local, unmeasured
  park("vN", "2026-09-02T05:00:00Z"), // 09/02 local — outside
];

function seed(o: { comfortLowF?: string } = {}) {
  return createSupabaseRecorder({
    tables: {
      organizations: [{ id: ORG, operating_hours: { tz: "America/Chicago" } }],
      idle_settings: [{ comfort_low_f: o.comfortLowF ?? "20", comfort_high_f: "85", idle_gal_per_hour: "0.80", fuel_price_per_gal: "4.000" }],
      fuel_prices: [],
      vehicles: [
        { id: "vB", unit_number: "740", has_apu: true, apu_type: "battery_hvac" },
        { id: "vN", unit_number: "612", has_apu: false, apu_type: "none" },
      ],
      // A FUNCTION fixture: the recorder records filters and applies none, and which parks a range
      // holds is the whole question.
      idle_engine_stops: (q) => {
        const lo = q.ops.find((x) => x.method === "gte")?.args[1] as string;
        const hi = q.ops.find((x) => x.method === "lt")?.args[1] as string;
        return PARKS.filter((p) => Date.parse(p.started_at) >= Date.parse(lo) && Date.parse(p.started_at) < Date.parse(hi));
      },
    },
  });
}

beforeEach(() => __resetIdleCostBasisCache());

describe("readIdleEngineAvoidable", () => {
  it("holds the parks that STARTED on the range's local days, and judges each by its own truck", async () => {
    const r = await readIdleEngineAvoidable(seed().client, ORG, "2026-09-01", "2026-09-01");
    expect(r.totals.parks).toBe(3);
    expect(r.totals).toMatchObject({
      unmeasuredParks: 1, unmeasuredRunningSec: 13_000,
      // battery: on duty 1,400 + unknown 700; no APU: the same 2,100, its 7,000 rest an equipment opportunity
      avoidableSec: 4_200, avoidableNoLogSec: 1_400, equipmentOpportunitySec: 7_000,
    });
    const byUnit = Object.fromEntries(r.trucks.map((t) => [t.unit, t]));
    expect(byUnit["740"]).toMatchObject({ equipment: "battery_apu", totals: { equipmentOpportunitySec: 0 } });
    expect(byUnit["612"]).toMatchObject({ equipment: "no_apu", totals: { equipmentOpportunitySec: 7_000, unmeasuredParks: 1 } });
  });

  it("prices the hours on the Idling page's own basis", async () => {
    const r = await readIdleEngineAvoidable(seed().client, ORG, "2026-09-01", "2026-09-01");
    // 4,200 s = 1.1667 h × 0.80 gal/h = 0.93 gal × $4.000
    expect(r.money).toMatchObject({ galPerHour: 0.8, pricePerGal: 4, avoidableGallons: 0.93, avoidableUsd: 3.72, equipmentOpportunityGallons: 1.56, equipmentOpportunityUsd: 6.24 });
  });

  it("reads the org's comfort band, not the default", async () => {
    // 59 °F parks; a band starting at 60 puts every park outside it
    const r = await readIdleEngineAvoidable(seed({ comfortLowF: "60" }).client, ORG, "2026-09-01", "2026-09-01");
    expect(r.settings.comfortLowF).toBe(60);
    expect(r.totals).toMatchObject({ avoidableSec: 0, outsideComfortSec: 26_000 });
  });

  it("scopes every tenant read to the org", async () => {
    const rec = seed();
    await readIdleEngineAvoidable(rec.client, ORG, "2026-09-01", "2026-09-01");
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });
});
