import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
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

// The switch (0420, Q-IE14) writes `idle_settings` from the browser, under RLS. What it sent, and what
// PostgREST answers (`updated` rows: [] is an org with no settings row).
const writes: Array<{ table: string; payload: Record<string, unknown>; eq: unknown[] }> = [];
const db = { updated: [{ org_id: "org-1" }] as unknown[], error: null as { message: string } | null };
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => ({
        eq: (...eq: unknown[]) => ({
          select: async () => {
            writes.push({ table, payload, eq });
            return { data: db.error ? null : db.updated, error: db.error };
          },
        }),
      }),
    }),
  },
}));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = Object.assign(fakeSession("safety_manager"), { orgId: "org-1" });
  return { useSessionStore: () => s, __session: s };
});

import IdleBurnRatesPanel from "./IdleBurnRatesPanel.vue";
import * as sessionModule from "@/stores/session";
import { useToastStore } from "@/stores/toast";

const session = (sessionModule as unknown as { __session: { role: string } }).__session;

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
  pricing: "configured",
});

const render = async () => {
  const w = mount(IdleBurnRatesPanel, {
    global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] },
  });
  await flushPromises();
  return w;
};

beforeEach(() => {
  setActivePinia(createPinia());
  session.role = "safety_manager";
  writes.length = 0;
  db.updated = [{ org_id: "org-1" }];
  db.error = null;
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

  describe("the carrier's choice of rate (0420, Q-IE14)", () => {
    const radios = (w: Awaited<ReturnType<typeof render>>) => w.findAll<HTMLInputElement>('input[type="radio"]');

    it("shows the stored choice, and says it changes no figure on the page yet", async () => {
      const w = await render();
      const [configured, learned] = radios(w);
      expect(configured!.element.checked).toBe(true);
      expect(learned!.element.checked).toBe(false);
      expect(w.text()).toContain("Idle settings — 0.80 gallons per hour");
      expect(w.text()).toContain("Until then this choice changes no figure on this page.");
    });

    it("checks 'measured' when the carrier has chosen it", async () => {
      fetched.value = { ...view(), pricing: "learned" };
      const [configured, learned] = radios(await render());
      expect(configured!.element.checked).toBe(false);
      expect(learned!.element.checked).toBe(true);
    });

    it("saves a choice to the org's idle settings, and reads the rates again", async () => {
      const w = await render();
      await radios(w)[1]!.trigger("change");
      await flushPromises();
      expect(writes).toEqual([{ table: "idle_settings", payload: expect.objectContaining({ idle_burn_source: "learned" }), eq: ["org_id", "org-1"] }]);
      expect(calls).toEqual(["/api/idle/engine/burn-rates", "/api/idle/engine/burn-rates"]);
    });

    it("an update that matched no settings row is an error, not a saved choice", async () => {
      db.updated = [];
      const w = await render();
      await radios(w)[1]!.trigger("change");
      await flushPromises();
      expect(useToastStore().toasts.map((t) => t.title)).toEqual(["Couldn't save the idle rate"]);
    });

    it("saves 'idle settings' back from a stored 'measured'", async () => {
      fetched.value = { ...view(), pricing: "learned" };
      const w = await render();
      await radios(w)[0]!.trigger("change");
      await flushPromises();
      expect(writes.map((x) => x.payload.idle_burn_source)).toEqual(["configured"]);
    });

    // The auditor VIEWS safety and does not manage it, so it tells the control's gate apart from the page's.
    it("a role that views safety without managing it reads the choice and is offered no control", async () => {
      session.role = "auditor";
      fetched.value = { ...view(), pricing: "learned" };
      const w = await render();
      expect(radios(w)).toHaveLength(0);
      expect(w.text()).toContain("uses the rate measured by your trucks");
    });
  });

  it("a failed read is an error, not an empty table", async () => {
    fetched.ok = false;
    const t = (await render()).text();
    expect(t).toContain("boom");
    expect(t).not.toContain("No parked hours");
  });
});
