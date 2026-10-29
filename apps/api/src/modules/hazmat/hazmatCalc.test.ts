import { describe, expect, it, vi } from "vitest";
import type { LoadInput } from "@hazmat/engine";

/** What `computeCalc` hands the engine — the verdict does not echo `evaluatedAt`, so the input is what is read. */
const seen: LoadInput[] = [];
vi.mock("@hazmat/engine", async (importOriginal) => {
  const real = await importOriginal<typeof import("@hazmat/engine")>();
  return { ...real, evaluateLoad: (input: LoadInput) => (seen.push(input), real.evaluateLoad(input)) };
});
const { computeCalc } = await import("./hazmatCalc.js");

describe("computeCalc (TWO-CLICK-READER-PLAN TC1.5)", () => {
  it("dates the evaluation itself — a caller's own evaluatedAt is not the record", () => {
    const before = Date.now();
    const load = { evaluatedAt: "1999-01-01T00:00:00Z", vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null }, lines: [] };
    computeCalc({ load } as never);
    const at = Date.parse(seen.at(-1)!.evaluatedAt);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });
});
