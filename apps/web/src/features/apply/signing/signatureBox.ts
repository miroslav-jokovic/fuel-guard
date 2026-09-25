import { PERMISSION_SIGNATURE_BOX } from "@silvicom/shared";

/**
 * Where the **Sign here** tag goes over a rendered page, as percentages of that page (AF6).
 *
 * The renderer names the box's top-left as a PDF destination (`PERMISSION_SIGNATURE_DESTINATION`);
 * pdfjs hands it back as `[pageRef, { name: "XYZ" }, left, top, zoom]`, in PDF user space, origin
 * bottom-left. The page's `view` is its box in the same space. Percentages rather than pixels, so the
 * tag stays on the box at every width the canvas is drawn at, and through every re-render on resize.
 *
 * ⚠ Null for anything that is not an XYZ point with numbers in it: a document without the name, or a
 * name pointing somewhere shapeless, has no box to put a tag on, and the screen falls back to a plain
 * Sign button rather than a tag in the wrong place.
 */
export interface BoxOnPage {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function signatureBoxOnPage(dest: unknown, view: readonly number[]): BoxOnPage | null {
  if (!Array.isArray(dest) || dest.length < 4) return null;
  const kind = (dest[1] as { name?: string } | null)?.name;
  const [x, y] = [dest[2], dest[3]];
  if (kind !== "XYZ" || typeof x !== "number" || typeof y !== "number") return null;
  const [x0, y0, x1, y1] = view as [number, number, number, number];
  const w = x1 - x0;
  const h = y1 - y0;
  if (!(w > 0 && h > 0)) return null;
  return {
    left: ((x - x0) / w) * 100,
    top: ((y1 - y) / h) * 100,
    width: (PERMISSION_SIGNATURE_BOX.width / w) * 100,
    height: (PERMISSION_SIGNATURE_BOX.height / h) * 100,
  };
}
