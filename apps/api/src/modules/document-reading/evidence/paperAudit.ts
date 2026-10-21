import { auditPrintedPaper, parsePageMarker, type PaperFieldStates } from "@hazmat/engine";
import {
  arithmeticBacks,
  classifyLineLoadState,
  isExtentPath,
  parseFieldPath,
  normalizeUnit,
  packageTypeFromPrinted,
  packagingKindFor,
  paperAuditSchema,
  readersAgree,
  settledReading,
  valuesAgree,
  rowWitnessesBack,
  ROW_WITNESS_READERS,
  shippingDocumentSchema,
  type FieldEvidence,
  type PaperAuditView,
  type ShippingDocument,
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
 * group or phone number is ever found — and no row witness (the OCR, a born-digital page's text layer:
 * `ROW_WITNESS_READERS`), where one judged the field, found a different one — nor did the paper's own totals
 * (`arithmeticBacks`, Q-DR26 L3) find that no reading fits them. Everything else keeps its own status. The form's field states do not change: this decides only what
 * the audit may reason over, and each finding quotes the printed value so a person sees what it rests on.
 *
 * The page markers are compared by what `paper_page_complete` reads from them — each image's page and total —
 * not as text. Measured 2026-10-13: on 0135071, the one two-page office BOL, Sonnet 4.6 wrote ["1/2", "2/2"]
 * and Sonnet 5.5 ["Page 1/2", "Page 2/2"]; compared as text they disagree, and the page-count rule answered
 * "confirm it first" on the only paper it could judge. The same split appeared on a retake ("1/2" twice
 * against "Page 1/2" twice) — exactly the paper whose missing page 2 this rule exists to name.
 *
 * Template lines a shipper pre-prints with no count, weight or quantity are not audited: nothing is offered on
 * them, the calculator prefill leaves them out (`classifyLineLoadState`, the extractor's own rule), and their
 * findings would be about freight that is not aboard. The results keep the read's own line numbers.
 *
 * Inputs a BOL does not carry — the carrier relationship behind the certification exemption, a vessel leg,
 * the offeror's own Limited Quantity claim — are not known here and stay null, so the rules that need them
 * answer `cannot_tell` rather than assume.
 *
 * WHAT A PERSON SAID THE PAGE PRINTS (READER-CORRECTNESS-PLAN Q-RC5, owner 2026-10-21, answer (a)). A field the
 * audit could not judge stays "confirm it first" until somebody does — and before this, a person's "Yes, the page
 * says UN3264" on the form never reached it (read 76979453). `checked` is each field's latest explicit review
 * (`personChecks`): its value is judged as the paper's, and the field counts as confirmed (D-DR19: a person acted
 * on it). Only `paper_check` reviews (0509): a Calculate press may carry the load's values, not the page's.
 */
export function auditForRead(result: unknown, read: readonly FieldEvidence[], checked: readonly PersonCheck[] = []): PaperAuditView | null {
  const parsed = shippingDocumentSchema.safeParse(result);
  if (!parsed.success) return null;
  const evidence = withChecks(read, checked);
  // R-M3: a certification one reader read as present, the other left blank and the page's own words back is
  // present for the audit — on the document it judges too, since pass A may be the reader that abstained.
  if (evidence.some(certificationWitnessed)) parsed.data.hazmat.shipperCertification = true;
  // Q-RC7: a UN/NA number the readers split on that the page settles (idWitness.ts) — and its description with it —
  // is judged as the settled reading, which may be pass B's: the row the rules read must be the one the paper prints.
  // A line only pass B saw is not in pass A's document, so it has nothing to settle there.
  for (const e of evidence) {
    const v = settledReading(e);
    const line = Number(/^hazmat\.lines\[(\d+)\]/.exec(e.path)?.[1] ?? -1);
    if (v !== undefined && line >= 0 && line < parsed.data.hazmat.lines.length) setAt(parsed.data, e.path, v);
  }
  // Q-RC5: what a person said the page prints, last, so it stands over every witness.
  for (const c of checked) if (inDocument(parsed.data, c.path)) setAt(parsed.data, c.path, c.value);
  const asRead = auditOf(parsed.data, evidence);
  const other = extentReadings(evidence);
  if (other.length === 0) return asRead;
  // R-M2: a cell the readers read to different extents is judged under BOTH readings (readingExtent.ts). A
  // rule whose answer does not move with the tail may stand; one whose answer moves rests on text only one
  // reader saw, and answers "confirm it first" on that cell — whatever the extent rule failed to foresee.
  const alt = structuredClone(parsed.data);
  for (const { path, value } of other) setAt(alt, path, value);
  const altAudit = auditOf(alt, evidence);
  const altBy = new Map((altAudit.results).map((r) => [`${r.ruleId}@${r.lineIndex}`, r]));
  return {
    ...asRead,
    results: asRead.results.map((r) => {
      const o = altBy.get(`${r.ruleId}@${r.lineIndex}`);
      if (o && o.outcome === r.outcome && o.reason === r.reason) return r;
      const cells = other.map((x) => x.path).filter((p) => r.lineIndex === null || p.startsWith(`hazmat.lines[${r.lineIndex}].`));
      return { ...r, outcome: "cannot_tell" as const, reason: "field_unconfirmed", facts: { ...r.facts, unconfirmed: cells.length ? cells : other.map((x) => x.path) } };
    }),
  };
}

/** Pass B's readings of the extent cells it agrees with pass A on by their facts only, not their text. */
function extentReadings(evidence: readonly FieldEvidence[]): { path: string; value: unknown }[] {
  return evidence.flatMap((e) => {
    if (!isExtentPath(e.path) || readersAgree(e) !== true || e.sources.some((s) => s.reader === "reviewer")) return [];
    const a = e.sources.find((s) => s.reader === "passA")!.value;
    const b = e.sources.find((s) => s.reader === "passB")!.value;
    return valuesAgree(a, b) ? [] : [{ path: e.path, value: b }];
  });
}

/** One field a person checked against the page: the value they said it prints. */
export interface PersonCheck { path: string; value: unknown }

/**
 * Each field's latest explicit review as a check: `confirmed` keeps the read's value, `corrected` gives the
 * person's, and `unreadable` withdraws an earlier check (the person could not say what the page prints).
 */
export function personChecks(rows: readonly { field_path: string; action: string; old_value: unknown; new_value: unknown; explicit: boolean; consumer: string }[]): PersonCheck[] {
  const last = new Map<string, PersonCheck | null>();
  // Only a person's word on the PAGE (`paper_check`, 0509): a Calculate press may record the LOAD's values — a typed
  // weight, a product picked from the list — and judging the paper by them could pass the misprint it exists to find.
  // The query asks for these rows only; held here too.
  for (const r of rows) {
    if (r.consumer !== "paper_check" || !r.explicit) continue;
    last.set(r.field_path, r.action === "confirmed" ? { path: r.field_path, value: r.old_value } : r.action === "corrected" ? { path: r.field_path, value: r.new_value } : null);
  }
  return [...last.values()].filter((c): c is PersonCheck => c !== null);
}

/** The evidence with each checked field carrying the person's word (the `reviewer` witness), which confirms it. */
function withChecks(evidence: readonly FieldEvidence[], checked: readonly PersonCheck[]): readonly FieldEvidence[] {
  if (checked.length === 0) return evidence;
  const by = new Map(checked.map((c) => [c.path, c]));
  return evidence.map((e) => {
    const c = by.get(e.path);
    return c ? { ...e, sources: [...e.sources, { reader: "reviewer" as const, page: null, bbox: null, value: c.value as never }] } : e;
  });
}

/** Whether `path` names a field of this document (its parent exists), so a check can be set there. */
function inDocument(doc: unknown, path: string): boolean {
  const segs = parseFieldPath(path);
  let cur = doc as Record<string | number, unknown> | null | undefined;
  for (const s of segs.slice(0, -1)) {
    cur = cur?.[s] as Record<string | number, unknown> | null | undefined;
    if (cur == null || typeof cur !== "object") return false;
  }
  return true;
}

function setAt(doc: unknown, path: string, value: unknown): void {
  const segs = parseFieldPath(path);
  let cur = doc as Record<string | number, unknown>;
  for (const s of segs.slice(0, -1)) cur = cur[s] as Record<string | number, unknown>;
  cur[segs[segs.length - 1]!] = value;
}

function auditOf(all: ShippingDocument, evidence: readonly FieldEvidence[]): PaperAuditView {
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
      mixedPaper: mixedPaperRead(evidence),
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

/** The readers' page markers, as `paper_page_complete` reads them: each image's page and total. */
const markerMeaning = (v: unknown) => (Array.isArray(v) ? v.map((m) => parsePageMarker(typeof m === "string" ? m : null)) : v);

/**
 * Whether the paper prints non-hazmat lines, when both readers say the same: true or false, null when they
 * differ or only one read the paper. Since profile 1.3.0 each non-hazmat row is fields of its own
 * (`otherLines[i].description`, a row only pass B saw recorded with pass B alone); a 1.2.0 read, and any read
 * with no such row, carries `otherLines` as one leaf list. Their WORDING is not the question here — the
 * audit asks only whether there are any — so two readers who described the same rows differently agree.
 */
function mixedPaperRead(evidence: readonly FieldEvidence[]): boolean | null {
  const readers = ["passA", "passB"] as const;
  if (!readers.every((r) => evidence.some((e) => e.sources.some((s) => s.reader === r)))) return null;
  const leaf = evidence.find((e) => e.path === "otherLines");
  const has = (r: (typeof readers)[number]) =>
    evidence.some((e) => /^otherLines\[\d+\]\./.test(e.path) && e.sources.some((s) => s.reader === r)) ||
    (leaf?.sources.some((s) => s.reader === r && Array.isArray(s.value) && s.value.length > 0) ?? false);
  return has("passA") === has("passB") ? has("passA") : null;
}

function readersAgreeForAudit(e: FieldEvidence): boolean | null {
  if (e.path !== "identity.printedPageNumbers") return readersAgree(e);
  const a = e.sources.find((s) => s.reader === "passA");
  const b = e.sources.find((s) => s.reader === "passB");
  return a && b ? valuesAgree(markerMeaning(a.value), markerMeaning(b.value)) : null;
}

/**
 * The shipper's certification read as present by one model reader, left null by the other, and shown on the
 * page by a row witness (certificationWitness.ts, R-M3). Never when either reader read it as absent: a reader
 * saying "no statement" against one saying "statement" is a disagreement for a person, whatever the OCR found.
 */
function certificationWitnessed(e: FieldEvidence): boolean {
  if (e.path !== "hazmat.shipperCertification") return false;
  const a = e.sources.find((s) => s.reader === "passA")?.value;
  const b = e.sources.find((s) => s.reader === "passB")?.value;
  if (a === undefined || b === undefined) return false;
  const oneAbstains = (a === true && b === null) || (a === null && b === true);
  return oneAbstains && e.sources.some((s) => (ROW_WITNESS_READERS as readonly string[]).includes(s.reader) && s.value === true);
}

function confirmedForAudit(e: FieldEvidence): boolean {
  if (e.sources.some((s) => s.reader === "reviewer")) return true;
  if (certificationWitnessed(e)) return true;
  if (settledReading(e) !== undefined) return true;
  if (readersAgreeForAudit(e) !== true) return false;
  return rowWitnessesBack(e) !== false && arithmeticBacks(e) !== false;
}
