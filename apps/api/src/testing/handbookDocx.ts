import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipEntry } from "./packetWorkbook.js";

/**
 * The carrier's DRIVER HANDBOOK, read at TEST time — the source `handbookText.json` answers to.
 *
 * ⚠ No dependency, for `packetWorkbook.ts`'s reason: a .docx is a zip of XML, and its one entry that
 * matters is found and inflated by the same reader the workbook uses.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const HANDBOOK_DOCX = join(HERE, "../../../../docs/Kowlage-Base/DRIVER HANDBOOK.docx");

const decode = (s: string): string =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** Every paragraph's text, in order, with Word's tabs and line breaks as whitespace. */
export function handbookParagraphs(): string[] {
  const xml = (zipEntry(readFileSync(HANDBOOK_DOCX), "word/document.xml") ?? Buffer.alloc(0)).toString("utf8");
  const body = xml.slice(xml.indexOf("<w:body>"));
  return body.split(/<w:p[ >]/).slice(1).map((p) => {
    let text = "";
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) {
      text += m[1] !== undefined ? decode(m[1]) : " ";
    }
    return text;
  });
}

/**
 * The words of a line, as both sides are compared: whitespace collapsed, and the underscores of a
 * signature rule removed — the rule is drawn, never printed as characters.
 */
export const handbookWords = (s: string): string[] =>
  s.replace(/_+/g, " ").split(/\s+/).filter((w) => w.length > 0);
