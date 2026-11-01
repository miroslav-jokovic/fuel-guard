import { describe, expect, it } from "vitest";
import { IDENTITY_CLASSES, IDENTITY_TONES, identityClass, identityTone } from "./identity";

/** D-CHATUI22: a person's colour is derived from their id — the same everywhere, and spread out. */
describe("identityTone", () => {
  it("is the same tone for the same person every time, whatever the case of the id", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect(identityTone(id)).toBe(identityTone(id));
    // Twenty ids, not one: a single upper/lower pair agrees by chance one time in eight.
    for (let i = 0; i < 20; i++) {
      const key = `${i.toString(16).padStart(8, "a")}-abcd-4ef0-8abc-def012345678`;
      expect(identityClass(key.toUpperCase())).toBe(identityClass(key));
    }
  });

  it("uses all eight tones across a hundred ids, with none taking more than a quarter", () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 100; i++) {
      const tone = identityTone(`${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`);
      counts.set(tone, (counts.get(tone) ?? 0) + 1);
    }
    expect(counts.size).toBe(IDENTITY_TONES);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(25);
  });

  it("names a ground and its own initials colour for every tone, and nothing without a key", () => {
    for (const [n, cls] of Object.entries(IDENTITY_CLASSES)) expect(cls).toBe(`bg-identity-${n} text-identity-${n}-ink`);
    expect(identityClass(null)).toBeNull();
    expect(identityClass("")).toBeNull();
  });
});
