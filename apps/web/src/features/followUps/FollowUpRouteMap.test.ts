import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { OffRouteView } from "@silvicom/shared";

/**
 * "Show on map" (OUT-OF-ROUTE-MAP-ANALYSIS option A): nothing is asked until the click; the sentence
 * comes first and alone answers on a phone; a failure is a sentence, not a blank. The map itself is
 * maplibre, which jsdom cannot draw — it is stubbed here, and what it receives is checked.
 */
const api = vi.hoisted(() => ({ answer: null as unknown, paths: [] as string[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    api.paths.push(path);
    return api.answer === "fail" ? { ok: false, error: { message: "Samsara did not answer, so where the truck drove cannot be drawn." } } : { ok: true, data: api.answer };
  }),
}));
const mapProps = vi.hoisted(() => ({ last: null as null | { view: OffRouteView; label: string } }));
vi.mock("@/components/maps/OffRouteMap.vue", () => ({
  __esModule: true,
  default: defineComponent({
    props: { view: { type: Object, required: true }, label: { type: String, required: true } },
    setup(p) {
      mapProps.last = p as never;
      return () => h("div", { "data-test": "map-stub" });
    },
  }),
}));

const { default: FollowUpRouteMap } = await import("./FollowUpRouteMap.vue");

const VIEW: OffRouteView = {
  thresholdMiles: 6,
  samsara: { happenedAt: "2026-11-25T16:00:00.000Z", endedAt: "2026-11-25T17:00:00.000Z", stillActive: false },
  window: { start: "2026-11-25T15:15:00.000Z", end: "2026-11-25T17:20:00.000Z", capped: false },
  path: [{ lat: 40, lng: -90 }, { lat: 40.1, lng: -89.9 }],
  planned: { loadRef: "0138883", relation: "on_load", route: [{ lat: 40, lng: -91 }, { lat: 40, lng: -88 }], toPickup: null, stops: [{ lat: 40, lng: -91, kind: "pickup", name: "Shipper" }] },
  notes: [],
  verdict: {
    state: "back",
    left: { lat: 40.1, lng: -90, at: "2026-11-25T15:58:00.000Z" },
    furthest: { lat: 40.5, lng: -89.9, at: "2026-11-25T16:20:00.000Z", miles: 37.6 },
    back: { lat: 40, lng: -89.5, at: "2026-11-25T16:58:00.000Z" },
    lastMiles: 0.4,
    lastAt: "2026-11-25T17:20:00.000Z",
  },
};

async function render(answer: OffRouteView | "fail") {
  api.answer = answer;
  const w = mount(FollowUpRouteMap, {
    props: { followUpId: "fu-1", warningId: "w-1" },
    global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] },
  });
  await flushPromises();
  return w;
}

beforeEach(() => {
  api.paths = [];
  mapProps.last = null;
});

describe("FollowUpRouteMap", () => {
  it("asks nothing until the click, then says what happened and draws it", async () => {
    const w = await render(VIEW);
    expect(api.paths).toEqual([]);
    await w.find("button").trigger("click");
    await flushPromises();
    await flushPromises();
    expect(api.paths).toEqual(["/api/follow-ups/fu-1/route/w-1"]);
    const sentence = w.find('[data-test="route-sentence"]').text();
    expect(sentence).toMatch(/^Left the planned route at .+, at most 38 mi off, back on it at .+\.$/);
    expect(w.text()).toContain("Load 0138883 · judged against Samsara's 6 miles");
    expect(mapProps.last?.label).toBe(sentence);
    expect(w.find("button").exists()).toBe(false);
  });

  it("says why when the truck had no load, and still draws the path", async () => {
    const w = await render({ ...VIEW, planned: null, verdict: null, notes: ["There was no load on this truck at that time."] });
    await w.find("button").trigger("click");
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-test="route-sentence"]').text()).toMatch(/^There was no load on this truck/);
    expect(w.find('[data-test="route-notes"]').text()).toContain("There was no load on this truck at that time.");
    expect(w.find('[data-test="map-stub"]').exists()).toBe(true);
  });

  it("draws no empty map when there is neither a path nor a stop", async () => {
    const w = await render({ ...VIEW, path: [], planned: null, verdict: null, notes: ["Samsara has no GPS for this truck in that window."] });
    await w.find("button").trigger("click");
    await flushPromises();
    expect(w.find('[data-test="map-stub"]').exists()).toBe(false);
  });

  it("says the API's own words when it cannot draw, and leaves the button to try again", async () => {
    const w = await render("fail");
    await w.find("button").trigger("click");
    await flushPromises();
    expect(w.find('[data-test="route-map-failed"]').text()).toBe("Samsara did not answer, so where the truck drove cannot be drawn.");
    expect(w.find("button").exists()).toBe(true);
  });
});
