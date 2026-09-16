import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import type { LiveMapBoard } from "@silvicom/shared";

/**
 * The full-bleed live-map workspace (DR5, DESIGN-REFRESH-2026-09.md §4).
 *
 * Three of its rulings are only checkable in a mounted tree, and all three are the kind that fail
 * SILENTLY — nothing errors, nothing warns, the page simply stops being usable for somebody:
 *
 * · **D-DR7** — the fleet table stays MOUNTED when the dock is collapsed. The map canvas is a
 *   surface a screen reader cannot enter and the markers carry no unit number, so the table is the
 *   only route to a named truck. `v-if` on the dock would delete it and leave a page whose entire
 *   content is a canvas.
 * · **D-LM18** — the scope sentence is always on screen and has no dismiss control. The document
 *   form said it in an `AppCallout`; a dismissible panel would let a dispatcher switch off the
 *   disclosure that they are looking at the whole fleet, which is the one thing D-LM18 forbids.
 * · **D-LM9b** — the freshness sentence is read from `LIVE_MAP_POLL_MS`, not typed. DR5 deleted the
 *   `PageHeader` that used to carry it, and a sentence quietly dropped in a layout change is how a
 *   page starts lying about how fresh it is.
 *
 * ⚠ `LiveMapCanvas` is stubbed because maplibre needs WebGL and cannot mount in jsdom. That is the
 * same reason `liveMapLayer.ts` exists as a separate pure module — anything a test must hold still
 * is kept out of the canvas component.
 */
const BOARD: LiveMapBoard = {
  generatedAt: "2026-09-16T12:00:00.000Z",
  scope: "all",
  scopeReason: "Showing every truck: loads carry no dispatcher yet.",
  bounds: { stoppedSpeedMph: 3, engineOnBoundSeconds: 900, offlineBoundSeconds: 5400 },
  truncated: false,
  vehicles: [
    {
      vehicleId: "veh-1",
      unitNumber: "47",
      driver: { id: "drv-1", name: "Jordan Ellis" },
      state: "moving",
      ageSeconds: 12,
      load: null,
      position: {
        lat: 41.5,
        lng: -87.5,
        headingDegrees: 270,
        speedMph: 62,
        isEcuSpeed: true,
        formattedLocation: "Gary, IN",
        sampledAt: "2026-09-16T11:59:48.000Z",
        receivedAt: "2026-09-16T11:59:50.000Z",
      },
    },
  ],
};

const board = {
  data: ref<LiveMapBoard | undefined>(BOARD),
  isLoading: ref(false),
  isFetching: ref(false),
  isError: ref(false),
  error: ref<Error | null>(null),
  refetch: vi.fn(),
};

vi.mock("./useLiveMapBoard", () => ({
  LIVE_MAP_POLL_MS: 5_000,
  LIVE_MAP_QUERY_KEY: ["livemap", "positions"],
  useLiveMapBoard: () => board,
}));

const stub = { template: "<div />" };

/**
 * ⚠ The canvas stub EXPOSES `flyTo` and `resize`, rather than being `true`.
 *
 * `vue-test-utils`' automatic stub has no methods, so `canvas.value.resize()` would throw inside the
 * dock watcher and the failure would surface as an unhandled rejection rather than a red test. A
 * stub that answers the same calls as the component keeps the watcher's contract honest: if the
 * canvas ever stops exposing `resize`, typecheck fails and this stays green — which is the right
 * way round, because vue-tsc can see that and jsdom cannot.
 */
const canvasStub = {
  name: "LiveMapCanvas",
  props: ["vehicles", "generatedAt", "selectedId", "fit"],
  emits: ["select"],
  template: "<div data-testid='canvas' />",
  methods: {
    flyTo: () => undefined,
    resize: () => undefined,
  },
};
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", name: "dashboard", component: stub },
    { path: "/live-map", name: "live-map", component: stub, meta: { fullBleed: true } },
    { path: "/vehicles/:id", name: "vehicle", component: stub },
    { path: "/drivers/:id", name: "driver", component: stub },
    { path: "/loads/:id", name: "load", component: stub },
  ],
});

async function mountWorkspace() {
  // Fresh module graph per case: the panel state is a module-level singleton by design, so a toggle
  // in one case would otherwise be the starting state of the next.
  vi.resetModules();
  const { default: LiveMapWorkspace } = await import("./LiveMapWorkspace.vue");
  await router.push("/live-map");
  await router.isReady();
  return mount(LiveMapWorkspace, {
    global: {
      plugins: [router],
      stubs: { LiveMapCanvas: canvasStub, AppIcon: true },
    },
  });
}

function installStorage() {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      get length() {
        return map.size;
      },
    } as Storage,
  });
}

describe("LiveMapWorkspace (DR5)", () => {
  beforeEach(() => {
    installStorage();
    board.data.value = BOARD;
    board.isError.value = false;
  });

  it("keeps the fleet table mounted while the dock is collapsed (D-DR7)", async () => {
    const wrapper = await mountWorkspace();
    const dock = wrapper.find("#live-map-fleet-list");

    // Collapsed is the default — see `liveMapPanels.ts` for why the dock, alone, starts shut.
    expect(wrapper.find('[aria-controls="live-map-fleet-list"]').attributes("aria-expanded")).toBe("false");
    expect(dock.exists()).toBe(true);
    expect(dock.attributes("style")).toContain("display: none");
    // The truck is reachable in the accessibility tree even though nobody can see the dock.
    expect(dock.text()).toContain("47");
    expect(dock.text()).toContain("Jordan Ellis");
  });

  it("opens the dock on the first click and reveals the same table", async () => {
    const wrapper = await mountWorkspace();
    await wrapper.find('[aria-controls="live-map-fleet-list"]').trigger("click");

    const dock = wrapper.find("#live-map-fleet-list");
    expect(wrapper.find('[aria-controls="live-map-fleet-list"]').attributes("aria-expanded")).toBe("true");
    expect(dock.attributes("style") ?? "").not.toContain("display: none");
  });

  it("states the board's scope with no way to dismiss it (D-LM18)", async () => {
    const wrapper = await mountWorkspace();
    expect(wrapper.text()).toContain("Showing every truck: loads carry no dispatcher yet.");

    // Every dismissible thing on this page is a button. The scope sentence must not be one of them,
    // and must not be inside a panel that has one.
    const scope = wrapper.findAll("p").find((p) => p.text().startsWith("Showing every truck"));
    expect(scope).toBeDefined();
    expect(scope!.element.closest("button")).toBeNull();
    expect(scope!.element.closest("[aria-label]")).toBeNull();
  });

  it("derives the freshness sentence from the poll interval rather than typing it (D-LM9b)", async () => {
    const wrapper = await mountWorkspace();
    expect(wrapper.text()).toContain("Positions refresh every 5 seconds while this tab is open.");
  });

  it("shows the truck card only once a truck is selected, and its dismiss clears the selection", async () => {
    const wrapper = await mountWorkspace();
    expect(wrapper.find('[aria-label="Unit 47"]').exists()).toBe(false);

    // The same gesture the table row gives: select the truck.
    await wrapper.findComponent({ name: "LiveMapCanvas" }).vm.$emit("select", "veh-1");
    await wrapper.vm.$nextTick();
    const card = wrapper.find('[aria-label="Unit 47"]');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain("62 mph (engine)");
    expect(card.text()).toContain("Gary, IN");
    expect(card.text()).toContain("Jordan Ellis");

    // The card's pill IS its dismiss control, labelled with the unit it dismisses — and dismissing
    // it clears the SELECTION rather than remembering a closed panel. A dispatcher who shut it once
    // must still get a card the next time they click a truck.
    const pill = wrapper.findAll("button").find((b) => b.text().includes("Unit 47"));
    expect(pill).toBeDefined();
    await pill!.trigger("click");
    expect(wrapper.find('[aria-label="Unit 47"]').exists()).toBe(false);

    await wrapper.findComponent({ name: "LiveMapCanvas" }).vm.$emit("select", "veh-1");
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[aria-label="Unit 47"]').exists()).toBe(true);
  });
});
