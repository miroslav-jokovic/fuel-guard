import {
  ENGINE_VERSION,
  emptyPlacards,
  loadInputSchema,
  type Finding,
  type LoadInput,
  type PlacardName,
  type TraceNode,
  type Verdict,
} from "./types.js";
import { cleanedTankProhibitsGate, noHazmatLinesGate } from "./placards/rules.js";
import { computePlacards } from "./placards/compute.js";
import { checkSegregation } from "./segregation/check.js";

export * from "./types.js";
export { computePlacards } from "./placards/compute.js";
export { checkSegregation } from "./segregation/check.js";
export { validateBol, type BolValidation, type BolLineCompliance } from "./bol/validate.js";

const ALL_PLACARDS: readonly PlacardName[] = [
  "FLAMMABLE", "GASOLINE", "COMBUSTIBLE", "FUEL_OIL", "FLAMMABLE_GAS", "NON_FLAMMABLE_GAS",
  "OXYGEN", "POISON_GAS", "FLAMMABLE_SOLID", "SPONTANEOUSLY_COMBUSTIBLE", "DANGEROUS_WHEN_WET",
  "OXIDIZER", "ORGANIC_PEROXIDE", "POISON", "POISON_INHALATION_HAZARD", "CORROSIVE",
  "RADIOACTIVE", "CLASS_9", "DANGEROUS",
];

/**
 * evaluateLoad — the deterministic entry point (Phase H2).
 *
 * Definitive early exits first (dataset-independent): the no-hazmat exit and the cleaned-and-purged
 * prohibition (§172.502(a)/§172.303). Otherwise it runs `computePlacards` — the §172.504 ladder over
 * the dataset the caller passed in. The engine has no clearing concept (D3/H4): it returns the placard
 * set + a trace + any conditional/violation findings, and the app decides clearing. A provisional
 * dataset or any conditional finding leaves eligibility `not_checked` so nothing is auto-cleared.
 */
export function evaluateLoad(input: LoadInput): Verdict {
  const load = loadInputSchema.parse(input);
  const trace: TraceNode[] = [];
  const version = load.dataset.version;

  const noHm = noHazmatLinesGate(load);
  trace.push(noHm.trace);
  if (noHm.finding) {
    return { engineVersion: ENGINE_VERSION, datasetVersion: version, placards: emptyPlacards(), eligibility: { status: "eligible", blocks: [] }, segregation: [], trace };
  }

  const cleaned = cleanedTankProhibitsGate(load);
  trace.push(cleaned.trace);
  if (cleaned.finding) {
    const placards = emptyPlacards();
    for (const p of ALL_PLACARDS) placards.prohibited.push({ placard: p, because: cleaned.finding.citations });
    return { engineVersion: ENGINE_VERSION, datasetVersion: version, placards, eligibility: { status: "eligible", blocks: [] }, segregation: [], trace };
  }

  const computed = computePlacards(load);
  trace.push(...computed.trace);
  const seg = checkSegregation(load);
  trace.push(...seg.trace);

  const blocks: Finding[] = computed.findings.filter((f) => f.tier === "conditional" || f.tier === "violation");
  // A §177.848(d) segregation prohibition (X) blocks the load; placard/eligibility conditionals leave it
  // `not_checked`. Eligibility (product/policy) is a separate H2 deliverable — until it lands the engine
  // surfaces the conditionals so the app never auto-clears on assumptions.
  const anyViolation = blocks.some((f) => f.tier === "violation") || seg.hasViolation;
  const status: Verdict["eligibility"]["status"] = anyViolation ? "blocked" : "not_checked";

  return {
    engineVersion: ENGINE_VERSION,
    datasetVersion: version,
    placards: computed.placards,
    eligibility: { status, blocks },
    segregation: seg.findings,
    trace,
  };
}
