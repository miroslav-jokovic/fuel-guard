import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { ROAD_TEST_ITEMS } from "@silvicom/shared";
import RoadTestPanel from "@/features/recruitment/RoadTestPanel.vue";

/**
 * The road test's screen (D2 RT3). ⚠ Asserts the BODY the API receives — the server re-decides
 * everything, so a panel that posted the wrong shape would be refused, and only the body says so.
 */
const EXAMINER = "44444444-5555-4666-8777-888888888888";
const TRUCK = "55555555-6666-4777-8888-999999999999";
const state = vi.hoisted(() => ({ examiners: [] as unknown[], posts: [] as Array<{ url: string; body: unknown }> }));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    if (opts?.method === "POST") {
      state.posts.push({ url, body: opts.body });
      return url.endsWith("/road-test")
        ? { ok: true, data: { passed: true, formDocumentId: "f", certificateDocumentId: "c", recordId: "r" } }
        : { ok: true, data: { examiner: { id: EXAMINER, full_name: "Arvidera Gakhal", title: "Maintenance manager", created_at: "" } } };
    }
    if (url.includes("road-test-examiners")) return { ok: true, data: { examiners: state.examiners } };
    return { ok: true, data: { records: [] } };
  }),
}));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: { value: [{ id: TRUCK, unit_number: "1432", year: 2024, make: "FRHT", status: "active" }] } }),
}));

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
const mountPanel = () =>
  mount(RoadTestPanel, { props: { driverId: "d1", done: false }, global: { plugins: [VueQueryPlugin] } });

beforeEach(() => {
  setActivePinia(createPinia());
  state.posts = [];
});

describe("with no examiner on file (Q-RT2)", () => {
  it("asks for the examiner and their signature before anything else", async () => {
    state.examiners = [];
    const w = mountPanel();
    await settle(w);
    expect(w.text()).toContain("Add the examiner");
    expect(w.text()).not.toContain("The road test given includes");
  });
});

describe("recording a test", () => {
  const fill = async (w: ReturnType<typeof mount>, rating = "satisfactory") => {
    const combos = w.findAllComponents({ name: "AppCombobox" });
    combos[0]!.vm.$emit("update:modelValue", EXAMINER);
    combos[1]!.vm.$emit("update:modelValue", TRUCK);
    combos[2]!.vm.$emit("update:modelValue", "reefer");
    w.findComponent({ name: "AppDateField" }).vm.$emit("update:modelValue", "2026-09-20");
    await w.find('input[type="number"]').setValue("15");
    const segments = w.findAllComponents({ name: "AppSegmentedControl" });
    segments.slice(0, ROAD_TEST_ITEMS.length).forEach((s, i) =>
      s.vm.$emit("update:modelValue", i === 2 ? rating : "satisfactory"));
    segments[ROAD_TEST_ITEMS.length]!.vm.$emit("update:modelValue", "satisfactory");
    await settle(w);
  };
  const button = (w: ReturnType<typeof mount>) => w.findAll("button").find((b) => b.text().includes("Record the road test"))!;

  it("rates all nine items and posts exactly what the API takes", async () => {
    state.examiners = [{ id: EXAMINER, full_name: "Arvidera Gakhal", title: "Maintenance manager", created_at: "" }];
    const w = mountPanel();
    await settle(w);
    expect(w.findAllComponents({ name: "AppSegmentedControl" })).toHaveLength(ROAD_TEST_ITEMS.length + 1);
    expect(button(w).attributes("disabled")).toBeDefined();
    await fill(w);
    expect(w.text()).toContain("files the road-test form and the certificate");
    await button(w).trigger("click");
    await settle(w);
    const post = state.posts.at(-1)!;
    expect(post.url).toBe("/api/recruitment/applicants/d1/road-test");
    expect(post.body).toMatchObject({
      examiner_id: EXAMINER, vehicle_id: TRUCK, trailer_type: "reefer", tested_on: "2026-09-20", miles: 15,
      general_performance: "satisfactory",
    });
    expect(Object.keys((post.body as { items: object }).items)).toHaveLength(ROAD_TEST_ITEMS.length);
  });

  it("says before the press that a Needs Training item issues no certificate", async () => {
    state.examiners = [{ id: EXAMINER, full_name: "Arvidera Gakhal", title: "Maintenance manager", created_at: "" }];
    const w = mountPanel();
    await settle(w);
    await fill(w, "needs_training");
    expect(w.text()).toContain("Not a pass");
  });
});
