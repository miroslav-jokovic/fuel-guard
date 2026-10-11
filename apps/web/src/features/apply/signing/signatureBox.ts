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

/**
 * A signing PLACE's box over its rendered page, from its `sign:<id>` destination (D-HB12).
 *
 * ⚠ `FitR` carries the whole rectangle — `[pageRef, { name: "FitR" }, left, bottom, right, top]`, in
 * PDF user space — because the packet's and the handbook's places are all different widths, unlike a
 * permission's one fixed box. Null for anything else, so a malformed destination costs the tag and the
 * walk falls back to its plain Sign button, never a tag in the wrong place.
 */
export function placeBoxOnPage(dest: unknown, view: readonly number[]): BoxOnPage | null {
  if (!Array.isArray(dest) || dest.length < 6) return null;
  if ((dest[1] as { name?: string } | null)?.name !== "FitR") return null;
  const [l, b, r, t] = dest.slice(2, 6) as unknown[];
  if (![l, b, r, t].every((n) => typeof n === "number")) return null;
  const [x0, y0, x1, y1] = view as [number, number, number, number];
  const w = x1 - x0;
  const h = y1 - y0;
  const [left, bottom, right, top] = [l, b, r, t] as number[];
  if (!(w > 0 && h > 0 && right! > left! && top! > bottom!)) return null;
  return {
    left: ((left! - x0) / w) * 100,
    top: ((y1 - top!) / h) * 100,
    width: ((right! - left!) / w) * 100,
    height: ((top! - bottom!) / h) * 100,
  };
}
