import { describe, expect, it } from "vitest";
import { evaluateLoad } from "./index.js";
import type { LoadInput } from "./types.js";

/**
 * `Verdict.notices` (0.13.0) — the channel non-blocking findings never had.
 *
 * ⚠ Sixteen rules across the engine computed an `info` finding and `evaluateLoad` dropped every one
 * of them, so the reasoning behind a QUIET answer was thrown away: why no placard is required below
 * 1,001 lb, why a residue line left the aggregate, why a cleaned tank must not be placarded. Nothing
 * failed. The findings were correct, the tests passed, and the explanation simply never left the
 * function — which is the hardest kind of gap to notice, because the output looks complete.
 *
 * The two EARLY-EXIT gates are the sharpest case and are pinned first: they compute a finding, check
 * it for truthiness, and returned without it. A load that declares no hazardous materials got a
 * verdict that said nothing at all.
 */
const DATASET = {
  version: "test-notices",
  provisional: false,
  entries: [
    { entryId: "UN1203-gasoline", psnPrinted: "Gasoline", hazardClass: "3", idPrefix: "UN", idNumber: "1203", pgRows: [{ pg: "II" }] },
  ],
  placards: [{ classOrDivision: "3", table: 2, placardName: "FLAMMABLE", designRef: "172.542", wordingOptions: [] }],
  erg: [],
};

const line = (over: Record<string, unknown> = {}): LoadInput["lines"][number] =>
  ({
    hmtRef: "UN1203-gasoline#II", reclassedCombustible: false, isLimitedQuantity: false,
    quantity: { value: 100, unit: "gal" }, grossWeightLb: 800, compartmentIndex: null,
    isResidueLine: false, flashPointF: -45, ethanolPct: null, packagingKind: "non_bulk", packageCount: 4,
    ...over,
  }) as unknown as LoadInput["lines"][number];

const load = (over: Partial<LoadInput> = {}): LoadInput =>
  ({
    evaluatedAt: "2026-07-30T00:00:00Z",
    vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
    tankState: "loaded", lines: [line()],
    claimedExceptions: { shipperClaimsNoPlacards: false, claimedSpecialPermits: [] },
    portContext: { vesselConnected: false, imdgPapers: null },
    tripContext: { previousOrCurrentBusinessDayIds: null, carrierRelationship: "unknown" },
    policy: null, dataset: DATASET, ...over,
  }) as unknown as LoadInput;

const noticeIds = (v: ReturnType<typeof evaluateLoad>) => (v.notices ?? []).map((f) => f.ruleId);

describe("the early exits can finally say why they exited", () => {
  it("a load with no hazardous materials says so, instead of returning silence", () => {
    const v = evaluateLoad(load({ lines: [] }));
    expect(v.placards.required).toEqual([]);
    expect(noticeIds(v)).toContain("no_hazmat_load");
  });

  it("a cleaned and purged tank says WHY every placard is prohibited", () => {
    const v = evaluateLoad(load({
      vehicle: { kind: "cargo_tank", cargoTankCapacityGal: 9000, compartments: null } as never,
      tankState: "cleaned_and_purged",
    }));
    expect(v.placards.prohibited.length).toBeGreaterThan(0);
    const notice = (v.notices ?? [])[0];
    expect(notice).toBeDefined();
    expect(notice!.citations.length).toBeGreaterThan(0);
  });
});

describe("the reasoning behind a quiet answer survives the function", () => {
  it("explains why a sub-1,001 lb non-bulk load needs no placard", () => {
    const v = evaluateLoad(load());
    expect(v.placards.required).toEqual([]);
    expect(noticeIds(v)).toContain("below_1001lb_no_placard");
  });

  it("carries the shipping-paper requirements, which reached no caller by any route", () => {
    const ids = noticeIds(evaluateLoad(load()));
    expect(ids).toContain("bol_basic_description");
    // The paper-level §172.6xx requirements are not in `bol.lines` either — this is their only home.
    expect(ids.some((id) => id.startsWith("bol_") && id !== "bol_basic_description")).toBe(true);
  });
});

describe("notices and blocks are one split, not two lists", () => {
  it("never puts a blocking finding in notices", () => {
    const v = evaluateLoad(load({ lines: [line({ grossWeightLb: null })] }));
    expect(v.eligibility.blocks.map((f) => f.ruleId)).toContain("aggregate_weight_unknown");
    for (const f of v.notices ?? []) expect(["conditional", "violation"]).not.toContain(f.tier);
  });

  it("never puts a notice in blocks, so eligibility cannot be moved by an explanation", () => {
    const v = evaluateLoad(load());
    for (const f of v.eligibility.blocks) expect(["conditional", "violation"]).toContain(f.tier);
  });

  it("does not duplicate segregation, which already has its own array", () => {
    const v = evaluateLoad(load());
    const segIds = new Set(v.segregation.map((f) => f.ruleId));
    for (const id of noticeIds(v)) expect(segIds.has(id)).toBe(false);
  });
});
