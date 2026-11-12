import { afterEach, describe, expect, it, vi } from "vitest";
import { BASEMAP_MEMORY_KEY, offeredBasemaps, rememberBasemap, rememberedBasemap } from "./liveMapBasemapMemory";

/**
 * Q-DR36 (a): the basemap is kept for the window. What costs something if it regresses: a choice
 * the menu no longer offers coming back (a map on a basemap nobody can see named), storage that
 * throws taking the map down with it, and the trial key leaking into a production build's offer.
 */
const memory = (initial: Record<string, string> = {}) => {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    store,
  };
};

afterEach(() => vi.unstubAllEnvs());

describe("rememberedBasemap", () => {
  it("returns the window's last choice when the menu still offers it", () => {
    const s = memory({ [BASEMAP_MEMORY_KEY]: "satellite" });
    expect(rememberedBasemap(["map", "satellite", "terrain"], "map", s)).toBe("satellite");
  });

  it("falls back when the remembered choice is not offered in this build (the trial key on production)", () => {
    const s = memory({ [BASEMAP_MEMORY_KEY]: "vector" });
    expect(rememberedBasemap(["map", "satellite", "terrain"], "map", s)).toBe("map");
  });

  it("falls back when nothing was remembered, when there is no storage, and when reading throws", () => {
    expect(rememberedBasemap(["map"], "map", memory())).toBe("map");
    expect(rememberedBasemap(["map"], "map", null)).toBe("map");
    const throwing = { getItem: () => { throw new Error("private mode"); }, setItem: () => {} };
    expect(rememberedBasemap(["map"], "map", throwing)).toBe("map");
  });
});

describe("rememberBasemap", () => {
  it("keeps the choice under the one key the reader uses", () => {
    const s = memory();
    rememberBasemap("terrain", s);
    expect(s.store.get(BASEMAP_MEMORY_KEY)).toBe("terrain");
    expect(rememberedBasemap(["terrain"], "map", s)).toBe("terrain");
  });

  it("does not throw when the storage refuses, and does nothing without one", () => {
    const refusing = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => rememberBasemap("map", refusing)).not.toThrow();
    expect(() => rememberBasemap("map", null)).not.toThrow();
  });
});

describe("offeredBasemaps", () => {
  it("is the catalogue on a production build, and the catalogue plus the trial where the trial is on", () => {
    vi.stubEnv("VITE_APP_ENVIRONMENT", "production");
    expect(offeredBasemaps()).toEqual(["map", "satellite", "terrain"]);
    vi.stubEnv("VITE_APP_ENVIRONMENT", "UAT");
    expect(offeredBasemaps()).toEqual(["map", "satellite", "terrain", "vector"]);
  });
});
