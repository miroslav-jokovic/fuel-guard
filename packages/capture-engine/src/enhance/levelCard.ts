import { assertRgb, rgbImage, type RgbImage } from "./raster";

/**
 * Levelling the light across a card (APPLICATION-PHOTO-CLEANUP-PLAN.md, D-PCL4).
 *
 * ── WHY A PLANE, AND NOT THE PAGE'S METHOD ────────────────────────────────────────────────────
 * `evenPage` estimates the paper's colour everywhere, and on a card that estimate would follow the card's
 * own design — a dark header band would read as a shadow and be bleached. But the commonest fault in a
 * card photo is not a shaped shadow, it is a GRADIENT: a window or a lamp to one side, so one end of the
 * card is darker than the other. A plane (brightness = a + b·x + c·y) has three numbers: it can follow a
 * gradient and cannot follow a design. It is fitted to each tile's bright end (the card's whites and pale
 * print), starting from the brighter half of the tiles, with tiles that disagree with the fit dropped and
 * the plane refitted, so a dark band of design is an outlier rather than a vote. The gain is the same on all three channels, so no colour moves.
 *
 * What it does NOT do: a hand's or a phone's shadow across part of a card is not a plane, and is left. A
 * card with a sharp-edged shadow is a re-shoot, which the scanner's tips already ask for.
 */

const TILES_LONG = 8;
const TILES_SHORT = 5;
/** Each tile's brightness is its 90th percentile: the whites between the print, as in `metrics.ts`. */
const TILE_PERCENTILE = 0.9;
/** A tile is an outlier when its residual is this many times the median residual (and at least 3 levels). */
const OUTLIER_FACTOR = 2.5;
/** At most this much brighter anywhere. Gentler than a page's 2.5: the plane is extrapolated to the corners. */
const MAX_LEVEL_GAIN = 1.6;
/** Fewer surviving tiles than this, and the fit is not trusted; the card is returned unchanged. */
const MIN_TILES = 8;

interface Tile {
  x: number;
  y: number;
  v: number;
}

export function levelCard(img: RgbImage): RgbImage {
  assertRgb(img, "levelCard");
  const { width: w, height: h, data } = img;
  const [gx, gy] = w >= h ? [TILES_LONG, TILES_SHORT] : [TILES_SHORT, TILES_LONG];

  let tiles: Tile[] = [];
  for (let ty = 0; ty < gy; ty++) {
    for (let tx = 0; tx < gx; tx++) {
      const x0 = Math.floor((tx * w) / gx);
      const x1 = Math.floor(((tx + 1) * w) / gx);
      const y0 = Math.floor((ty * h) / gy);
      const y1 = Math.floor(((ty + 1) * h) / gy);
      const hist = new Uint32Array(256);
      for (let y = y0; y < y1; y++) {
        for (let x = x0, p = (y * w + x0) * 3; x < x1; x++, p += 3) hist[Math.round((data[p]! + data[p + 1]! + data[p + 2]!) / 3)]!++;
      }
      const n = (x1 - x0) * (y1 - y0);
      let seen = 0;
      let v = 255;
      for (let i = 0; i < 256; i++) {
        if ((seen += hist[i]!) >= TILE_PERCENTILE * n) {
          v = i;
          break;
        }
      }
      tiles.push({ x: (x0 + x1) / 2 / w, y: (y0 + y1) / 2 / h, v });
    }
  }

  // The first fit starts from the brighter half of the tiles. Least squares is pulled by every tile, and a
  // licence's dark header band is a fifth of the card — fitted with everything, it tilts the first plane
  // far enough that the residual test below can no longer tell it from light (measured on the test card).
  const brightHalf = [...tiles].sort((p, q) => p.v - q.v)[Math.floor(tiles.length / 2)]!.v;
  tiles = tiles.filter((t) => t.v >= brightHalf);
  let plane = tiles.length >= MIN_TILES ? fitPlane(tiles) : null;
  for (let round = 0; round < 2 && plane; round++) {
    const p = plane;
    const residuals = tiles.map((t) => Math.abs(t.v - (p[0] + p[1] * t.x + p[2] * t.y)));
    const median = [...residuals].sort((a, b) => a - b)[Math.floor(residuals.length / 2)]!;
    const limit = Math.max(3, OUTLIER_FACTOR * median);
    tiles = tiles.filter((_, i) => residuals[i]! <= limit);
    plane = tiles.length >= MIN_TILES ? fitPlane(tiles) : null;
  }
  if (!plane) return img;
  const [a, b, c] = plane;

  // The brightest the plane reaches on the card is the level everything is brought to.
  const peak = Math.max(a, a + b, a + c, a + b + c);
  const out = rgbImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const here = a + (b * (x + 0.5)) / w + (c * (y + 0.5)) / h;
      const gain = Math.min(MAX_LEVEL_GAIN, peak / Math.max(1, here));
      const p = (y * w + x) * 3;
      for (let ch = 0; ch < 3; ch++) out.data[p + ch] = Math.min(255, Math.round(data[p + ch]! * gain));
    }
  }
  return out;
}

/** Least squares v = a + b·x + c·y, or null when the tiles do not determine one. */
function fitPlane(tiles: Tile[]): [number, number, number] | null {
  let n = 0, sx = 0, sy = 0, sv = 0, sxx = 0, sxy = 0, syy = 0, sxv = 0, syv = 0;
  for (const t of tiles) {
    n++;
    sx += t.x;
    sy += t.y;
    sv += t.v;
    sxx += t.x * t.x;
    sxy += t.x * t.y;
    syy += t.y * t.y;
    sxv += t.x * t.v;
    syv += t.y * t.v;
  }
  // Cramer's rule on the 3×3 normal equations.
  const m = [
    [n, sx, sy],
    [sx, sxx, sxy],
    [sy, sxy, syy],
  ];
  const r = [sv, sxv, syv];
  const det = (q: number[][]): number =>
    q[0]![0]! * (q[1]![1]! * q[2]![2]! - q[1]![2]! * q[2]![1]!) -
    q[0]![1]! * (q[1]![0]! * q[2]![2]! - q[1]![2]! * q[2]![0]!) +
    q[0]![2]! * (q[1]![0]! * q[2]![1]! - q[1]![1]! * q[2]![0]!);
  const d = det(m);
  if (Math.abs(d) < 1e-9) return null;
  const withColumn = (col: number): number[][] => m.map((row, i) => row.map((v, j) => (j === col ? r[i]! : v)));
  return [det(withColumn(0)) / d, det(withColumn(1)) / d, det(withColumn(2)) / d];
}
