import { describe, it, expect } from "vitest";
import { netFromPosted } from "./discount.js";

describe("netFromPosted", () => {
  it("flat / retail_minus subtract cents/gal off posted", () => {
    expect(netFromPosted(4.0, { brand: "pilot", type: "flat", centsOff: 40 })).toBe(3.6);
    expect(netFromPosted(4.0, { brand: "pilot", type: "retail_minus", centsOff: 65 })).toBe(3.35);
  });
  it("cost_plus adds a fixed margin", () => {
    expect(netFromPosted(3.2, { brand: "x", type: "cost_plus", centsOff: 15 })).toBe(3.35);
  });
  it("none / missing / per_site return posted unchanged", () => {
    expect(netFromPosted(4.0, { brand: "x", type: "none", centsOff: 99 })).toBe(4.0);
    expect(netFromPosted(4.0, null)).toBe(4.0);
    expect(netFromPosted(4.0, { brand: "x", type: "per_site", centsOff: 10 })).toBe(4.0);
  });
  it("null posted -> null", () => {
    expect(netFromPosted(null, { brand: "x", type: "flat", centsOff: 40 })).toBeNull();
  });
});
