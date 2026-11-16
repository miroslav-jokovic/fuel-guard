import { findDocument } from "./findDocument";
import { straightenedSize, warpQuad, type Quad } from "./homography";
import { levelCard } from "./levelCard";
import { balanceCard, evenPage } from "./light";
import type { RgbImage } from "./raster";

/**
 * The clean copy of a photographed document (APPLICATION-PHOTO-CLEANUP-PLAN.md): straightened when its
 * four corners are found, then evened (a page) or levelled and balanced (a card). The ORIGINAL is never passed back
 * changed — the caller stores this beside it (D-PCL1).
 */

/**
 * Which treatment a photo gets, by its SHAPE (D-PCL4). `face` and `mark` are not here: a selfie and a drawn
 * signature have no clean copy, and the caller does not ask for one.
 */
export type CleanShape = "card" | "page";

/**
 * The algorithm's version, stored with every clean copy so a copy can be traced to the code that made it
 * and rebuilt when this changes (D-PCL1). Bump it on ANY change to the output — a constant, a step, an order.
 */
export const CLEAN_VERSION = "pcl-1";

export interface CleanResult {
  image: RgbImage;
  /** Where the document was found in the input, or null when it was not and nothing was straightened (D-PCL5). */
  quad: Quad | null;
  version: typeof CLEAN_VERSION;
}

export function cleanDocument(img: RgbImage, shape: CleanShape, maxLongEdge: number): CleanResult {
  const found = findDocument(img);
  let framed = img;
  if (found) {
    const size = straightenedSize(found.quad, shape, maxLongEdge);
    framed = warpQuad(img, found.quad, size.width, size.height) ?? img;
  }
  const image = shape === "page" ? evenPage(framed) : balanceCard(levelCard(framed));
  return { image, quad: framed === img ? null : found!.quad, version: CLEAN_VERSION };
}
