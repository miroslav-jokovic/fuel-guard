import fontkit from "@pdf-lib/fontkit";
import {
  LABEL_PRESETS,
  POINTS_PER_INCH,
  createBitmap,
  drawQr,
  encode,
  fillPolygons,
  type LabelPresetId,
  type MonoBitmap,
  type Polygon,
} from "@silvicom/qr";
import type { LabelFaceDto } from "@silvicom/shared";
import { canDraw, pdfFontBytes, pdfUnicodeText, type PdfFace } from "../../../lib/pdfFonts.js";
import { LABEL_FACE_POINTS } from "../inventory/labelPdf.js";

/**
 * A label face drawn at printer resolution (PRINTERS-AND-SCANNERS-PLAN.md D-PS2).
 *
 * The RW403B prints only pictures (`@silvicom/qr`'s `tspl.ts` header), so the code under the QR and
 * the naming lines are drawn here from the same Liberation Sans files every PDF in this API embeds,
 * glyph outline by glyph outline, and filled at the printer's dot pitch. The layout is
 * `labelPdf.ts`'s stacked layout with its own measurements (`LABEL_FACE_POINTS`): symbol on top as
 * large as the text leaves room for, the code in bold beneath it, then up to two lines.
 *
 * Only one-label stocks are drawn. A label printer feeds one label at a time; a sheet of 24 is a
 * page for an office printer and has no meaning here, so it is refused rather than guessed at.
 */

interface GlyphCommand {
  command: "moveTo" | "lineTo" | "quadraticCurveTo" | "bezierCurveTo" | "closePath";
  args: number[];
}
interface FontkitFont {
  unitsPerEm: number;
  ascent: number;
  layout(text: string): {
    glyphs: Array<{ path: { commands: GlyphCommand[] } }>;
    positions: Array<{ xAdvance: number; xOffset: number; yOffset: number }>;
  };
}

const FONTS: Partial<Record<PdfFace, FontkitFont>> = {};
const font = (face: PdfFace): FontkitFont =>
  (FONTS[face] ??= (fontkit as unknown as { create(b: Buffer): FontkitFont }).create(pdfFontBytes(face)));

/** Curves are flattened into this many straight steps — invisible at 203 dpi on a 9-point glyph. */
const CURVE_STEPS = 8;

/** Only characters the face can draw; anything else becomes "?" rather than an empty box. */
const drawable = (text: string): string => [...pdfUnicodeText(text)].map((ch) => (canDraw(ch) ? ch : "?")).join("");

function advanceOf(f: FontkitFont, text: string, sizeDots: number): number {
  return f.layout(text).positions.reduce((w, p) => w + p.xAdvance, 0) * (sizeDots / f.unitsPerEm);
}

/** Cut to `width`, ending in an ellipsis, as `labelPdf.ts` asks pdfkit to. */
function fit(f: FontkitFont, text: string, sizeDots: number, width: number): string {
  if (advanceOf(f, text, sizeDots) <= width) return text;
  let cut = text;
  while (cut.length > 0 && advanceOf(f, `${cut}…`, sizeDots) > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** One line of text, centred in [left, left + width], its top at `top` (pdfkit's convention). */
function drawLine(bitmap: MonoBitmap, face: PdfFace, raw: string, sizeDots: number, left: number, top: number, width: number): void {
  const f = font(face);
  const text = fit(f, drawable(raw), sizeDots, width);
  const scale = sizeDots / f.unitsPerEm;
  const run = f.layout(text);
  let pen = left + (width - advanceOf(f, text, sizeDots)) / 2;
  const baseline = top + f.ascent * scale;
  const polygons: Polygon[] = [];
  run.glyphs.forEach((glyph, i) => {
    const pos = run.positions[i]!;
    const ox = pen + pos.xOffset * scale;
    const oy = baseline - pos.yOffset * scale;
    // Font units point UP; dots point DOWN.
    const pt = (x: number, y: number): [number, number] => [ox + x * scale, oy - y * scale];
    let current: Array<[number, number]> = [];
    let last: [number, number] = [0, 0];
    for (const { command, args } of glyph.path.commands) {
      if (command === "moveTo") {
        if (current.length > 2) polygons.push(current);
        current = [pt(args[0]!, args[1]!)];
        last = [args[0]!, args[1]!];
      } else if (command === "lineTo") {
        current.push(pt(args[0]!, args[1]!));
        last = [args[0]!, args[1]!];
      } else if (command === "quadraticCurveTo") {
        const [cx, cy, x, y] = args as [number, number, number, number];
        for (let s = 1; s <= CURVE_STEPS; s += 1) {
          const t = s / CURVE_STEPS;
          const u = 1 - t;
          current.push(pt(u * u * last[0] + 2 * u * t * cx + t * t * x, u * u * last[1] + 2 * u * t * cy + t * t * y));
        }
        last = [x, y];
      } else if (command === "bezierCurveTo") {
        const [c1x, c1y, c2x, c2y, x, y] = args as [number, number, number, number, number, number];
        for (let s = 1; s <= CURVE_STEPS; s += 1) {
          const t = s / CURVE_STEPS;
          const u = 1 - t;
          current.push(
            pt(
              u * u * u * last[0] + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
              u * u * u * last[1] + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y,
            ),
          );
        }
        last = [x, y];
      } else if (current.length > 2) {
        polygons.push(current);
        current = [];
      }
    }
    if (current.length > 2) polygons.push(current);
    pen += pos.xAdvance * scale;
  });
  fillPolygons(bitmap, polygons);
}

export interface LabelRasterOptions {
  presetId: LabelPresetId;
  dpi: number;
  /** The printer's nudge, in dots; positive is right and down. */
  offsetX: number;
  offsetY: number;
}

/** True for a stock a label printer can feed: one label to a page. */
export const isRollStock = (presetId: LabelPresetId): boolean =>
  LABEL_PRESETS[presetId].columns * LABEL_PRESETS[presetId].rows === 1;

/** One face → one bitmap the size of the label, in dots. */
export function renderLabelBitmap(face: LabelFaceDto, options: LabelRasterOptions): MonoBitmap {
  const preset = LABEL_PRESETS[options.presetId];
  if (!isRollStock(options.presetId)) {
    throw new Error(`${preset.name} is a sheet for an office printer, not a label-printer roll.`);
  }
  const dots = (pt: number) => (pt * options.dpi) / POINTS_PER_INCH;
  const width = Math.round(dots(preset.label.width));
  const height = Math.round(dots(preset.label.height));
  const bitmap = createBitmap(width, height);

  const pad = dots(LABEL_FACE_POINTS.pad);
  const code = dots(LABEL_FACE_POINTS.code);
  const line = dots(LABEL_FACE_POINTS.line);
  const box = { x: pad + options.offsetX, y: pad + options.offsetY, width: width - pad * 2, height: height - pad * 2 };

  // labelPdf.ts's stacked layout, in dots.
  const textHeight = code + dots(2) + face.lines.length * (line + dots(1));
  const symbol = Math.floor(Math.min(box.width, box.height - textHeight));
  drawQr(bitmap, encode(face.payload), box.x + (box.width - symbol) / 2, box.y, symbol);

  let cursor = box.y + symbol;
  drawLine(bitmap, "bold", face.code, code, box.x, cursor, box.width);
  cursor += code + dots(2);
  for (const text of face.lines) {
    drawLine(bitmap, "regular", text, line, box.x, cursor, box.width);
    cursor += line + dots(1);
  }
  return bitmap;
}
