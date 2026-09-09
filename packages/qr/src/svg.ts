import { QUIET_ZONE_MODULES, type QrMatrix } from "./encode.js";

/**
 * Rendering a matrix to SVG geometry (D-INV16).
 *
 * Two outputs, because there are two consumers and they need different things. `toSvgPath` returns
 * the path data alone, which is what `apps/api`'s `lib/pdfDraw.ts` feeds to pdfkit when it draws a
 * label sheet (I10). `toSvg` wraps the same path in a complete document, which is what the web
 * preview renders inline. They share one path builder on purpose: I10's done-when is a pixel
 * comparison between the printed PDF and the on-screen preview, and that comparison is only
 * meaningful if both came from the same geometry.
 */

export interface SvgOptions {
  /** Side of the rendered square, in whatever unit the caller is working in. Default 1. */
  size?: number;
  /** Modules of clear space on every side. Defaults to the specification's four. */
  quietZone?: number;
  /** Dark colour. Default black — a QR symbol wants maximum contrast, not brand colour. */
  color?: string;
  /** Light colour, or `null` to leave the background transparent. Default white. */
  background?: string | null;
}

/**
 * One SVG path covering every dark module, as a run of axis-aligned rectangles.
 *
 * ── WHY ONE PATH AND NOT A RECT PER MODULE ──────────────────────────────────────────────────────
 * A version-2 symbol has 625 module positions and a version-4 has 1089. Emitting a `<rect>` each
 * would make a 24-label sheet an SVG with tens of thousands of elements, and would give pdfkit tens
 * of thousands of fill operations to write into the PDF. One path per symbol is a single fill.
 *
 * Horizontal runs are coalesced, which is nearly free and roughly halves the command count on real
 * symbols. Rendering is unchanged: the union of the rectangles is identical either way.
 *
 * Coordinates are emitted with `toFixed(4)` and then trimmed, so the output is a deterministic
 * string rather than one that depends on how a runtime happens to format a float. Two engines
 * disagreeing in the last decimal place is exactly what would break I10's pixel comparison.
 */
export function toSvgPath(matrix: QrMatrix, options: SvgOptions = {}): string {
  const size = options.size ?? 1;
  const quiet = options.quietZone ?? QUIET_ZONE_MODULES;
  const total = matrix.size + quiet * 2;
  const module = size / total;

  const num = (n: number): string => {
    const s = n.toFixed(4);
    return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  };

  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.modules[row]?.[col]) {
        col += 1;
        continue;
      }
      let run = 1;
      while (col + run < matrix.size && matrix.modules[row]?.[col + run]) run += 1;
      const x = (col + quiet) * module;
      const y = (row + quiet) * module;
      parts.push(`M${num(x)} ${num(y)}h${num(run * module)}v${num(module)}h-${num(run * module)}z`);
      col += run;
    }
  }
  return parts.join("");
}

/**
 * A complete SVG document for one symbol.
 *
 * `shape-rendering="crispEdges"` is the one attribute here that is load-bearing rather than
 * cosmetic: without it a browser antialiases the module edges, and a scanner reading a screen — or
 * a printer rasterising the preview — sees grey where it needs a hard black/white transition.
 */
export function toSvg(matrix: QrMatrix, options: SvgOptions = {}): string {
  const size = options.size ?? 1;
  const color = options.color ?? "#000000";
  const background = options.background === undefined ? "#ffffff" : options.background;
  const path = toSvgPath(matrix, options);
  const bg = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
    `width="${size}" height="${size}" shape-rendering="crispEdges">` +
    `${bg}<path d="${path}" fill="${color}"/></svg>`
  );
}
