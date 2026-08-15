import { childElements, localName, parseXml, type XmlElement } from "../../lib/efsXml.js";
import { isNil } from "../../lib/efsCardCanonical.js";

/**
 * What vocabulary does THIS account actually speak?
 *
 * Every capability declares `emittableValues` — the exact strings its writes can put on the wire.
 * Nothing has ever checked those against what the vendor emits, and the gap has already cost this
 * project a production incident: we sent the guide's documented `Hold` (p134) to an account that
 * stores `HOLD`, EFS answered its usual void success, and the write was silently not applied
 * (docs/22 H1). The strings were both "correct"; only one of them was this account's.
 *
 * ── Raw wire text, never `doc.card` ─────────────────────────────────────────────────────────────
 * The typed view is lossy in exactly the places that matter here. `boolOrNull` collapses `false` and
 * `0`; `locationOverride` collapses `"0"` and `"1"` to null; `leafText` collapses `xsi:nil` and an
 * empty element. Every one of those distinctions is the answer to a question this scanner exists to
 * ask, so it walks the DOM and reads element text verbatim — no trim, no case fold, no coercion
 * (standing rule 4: normalisation is a named, tested adapter, and this is not the place for one).
 *
 * ── Three states, and why `unobserved` is not `match` ───────────────────────────────────────────
 * The tempting binary is "does what we send appear in what they send". It is wrong in the direction
 * that costs money: a value we have never seen is not a value we have confirmed. Step 4.6 refuses
 * promotion on `unobserved` precisely so that "no evidence" cannot be spent as "evidence".
 *
 * `mismatch` is narrower and sharper than "different": it means the account emits the SAME value in a
 * DIFFERENT spelling — `HOLD` where we would send `Hold`. That is the H1 incident's exact signature,
 * and it is the one finding here that says "your next write will be silently ignored".
 */

/** One field's raw footprint across the scanned documents. */
export interface FieldObservation {
  field: string;
  documentsScanned: number;
  /** Documents carrying at least one occurrence, in any form — value, nil or empty. */
  documentsWithField: number;
  occurrences: number;
  /** Exact text, in descending frequency. Never trimmed, never case-folded. */
  observedValues: { text: string; count: number }[];
  /** Distinct exact texts — the plan's `rawSpelling`, plural because an account may use several. */
  rawSpellings: string[];
  nilCount: number;
  /** Documents in which the element never appeared at all. */
  absentCount: number;
  presentEmptyCount: number;
  /** Occurrences that carried child ELEMENTS rather than text. A scalar field should never have one. */
  containerCount: number;
}

export type VocabularyState = "match" | "mismatch" | "unobserved";

export interface ExpectedValueVerdict {
  expected: string;
  state: "observed_exact" | "observed_differently_cased" | "unobserved";
  /** The spellings actually seen, when they differ from `expected` by case alone. */
  observedAs?: string[];
}

export interface FieldVerdict {
  capability: string;
  field: string;
  state: VocabularyState;
  values: ExpectedValueVerdict[];
  observation: FieldObservation;
}

/**
 * The only two things the scan reads off a capability.
 *
 * Structural rather than `CapabilityContract<T>`: the scanner has no business knowing a capability's
 * request schema, and taking the full contract drags its zod generic through a module that never
 * parses a body — which then makes the registry's own `CapabilityContract<ZodTypeAny>` fail to
 * assign for reasons that have nothing to do with vocabulary.
 */
export interface VocabularySource {
  vocabularyFields: readonly string[];
  emittableValues: Readonly<Record<string, readonly string[]>>;
  casingAdaptiveFields?: readonly string[];
}

export interface ConfigScanReport {
  documentsScanned: number;
  documentsUnparseable: number;
  fields: FieldObservation[];
  verdicts: FieldVerdict[];
  summary: Record<VocabularyState, number>;
}

/**
 * Every descendant with this local name, at any depth.
 *
 * `collectElements` is direct-children only and `findDescendant` stops at the first hit; neither can
 * answer "every `validationType` in the document", and a prompt's `validationType` lives two levels
 * down inside `<infos>`. Written here rather than added to `efsXml.ts` because nothing else needs it
 * — a fourth traversal helper on the shared module earns its place when a second caller appears.
 */
function collectDescendants(root: XmlElement, wanted: string): XmlElement[] {
  const found: XmlElement[] = [];
  const walk = (element: XmlElement): void => {
    for (const child of childElements(element)) {
      if (localName(child) === wanted) found.push(child);
      walk(child);
    }
  };
  walk(root);
  return found;
}

/** Verbatim text of a leaf. `textContent` is fine here because containers are counted separately. */
const leafTextExactly = (element: XmlElement): string => element.textContent ?? "";

/**
 * One field, across every document, with the distinctions the typed view destroys kept intact.
 *
 * `absentCount` counts DOCUMENTS, not occurrences — "this account never sends the field" is a
 * different fact from "this record left it empty", and only the first says the field is unreadable
 * here. Both block promotion; they do not have the same remedy.
 */
export function observeField(documents: readonly XmlElement[], field: string): FieldObservation {
  const counts = new Map<string, number>();
  let occurrences = 0;
  let nilCount = 0;
  let presentEmptyCount = 0;
  let containerCount = 0;
  let documentsWithField = 0;

  for (const doc of documents) {
    const elements = collectDescendants(doc, field);
    if (elements.length > 0) documentsWithField += 1;
    for (const element of elements) {
      occurrences += 1;
      // Order matters: a nil element may also be empty, and recording it as empty would lose the one
      // distinction `parseCardDocument` is documented as collapsing.
      if (isNil(element)) { nilCount += 1; continue; }
      if (childElements(element).length > 0) { containerCount += 1; continue; }
      const text = leafTextExactly(element);
      if (text === "") { presentEmptyCount += 1; continue; }
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
  }

  const observedValues = [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));

  return {
    field,
    documentsScanned: documents.length,
    documentsWithField,
    occurrences,
    observedValues,
    rawSpellings: observedValues.map((v) => v.text),
    nilCount,
    absentCount: documents.length - documentsWithField,
    presentEmptyCount,
    containerCount,
  };
}

/**
 * Judge one expected value against what the account emits.
 *
 * Exact first, then case-insensitive. The middle state is the whole point: a value that appears only
 * in another casing is not absent and is not a match — it is the account telling us our spelling is
 * wrong, which is the difference between a write that applies and a void success that does nothing.
 */
function judgeValue(expected: string, observation: FieldObservation): ExpectedValueVerdict {
  if (observation.rawSpellings.includes(expected)) {
    return { expected, state: "observed_exact" };
  }
  const differentlyCased = observation.rawSpellings.filter(
    (seen) => seen.toLowerCase() === expected.toLowerCase(),
  );
  if (differentlyCased.length > 0) {
    return { expected, state: "observed_differently_cased", observedAs: differentlyCased };
  }
  return { expected, state: "unobserved" };
}

/**
 * The field's verdict, and the precedence is deliberate.
 *
 * `mismatch` outranks `unobserved` because it is actionable and dangerous: one expected value proven
 * mis-spelled means the next write of that value is silently dropped, whatever the other values did.
 * `unobserved` outranks `match` for the reason this scanner exists — a value we have never seen is
 * not a value we have confirmed, and `match` is what Step 4.6 will let through.
 */
export function judgeField(
  capability: string,
  field: string,
  expected: readonly string[],
  observation: FieldObservation,
  /**
   * The capability spells this field from the account's own fresh read at write time, so a case-only
   * difference is a handled adaptation rather than a write about to be dropped. Declared per field on
   * the contract (`casingAdaptiveFields`), never inferred — standing rule 4.
   */
  casingAdaptive = false,
): FieldVerdict {
  const values = expected.map((value) => judgeValue(value, observation));
  // The per-value verdict still SAYS `observed_differently_cased`; nothing is hidden. Only the
  // field-level judgement changes, because only the field-level judgement is a claim about what
  // happens next — and for an adapted field, what happens next is that the write lands.
  const misspelled = values.some((v) => v.state === "observed_differently_cased") && !casingAdaptive;
  const state: VocabularyState =
    misspelled ? "mismatch"
      : values.some((v) => v.state === "unobserved") ? "unobserved"
        : "match";
  return { capability, field, state, values, observation };
}

/**
 * Scan a set of raw `getCardv2` responses against every capability's declared vocabulary.
 *
 * Documents arrive as XML STRINGS — the redacted responses the mirror already stores, or fresh
 * reads — because the whole point is to look at bytes the vendor sent rather than at anything this
 * codebase inferred from them. An unparseable document is counted, never skipped silently: a scan
 * that quietly read 40 of 234 cards would report `unobserved` for reasons that have nothing to do
 * with the account.
 */
export function scanConfig(
  rawDocuments: readonly string[],
  contracts: Readonly<Record<string, VocabularySource>>,
): ConfigScanReport {
  const parsed: XmlElement[] = [];
  let documentsUnparseable = 0;
  for (const xml of rawDocuments) {
    // `parseXml` THROWS on malformed input — it does not return null, whatever its signature
    // suggests (`@xmldom/xmldom` raises ParseError for a missing root or an undeclared prefix).
    // Caught per document on purpose: one unreadable row out of 234 must cost that row, not the
    // scan. Found by the test below, which asserted the count and got a stack trace.
    try {
      const root = parseXml(xml);
      if (root) parsed.push(root);
      else documentsUnparseable += 1;
    } catch {
      documentsUnparseable += 1;
    }
  }

  // One observation per distinct field, shared by every capability that names it — `status` is
  // claimed by both card_lock and card_unlock, and scanning it twice invites two answers.
  const fields = [
    ...new Set(Object.values(contracts).flatMap((c) => c.vocabularyFields)),
  ].sort();
  const observations = new Map(fields.map((f) => [f, observeField(parsed, f)]));

  const verdicts: FieldVerdict[] = [];
  for (const [key, contract] of Object.entries(contracts)) {
    for (const field of contract.vocabularyFields) {
      const observation = observations.get(field);
      // Unreachable while `fields` is derived from these same contracts; thrown rather than skipped
      // so a future refactor that decouples them fails loudly instead of dropping a field's verdict.
      if (!observation) throw new Error(`config scan: no observation for ${key}.${field}`);
      verdicts.push(judgeField(
        key, field, contract.emittableValues[field] ?? [], observation,
        contract.casingAdaptiveFields?.includes(field) ?? false,
      ));
    }
  }

  const summary: Record<VocabularyState, number> = { match: 0, mismatch: 0, unobserved: 0 };
  for (const verdict of verdicts) summary[verdict.state] += 1;

  return {
    documentsScanned: parsed.length,
    documentsUnparseable,
    fields: [...observations.values()],
    verdicts,
    summary,
  };
}
