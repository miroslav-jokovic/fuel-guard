import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { learnIdleBurnRates, type IdleBurnRatesView } from "@silvicom/shared";

/**
 * The Idling page's burn-rate panel (IE4, D-IE5). The learning is the server's; what this pins is that
 * the page puts the rate it actually USES beside the measured ones, and never lets a group under the
 * hours bar read as a measured rate. The view is built by the real `learnIdleBurnRates`, so the panel
 * reads the shape the server sends rather than a hand-copied one.
 */
const fetched = { value: null as unknown, ok: true };
const calls: string[] = [];
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    calls.push(url);
    return fetched.ok ? { ok: true, data: { ok: true, data: fetched.value } } : { ok: false, error: { message: "boom" } };
  }),
}));

import IdleBurnRatesPanel from "./IdleBurnRatesPanel.vue";

const GAL = 3785.411784;
const view = (): IdleBurnRatesView => ({
  // battery APU 50–75 °F: five trucks × 10 h at 0.79–0.83 → 0.81, tight — learned. No APU 75–90 °F: one
  // truck, 12 h at 0.93 — not learned, and neither is its one-truck cohort; the fleet of six is
  // (50 × 0.81 + 12 × 0.93) / 62 = 0.833 at ±5.5% — learned, so the no-APU row stands in at the fleet's.
  ...learnIdleBurnRates(
    [
      ...[0.79, 0.8, 0.81, 0.82, 0.83].map((r, i) => ({ vehicleId: `b${i}`, band: 2, hours: 10, fuelMl: 10 * r * GAL })),
      { vehicleId: "n", band: 3, hours: 12, fuelMl: 12 * 0.93 * GAL },
    ],
    (id) => (id.startsWith("b") ? "battery_apu" : "no_apu"),
  ),
  from: "2026-08-03T20:00:00.000Z",
  to: "2026-10-02T20:00:00.000Z",
  configuredGalPerHour: 0.8,
});

const render = async () => {
  const w = mount(IdleBurnRatesPanel, {
    global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] },
  });
  await flushPromises();
  return w;
};

beforeEach(() => {
  calls.length = 0;
  fetched.ok = true;
  fetched.value = view();
});

describe("IdleBurnRatesPanel", () => {
  it("reads its own route", async () => {
    await render();
    expect(calls).toEqual(["/api/idle/engine/burn-rates"]);
  });

  it("says which rate the page's dollars use, beside the starting estimate and the fleet's measurement", async () => {
    const t = (await render()).text();
    expect(t).toContain("use 0.80 gallons per hour");
    expect(t).toContain("starting estimate of 0.72 gallons per hour");
    expect(t).toContain("Whole fleet: 0.83 over 62 hours");
    expect(t).toContain("at least 5 trucks and is accurate to within 10%");
  });

  it("names each group in plain words, and a group under the bar is an estimate, not a measured rate", async () => {
    const w = await render();
    const t = w.text();
    expect(t).toContain("Battery APU");
    expect(t).toContain("50–75 °F");
    expect(t).toContain("0.81");
    expect(t).toContain("No APU");
    expect(t).toContain("75–90 °F");
    expect(t).toContain("0.93");
    expect(t.match(/Yes — measured rate/g)).toHaveLength(1);
    expect(t.match(/Not yet — uses the fleet's rate/g)).toHaveLength(1);
  });

  it("a failed read is an error, not an empty table", async () => {
    fetched.ok = false;
    const t = (await render()).text();
    expect(t).toContain("boom");
    expect(t).not.toContain("No parked hours");
  });
});
