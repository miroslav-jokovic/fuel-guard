import type { CardEdit } from "./efsCardEcho.js";
import { CARD_COLLECTIONS, type CardCollection, type CardDocument } from "./efsCardXml.js";
import { EfsSoapError } from "./efsSoapSession.js";
import { childElements, collectElements, localName, type XmlElement } from "./efsXml.js";

/**
 * The half of the echo guard that compares the request against the CARD, not against the edit list.
 *
 * ── Why this is a separate check and not more of `assertEchoFidelity` ───────────────────────────
 * `assertEchoFidelity` asks "does the request say what the edit list says?" — expectation from the
 * edits, reality from the request bytes, two routes that cannot collapse into each other. That is a
 * real guard, and it is not the guard we need for `replaceAll`.
 *
 * `replaceAll` is a full-document write: the array in the request IS the collection afterwards. So a
 * record missing from `records` is a record DELETED from the card. But the expectation for that
 * collection is built from `records` too, so an edit list that already lost a record describes a
 * request that faithfully encodes it, and the fidelity check passes. Both sides agree, and both are
 * wrong in the same direction — the failure shape that has now produced four defects in this
 * workstream (see docs/28-EFS-EXECUTION-PLAN.md §8).
 *
 * So this check takes its expectation from the third source neither of those touches: the response
 * DOM. Every record EFS gave us must still be in the request, with at least the fields it arrived
 * with, unless the edit NAMED it in `removals`. Deletion becomes something a caller has to say out
 * loud, which is exactly what the prompt-removal authorisation in controlRefusal.ts already assumes
 * and had no way to enforce.
 *
 * Runs in production on every write, inside the same body callback, on the same bytes.
 */

/**
 * How a record in each collection says which record it is.
 *
 * `locationGroups` and `locations` are absent deliberately: their records are bare text elements with
 * no children, and a scalar record identifies itself by its own text. Any OTHER collection whose
 * records have children and no entry here cannot be checked, and is refused rather than waved
 * through — a new vendor collection must be given an identity before it can be replaced.
 */
const IDENTITY_FIELD: Partial<Record<CardCollection, string>> = {
  infos: "infoId",
  limits: "limitId",
  timeRestrictions: "day",
};

function unverifiable(message: string): EfsSoapError {
  return new EfsSoapError(`Refusing to send a setCard request we cannot verify: ${message}`, "echo_unfaithful");
}

/**
 * Which record this is.
 *
 * Fail-closed at every branch: a record with children but no known identity field, or with the field
 * present but empty, is refused. The alternative — treating it as a record we simply cannot match —
 * resolves toward allowing a silent deletion, and the whole point of this module is that deletion is
 * never a thing that merely happens.
 */
function identityOf(collection: CardCollection, element: XmlElement): string {
  const children = childElements(element);
  if (children.length === 0) return (element.textContent ?? "").trim();

  const field = IDENTITY_FIELD[collection];
  if (!field) {
    throw unverifiable(`<${collection}> records have fields but no declared identity field`);
  }
  const child = children.find((c) => localName(c) === field);
  const value = (child?.textContent ?? "").trim();
  if (!child || value === "") {
    throw unverifiable(`a <${collection}> record has no usable <${field}>`);
  }
  return value;
}

/** Records by identity. A LIST per key, so dropping one of two same-keyed records is still a drop. */
function indexRecords(collection: CardCollection, elements: readonly XmlElement[]): Map<string, XmlElement[]> {
  const index = new Map<string, XmlElement[]>();
  for (const element of elements) {
    const key = identityOf(collection, element);
    const list = index.get(key);
    if (list) list.push(element);
    else index.set(key, [element]);
  }
  return index;
}

const fieldNames = (element: XmlElement): Set<string> => new Set(childElements(element).map(localName));

/**
 * Refuse a request that drops any record, or any field of a record, that the card came with.
 *
 * `card` is the `<card>` element of the request about to be sent, already parsed by the caller.
 * Extra records and extra fields are fine — appending is not a loss. Only disappearance is.
 */
export function assertCollectionsPreserved(doc: CardDocument, card: XmlElement, edits: readonly CardEdit[]): void {
  for (const collection of CARD_COLLECTIONS) {
    // Same resolution the serializer uses: the LAST replace/remove for a collection is the one that
    // decides its contents, so the guard must read the edit list the same way the request did.
    const resolved = [...edits]
      .reverse()
      .find((e) => (e.op === "replaceAll" || e.op === "removeAll") && e.name === collection);

    // `removeAll` is the one edit whose entire purpose is to empty a collection. It is explicit, it is
    // unreachable by accident (see the note on CardEdit), and it is authorised upstream.
    if (resolved?.op === "removeAll") continue;

    const before = indexRecords(collection, collectElements(doc.root, collection));
    if (before.size === 0) continue;

    const after = indexRecords(collection, collectElements(card, collection));
    const removals = new Set(resolved?.op === "replaceAll" ? (resolved.removals ?? []) : []);

    for (const [key, beforeRecords] of before) {
      if (removals.has(key)) continue;

      const afterRecords = after.get(key) ?? [];
      if (afterRecords.length < beforeRecords.length) {
        throw new EfsSoapError(
          `Refusing to send a setCard request that drops <${collection}> record "${key}" — a full-replace `
            + `omission DELETES it. Name it in the edit's removals if that is intended.`,
          "echo_unfaithful",
          { collection, identity: key, before: beforeRecords.length, after: afterRecords.length },
        );
      }

      // Every field the record ARRIVED with has to go back. The guide's rule is that blanking a value
      // is an empty element, never an omission (p137), so a field that vanishes between the response
      // and the request is always a loss and never an intention. This is the Phase 1 reportValue bug:
      // records rebuilt from the typed view kept three fields and silently dropped the rest.
      const expected = new Set<string>();
      for (const record of beforeRecords) for (const name of fieldNames(record)) expected.add(name);

      for (const record of afterRecords) {
        const present = fieldNames(record);
        const missing = [...expected].filter((name) => !present.has(name));
        if (missing.length > 0) {
          throw new EfsSoapError(
            `Refusing to send a setCard request that drops field(s) ${missing.map((m) => `<${m}>`).join(", ")} `
              + `from <${collection}> record "${key}" — an omitted field is a DELETED field.`,
            "echo_unfaithful",
            { collection, identity: key, missing },
          );
        }
      }
    }
  }
}
