import { assertRgb, rgbImage, type RgbImage } from "./raster";

/**
 * Evening the light on a photographed document (APPLICATION-PHOTO-CLEANUP-PLAN.md, D-PCL4).
 *
 * Two treatments, because a page and a card are different objects:
 *   · a PAGE is white paper with marks on it, so the paper's own colour, wherever it is, says how that part
 *     was lit — divide by it and the shadow is gone (`evenPage`);
 *   · a CARD has a printed background that is not white, so the same division would bleach its design. It
 *     gets one correction for the whole card: white balance and brightness from its own brightest pixels
 *     (`balanceCard`).
 *
 * ── WHAT NEITHER WILL DO ──────────────────────────────────────────────────────────────────────
 * Binarise, sharpen, or touch the dark end. Signatures, stamps, highlighter and a licence's photograph
 * are evidence (D-SCAN11's constraint), and every step here is a per-pixel GAIN on each channel — a red
 * stamp's red stays proportionally red. Nothing here can recover glare: a blown pixel is 255 in every
 * channel and has no information left to scale.
 */

/** Where paper lands: a little under full white, so a page still reads as paper and nothing clips. */
export const PAPER_WHITE = 245;

/**
 * The most a page's light may be multiplied by. A judgement, stated as one: 2.5× brings paper at 98 (deep
 * shadow) up to white; past that the "paper" estimate is more likely a dark photograph on the page, or the
 * table beside it, and multiplying it further would turn noise into blotches.
 */
const MAX_PAGE_GAIN = 2.5;

/**
 * The background grid. A block is 1/96 of the long edge (16 px at 1,568) — small enough that light changes
 * little across one — and the paper estimate is the brightest block within `REACH` blocks, so the window
 * is ~9% of the long edge (~150 px). What the reach protects is a PALE colour — a form's tinted field box,
 * a wide highlighter stroke — which no gain cap stops being read as paper in shade: within reach there is
 * real paper, and the box keeps its tint. A strong colour (a red stamp) is held by `MAX_PAGE_GAIN` instead.
 * Wider was measured and refused: at 6 and 7 the hand and phone shadows' sharp edges are no longer
 * followed, and those fixtures keep more than half their shadow.
 */
const BLOCKS_ON_LONG_EDGE = 96;
const REACH = 4;
const SMOOTH = 2;

/** Divide each channel by its estimated paper colour, so the paper is evenly `PAPER_WHITE` and neutral. */
export function evenPage(img: RgbImage): RgbImage {
  assertRgb(img, "evenPage");
  const { width: w, height: h, data } = img;
  const block = Math.max(4, Math.round(Math.max(w, h) / BLOCKS_ON_LONG_EDGE));
  const gw = Math.ceil(w / block);
  const gh = Math.ceil(h / block);

  const paper: Float32Array[] = [0, 1, 2].map((c) => {
    // Each block's BRIGHTEST value, not its mean: in dense text no 16 px block is all paper, so a mean reads
    // the ink as shade and brightens the paragraph more than its margin (measured on the corpus page: a 4%
    // spread of gain across paper that was evenly lit). The brightest pixel of a block is paper between ink.
    const brightest = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        let m = 0;
        for (let y = gy * block; y < Math.min(h, (gy + 1) * block); y++) {
          for (let x = gx * block, p = (y * w + x) * 3 + c; x < Math.min(w, (gx + 1) * block); x++, p += 3) {
            if (data[p]! > m) m = data[p]!;
          }
        }
        brightest[gy * gw + gx] = m;
      }
    }
    return blur(blur(maxFilter(brightest, gw, gh, REACH), gw, gh, SMOOTH), gw, gh, SMOOTH);
  });

  const floor = PAPER_WHITE / MAX_PAGE_GAIN;
  const out = rgbImage(w, h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / block - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / block - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      const p = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) {
        const g = paper[c]!;
        const top = g[y0 * gw + x0]! + (g[y0 * gw + x1]! - g[y0 * gw + x0]!) * tx;
        const bottom = g[y1 * gw + x0]! + (g[y1 * gw + x1]! - g[y1 * gw + x0]!) * tx;
        const background = Math.max(floor, top + (bottom - top) * ty);
        out.data[p + c] = clamp(Math.round((data[p + c]! * PAPER_WHITE) / background));
      }
    }
  }
  return out;
}

/**
 * The card's whites are its brightest pixels: the share of the card read as "white" (`WHITE_SHARE`). Not
 * "its neutral pixels": under a coloured light nothing on the card is neutral, so a neutral test picks the
 * black print instead, and a gain taken from black print bleaches everything else (measured: the first
 * version of this did exactly that to the test card's blue bands).
 */
const WHITE_SHARE = 0.05;
/** A card's correction is gentler than a page's: it is one gain for the whole card, so it can be wrong everywhere at once. */
const MAX_CARD_GAIN = 1.8;
/** No channel is ever darkened by more than this. */
const MIN_CARD_GAIN = 0.85;
/**
 * The most one channel's gain may exceed another's. A card whose brightest areas are pale blue BY DESIGN
 * would otherwise be "corrected" to grey; capping the colour correction keeps a real cast's repair (a
 * phone's warm indoor light is ~1.25 between red and blue) and refuses to repaint a card.
 */
const MAX_CAST_RATIO = 1.35;

/** One per-channel gain for the whole card, taken from its brightest pixels. */
export function balanceCard(img: RgbImage): RgbImage {
  assertRgb(img, "balanceCard");
  const { data } = img;
  const pixels = img.width * img.height;
  const lumaHist = new Uint32Array(256);
  for (let p = 0; p < pixels * 3; p += 3) lumaHist[Math.round((data[p]! + data[p + 1]! + data[p + 2]!) / 3)]!++;
  const cut = percentile(lumaHist, pixels, 1 - WHITE_SHARE);

  const sum = [0, 0, 0];
  let n = 0;
  for (let p = 0; p < pixels * 3; p += 3) {
    if (Math.round((data[p]! + data[p + 1]! + data[p + 2]!) / 3) < cut) continue;
    sum[0]! += data[p]!;
    sum[1]! += data[p + 1]!;
    sum[2]! += data[p + 2]!;
    n++;
  }
  const raw = sum.map((s) => PAPER_WHITE / Math.max(1, s / n));
  const lowest = Math.min(...raw);
  const gains = raw.map((g) => cardGain(Math.min(g, lowest * MAX_CAST_RATIO)));

  const out = rgbImage(img.width, img.height);
  for (let p = 0; p < pixels * 3; p += 3) {
    for (let c = 0; c < 3; c++) out.data[p + c] = clamp(Math.round(data[p + c]! * gains[c]!));
  }
  return out;
}

const cardGain = (g: number): number => Math.min(MAX_CARD_GAIN, Math.max(MIN_CARD_GAIN, g));
const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

function percentile(hist: Uint32Array, total: number, q: number): number {
  let seen = 0;
  for (let v = 0; v < 256; v++) if ((seen += hist[v]!) >= q * total) return v;
  return 255;
}

/** Grey-level dilation of a grid by a square of radius r, separably. */
function maxFilter(grid: Float32Array, w: number, h: number, r: number): Float32Array {
  return separable(grid, w, h, r, (vals) => Math.max(...vals));
}

/** Box blur of a grid by a square of radius r, separably, edges clamped. */
function blur(grid: Float32Array, w: number, h: number, r: number): Float32Array {
  return separable(grid, w, h, r, (vals) => vals.reduce((s, v) => s + v, 0) / vals.length);
}

function separable(grid: Float32Array, w: number, h: number, r: number, f: (vals: number[]) => number): Float32Array {
  const pass = (src: Float32Array, horizontal: boolean): Float32Array => {
    const out = new Float32Array(src.length);
    const [lines, len] = horizontal ? [h, w] : [w, h];
    for (let line = 0; line < lines; line++) {
      const at = (i: number): number => (horizontal ? line * w + i : i * w + line);
      for (let i = 0; i < len; i++) {
        const vals: number[] = [];
        for (let k = i - r; k <= i + r; k++) vals.push(src[at(Math.min(len - 1, Math.max(0, k)))]!);
        out[at(i)] = f(vals);
      }
    }
    return out;
  };
  return pass(pass(grid, true), false);
}
