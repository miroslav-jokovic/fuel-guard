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
const H = 3600;
const view = (): IdleBurnRatesView => ({
  // battery APU 50–75 °F: 60 h at 0.81 — learned. No APU 75–90 °F: 12 h at 0.93 — not yet.
  ...learnIdleBurnRates(
    [
      { vehicleId: "b", band: 2, parks: 20, runningSec: 60 * H, fuelMl: 60 * 0.81 * GAL },
      { vehicleId: "n", band: 3, parks: 4, runningSec: 12 * H, fuelMl: 12 * 0.93 * GAL },
    ],
    (id) => (id === "b" ? "battery_apu" : "no_apu"),
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
    // (60 × 0.81 + 12 × 0.93) / 72 = 0.83
    expect(t).toContain("Whole fleet: 0.83 over 72 hours");
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
    expect(t.match(/Not yet — estimate/g)).toHaveLength(1);
  });

  it("a failed read is an error, not an empty table", async () => {
    fetched.ok = false;
    const t = (await render()).text();
    expect(t).toContain("boom");
    expect(t).not.toContain("No parked hours");
  });
});
