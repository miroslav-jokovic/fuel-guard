import { describe, expect, it } from "vitest";
import { loadCitations, loadReferenceText } from "./index.js";
import { normaliseCfrText } from "./citations.js";
import { paragraphAt } from "./citationParagraph.js";
import { parseCitation, referenceForCitation } from "./referenceText.js";

/**
 * The reference-text store answers for every citation the engine emits (TWO-CLICK-READER-PLAN Q-TC6 (a), D-TC10).
 *
 * Until 2026-10-29 the store was the H1 skeleton — version 0.0.0, provisional, no sections — so `GET
 * /api/hazmat/reference/:section`, the D12 promise "show me the rule behind this finding", answered 404 on every
 * input. It is now built from the verified citation list (import/referenceTextBuild.ts), and this holds the two
 * together: every citation's section is in the store, at the list's eCFR date, and the paragraph the citation names
 * says, in the store's own text, every phrase the list says it must.
 */
const store = loadReferenceText();
const list = loadCitations();

describe("the reference-text store against the verified citation list (Q-TC6 (a))", () => {
  it("is a real capture, not the provisional skeleton, read at the citation list's eCFR date", () => {
    expect(store.provisional).toBe(false);
    expect(store.version).toBe(list.ecfrDate);
    expect(Object.keys(store.sections).length).toBeGreaterThan(30);
  });

  it("holds every section a verified citation names, and no section none names", () => {
    const named = new Set(list.citations.map((c) => parseCitation(c.cfr).sectionNumber!));
    expect([...named].filter((s) => !store.sections[s])).toEqual([]);
    expect(Object.keys(store.sections).filter((s) => !named.has(s))).toEqual([]);
  });

  it("shows, for every citation, a paragraph that says every phrase the list says it must", () => {
    const bad: string[] = [];
    for (const c of list.citations) {
      const { sectionNumber, designators } = parseCitation(c.cfr);
      const text = paragraphAt(store.sections[sectionNumber!]?.paragraphs ?? [], designators);
      if (text === null) { bad.push(`${c.cfr}: no paragraph`); continue; }
      const missing = c.mustSay.filter((p) => !normaliseCfrText(text).includes(normaliseCfrText(p)));
      if (missing.length) bad.push(`${c.cfr}: missing ${missing.join(" | ")}`);
    }
    expect(bad).toEqual([]);
  });

  it("resolves every citation through referenceForCitation, the endpoint's own lookup", () => {
    expect(list.citations.filter((c) => referenceForCitation(store, c.cfr) === null).map((c) => c.cfr)).toEqual([]);
  });
});
