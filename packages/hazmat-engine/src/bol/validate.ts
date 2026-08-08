/**
 * validateBol (plan H3) — shipping-paper (BOL) compliance, computed from the resolved load + dataset.
 *
 * This is the "what the shipping paper MUST say/contain" half of H3: for each line it derives the
 * §172.202(a) basic description in the required sequence (ID number, proper shipping name, hazard
 * class, packing group), the §172.203 additional descriptions the material triggers (technical name
 * for a G/ n.o.s. entry, "Marine Pollutant", "RQ"), and the load-level elements every hazmat shipping
 * paper needs (§172.604 emergency-response phone, §172.204 certification, §172.201 identification).
 * When the extracted/printed BOL fields land (H6 BolFields), the printed text is compared against these
 * requirements; on its own it already tells a shipper exactly what the paper must read.
 *
 * Pure; reads the dataset through a minimal consumer view (the engine may not import @hazmat/data).
 * Fuel/CERCLA note: petroleum fuels are excluded from the hazardous-substance (RQ) list, so RQ never
 * fires for them — matched by name against Appendix A, which does not list petroleum products.
 */

import type { Finding, LoadInput, TraceNode } from "../types.js";

interface DsEntry {
  entryId: string;
  symbols?: string[];
  psnPrinted: string;
  psnAlternates?: string[];
  hazardClass: string | null;
  subsidiaryClasses?: string[];
  idPrefix: "UN" | "NA";
  idNumber: string;
  pgRows: Array<{ pg: "I" | "II" | "III" | null }>;
}
interface DsHaz { nameNormalized: string }
interface DsMp { nameNormalized: string; severe: boolean }
interface DsView { entries: DsEntry[]; hazSubstances: DsHaz[]; marinePollutants: DsMp[] }

function readDataset(load: LoadInput): DsView {
  const d = load.dataset as unknown as Partial<DsView>;
  return {
    entries: Array.isArray(d.entries) ? d.entries : [],
    hazSubstances: Array.isArray(d.hazSubstances) ? d.hazSubstances : [],
    marinePollutants: Array.isArray(d.marinePollutants) ? d.marinePollutants : [],
  };
}

function baseClass(s: string): string {
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(s);
  return m ? (m[1] as string) : s.trim().toLowerCase();
}
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface BolLineCompliance {
  hmtRef: string;
  /** The §172.202(a) basic description the shipping paper must carry, e.g. "UN1203, Gasoline, 3, II". */
  basicDescription: string;
  /** Additional §172.203 entries this material requires (as printed phrases). */
  additionalRequired: string[];
}
export interface BolValidation {
  lines: BolLineCompliance[];
  findings: Finding[];
  trace: TraceNode[];
}

export function validateBol(load: LoadInput): BolValidation {
  const ds = readDataset(load);
  const lines: BolLineCompliance[] = [];
  const findings: Finding[] = [];
  const trace: TraceNode[] = [];

  if (load.lines.length === 0) {
    trace.push({ ruleId: "bol_no_hazmat", fired: true, inputs: { lines: 0 }, citations: [] });
    return { lines, findings, trace };
  }

  for (const line of load.lines) {
    const [entryId, pgRaw] = line.hmtRef.split("#");
    const entry = ds.entries.find((e) => e.entryId === entryId);
    if (!entry) {
      findings.push({
        ruleId: "bol_line_unresolved",
        tier: "conditional",
        message: `Line "${line.hmtRef}" does not resolve to a dataset entry — the basic description cannot be verified. Route to a reviewer.`,
        citations: [{ cfr: "49 CFR 172.202" }],
        evidence: { hmtRef: line.hmtRef },
      });
      continue;
    }

    // §172.202(a) sequence: ID, PSN, hazard class, PG.
    const idPart = `${entry.idPrefix}${entry.idNumber}`;
    const reclassed = line.reclassedCombustible && baseClass(entry.hazardClass ?? "") === "3";
    const classPart = reclassed ? "Combustible liquid" : entry.hazardClass;
    const pg = pgRaw && pgRaw !== "none" ? pgRaw : null;
    const parts = [idPart, entry.psnPrinted, classPart, pg].filter((x): x is string => !!x);
    const basicDescription = parts.join(", ");

    const additionalRequired: string[] = [];
    // H-LQ (0.10.0) — §172.203(b): a Limited Quantity line's description must say so. This is also
    // one of the two identification routes that make §172.500(b)(2) apply at all.
    if (line.isLimitedQuantity) {
      additionalRequired.push("the words “Limited Quantity” (or “Ltd Qty”) on the description (§172.203(b))");
    }
    // §172.203(k): technical name for G-symbol / n.o.s. entries.
    if ((entry.symbols ?? []).includes("G")) {
      additionalRequired.push("technical name(s) in parentheses (§172.203(k))");
    }
    // §172.203(l): Marine Pollutant (name match against Appendix B).
    // Defensive against minimal dataset views (evaluateLoad now calls this on every dataset —
    // G2): an entry without printed names simply matches no Appendix A/B name.
    const names = [entry.psnPrinted, ...(entry.psnAlternates ?? [])]
      .filter((n): n is string => typeof n === "string")
      .map(norm);
    if (ds.marinePollutants.some((m) => names.includes(m.nameNormalized))) {
      additionalRequired.push("the words “Marine Pollutant” (§172.203(l))");
    }
    // §172.203(c): RQ if a listed hazardous substance (Appendix A). Petroleum fuels are CERCLA-excluded.
    if (ds.hazSubstances.some((h) => names.includes(h.nameNormalized))) {
      additionalRequired.push("“RQ” before the basic description (§172.203(c))");
    }

    lines.push({ hmtRef: line.hmtRef, basicDescription, additionalRequired });

    findings.push({
      ruleId: "bol_basic_description",
      tier: "info",
      message: reclassed
        ? `Required basic description (§172.202(a); combustible-liquid reclassification §172.101(d)(4)/§172.202(a)(3)(ii), PHMSA 15-0187R): "${basicDescription}".`
        : `Required basic description (§172.202(a)): "${basicDescription}".`,
      citations: reclassed
        ? [{ cfr: "49 CFR 172.202(a)" }, { cfr: "49 CFR 172.101(d)(4)", interpretation: "PHMSA 15-0187R" }]
        : [{ cfr: "49 CFR 172.202(a)" }],
      evidence: { hmtRef: line.hmtRef, basicDescription },
    });
    for (const req of additionalRequired) {
      findings.push({
        ruleId: "bol_additional_description_required",
        // Since 0.8.0 (M5.2): a REQUIREMENT STATEMENT, not an unresolved question — the engine
        // successfully derived what the paper must say; verifying the physical paper says it is the
        // extraction/review path's job (H6/H7). Info never blocks eligibility.
        tier: "info",
        message: `The shipping paper for ${idPart} must also include: ${req}.`,
        citations: [{ cfr: "49 CFR 172.203" }],
        evidence: { hmtRef: line.hmtRef, requirement: req },
      });
    }

    const pgRows = Array.isArray(entry.pgRows) ? entry.pgRows : []; // defensive: minimal dataset views (G2)
    // PG presence: a material whose entry requires a PG must show it; a Class-2 gas must NOT.
    const requiresPg = pgRows.some((r) => r.pg != null);
    const isGasNoPg = pgRows.length > 0 && pgRows.every((r) => r.pg == null);
    if (requiresPg && !pg && !reclassed) {
      findings.push({
        ruleId: "bol_pg_missing",
        tier: "conditional",
        message: `The packing group is required in the basic description for ${idPart} (§172.202(a)) — none is present on this line.`,
        citations: [{ cfr: "49 CFR 172.202(a)" }],
        evidence: { hmtRef: line.hmtRef },
      });
    }
    if (isGasNoPg && pg) {
      findings.push({
        ruleId: "bol_pg_not_allowed",
        tier: "violation",
        message: `${idPart} is a Class 2 gas with no packing group — a PG ("${pg}") must NOT appear in the basic description (§172.202(a)).`,
        citations: [{ cfr: "49 CFR 172.202(a)" }],
        evidence: { hmtRef: line.hmtRef, pg },
      });
    }
  }

  // Load-level required elements of any hazmat shipping paper (stated as requirements to verify).
  const REQUIRED_ELEMENTS: Array<{ ruleId: string; message: string; cfr: string }> = [
    { ruleId: "bol_emergency_phone_required", message: "A monitored 24-hour emergency-response telephone number must appear on the shipping paper.", cfr: "49 CFR 172.604" },
    { ruleId: "bol_emergency_info_required", message: "Emergency response information must accompany the shipping paper (e.g. the ERG guide number).", cfr: "49 CFR 172.602" },
    { ruleId: "bol_certification_required", message: "The shipper's certification must be present and signed.", cfr: "49 CFR 172.204" },
    { ruleId: "bol_identification_required", message: "Hazardous materials entries must be identifiable on the paper (entered first, highlighted, or marked “X” in an HM column) with the total quantity and number/type of packages.", cfr: "49 CFR 172.201" },
  ];
  for (const e of REQUIRED_ELEMENTS) {
    // Since 0.8.0 (M5.2): tier info — these four are derived REQUIREMENTS every hazmat paper must
    // satisfy (phone, ER info, certification, identification). Deriving them IS the evaluation;
    // whether the printed paper satisfies them is checked against extracted BolFields (H6) or by a
    // reviewer (H7). As conditionals they made `eligible` unreachable for every declared load —
    // exactly G3's bug wearing a different hat.
    findings.push({ ruleId: e.ruleId, tier: "info", message: e.message, citations: [{ cfr: e.cfr }], evidence: {} });
  }

  trace.push({
    ruleId: "bol_validation",
    fired: true,
    inputs: { lines: lines.length },
    citations: [{ cfr: "49 CFR 172.200-172.204" }],
  });
  return { lines, findings, trace };
}
