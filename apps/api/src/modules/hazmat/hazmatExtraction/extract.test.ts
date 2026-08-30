import { describe, expect, it, vi } from "vitest";
import { buildDatasetIndex, loadDataset } from "@hazmat/data";
import { evaluateLoad, emptyPlacards, type LoadInput, type Verdict } from "@hazmat/engine";
import { parseBolFields, type BolFields } from "./bolFields.js";
import { runExtraction, type ExtractResult } from "./extract.js";
import { computeExtractionFlags, isGreen } from "./outcome.js";
import { PROMPT_A, type VisionExtractor } from "./vision.js";

const index = buildDatasetIndex(loadDataset());
const gasBol = (over: Partial<BolFields> = {}) =>
  parseBolFields({ lines: [{ idText: "UN1203", psn: "Gasoline", hazardClass: "3", pg: "II", quantity: { value: 8000, unit: "gal" }, packaging: "1 cargo tank" }], emergencyPhone: "800-424-9300", shipperCertification: true, ...over });

/** Fake vision model — returns a BolFields chosen by the (A vs B) prompt, so tests control agreement. */
const extractorOf = (byPrompt: (system: string) => BolFields): VisionExtractor => ({
  async extract(_images, spec) {
    return { fields: byPrompt(spec.system), usage: { input: 10, output: 5 }, model: spec.model };
  },
});
const alwaysUsable = { runUsability: async () => ({ usable: true, reasons: [] }) };
const baseInput = {
  images: [{ base64: "x", mediaType: "image/webp" as const }],
  gateBuffers: [Buffer.from("x")],
  index,
  models: { A: "model-a", B: "model-b" },
  vehicleKind: "cargo_tank" as const,
};

describe("runExtraction — pipeline control flow (fake model)", () => {
  it("usable + agreeing passes + a matching declared line → resolves the engine line, sums usage", async () => {
    const r = await runExtraction(
      { ...baseInput, declaredLines: [{ hmtRef: "UN1203-gasoline#II" }] },
      { extractor: extractorOf(() => gasBol()), ...alwaysUsable },
    );
    expect(r.usable).toBe(true);
    expect(r.engineLines[0]?.hmtRef).toBe("UN1203-gasoline#II");
    expect(r.usage).toEqual({ input: 20, output: 10 }); // two passes
    expect(r.flags.filter((f) => f.startsWith("pass_disagreement"))).toEqual([]);
    expect(r.flags).not.toContain("lines_unconfirmed");
  });

  it("a bad page is rejected BEFORE any model call (usability gate)", async () => {
    const extract = vi.fn();
    const r = await runExtraction(baseInput, {
      extractor: { extract },
      runUsability: async () => ({ usable: false, reasons: ["too_blurry"] }),
    });
    expect(r.usable).toBe(false);
    expect(r.flags).toEqual(["recapture_needed"]);
    expect(r.usabilityReasons).toContain("too_blurry");
    expect(extract).not.toHaveBeenCalled(); // fail-closed: no model spend on an unusable page
  });

  it("dual-pass disagreement on the id is flagged", async () => {
    const r = await runExtraction(baseInput, {
      extractor: extractorOf((system) =>
        system === PROMPT_A
          ? gasBol()
          : parseBolFields({ lines: [{ idText: "UN1993", psn: "Gasoline", pg: "II", quantity: { value: 8000, unit: "gal" } }], emergencyPhone: "800-424-9300", shipperCertification: true }),
      ),
      ...alwaysUsable,
    });
    expect(r.flags).toContain("pass_disagreement:idNumber:line1");
  });

  it("driver self-created (no declared lines) can never auto-clear → lines_unconfirmed", async () => {
    const r = await runExtraction(baseInput, { extractor: extractorOf(() => gasBol()), ...alwaysUsable });
    expect(r.flags).toContain("lines_unconfirmed");
  });
});

describe("computeExtractionFlags — the outcome table (step 6)", () => {
  it("flags-present pipeline result stays flagged regardless of verdict", () => {
    const extract = { usable: false, usabilityReasons: ["too_blurry"], engineLines: [], flags: ["recapture_needed"], usage: { input: 0, output: 0 }, models: { A: "a", B: "b" } } as ExtractResult;
    expect(isGreen(computeExtractionFlags(extract, null, false))).toBe(false);
  });

  it("a truly-clean run (empty pipeline flags + eligible verdict, non-provisional) is GREEN", () => {
    const extract = { usable: true, usabilityReasons: [], engineLines: [], flags: [], usage: { input: 1, output: 1 }, models: { A: "a", B: "b" } } as ExtractResult;
    const verdict: Verdict = { engineVersion: "0.7.0", datasetVersion: "2026.07.1", placards: emptyPlacards(), eligibility: { status: "eligible", blocks: [] }, segregation: [], trace: [] };
    expect(isGreen(computeExtractionFlags(extract, verdict, false))).toBe(true);
    // a provisional dataset blocks the clear even when everything else is clean
    expect(computeExtractionFlags(extract, verdict, true)).toContain("provisional_dataset");
  });

  it("real engine: extracted gasoline on a non-bulk vehicle → FLAMMABLE, but never auto-clears (eligibility not_checked, D2)", () => {
    const load: LoadInput = {
      evaluatedAt: "2026-07-31T00:00:00Z",
      vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
      tankState: "loaded",
      lines: [{ hmtRef: "UN1203-gasoline#II", reclassedCombustible: false, isLimitedQuantity: false, quantity: { value: 8000, unit: "gal" }, grossWeightLb: null, compartmentIndex: null, isResidueLine: false, flashPointF: null, ethanolPct: null, packagingKind: "non_bulk", packageCount: null, marinePollutantConcentrationPct: null }],
      otherFreightAboard: null,
      claimedExceptions: { shipperClaimsNoPlacards: false, claimedSpecialPermits: [] },
      portContext: { vesselConnected: null, imdgPapers: null },
      tripContext: { previousOrCurrentBusinessDayIds: null, carrierRelationship: "unknown" },
      policy: null,
      dataset: loadDataset() as unknown as LoadInput["dataset"],
    };
    const verdict = evaluateLoad(load);
    expect(verdict.placards.required.map((p) => p.placard)).toContain("FLAMMABLE");
    const extract = { usable: true, usabilityReasons: [], engineLines: load.lines, flags: [], usage: { input: 1, output: 1 }, models: { A: "a", B: "b" } } as ExtractResult;
    expect(computeExtractionFlags(extract, verdict, false)).toContain("eligibility_not_checked");
  });
});

describe("runExtraction — H-LQ dual-pass confirmation (2026-08-08)", () => {
  const lqBol = (marks: string[]) =>
    parseBolFields({
      lines: [{ idText: "UN1203", psn: "Gasoline", hazardClass: "3", pg: "II", quantity: { value: 220, unit: "gal" }, grossWeightLb: 2000, packageCount: 40, packaging: "40 cases", marks }],
      emergencyPhone: "800-424-9300", shipperCertification: true,
    });

  it("BOTH passes reading the notation → the engine line carries isLimitedQuantity=true", async () => {
    const r = await runExtraction(
      { ...baseInput, vehicleKind: "van_or_flatbed", declaredLines: [{ hmtRef: "UN1203-gasoline#II", isLimitedQuantity: true, quantityValue: 220 }] },
      { extractor: extractorOf((system) => (system === PROMPT_A ? lqBol(["LIMITED QUANTITY"]) : lqBol(["Ltd Qty"]))), ...alwaysUsable },
    );
    expect(r.engineLines[0]?.isLimitedQuantity).toBe(true);
    expect(r.flags.filter((f) => f.includes("lqNotation") || f.startsWith("lq_"))).toEqual([]);
  });

  it("ONE pass only → flag + engine line maps FALSE (fully regulated — never under-placarded on a single read)", async () => {
    const r = await runExtraction(
      { ...baseInput, vehicleKind: "van_or_flatbed", declaredLines: [{ hmtRef: "UN1203-gasoline#II", isLimitedQuantity: false, quantityValue: 220 }] },
      { extractor: extractorOf((system) => (system === PROMPT_A ? lqBol(["LIMITED QUANTITY"]) : lqBol([]))), ...alwaysUsable },
    );
    expect(r.flags).toContain("pass_disagreement:lqNotation:line1");
    expect(r.engineLines[0]?.isLimitedQuantity).toBe(false);
  });

  it("confirmed paper notation the dispatcher never declared → lq_mismatch reconciliation flag", async () => {
    const r = await runExtraction(
      { ...baseInput, vehicleKind: "van_or_flatbed", declaredLines: [{ hmtRef: "UN1203-gasoline#II", isLimitedQuantity: false, quantityValue: 220 }] },
      { extractor: extractorOf(() => lqBol(["LIMITED QUANTITY"])), ...alwaysUsable },
    );
    expect(r.engineLines[0]?.isLimitedQuantity).toBe(true); // the paper IS the §172.203(b) identification…
    expect(r.flags).toContain("lq_mismatch:UN1203-gasoline#II"); // …but the disagreement with dispatch routes to review
  });
});
