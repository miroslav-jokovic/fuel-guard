import {
  classifyLineLoadState,
  isVehiclePackaging,
  packageTypeFromPrinted,
  readersAgree,
  rowWitnessesBack,
  shippingDocumentSchema,
  valueAtPath,
  type FieldEvidence,
  type FieldStatus,
  type HazmatProduct,
  type PrintedHazmatLine,
  type ReadResponse,
} from "@silvicom/shared";
import { declaresLimitedQuantity } from "@hazmat/engine";
import { emptyLine, type CalcLineForm } from "../calcModel";
import { noHazmatEvidence, type NoHazmatEvidence } from "./bolNoHazmat";
import { changedFrom, fieldPending, readingChoices, type Acted } from "./bolReview";

/**
 * A finished BOL read → the Placard calculator's lines, each field with the state the dispatcher sees
 * (DOCUMENT-READER-PLAN §7A N6, Step 3.3; D-DR4). This is the consumer adapter `fieldEvidenceContract.ts`
 * names: the reading module says what each witness read; this decides what the form shows.
 *
 * What it never does, each for a reason the plan or the hazmat plan already gives:
 *   - It never picks a product. A line's product is the one the Hazardous Materials Table itself named for
 *     what was printed (`hmtWitness.ts`, the extractor's locked `resolveHmtLine`), looked up by that exact
 *     `hmtRef` — no search, no nearest match (H6). A line the table refused, or whose ref the calculator's
 *     dataset does not hold, comes in with no product and the reason, so Calculate cannot use it unseen.
 *   - It never makes a field *Read*. The state is the evidence's `status` (D-DR17: only independent
 *     agreement under the acceptance rule may say *Read*; today nothing does until graduation, D-DR5).
 *     `agree` and `rowBacked` say what the witnesses found, so a person can tell "both readers say 6, and
 *     the OCR found 6 on that row" from "the readers say 6 and 9".
 *   - It never sets the §173.150(f) combustible election. The paper saying "Combustible liquid" is the
 *     offeror's statement, and the calculator leaves the election to a person (D1), as the extractor does
 *     (`mapBolLines.ts`); the line says so in a note instead.
 *   - It sets Limited Quantity only when BOTH readers read the notation, as the extractor requires
 *     (`extract.ts`): a wrong LQ is the one reading error that could UNDER-placard. The engine still checks
 *     the claim against HMT column 8A and the 66-lb cap.
 *   - It fills nothing the form does not show. The calculator no longer asks a line's net quantity (its
 *     header: the placard ladder runs on gross pounds, and the field double-asked the packaging), so a read
 *     quantity would reach the engine as a value nobody could see or correct; the line keeps the blank,
 *     unknown quantity the manual form sends.
 *
 * Template lines a shipper pre-prints with no count, weight or quantity (`classifyLineLoadState`) are left
 * out and listed, as the extractor treats them; a person adds one back if it is aboard.
 */

/** The calculator fields a read can fill. */
export type PrefillKey = "product" | "packageType" | "packageCount" | "grossWeight" | "limitedQuantity";

export interface PrefillField {
  /** The acceptance rule's verdict (`FieldEvidence.status`); `check` when the read recorded no evidence. */
  state: FieldStatus;
  /** Both model readers read the same value (true), different values (false), or only one read it (null). */
  agree: boolean | null;
  /** Where the readers disagree: what each read, pass A first, one pair per disagreeing path. */
  readings: [unknown, unknown][];
  /** The OCR engine found this value on the line's own printed row (true), judged the row and did not (false), or did not judge (null). */
  rowBacked: boolean | null;
  /** Why the field is blank or needs a person, in words for the screen; null when there is nothing to say. */
  reason: string | null;
  /** The evidence paths behind the field — what a Calculate press confirms or corrects (plan §6). */
  paths: string[];
}

export interface PrefillLine {
  /** The line's index in the read (`hazmat.lines[n]`). */
  index: number;
  /** The description as printed, for the person checking it against the page. */
  printed: string;
  form: CalcLineForm;
  fields: Record<PrefillKey, PrefillField>;
  /** Things a person must decide that the form cannot hold (the combustible election, a line one reader missed). */
  notes: string[];
}

export interface BolPrefill {
  lines: PrefillLine[];
  /** Printed lines with no count, weight or quantity: left out, listed so a person can add one back. */
  notLoaded: string[];
  /** "yes" when the paper lists non-hazardous freight too (§172.201(a)(1)); otherwise "" — not sure, never "no". */
  otherFreight: "" | "yes";
  /**
   * Neither reader read a hazmat line on the paper — not pass A, and not a line only pass B saw. The paper is
   * then not a hazmat shipping paper as far as the read can tell, and the screen says so instead of filling
   * nothing in silence. The owner's first production read (2026-10-13) was a produce BOL; the screen showed
   * "Every check passed" — the paper audit's hazmat rules passing over zero lines — and no products, so it
   * read as a hazmat BOL that had somehow failed to fill.
   */
  noHazmat: boolean;
  /**
   * Whether the second reader's document is in the evidence. Without it "no hazmat line" is one model's word
   * (pass B refused or failed, executeRead.ts), and the screen must not say both readers looked.
   */
  bothReaders: boolean;
  /** When `noHazmat`, what backs it beyond the readers and what does not (bolNoHazmat.ts); otherwise null. */
  noHazmatEvidence: NoHazmatEvidence | null;
  /** The non-hazardous lines the paper prints, as read, for the no-hazmat sentence. */
  otherLines: string[];
}

const LINE_PATH_RX = /^hazmat\.lines\[(\d+)\]\./;

/** The table's verdict, as `shippingEvidence.ts` records it on a line's judged fields. */
type TableVerdict = { consistent: true; hmtRef: string } | { consistent: false; reason: string };

/**
 * The words for `resolveHmtLine`'s refusal reasons (`ResolveLineFailureReason`, @hazmat/data — which the
 * web cannot import, hence the plain record). A reason added there and not here is shown as its code.
 */
const TABLE_REASONS: Record<string, string> = {
  id_missing: "No UN/NA number was read on this line.",
  id_prefix_ambiguous: "The number has no UN or NA in front, and both exist for different materials.",
  id_not_found: "The UN/NA number is not in the Hazardous Materials Table.",
  psn_no_match: "The shipping name does not match this UN/NA number.",
  psn_ambiguous: "More than one table entry fits this number and name.",
  pg_required_ambiguous: "This entry has more than one packing group and the paper's does not pick one.",
  class_mismatch: "The hazard class does not belong to this UN/NA number.",
};

/** The `hmtRef` the table named for each line — what the calculator asks `GET /hazmat/products?refs=` for. */
export function hmtRefsOf(read: ReadResponse): string[] {
  const refs = read.evidence.flatMap((e) => {
    const v = tableVerdictOf(e);
    return v?.consistent ? [v.hmtRef] : [];
  });
  return [...new Set(refs)];
}

function tableVerdictOf(e: FieldEvidence | undefined): TableVerdict | null {
  const v = e?.sources.find((s) => s.reader === "table")?.value as TableVerdict | null | undefined;
  return v && typeof v === "object" && "consistent" in v ? v : null;
}

/** Null when the read is not finished or its document does not parse — the caller shows the read failed. */
export function bolPrefill(read: ReadResponse, products: readonly HazmatProduct[], equipmentType: string): BolPrefill | null {
  if (read.status !== "done") return null;
  const parsed = shippingDocumentSchema.safeParse(read.result);
  if (!parsed.success) return null;
  const doc = parsed.data;
  const byPath = new Map(read.evidence.map((e) => [e.path, e]));
  const byRef = new Map(products.map((p) => [p.hmtRef, p]));

  // Pass A's lines, then any only pass B saw (shippingEvidence.ts puts them after A's last).
  const evidenceLines = read.evidence.map((e) => LINE_PATH_RX.exec(e.path)).filter((m) => m !== null).map((m) => Number(m[1]));
  const count = Math.max(doc.hazmat.lines.length, ...evidenceLines.map((i) => i + 1));

  const lines: PrefillLine[] = [];
  const notLoaded: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = <K extends keyof PrintedHazmatLine>(key: K): PrintedHazmatLine[K] => {
      const path = `hazmat.lines[${i}].${key}`;
      const e = byPath.get(path);
      return (e ? e.value : valueAtPath(doc, path)) as PrintedHazmatLine[K];
    };
    const line = {
      idText: at("idText"), psn: at("psn"), hazardClass: at("hazardClass"), pg: at("pg"), descriptionText: at("descriptionText"),
      quantity: { value: valueOf(byPath, doc, `hazmat.lines[${i}].quantity.value`) as number | null, unit: valueOf(byPath, doc, `hazmat.lines[${i}].quantity.unit`) as string | null },
      packageCount: at("packageCount"), grossWeightLb: at("grossWeightLb"), packaging: at("packaging"), marks: at("marks") ?? [],
    };
    const printed = line.descriptionText ?? [line.idText, line.psn, line.hazardClass, line.pg].filter(Boolean).join(", ");
    if (classifyLineLoadState(line) === "preprinted_not_loaded") {
      notLoaded.push(printed);
      continue;
    }
    lines.push(prefillLine(i, line, printed, byPath, byRef, equipmentType, i >= doc.hazmat.lines.length));
  }

  const other = byPath.get("otherLines")?.value ?? doc.otherLines;
  const otherLines = Array.isArray(other) ? other.filter((l): l is string => typeof l === "string") : [];
  const bothReaders = read.evidence.some((e) => e.sources.some((s) => s.reader === "passB"));
  return { lines, notLoaded, otherFreight: otherLines.length > 0 ? "yes" : "", noHazmat: count === 0, bothReaders,
    noHazmatEvidence: count === 0 ? noHazmatEvidence(read) : null, otherLines };
}

function valueOf(byPath: Map<string, FieldEvidence>, doc: unknown, path: string): unknown {
  const e = byPath.get(path);
  return e ? e.value : valueAtPath(doc, path) ?? null;
}

type ReadLine = Pick<PrintedHazmatLine, "idText" | "psn" | "hazardClass" | "pg" | "quantity" | "packageCount" | "grossWeightLb" | "packaging" | "marks">;

function prefillLine(
  i: number, line: ReadLine, printed: string, byPath: Map<string, FieldEvidence>,
  byRef: Map<string, HazmatProduct>, equipmentType: string, onlyPassB: boolean,
): PrefillLine {
  const p = (key: string) => `hazmat.lines[${i}].${key}`;
  const field = (paths: string[], reason: string | null = null): PrefillField => judged(paths.map((x) => byPath.get(x)), paths, reason);
  const form = emptyLine(equipmentType);
  const notes: string[] = [];
  if (onlyPassB) notes.push("Only one of the two readers saw this line. Check it against the page.");

  // Product: the table's own row for what was printed, or nothing.
  const verdict = tableVerdictOf(byPath.get(p("idText")));
  const product = verdict?.consistent ? byRef.get(verdict.hmtRef) ?? null : null;
  form.product = product;
  const productReason = product ? null
    : verdict && !verdict.consistent ? TABLE_REASONS[verdict.reason] ?? verdict.reason
    : verdict?.consistent ? "The calculator's hazmat dataset does not hold this table entry; choose the product."
    : "No UN/NA number was checked against the table; choose the product.";
  if (/combustible/i.test(line.hazardClass ?? "")) {
    notes.push("The paper says Combustible liquid. Tick the §173.150(f) reclassification only if the shipper made that election.");
  }

  // Package type: the shared reading of the printed phrase; an unknown phrase leaves the equipment's default.
  const packageType = packageTypeFromPrinted(line.packaging);
  if (packageType) form.packageType = packageType;
  const packageReason = line.packaging && !packageType ? `"${line.packaging}" is not a package type the calculator knows; choose one.` : null;

  // A tank is the packaging itself: the form hides the count there and the engine never takes one
  // (`buildEngineLine`), so a printed "1 cargo tank" would only sit unseen behind a per-package weight note.
  if (line.packageCount != null && !isVehiclePackaging(form.packageType)) form.packageCount = String(line.packageCount);

  if (line.grossWeightLb != null) {
    form.grossWeightValue = String(line.grossWeightLb);
    form.grossWeightUnit = "lb";
  }

  // Limited Quantity: both readers must have read the notation.
  const lqOf = (reader: "passA" | "passB") => {
    const v = (key: string) => byPath.get(p(key))?.sources.find((s) => s.reader === reader)?.value;
    if (v("marks") === undefined && v("psn") === undefined && v("packaging") === undefined) return null;
    return declaresLimitedQuantity({ marks: (v("marks") as string[] | null) ?? [], psn: (v("psn") as string | null) ?? null, packaging: (v("packaging") as string | null) ?? null });
  };
  const lqA = lqOf("passA");
  const lqB = lqOf("passB");
  form.isLimitedQuantity = lqA === true && lqB === true;
  const lqPaths = [p("marks"), p("psn"), p("packaging")];
  const lq = field(lqPaths, lqA !== lqB && (lqA || lqB) ? "Only one reader read a Limited Quantity notation, so it is not ticked." : null);
  lq.agree = lqA === null || lqB === null ? null : lqA === lqB;

  return {
    index: i,
    printed,
    form,
    notes,
    fields: {
      product: field([p("idText"), p("psn"), p("hazardClass"), p("pg")], productReason),
      packageType: packageTypeField(field([p("packaging")], packageReason), byPath.get(p("packaging"))),
      packageCount: field([p("packageCount")]),
      grossWeight: field([p("grossWeightLb")]),
      limitedQuantity: lq,
    },
  };
}

/**
 * The package type field is the calculator's READING of the printed phrase (`packageTypeFromPrinted`), so the
 * readers agree on it when their phrases read as the same type — "2 DRUM" and "2 Steel Drums" are one drum
 * line. The count inside the phrase is not this field's to judge: `packageCount` is, from its own path, so a
 * count the readers split on is still disputed there. When either phrase reads as no known type, the raw
 * comparison stands (an unknown phrase already carries the reason that asks a person to choose).
 */
function packageTypeField(f: PrefillField, e: FieldEvidence | undefined): PrefillField {
  const of = (r: string) => e?.sources.find((s) => s.reader === r);
  const a = of("passA");
  const b = of("passB");
  if (!a || !b || f.agree !== false) return f;
  const ta = packageTypeFromPrinted(a.value as string | null);
  const tb = packageTypeFromPrinted(b.value as string | null);
  if (!ta || !tb || ta !== tb) return f;
  return { ...f, agree: true, readings: [] };
}

/**
 * One form field from the evidence of the paths behind it. The state is the weakest of theirs, except that
 * a field is *Not read* only when every path behind it is (one legible part makes it something to check).
 * No evidence at all — a read from before the acceptance rule — is *Check*, never *Read*.
 */
function judged(es: (FieldEvidence | undefined)[], paths: string[], reason: string | null): PrefillField {
  const known = es.filter((e): e is FieldEvidence => e !== undefined);
  const legible = known.filter((e) => e.status !== "not_read");
  const state: FieldStatus = known.length === 0 ? "check"
    : legible.length === 0 ? "not_read"
    : legible.every((e) => e.status === "read") ? "read" : "check";
  const agreements = known.map(readersAgree);
  const agree = agreements.includes(false) ? false : agreements.length > 0 && agreements.every((a) => a === true) ? true : null;
  const rows = known.map(rowWitnessesBack).filter((r): r is boolean => r !== null);
  const rowBacked = rows.length === 0 ? null : rows.every(Boolean);
  const readings = known.flatMap((e): [unknown, unknown][] => {
    if (readersAgree(e) !== false) return [];
    const of = (r: string) => e.sources.find((x) => x.reader === r)?.value ?? null;
    return [[of("passA"), of("passB")]];
  });
  return { state, agree, readings, rowBacked, reason, paths };
}

// ── what the form shows under each filled field ───────────────────────────────────────────────────────

export type NoteTone = "neutral" | "warning" | "success";
export interface FieldNote {
  text: string;
  tone: NoteTone;
  /** Calculate waits on a person here (bolReview.ts, D-DR24). */
  pending?: boolean;
  /** The note offers "Matches the page" — not for a line with no product, which needs one chosen. */
  confirmable?: boolean;
  /** The readings a person can pick in one click — a disputed count or weight only. */
  choices?: number[];
}

const shown = (v: unknown): string =>
  v == null || v === "" ? "nothing" : Array.isArray(v) ? (v.length ? v.join(", ") : "nothing") : typeof v === "number" ? v.toLocaleString("en-US") : String(v);

/**
 * One sentence under a filled field: what the witnesses found, in the dispatcher's words. A warning is what
 * a person must look at — the readers disagree, only one read it, or the reason it is blank; the neutral
 * note says where the value came from without asking for anything the panel's callout has not already asked.
 * Once the person changes the value, the reader's account no longer describes it, so the note says so.
 */
export function fieldNote(field: PrefillField, changed: boolean, checked = false): FieldNote {
  if (changed) return { text: "Changed by you.", tone: "neutral" };
  if (checked) return { text: "Checked against the page by you.", tone: "neutral" };
  if (field.reason) return { text: field.reason, tone: "warning" };
  if (field.state === "not_read") return { text: "Not read on the BOL. Enter it if the paper shows it.", tone: "neutral" };
  if (field.agree === false) {
    const pairs = field.readings.map(([a, b]) => `${shown(a)} or ${shown(b)}`).join("; ");
    return { text: `The two readers disagree: ${pairs}. Check the page.`, tone: "warning" };
  }
  if (field.agree === null) return { text: "Only one reader read this. Check it against the page.", tone: "warning" };
  if (field.state === "read") return { text: "Read from the BOL.", tone: "success" };
  return { text: field.rowBacked ? "From the BOL · both readers agree · found on the line's printed row" : "From the BOL · both readers agree", tone: "neutral" };
}

export interface BolLineView {
  printed: string;
  notes: string[];
  fields: Record<PrefillKey, FieldNote>;
}

/**
 * A prefilled line as it stands now: its notes, and each field's note against the value the read put there
 * — with what Calculate still waits on (D-DR24) and, for a disputed count or weight, the readings to pick.
 */
export function bolLineView(prefill: PrefillLine, current: CalcLineForm, acted: Acted = new Map()): BolLineView {
  const fields = Object.fromEntries(
    (Object.keys(prefill.fields) as PrefillKey[]).map((k) => {
      const note = fieldNote(prefill.fields[k], changedFrom(prefill, current, k), acted.get(prefill)?.has(k) ?? false);
      const pending = fieldPending(prefill, current, k, acted);
      const choices = pending ? readingChoices(prefill.fields[k], k) : [];
      const confirmable = pending && !(k === "product" && current.product === null);
      return [k, { ...note, ...(pending ? { pending, confirmable, tone: "warning" as const } : {}), ...(choices.length ? { choices } : {}) }];
    }),
  ) as Record<PrefillKey, FieldNote>;
  return { printed: prefill.printed, notes: prefill.notes, fields };
}
