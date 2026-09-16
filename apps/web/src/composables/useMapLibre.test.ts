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
 * Swapping the basemap without rebuilding the map (D-DR8).
 *
 * ⚠ The camera is what this is protecting, and it cannot be asserted from a screenshot. If the tiles
 * changed by tearing the map down and constructing a new one, everything visible would still be
 * correct — the right basemap, the right markers — and a dispatcher who had zoomed into a corridor
 * would silently be thrown back to the fleet bounds every time the theme flipped. So the assertion
 * is that `setTiles` was called and the constructor was NOT called a second time.
 */
describe("useMapLibre swaps a reactive basemap in place", () => {
  it("calls setTiles on the existing source instead of constructing a second map", async () => {
    vi.resetModules();
    const constructed: unknown[] = [];
    const setTiles = vi.fn();
    const source = { setTiles };

    vi.doMock("maplibre-gl", () => {
      class FakeMap {
        constructor(opts: unknown) {
          constructed.push(opts);
        }
        addControl() {}
        on() {}
        remove() {}
        getSource() {
          return source;
        }
      }
      return {
        default: {
          Map: FakeMap,
          NavigationControl: class {},
        },
      };
    });
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

    const tiles = ref("/api/fueling/map-tiles/{z}/{x}/{y}?style=explore.day");
    const Host = defineComponent({
      setup() {
        const container = ref<HTMLElement | null>(null);
        subject({ container, tiles, authPathFragment: "/api/fueling/map-tiles/", attribution: "© HERE" });
        return () => h("div", { ref: container });
      },
    });

    const wrapper = mount(Host, { attachTo: document.body });
    // `onMounted` awaits the session before constructing, so one microtask flush is not enough.
    await nextTick();
    await Promise.resolve();
    await nextTick();
    expect(constructed).toHaveLength(1);

    tiles.value = "/api/fueling/map-tiles/{z}/{x}/{y}?style=explore.night";
    await nextTick();

    expect(setTiles).toHaveBeenCalledWith([
      "/api/fueling/map-tiles/{z}/{x}/{y}?style=explore.night",
    ]);
    // The map itself was never rebuilt — which is the pan and zoom surviving the toggle.
    expect(constructed).toHaveLength(1);
    wrapper.unmount();
    vi.doUnmock("maplibre-gl");
    vi.doUnmock("@/lib/supabase");
  });
});
