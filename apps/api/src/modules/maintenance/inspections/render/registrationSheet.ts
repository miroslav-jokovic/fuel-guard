import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  HEADER_CELLS,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  baselineOf,
  cellsFor,
} from "./layouts/keller14834Rev0122.js";

/**
 * The sheet you measure a printer with (plan step B5/A8, D-AVI8).
 *
 * ── WHY A SHEET AND NOT A NUMBER FIELD ─────────────────────────────────────────────────────────
 * The alternative is asking somebody to print a report, look at it, and guess how far off it is.
 * Guessing produces a second guess, and the office ends up nudging a number until it looks right —
 * which is a calibration nobody can reproduce and nobody can check.
 *
 * This prints crosshairs at four positions whose TRUE location is known exactly, each labelled with
 * what it should line up against on the pre-printed pad. Lay the printed sheet over a real form,
 * read the difference with a ruler, and the offset is a measurement rather than an opinion. Four
 * marks and not one, because a single point cannot tell a shift apart from a scale error — if the
 * four differences are not equal, the printer is scaling and no offset will fix it.
 *
 * The marks are placed at REAL cells from the coordinate map rather than at invented coordinates,
 * so the sheet measures the thing the report actually uses.
 */

/**
 * Crosshair arms, in points.
 *
 * Six and not nine: the leftmost target is the OK column, whose centre is 25.5 pt from the edge of
 * the paper, and a typical laser printer cannot print the outer 4-6 mm (11-17 pt). A 9 pt arm
 * reached to 16.5 pt and risked being clipped on exactly the mark somebody is trying to measure -
 * which is worse than a shorter one, because a half-drawn crosshair still looks like a crosshair.
 */
const ARM = 6;

export async function renderRegistrationSheet(offset = { x: 0, y: 0 }): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.45, 0.45, 0.45);

  // Four corners of the work: the first and last component rows of the outer column groups. Spread
  // as widely as the printed grid allows, because a scale error shows up as a difference between
  // marks and the further apart they are the more obvious it is.
  const targets: Array<{ x: number; y: number; label: string }> = [
    corner("brake.service_brakes", "top-left: OK box, row 1a"),
    corner("lighting.all_operable", "bottom-left: OK box, lighting"),
    corner("windshield.glazing", "top-right: OK box, windshield"),
    corner("rear_impact_guard.present", "bottom-right: OK box, rear guard"),
  ].filter((t): t is { x: number; y: number; label: string } => t !== null);

  for (const t of targets) {
    const x = t.x + offset.x;
    const y = t.y + offset.y;
    page.drawLine({ start: { x: x - ARM, y }, end: { x: x + ARM, y }, thickness: 0.4, color: ink });
    page.drawLine({ start: { x, y: y - ARM }, end: { x, y: y + ARM }, thickness: 0.4, color: ink });
    page.drawText(t.label, { x: x + ARM + 3, y: y - 2, size: 5.5, font, color: muted });
  }

  const heading = "REGISTRATION SHEET - Silvicom 360 annual inspection";
  page.drawText(heading, { x: 54, y: PAGE_HEIGHT - 60, size: 11, font, color: ink });
  const lines = [
    "Print this at 100% - no 'fit to page', no scaling - and lay it over a blank inspection form.",
    "Each crosshair should sit in the middle of the box it names.",
    "Measure how far each one is off, in millimetres. Right and down are positive.",
    "If the four differences are NOT the same, the printer is scaling: fix that first, an offset cannot.",
    "Enter the difference under Printer setup, on the print menu of any inspection. 1 mm = 2.83 pt.",
  ];
  lines.forEach((line, i) => {
    page.drawText(line, { x: 54, y: PAGE_HEIGHT - 80 - i * 12, size: 8, font, color: muted });
  });
  page.drawText(
    `Current offset: x ${offset.x.toFixed(2)} pt, y ${offset.y.toFixed(2)} pt` +
      (offset.x === 0 && offset.y === 0 ? "  (none applied - this is the uncalibrated sheet)" : ""),
    { x: 54, y: PAGE_HEIGHT - 80 - lines.length * 12 - 6, size: 8, font, color: ink },
  );

  doc.setTitle("Inspection printer registration sheet");
  doc.setProducer("Silvicom 360");
  const epoch = new Date(0);
  doc.setCreationDate(epoch);
  doc.setModificationDate(epoch);
  return Buffer.from(await doc.save());
}

/** The centre of a real OK box from the map — so the sheet measures what the report uses. */
function corner(itemKey: string, label: string): { x: number; y: number; label: string } | null {
  const cells = cellsFor(itemKey);
  if (!cells) return null;
  return {
    x: cells.ok.x + cells.ok.maxWidth / 2,
    // The map stores a text baseline; the box's middle sits a little above it.
    y: baselineOf(cells.ok, 8) + 2.5,
    label,
  };
}

/** Exposed so a test can assert the sheet is measuring the same page the report prints on. */
export const REGISTRATION_ANCHOR = HEADER_CELLS.decalSerial;
