import { describe, expect, it } from "vitest";
import { queryFlag, windowSchema, entriesSchema, cpmQuerySchema } from "./schemas.js";

describe("queryFlag — a query-string flag read strictly, not coerced", () => {
  // The regression. `z.coerce.boolean()` is Boolean("0") === true, so the three spellings a person
  // reaches for when they want a flag OFF all turned it ON.
  it.each(["0", "false", "no"])("reads %s as false", (v) => {
    expect(queryFlag.parse(v)).toBe(false);
  });

  it.each(["1", "true", "yes"])("reads %s as true", (v) => {
    expect(queryFlag.parse(v)).toBe(true);
  });

  it("rejects an unrecognised value rather than guessing", () => {
    // A typo'd flag is a 400, not a silent false that answers a different question.
    expect(queryFlag.safeParse("maybe").success).toBe(false);
    expect(queryFlag.safeParse("").success).toBe(false);
  });
});

describe("cpmQuerySchema — the owner-operator pool cannot be switched on by a value that says off", () => {
  const base = { from: "2026-06-01", to: "2026-07-01" };

  it("keeps includeOwnerOperators false when the query says false", () => {
    const parsed = cpmQuerySchema.parse({ ...base, includeOwnerOperators: "false" });
    expect(parsed.includeOwnerOperators).toBe(false);
  });

  it("keeps it false when the query says 0", () => {
    expect(cpmQuerySchema.parse({ ...base, includeOwnerOperators: "0" }).includeOwnerOperators).toBe(false);
  });

  it("turns it on for 1", () => {
    expect(cpmQuerySchema.parse({ ...base, includeOwnerOperators: "1" }).includeOwnerOperators).toBe(true);
  });

  it("leaves it undefined when absent, so the harness default stands", () => {
    expect(cpmQuerySchema.parse(base).includeOwnerOperators).toBeUndefined();
  });

  it("accepts a deadhead treatment and rejects an unknown one", () => {
  });
});

describe("window ordering — `to` is exclusive, so `from` must be strictly before it", () => {
  it("accepts a normal window", () => {
    expect(windowSchema.safeParse({ from: "2026-06-01", to: "2026-07-01" }).success).toBe(true);
  });

  // Both of these used to parse, return nothing, and render as "no data yet" — which is what an
  // un-swept month also looks like. The reader could not tell a typo from an operational gap.
  it("rejects an inverted window", () => {
    const r = windowSchema.safeParse({ from: "2026-07-01", to: "2026-06-01" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain("must be before");
  });

  it("rejects an empty window where from equals to", () => {
    expect(windowSchema.safeParse({ from: "2026-06-01", to: "2026-06-01" }).success).toBe(false);
  });

  it("still rejects a malformed date", () => {
    expect(windowSchema.safeParse({ from: "06/01/2026", to: "2026-07-01" }).success).toBe(false);
  });

  it("applies the same rule to the CPM query", () => {
    expect(cpmQuerySchema.safeParse({ from: "2026-07-01", to: "2026-06-01" }).success).toBe(false);
  });
});

describe("entriesSchema — the ledger's window is optional, but ordered when both ends are given", () => {
  it("allows an open-ended query with neither bound", () => {
    expect(entriesSchema.safeParse({}).success).toBe(true);
  });

  it("allows a single bound", () => {
    expect(entriesSchema.safeParse({ from: "2026-06-01" }).success).toBe(true);
    expect(entriesSchema.safeParse({ to: "2026-07-01" }).success).toBe(true);
  });

  it("rejects an inverted window when both are given", () => {
    expect(entriesSchema.safeParse({ from: "2026-07-01", to: "2026-06-01" }).success).toBe(false);
  });

  it("reads `all` strictly, so ?all=false is a drill-down that stays off", () => {
    expect(entriesSchema.parse({ all: "false" }).all).toBe(false);
    expect(entriesSchema.parse({ all: "1" }).all).toBe(true);
  });

  it("carries the truck and driver dimensions the ledger page now sends", () => {
    const id = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    const parsed = entriesSchema.parse({ vehicleId: id, driverId: id });
    expect(parsed.vehicleId).toBe(id);
    expect(parsed.driverId).toBe(id);
  });

  it("rejects a non-uuid vehicle id", () => {
    expect(entriesSchema.safeParse({ vehicleId: "754" }).success).toBe(false);
  });
});
