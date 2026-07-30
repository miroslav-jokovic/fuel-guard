/**
 * Minimal, dependency-free XML-table helpers shared by the non-HMT parsers (placards, segregation,
 * Appendix A/B). Same tolerant regex approach as `import/referenceText.ts` and `parseHmt.ts` — no DOM,
 * no deps. `parseHmt.ts` keeps its own private copies (it is frozen/verified); everything built after
 * it reuses these.
 */

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", deg: "°", sect: "§", hellip: "…",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", prime: "′", Prime: "″",
  alpha: "α", beta: "β", thinsp: " ", ensp: " ", emsp: " ", times: "×",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

/** Strip all XML tags from a fragment, decode entities, collapse whitespace. */
export function stripTags(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Drop `<sup>…</sup>` (footnote markers) BEFORE text extraction, then strip. */
export function stripTagsNoSup(fragment: string): string {
  return stripTags(fragment.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, " "));
}

/** Every `<TABLE>…</TABLE>` block, outer tags included. */
export function extractTables(xml: string): string[] {
  return xml.match(/<TABLE\b[^>]*>[\s\S]*?<\/TABLE>/gi) ?? [];
}

/** Inner HTML of every `<TR>` in a table (or any XML fragment). */
export function tableRows(tableXml: string): string[] {
  return [...tableXml.matchAll(/<TR\b[^>]*>([\s\S]*?)<\/TR>/gi)].map((m) => m[1] ?? "");
}

export interface Cell {
  text: string;
  inner: string;
  colspan: number;
}

/** Cells (`<TD>` or `<TH>`) of one row, with plain text + raw inner + colspan. */
export function rowCells(trInner: string): Cell[] {
  const out: Cell[] = [];
  for (const m of trInner.matchAll(/<(TD|TH)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const attrs = m[2] ?? "";
    const inner = m[3] ?? "";
    const cs = /colspan\s*=\s*"?(\d+)"?/i.exec(attrs);
    out.push({ text: stripTags(inner), inner, colspan: cs ? parseInt(cs[1] as string, 10) : 1 });
  }
  return out;
}

/** Pick the first table whose header row (row 0) text contains ALL of the given needles (case-insensitive). */
export function findTableByHeader(xml: string, needles: string[]): string | null {
  for (const t of extractTables(xml)) {
    const rows = tableRows(t);
    if (!rows.length) continue;
    const header = stripTags(rows[0] ?? "").toLowerCase();
    if (needles.every((n) => header.includes(n.toLowerCase()))) return t;
  }
  return null;
}
