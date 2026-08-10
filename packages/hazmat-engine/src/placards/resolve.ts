import type { Finding, LoadInput, PlacardOutput, TraceNode } from "../types.js";
import { pihRestsOnAbsence, selectPlacardRow } from "./tableSelect.js";
import {
  baseClass,
  effectiveClassKey,
  isExplosivesDivision,
  type DsView,
  toPlacardName,
  pgRowForRef,
} from "./classify.js";
import { type Resolved, verifyLqClaim, withheld } from "./computeSupport.js";

export interface PlacardResolution {
  resolved: Resolved[];
  table1Hits: { hmtRef: string; classOrDivision: string }[];
  explosivesHits: { hmtRef: string; classOrDivision: string }[];
  complete: boolean;
}

function incompleteResolution(
  resolved: Resolved[],
  table1Hits: { hmtRef: string; classOrDivision: string }[],
  explosivesHits: { hmtRef: string; classOrDivision: string }[],
): PlacardResolution {
  return { resolved, table1Hits, explosivesHits, complete: false };
}

/**
 * Resolve each load line to its HMT entry and placard category.
 *
 * This is the dataset-facing half of the placard ladder: it handles table selection, PIH ambiguity,
 * Table 1/explosives recognition, and Limited Quantity claims. The decision stage stays in compute.ts,
 * where the resolved lines are turned into required, permitted, and prohibited placards.
 */
export function resolvePlacardLines(
  load: LoadInput,
  ds: DsView,
  placards: PlacardOutput,
  findings: Finding[],
  trace: TraceNode[],
): PlacardResolution {
  const resolved: Resolved[] = [];
  const table1Hits: { hmtRef: string; classOrDivision: string }[] = [];
  const explosivesHits: { hmtRef: string; classOrDivision: string }[] = [];

  for (const line of load.lines) {
    const [entryId] = line.hmtRef.split("#");
    const entry = ds.entries.find((e) => e.entryId === entryId);
    if (!entry) {
      findings.push(withheld(`Line "${line.hmtRef}" does not resolve to a dataset entry`, { hmtRef: line.hmtRef }));
      trace.push({ ruleId: "resolve_line", fired: false, inputs: { hmtRef: line.hmtRef }, citations: [] });
      return incompleteResolution(resolved, table1Hits, explosivesHits);
    }
    const key = effectiveClassKey(entry, line.reclassedCombustible);
    const matches = ds.placards.filter((p) => baseClass(p.classOrDivision) === key);
    // Divisions 6.1 and 5.2 appear in BOTH tables, separated only by a qualifier the class number does
    // not carry. Decide it from the entry (see tableSelect.ts) instead of giving up — giving up is what
    // made every Class 6.1 material in the HMT return "withheld".
    const choice = selectPlacardRow(key, entry, matches);
    if (!choice.ok) {
      findings.push(withheld(choice.reason, { hmtRef: line.hmtRef, key, matched: matches.length, cfr: choice.citation }));
      trace.push({ ruleId: "class_to_placard", fired: false, inputs: { key, matched: matches.length }, citations: [{ cfr: choice.citation }], note: choice.reason });
      return incompleteResolution(resolved, table1Hits, explosivesHits);
    }
    const spec = choice.spec;
    if (matches.length > 1) {
      trace.push({ ruleId: "placard_table_disambiguated", fired: true, inputs: { hmtRef: line.hmtRef, key, chosenTable: spec.table }, citations: [{ cfr: "49 CFR 172.102(c)(1)" }], note: choice.because });
    }
    // D2 — never under-placard. A non-PIH call made purely because no inhalation special provision is
    // present is a call about data the shipped table cannot fully evidence: it carries no hazard-zone
    // column. Compute the Table 2 placard, and refuse to let the load auto-clear on it.
    if (spec.table === 2 && pihRestsOnAbsence(key, entry)) {
      findings.push({
        ruleId: "pih_determination_from_special_provisions",
        tier: "conditional",
        message:
          `${entry.psnPrinted} is treated as NOT poisonous by inhalation because no §172.102 special provision 1–4 ` +
          "and no inhalation-hazard shipping name applies. A PIH material is a Table 1 material and must be " +
          "placarded in any quantity — confirm the classification on the shipping paper before relying on this.",
        citations: [{ cfr: "49 CFR 172.102(c)(1)" }, { cfr: "49 CFR 171.8" }],
        evidence: { hmtRef: line.hmtRef, entryId: entry.entryId },
      });
    }
    // 1b) Table 1 gate (D4-revised, D2 fail-closed): the fuel-scope engine RECOGNIZES 49 CFR 172.504 Table 1
    //     materials (explosives 1.1–1.3, 2.3 poison gas, 4.3, PIH 6.1, organic-peroxide 5.2, radioactive) from
    //     the dataset but does NOT compute their placards — Table 1 *logic* is a later expansion pack. Recognition
    //     is total and dataset-driven: capture any Table 1 row HERE (by its matched spec.table, regardless of
    //     whether its placard name maps to a known design) and block the whole load below.
    if (spec.table === 1) {
      table1Hits.push({ hmtRef: line.hmtRef, classOrDivision: spec.classOrDivision });
      trace.push({ ruleId: "table1_recognized", fired: true, inputs: { hmtRef: line.hmtRef, class: entry.hazardClass, classOrDivision: spec.classOrDivision }, citations: [{ cfr: "49 CFR 172.504" }], note: "Table 1 material — out of v1 scope (D4-revised)" });
      continue;
    }
    // Explosives gate (D4-revised). Divisions 1.4/1.5/1.6 genuinely ARE Table 2 rows — §172.504(e)
    // says so and the dataset is right to record it — but D4 defers explosives *logic*, and that
    // deferral is about depth, not table membership. An explosives load needs compatibility groups,
    // the §172.504(f) exception interplay, its own §177.848 segregation, and the rule that explosives
    // may never use the DANGEROUS substitution. None of that is implemented, so emitting a bare
    // EXPLOSIVES 1.4 diamond would UNDERSTATE the load — the exact D2 failure the Table 1 gate exists
    // to prevent, arriving through a different door. Recognise and block instead.
    //
    // The alternative — editing the dataset to call these Table 1 — was rejected outright: the dataset
    // states the regulation, and the parser asserts its own table signatures precisely so nobody can
    // quietly move a row to make the code's life easier.
    if (isExplosivesDivision(key)) {
      explosivesHits.push({ hmtRef: line.hmtRef, classOrDivision: spec.classOrDivision });
      trace.push({ ruleId: "explosives_recognized", fired: true, inputs: { hmtRef: line.hmtRef, class: entry.hazardClass }, citations: [{ cfr: "49 CFR 172.504" }], note: "Explosives division — placard logic deferred (D4-revised)" });
      continue;
    }
    const placard = toPlacardName(spec.placardName);
    if (placard == null) {
      // e.g. 6.2 → "NONE": a recognized material that takes no placard
      trace.push({ ruleId: "class_to_placard", fired: true, inputs: { hmtRef: line.hmtRef, placardName: spec.placardName }, citations: [{ cfr: `49 CFR ${spec.designRef ?? "172.504"}` }], note: "no placard for this class" });
      continue;
    }

    // ── H-LQ (0.10.0): the Limited Quantity gate, per line ──────────────────────────────────────
    let lqAccepted = false;
    if (line.isLimitedQuantity) {
      const lq = verifyLqClaim(line, entry, key, load.vehicle.kind === "cargo_tank");
      if (lq.accepted) {
        lqAccepted = true;
        findings.push({
          ruleId: "lq_excepted_from_placarding",
          tier: "info",
          message:
            `${entry.psnPrinted} is declared a Limited Quantity and the HMT authorizes exceptions for it (§173.${pgRowForRef(entry, line.hmtRef)?.exceptionsRef}) — ` +
            "identified per §172.203(b)/§172.315, the placarding subpart does not apply to this line (§172.500(b)(2)). " +
            "The declaration (including inner-receptacle limits) is the offeror's; the LQ surface mark must be displayed.",
          citations: [{ cfr: "49 CFR 172.500(b)(2)" }, { cfr: "49 CFR 172.315(a)" }],
          evidence: { hmtRef: line.hmtRef, exceptionsRef: pgRowForRef(entry, line.hmtRef)?.exceptionsRef ?? null },
        });
        if (!placards.marks.some((m) => m.mark === "LIMITED_QUANTITY")) {
          placards.marks.push({
            mark: "LIMITED_QUANTITY",
            positions: "one side or end of each package (square-on-point, ≥100 mm; 50 mm reduced size allowed)",
            because: [{ cfr: "49 CFR 172.315(a)" }],
          });
        }
        trace.push({ ruleId: "lq_gate", fired: true, inputs: { hmtRef: line.hmtRef, accepted: true }, citations: [{ cfr: "49 CFR 172.500(b)(2)" }] });
      } else {
        findings.push({
          ruleId: "lq_claim_refused",
          tier: "conditional",
          message:
            `The Limited Quantity claim on ${entry.psnPrinted} is REFUSED: ${lq.reason}. ` +
            "The line is evaluated fully regulated (placards asserted, aggregate counted) — route to a hazmat-trained reviewer.",
          citations: [{ cfr: lq.cfr }, { cfr: "49 CFR 172.500(b)(2)" }],
          evidence: { hmtRef: line.hmtRef, reason: lq.reason },
        });
        trace.push({ ruleId: "lq_gate", fired: true, inputs: { hmtRef: line.hmtRef, accepted: false }, citations: [{ cfr: lq.cfr }], note: lq.reason });
      }
    }

    resolved.push({ line, entry, spec, placard, lqAccepted });
    trace.push({ ruleId: "class_to_placard", fired: true, inputs: { hmtRef: line.hmtRef, class: entry.hazardClass, placard, table: spec.table, lqAccepted }, citations: [{ cfr: `49 CFR ${spec.designRef ?? "172.504"}` }] });
  }

  return { resolved, table1Hits, explosivesHits, complete: true };
}
