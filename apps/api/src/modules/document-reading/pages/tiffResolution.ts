/**
 * A TIFF page's horizontal and vertical resolution, read from its own IFD — what libvips does not report.
 *
 * A fax in "normal" mode is scanned at 204 dpi across and 98 dpi down (ITU-T T.4 "standard resolution"),
 * and a fax gateway's TIFF stores exactly those pixels, so drawn one pixel per pixel the page is about half
 * its real height: every letter squashed flat. sharp's metadata carries one `density`, the horizontal
 * one, so the vertical resolution has to be read from the file's tags: XResolution (282) and
 * YResolution (283), each a RATIONAL. "Fine" mode (204 × 196) is 4% off square and is corrected too; a
 * scanner writes an equal pair and comes back unchanged from `aspectCorrection`.
 *
 * A malformed or truncated file answers null rather than throwing: the stretch is a correction, and a
 * file whose tags cannot be read is still decoded as stored — the decoder, not this, decides readability.
 */
export interface TiffResolution {
  x: number;
  y: number;
}

const XRESOLUTION = 282;
const YRESOLUTION = 283;
const RATIONAL = 5;
/** A real document has a handful of pages; a loop in the IFD chain must not spin for ever. */
const MAX_IFDS = 64;

/** The resolution of page `page` (0-based), or null when either tag is missing, malformed or zero. */
export function tiffResolution(bytes: Uint8Array, page: number): TiffResolution | null {
  if (bytes.length < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = String.fromCharCode(bytes[0]!, bytes[1]!);
  if (order !== "II" && order !== "MM") return null;
  const le = order === "II";
  if (view.getUint16(2, le) !== 42) return null; // BigTIFF (43) is not a fax gateway's format
  const fits = (at: number, n: number) => at >= 0 && at + n <= bytes.length;

  let ifd = view.getUint32(4, le);
  for (let i = 0; i < page; i++) {
    if (i >= MAX_IFDS || !fits(ifd, 2)) return null;
    const entries = view.getUint16(ifd, le);
    if (!fits(ifd + 2 + entries * 12, 4)) return null;
    ifd = view.getUint32(ifd + 2 + entries * 12, le);
    if (ifd === 0) return null;
  }
  if (!fits(ifd, 2)) return null;
  const entries = view.getUint16(ifd, le);
  if (!fits(ifd + 2, entries * 12)) return null;

  const rational = (tag: number): number | null => {
    for (let e = 0; e < entries; e++) {
      const at = ifd + 2 + e * 12;
      if (view.getUint16(at, le) !== tag) continue;
      if (view.getUint16(at + 2, le) !== RATIONAL || view.getUint32(at + 4, le) < 1) return null;
      const value = view.getUint32(at + 8, le);
      if (!fits(value, 8)) return null;
      const den = view.getUint32(value + 4, le);
      const r = den === 0 ? 0 : view.getUint32(value, le) / den;
      return r > 0 && Number.isFinite(r) ? r : null;
    }
    return null;
  };
  const x = rational(XRESOLUTION);
  const y = rational(YRESOLUTION);
  return x === null || y === null ? null : { x, y };
}

/** Whether a page's pixels are far enough from square to stretch: more than 2% apart (a scanner's 299.99 × 300 is square). */
export const needsStretch = (res: TiffResolution | null): res is TiffResolution => res !== null && Math.abs(res.x / res.y - 1) > 0.02;

/**
 * The size a page of `width × height` stored pixels should be drawn at so its pixels are square: the
 * axis with the LOWER resolution is stretched to the higher one, never shrunk — shrinking the 204-dpi
 * axis would throw away the detail a reader needs. Within 2% the pair counts as square (a scanner's
 * 299.99 × 300) and the size comes back unchanged.
 */
export function aspectCorrection(width: number, height: number, res: TiffResolution | null): { width: number; height: number } {
  if (!needsStretch(res)) return { width, height };
  const ratio = res.x / res.y;
  return ratio > 1
    ? { width, height: Math.round(height * ratio) }
    : { width: Math.round(width / ratio), height };
}
