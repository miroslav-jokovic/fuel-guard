import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import { MARK_BASELINE_LIFT, PACKET_MARK_LINES, markLineFor } from "./packetMarkGeometry.js";
import { PACKET_TEMPLATE_PATH } from "./packetTemplate.js";

/**
 * The driver's marks, drawn onto the carrier's own packet (P5, D-PKT1).
 *
 * ── ⚠ THE CARRIER'S PDF IS THE TEMPLATE; ITS PAGES ARE NEVER REDRAWN ──────────────────────────
 * The approach this replaces reproduced all 31 pages in PDFKit, and it is why the owner was handed a
 * document that "looks nothing like our application". Here the file is LOADED and marks are drawn on
 * top: the letterhead, the tables, the ruled lines, `reisdency`, `signatrure` and every other thing
 * the carrier's lawyers put on the page are theirs, byte for byte, because nothing rewrites them.
 *
 * ── WHERE THE MARKS GO ────────────────────────────────────────────────────────────────────────
 * `packetMarkGeometry.ts`, which is a hand-verified table and says so — each line was chosen by
 * drawing every candidate onto the page and looking at the result, because the packet uses four
 * different layouts for the same act and two of them are indistinguishable by geometry.
 *
 * ── WHAT A MARK IS ────────────────────────────────────────────────────────────────────────────
 * The typed name in an italic face, or the driver's drawn PNG when they gave one (D-PKT13 lets them
 * choose; D-APP8 keeps the typed name as the signature of RECORD either way).
 *
 * ⚠ **`StandardFonts.HelveticaOblique`, not a script webfont.** A standard-14 face costs no embedded
 * bytes, cannot fail to load, and renders identically wherever the PDF is opened — and this document
 * is filed evidence that has to reproduce in ten years. A signature's job on this page is to be
 * legibly the signer's name in the place the form asks for it, which oblique does.
 *
 * ── ⚠ NOT WIRED IN, AND ONE REASON IS A DEFECT UPSTREAM OF IT ─────────────────────────────────
 * `file.ts` still renders the §391.21 summary. Two things are outstanding before this replaces it,
 * and the second was found BY this renderer:
 *
 *   1. The field values — pages 1, 2, 12, 15 and 16 carry applicant data and nothing here draws it,
 *      so wiring this in today would file a signed form with empty answers.
 *   2. ⚠ **THE INITIALS ARE NOT COLLECTED.** `p05`, `p06` and `p09` are `mark: "initials"`, and
 *      D-PKT6 is explicit that initials are a SECOND adopted mark — *"not an abbreviation of the
 *      first… a ceremony that derived them from the typed name would be inventing a mark the signer
 *      never made"*. `adoptedMarkKinds()` has said there are two since the inventory was written.
 *      The ceremony shipped in #783 adopts ONE, so this renderer is handed a full name for the three
 *      places that ask for initials — which is why they are also the three narrowest lines in the
 *      table and no type size rescues them.
 *      ⚠ **And it is worse than cosmetic: `record_packet_mark` pins one `signed_name` per link
 *      (DR035), so the moment a client correctly sends initials the ceremony is REFUSED at the third
 *      stop.** Supporting two marks needs the pin to be per mark KIND, which is a migration.
 *
 * ⚠ **Every mark is scaled to fit its line and never overruns it.** The lines are between 90 and 413
 * points wide and a long name at a fixed size would run into the printed text beside it — on page 4
 * that text is the word `Date`, and on page 20 it is the date line itself.
 */

export interface PacketMark {
  /** The placement id from `packetPlacements.ts` — `p03`, `p11a`, `p19b`. */
  placementId: string;
  /** What the driver adopted. The signature of record (D-APP8). */
  signedName: string;
}

export interface PacketOverlayInput {
  marks: readonly PacketMark[];
  /**
   * The driver's drawn signature, when they chose to draw one (D-PKT13).
   *
   * ⚠ PNG bytes, and optional forever. A8b's rule holds here too: a mark that will not render must
   * not stand between a driver and a filed application, so a failure to embed falls back to the typed
   * name rather than throwing.
   */
  drawnMark?: Buffer | null;
}

/** How tall a drawn mark is allowed to be, so it sits on the line rather than over the page. */
const DRAWN_MARK_MAX_HEIGHT = 18;
/** The size a typed name starts at, before it is shrunk to fit its line. */
const TYPED_MARK_SIZE = 11;
/** Below this the name is unreadable, so the line's width stops being the binding constraint. */
const TYPED_MARK_MIN_SIZE = 6;
/** Ink, matching the carrier's own black rather than a theme colour. */
const INK = rgb(0.1, 0.1, 0.1);

/** The largest size at or below `TYPED_MARK_SIZE` whose text fits the line, floored so it stays readable. */
function fittedSize(font: PDFFont, text: string, width: number): number {
  for (let size = TYPED_MARK_SIZE; size > TYPED_MARK_MIN_SIZE; size -= 0.5) {
    if (font.widthOfTextAtSize(text, size) <= width) return size;
  }
  return TYPED_MARK_MIN_SIZE;
}

/**
 * Draw the marks onto the carrier's packet and return the whole 31-page document.
 *
 * ⚠ **Unknown placement ids are skipped, not thrown on.** `application_packet_marks` is append-only
 * and holds rows filed under whatever the inventory said at the time — p24 was in it until
 * 2026-08-23 — so a historical row naming a place the table no longer carries must still produce a
 * document. §390.32(d) asks that a filed record stay reproducible; a renderer that throws on an old
 * row is a qualification file that cannot be produced.
 */
export async function renderPacketOverlay(input: PacketOverlayInput): Promise<Buffer> {
  const doc = await PDFDocument.load(await readFile(PACKET_TEMPLATE_PATH), { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaOblique);

  let drawn: PDFImage | null = null;
  if (input.drawnMark) {
    try {
      drawn = await doc.embedPng(input.drawnMark);
    } catch {
      // Decoration that failed to decode. The typed name below is the signature of record (D-APP8).
      drawn = null;
    }
  }

  for (const mark of input.marks) {
    const line = markLineFor(mark.placementId);
    if (!line) continue;
    const page = doc.getPage(line.page - 1);
    const width = line.x2 - line.x1;
    const baseline = line.y + MARK_BASELINE_LIFT;

    if (drawn) {
      const scale = Math.min(
        DRAWN_MARK_MAX_HEIGHT / drawn.height,
        // ⚠ 0.9 of the line, so a drawn mark has the same air around it the typed one gets.
        (width * 0.9) / drawn.width,
      );
      page.drawImage(drawn, {
        x: line.x1 + 2,
        y: baseline,
        width: drawn.width * scale,
        height: drawn.height * scale,
      });
      continue;
    }

    const name = mark.signedName.trim();
    if (!name) continue;
    page.drawText(name, {
      x: line.x1 + 2,
      y: baseline,
      size: fittedSize(font, name, width - 4),
      font,
      color: INK,
    });
  }

  return Buffer.from(await doc.save());
}

/** Every place this renderer knows how to draw — the table's ids, for a caller that wants to check. */
export const overlayKnowsPlacements = (): string[] => PACKET_MARK_LINES.map((l) => l.id);
