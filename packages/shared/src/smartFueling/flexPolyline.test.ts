import { describe, it, expect } from "vitest";
import { decodeFlexPolyline } from "./flexPolyline.js";

// Official HERE flexible-polyline test vectors (github.com/heremaps/flexible-polyline).
describe("decodeFlexPolyline (official vectors)", () => {
  const near = (got: { lat: number; lng: number }[], want: number[][], p = 5) => {
    expect(got.length).toBe(want.length);
    got.forEach((g, i) => { expect(g.lat).toBeCloseTo(want[i]![0]!, p); expect(g.lng).toBeCloseTo(want[i]![1]!, p); });
  };
  it("A — precision 5, 4 points", () => {
    near(decodeFlexPolyline("BFoz5xJ67i1B1B7PzIhaxL7Y"), [[50.10228, 8.69821], [50.10201, 8.69567], [50.10063, 8.6915], [50.09878, 8.68752]]);
  });
  it("B — single point", () => {
    near(decodeFlexPolyline("BFg9tgKgm5xC"), [[52.5, 13.4]]);
  });
  it("C — precision 6", () => {
    near(decodeFlexPolyline("BGw2qlkDoqwwZohKvnP"), [[52.5162, 13.3777], [52.52134, 13.3699]], 6);
  });
  it("F — precision 0", () => {
    near(decodeFlexPolyline("BA3E0E"), [[-76, 74]], 0);
  });
  it("D — 3rd dimension present, lat/lng still decode", () => {
    near(decodeFlexPolyline("BlBoz5xJ67i1BU1B7PUzIhaU"), [[50.10228, 8.69821], [50.10201, 8.69567], [50.10063, 8.6915]]);
  });
  it("rejects an invalid char", () => {
    expect(() => decodeFlexPolyline("BFoz5*J")).toThrow();
  });
});
