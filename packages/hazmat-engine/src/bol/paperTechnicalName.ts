/**
 * paper_technical_name — 49 CFR 172.203(k), eCFR text of 2026-10-09: "Unless otherwise excepted, if a
 * material is described on a shipping paper by one of the proper shipping names identified by the letter
 * "G" in column (1) of the § 172.101 Table, the technical name of the hazardous material must be entered
 * in parentheses in association with the basic description."
 *
 * (k)(1): "If a hazardous material is a mixture or solution of two or more hazardous materials, the
 * technical names of at least two components most predominately contributing to the hazards of the
 * mixture or solution must be entered". Whether the material IS such a mixture is not on the paper and not
 * in the dataset, so one printed name passes only when the caller says the material has one hazardous
 * component (`hazardousComponents`); two are required when it says two or more; otherwise cannot tell.
 *
 * (k)(2): "The provisions of this paragraph do not apply—
 *   (i) To a material that is a hazardous waste and described using the proper shipping name "Hazardous
 *       waste, liquid or solid, n.o.s.", classed as a miscellaneous Class 9, provided the EPA hazardous
 *       waste number is included on the shipping paper in association with the basic description, or
 *       provided the material is described in accordance with the provisions of § 172.203(c) of this part.
 *   (ii) To a material for which the hazard class is to be determined by testing under the criteria in
 *       § 172.101(c)(11).
 *   (iii) If the n.o.s. description for the material (other than a mixture of hazardous materials of
 *       different classes meeting the definitions of more than one hazard class) contains the name of the
 *       chemical element or group which is primarily responsible for the material being included in the
 *       hazard class indicated.
 *   (iv) If the n.o.s. description for the material (which is a mixture of hazardous materials of
 *       different classes meeting the definition of more than one hazard class) contains the name of the
 *       chemical element or group responsible for the material meeting the definition of one of these
 *       classes. In such cases, only the technical name of the component that is not appropriately
 *       identified in the n.o.s. description shall be entered in parentheses."
 *
 * (i) is read from the row's name, its class and a printed EPA waste code (40 CFR 261: a letter D, F, K, P
 * or U and three digits). (ii) is read from the word "Sample", which §172.101(c)(11)(iv)(A) requires
 * "as part of the proper shipping name or in association with the basic description". (iii)/(iv) turn on
 * whether the n.o.s. name names a chemical element or group — something the dataset does not mark. The
 * rule therefore fails a missing name only on a G entry whose name LEADS with a hazard descriptor (the
 * words of §173.2 Table 1's class names, or one of the generic n.o.s. heads below) and so names no chemical;
 * any other G entry with no technical name may sit under (iii)/(iv) and the answer is cannot_tell.
 * WORKAROUND, labelled per CLAUDE.md: `HAZARD_HEADS` is a hand-held vocabulary standing in for a per-entry
 * "names a chemical group" flag the dataset does not carry; the flag on the HMT row removes it.
 */
import type { PaperRuleResult } from "./paperTypes.js";
import { gated, lineLabel, lineTexts, make, namedComponentCount, norm, rowOf, technicalNameText, type LineCtx } from "./paperSupport.js";

const HAZARD_HEADS = new Set([
  "flammable", "non-flammable", "combustible", "corrosive", "toxic", "poisonous", "oxidizing", "oxidizer", "infectious",
  "radioactive", "self-heating", "self-reactive", "water-reactive", "pyrophoric", "organic", "environmentally",
  "compressed", "liquefied", "adsorbed", "refrigerated", "gas", "elevated", "explosive", "articles", "substances",
  "dangerous", "chemical", "polymerizing", "desensitized", "spontaneously", "hazardous", "other", "aerosols",
]);
const EPA_WASTE_CODE = /\b[DFKPU]\d{3}\b/;
const HAZARDOUS_WASTE_PSN = new Set(["hazardous waste, liquid, n.o.s.", "hazardous waste, solid, n.o.s."]);

export function paperTechnicalName(ctx: LineCtx): PaperRuleResult {
  const r = make("paper_technical_name", ctx.index);
  const g = gated(ctx, r, ["technicalName", "psn", "marks", "descriptionText"]);
  if (g) return g;
  const row = rowOf(ctx);
  const label = lineLabel(ctx);
  if (!row) return r("cannot_tell", "line_unresolved", { lineLabel: label });
  if (!Array.isArray(row.entry.symbols)) return r("cannot_tell", "requirement_not_in_dataset", { lineLabel: label, needs: "HMT column 1 symbols" });
  if (!row.entry.symbols.includes("G")) return r("pass", "not_required", { lineLabel: label });
  const texts = lineTexts(ctx.printed);
  const psn = norm(row.entry.psnPrinted.replace(/n\.o\.s$/i, "n.o.s."));
  const tech = technicalNameText(ctx.printed);
  if (HAZARDOUS_WASTE_PSN.has(psn) && row.entry.hazardClass === "9") {
    if (texts.some((t) => EPA_WASTE_CODE.test(t))) return r("pass", "excepted_k2i_waste_code", { lineLabel: label });
    // "…or provided the material is described in accordance with the provisions of § 172.203(c)": the
    // hazardous substance named in parentheses, which §172.203(c)(1) asks for and (k)(1) then does not.
    if (tech) return r("pass", "excepted_k2i_hazardous_substance_named", { lineLabel: label, technicalName: tech });
  }
  if (texts.some((t) => /\bsamples?\b/i.test(t))) return r("pass", "excepted_k2ii_sample", { lineLabel: label });

  if (tech) {
    const named = namedComponentCount(ctx.printed);
    const components = ctx.resolved.hazardousComponents ?? null;
    const facts = { lineLabel: label, technicalName: tech, namedComponents: named };
    if (named >= 2 || components === 1) return r("pass", "printed", facts);
    if (components != null && components >= 2) return r("fail", "needs_two_components", facts);
    return r("cannot_tell", "mixture_unknown", facts);
  }
  const head = norm(row.entry.psnPrinted).split(/[\s,]+/)[0] ?? "";
  if (HAZARD_HEADS.has(head)) return r("fail", "missing", { lineLabel: label, requiredPsn: row.entry.psnPrinted });
  return r("cannot_tell", "k2_group_named", { lineLabel: label, requiredPsn: row.entry.psnPrinted });
}
