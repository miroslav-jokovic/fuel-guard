import { inflateSync } from "node:zlib";
import { PDFDict, PDFName, PDFStream, type PDFDocument, type PDFPage } from "pdf-lib";

/**
 * Reading the words back out of a PDF we drew: a font's `ToUnicode` map, and a shown string through it.
 *
 * ── WHY ONE MODULE (Q-AF2, 2026-09-25) ────────────────────────────────────────────────────────
 * Until the text face was embedded (`pdfFonts.ts`) everything this API drew was standard Helvetica,
 * whose strings are one WinAnsi byte per character, and four readers — the packet template reader,
 * the overlay test's run reader, `testing/pdfText.ts` and a copy inside `file.test.ts` — each decoded
 * that way. An embedded face writes two-byte GLYPH IDS instead, and only its `ToUnicode` CMap says
 * which letter each one is. The template reader already had that decoder for the carrier's own
 * fonts; it moved here so every reader uses it rather than four growing one each.
 *
 * ⚠ Both CMap forms are read. pdf-lib writes `bfchar` (`<0022> <0063>`); pdfkit writes `bfrange`,
 * with either a start value (`<0001> <0005> <0041>`) or an array (`<0001> <0003> [<0041> <0042> <0043>]`).
 * A reader that knew only one would decode half our documents to nothing, and nothing is the answer
 * a `not.toContain` assertion passes on.
 */

/** Hex UTF-16BE, as a CMap destination is written, to a string. */
const utf16 = (hex: string): string =>
  (hex.match(/.{4}/g) ?? []).map((u) => String.fromCharCode(parseInt(u, 16))).join("");

/** Glyph code → text, from one font dictionary's `ToUnicode`. Empty when it has none. */
export function toUnicodeMap(doc: PDFDocument, font: PDFDict): Map<number, string> {
  const map = new Map<number, string>();
  const ref = font.get(PDFName.of("ToUnicode"));
  if (!ref) return map;
  let raw = Buffer.from(doc.context.lookup(ref, PDFStream).getContents());
  try {
    raw = inflateSync(raw);
  } catch {
    /* already flat */
  }
  const text = raw.toString("latin1");
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const e of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      map.set(parseInt(e[1]!, 16), utf16(e[2]!));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const e of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(e[1]!, 16);
      const hi = parseInt(e[2]!, 16);
      if (e[3] !== undefined) {
        const start = parseInt(e[3], 16);
        for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(start + (c - lo)));
      } else {
        const dests = [...e[4]!.matchAll(/<([0-9a-fA-F]+)>/g)].map((d) => d[1]!);
        dests.forEach((d, i) => map.set(lo + i, utf16(d)));
      }
    }
  }
  return map;
}

/** Every font on one page, by its resource name as a content stream selects it (`/F1`). */
export function pageFontMaps(doc: PDFDocument, page: PDFPage): Map<string, Map<number, string>> {
  const out = new Map<string, Map<number, string>>();
  // `lookupMaybe`: a sheet that draws no text (a blank page, a scan) has no `Font` entry at all.
  const fonts = page.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict);
  for (const [key, ref] of fonts?.entries() ?? []) {
    out.set(key.toString(), toUnicodeMap(doc, doc.context.lookup(ref, PDFDict)));
  }
  return out;
}

/**
 * One shown HEX string as text: through the selected font's map when it has one (two-byte codes),
 * else one byte per character — the standard-14 faces, which carry no map.
 */
export function decodeShownHex(hex: string, map: ReadonlyMap<number, string> | undefined): string {
  const clean = hex.replace(/\s+/g, "");
  if (map && map.size > 0) {
    return (clean.match(/.{4}/g) ?? []).map((c) => map.get(parseInt(c, 16)) ?? "").join("");
  }
  return Buffer.from(clean, "hex").toString("latin1");
}
