import { describe, expect, it } from "vitest";
import { evaluateLoad } from "../index.js";
import type { LoadInput, PlacardName } from "../types.js";

/**
 * 0.17.0 — which placard each identification number rides on (§172.332(c), §172.334(d)).
 *
 * The case that found it is the owner's 2026-10-19 Mayo Products BOL 14182: 8 × 3,600 lb totes of
 * UN1824 Sodium hydroxide solution and 2 × 3,250 lb totes of UN1830 Sulfuric acid, both Class 8 PG II,
 * plus three totes of non-regulated flocculant, on a dry van. Both lines are bulk (an IBC over 119 gal),
 * so §172.331(c) puts BOTH numbers on each side and each end. The verdict showed one CORROSIVE diamond
 * reading 1824 and no 1830 anywhere.
 *
 * The last block is the whole-space check (D-RC1): every load of one to three lines over five
 * materials × two packagings × two weights, held to the three invariants the CFR states.
 */
const DATASET = {
  version: "test-idc", provisional: false,
  entries: [
    { entryId: "UN1824-naoh", psnPrinted: "Sodium hydroxide solution", hazardClass: "8", idPrefix: "UN", idNumber: "1824", pgRows: [{ pg: "II", exceptionsRef: "154" }] },
    { entryId: "UN1830-h2so4", psnPrinted: "Sulfuric acid", hazardClass: "8", idPrefix: "UN", idNumber: "1830", pgRows: [{ pg: "II", exceptionsRef: "154" }] },
    { entryId: "UN3264-cor", psnPrinted: "Corrosive liquid, acidic, inorganic, n.o.s.", hazardClass: "8", idPrefix: "UN", idNumber: "3264", pgRows: [{ pg: "II", exceptionsRef: "154" }] },
    { entryId: "UN1203-gas", psnPrinted: "Gasoline", hazardClass: "3", idPrefix: "UN", idNumber: "1203", pgRows: [{ pg: "II", exceptionsRef: "150" }] },
    { entryId: "UN1993-fl", psnPrinted: "Flammable liquids, n.o.s.", hazardClass: "3", idPrefix: "UN", idNumber: "1993", pgRows: [{ pg: "II", exceptionsRef: "150" }] },
  ],
  placards: [
    { classOrDivision: "8", table: 2, placardName: "CORROSIVE", designRef: "172.558", wordingOptions: [] },
    { classOrDivision: "3", table: 2, placardName: "FLAMMABLE", designRef: "172.542", wordingOptions: [] },
  ],
  erg: [
    { idNumber: "1824", guideNumber: "154" }, { idNumber: "1830", guideNumber: "137" }, { idNumber: "3264", guideNumber: "154" },
    { idNumber: "1203", guideNumber: "128" }, { idNumber: "1993", guideNumber: "128" },
  ],
};
const PLACARD_OF: Record<string, PlacardName> = {
  "UN1824-naoh": "CORROSIVE", "UN1830-h2so4": "CORROSIVE", "UN3264-cor": "CORROSIVE",
  "UN1203-gas": "FLAMMABLE", "UN1993-fl": "FLAMMABLE",
};
const ID_OF = (entryId: string) => `UN${entryId.slice(2, 6)}`;

const line = (entryId: string, over: Record<string, unknown> = {}): LoadInput["lines"][number] =>
  ({
    hmtRef: `${entryId}#II`, reclassedCombustible: false, isLimitedQuantity: false,
    quantity: { value: null, unit: "gal" }, grossWeightLb: 3000, compartmentIndex: null,
    isResidueLine: false, flashPointF: null, ethanolPct: null,
    packagingKind: "bulk", packageCount: 1, ...over,
  }) as unknown as LoadInput["lines"][number];

const load = (lines: LoadInput["lines"], over: Partial<LoadInput> = {}): LoadInput =>
  ({
    evaluatedAt: "2026-10-19T00:00:00Z",
    vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
    tankState: "loaded", lines,
    claimedExceptions: { shipperClaimsNoPlacards: false, claimedSpecialPermits: [] },
    portContext: { vesselConnected: null, imdgPapers: null },
    tripContext: { previousOrCurrentBusinessDayIds: null, carrierRelationship: "unknown" },
    policy: null, dataset: DATASET, otherFreightAboard: null, ...over,
  }) as unknown as LoadInput;

/** The diamonds a driver hangs on one side: a placard per number it carries, else one plain placard. */
const diamonds = (v: ReturnType<typeof evaluateLoad>) =>
  v.placards.required.flatMap((p) => {
    const ids = v.placards.idDisplays.filter((d) => d.format === "on_placard" && d.onPlacards.includes(p.placard));
    return ids.length ? ids.map((d) => `${p.placard}·${d.idNumber}`) : [p.placard];
  });

describe("identification numbers — one carrier per number", () => {
  it("Mayo Products BOL 14182: two CORROSIVE placards on each side, one reading 1824, one reading 1830", () => {
    const v = evaluateLoad(load([
      line("UN1824-naoh", { grossWeightLb: 29800, packageCount: 8 }),
      line("UN1830-h2so4", { grossWeightLb: 6750, packageCount: 2 }),
    ], { otherFreightAboard: true }));
    expect(v.placards.required.map((p) => p.placard)).toEqual(["CORROSIVE"]);
    expect(v.placards.idDisplays.map((d) => [d.idNumber, d.format, d.onPlacards])).toEqual([
      ["UN1824", "on_placard", ["CORROSIVE"]],
      ["UN1830", "on_placard", ["CORROSIVE"]],
    ]);
    expect(diamonds(v)).toEqual(["CORROSIVE·UN1824", "CORROSIVE·UN1830"]);
  });

  it("a gasoline tote never puts 1203 on the CORROSIVE placard (§172.332(c))", () => {
    const v = evaluateLoad(load([
      line("UN1203-gas"),
      line("UN3264-cor", { packagingKind: "non_bulk", packageCount: 10, grossWeightLb: 5000 }),
    ]));
    const gas = v.placards.idDisplays.find((d) => d.idNumber === "UN1203")!;
    expect(gas.onPlacards).toEqual(["FLAMMABLE"]);
    expect(diamonds(v)).toEqual(["FLAMMABLE·UN1203", "CORROSIVE"]);
  });

  it("a UN1760-style tote beside UN3264 drums of the same class goes on a panel, not across the placard (§172.334(d))", () => {
    const v = evaluateLoad(load([
      line("UN1830-h2so4", { grossWeightLb: 350 }),
      line("UN3264-cor", { packagingKind: "non_bulk", packageCount: 6, grossWeightLb: 3600 }),
    ]));
    const id = v.placards.idDisplays.find((d) => d.idNumber === "UN1830")!;
    expect(id.format).toBe("orange_panel");
    expect(id.onPlacards).toEqual([]);
    expect(diamonds(v)).toEqual(["CORROSIVE"]);
    const f = (v.notices ?? []).find((x) => x.ruleId === "id_number_not_on_placard_class_not_covered");
    expect(f?.evidence).toMatchObject({ idNumber: "UN1830", placard: "CORROSIVE", uncovered: ["UN3264"] });
  });
});

describe("identification numbers — every load of up to three lines", () => {
  const options = Object.keys(PLACARD_OF).flatMap((id) =>
    (["bulk", "non_bulk"] as const).flatMap((kind) => [500, 9000].map((lb) => ({ id, kind, lb }))),
  );
  const loads: Array<typeof options> = [];
  for (const a of options) {
    loads.push([a]);
    for (const b of options) {
      loads.push([a, b]);
      for (const c of options) loads.push([a, b, c]);
    }
  }

  it("holds the three CFR invariants on all of them", () => {
    let checkedWithIds = 0;
    for (const ls of loads) {
      const v = evaluateLoad(load(ls.map((o) => line(o.id, { packagingKind: o.kind, grossWeightLb: o.lb, packageCount: o.kind === "bulk" ? 1 : 20 }))));
      if (v.placards.idDisplays.length) checkedWithIds += 1;
      const required = new Set(v.placards.required.map((p) => p.placard));
      const aboard = new Map<PlacardName, Set<string>>();
      for (const o of ls) aboard.set(PLACARD_OF[o.id]!, (aboard.get(PLACARD_OF[o.id]!) ?? new Set()).add(ID_OF(o.id)));
      const placardOfId = new Map(ls.map((o) => [ID_OF(o.id), PLACARD_OF[o.id]!]));
      const ctx = JSON.stringify(ls);

      // 1 · §172.332(c): a number rides only on its own primary-class placard, and only a required one.
      for (const d of v.placards.idDisplays) {
        for (const p of d.onPlacards) {
          expect(p, ctx).toBe(placardOfId.get(d.idNumber));
          expect(required.has(p), ctx).toBe(true);
        }
      }
      // 2 · §172.334(d): a placard that carries any number carries every number of its class aboard.
      for (const p of required) {
        const carried = new Set(v.placards.idDisplays.filter((d) => d.format === "on_placard" && d.onPlacards.includes(p)).map((d) => d.idNumber));
        if (carried.size) expect([...aboard.get(p)!].sort(), ctx).toEqual([...carried].sort());
      }
      // 3 · nothing vanishes: every required number appears on a diamond or as its own panel.
      const shown = new Set(diamonds(v).flatMap((x) => x.split("·").slice(1)));
      for (const d of v.placards.idDisplays) {
        expect(shown.has(d.idNumber) || d.format !== "on_placard", ctx).toBe(true);
      }
      // and every bulk line's number is required (§172.331(c)) — the Mayo load's missing half.
      for (const o of ls.filter((x) => x.kind === "bulk")) {
        expect(v.placards.idDisplays.map((d) => d.idNumber), ctx).toContain(ID_OF(o.id));
      }
    }
    expect(loads.length).toBe(20 + 400 + 8000);
    expect(checkedWithIds).toBeGreaterThan(5000);
    // 8,420 full evaluations: ≈0.4 s on a laptop, 5.7 s on a loaded CI runner (PR #1641's first run).
  }, 60_000);
});
