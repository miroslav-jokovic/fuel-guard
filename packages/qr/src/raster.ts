import { QUIET_ZONE_MODULES, type QrMatrix } from "./encode.js";

/**
 * A one-bit picture in printer dots — what a thermal label printer actually burns
 * (PRINTERS-AND-SCANNERS-PLAN.md D-PS2).
 *
 * ── WHY A PICTURE AND NOT THE PRINTER'S OWN TEXT AND QR COMMANDS ──────────────────────────────
 * The MUNBYN RW403B's firmware honours only a subset of TSPL over USB, and `TEXT`, `BAR` and
 * `QRCODE` are not in it — a job that uses them prints nothing, not even a feed (measured on the
 * hardware by the `m0n01d/munbyn-print` project, plan §2). So the whole label is drawn here, dot by
 * dot, and sent as one `BITMAP`. A second gain the firmware forced on us: the printed label is the
 * same drawing as the PDF, from the same geometry, rather than the printer's idea of a font.
 *
 * One byte per dot (1 = dark) rather than packed bits: a 2" label at 203 dpi is 406 × 406 = 165 KB,
 * and keeping the drawing code free of bit arithmetic is worth far more than the memory. Packing is
 * the encoder's job (`tspl.ts`), done once.
 */
export interface MonoBitmap {
  width: number;
  height: number;
  /** Row-major, `dark[y * width + x]`, 1 = a burnt dot. */
  dark: Uint8Array;
}

export function createBitmap(width: number, height: number): MonoBitmap {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`A bitmap needs whole positive dimensions; got ${width} × ${height}.`);
  }
  return { width, height, dark: new Uint8Array(width * height) };
}

/** Darken a rectangle, clipped to the bitmap. Coordinates are rounded to whole dots. */
export function fillRect(bitmap: MonoBitmap, x: number, y: number, width: number, height: number): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(bitmap.width, Math.round(x + width));
  const y1 = Math.min(bitmap.height, Math.round(y + height));
  for (let row = y0; row < y1; row += 1) {
    bitmap.dark.fill(1, row * bitmap.width + x0, row * bitmap.width + Math.max(x0, x1));
  }
}

/**
 * Draw a QR symbol into a square of `size` dots whose top-left is (x, y), quiet zone included —
 * the same contract as `toSvgPath`, so the printed symbol sits where the PDF's does.
 *
 * ── EVERY MODULE IS A WHOLE NUMBER OF DOTS ───────────────────────────────────────────────────
 * The PDF can draw a module 4.37 points wide; a printer cannot burn 0.37 of a dot. Rounding each
 * module's edges independently would make some modules a dot wider than their neighbours, and a
 * scanner reads a QR by its module pitch — uneven modules are the classic way a perfectly encoded
 * symbol fails to read off a thermal printer. So the module is floored to whole dots, the symbol
 * shrinks by at most one module's remainder, and it is centred in the square it was given. Returns
 * the dots per module, which a caller (and a test) can check is never zero.
 */
export function drawQr(bitmap: MonoBitmap, matrix: QrMatrix, x: number, y: number, size: number): number {
  const cells = matrix.size + QUIET_ZONE_MODULES * 2;
  const module = Math.floor(size / cells);
  if (module < 1) {
    throw new Error(`A ${matrix.size}-module symbol needs at least ${cells} dots; it was given ${size}.`);
  }
  const drawn = module * cells;
  const left = Math.round(x + (size - drawn) / 2) + QUIET_ZONE_MODULES * module;
  const top = Math.round(y + (size - drawn) / 2) + QUIET_ZONE_MODULES * module;
  for (let r = 0; r < matrix.size; r += 1) {
    for (let c = 0; c < matrix.size; c += 1) {
      if (matrix.modules[r]![c]) fillRect(bitmap, left + c * module, top + r * module, module, module);
    }
  }
  return module;
}

/** A closed outline, as points in dots. */
export type Polygon = ReadonlyArray<readonly [number, number]>;

/**
 * Fill outlines with the non-zero winding rule, sampling each dot at its centre — how a glyph's
 * contours (an outer stroke and the counter of an "O" or "8") become solid ink with the hole left
 * open. Font outlines are drawn for non-zero, so even-odd would fill overlapping strokes wrongly.
 */
export function fillPolygons(bitmap: MonoBitmap, polygons: readonly Polygon[]): void {
  const edges: Array<{ x0: number; y0: number; x1: number; y1: number; dir: number }> = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const poly of polygons) {
    for (let i = 0; i < poly.length; i += 1) {
      const [ax, ay] = poly[i]!;
      const [bx, by] = poly[(i + 1) % poly.length]!;
      if (ay === by) continue;
      edges.push(ay < by ? { x0: ax, y0: ay, x1: bx, y1: by, dir: 1 } : { x0: bx, y0: by, x1: ax, y1: ay, dir: -1 });
      minY = Math.min(minY, ay, by);
      maxY = Math.max(maxY, ay, by);
    }
  }
  if (edges.length === 0) return;
  const rowStart = Math.max(0, Math.floor(minY));
  const rowEnd = Math.min(bitmap.height - 1, Math.ceil(maxY));
  const crossings: Array<{ x: number; dir: number }> = [];
  for (let row = rowStart; row <= rowEnd; row += 1) {
    const sy = row + 0.5;
    crossings.length = 0;
    for (const e of edges) {
      if (sy < e.y0 || sy >= e.y1) continue;
      crossings.push({ x: e.x0 + ((sy - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0), dir: e.dir });
    }
    crossings.sort((a, b) => a.x - b.x);
    let winding = 0;
    for (let i = 0; i < crossings.length - 1; i += 1) {
      winding += crossings[i]!.dir;
      if (winding === 0) continue;
      // Dots whose centre lies between this crossing and the next.
      const from = Math.max(0, Math.ceil(crossings[i]!.x - 0.5));
      const to = Math.min(bitmap.width - 1, Math.floor(crossings[i + 1]!.x - 0.5));
      if (to >= from) bitmap.dark.fill(1, row * bitmap.width + from, row * bitmap.width + to + 1);
    }
  }
}
