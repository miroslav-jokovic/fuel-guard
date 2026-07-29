import type { Citation, Finding, LoadInput, TraceNode } from "../types.js";

/**
 * Placard rules (plan H2), mirroring the anomalyRules/ pattern: pure functions, one per rule, each
 * returning its finding (or null) plus a trace node (fired-or-not, with inputs + citations) for the
 * explainability record. This increment implements ONLY the dataset-INDEPENDENT, definitive gates;
 * steps 2–12 (class resolution, Table 1/2, the 1,001-lb aggregate, §172.504(f), DANGEROUS, ID display,
 * marine pollutant, IMDG) are blocked on H1's certified dataset and the SME's R1–R3 answers.
 */
export interface RuleOutcome {
  finding: Finding | null;
  trace: TraceNode;
}

/**
 * Dataset-provisional / engine-incomplete gate (H1.6 / D2). Until the dataset is a certified two-source
 * release AND the substantive ladder is implemented, the engine will not assert a placard set — it
 * fail-closes with a conditional finding and asserts NO required placards (never under-placard, never
 * fabricate). The app refuses to CLEAR on a conditional/violation finding.
 */
export function determinationWithheldGate(load: LoadInput): RuleOutcome {
  const provisional = load.dataset.provisional === true;
  const citations: Citation[] = [{ cfr: "internal: determination withheld (plan H1.6 / D2)" }];
  return {
    finding: {
      ruleId: "placard_determination_withheld",
      tier: "conditional",
      message: provisional
        ? "The regulatory dataset is provisional (not yet two-source-verified) and the placard ladder is not yet certified — placard determination is withheld. Route to a hazmat-trained reviewer."
        : "The substantive placard ladder is not yet implemented for this material — placard determination is withheld. Route to a hazmat-trained reviewer.",
      citations,
      evidence: { datasetVersion: load.dataset.version, provisional },
    },
    trace: { ruleId: "placard_determination_withheld", fired: true, inputs: { provisional }, citations },
  };
}

/** No lines → no hazmat load → no placards (SME flow gate 1; dataset-independent, definitive). */
export function noHazmatLinesGate(load: LoadInput): RuleOutcome {
  const fired = load.lines.length === 0;
  return {
    finding: fired
      ? {
          ruleId: "no_hazmat_load",
          tier: "info",
          message: "No hazardous-material lines on this load — no placards required.",
          citations: [],
          evidence: { lineCount: 0 },
        }
      : null,
    trace: { ruleId: "no_hazmat_load", fired, inputs: { lineCount: load.lines.length }, citations: [] },
  };
}

/**
 * A cleaned-and-purged cargo tank must display NO placards (§172.502(a)) and NO ID numbers (§172.303) —
 * two different authorities. Dataset-independent and definitive.
 */
export function cleanedTankProhibitsGate(load: LoadInput): RuleOutcome {
  const fired = load.vehicle.kind === "cargo_tank" && load.tankState === "cleaned_and_purged";
  const citations: Citation[] = [{ cfr: "49 CFR 172.502(a)" }, { cfr: "49 CFR 172.303" }];
  return {
    finding: fired
      ? {
          ruleId: "cleaned_tank_no_placards",
          tier: "info",
          message: "Cargo tank is cleaned and purged — placards and ID numbers must NOT be displayed.",
          citations,
          evidence: { tankState: load.tankState },
        }
      : null,
    trace: { ruleId: "cleaned_tank_no_placards", fired, inputs: { kind: load.vehicle.kind, tankState: load.tankState }, citations },
  };
}
