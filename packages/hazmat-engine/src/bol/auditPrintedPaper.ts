/**
 * auditPrintedPaper (DOCUMENT-READER-PLAN.md D-DR6, §5.1) — is this BOL written correctly?
 *
 * Pure rules over the PRINTED lines against the HMT row each resolved to. One answer per rule per line
 * (ten line rules) plus one per document rule (phone, certification, pages): `pass`, `fail` or
 * `cannot_tell`, with the reason code and the facts the dispatcher's sentence needs — the sentences
 * themselves live in `packages/shared/src/bolFindingCatalogue.ts` (D-DR7), keyed by `PAPER_RULE_IDS`.
 *
 * `cannot_tell` is a first-class answer, not an error: a field the reader marked Check or Not read, a
 * line that did not resolve (for every rule that needs its row), a fact outside the paper nobody
 * supplied, or a requirement the dataset version does not carry. None of them is ever a pass.
 *
 * Every rule states the regulation as eCFR printed it on 2026-10-09 and applies the exceptions that text
 * gives (owner ruling Q-DR15: paper-format rules stay code, and match the regulation's words).
 *
 * The placard computation consumes nothing from here (D-DR6). No clock, no randomness, no I/O.
 */
import type { PaperAudit, PaperFieldStates, PaperRuleResult, PrintedPaper, PrintedPaperLine, ResolvedPaper } from "./paperTypes.js";
import { lineLabel, readPaperDataset, unconfirmed, type LineCtx } from "./paperSupport.js";
import {
  paperClassPgMatch,
  paperHmColumn,
  paperPackageCount,
  paperPsnMatchesHmt,
  paperQuantityPresent,
  paperSequence,
} from "./paperDescriptionRules.js";
import { paperTechnicalName } from "./paperTechnicalName.js";
import { paperLq, paperRq } from "./paperAdditionalRules.js";
import { paperMarinePollutant } from "./paperMarinePollutant.js";
import { paperCertification, paperPageComplete } from "./paperDocumentRules.js";
import { paperErPhone } from "./paperErPhone.js";

const LINE_RULES: ReadonlyArray<(ctx: LineCtx) => PaperRuleResult> = [
  paperSequence,
  paperPsnMatchesHmt,
  paperClassPgMatch,
  paperTechnicalName,
  paperRq,
  paperLq,
  paperMarinePollutant,
  paperQuantityPresent,
  paperPackageCount,
  paperHmColumn,
];

/** The printed fields that choose a line's table row — the resolver's whole input (resolveHmtLine). */
const ROW_CHOOSING_KEYS = ["idText", "psn", "hazardClass", "pg"] as const satisfies readonly (keyof PrintedPaperLine)[];

/**
 * A rule's answer, held to the fields its row rests on (READER-CORRECTNESS-PLAN, 2026-10-19). Every rule that
 * consults the line's table row — its required name, class, PG, RQ, exceptions — judges the paper against a
 * row chosen from the id, name, class and PG; if the readers do not agree on those, the row may be the wrong
 * one and so may the verdict. Production read 76979453: pass A read UN3254 where pass B read UN3264 (the
 * paper's number), and `paper_psn_matches_hmt`, gated on the name alone, told the shipper the name was wrong
 * for UN3254 ("the table lists: Tributylphosphane"). Each rule listed its own gates, and seven of ten left
 * the row's fields out. So it is enforced here, once, for every rule present and future: a rule that read
 * the resolution while any row-choosing field is unconfirmed answers "confirm it first", naming them.
 * `paperRowGate.test.ts` holds it for every rule: one whose answer changes with the row must wait.
 */
function heldToItsRow(rule: (ctx: LineCtx) => PaperRuleResult, ctx: LineCtx): PaperRuleResult {
  let readRow = false;
  const r = ctx.resolved;
  const watched: LineCtx = { ...ctx, resolved: { ...r, get resolution() { readRow = true; return r.resolution; } } };
  const result = rule(watched);
  if (!readRow) return result;
  const open = unconfirmed(ctx.states, ROW_CHOOSING_KEYS.map(ctx.path));
  if (open.length === 0) return result;
  const already = result.reason === "field_unconfirmed" && Array.isArray(result.facts.unconfirmed) ? (result.facts.unconfirmed as string[]) : [];
  return {
    ...result,
    outcome: "cannot_tell",
    reason: "field_unconfirmed",
    facts: { lineLabel: lineLabel(ctx), unconfirmed: [...new Set([...already, ...open])].sort() },
  };
}

export function auditPrintedPaper(printed: PrintedPaper, resolved: ResolvedPaper, fieldStates: PaperFieldStates = {}): PaperAudit {
  const datasetVersion = resolved.dataset.version;
  const lines = printed.hazmat.lines;
  if (lines.length === 0) return { datasetVersion, results: [] };
  const ds = readPaperDataset(resolved.dataset);
  const ctxs: LineCtx[] = lines.map((line, index) => ({
    index,
    printed: line,
    // A line with no resolution entry is a line the resolver never ran on: every row rule cannot tell.
    resolved: resolved.lines[index] ?? { resolution: null },
    paper: resolved,
    ds,
    states: fieldStates,
    path: (key: keyof PrintedPaperLine) => `hazmat.lines[${index}].${key}`,
  }));
  const results: PaperRuleResult[] = [];
  for (const ctx of ctxs) for (const rule of LINE_RULES) results.push(heldToItsRow(rule, ctx));
  results.push(paperErPhone(printed, ctxs, fieldStates));
  results.push(paperCertification(printed, resolved, fieldStates));
  results.push(paperPageComplete(printed, resolved, fieldStates));
  return { datasetVersion, results };
}
