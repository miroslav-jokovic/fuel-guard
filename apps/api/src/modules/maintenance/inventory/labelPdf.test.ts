import { describe, expect, it } from "vitest";
import { LABEL_PRESETS } from "@silvicom/qr";
import type { LabelFaceDto } from "@silvicom/shared";
import { renderLabelSheet } from "./labelPdf.js";

/**
 * Drawing a sheet (INVENTORY-PLAN.md I10).
 *
 * ── WHAT A TEST CAN HONESTLY SAY ABOUT A PDF, AND WHAT IT CANNOT ──────────────────────────────
 * The step's done-when is physical — *"a printed 22805 sheet scans back through I6 on both phones"*
 * — and no unit test can stand in for a printer, a thumb and a camera. What it CAN pin is the
 * chain between the numbers and the bytes, which is where the defects that reach a printed sheet
 * actually live:
 *
 *   · **the page size is the STOCK's, not Letter.** `newDrawing` opens a Letter page with 54 pt
 *     margins, which is right for a §396.17 report and would push `roll-single`'s only label off a
 *     2×2-inch media entirely. This is the one assertion that catches that regression, because a
 *     wrong page size produces a perfectly valid PDF;
 *   · **a run rolls onto a second sheet when it outgrows the first**, and the start position eats
 *     into the first sheet's capacity rather than into every sheet's;
 *   · **the start position reaches the geometry at all.** `labelSheet()`'s own tests pin where
 *     position 7 IS; what is only true here is that the option survives the journey from the route
 *     to the placement.
 *
 * The pixel comparison the step asks for is a comparison between this renderer and the WEB preview,
 * and it belongs with the preview — both call `labelSheet()` and `toSvgPath()` with the same
 * numbers, which is what makes it meaningful rather than a comparison of two guesses.
 */

const face = (n: number): LabelFaceDto => ({
  target: { kind: "asset", assetId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` },
  payload: `SIL1:AST:7K3M${String(n).padStart(2, "0")}`,
  code: `A-${String(n).padStart(4, "0")}`,
  lines: ["Cab tablet"],
});

const faces = (n: number): LabelFaceDto[] => Array.from({ length: n }, (_, i) => face(i + 1));

/** Count `/Type /Page` objects — pdfkit writes one per page and none for the catalogue. */
const pageCount = (pdf: Buffer): number => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

/** The MediaBox pdfkit wrote, in points. */
function mediaBox(pdf: Buffer): [number, number] {
  const m = pdf.toString("latin1").match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  if (!m) throw new Error("no MediaBox in the rendered PDF");
  return [Number(m[1]), Number(m[2])];
}

/**
 * A PDF with its per-render metadata removed, so two of them can be compared for CONTENT.
 *
 * ⚠ **This exists because two assertions below were passing while proving nothing, and a mutation
 * is what exposed it.** pdfkit stamps `/CreationDate` and a random `/ID` into every document, so
 * two renders of the same input are never byte-identical — which meant `expect(a.equals(b)).toBe
 * (false)` was true no matter what the renderer did with its options. Dropping `startPosition`
 * entirely still passed it. Normalised, the comparison is about the drawn content, and the
 * "identical inputs render identically" case below is what proves the normalisation is doing its
 * job rather than hiding the difference it was meant to expose.
 */
const normalize = (pdf: Buffer): string =>
  pdf
    .toString("latin1")
    .replace(/\/CreationDate\s*\([^)]*\)/g, "")
    .replace(/\/ModDate\s*\([^)]*\)/g, "")
    .replace(/\/ID\s*\[[^\]]*\]/g, "");

describe("rendering a label sheet", () => {
  it("produces a PDF", async () => {
    const pdf = await renderLabelSheet(faces(3), { presetId: "avery-22805" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  /**
   * ⚠ The assertion that catches a renderer quietly reverting to `newDrawing`'s Letter page. A
   * 2×2-inch roll label drawn onto Letter is a valid PDF, prints without error, and wastes the whole
   * roll before anybody works out why.
   */
  it("sizes the page to the stock and not to Letter", async () => {
    const roll = await renderLabelSheet(faces(1), { presetId: "roll-single" });
    expect(mediaBox(roll)).toEqual([144, 144]); // 2 inches square, at 72 points to the inch

    const sheet = await renderLabelSheet(faces(1), { presetId: "avery-22805" });
    expect(mediaBox(sheet)).toEqual([612, 792]);
  });

  it("rolls onto a second sheet when the run outgrows the first", async () => {
    const perSheet = LABEL_PRESETS["avery-22805"].columns * LABEL_PRESETS["avery-22805"].rows;
    expect(perSheet).toBe(24);

    expect(pageCount(await renderLabelSheet(faces(perSheet), { presetId: "avery-22805" }))).toBe(1);
    expect(pageCount(await renderLabelSheet(faces(perSheet + 1), { presetId: "avery-22805" }))).toBe(2);
  });

  /**
   * A shop that peeled six labels off a sheet last week starts at 7, so the first sheet holds 18 and
   * every sheet after it holds 24 — you skip only the labels you already took off the sheet in your
   * hand. Getting this wrong in the obvious way (offsetting EVERY sheet) wastes six labels per page
   * for the length of the run.
   */
  it("lets a start position eat into the first sheet only", async () => {
    const fits = await renderLabelSheet(faces(18), { presetId: "avery-22805", startPosition: 7 });
    expect(pageCount(fits)).toBe(1);

    const spills = await renderLabelSheet(faces(19), { presetId: "avery-22805", startPosition: 7 });
    expect(pageCount(spills)).toBe(2);
  });

  /**
   * That the option reaches the geometry at all. `labelSheet()` owns WHERE position 7 is and has its
   * own tests for it; what is only true here is that a number handed to this function changes what
   * gets drawn, rather than being accepted and dropped — which is exactly the shape of bug that
   * passes every other test and prints a sheet starting at position 1.
   */
  /**
   * The control case for the two comparisons below, and the reason `normalize` can be trusted: with
   * the per-render timestamp and id stripped, the same input renders to the same bytes. Without this
   * assertion, "these two differ" would be a claim about pdfkit's clock.
   */
  it("renders identical inputs identically, once the timestamp is out of the way", async () => {
    const a = await renderLabelSheet(faces(2), { presetId: "avery-22805", startPosition: 3 });
    const b = await renderLabelSheet(faces(2), { presetId: "avery-22805", startPosition: 3 });
    expect(normalize(b)).toBe(normalize(a));
  });

  it("draws a label somewhere different when the start position moves", async () => {
    const first = await renderLabelSheet(faces(1), { presetId: "avery-22805", startPosition: 1 });
    const seventh = await renderLabelSheet(faces(1), { presetId: "avery-22805", startPosition: 7 });
    expect(normalize(seventh)).not.toBe(normalize(first));
  });

  /** The same, for the nudge — the control that answers a printer whose registration is off. */
  it("draws a label somewhere different when the sheet is nudged", async () => {
    const square = await renderLabelSheet(faces(1), { presetId: "avery-22805" });
    const nudged = await renderLabelSheet(faces(1), { presetId: "avery-22805", nudge: { x: 6, y: -6 } });
    expect(normalize(nudged)).not.toBe(normalize(square));
  });

  /** The 1"-tall address labels lay the text beside the symbol; nothing about that may throw. */
  it("renders the wide presets, which use the other layout", async () => {
    for (const presetId of ["avery-5160", "avery-5520"] as const) {
      const pdf = await renderLabelSheet(faces(4), { presetId });
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pageCount(pdf)).toBe(1);
    }
  });
});
