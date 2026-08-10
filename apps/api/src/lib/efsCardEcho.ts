import { EfsSoapError } from "./efsSoapSession.js";
import {
  COLLECTION_SET,
  type CanonicalDoc,
  type CardCollection,
  type CardDocument,
  CONTAINER,
  NIL,
  encodeLeaf,
  XSI_NS,
  canonicalize,
  isNil,
  redactCardXml,
} from "./efsCardXml.js";
import { childElements, collectElements, localName, parseXml, type XmlElement } from "./efsXml.js";

/**
 * Building a `setCardV2` request, and refusing to send one that lies about what it changes.
 *
 * Separated from `efsCardXml.ts` along the only boundary that matters here: that file READS a card
 * document, this one WRITES one. Reading is forgiving by nature — an unfamiliar field is just a field.
 * Writing is not: `setCardV2` is a full-document write (guide p137) and a field missing from the
 * request is DELETED, so every line below is about not losing anything on the way out.
 *
 * The request is assembled from the ORIGINAL response nodes, never re-serialized from the typed view.
 * See the head of efsCardXml.ts for why that choice is the whole design.
 */

// ─── The edit algebra ──────────────────────────────────────────────────────────────────────────

/**
 * The ONLY way to change a card document.
 *
 * An edit LIST rather than a mutated object, because the two states EFS distinguishes are
 * "unchanged" and "explicitly emptied", and a mutated object cannot express the difference: an empty
 * `infos: []` might mean "remove every prompt" or "I didn't touch prompts". Here, not touching
 * prompts is the absence of an edit and removing them is `removeAll`, which cannot be reached by
 * accident.
 */
export type CardEdit =
  | { op: "setField"; name: string; value: string }
  | { op: "setFieldNil"; name: string }
  | { op: "removeAll"; name: CardCollection }
  | { op: "replaceAll"; name: CardCollection; records: Record<string, string | null>[] }
  | { op: "appendRecord"; name: CardCollection; record: Record<string, string | null> };

function xmlEscapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Serialize one element and its subtree, preserving nil attributes and document order. */
function serializeElement(element: XmlElement): string {
  const name = localName(element);
  if (isNil(element)) return `<${name} xsi:nil="true"/>`;
  const children = childElements(element);
  if (children.length === 0) return `<${name}>${xmlEscapeText((element.textContent ?? "").trim())}</${name}>`;
  return `<${name}>${children.map(serializeElement).join("")}</${name}>`;
}

function serializeRecord(name: string, record: Record<string, string | null>): string {
  const fields = Object.entries(record)
    .map(([key, value]) => (value === null ? `<${key} xsi:nil="true"/>` : `<${key}>${xmlEscapeText(value)}</${key}>`))
    .join("");
  return `<${name}>${fields}</${name}>`;
}

/** The two edits that address a scalar field rather than a collection. */
type FieldEdit = Extract<CardEdit, { op: "setField" } | { op: "setFieldNil" }>;

export interface SetCardTarget {
  clientId: string;
  cardNumber: string;
}

/**
 * Build a `setCardV2` request body from a parsed response plus a list of edits.
 *
 * Element-by-element from the ORIGINAL nodes: anything not named by an edit is re-emitted exactly as
 * it arrived, including fields this codebase has never heard of.
 *
 * `clientId` and `cardNumber` are prepended because they are setCardV2 INPUTS (p137) and are not part
 * of the getCard response — they are the two fields that legitimately differ between the two documents,
 * which is why the fidelity check below ignores them.
 */
export function serializeSetCardRequest(
  doc: CardDocument,
  target: SetCardTarget,
  edits: readonly CardEdit[],
): { xml: string; redactedXml: string } {
  const fieldEdits = new Map<string, FieldEdit>();
  const collectionEdits = new Map<string, CardEdit[]>();
  for (const edit of edits) {
    if (edit.op === "setField" || edit.op === "setFieldNil") fieldEdits.set(edit.name, edit);
    else {
      const list = collectionEdits.get(edit.name) ?? [];
      list.push(edit);
      collectionEdits.set(edit.name, list);
    }
  }

  const parts: string[] = [];
  const emittedCollections = new Set<string>();
  const emittedFields = new Set<string>();

  for (const child of childElements(doc.root)) {
    const name = localName(child);
    if (COLLECTION_SET.has(name)) {
      if (emittedCollections.has(name)) continue; // the whole collection is emitted at its first member
      emittedCollections.add(name);
      parts.push(renderCollection(doc.root, name as CardCollection, collectionEdits.get(name) ?? []));
      continue;
    }
    const edit = fieldEdits.get(name);
    emittedFields.add(name);
    if (!edit) parts.push(serializeElement(child));
    else if (edit.op === "setFieldNil") parts.push(`<${name} xsi:nil="true"/>`);
    else parts.push(`<${name}>${xmlEscapeText(edit.value)}</${name}>`);
  }

  // A field the response did not carry but an edit names — e.g. setting overrideAllLocations on a card
  // that has never had an override. Appended rather than dropped.
  for (const [name, edit] of fieldEdits) {
    if (emittedFields.has(name)) continue;
    parts.push(edit.op === "setFieldNil" ? `<${name} xsi:nil="true"/>` : `<${name}>${xmlEscapeText(edit.value)}</${name}>`);
  }
  // Likewise a collection being introduced for the first time (an override's limits array, p194).
  for (const [name, list] of collectionEdits) {
    if (emittedCollections.has(name)) continue;
    emittedCollections.add(name);
    parts.push(renderCollection(doc.root, name as CardCollection, list));
  }

  // The xsi declaration is load-bearing, not decoration: the echo re-emits `xsi:nil` attributes for
  // fields EFS sent as nil (originalStatus is "often returned as nil", p35), and an undeclared prefix
  // is not well-formed XML. buildSoapEnvelope declares only `soap`, and adding xsi there would change
  // the two transaction-feed envelopes for no reason, so it is declared here where it is used.
  const body =
    `<CardManagementEP_setCardV2 xmlns:xsi="${XSI_NS}">` +
    `<clientId>${xmlEscapeText(target.clientId)}</clientId>` +
    `<cardNumber>${xmlEscapeText(target.cardNumber)}</cardNumber>` +
    parts.join("") +
    `</CardManagementEP_setCardV2>`;

  return { xml: body, redactedXml: redactCardXml(body) };
}

function renderCollection(root: XmlElement, name: CardCollection, edits: readonly CardEdit[]): string {
  const replace = [...edits].reverse().find((e) => e.op === "replaceAll" || e.op === "removeAll");
  const appends = edits.filter((e): e is Extract<CardEdit, { op: "appendRecord" }> => e.op === "appendRecord");

  let base: string[];
  if (replace?.op === "removeAll") base = [];
  else if (replace?.op === "replaceAll") base = replace.records.map((r) => serializeRecord(name, r));
  else base = collectElements(root, name).map(serializeElement);

  return [...base, ...appends.map((a) => serializeRecord(name, a.record))].join("");
}

// ─── The fidelity guard ────────────────────────────────────────────────────────────────────────

/** Apply an edit list to a canonical response so we know what the request SHOULD contain. */
function expectedCanonical(doc: CardDocument, edits: readonly CardEdit[]): CanonicalDoc {
  const expected: CanonicalDoc = new Map(
    [...canonicalize(doc.root)].map(([path, values]) => [path, [...values]]),
  );
  const dropCollection = (name: string): void => {
    for (const path of [...expected.keys()]) {
      if (path === `/${name}` || path.startsWith(`/${name}/`)) expected.delete(path);
    }
  };
  const addRecord = (name: string, record: Record<string, string | null>): void => {
    const push = (path: string, value: string): void => {
      const existing = expected.get(path);
      if (existing) existing.push(value);
      else expected.set(path, [value]);
    };
    push(`/${name}`, CONTAINER);
    for (const [key, value] of Object.entries(record)) push(`/${name}/${key}`, value === null ? NIL : encodeLeaf(value));
  };

  for (const edit of edits) {
    switch (edit.op) {
      case "setField":
        expected.set(`/${edit.name}`, [encodeLeaf(edit.value)]);
        break;
      case "setFieldNil":
        expected.set(`/${edit.name}`, [NIL]);
        break;
      case "removeAll":
        dropCollection(edit.name);
        break;
      case "replaceAll":
        dropCollection(edit.name);
        for (const record of edit.records) addRecord(edit.name, record);
        break;
      case "appendRecord":
        addRecord(edit.name, edit.record);
        break;
    }
  }
  return expected;
}

export interface EchoDiff {
  path: string;
  expected: string[];
  actual: string[];
}

function diffCanonical(expected: CanonicalDoc, actual: CanonicalDoc): EchoDiff[] {
  const diffs: EchoDiff[] = [];
  for (const path of new Set([...expected.keys(), ...actual.keys()])) {
    const e = expected.get(path) ?? [];
    const a = actual.get(path) ?? [];
    // Order matters within a path: two infos records swapping matchValues is a real change.
    if (e.length !== a.length || e.some((v, i) => v !== a[i])) diffs.push({ path, expected: e, actual: a });
  }
  return diffs.sort((x, y) => (x.path < y.path ? -1 : 1));
}

/** Inputs, not echoed content — legitimately present in the request and absent from the response. */
const REQUEST_ONLY_FIELDS: ReadonlySet<string> = new Set(["clientId", "cardNumber"]);

/**
 * Refuse to send a request that does not say exactly what we intended.
 *
 * Runs in PRODUCTION on every write. The cost is a few microseconds of string work; the thing it
 * prevents is a well-formed request that quietly deletes a fleet's driver assignments, which is the
 * single worst outcome this feature can produce and the one the vendor will accept without complaint.
 *
 * Throws `echo_unfaithful` — a distinct error code precisely because it is OUR bug, not the vendor's,
 * and must never be reported to an operator as an EFS problem.
 */
export function assertEchoFidelity(doc: CardDocument, requestXml: string, edits: readonly CardEdit[]): void {
  const requestRoot = parseXml(`<w xmlns:xsi="${XSI_NS}">${requestXml}</w>`);
  const body = requestRoot ? childElements(requestRoot)[0] : null;
  if (!body) {
    throw new EfsSoapError("Refusing to send a setCard request we cannot re-parse", "echo_unfaithful");
  }
  const actual = canonicalize(body, REQUEST_ONLY_FIELDS);
  const diffs = diffCanonical(expectedCanonical(doc, edits), actual);
  if (diffs.length === 0) return;
  throw new EfsSoapError(
    `Refusing to send a setCard request that does not faithfully echo the card (${diffs.length} field(s) differ: ${diffs.slice(0, 5).map((d) => d.path).join(", ")})`,
    "echo_unfaithful",
    { diffs: diffs.slice(0, 20) },
  );
}
