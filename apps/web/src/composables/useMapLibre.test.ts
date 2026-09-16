import { describe, it, expect, vi } from "vitest";
import { toMapColor } from "./useMapLibre";

/**
 * The oklch→sRGB conversion, which had no test until LM7 extracted it.
 *
 * That is the point of the extraction rather than a bonus from it. This function lived inside a
 * `.vue` file that needs a WebGL canvas to mount, so the only way to exercise it was to look at a
 * map — and the failure it exists to prevent is one nobody looks for: maplibre throws
 * `color expected, 'oklch(…)'` and the route line simply is not drawn. It shipped broken on Edge once
 * already, because an earlier canvas round-trip left `oklch()` untouched on that engine.
 */
describe("toMapColor", () => {
  // The whole reason the function exists: maplibre's style parser rejects oklch outright.
  it("converts an oklch token to the rgb() maplibre can parse", () => {
    const got = toMapColor("oklch(0.55 0.2 250)");
    expect(got).toMatch(/^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/);
  });

  it("passes an rgb() through untouched — older engines already return one", () => {
    expect(toMapColor("rgb(37, 99, 235)")).toBe("rgb(37, 99, 235)");
    expect(toMapColor("rgba(37, 99, 235, 0.5)")).toBe("rgba(37, 99, 235, 0.5)");
    expect(toMapColor("#2563eb")).toBe("#2563eb");
  });

  it("trims whatever getComputedStyle hands back", () => {
    expect(toMapColor("  rgb(1, 2, 3)  ")).toBe("rgb(1, 2, 3)");
  });

  // An empty computed colour means the token class resolved to nothing — a design-system problem, not
  // a reason to hand maplibre an empty string and have the whole style fail to parse.
  it("falls back to a usable colour rather than letting an empty string reach the style parser", () => {
    expect(toMapColor("")).toBe("rgb(37, 99, 235)");
    expect(toMapColor("   ")).toBe("rgb(37, 99, 235)");
  });

  it("reads percentage lightness and chroma, which is how CSS may serialise them", () => {
    // 100% chroma is 0.4 by the CSS definition, so these two spellings are the same colour.
    expect(toMapColor("oklch(55% 50% 250)")).toBe(toMapColor("oklch(0.55 0.2 250)"));
  });

  it("clamps a colour outside the sRGB gamut into bytes rather than emitting nonsense", () => {
    const got = toMapColor("oklch(0.9 0.4 140)"); // far outside sRGB
    const parts = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(got);
    expect(parts).not.toBeNull();
    for (const p of parts!.slice(1)) {
      expect(Number(p)).toBeGreaterThanOrEqual(0);
      expect(Number(p)).toBeLessThanOrEqual(255);
    }
  });

  // Anchors, so a "tidy-up" of the matrices is caught rather than shifting every colour on the map by
  // a few points where nobody would notice.
  it("puts known oklch values where they belong in sRGB", () => {
    expect(toMapColor("oklch(0 0 0)")).toBe("rgb(0, 0, 0)");
    expect(toMapColor("oklch(1 0 0)")).toBe("rgb(255, 255, 255)");
    // Mid-grey: no chroma, so all three channels must agree.
    const grey = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(toMapColor("oklch(0.6 0 0)"))!;
    expect(grey[1]).toBe(grey[2]);
    expect(grey[2]).toBe(grey[3]);
  });

  /**
   * ⚠ EXACT values, and the reason is a mutant that survived the first draft of this file.
   *
   * These three started as "the red channel dominates for a red hue, the blue channel for a blue
   * one" — which reads like a real assertion and is not one. Feeding the hue to `Math.cos` in DEGREES
   * instead of radians left every one of them green, because 25 and 250 radians happen to wrap to
   * angles with the same dominant channel. Pinning the actual sRGB triples is the only version of
   * this test that can tell a correct conversion from a plausible one.
   */
  it("lands three known hues on their exact sRGB triples", () => {
    expect(toMapColor("oklch(0.6 0.2 25)")).toBe("rgb(222, 59, 61)");
    expect(toMapColor("oklch(0.6 0.2 145)")).toBe("rgb(0, 157, 30)");
    expect(toMapColor("oklch(0.6 0.2 250)")).toBe("rgb(0, 129, 241)");
  });
});

/**
 * Swapping the basemap by giving each one its own layer (D-DR8, rebuilt by D-DR23).
 *
 * ⚠ The camera is what this has always been protecting, and it cannot be asserted from a screenshot.
 * If the tiles changed by tearing the map down and constructing a new one, everything visible would
 * still be correct — the right basemap, the right markers — and a dispatcher who had zoomed into a
 * corridor would silently be thrown back to the fleet bounds every time the theme flipped. So the
 * constructor count is asserted in every case below.
 *
 * ⚠ These tests used to assert `setTiles`, which is now the opposite of the shipped behaviour — the
 * same kind of deliberate rewrite D-DR20 made when `satellite.day` stopped being refused. `setTiles`
 * kept ONE source and re-pointed it, which discarded maplibre's tiles for the basemap being left:
 * measured in a browser, a flip back to a scheme already seen re-requested all nine viewport tiles
 * (served by the HTTP cache, so zero bytes, but re-decoded and re-uploaded) and took ~0.4 s. Holding
 * a layer per basemap makes the same flip a visibility toggle with no requests at all.
 */
interface FakeLayer {
  id: string;
  type: string;
  source: string;
  layout?: { visibility?: string };
}

function mapHarness() {
  const constructed: unknown[] = [];
  const sources: string[] = [];
  const layers: FakeLayer[] = [];
  const loaded = new Set<string>();
  const handlers: ((e: { sourceId: string }) => void)[] = [];

  class FakeMap {
    constructor(opts: { style: { sources: Record<string, unknown>; layers: FakeLayer[] } }) {
      constructed.push(opts);
      for (const id of Object.keys(opts.style.sources)) {
        sources.push(id);
        loaded.add(id);
      }
      layers.push(...opts.style.layers);
      // Whatever `onLoad` would have added — the truck markers on the live map. Everything the
      // composable adds later has to go UNDER this, or a basemap switch paints over the fleet.
      layers.push({ id: "vehicles", type: "symbol", source: "vehicles" });
    }
    addControl() {}
    on(event: string, fn: (e: { sourceId: string }) => void) {
      if (event === "sourcedata") handlers.push(fn);
    }
    off(_event: string, fn: (e: { sourceId: string }) => void) {
      const i = handlers.indexOf(fn);
      if (i >= 0) handlers.splice(i, 1);
    }
    remove() {}
    getSource(id: string) {
      return sources.includes(id) ? { id } : undefined;
    }
    getLayer(id: string) {
      return layers.find((l) => l.id === id);
    }
    getStyle() {
      return { layers };
    }
    addSource(id: string) {
      sources.push(id);
    }
    addLayer(layer: FakeLayer, beforeId?: string) {
      const at = beforeId ? layers.findIndex((l) => l.id === beforeId) : -1;
      if (at >= 0) layers.splice(at, 0, layer);
      else layers.push(layer);
    }
    setLayoutProperty(id: string, _prop: string, value: string) {
      const layer = layers.find((l) => l.id === id);
      if (layer) layer.layout = { visibility: value };
    }
    isSourceLoaded(id: string) {
      return loaded.has(id);
    }
  }

  /** Let a source finish loading, the way maplibre reports it. */
  const finishLoading = (id: string) => {
    loaded.add(id);
    for (const fn of [...handlers]) fn({ sourceId: id });
  };

  return { FakeMap, constructed, sources, layers, finishLoading, visible: () => layers.filter((l) => l.type === "raster" && l.layout?.visibility !== "none").map((l) => l.id) };
}

async function mountMap(FakeMap: unknown, tilesRef: { value: string }) {
  vi.doMock("maplibre-gl", () => ({ default: { Map: FakeMap, NavigationControl: class {} } }));
  vi.doMock("@/lib/supabase", () => ({
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "t" } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  }));
  const { ref, defineComponent, h, nextTick } = await import("vue");
  const { mount } = await import("@vue/test-utils");
  const { useMapLibre: subject } = await import("./useMapLibre");
  const Host = defineComponent({
    setup() {
      const container = ref<HTMLElement | null>(null);
      subject({
        container,
        tiles: tilesRef as never,
        authPathFragment: "/api/fueling/map-tiles/",
        attribution: "© HERE",
      });
      return () => h("div", { ref: container });
    },
  });
  const wrapper = mount(Host, { attachTo: document.body });
  // `onMounted` awaits the session before constructing, so one microtask flush is not enough.
  await nextTick();
  await Promise.resolve();
  await nextTick();
  return { wrapper, nextTick };
}

const DAY = "/api/fueling/map-tiles/{z}/{x}/{y}?style=explore.day&format=jpeg";
const NIGHT = "/api/fueling/map-tiles/{z}/{x}/{y}?style=explore.night&format=jpeg";

describe("useMapLibre gives each basemap its own layer", () => {
  it("adds a layer for an unseen basemap and never rebuilds the map", async () => {
    vi.resetModules();
    const h = mapHarness();
    const { ref } = await import("vue");
    const tiles = ref(DAY);
    const { wrapper, nextTick } = await mountMap(h.FakeMap, tiles);
    expect(h.constructed).toHaveLength(1);

    tiles.value = NIGHT;
    await nextTick();
    h.finishLoading("here-1");

    expect(h.sources).toEqual(["here", "here-1"]);
    // The camera survives — the whole point of not rebuilding.
    expect(h.constructed).toHaveLength(1);
    expect(h.visible()).toEqual(["here-1"]);
    wrapper.unmount();
    vi.doUnmock("maplibre-gl");
    vi.doUnmock("@/lib/supabase");
  });

  /**
   * ⚠ The defect this prevents is not subtle and would be reported as "the trucks disappeared when I
   * changed the theme": maplibre appends a layer with no `beforeId` to the TOP of the style, so the
   * second basemap would be painted over the markers `onLoad` added.
   */
  it("puts a new basemap under the layers the caller added, not over them", async () => {
    vi.resetModules();
    const h = mapHarness();
    const { ref } = await import("vue");
    const tiles = ref(DAY);
    const { wrapper, nextTick } = await mountMap(h.FakeMap, tiles);

    tiles.value = NIGHT;
    await nextTick();

    expect(h.layers.map((l) => l.id)).toEqual(["here", "here-1", "vehicles"]);
    wrapper.unmount();
    vi.doUnmock("maplibre-gl");
    vi.doUnmock("@/lib/supabase");
  });

  /**
   * The measured win. A reader flipping light→dark→light is the common case, and the second flip
   * must cost nothing: no source, no layer, no tile request — just which one is drawn.
   */
  it("reuses the layer when the reader returns to a basemap this map has already shown", async () => {
    vi.resetModules();
    const h = mapHarness();
    const { ref } = await import("vue");
    const tiles = ref(DAY);
    const { wrapper, nextTick } = await mountMap(h.FakeMap, tiles);

    tiles.value = NIGHT;
    await nextTick();
    h.finishLoading("here-1");
    tiles.value = DAY;
    await nextTick();

    expect(h.sources).toEqual(["here", "here-1"]);
    expect(h.layers).toHaveLength(3);
    expect(h.visible()).toEqual(["here"]);
    wrapper.unmount();
    vi.doUnmock("maplibre-gl");
    vi.doUnmock("@/lib/supabase");
  });

  /**
   * ⚠ Order matters on a FIRST switch: hiding the old basemap the instant the new one is requested
   * would show the empty canvas for as long as the tiles take to arrive — a white flash in dark mode,
   * which is worse than the delay it replaces.
   */
  it("keeps the old basemap on screen until the new one has loaded", async () => {
    vi.resetModules();
    const h = mapHarness();
    const { ref } = await import("vue");
    const tiles = ref(DAY);
    const { wrapper, nextTick } = await mountMap(h.FakeMap, tiles);

    tiles.value = NIGHT;
    await nextTick();
    // Both are drawn while the new one loads: the old underneath, the new on top of it.
    expect(h.visible()).toEqual(["here", "here-1"]);

    h.finishLoading("here-1");
    expect(h.visible()).toEqual(["here-1"]);
    wrapper.unmount();
    vi.doUnmock("maplibre-gl");
    vi.doUnmock("@/lib/supabase");
  });
});
