import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";

/** D-US6 — the hazmat record's meta grid on the load page is a FactList. */
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s };
});
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: null })) }));
const HazmatPanel = (await import("./HazmatPanel.vue")).default;

const global = { plugins: [VueQueryPlugin], stubs: { RouterLink: true } };
const load = (record: Record<string, unknown>) => ({
  id: "l1", vehicle_id: null, trailer_id: null, driver_id: null, stops: [],
  hazmat_record: {
    id: "h1", status: "needs_review", tank_state: "residue_uncleaned", updated_at: "2026-09-01T14:00:00Z",
    latest_outcome: null, latest_run_at: null, ...record,
  },
});

beforeEach(() => setActivePinia(createPinia()));

describe("the hazmat panel's facts", () => {
  it("names each fact, says when it was never analyzed, and dashes the missing run time", () => {
    const w = mount(HazmatPanel, { props: { load: load({}), canManage: false }, global });
    expect(w.findAll("dt").map((d) => d.text())).toEqual(["Last analysis", "Analyzed at", "Tank state", "Updated"]);
    const dd = w.findAll("dd").map((d) => d.text());
    expect(dd.slice(0, 3)).toEqual(["Not analyzed", "—", "Residue — uncleaned"]);
    expect(dd[3]).not.toBe("—");
  });

  it("draws the last outcome as a badge inside its value", () => {
    const w = mount(HazmatPanel, {
      props: { load: load({ latest_outcome: "green", latest_run_at: "2026-09-01T15:00:00Z" }), canManage: false },
      global,
    });
    expect(w.findAll("dd")[0]!.get("span").text()).toBe("Green");
  });
});
