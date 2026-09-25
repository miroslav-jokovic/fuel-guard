import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import PDFKitDocument from "pdfkit";
import type { PDFDocument as LibDocument, PDFFont } from "pdf-lib";
import { winAnsi } from "./winAnsi.js";

/**
 * The one text face our documents embed, so a driver's name prints as they typed it (Q-AF2).
 *
 * ── WHAT WAS BROKEN, MEASURED 2026-09-25 ──────────────────────────────────────────────────────
 * Both PDF libraries' built-in Helvetica is WinAnsi, which has no `ć č đ ń ł ș`. pdf-lib THROWS on
 * them: `renderPacketDocument` failed for Marko Petrović, Đorđe Jokić, Miloš Živković and Anna
 * Szczepańska (José Muñoz passed — `é ñ` are WinAnsi), so an application FILED with no packet PDF
 * behind it and the applicant's copy never became available. pdfkit did not throw only because
 * `winAnsi()` folded the name first, so the §391.21 summary and the permissions filed `Petrovic`:
 * one driver, two spellings, in one qualification file — AUD-3's defect for every Slavic surname.
 * `winAnsi.ts`'s header rejected a Unicode TTF in 2026-09 as "a font binary and a licence in the
 * repository for a handful of glyphs". For this carrier's drivers it is not a handful, and a
 * filing that fails is worse than 400 KB. APPLICANT-FLOW-PLAN §7 Q-AF2 recommended (b); the owner
 * approved it.
 *
 * ── WHY LIBERATION SANS ───────────────────────────────────────────────────────────────────────
 * It is METRIC-COMPATIBLE with Helvetica — every advance width is the same (`A` is 1366/2048 =
 * 0.667 em in both). So every measurement the packet already makes (`packetFit`'s shrink-to-fit,
 * `packetContinuation`'s wrap, pdfkit's line breaks) gives the same answer for a name that was
 * already printable, and only the names that could not print change at all. SIL Open Font
 * License 1.1 (`fonts/LICENSE_LIBERATION`), which permits bundling with the licence beside it. The
 * files are the ones `pdfjs-dist` ships as its own Helvetica substitute.
 *
 * ── WHAT IT STILL CANNOT DRAW ─────────────────────────────────────────────────────────────────
 * A character none of the three faces has (CJK, emoji, most of Latin Extended-B) is folded through
 * `winAnsi()` one character at a time — an accent dropped, or `?` — exactly as before. The test is
 * the FONT'S OWN character map, read at load, not a list of ranges written here: a list would be
 * the copy with a delay fuse, and measured, Liberation lacks 197 of Latin Extended-B's 208.
 */

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "fonts");

export type PdfFace = "regular" | "bold" | "italic";

const FILES: Record<PdfFace, string> = {
  regular: join(FONT_DIR, "LiberationSans-Regular.ttf"),
  bold: join(FONT_DIR, "LiberationSans-Bold.ttf"),
  italic: join(FONT_DIR, "LiberationSans-Italic.ttf"),
};

/** Read once per process: every packet embeds from the same bytes. */
const BYTES: Record<PdfFace, Buffer> = {
  regular: readFileSync(FILES.regular),
  bold: readFileSync(FILES.bold),
  italic: readFileSync(FILES.italic),
};

/**
 * Code points ALL three faces can draw. Intersected rather than per-face, so a word never changes
 * spelling between the bold heading and the regular field that restates it.
 */
const DRAWABLE: ReadonlySet<number> = (() => {
  const [first, ...rest] = (Object.keys(BYTES) as PdfFace[]).map(
    (f) => new Set<number>(fontkit.create(BYTES[f]).characterSet),
  );
  return new Set([...first!].filter((c) => rest.every((s) => s.has(c))));
})();

export const canDraw = (ch: string): boolean => DRAWABLE.has(ch.codePointAt(0)!);

/**
 * Text as the embedded face can draw it: every character it has kept exactly, the rest folded
 * through `winAnsi()` one at a time. The whitespace rules are `winAnsi`'s (CRLF → LF, tab → space),
 * so a document does not change its line breaks by changing its font.
 */
export function pdfUnicodeText(text: string): string {
  // CRLF first, as `winAnsi` does: folded one character at a time, a lone `\r` would become a SECOND
  // newline. A tab needs no rule of its own — the face has no tab glyph and `winAnsi` makes it a space.
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\n]/gu, (ch) => (canDraw(ch) ? ch : winAnsi(ch)));
}

/**
 * The face, embedded into a pdf-lib document and SUBSET — only the glyphs drawn travel in the file.
 *
 * ⚠ Every string drawn with the returned font must go through `pdfUnicodeText` first: pdf-lib draws
 * `.notdef` (an empty box) for a glyph the font lacks rather than refusing, which would print a
 * surname with a hole in it and no error anywhere.
 */
export async function embedPdfFace(doc: LibDocument, face: PdfFace): Promise<PDFFont> {
  doc.registerFontkit(fontkit);
  return doc.embedFont(BYTES[face], { subset: true });
}

/** pdfkit documents that have the face registered — the only ones `pdfkitText` leaves unfolded. */
const UNICODE_DOCS = new WeakSet<PDFKit.PDFDocument>();

/**
 * Register the face under the three Helvetica names every pdfkit helper in this codebase already
 * asks for, so `doc.font("Helvetica-Bold")` draws Liberation Sans Bold without touching a call site.
 *
 * ⚠ Overriding the NAMES rather than renaming the calls is deliberate: there are fifty-odd
 * `.font("Helvetica…")` calls across the recruiting renderers and `pdfDraw`, and a call site that
 * was missed would silently fall back to WinAnsi Helvetica — with `pdfkitText` then handing it a `ć`.
 */
export function useUnicodeFonts(doc: PDFKit.PDFDocument): void {
  const faces: Array<[PdfkitFaceName, Buffer]> = [
    ["Helvetica", BYTES.regular],
    ["Helvetica-Bold", BYTES.bold],
    ["Helvetica-Oblique", BYTES.italic],
  ];
  for (const [name, bytes] of faces) {
    doc.registerFont(name, bytes);
    doc.font(name);
    // ⚠ Helvetica's VERTICAL metrics on the embedded face — see `HELVETICA_VERTICAL`.
    Object.assign((doc as unknown as { _font: VerticalMetrics })._font, HELVETICA_VERTICAL[name]);
  }
  doc.font("Helvetica");
  UNICODE_DOCS.add(doc);
}

type PdfkitFaceName = "Helvetica" | "Helvetica-Bold" | "Helvetica-Oblique";

/** The three numbers pdfkit places a line of text with: baseline, descent and the gap between lines. */
interface VerticalMetrics {
  ascender: number;
  descender: number;
  lineGap: number;
}

/**
 * Standard Helvetica's vertical metrics, READ from pdfkit's own copy rather than typed in.
 *
 * ⚠ **Why the embedded face borrows them.** Liberation matches Helvetica's advance WIDTHS exactly
 * but not its ascender (0.905 em against 0.718), and pdfkit puts each line's baseline one ascender
 * below its top. Measured 2026-09-25 on a nine-point paragraph: every line drawn 1.68pt lower within
 * its box, the leading 0.06pt tighter. Small, uniform, and green in every test — and still a shift
 * of text against every rule and box in documents nobody looked at (the fuel reports, the DQ binder,
 * the inspection report). With these three numbers the layout is Helvetica's to the hundredth of a
 * point, so the only thing this change can alter on a page is a letter that could not print before.
 *
 * ⚠ It writes pdfkit's private `_font`, on a dependency pinned to an exact version (0.19.1).
 * `pdfFonts.test.ts` pins the outcome — the same baselines as standard Helvetica — so an upgrade that
 * moves the field fails by name rather than silently re-spacing every document.
 */
const HELVETICA_VERTICAL: Record<PdfkitFaceName, VerticalMetrics> = (() => {
  const probe = new PDFKitDocument({ autoFirstPage: false });
  const read = (name: PdfkitFaceName): VerticalMetrics => {
    probe.font(name);
    const { ascender, descender, lineGap } = (probe as unknown as { _font: VerticalMetrics })._font;
    return { ascender, descender, lineGap };
  };
  return {
    Helvetica: read("Helvetica"),
    "Helvetica-Bold": read("Helvetica-Bold"),
    "Helvetica-Oblique": read("Helvetica-Oblique"),
  };
})();

/**
 * The `font` option a document must be CREATED with for `useUnicodeFonts` to take effect.
 *
 * ⚠ **Not optional, and measured the hard way (2026-09-25).** pdfkit selects its default font in the
 * constructor and caches it under the name `Helvetica`; `font("Helvetica")` answers from that cache
 * before it ever looks at a registered font. So a document created with the default had its BOLD
 * and ITALIC switched and its REGULAR text still in WinAnsi Helvetica — a label and the value
 * beside it in two faces, 2pt apart, and a `ć` in body text handed to a font that cannot draw it.
 * Creating the document with the embedded face as its default means standard Helvetica is never
 * loaded, so there is nothing to answer from.
 */
export const UNICODE_DEFAULT_FONT: string = FILES.regular;

/**
 * The text to hand pdfkit for THIS document: kept as typed when the document embeds the face,
 * folded to WinAnsi when it does not (a document built with `new PDFDocument` directly).
 */
export const pdfkitText = (doc: PDFKit.PDFDocument, text: string): string =>
  UNICODE_DOCS.has(doc) ? pdfUnicodeText(text) : winAnsi(text);
