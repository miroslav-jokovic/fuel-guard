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
import {
  cleanedTankProhibitsGate,
  determinationWithheldGate,
  noHazmatLinesGate,
} from "./placards/rules.js";

export * from "./types.js";

const ALL_PLACARDS: readonly PlacardName[] = [
  "FLAMMABLE", "GASOLINE", "COMBUSTIBLE", "FUEL_OIL", "FLAMMABLE_GAS", "NON_FLAMMABLE_GAS",
  "OXYGEN", "POISON_GAS", "FLAMMABLE_SOLID", "SPONTANEOUSLY_COMBUSTIBLE", "DANGEROUS_WHEN_WET",
  "OXIDIZER", "ORGANIC_PEROXIDE", "POISON", "POISON_INHALATION_HAZARD", "CORROSIVE",
  "RADIOACTIVE", "CLASS_9", "DANGEROUS",
];

/**
 * evaluateLoad — the deterministic entry point (Phase H2, in progress).
 *
 * IMPLEMENTED (dataset-independent, definitive): the no-hazmat exit, the cleaned-and-purged prohibition
 * (§172.502(a)/§172.303), and a fail-closed "determination withheld" gate. The substantive ladder
 * (steps 2–12: class resolution, Table 1/2 gates, the 1,001-lb aggregate, §172.504(f), DANGEROUS,
 * ID display, marine pollutant, IMDG) is blocked on H1's certified dataset + the SME's R1–R3 answers.
 * No verdict CLEARS here — the engine is a pure function with no clearing concept (H4/H7 decide).
 */
export function evaluateLoad(input: LoadInput): Verdict {
  const load = loadInputSchema.parse(input);
  const trace: TraceNode[] = [];
  const placards = emptyPlacards();
  const blocks: Finding[] = [];

  const noHm = noHazmatLinesGate(load);
  trace.push(noHm.trace);
  if (noHm.finding) {
    // Definitive clean read: no hazmat, no placards. Nothing to review.
    return {
      engineVersion: ENGINE_VERSION,
      datasetVersion: load.dataset.version,
      placards,
      eligibility: { status: "eligible", blocks: [] },
      segregation: [],
      trace,
    };
  }

  const cleaned = cleanedTankProhibitsGate(load);
  trace.push(cleaned.trace);
  if (cleaned.finding) {
    for (const p of ALL_PLACARDS) placards.prohibited.push({ placard: p, because: cleaned.finding.citations });
    return {
      engineVersion: ENGINE_VERSION,
      datasetVersion: load.dataset.version,
      placards,
      eligibility: { status: "eligible", blocks: [] },
      segregation: [],
      trace,
    };
  }

  // There are lines and it is not a cleaned tank → placards may be required, but the substantive
  // determination needs the certified dataset. Fail closed: assert NO required placards + a conditional.
  const withheld = determinationWithheldGate(load);
  trace.push(withheld.trace);
  if (withheld.finding) blocks.push(withheld.finding);

  return {
    engineVersion: ENGINE_VERSION,
    datasetVersion: load.dataset.version,
    placards,
    eligibility: { status: "not_checked", blocks },
    segregation: [],
    trace,
  };
}
