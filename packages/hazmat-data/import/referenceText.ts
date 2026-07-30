/**
 * CFR reference-text extractor (Phase H1, D12) — XML → readable, citation-keyed paragraphs.
 *
 * Deliberately TOLERANT rather than DTD-exact. The eCFR versioner "full" XML and the GovInfo content
 * XML describe a section with different element names (DIV8/HEAD/P vs SECTION/SECTNO/SUBJECT/P), and
 * this text is for HUMAN DISPLAY + AUDIT only (D12) — it never feeds the engine, so a minor
 * formatting imperfection is cosmetic, not a wrong verdict. So the extractor works on paragraph
 * boundaries and text content, not on a fixed schema: it survives either source and future markup
 * drift. (This is the opposite of the HMT parser, where a mis-parse WOULD be a wrong verdict and a
 * captured fixture is mandatory.)
 */

import type { SectionReference, ReferenceParagraph } from "../src/referenceText.js";

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", deg: "°", sect: "§", hellip: "…",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

/** Strip all XML tags from a fragment and normalize whitespace to single spaces. */
function stripTags(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Text of the FIRST matching element (any of the given tag names), tags stripped. */
function firstElementText(xml: string, tags: string[]): string | null {
  for (const tag of tags) {
    const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
    if (m && m[1] != null) {
      const t = stripTags(m[1]);
      if (t) return t;
    }
  }
  return null;
}

const DESIGNATOR_RE = /^\(([A-Za-z0-9]{1,4})\)\s*/;

/**
 * Extract one section's reference text from its XML. `sectionNumber` is passed in (the caller knows
 * which section it requested) rather than trusted from the markup.
 */
export function extractSectionText(
  xml: string,
  opts: { sectionNumber: string; sourceVersion?: string | null },
): SectionReference {
  // Subject: prefer an explicit <SUBJECT>; else the <HEAD>, with the "§ NNN.NNN" number prefix removed.
  let subject = firstElementText(xml, ["SUBJECT"]);
  if (!subject) {
    const head = firstElementText(xml, ["HEAD"]) ?? "";
    subject = head.replace(/^§?\s*\d{3}\.\d+\s*/, "").trim();
  }

  // Paragraphs: every <P>/<FP> body, tag-stripped, in document order.
  const paragraphs: ReferenceParagraph[] = [];
  for (const m of xml.matchAll(/<(P|FP)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = stripTags(m[2] ?? "");
    if (!text) continue;
    const d = DESIGNATOR_RE.exec(text);
    paragraphs.push({ designator: d && d[1] ? d[1] : null, text });
  }

  return {
    citation: `49 CFR ${opts.sectionNumber}`,
    sectionNumber: opts.sectionNumber,
    subject: subject ?? "",
    paragraphs,
    sourceVersion: opts.sourceVersion ?? null,
  };
}
