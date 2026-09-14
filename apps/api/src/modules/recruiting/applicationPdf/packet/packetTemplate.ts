import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream } from "pdf-lib";

/**
 * The carrier's own 31-page packet, as bytes this repository can read (§2.5, D-PKT1).
 *
 * ── WHY THE PDF IS NOW A REPO ASSET ───────────────────────────────────────────────────────────
 * §2.5 of `APPLICATION-PACKET-PLAN.md` states the lesson three separate defects taught — p24
 * (D-PKT10), p17 (D-PKT12) and `packetWording.ts`'s thirty-three page numbers (2026-09-14):
 *
 *   **A guard scoped to our own files cannot check a fact about the carrier's paper.**
 *
 * Every constant in this module's neighbourhood is a measurement of somebody else's document —
 * which page an instrument is on, which line a signature sits over, whether a page is the
 * applicant's at all — and until today the only copy of that document lived in somebody's
 * Downloads folder. So the measurements could be restated, and were, and a test agreed with them.
 * `packetWording.test.ts` says in its own comment that the check which would have caught its
 * off-by-one "needs that PDF in the repository". This is that PDF.
 *
 * `assets/keller-14834-rev0122.pdf` is the precedent and the shape: ship the blank document, and
 * let a test assert against the BYTES rather than against a belief in a comment.
 *
 * ── WHY IT READS THE PDF ITSELF RATHER THAN SHELLING OUT ──────────────────────────────────────
 * `pdftotext` is how these pages were measured by hand, and it is the wrong thing for a gate: it is
 * a system dependency that CI's runners do not carry, and a gate that silently skips when a binary
 * is missing is worse than no gate. Everything below comes out of the file with `pdf-lib` and
 * `node:zlib`, both already dependencies.
 *
 * ⚠ **The text is not ASCII in the file.** Microsoft Print To PDF subsets its fonts, so the content
 * stream carries glyph IDs — `<0022><00CD>` — and not characters. Both fonts ship a `ToUnicode`
 * CMap, which is what makes them readable at all; `cmapFor` below is that map, and without it every
 * text assertion in `packetTemplate.test.ts` would be comparing against mojibake.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** ⚠ The carrier's EXCEL print, which D-PKT11 names the text authority — never the Numbers export. */
export const PACKET_TEMPLATE_PATH = join(HERE, "assets", "application-11.pdf");

/**
 * One run of text, with the point it starts at **in PDF page coordinates** — origin bottom-left,
 * y counting UP, the space `pdf-lib` draws in.
 *
 * ⚠ **This was raw text space until the CTM was resolved (2026-09-14), and the note that said so drew
 * the wrong conclusion from a correct reading.** It observed the letterhead at raw `y` 88 and
 * `FOR DEPARTMENT OF TRANSPORTATION` at 149, and concluded "no single consistent axis explains" it.
 * Both numbers were right. **That line is simply printed TWICE on page 1** — once as a sub-header
 * under the letterhead (page-Y 680) and once in the footer (page-Y 86) — so the reading was never
 * evidence of a broken axis, and one axis explains the whole document.
 *
 * Worth keeping because the mistake is not the arithmetic: it was reaching for "the model is wrong"
 * when the data was unremarkable and the SEARCH was ambiguous. `find()` on a string that occurs twice
 * answers with whichever comes first.
 *
 * The page carries exactly ONE `cm`, first thing in the stream:
 *
 *     0.75 0 0 -0.75 0 792 cm
 *
 * — the content is authored in a 816×1056 top-down space (letter at 96dpi) and mapped into points
 * with a y-flip. So `pageX = 0.75·x`, `pageY = 792 − 0.75·y`, which `toPage` applies and
 * "puts the letterhead at the top of the page and the footer at the bottom" proves — by landmark
 * rather than by arithmetic, because an inverted flip still lands inside the page.
 */
export interface TemplateTextRun {
  x: number;
  y: number;
  text: string;
}

/**
 * One ruled line, in page coordinates — the geometry a signature or a value is drawn onto.
 *
 * ⚠ The y-flip means a rule's `y1`/`y2` come out EQUAL for a horizontal line, as they should, but a
 * line drawn left-to-right in the source is still left-to-right here: only `d` is negative in the
 * CTM, so x is scaled and y is mirrored.
 */
export interface TemplateRule {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TemplatePage {
  /**
   * 1-based index into the file. ⚠ Believed to equal the number the carrier prints in that page's
   * footer — every page reference in this area is written that way — but NOT proved here; see the
   * note at the foot of this file about why there is no `footerNumber()`. What the test proves
   * instead is page IDENTITY, by the headings that appear on exactly one page each.
   */
  page: number;
  width: number;
  height: number;
  runs: TemplateTextRun[];
  rules: TemplateRule[];
}

/**
 * A font's glyph-id → text map, out of its `ToUnicode` CMap.
 *
 * Only `bfchar` is read, because only `bfchar` is present — this file carries no `bfrange`. A
 * `bfrange` would silently contribute nothing rather than throw, so `packetTemplate.test.ts` asserts
 * the decoded text of known lines instead of trusting the decoder.
 */
function cmapFor(doc: PDFDocument, font: PDFDict): Map<number, string> {
  const map = new Map<number, string>();
  const toUnicode = font.get(PDFName.of("ToUnicode"));
  if (!toUnicode) return map;
  let raw = Buffer.from(doc.context.lookup(toUnicode, PDFStream).getContents());
  try {
    raw = inflateSync(raw);
  } catch {
    /* already flat */
  }
  const text = raw.toString("latin1");
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const entry of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const units = entry[2]!.match(/.{4}/g) ?? [];
      map.set(
        parseInt(entry[1]!, 16),
        units.map((u) => String.fromCharCode(parseInt(u, 16))).join(""),
      );
    }
  }
  return map;
}

/** One stream, decompressed. */
function inflateStream(stream: PDFStream): string {
  const raw = Buffer.from(stream.getContents());
  try {
    return inflateSync(raw).toString("latin1");
  } catch {
    return raw.toString("latin1");
  }
}

/**
 * The page's content, decompressed and concatenated.
 *
 * ⚠ **Each stream is inflated SEPARATELY and the results joined — never the other way round.** A page
 * may carry an array of content streams and the PDF spec concatenates them *after* decoding; joining
 * the compressed bytes and inflating once yields only the first stream and silently drops the rest.
 *
 * ⚠ **The carrier's own file hid this for a day.** Every one of its pages has exactly one stream, so
 * the bug was invisible until `packetOverlay.ts` drew on a page: `pdf-lib` wraps the original in
 * `q … Q` and appends its own, making four streams, and the page read back as completely empty —
 * no text, no rules — which looks exactly like a renderer that produced nothing.
 */
function streamOf(doc: PDFDocument, page: ReturnType<PDFDocument["getPage"]>): string {
  const contents = page.node.Contents();
  if (!contents) return "";
  return contents instanceof PDFArray
    ? contents.asArray().map((r) => inflateStream(doc.context.lookup(r, PDFStream))).join("\n")
    : inflateStream(contents as PDFStream);
}

/**
 * The page's own transform, read off the stream rather than assumed.
 *
 * ⚠ **This models THE CARRIER'S document, not PDFs in general.** It reads one transform for a whole
 * page and applies it to everything, which is true of every page of `application-11.pdf` and is not
 * true of a page something has drawn on: `pdf-lib` brackets the original in `q … Q` and appends its
 * own operators in absolute page coordinates, which this would wrongly transform. Reading back a
 * document this repository has DRAWN on is therefore good for text and page structure and not for
 * coordinates — `packetOverlay.test.ts` says so where it relies on it.
 *
 * ⚠ **One `cm`, and the reader refuses to guess if that stops being true.** Every page of this
 * document opens with `0.75 0 0 -0.75 0 792 cm` and never touches the matrix again, so a single
 * mapping is correct — but "correct because I looked once" is how a coordinate system quietly goes
 * wrong when a carrier re-exports. If a page carries no `cm`, or more than one, this returns null and
 * the caller leaves the numbers untransformed rather than applying a transform that may not hold.
 */
interface PageTransform {
  a: number;
  d: number;
  e: number;
  f: number;
}

function transformOf(stream: string): PageTransform | null {
  const cms = [
    ...stream.matchAll(
      /([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+cm\b/g,
    ),
  ];
  if (cms.length !== 1) return null;
  const [, a, b, c, d, e, f] = cms[0]!.map(Number) as unknown as number[];
  // Rotation or skew would need the full matrix and a reader that does more than scale-and-flip.
  if (b !== 0 || c !== 0) return null;
  return { a: a!, d: d!, e: e!, f: f! };
}

/** Every operator this reader understands, in one pass, in source order. */
const OPERATORS = new RegExp(
  [
    String.raw`\/(\w+)\s+[\d.]+\s+(Tf)`, // 1,2  select font
    String.raw`([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+(Tm)`, // 3-9 set matrix
    String.raw`([\d.-]+)\s+([\d.-]+)\s+(Td|TD)`, // 10,11,12 move
    String.raw`(T\*)`, // 13 next line
    String.raw`([\d.-]+)\s+(TL)`, // 14,15 leading
    String.raw`\[((?:[^\]\\]|\\.)*)\]\s*(TJ)`, // 16,17 show with kerning (hex or literal)
    String.raw`<([0-9a-fA-F]+)>\s*(Tj)`, // 18,19 show, hex
    String.raw`(BT)`, // 20 begin text
    String.raw`([\d.-]+)\s+([\d.-]+)\s+(m)`, // 21,22,23 moveto
    String.raw`([\d.-]+)\s+([\d.-]+)\s+(l)`, // 24,25,26 lineto
    // ⚠ Any alternative added here is APPENDED, never inserted. These are read by capture-group
    // NUMBER, so adding one in the middle renumbers every operator after it — which, measured, turned
    // `l` into something the reader ignored and emptied every ruled line on every page.
  ].join("|"),
  "g",
);

/**
 * Read one page: its text, positioned, and its ruled lines.
 *
 * ⚠ **`Td`/`TD`/`T*`/`TL` are implemented and, in THIS document, contribute nothing.** Measured
 * 2026-09-14 by disabling the branch: pages 19, 20 and 22 come back 776, 1011 and 1482 characters
 * either way — byte-identical. Microsoft Print To PDF positions every block here with an absolute
 * `Tm`.
 *
 * They stay because they are how text is positioned in general and the carrier may re-export from
 * something else, and they are called out as unexercised because the alternative is a reader whose
 * untested half nobody knows is untested. ⚠ **Nothing in `packetTemplate.test.ts` depends on them,
 * and no comment here may claim they are load-bearing** — an earlier draft of this one did, on the
 * strength of a throwaway prototype that had a different bug.
 */
function readPage(doc: PDFDocument, index: number): TemplatePage {
  const page = doc.getPage(index);
  const fonts = page.node.Resources()?.lookup(PDFName.of("Font"), PDFDict);
  const maps = new Map<string, Map<number, string>>();
  if (fonts) {
    for (const [key, ref] of fonts.entries()) {
      maps.set(key.toString(), cmapFor(doc, doc.context.lookup(ref, PDFDict)));
    }
  }

  const stream = streamOf(doc, page);
  const ctm = transformOf(stream);
  /** Raw authoring space → PDF page points. Identity when the transform could not be established. */
  const toPage = (px: number, py: number): { x: number; y: number } =>
    ctm ? { x: ctm.a * px + ctm.e, y: ctm.d * py + ctm.f } : { x: px, y: py };

  const runs: TemplateTextRun[] = [];
  const rules: TemplateRule[] = [];
  let cmap = new Map<number, string>();
  // The text line matrix: where this line started, and where the next one goes.
  let lineX = 0;
  let lineY = 0;
  let x = 0;
  let y = 0;
  let leading = 0;
  let penX = 0;
  let penY = 0;

  for (const m of stream.matchAll(OPERATORS)) {
    if (m[2] === "Tf") {
      cmap = maps.get(`/${m[1]}`) ?? new Map();
    } else if (m[9] === "Tm") {
      lineX = x = Number(m[7]);
      lineY = y = Number(m[8]);
    } else if (m[12] === "Td" || m[12] === "TD") {
      if (m[12] === "TD") leading = -Number(m[11]);
      lineX = x = lineX + Number(m[10]);
      lineY = y = lineY + Number(m[11]);
    } else if (m[13] === "T*") {
      lineY = y = lineY - leading;
      x = lineX;
    } else if (m[15] === "TL") {
      leading = Number(m[14]);
    } else if (m[20] === "BT") {
      lineX = lineY = x = y = 0;
    } else if (m[23] === "m") {
      penX = Number(m[21]);
      penY = Number(m[22]);
    } else if (m[26] === "l") {
      const from = toPage(penX, penY);
      const to = toPage(Number(m[24]), Number(m[25]));
      rules.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
      penX = Number(m[24]);
      penY = Number(m[25]);
    } else if (m[17] === "TJ" || m[19] === "Tj") {
      const hexes =
        m[17] === "TJ"
          ? [...m[16]!.matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => h[1]!)
          : [m[18]!];
      let text = "";
      for (const hex of hexes) {
        for (const cid of hex.match(/.{4}/g) ?? []) text += cmap.get(parseInt(cid, 16)) ?? "";
      }
      /**
       * ⚠ **A font with no `ToUnicode` decodes to nothing above, and silence is not an error here.**
       * The carrier's two faces both carry one; `pdf-lib`'s standard-14 faces carry none, and it
       * writes hex strings even for those — so everything THIS repository draws would vanish from a
       * read-back without this, and `packetOverlay.test.ts` would report a perfectly good PDF as
       * empty. One byte per code, which is what those faces use.
       */
      if (!text && hexes.length) {
        for (const hex of hexes) {
          for (const byte of hex.match(/.{2}/g) ?? []) text += String.fromCharCode(parseInt(byte, 16));
        }
      }
      if (text.trim()) runs.push({ ...toPage(x, y), text });
    }
  }

  return { page: index + 1, width: page.getWidth(), height: page.getHeight(), runs, rules };
}

/** The whole packet, read once. */
export async function readPacketTemplate(path = PACKET_TEMPLATE_PATH): Promise<TemplatePage[]> {
  const doc = await PDFDocument.load(await readFile(path), { ignoreEncryption: true });
  return Array.from({ length: doc.getPageCount() }, (_, i) => readPage(doc, i));
}

/** Everything on one page as a single string, in the order the operators appear. */
export const pageText = (page: TemplatePage): string => page.runs.map((r) => r.text).join(" ");

/**
 * ⚠ **There is deliberately no `footerNumber()` here, and the reason is worth keeping.**
 *
 * It was written, and it returned null on all 31 pages, because it looked for the digits "below the
 * footer rule" — a position, in a coordinate system this module has just finished saying it has not
 * established. The honest options were to resolve the CTM first or to assert on something that does
 * not need one, and PAGE IDENTITY does not: `PAST EMPLOYMENT VERIFICATION` appears on exactly one
 * page of this document, and that it is page 15 is the same fact the footer digit would have carried.
 *
 * Shipping the positional version would have meant a gate that passes by finding nothing — the
 * precise failure §2.5 exists to warn about, re-made inside the file written to close it.
 */
