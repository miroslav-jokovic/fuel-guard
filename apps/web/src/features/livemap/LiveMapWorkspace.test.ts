import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import type { LiveMapBoard } from "@silvicom/shared";

/**
 * The full-bleed live-map workspace (DR5 §4, relaid out by D-DR25).
 *
 * Three of its rulings are only checkable in a mounted tree, and all three are the kind that fail
 * SILENTLY — nothing errors, nothing warns, the page simply stops being usable for somebody:
 *
 * · **D-DR7, as D-DR25 rewrote it** — the fleet list stays MOUNTED and reachable at every width. The
 *   map canvas is a surface a screen reader cannot enter and the markers carry no unit number, so
 *   the list is the only route to a named truck. It used to be a dock that `v-show` kept alive while
 *   collapsed; it is now a rail that is a permanent column at `lg` and an overlay below it, and the
 *   property to hold is the same one: the trucks are in the DOM whether or not they are on screen.
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
  bounds: { stoppedSpeedMph: 3, engineOnBoundSeconds: 900, offlineBoundSeconds: 5400, fuelFreshSeconds: 900 },
  truncated: false,
  vehicles: [
    {
      vehicleId: "veh-1",
      unitNumber: "47",
      driver: { id: "drv-1", name: "Jordan Ellis" },
      state: "moving",
      ageSeconds: 12,
      load: null,
      fuel: { percent: 68, at: "2026-09-16T11:58:00.000Z" },
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

  /**
   * ⚠ REWRITTEN BY D-DR25 with the dock it described. The property is unchanged and is the reason
   * either shape has to be tested at all: a truck must be findable by NAME without the canvas, which
   * nothing but this list offers. A rail rendered with `v-if` behind a media query would satisfy
   * every visual check and leave a keyboard user a page containing one canvas.
   */
  it("keeps every truck in the fleet list, mounted, at every width (D-DR7)", async () => {
    const wrapper = await mountWorkspace();
    const rail = wrapper.findComponent({ name: "LiveMapRail" });

    expect(rail.exists()).toBe(true);
    expect(rail.text()).toContain("47");
    expect(rail.text()).toContain("Jordan Ellis");
    // The rail's own box is never `v-if`'d away — only the wrapper's visibility classes change.
    expect(wrapper.html()).toContain("lg:block");
  });

  it("selects a truck from the rail, which is the keyboard's way onto the map", async () => {
    const wrapper = await mountWorkspace();
    const row = wrapper.findAll("button").find((b) => b.text().includes("Jordan Ellis"));
    expect(row, "a row for the truck should be in the rail").toBeDefined();

    await row!.trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[aria-label="Unit 47"]').exists()).toBe(true);
  });

  /**
   * The census IS the status filter (D-DR25): the counts used to be stated twice, once in a "Fleet
   * status" panel and once inside the Status dropdown's option labels. Pressing one filters.
   */
  it("filters from the census button rather than from a second control that repeats it", async () => {
    const wrapper = await mountWorkspace();
    const moving = wrapper.findAll("button").find((b) => b.text().startsWith("Moving"));
    expect(moving, "the census should be pressable").toBeDefined();
    expect(moving!.attributes("aria-pressed")).toBe("false");

    await moving!.trigger("click");
    expect(wrapper.findAll("button").find((b) => b.text().startsWith("Moving"))!.attributes("aria-pressed")).toBe("true");
    // …and the map is drawing the filtered set, not the whole board.
    expect(wrapper.findComponent({ name: "LiveMapCanvas" }).props("vehicles")).toHaveLength(1);
  });

  /**
   * D-LM18, and the assertion has now changed with the layout TWICE rather than being deleted once.
   *
   * ⚠ It used to read `closest("[aria-label]") === null`, which was a proxy for "not inside a
   * dismissible floating panel" — every one of those carried a label. The rail is a labelled
   * landmark (`<aside aria-label="Fleet">`), so that proxy now fails on correct markup, which is the
   * failure mode a proxy assertion always has.
   *
   * ⚠ `Q-LM19` moved the disclosure from a paragraph of its own into the clause the count sentence
   * ends in, so what is searched for is the CLAUSE and not the old paragraph's first words. The
   * property is unchanged and is still asserted directly: the disclosure is on screen, it is not a
   * control, and it appears in BOTH places the board can be read from — the rail at `lg`, and beside
   * the Fleet button below it, where the rail is shut most of the time.
   */
  it("states the board's scope with no way to dismiss it, at every width (D-LM18)", async () => {
    const wrapper = await mountWorkspace();
    const said = wrapper.findAll("p, summary").filter((el) => el.text().includes("in the fleet"));

    expect(said.length, "the scope must be stated in the rail and beside the map's fleet button").toBe(2);
    for (const el of said) expect(el.element.closest("button")).toBeNull();
    // One of the two is the small-screen copy, and it is the one that must survive a shut rail.
    expect(said.some((el) => el.classes().includes("truncate"))).toBe(true);
  });

  /**
   * The owner's item 6, and the half that could not be finished until `Q-LM19` was ruled: the foot
   * is ONE line, and the two decisions that used to occupy it are still on the page.
   *
   * ⚠ The `<details>` is asserted CLOSED. That is the whole difference between moving reference
   * material one click away and deleting it — the reason is in the document for in-page search and
   * for a screen reader's document walk, and it is not on screen. A `v-if` would pass "not visible"
   * and fail this.
   */
  it("keeps the scope reason and the bounds one click away rather than on screen (Q-LM19)", async () => {
    const wrapper = await mountWorkspace();
    const details = wrapper.get("aside details");

    expect(details.attributes("open"), "the foot opens collapsed, or item 6 is not fixed").toBeUndefined();
    expect(details.get("summary").text()).toBe("1 truck in the fleet · refreshes every 5s");
    expect(details.text()).toContain(BOARD.scopeReason);
    // Read from `bounds`, which this board deliberately sets to something other than production's.
    expect(details.text()).toContain("No fix for over 90 min");
    expect(details.text()).toContain("Not moving, heard from within 900s");
  });

  /**
   * `Q-LM20` on the surface a dispatcher reads, and the case that is a quarter of this fleet: a
   * truck whose POSITION is seconds old and whose TANK was last reported days ago. The card must
   * keep the number — an unburnt tank does not stop being true — and say how old it is, in the same
   * panel where the fix reads "12s ago". The two ages are independent and both are on screen.
   */
  it("says a live truck's tank is old when it is, without hiding the level (Q-LM20)", async () => {
    board.data.value = {
      ...BOARD,
      vehicles: [{ ...BOARD.vehicles[0]!, fuel: { percent: 41, at: "2026-09-13T12:00:00.000Z" } }],
    };
    const wrapper = await mountWorkspace();
    await wrapper.findComponent({ name: "LiveMapCanvas" }).vm.$emit("select", "veh-1");
    await wrapper.vm.$nextTick();
    const card = wrapper.find('[aria-label="Unit 47"]');
    expect(card.text()).toContain("41% · read 3d ago");
    // …and the FIX age is untouched by it. One is the GPS feed, the other the ECU.
    expect(card.text()).toContain("Fix 12s ago");
  });

  it("derives the freshness sentence from the poll interval rather than typing it (D-LM9b)", async () => {
    const wrapper = await mountWorkspace();
    expect(wrapper.text()).toContain("refreshes every 5s");
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
    // `Q-LM20`: the tank is on the card, and this fixture's reading is inside the bound.
    expect(card.text()).toContain("68%");
    expect(card.text()).not.toContain("read");
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
