import { childElements, localName, type XmlElement } from "./efsXml.js";

/**
 * Reducing an EFS card DOM to something two documents can be compared by.
 *
 * Split from `efsCardXml.ts` at the 500-line budget, along the boundary the design already draws:
 * that file knows what a CARD is — which fields are volatile, which are identity, what a header is.
 * This one knows nothing about cards at all. It turns an element into `path → values`, and decides
 * when two of those are the same document.
 *
 * `efsCardXml.ts` stays the canonical home for the vocabulary and re-exports everything here, so no
 * call site had to move — the same arrangement as the soapClient/efsTls split.
 */

export const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
/**
 * Canonical leaf encoding. Real values are prefixed `v`, an xsi:nil leaf is the bare `n`, and a
 * container is the bare `c`. The prefixes exist so no real value can ever collide with a sentinel:
 * a field whose literal text is "n" encodes as "vn", not as nil.
 */
export const NIL = "n";
export const CONTAINER = "c";
export const encodeLeaf = (text: string): string => `v${text}`;


/**
 * Accepts BOTH spellings of the nil attribute. The guide's own getCardv2 example writes
 * `<originalStatus xsi:nil="1" .../>` (p38) while the XML Schema canonical form is `"true"` — and the
 * two must be treated identically, because a nil read as a real value comes back as the literal
 * string "1", and a nil echoed as an empty element is a DIFFERENT document from the one we received.
 */
export function isNil(element: XmlElement): boolean {
  const attr = element.getAttribute("xsi:nil") ?? element.getAttribute("nil");
  return attr === "true" || attr === "1";
}


/**
 * A document reduced to `path → leaf values`. Whitespace, attribute order and element formatting all
 * normalise away; `xsi:nil` is a distinct sentinel so a nil field can never compare equal to an empty
 * one; and REPEATED elements are ordered by their own content rather than by document order.
 *
 * This is the representation both the version hash and the fidelity guard are built on, which is what
 * makes them agree with each other by construction.
 *
 * ── Why repeated elements are sorted, and why that is not a shortcut ─────────────────────────────
 *
 * `getCardv2` does not return `<infos>` in a stable order. Two reads of the same QA card, seconds
 * apart with no write between them, came back byte-identical except for the prompts:
 *
 *     read 1:  UNIT, DRID, NAME
 *     read 2:  NAME, UNIT, DRID
 *
 * Same three records, same values, same `lastTransaction`. Under document-order canonicalisation
 * those are two different documents, so `cardVersion` moved on its own. That is not an academic
 * problem:
 *
 *   • The write probe's step 6 — "a no-op echo must leave cardVersion identical" — became a coin
 *     toss. It reported THE GATE FAILED on a run where our echo was perfect, and passed on the next
 *     one, for no reason but the order EFS chose that second.
 *   • `cardVersion` is the optimistic-concurrency token for every real mutation. A dispatcher who
 *     opened the drawer and pressed Lock would have been told "this card changed in EFS, review and
 *     try again" at random, on a card nobody had touched.
 *   • `intentLanded` and `classifyDrift` would have reported phantom drift on every write.
 *
 * Sorting by rendered content loses nothing. Order is not semantic here — a prompt is identified by
 * its `infoId`, a limit by its `limitId`, a location group by its id — and the vendor demonstrably
 * does not preserve it. Records are compared whole, so two prompts swapping their `matchValue`s
 * still produce two different records and are still caught; only the sequence they arrived in stops
 * counting as information, which it never was.
 */
export type CanonicalDoc = Map<string, string[]>;

export function canonicalize(root: XmlElement, exclude: ReadonlySet<string> = new Set()): CanonicalDoc {
  const out: CanonicalDoc = new Map();
  const push = (path: string, value: string): void => {
    const existing = out.get(path);
    if (existing) existing.push(value);
    else out.set(path, [value]);
  };

  /** One element's contribution: a leaf value, or a container marker plus its subtree. */
  const emit = (child: XmlElement, path: string, sink: (p: string, v: string) => void): void => {
    const grandchildren = childElements(child);
    if (grandchildren.length === 0) {
      sink(path, isNil(child) ? NIL : encodeLeaf((child.textContent ?? "").trim()));
    } else {
      // Mark the container itself so an emptied collection is distinguishable from an absent one.
      sink(path, CONTAINER);
      walk(child, path, sink);
    }
  };

  /** Render ONE repeated element on its own, so a group can be ordered by content. */
  const renderOne = (child: XmlElement, path: string): string => {
    const one: CanonicalDoc = new Map();
    emit(child, path, (p, v) => {
      const existing = one.get(p);
      if (existing) existing.push(v);
      else one.set(p, [v]);
    });
    return canonicalString(one);
  };

  const walk = (element: XmlElement, prefix: string, sink: (p: string, v: string) => void): void => {
    // Group siblings by name first. Names keep their document order — a card's `<header>` before its
    // `<infos>` is structure, not data — but MEMBERS of a repeated group are sorted by content.
    const groups = new Map<string, XmlElement[]>();
    for (const child of childElements(element)) {
      const name = localName(child);
      if (exclude.has(name)) continue;
      const existing = groups.get(name);
      if (existing) existing.push(child);
      else groups.set(name, [child]);
    }
    for (const [name, members] of groups) {
      const path = `${prefix}/${name}`;
      const ordered =
        members.length > 1
          ? [...members]
              .map((el) => ({ el, key: renderOne(el, path) }))
              .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
              .map((entry) => entry.el)
          : members;
      for (const child of ordered) emit(child, path, sink);
    }
  };
  walk(root, "", push);
  return out;
}


export function canonicalString(doc: CanonicalDoc): string {
  return [...doc.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, values]) => `${path}=${values.join("")}`)
    .join("");
}

export interface EchoDiff {
  path: string;
  expected: string[];
  actual: string[];
}

/**
 * Where two canonical documents disagree.
 *
 * Order WITHIN a path matters — two infos records swapping matchValues is a real change — but order
 * BETWEEN paths does not, because a path is keyed by name. That is deliberate and it is also the
 * blind spot `elementOrder` exists to cover: this function cannot see that `<limits>` came before
 * `<infos>`, because both are present with the same contents either way.
 */
export function diffCanonical(expected: CanonicalDoc, actual: CanonicalDoc): EchoDiff[] {
  const diffs: EchoDiff[] = [];
  for (const path of new Set([...expected.keys(), ...actual.keys()])) {
    const e = expected.get(path) ?? [];
    const a = actual.get(path) ?? [];
    if (e.length !== a.length || e.some((v, i) => v !== a[i])) diffs.push({ path, expected: e, actual: a });
  }
  return diffs.sort((x, y) => (x.path < y.path ? -1 : 1));
}

/**
 * The names of a card element's children, in document order, first occurrence only.
 *
 * Deduplicated because a collection is many sibling elements and its POSITION is one fact, not five.
 * This is the one thing `canonicalize` deliberately throws away, so it is computed separately rather
 * than folded in — the canonical form's order-insensitivity is what makes the version hash stable
 * against EFS reordering `<infos>` between reads, and that must not change.
 */
export function elementOrder(root: XmlElement, exclude: ReadonlySet<string> = new Set()): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const child of childElements(root)) {
    const name = localName(child);
    if (exclude.has(name) || seen.has(name)) continue;
    seen.add(name);
    order.push(name);
  }
  return order;
}

