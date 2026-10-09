import { z } from "zod";
import { alignHazmatLines, valuesEqual } from "./documentFieldMatch.js";
import {
  DOCUMENT_PROFILES,
  PAGE_QUALITY_BANDS,
  shippingDocumentLabelsSchema,
  type PageQualityBand,
  type ShippingDocumentLabels,
} from "./documentReadingContract.js";
import { fieldEvidenceSchema, leafFieldPaths, valueAtPath, type FieldStatus } from "./fieldEvidenceContract.js";
import {
  GRADUATION_MIN_CONFIRMATIONS,
  printedHazmatLineSchema,
  shippingDocumentSchema,
  type FieldCriticality,
  type ShippingDocument,
} from "./shippingDocumentContract.js";

/**
 * `doc:score`'s arithmetic (DOCUMENT-READER-PLAN.md Step 0.4, §8): the four numbers — field accuracy,
 * false-accept rate, yield, cost per page — per FIELD and per quality BAND, with the count of documents
 * and fields beside every one, plus D-DR5's graduation bar per field. Pure: the script reads the files,
 * this decides. Value equality and line alignment are `documentFieldMatch.ts`'s, defined once.
 *
 * The definitions, which every number in a PR body's §8 table means:
 *   - a FIELD INSTANCE is one leaf of one document (`identity.bolNumber`), or one leaf of one hazmat line
 *     (`hazmat.lines[].psn`, indexes collapsed — lines are matched by key, not index);
 *   - accuracy       = instances whose read value equals the label / instances;
 *   - false-accept   = instances with status `read` AND a wrong value / instances with status `read`.
 *                      THE number: a `read` value is one no dispatcher is asked to look at (D-DR4/D-DR5);
 *   - yield          = instances with status `read` / instances;
 *   - cost per page  = the reader's USD / the pages of the documents it read (bands and overall only).
 * A field the reader gave no evidence for counts as not read. A labelled line no read line matched
 * (`missed`) contributes every one of its leaves as a wrong, unread instance; a read line no labelled
 * line matched (`extra`) contributes every one of its leaves as a wrong instance under the status the
 * reader gave it — so an extra line's `read` field is a false accept, which is what it would be on a form.
 */

export const readerCostSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  usd: z.number().min(0),
});
/** One reader's output for one corpus document — what `runs/<name>.json` holds. */
export const readerOutputSchema = z.object({
  document: shippingDocumentSchema,
  evidence: z.array(fieldEvidenceSchema),
  cost: readerCostSchema,
});
export type ReaderOutput = z.infer<typeof readerOutputSchema>;

/** One corpus document as the scorer receives it: raw JSON, validated here so one bad file is a line in
 * the report rather than a crashed run. `output` undefined = this run has no output for the document. */
export interface CorpusEntry {
  id: string;
  labels: unknown;
  output: unknown;
}

export type ScoreBand = PageQualityBand | "unbanded";
export const SCORE_BANDS: readonly ScoreBand[] = [...PAGE_QUALITY_BANDS, "unbanded"];

interface Counts {
  documents: number;
  fields: number;
  correct: number;
  read: number;
  falseAccepts: number;
  /** Instances whose label carries a value (not null, not an empty list) — how much of `accuracy` is
   * agreement on blanks. */
  labelPresent: number;
}
interface Rates {
  accuracy: number | null;
  falseAcceptRate: number | null;
  yield: number | null;
}
export interface FieldScore extends Counts, Rates {
  field: string;
  criticality: FieldCriticality;
  graduation: {
    /** D-DR5's N: `read` values that were right. */
    correctReads: number;
    /** Rule of three, 3/N — only meaningful with zero false accepts, so null otherwise or when N = 0. */
    upperBound95: number | null;
    required: number;
    /** The ceiling `required` buys: 3/600 = 0.5 % for engine inputs, 3/300 = 1 % otherwise. */
    ceiling: number;
    graduates: boolean;
  };
}
export interface BandScore extends Counts, Rates {
  band: ScoreBand | "all";
  pages: number;
  usd: number;
  costPerPage: number | null;
}
export interface CorpusScore {
  documents: {
    total: number;
    scored: number;
    skippedUnlabelled: number;
    invalidLabels: string[];
    missingOutputs: string[];
    invalidOutputs: string[];
  };
  lines: { labelled: number; matched: number; missed: number; extra: number };
  fields: FieldScore[];
  bands: BandScore[];
}

interface Instance {
  key: string;
  criticality: FieldCriticality;
  correct: boolean;
  status: FieldStatus | null;
  labelPresent: boolean;
}

interface ScoredDoc {
  id: string;
  labels: ShippingDocumentLabels;
  label: ShippingDocument;
  output: ReaderOutput;
}

const profile = DOCUMENT_PROFILES.shipping_document;
const LINE_LEAVES = leafFieldPaths(printedHazmatLineSchema.parse({}));
const isPresent = (v: unknown) => v != null && !(Array.isArray(v) && v.length === 0);
const ratio = (n: number, d: number) => (d ? n / d : null);

/**
 * A document's band is its WORST labelled page among the pages the profile reads (`bol`,
 * `delivery_copy`): a clean BOL page cannot lift a document whose delivery copy is a night shot, and a
 * cargo photo's quality says nothing about the paper. No banded page read by the profile → `unbanded`.
 */
export function documentBand(labels: ShippingDocumentLabels): ScoreBand {
  const reads = profile.readsPageClasses as readonly (string | null)[];
  const ranks = labels.pages
    .filter((p) => reads.includes(p.class) && p.band != null)
    .map((p) => PAGE_QUALITY_BANDS.indexOf(p.band!));
  return ranks.length ? PAGE_QUALITY_BANDS[Math.max(...ranks)]! : "unbanded";
}

const withoutLines = (d: ShippingDocument): ShippingDocument => ({ ...d, hazmat: { ...d.hazmat, lines: [] } });

/**
 * The document-level field set, DERIVED: every leaf of every label and every read in the run, minus the
 * hazmat lines (scored by alignment) and minus any path that is a leaf in one document but a parent in
 * another — a null `parties.shipper` in one label and a filled one in the next both score as
 * `parties.shipper.name` / `.address`, so a field's row is the same field in every document.
 */
export function documentFieldPaths(docs: readonly ShippingDocument[]): string[] {
  const all = new Set(docs.flatMap((d) => leafFieldPaths(withoutLines(d))).filter((p) => !p.startsWith("hazmat.lines")));
  const isParent = (p: string) => [...all].some((q) => q.startsWith(`${p}.`) || q.startsWith(`${p}[`));
  return [...all].filter((p) => !isParent(p)).sort();
}

function documentInstances(doc: ScoredDoc, paths: readonly string[]): Instance[] {
  const evidence = new Map(doc.output.evidence.map((e) => [e.path, e] as const));
  const out: Instance[] = paths.map((path) => {
    // `undefined` here only means a null parent (`parties.shipper` is null): the paper has no value.
    const want = valueAtPath(doc.label, path) ?? null;
    const got = valueAtPath(doc.output.document, path) ?? null;
    return {
      key: path,
      criticality: profile.criticality(path),
      correct: valuesEqual(want, got),
      status: evidence.get(path)?.status ?? null,
      labelPresent: isPresent(want),
    };
  });
  const labelLines = doc.label.hazmat.lines;
  const readLines = doc.output.document.hazmat.lines;
  const { pairs, missed, extra } = alignHazmatLines(labelLines, readLines);
  const line = (li: number | null, ri: number | null): Instance[] =>
    LINE_LEAVES.map((leaf) => {
      const want = li == null ? undefined : valueAtPath(labelLines[li], leaf);
      const got = ri == null ? undefined : valueAtPath(readLines[ri], leaf);
      return {
        key: `hazmat.lines[].${leaf}`,
        criticality: profile.criticality(`hazmat.lines[0].${leaf}`),
        correct: li != null && ri != null && valuesEqual(want, got),
        status: ri == null ? null : (evidence.get(`hazmat.lines[${ri}].${leaf}`)?.status ?? null),
        labelPresent: isPresent(want),
      };
    });
  for (const p of pairs) out.push(...line(p.label, p.read));
  for (const li of missed) out.push(...line(li, null));
  for (const ri of extra) out.push(...line(null, ri));
  return out;
}

class Tally {
  docs = new Set<string>();
  c: Omit<Counts, "documents"> = { fields: 0, correct: 0, read: 0, falseAccepts: 0, labelPresent: 0 };
  add(docId: string, i: Instance): void {
    this.docs.add(docId);
    this.c.fields += 1;
    if (i.correct) this.c.correct += 1;
    if (i.labelPresent) this.c.labelPresent += 1;
    if (i.status === "read") {
      this.c.read += 1;
      if (!i.correct) this.c.falseAccepts += 1;
    }
  }
  result(): Counts & Rates {
    const { fields, correct, read, falseAccepts } = this.c;
    return {
      documents: this.docs.size,
      ...this.c,
      accuracy: ratio(correct, fields),
      falseAcceptRate: ratio(falseAccepts, read),
      yield: ratio(read, fields),
    };
  }
}

function fieldScore(field: string, criticality: FieldCriticality, t: Tally): FieldScore {
  const r = t.result();
  const correctReads = r.read - r.falseAccepts;
  const required = GRADUATION_MIN_CONFIRMATIONS[criticality];
  return {
    field,
    criticality,
    ...r,
    graduation: {
      correctReads,
      upperBound95: r.falseAccepts === 0 && correctReads > 0 ? 3 / correctReads : null,
      required,
      ceiling: 3 / required,
      graduates: r.falseAccepts === 0 && correctReads >= required,
    },
  };
}

type Triage = { scored: ScoredDoc[]; report: CorpusScore["documents"] };

/** Validate every entry; an invalid file is reported by id, never thrown. */
function triage(entries: readonly CorpusEntry[]): Triage {
  const report: CorpusScore["documents"] = {
    total: entries.length, scored: 0, skippedUnlabelled: 0, invalidLabels: [], missingOutputs: [], invalidOutputs: [],
  };
  const scored: ScoredDoc[] = [];
  for (const e of entries) {
    const labels = shippingDocumentLabelsSchema.safeParse(e.labels);
    if (!labels.success) { report.invalidLabels.push(e.id); continue; }
    if (labels.data.labelledBy.length < 1) { report.skippedUnlabelled += 1; continue; }
    if (e.output === undefined) { report.missingOutputs.push(e.id); continue; }
    const output = readerOutputSchema.safeParse(e.output);
    if (!output.success) { report.invalidOutputs.push(e.id); continue; }
    scored.push({ id: e.id, labels: labels.data, label: shippingDocumentSchema.parse(labels.data), output: output.data });
  }
  report.scored = scored.length;
  return { scored, report };
}

/** Score a run over the corpus. Rows come out in a stable order: fields by path, bands good → unbanded. */
export function scoreCorpus(entries: readonly CorpusEntry[]): CorpusScore {
  const { scored, report } = triage(entries);
  const paths = documentFieldPaths(scored.flatMap((d) => [d.label, d.output.document]));
  const byField = new Map<string, { criticality: FieldCriticality; t: Tally }>();
  const byBand = new Map<ScoreBand | "all", { t: Tally; pages: number; usd: number }>();
  const lines = { labelled: 0, matched: 0, missed: 0, extra: 0 };
  for (const doc of scored) {
    const band = documentBand(doc.labels);
    const a = alignHazmatLines(doc.label.hazmat.lines, doc.output.document.hazmat.lines);
    lines.labelled += doc.label.hazmat.lines.length;
    lines.matched += a.pairs.length;
    lines.missed += a.missed.length;
    lines.extra += a.extra.length;
    for (const b of [band, "all"] as const) {
      const slot = byBand.get(b) ?? { t: new Tally(), pages: 0, usd: 0 };
      slot.pages += doc.labels.pages.length;
      slot.usd += doc.output.cost.usd;
      byBand.set(b, slot);
    }
    for (const i of documentInstances(doc, paths)) {
      const f = byField.get(i.key) ?? { criticality: i.criticality, t: new Tally() };
      f.t.add(doc.id, i);
      byField.set(i.key, f);
      byBand.get(band)!.t.add(doc.id, i);
      byBand.get("all")!.t.add(doc.id, i);
    }
  }
  const fields = [...byField].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => fieldScore(k, v.criticality, v.t));
  const bands = ([...SCORE_BANDS, "all"] as const)
    .filter((b) => byBand.has(b))
    .map((b) => {
      const { t, pages, usd } = byBand.get(b)!;
      return { band: b, ...t.result(), pages, usd, costPerPage: ratio(usd, pages) };
    });
  return { documents: report, lines, fields, bands };
}
