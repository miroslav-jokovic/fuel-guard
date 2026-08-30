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
import { validateBol } from "./bol/validate.js";
import { auditProvidedInputs, checkEligibility } from "./eligibility.js";

export * from "./types.js";
export { computePlacards } from "./placards/compute.js";
export { checkSegregation } from "./segregation/check.js";
export { validateBol, type BolValidation, type BolLineCompliance } from "./bol/validate.js";
export { checkEligibility, auditProvidedInputs, UNEVALUATED_INPUTS, type EligibilityInput, type EligibilityResult } from "./eligibility.js";

const ALL_PLACARDS: readonly PlacardName[] = [
  "FLAMMABLE", "GASOLINE", "COMBUSTIBLE", "FUEL_OIL", "FLAMMABLE_GAS", "NON_FLAMMABLE_GAS",
  "OXYGEN", "POISON_GAS", "FLAMMABLE_SOLID", "SPONTANEOUSLY_COMBUSTIBLE", "DANGEROUS_WHEN_WET",
  "OXIDIZER", "ORGANIC_PEROXIDE", "POISON", "POISON_INHALATION_HAZARD", "CORROSIVE",
  "RADIOACTIVE", "CLASS_9", "DANGEROUS",
  // The six explosives names were missing, so a cleaned-and-purged tank was never told it may not
  // display them (§172.502(a)). Blocking explosives in computePlacards does not cover this: the
  // cleaned-tank prohibition is a dataset-independent gate that runs BEFORE the ladder.
  "EXPLOSIVES_1_1", "EXPLOSIVES_1_2", "EXPLOSIVES_1_3", "EXPLOSIVES_1_4", "EXPLOSIVES_1_5", "EXPLOSIVES_1_6",
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

  // Both early gates COMPUTE a finding and used to drop it, so the engine could decide "nothing is
  // required here" and had no way to say why. It rides out in `notices` now (0.13.0).
  const noHm = noHazmatLinesGate(load);
  trace.push(noHm.trace);
  if (noHm.finding) {
    return { engineVersion: ENGINE_VERSION, datasetVersion: version, placards: emptyPlacards(), eligibility: { status: "eligible", blocks: [] }, notices: [noHm.finding], segregation: [], trace };
  }

  const cleaned = cleanedTankProhibitsGate(load);
  trace.push(cleaned.trace);
  if (cleaned.finding) {
    const placards = emptyPlacards();
    for (const p of ALL_PLACARDS) placards.prohibited.push({ placard: p, because: cleaned.finding.citations });
    return { engineVersion: ENGINE_VERSION, datasetVersion: version, placards, eligibility: { status: "eligible", blocks: [] }, notices: [cleaned.finding], segregation: [], trace };
  }

  const computed = computePlacards(load);
  trace.push(...computed.trace);
  const seg = checkSegregation(load);
  trace.push(...seg.trace);

  // G2 (M5.2): the shipping paper IS part of the verdict — a load whose required paper entries
  // cannot be derived is not silently eligible.
  const bol = validateBol(load);
  trace.push(...bol.trace);

  // M5.3 (G5): every provided-but-unevaluated input becomes an explicit conditional finding.
  const audit = auditProvidedInputs(load);
  trace.push(audit.trace);

  const blocking = (f: Finding): boolean => f.tier === "conditional" || f.tier === "violation";
  const blocks: Finding[] = [
    ...computed.findings.filter(blocking),
    ...bol.findings.filter(blocking),
    ...audit.findings,
  ];
  // The other half of the same split. Segregation is deliberately absent — `verdict.segregation`
  // already carries every one of its findings, blocking or not, and duplicating them here would put
  // the same sentence on screen twice.
  const notices: Finding[] = [...computed.findings, ...bol.findings].filter((f) => !blocking(f));

  // M5.2 (G1/G3/G4): the eligibility DECISION. `eligible` is reachable now — but ONLY when every
  // check ran clean, the dataset was complete enough to check everything (G8), and no provided
  // input went unevaluated. Blocked > not_checked > eligible.
  const elig = checkEligibility({
    datasetProvisional: Boolean((load.dataset as { provisional?: boolean }).provisional),
    blocks,
    segregationFindings: seg.findings,
    segregationViolation: seg.hasViolation,
    segregationGridPresent: seg.gridPresent,
  });
  trace.push({ ruleId: "eligibility_decision", fired: true, inputs: { status: elig.status, reasons: elig.reasons }, citations: [] });

  return {
    engineVersion: ENGINE_VERSION,
    datasetVersion: version,
    placards: computed.placards,
    eligibility: { status: elig.status, blocks },
    notices,
    segregation: seg.findings,
    bol: { lines: bol.lines },
    trace,
  };
}
