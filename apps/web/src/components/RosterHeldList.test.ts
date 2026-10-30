import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";

/**
 * The "needs a decision" list on the Drivers page (ROSTER-LIFECYCLE-PLAN RL3). What is worth pinning is
 * that a driver the sweep held is NAMED with the step that settles them (on 2026-10-30 a held new hire
 * read as a broken sync), and that an empty list or a failed fetch says nothing at all.
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
const canView = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ canView }) }));

import RosterHeldList from "@/components/RosterHeldList.vue";

const hairston = { externalId: "CHAIRSTO", name: "CURTIS HAIRSTON", hireDate: "2026-10-28", reason: "applicant", since: "2026-10-30T20:16:03Z" };
const virgin = { externalId: "SVIRGIN", name: "STREETIE VIRGIN", hireDate: "2026-10-29", reason: "fuel_card", since: "2026-10-30T20:16:03Z" };

const list = async (res: unknown) => {
  setActivePinia(createPinia());
  apiFetch.mockResolvedValue(res);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div/>" } }] });
  const w = mount(RosterHeldList, {
    global: { plugins: [router, [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] },
  });
  await flushPromises();
  return w;
};

describe("RosterHeldList", () => {
  it("names each held driver with McLeod's code, hire date and what settles them", async () => {
    const w = await list({ ok: true, data: { at: "2026-10-30T20:16:03Z", drivers: [hairston, virgin] } });
    expect(w.get("[data-testid=roster-held]").text()).toContain("2 drivers in McLeod are not on this list yet");
    const rows = w.findAll("[data-testid=roster-held-driver]").map((r) => r.text());
    expect(rows[0]).toContain("CURTIS HAIRSTON (CHAIRSTO, hired 10/28/2026)");
    expect(rows[0]).toContain("still an applicant in Hiring");
    expect(rows[1]).toContain("fuel-card driver here by name only");
  });

  it("links an applicant to Hiring only for someone who can open it", async () => {
    canView.mockReturnValue(true);
    expect((await list({ ok: true, data: { at: null, drivers: [hairston] } })).find("a[href='/recruitment']").exists()).toBe(true);
    canView.mockReturnValue(false);
    expect((await list({ ok: true, data: { at: null, drivers: [hairston] } })).find("a[href='/recruitment']").exists()).toBe(false);
  });

  it("says nothing when nobody is held", async () => {
    const w = await list({ ok: true, data: { at: "2026-10-30T20:31:03Z", drivers: [] } });
    expect(w.find("[data-testid=roster-held]").exists()).toBe(false);
  });

  it("says nothing when the list cannot be fetched — the roster below is still right", async () => {
    const w = await list({ ok: false });
    expect(w.find("[data-testid=roster-held]").exists()).toBe(false);
  });
});
