import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

/**
 * The carrier's packet workbook, read at TEST time — the source of truth two transcriptions answer to.
 *
 * ── WHY IT IS SHARED RATHER THAN COPIED ───────────────────────────────────────────────────────
 * `packetStatic.test.ts` has re-read `APPLICATION.xlsx` since P3, to keep "we transcribed the
 * carrier's document" a checkable claim instead of an assurance. `packetWording.test.ts` needs
 * exactly the same reader for exactly the same reason, and a second copy of a zip parser is a second
 * thing that can drift from the file it is checking — the shape this repo calls a workaround with a
 * delay fuse. One reader, two callers.
 *
 * ⚠ **No dependency.** A workbook is a zip of XML; the two entries this needs are found by scanning
 * for local file headers and inflated with `zlib.inflateRawSync`. Reaching for `jszip` would mean
 * depending on a package that is present only because something else hoisted it, which is how a test
 * starts failing on a machine that resolved differently.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const PACKET_WORKBOOK = join(HERE, "../../../../docs/plans/recruitment/APPLICATION.xlsx");

/** One entry out of a zip, by name. Returns null when the archive does not hold it. */
function zipEntry(archive: Buffer, name: string): Buffer | null {
  for (let i = 0; i < archive.length - 30; i++) {
    if (archive.readUInt32LE(i) !== 0x04034b50) continue;
    const nameLen = archive.readUInt16LE(i + 26);
    if (archive.subarray(i + 30, i + 30 + nameLen).toString() !== name) continue;
    const method = archive.readUInt16LE(i + 8);
    const compressed = archive.readUInt32LE(i + 18);
    const start = i + 30 + nameLen + archive.readUInt16LE(i + 28);
    const raw = archive.subarray(start, start + compressed);
    return method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
  }
  return null;
}

/**
 * The workbook's rows as text, one string per row, cells joined by ` | `.
 *
 * Dot-leaders and column padding are collapsed, because those are Excel's geometry rather than the
 * carrier's words — the normalisation both transcriptions were generated under.
 */
export function workbookLines(): string[] {
  const archive = readFileSync(PACKET_WORKBOOK);
  const strings = (zipEntry(archive, "xl/sharedStrings.xml") ?? Buffer.alloc(0)).toString("utf8");
  const sheet = (zipEntry(archive, "xl/worksheets/sheet1.xml") ?? Buffer.alloc(0)).toString("utf8");

  const shared: string[] = [];
  for (const si of strings.split("<si>").slice(1)) {
    shared.push(
      [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
        .map((m) => m[1] ?? "")
        .join("")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'"),
    );
  }

  const out: string[] = [];
  for (const row of sheet.split("<row ").slice(1)) {
    const values: string[] = [];
    for (const cell of row.split("<c ").slice(1)) {
      const v = /<v>([\s\S]*?)<\/v>/.exec(cell);
      if (!v?.[1]) continue;
      values.push(/t="s"/.test(cell) ? (shared[Number(v[1])] ?? "") : v[1]);
    }
    if (values.length > 0) out.push(values.join(" | "));
  }
  return out;
}

/** Applied to every line on both sides of a comparison — the generators did the same. */
export const normaliseWorkbookLine = (s: string): string =>
  s.replace(/\.{3,}/g, " ").replace(/\s+/g, " ").trim();
