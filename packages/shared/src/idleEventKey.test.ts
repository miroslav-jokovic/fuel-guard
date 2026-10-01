import { describe, it, expect } from "vitest";
import { idleEventKey, isEncodedIdleEventId, dedupeIdleEventsByKey } from "./idleEventKey.js";

// Real pairs from production idle_events, 2026-10-01 (same vehicle, start and duration).
const PAIRS = [
  ["3411b05c-3d84-4ad3-bcbe-4c6d819a6f15", "33343131-4230-3543-3344-383434414433"],
  ["28f44530-8860-4088-9d0c-5e57addbc476", "32384634-3435-3330-3838-363034303838"],
  ["2560e36b-3501-42b5-bdeb-19d8c91ec3ce", "32353630-4533-3642-3335-303134324235"],
  ["ddf15eb8-1d3e-458c-b0fa-35679ef2825f", "44444631-3545-4238-3144-334534353843"],
  // The 08/24 pair whose encoded twin had no vehicle — the case (vehicle, start, duration) missed.
  ["5a42d476-edc3-41ca-a0c5-ab53613fcfba", "35413432-4434-3736-4544-433334314341"],
] as const;

describe("idleEventKey", () => {
  it("gives both spellings of every production pair the same key", () => {
    for (const [plain, encoded] of PAIRS) expect(idleEventKey(encoded)).toBe(idleEventKey(plain));
  });

  it("is the first sixteen hex digits, lower case", () => {
    expect(idleEventKey("3411B05C-3D84-4AD3-BCBE-4C6D819A6F15")).toBe("3411b05c3d844ad3");
    expect(idleEventKey("33343131-4230-3543-3344-383434414433")).toBe("3411b05c3d844ad3");
  });

  it("keeps two different events apart even when they share a vehicle and a minute", () => {
    expect(idleEventKey(PAIRS[0][0])).not.toBe(idleEventKey(PAIRS[1][0]));
    expect(idleEventKey(PAIRS[0][1])).not.toBe(idleEventKey(PAIRS[1][1]));
  });

  it("leaves an id that is not a UUID as its own key", () => {
    expect(idleEventKey("A")).toBe("A");
    expect(idleEventKey("evt-123")).toBe("evt-123");
  });
});

describe("isEncodedIdleEventId", () => {
  it("tells the two spellings apart", () => {
    for (const [plain, encoded] of PAIRS) {
      expect(isEncodedIdleEventId(plain)).toBe(false);
      expect(isEncodedIdleEventId(encoded)).toBe(true);
    }
  });
});

describe("dedupeIdleEventsByKey", () => {
  const id = (e: { id: string }) => e.id;

  it("keeps the real-UUID spelling whichever order the pair arrives in", () => {
    const [plain, encoded] = PAIRS[0];
    expect(dedupeIdleEventsByKey([{ id: encoded }, { id: plain }], id)).toEqual([{ id: plain }]);
    expect(dedupeIdleEventsByKey([{ id: plain }, { id: encoded }], id)).toEqual([{ id: plain }]);
  });

  it("keeps one row per event across a whole batch of pairs", () => {
    const batch = PAIRS.flatMap(([p, e]) => [{ id: e }, { id: p }]);
    const out = dedupeIdleEventsByKey(batch, id);
    expect(out.map((e) => e.id).sort()).toEqual(PAIRS.map(([p]) => p).sort());
  });

  it("collapses an exact repeat (an overlapping fetch chunk edge) to one", () => {
    expect(dedupeIdleEventsByKey([{ id: "A" }, { id: "A" }, { id: "B" }], id)).toEqual([{ id: "A" }, { id: "B" }]);
  });
});
