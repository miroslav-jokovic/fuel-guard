import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  INSPECTION_CATALOGUE_VERSION,
  INSPECTION_GROUPS,
  type InspectionItemAnswer,
  type InspectionOutcome,
  type InspectionSubjectType,
  type VehicleIdentificationMethod,
} from "@silvicom/shared";
import { winAnsi } from "../../../../lib/pdfDraw.js";
import {
  CHECKBOX_CELLS,
  GROUP_HEADINGS,
  HEADER_CELLS,
  HEADER_SIZES,
  HEADING_SIZE,
  HELVETICA_DESCENT_RATIO,
  IDENTIFICATION_BOX,
  OTHER_CONDITIONS_LINES,
  OTHER_GROUP_TITLE,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  TEMPLATE_REVISION,
  VEHICLE_TYPE_BOX,
  baselineOf,
  cellsFor,
  type Cell,
} from "./layouts/keller14834Rev0122.js";

/**
 * Stamping the §396.17 report onto J.J. Keller form 14834 (plan step A5, D-AVI7/D-AVI14).
 *
 * ── pdf-lib, NOT pdfkit, AND THAT IS NOT A PREFERENCE ──────────────────────────────────────────
 * `lib/pdfDraw.ts` is this repo's house style for documents it AUTHORS, and it is built on pdfkit
 * because pdfkit lays out text better. pdfkit cannot open an existing PDF. This renderer does not
 * author a page — it draws onto one somebody else printed — which is the job `dqBinder/merge.ts`
 * already uses pdf-lib for. Two libraries, each doing the thing it can do.
 *
 * ── EVERY VALUE IS FITTED, NOT HOPED AT ────────────────────────────────────────────────────────
 * `fit()` shrinks a string until it fits its cell and returns the size it used. That exists because
 * the plan's §2.5 measured a four-digit repair date at 40.03 pt going into a 39.2 pt box — it would
 * have printed across the item text and nobody would have noticed until a page came off the printer.
 * `layout.test.ts` asserts the same property up front so the shrink is a safety net rather than the
 * mechanism.
 *
 * ── THE §396.19 BOX IS NOT AN ARGUMENT ─────────────────────────────────────────────────────────
 * `inspectorQualified` arrives inside `InspectionRenderInput` as a fact the caller READ from the
 * register (D-AVI6), and A6 refuses to finalize without it. It is deliberately not a boolean any
 * caller can set to `true` on the way past — a legal assertion with a convenient parameter is how
 * derived facts turn back into typed ones.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(HERE, "assets", "keller-14834-rev0122.pdf");

/** Bump when the drawing changes in a way that alters bytes for the same input. */
export const RENDERER_VERSION = "1.0.0";

/**
 * Pure black, on every path including the draft preview (D-AVI22).
 *
 * The preview used to stamp its values in `rgb(0.72, 0.11, 0.11)`, and the office reasonably read
 * that as the product printing in red. It was a second signal nobody needed: the page already
 * carries "DRAFT - NOT A CERTIFIED INSPECTION" across the middle of it, which is unmissable and
 * says the thing in words. What the red cost was the preview's whole job — D-AVI14 exists so the
 * office can see WHAT WILL PRINT before certifying, and a preview whose ink is a different colour
 * from the filing is not showing them that.
 *
 * 0 rather than the 0.1 grey it was: this is a compliance record that gets photocopied and faxed at
 * a roadside, and the copy is where a 90% black starts costing legibility.
 */
const INK = rgb(0, 0, 0);
const MARK_SIZE = 8;
const HEADER_SIZE = 10;
const MIN_SIZE = 5.5;

/** The mark each result prints. Words, not glyphs — WinAnsi cannot encode a tick (§2.5). */
const RESULT_MARK: Record<string, string> = { ok: "Ok", needs_repair: "X", na: "N/A" };

export interface InspectionRenderInput {
  subjectType: InspectionSubjectType;
  /** The fleet unit number as the office knows it — "654", not a uuid. */
  unitNumber: string | null;
  inspectedOn: string;
  decalSerial: string | null;
  inspectorName: string;
  /** Read from the register by the caller, never asserted here (D-AVI6). */
  inspectorQualified: boolean;
  carrierName: string;
  carrierAddress: string | null;
  carrierCityStateZip: string | null;
  identificationMethod: VehicleIdentificationMethod;
  identificationValue: string | null;
  inspectionAgencyLocation: string | null;
  otherConditions: string | null;
  items: readonly InspectionItemAnswer[];
  outcome: InspectionOutcome | null;
}

export interface RenderOptions {
  /** `template` stamps the Keller page; `none` emits the same values on a blank one (A8). */
  background?: "template" | "none";
  /** D-AVI14's preview: identical placement, plus a mark saying it certifies nothing. */
  draft?: boolean;
  /**
   * Registration offset in points, for printing onto a pre-printed pad (D-AVI8). Positive is right
   * and down; a printer laying ink low is corrected with a NEGATIVE y.
   *
   * Applied to the whole page rather than per field, because a misfeed shifts everything by the
   * same amount — a per-field correction would be describing a bent form rather than a printer.
   */
  offset?: { x: number; y: number };
}

/**
 * A repair date prints as `M/D/YY`, leading zeros dropped.
 *
 * Not a style choice: the REPAIRED DATE column is **24 pt wide**, measured off the blank's own ruled
 * lines. `06/17/2026` is 40 pt at the body size and `06/17/26` is 31 — both run across the item
 * text. `6/17/26` is 26.7, which `fit()` then settles at about 7 pt. The office has never printed a
 * date in this column (the sample carries none), so there is no house convention to preserve.
 */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}/${(y ?? "").slice(2)}`;
}

/** US-style for the header date, matching what the office has always typed. */
function headerDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

interface Stamper {
  text(cell: Cell, value: string | null | undefined, size?: number, weight?: "regular" | "bold"): void;
  mark(cell: Cell): void;
}

function stamperFor(
  page: PDFPage,
  font: PDFFont,
  boldFont: PDFFont,
  color = INK,
  offset = { x: 0, y: 0 },
): Stamper {
  /** Shrink until it fits, never past `MIN_SIZE` — below that it is illegible on paper anyway. */
  const fit = (value: string, cell: Cell, start: number, face: PDFFont = font): number => {
    let size = start;
    while (size > MIN_SIZE && face.widthOfTextAtSize(value, size) > cell.maxWidth) size -= 0.25;
    return size;
  };
  return {
    text(cell, value, size = HEADER_SIZE, weight = "regular") {
      if (value === null || value === undefined || value === "") return;
      const safe = winAnsi(value);
      const face = weight === "bold" ? boldFont : font;
      const used = fit(safe, cell, size, face);
      page.drawText(safe, {
        x: cell.x + offset.x,
        y: baselineOf(cell, used) + offset.y,
        size: used,
        font: face,
        color,
      });
    },
    mark(cell) {
      page.drawText("X", {
        x: cell.x + offset.x,
        y: baselineOf(cell, MARK_SIZE) + offset.y,
        size: MARK_SIZE,
        font,
        color,
      });
    },
  };
}

/**
 * The header block, at the sizes and the weight the office's own reports carry (`HEADER_SIZES`).
 *
 * Every value here is BOLD. That is measured rather than chosen: the carrier block on the filed
 * trailer report is `/HeBo 12.085 Tf` — Helvetica-Bold — and the top-right block is set at roughly
 * 16 pt beside it. The page used to print all nine at regular 10 pt, which is why the top of it
 * read as thin and small against Keller's own artwork.
 */
function drawHeader(s: Stamper, input: InspectionRenderInput): void {
  const b = (cell: Cell, value: string | null | undefined, size: number) => s.text(cell, value, size, "bold");
  b(HEADER_CELLS.decalSerial, input.decalSerial, HEADER_SIZES.decalSerial);
  b(HEADER_CELLS.fleetUnitNumber, input.unitNumber, HEADER_SIZES.fleetUnitNumber);
  b(HEADER_CELLS.inspectedOn, headerDate(input.inspectedOn), HEADER_SIZES.inspectedOn);
  b(HEADER_CELLS.inspectorName, input.inspectorName, HEADER_SIZES.inspectorName);
  b(HEADER_CELLS.carrierName, input.carrierName, HEADER_SIZES.carrierName);
  b(HEADER_CELLS.carrierAddress, input.carrierAddress, HEADER_SIZES.carrierAddress);
  b(HEADER_CELLS.carrierCityStateZip, input.carrierCityStateZip, HEADER_SIZES.carrierCityStateZip);
  b(HEADER_CELLS.vehicleIdentificationValue, input.identificationValue, HEADER_SIZES.vehicleIdentificationValue);
  b(HEADER_CELLS.inspectionAgencyLocation, input.inspectionAgencyLocation, HEADER_SIZES.inspectionAgencyLocation);

  // Only when the register says so (D-AVI6). An unqualified inspector leaves the box empty rather
  // than printing a claim nobody can stand behind.
  if (input.inspectorQualified) s.mark(CHECKBOX_CELLS.qualifiedYes);
  s.mark(CHECKBOX_CELLS[IDENTIFICATION_BOX[input.identificationMethod]]);
  s.mark(CHECKBOX_CELLS[VEHICLE_TYPE_BOX[input.subjectType]]);
}

/**
 * The sixteen section headings, in black, knocked into Keller's red hairline (D-AVI22).
 *
 * Keller draws them in zero ink over that hairline because the pad it ships is pre-printed with a
 * coloured band; on plain paper they are white on white and the office sees a table of items with
 * nothing naming the sections. Drawn here instead, in the same place, at the same 8.64 pt, from the
 * catalogue rather than from a list of strings — so a heading cannot go missing the way
 * `1. BRAKE SYSTEM` did in the damaged export, and cannot disagree with the items beneath it.
 *
 * The white rectangle is the knockout: it clears the hairline behind the text only, so the rule
 * still runs across the rest of the column exactly as Keller drew it, and the heading interrupts it
 * the way it does on the printed pad.
 */
function drawGroupHeadings(page: PDFPage, bold: PDFFont, offset: { x: number; y: number }): void {
  const titleOf = (n: number) =>
    (INSPECTION_GROUPS.find((g) => g.number === n)?.title ?? OTHER_GROUP_TITLE).toUpperCase();

  for (const heading of GROUP_HEADINGS) {
    const text = `${heading.number}. ${titleOf(heading.number)}`;
    const width = bold.widthOfTextAtSize(text, HEADING_SIZE);
    const x = heading.x + offset.x;

    page.drawRectangle({
      x: x - 1.5,
      y: PAGE_HEIGHT - heading.rule - 1.5 + offset.y,
      width: width + 3,
      height: 3,
      color: rgb(1, 1, 1),
    });
    page.drawText(text, {
      x,
      y: PAGE_HEIGHT - heading.y + HELVETICA_DESCENT_RATIO * HEADING_SIZE + offset.y,
      size: HEADING_SIZE,
      font: bold,
      color: INK,
    });
  }
}

function drawItems(s: Stamper, items: readonly InspectionItemAnswer[]): void {
  for (const item of items) {
    const cells = cellsFor(item.key);
    // Unmapped keys cannot reach here — layout.test.ts asserts the bijection — but a report pins its
    // catalogue version, so a future report could carry a key this map predates. Skipping silently
    // would print a blank cell that reads as "not inspected"; the caller checks the version instead.
    if (!cells) continue;
    if (item.result === "needs_repair") {
      s.text(cells.needsRepair, RESULT_MARK.needs_repair, MARK_SIZE);
      if (item.repairedAt) s.text(cells.repairedDate, shortDate(item.repairedAt), MARK_SIZE);
    } else {
      s.text(cells.ok, RESULT_MARK[item.result] ?? "", MARK_SIZE);
    }
  }
}

/**
 * Wrapped by MEASURING each candidate line, not by counting characters — "WWW" and "iii" are the
 * same length and nowhere near the same width, and this column is 116 pt wide.
 */
function drawOtherConditions(s: Stamper, font: PDFFont, text: string | null): void {
  if (!text) return;
  const L = OTHER_CONDITIONS_LINES;
  const lines: string[] = [];
  let line = "";
  for (const word of winAnsi(text).split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, MARK_SIZE) > L.maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  lines.slice(0, L.lines).forEach((value, i) => {
    s.text({ x: L.x, y: L.firstY + i * L.lineHeight, maxWidth: L.maxWidth }, value, MARK_SIZE);
  });
}

/**
 * The digest of what was rendered — the source payload, NOT the file.
 *
 * `applicationPdf/render.ts` set this precedent for the reason it is impossible to do otherwise: a
 * document cannot contain its own hash. What this proves is that two PDFs were drawn from the same
 * answers under the same catalogue, template and renderer.
 */
export function renderDigest(input: InspectionRenderInput): string {
  const canonical = JSON.stringify({
    v: [INSPECTION_CATALOGUE_VERSION, TEMPLATE_REVISION, RENDERER_VERSION],
    subject: [input.subjectType, input.unitNumber],
    on: input.inspectedOn,
    decal: input.decalSerial,
    inspector: [input.inspectorName, input.inspectorQualified],
    carrier: [input.carrierName, input.carrierAddress, input.carrierCityStateZip],
    id: [input.identificationMethod, input.identificationValue],
    agency: input.inspectionAgencyLocation,
    other: input.otherConditions,
    outcome: input.outcome,
    items: [...input.items]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((i) => [i.key, i.result, i.repairedAt ?? null]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export async function renderInspectionReport(
  input: InspectionRenderInput,
  opts: RenderOptions = {},
): Promise<Buffer> {
  const background = opts.background ?? "template";
  const doc =
    background === "template"
      ? await PDFDocument.load(await readFile(TEMPLATE_PATH), { ignoreEncryption: true })
      : await PDFDocument.create();
  const page = background === "template" ? doc.getPage(0) : doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  // The whole coordinate map assumes this page box. A template swapped for a differently-sized one
  // would print every value in the wrong place, silently, so it fails loudly instead.
  const { width, height } = page.getSize();
  if (Math.round(width) !== PAGE_WIDTH || Math.round(height) !== PAGE_HEIGHT) {
    throw new Error(
      `inspection template is ${width}x${height}pt, expected ${PAGE_WIDTH}x${PAGE_HEIGHT} — the coordinate map does not apply to it`,
    );
  }

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // The offset is a property of the printer, so it moves the VALUES and never the template. On
  // `background: 'template'` the artwork and the ink are on the same page and drift together, which
  // is why calibration only ever applies to the values-only render.
  const offset = background === "none" ? (opts.offset ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
  const s = stamperFor(page, font, bold, INK, offset);
  drawHeader(s, input);
  // Only on plain paper. A pre-printed Keller pad already carries these, and drawing them onto one
  // would print every heading twice (D-AVI22, D-AVI8).
  if (background === "template") drawGroupHeadings(page, bold, offset);
  drawItems(s, input.items);
  drawOtherConditions(s, font, input.otherConditions);

  if (opts.draft) {
    page.drawText("DRAFT - NOT A CERTIFIED INSPECTION", {
      x: 150,
      y: 420,
      size: 20,
      font,
      color: rgb(0.85, 0.3, 0.3),
      opacity: 0.35,
    });
  }

  // Provenance in the form's own bottom margin, never over Keller's artwork.
  const provenance = `Silvicom 360 · catalogue ${INSPECTION_CATALOGUE_VERSION} · template ${TEMPLATE_REVISION} · renderer ${RENDERER_VERSION} · source ${renderDigest(input).slice(0, 16)}`;
  page.drawText(winAnsi(provenance), { x: 36, y: 12, size: 5.5, font, color: rgb(0.45, 0.45, 0.45) });

  doc.setTitle(`Annual vehicle inspection ${input.unitNumber ?? ""} ${input.inspectedOn}`.trim());
  doc.setProducer("Silvicom 360");
  // Fixed dates: pdf-lib stamps `now()` otherwise, and two renders of the same report would differ
  // in bytes — which would make the determinism property untestable and the digest pointless.
  const epoch = new Date(0);
  doc.setCreationDate(epoch);
  doc.setModificationDate(epoch);
  return Buffer.from(await doc.save());
}
