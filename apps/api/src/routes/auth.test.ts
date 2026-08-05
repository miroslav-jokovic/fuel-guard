import { describe, it, expect } from "vitest";
import { overLimit, __resetLoginThrottle } from "./auth.js";

describe("driver-login throttle", () => {
  it("allows a burst under the cap and refuses past it", () => {
    __resetLoginThrottle();
    for (let i = 0; i < 10; i++) expect(overLimit("u:aaron", 10)).toBe(false);
    expect(overLimit("u:aaron", 10)).toBe(true); // 11th in the window
  });

  it("keys are independent (one hammered username doesn't lock others)", () => {
    __resetLoginThrottle();
    for (let i = 0; i < 11; i++) overLimit("u:aaron", 10);
    expect(overLimit("u:bob", 10)).toBe(false);
  });

  it("the window resets", () => {
    __resetLoginThrottle();
    const t0 = 1_000_000;
    for (let i = 0; i < 11; i++) overLimit("u:aaron", 10, t0);
    expect(overLimit("u:aaron", 10, t0)).toBe(true);
    expect(overLimit("u:aaron", 10, t0 + 16 * 60_000)).toBe(false); // past the 15-min window
  });
});
