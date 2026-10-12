import { auditPrintedPaper, type PaperFieldStates } from "@hazmat/engine";
import {
  classifyLineLoadState,
  normalizeUnit,
  packageTypeFromPrinted,
  packagingKindFor,
  paperAuditSchema,
  readersAgree,
  shippingDocumentSchema,
  valuesAgree,
  type FieldEvidence,
  type PaperAuditView,
} from "@silvicom/shared";
import { hmtResolution, witnessDataset } from "./hmtWitness.js";

/**
 * The printed-paper audit of one shipping-document read (§5.1, D-DR6; §7A N6 part 3) — "what the shipper got
 * wrong or left out", answered by `auditPrintedPaper`'s rules over the document pass A returned, each line
 * resolved by the same resolver and dataset as the table witness (`hmtWitness.ts`), so the audit and the
 * verdict the calculator's product came from cannot disagree about which row a line is.
 *
 * WHICH FIELDS THE AUDIT MAY JUDGE (D-DR22). The audit refuses to judge a field that is not *Read* — it answers
 * `cannot_tell`, "confirm it first". Under acceptance rule 4 no field is ever *Read* (that waits on graduation,
 * D-DR5, switched off), so handing it the evidence's statuses would make every finding "can't check yet",
 * and the audit could never say anything before a person had retyped the paper. D-DR19 already states the
 * bar for trusting a value: two independent witnesses agree. So a field counts as confirmed FOR THE AUDIT when
 * both model readers read the same value — including both reading nothing, which is how a missing packing
 * group or phone number is ever found — and the OCR, where it judged the field, did not find a different
 * one. Everything else keeps its own status. The form's field states do not change: this decides only what
 * the audit may reason over, and each finding quotes the printed value so a person sees what it rests on.
 *
 * Template lines a shipper pre-prints with no count, weight or quantity are not audited: nothing is offered on
 * them, the calculator prefill leaves them out (`classifyLineLoadState`, the extractor's own rule), and their
 * findings would be about freight that is not aboard. The results keep the read's own line numbers.
 *
 * Inputs a BOL does not carry — the carrier relationship behind the certification exemption, a vessel leg,
 * the offeror's own Limited Quantity claim — are not known here and stay null, so the rules that need them
 * answer `cannot_tell` rather than assume.
 */
export function auditForRead(result: unknown, evidence: readonly FieldEvidence[]): PaperAuditView | null {
  const parsed = shippingDocumentSchema.safeParse(result);
  if (!parsed.success) return null;
  const all = parsed.data;
  const aboard = all.hazmat.lines.flatMap((l, i) => (classifyLineLoadState(l) === "preprinted_not_loaded" ? [] : [i]));
  const doc = { ...all, hazmat: { ...all.hazmat, lines: aboard.map((i) => all.hazmat.lines[i]!) } };
  const { dataset } = witnessDataset();
  // The audit numbers the lines it was given; its paths and indexes go back to the read's numbering.
  const states = Object.fromEntries(Object.entries(auditFieldStates(evidence)).flatMap(([path, st]) => {
    const m = /^hazmat\.lines\[(\d+)\]/.exec(path);
    if (!m) return [[path, st]];
    const at = aboard.indexOf(Number(m[1]));
    return at < 0 ? [] : [[path.replace(m[0], `hazmat.lines[${at}]`), st]];
  }));
  const other = evidence.find((e) => e.path === "otherLines");
  // Parsed into the wire contract here, so a fact type the engine adds and the contract lacks fails loudly.
  const audit = paperAuditSchema.parse(auditPrintedPaper(
    doc,
    {
      dataset,
      lines: doc.hazmat.lines.map((l) => ({
        resolution: hmtResolution(l),
        quantityUnit: normalizeUnit(l.quantity.unit),
        packagingKind: packagingKindFor(packageTypeFromPrinted(l.packaging)),
      })),
      // §172.201(a)(1)'s mixed paper, only when both readers agree on whether non-hazmat lines are printed.
      mixedPaper: other && readersAgree(other) === true ? doc.otherLines.length > 0 : null,
    },
    states,
  ));
  const back = (path: string) => path.replace(/^hazmat\.lines\[(\d+)\]/, (_, n: string) => `hazmat.lines[${aboard[Number(n)]}]`);
  return {
    ...audit,
    results: audit.results.map((r) => ({
      ...r,
      lineIndex: r.lineIndex === null ? null : aboard[r.lineIndex]!,
      facts: Array.isArray(r.facts.unconfirmed) ? { ...r.facts, unconfirmed: (r.facts.unconfirmed as string[]).map(back) } : r.facts,
    })),
  };
}

/** Each evidence path's state as the audit takes it (D-DR22, above). */
export function auditFieldStates(evidence: readonly FieldEvidence[]): PaperFieldStates {
  return Object.fromEntries(evidence.map((e) => [e.path, confirmedForAudit(e) ? "read" : e.status]));
}

function confirmedForAudit(e: FieldEvidence): boolean {
  if (readersAgree(e) !== true) return false;
  const ocr = e.sources.find((s) => s.reader === "ocr");
  return !ocr || valuesAgree(ocr.value, e.value);
}
