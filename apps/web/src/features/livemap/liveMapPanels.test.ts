import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The live map's remembered panel state (D-DR6, DESIGN-REFRESH-2026-09.md §4).
 *
 * The rule worth pinning is the one that made `useDeviationSet` a separate composable rather than a
 * copy of the sidebar's: the stored set holds what somebody CHANGED, not what is open, so an empty
 * set has to reproduce two OPPOSITE defaults — the two corner panels open, the fleet dock shut. A
 * "store the closed ones" set gets the corners right and the dock exactly backwards, which is the
 * same contradiction phase 6 hit in the sidebar and is invisible until the first click.
 *
 * ⚠ The module holds its set at module scope (one live map per tab, and it must survive the
 * component being unmounted by a route change), so each case re-imports the module with a fresh
 * storage behind it rather than trying to reset a singleton.
 */
function installStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
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
  return map;
}

async function freshModule() {
  vi.resetModules();
  return await import("./liveMapPanels");
}

describe("live map panel state (D-DR6)", () => {
  beforeEach(() => {
    installStorage();
  });

  it("opens the two corner panels and shuts the fleet dock before anybody has touched anything", async () => {
    const { isPanelOpen } = await freshModule();
    expect(isPanelOpen("status")).toBe(true);
    expect(isPanelOpen("filters")).toBe(true);
    // D-DR5's whole point is that the map becomes the page. A dock holding 199 rows that opened by
    // itself would hand a third of the viewport back to the document this step replaces.
    expect(isPanelOpen("fleet")).toBe(false);
  });

  it("closes an open panel on the FIRST click, and opens a shut one on the first click too", async () => {
    const { isPanelOpen, useLiveMapPanels } = await freshModule();
    const { toggle } = useLiveMapPanels();

    toggle("status");
    expect(isPanelOpen("status")).toBe(false);

    toggle("fleet");
    expect(isPanelOpen("fleet")).toBe(true);
  });

  it("returns to the default on a second click, in both directions", async () => {
    const { isPanelOpen, useLiveMapPanels } = await freshModule();
    const { toggle } = useLiveMapPanels();

    toggle("status");
    toggle("status");
    expect(isPanelOpen("status")).toBe(true);

    toggle("fleet");
    toggle("fleet");
    expect(isPanelOpen("fleet")).toBe(false);
  });

  it("leaves the other panels alone", async () => {
    const { isPanelOpen, useLiveMapPanels } = await freshModule();
    useLiveMapPanels().toggle("status");
    expect(isPanelOpen("filters")).toBe(true);
    expect(isPanelOpen("fleet")).toBe(false);
  });

  it("remembers the dispatcher's choice across a reload, storing only what changed", async () => {
    const store = installStorage();
    const first = await freshModule();
    first.useLiveMapPanels().toggle("fleet");

    expect(JSON.parse(store.get("fg.livemap-panels")!)).toEqual(["fleet"]);

    const afterReload = await freshModule();
    expect(afterReload.isPanelOpen("fleet")).toBe(true);
    expect(afterReload.isPanelOpen("status")).toBe(true);
  });

  it("still toggles when storage is unavailable, because a preference is not a requirement", async () => {
    const { isPanelOpen, useLiveMapPanels } = await freshModule();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage disabled");
      },
    });
    expect(() => useLiveMapPanels().toggle("filters")).not.toThrow();
    expect(isPanelOpen("filters")).toBe(false);
    installStorage();
  });

  it("gives the fleet list no corner, because it is a dock and not a floating panel (D-DR7)", async () => {
    const { LIVE_MAP_PANELS } = await freshModule();
    expect(LIVE_MAP_PANELS.fleet.corner).toBeNull();
    expect(LIVE_MAP_PANELS.status.corner).toBe("top-left");
    expect(LIVE_MAP_PANELS.filters.corner).toBe("top-right");
    // ⚠ No panel claims `bottom-right`. Comp (7) puts "Recent alerts" there and this board has no
    // alert feed; the corner is absent rather than empty.
    expect(Object.values(LIVE_MAP_PANELS).map((p) => p.corner)).not.toContain("bottom-right");
  });
});
