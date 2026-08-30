import type { Finding, TraceNode } from "../types.js";

/**
 * The out-of-scope gates: materials this engine RECOGNISES and then refuses to assess (D4-revised).
 *
 * Both are the same posture, which is why they are one function rather than two blocks. A Table 1
 * material or an explosive blocks the WHOLE load — no placards computed, a `violation` finding, which
 * `evaluateLoad` turns into eligibility `blocked`. "We do not cover this, do not rely on the tool" is
 * the only allowed answer; silence, or a partial placard set, on a load the engine cannot fully
 * assess is forbidden, because a partial answer on a Table 1 load reads exactly like a complete one.
 *
 * Extracted from `compute.ts` when it crossed the 500-line budget (2026-08-30). It was the right seam
 * regardless: the two gates were near-identical prose blocks that differed only in the material class
 * and the reason, and neither has anything to do with the placard ladder they sat in the middle of.
 */
export interface ScopeHit {
  hmtRef: string;
  classOrDivision: string;
}

interface GateSpec {
  ruleId: string;
  /** Written as the sentence that follows "This load contains …". */
  message: (classes: string) => string;
  internalCitation: string;
  evidenceKey: string;
  traceNote: string;
}

const TABLE_1: GateSpec = {
  ruleId: "table1_out_of_scope_v1",
  message: (classes) =>
    `This load contains a 49 CFR 172.504 Table 1 material (${classes}), which is outside ` +
    `HazmatGuard's v1 scope. Placards cannot be computed and the load cannot be cleared — route it to a ` +
    `hazmat-trained reviewer; do not rely on the tool for this load.`,
  internalCitation: "internal: Table 1 out of scope (plan D4-revised / D2)",
  evidenceKey: "table1Classes",
  traceNote: "Table 1 recognized and blocked; no placards computed for the load.",
};

const EXPLOSIVES: GateSpec = {
  ruleId: "explosives_out_of_scope_v1",
  message: (classes) =>
    `This load contains an explosives material (${classes}). Explosives placarding depends on ` +
    `compatibility groups and exception rules HazmatGuard does not yet evaluate, so no placards are computed ` +
    `and the load cannot be cleared — route it to a hazmat-trained reviewer; do not rely on the tool for this load.`,
  internalCitation: "internal: explosives out of scope (plan D4-revised / D2)",
  evidenceKey: "explosivesClasses",
  traceNote: "Explosives recognized and blocked; no placards computed for the load.",
};

function applyGate(spec: GateSpec, hits: ScopeHit[], findings: Finding[], trace: TraceNode[]): boolean {
  if (hits.length === 0) return false;
  const classes = [...new Set(hits.map((h) => h.classOrDivision))];
  findings.push({
    ruleId: spec.ruleId,
    tier: "violation",
    message: spec.message(classes.join(", ")),
    citations: [{ cfr: "49 CFR 172.504" }, { cfr: spec.internalCitation }],
    evidence: { [spec.evidenceKey]: classes, lines: hits.map((h) => h.hmtRef) },
  });
  trace.push({
    ruleId: spec.ruleId,
    fired: true,
    inputs: { [spec.evidenceKey]: classes, count: hits.length },
    citations: [{ cfr: "49 CFR 172.504" }],
    note: spec.traceNote,
  });
  return true;
}

/**
 * Returns true when the load is out of scope and the caller must stop. Table 1 is checked first, and
 * only one gate ever reports: a load that is both is blocked either way, and two violations naming the
 * same refusal would read as two separate problems.
 */
export function applyScopeGates(args: {
  table1Hits: ScopeHit[];
  explosivesHits: ScopeHit[];
  findings: Finding[];
  trace: TraceNode[];
}): boolean {
  const { table1Hits, explosivesHits, findings, trace } = args;
  if (applyGate(TABLE_1, table1Hits, findings, trace)) return true;
  return applyGate(EXPLOSIVES, explosivesHits, findings, trace);
}
