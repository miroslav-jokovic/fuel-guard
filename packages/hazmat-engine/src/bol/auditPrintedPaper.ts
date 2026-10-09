/**
 * auditPrintedPaper (DOCUMENT-READER-PLAN.md D-DR6, §5.1) — is this BOL written correctly?
 *
 * Pure rules over the PRINTED lines against the HMT row each resolved to. One answer per rule per line
 * (nine line rules) plus one per document rule (phone, certification, pages): `pass`, `fail` or
 * `cannot_tell`, with the reason code and the facts the dispatcher's sentence needs — the sentences
 * themselves live in `packages/shared/src/bolFindingCatalogue.ts` (D-DR7), keyed by `PAPER_RULE_IDS`.
 *
 * `cannot_tell` is a first-class answer, not an error: a field the reader marked Check or Not read, a
 * line that did not resolve (for every rule that needs its row), a fact outside the paper nobody
 * supplied, or a requirement the dataset version does not carry. None of them is ever a pass.
 *
 * The placard computation consumes nothing from here (D-DR6). No clock, no randomness, no I/O.
 */
import type { PaperAudit, PaperFieldStates, PaperRuleResult, PrintedPaper, PrintedPaperLine, ResolvedPaper } from "./paperTypes.js";
import { readPaperDataset, type LineCtx } from "./paperSupport.js";
import {
  paperClassPgMatch,
  paperHmColumn,
  paperPsnMatchesHmt,
  paperQuantityPresent,
  paperSequence,
  paperTechnicalName,
} from "./paperDescriptionRules.js";
import { paperLq, paperMarinePollutant, paperRq } from "./paperAdditionalRules.js";
import { paperCertification, paperErPhone, paperPageComplete } from "./paperDocumentRules.js";

const LINE_RULES: ReadonlyArray<(ctx: LineCtx) => PaperRuleResult> = [
  paperSequence,
  paperPsnMatchesHmt,
  paperClassPgMatch,
  paperTechnicalName,
  paperRq,
  paperLq,
  paperMarinePollutant,
  paperQuantityPresent,
  paperHmColumn,
];

export function auditPrintedPaper(printed: PrintedPaper, resolved: ResolvedPaper, fieldStates: PaperFieldStates = {}): PaperAudit {
  const datasetVersion = resolved.dataset.version;
  const lines = printed.hazmat.lines;
  if (lines.length === 0) return { datasetVersion, results: [] };
  const ds = readPaperDataset(resolved.dataset);
  const results: PaperRuleResult[] = [];
  lines.forEach((line, index) => {
    const ctx: LineCtx = {
      index,
      printed: line,
      // A line with no resolution entry is a line the resolver never ran on: every row rule cannot tell.
      resolved: resolved.lines[index] ?? { resolution: null },
      paper: resolved,
      ds,
      states: fieldStates,
      path: (key: keyof PrintedPaperLine) => `hazmat.lines[${index}].${key}`,
    };
    for (const rule of LINE_RULES) results.push(rule(ctx));
  });
  results.push(paperErPhone(printed, fieldStates));
  results.push(paperCertification(printed, resolved, fieldStates));
  results.push(paperPageComplete(printed, resolved, fieldStates));
  return { datasetVersion, results };
}
