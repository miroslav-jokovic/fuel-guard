import type { Finding, LoadInput, TraceNode } from "./types.js";

/**
 * checkEligibility (M5.2 — closes G1/G3/G4) + the provided-input audit (M5.3 — closes G5's
 * "accepted and silently ignored").
 *
 * THE RULE, fail-closed and simple: a load is `eligible` only when
 *   1. every check that ran found no violation and no conditional, AND
 *   2. every input the caller PROVIDED was actually EVALUATED, AND
 *   3. the dataset was complete enough to check everything (segregation grid present — G8).
 *
 * (2) is the honest treatment of the 13 dead LoadInput fields: the engine keeps accepting them
 * (deleting them would break callers and lose declared data the audit trail wants), but a provided
 * value the current rules do not evaluate yields an explicit `not_evaluated:<path>` finding at tier
 * `conditional` — visible, blocking auto-clear, never silent. When a later phase implements the
 * field's semantics (residue → H2/H9, compartments/capacity → H2, business-day IDs → H2, IMDG port
 * rules, policy → this milestone's app-side lock but engine semantics later), its entry is removed
 * from UNEVALUATED_INPUTS and the finding disappears — the list IS the coverage statement.
 */

type Probe = { path: string; provided: (l: LoadInput) => boolean; note: string };

/** Inputs the engine ACCEPTS but does not yet EVALUATE (G5). Line-level probes report per-line. */
export const UNEVALUATED_INPUTS: readonly Probe[] = [
  { path: "policy", provided: (l) => l.policy != null, note: "org policy semantics (engine-side) land after H8 locks behavior" },
  { path: "vehicle.cargoTankCapacityGal", provided: (l) => l.vehicle.cargoTankCapacityGal != null, note: "capacity rules pending (H2)" },
  { path: "vehicle.compartments", provided: (l) => l.vehicle.compartments != null, note: "compartment rules pending (H2)" },
  { path: "tankState=residue_uncleaned", provided: (l) => l.tankState === "residue_uncleaned", note: "residue placard/paper semantics pending (H2/H9)" },
  { path: "claimedExceptions.shipperClaimsNoPlacards", provided: (l) => l.claimedExceptions.shipperClaimsNoPlacards, note: "claimed exception is recorded, not verified by the engine" },
  { path: "claimedExceptions.claimedSpecialPermits", provided: (l) => l.claimedExceptions.claimedSpecialPermits.length > 0, note: "special permits are reviewed by a human (H7) — never engine-evaluated" },
  { path: "portContext.vesselConnected", provided: (l) => l.portContext.vesselConnected != null, note: "IMDG/§176 port rules not implemented" },
  { path: "portContext.imdgPapers", provided: (l) => l.portContext.imdgPapers != null, note: "IMDG paper rules not implemented" },
  { path: "tripContext.previousOrCurrentBusinessDayIds", provided: (l) => l.tripContext.previousOrCurrentBusinessDayIds != null, note: "business-day ID retention rules pending (H2)" },
];
// Deliberately NOT audited: tripContext.carrierRelationship. It allocates the §172.506 placard-
// SUPPLY duty between shipper and carrier — it does not change WHICH placards this load requires,
// so an unevaluated value cannot make this verdict wrong. Auditing it would make `eligible`
// unreachable for every real app load (the app always sends it), recreating G3. Recorded in PLAN.

// packageCount left this list in 0.9.0 (H-P1): it is now read by computePlacards (recorded in the
// weight-threshold and ID-display evidence, and cross-checked against the packaging kind). Real BOLs
// always state a package count (§172.202(a)(7)), so keeping it "unevaluated" meant every accurately
// described load blocked auto-clear — the tool punished precision.
const LINE_PROBES: ReadonlyArray<{ key: "flashPointF" | "ethanolPct" | "compartmentIndex"; note: string } | { key: "isResidueLine"; note: string }> = [
  { key: "flashPointF", note: "flash-point reclass verification pending (H2)" },
  { key: "ethanolPct", note: "ethanol-blend rules pending (H2)" },
  { key: "compartmentIndex", note: "compartment rules pending (H2)" },
  { key: "isResidueLine", note: "residue-line semantics pending (H2/H9)" },
];

export interface InputAudit {
  findings: Finding[];
  trace: TraceNode;
}

/** M5.3: every provided-but-unevaluated input becomes an explicit conditional finding. */
export function auditProvidedInputs(load: LoadInput): InputAudit {
  const paths: string[] = [];
  const findings: Finding[] = [];
  for (const probe of UNEVALUATED_INPUTS) {
    if (probe.provided(load)) {
      paths.push(probe.path);
      findings.push({
        ruleId: `not_evaluated:${probe.path}`,
        tier: "conditional",
        message: `Input '${probe.path}' was provided but is not evaluated by engine rules yet (${probe.note}). It is recorded, and it blocks auto-clear until its rules land.`,
        citations: [],
        evidence: {},
      });
    }
  }
  load.lines.forEach((line, i) => {
    for (const probe of LINE_PROBES) {
      const v = line[probe.key];
      const provided = probe.key === "isResidueLine" ? v === true : v != null;
      if (provided) {
        const path = `lines[${i}].${probe.key}`;
        paths.push(path);
        findings.push({
          ruleId: `not_evaluated:${path}`,
          tier: "conditional",
          message: `Input '${path}' was provided but is not evaluated by engine rules yet (${probe.note}).`,
          citations: [],
          evidence: {},
        });
      }
    }
  });
  return {
    findings,
    trace: { ruleId: "input_audit", fired: paths.length > 0, inputs: { unevaluatedProvided: paths }, citations: [] },
  };
}

export interface EligibilityInput {
  datasetProvisional: boolean;
  /** All findings folded into the verdict (placards + bol + input audit). */
  blocks: Finding[];
  segregationFindings: Finding[];
  segregationViolation: boolean;
  /** G8: an absent segregation grid means the check could not run — never silently eligible. */
  segregationGridPresent: boolean;
}

export interface EligibilityResult {
  status: "eligible" | "blocked" | "not_checked";
  reasons: string[];
}

/** G1's missing function. Blocked > not_checked > eligible, in that order of precedence. */
export function checkEligibility(input: EligibilityInput): EligibilityResult {
  const reasons: string[] = [];
  const anyViolation =
    input.blocks.some((f) => f.tier === "violation") || input.segregationViolation;
  if (anyViolation) return { status: "blocked", reasons: ["violation finding present"] };

  if (input.datasetProvisional) reasons.push("dataset is provisional");
  if (!input.segregationGridPresent) reasons.push("segregation grid unavailable (G8) — compatibility could not be checked");
  const conditionals = [...input.blocks, ...input.segregationFindings].filter((f) => f.tier === "conditional");
  if (conditionals.length > 0) reasons.push(`${conditionals.length} conditional finding(s) unresolved`);

  return reasons.length > 0 ? { status: "not_checked", reasons } : { status: "eligible", reasons: [] };
}
