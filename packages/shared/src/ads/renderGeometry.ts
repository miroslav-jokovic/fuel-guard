/**
 * The render check of D-AD12, pure: where text may sit on each format, and whether it can be read.
 * The overlay renderer (C4, `@napi-rs/canvas`) measures; this file judges. Nothing here draws.
 *
 * ── SAFE ZONES ─────────────────────────────────────────────────────────────────────────────────────
 * Reels and Stories cover the top and bottom of a 9:16 frame with the account name, the caption and
 * the call-to-action button, so text placed there is hidden. The fractions below are conservative
 * defaults, wider than the margins commonly published for Reels (top ~14 %, bottom ~35 %); a brand
 * kit may TIGHTEN a zone (`tightenZone`) but never widen it. Feed formats get a uniform margin so a
 * crop on a small screen never cuts a figure. Measured against Meta's own placement preview at L4
 * (workflow §4R), when the sandbox exists — recorded as such, not as a citation.
 *
 * ── CONTRAST IS MEASURED OVER THE TEXT'S ZONE, NOT THE IMAGE ───────────────────────────────────────
 * The Higgsfield memory records the trap: an image's average colour can pass while the strip behind a
 * headline fails. So the caller samples the pixels under the text's box and passes them in, and the
 * check takes the WORST sample. WCAG 2.x relative luminance and contrast ratio; 4.5:1 for body text,
 * 3:1 for large text (≥ 24 px, or ≥ 18.66 px bold — WCAG's 18 pt / 14 pt bold at 96 dpi).
 */

import { contrastRatioOf, type RgbChannels } from "../srgb.js";

export const AD_FORMATS = ["1:1", "4:5", "9:16"] as const;
export type AdFormat = (typeof AD_FORMATS)[number];

export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }

/** Meta's recommended pixel sizes for each aspect. */
export const FORMAT_SIZE: Record<AdFormat, Size> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

/** Fractions of the frame kept clear: top, right, bottom, left. */
const CLEAR: Record<AdFormat, [number, number, number, number]> = {
  "1:1": [0.06, 0.06, 0.06, 0.06],
  "4:5": [0.06, 0.06, 0.06, 0.06],
  "9:16": [0.15, 0.08, 0.36, 0.08],
};

/** The rectangle text may occupy on this format, in pixels, rounded inward. */
export function safeZone(format: AdFormat): Rect {
  const { width, height } = FORMAT_SIZE[format];
  const [t, r, b, l] = CLEAR[format];
  const x = Math.ceil(width * l);
  const y = Math.ceil(height * t);
  return { x, y, width: Math.floor(width * (1 - r)) - x, height: Math.floor(height * (1 - b)) - y };
}

/** A brand kit's own zone, accepted only inside the default one. */
export function tightenZone(base: Rect, wanted: Rect): Rect | null {
  return contains(base, wanted) ? wanted : null;
}

export function contains(outer: Rect, inner: Rect): boolean {
  return inner.width >= 0 && inner.height >= 0
    && inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

// ── contrast ────────────────────────────────────────────────────────────────────────────────────
export type Rgb = RgbChannels;

/** "#0B3D2E" or "0b3d2e" → [11, 61, 46]; null for anything else. */
export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG contrast, from the one definition (`../srgb.ts`). */
export const contrastRatio = (a: Rgb, b: Rgb): number => contrastRatioOf(a, b);

export function isLargeText(px: number, bold: boolean): boolean {
  return px >= 24 || (bold && px >= 18.66);
}

export function requiredContrast(px: number, bold: boolean): number {
  return isLargeText(px, bold) ? 3 : 4.5;
}

// ── the check for one placed text block ─────────────────────────────────────────────────────────
export interface PlacedText {
  /** What the block says, for the finding. */
  label: string;
  /** The box the renderer measured the text into. */
  box: Rect;
  /** The width the text needed at its size; over `box.width` means it would overflow. */
  needed_width: number;
  px: number;
  bold: boolean;
  color: Rgb;
  /** Pixels sampled under `box` (and its plate, if one is drawn). At least one. */
  background_samples: readonly Rgb[];
}

export type RenderFinding =
  | { kind: "outside_safe_zone"; label: string }
  | { kind: "overflows"; label: string; needed_width: number; width: number }
  | { kind: "low_contrast"; label: string; worst: number; required: number }
  | { kind: "no_background_samples"; label: string };

/**
 * Every finding for one format's overlay. Empty means the render check is green. A block that does not
 * fit is a finding — the renderer must refuse rather than shrink below the brand kit's size or let the
 * line run off the frame (workflow C4: "a too-long line refuses rather than overflows").
 */
export function checkRender(format: AdFormat, blocks: readonly PlacedText[], zone: Rect = safeZone(format)): RenderFinding[] {
  const out: RenderFinding[] = [];
  for (const b of blocks) {
    if (!contains(zone, b.box)) out.push({ kind: "outside_safe_zone", label: b.label });
    if (b.needed_width > b.box.width) out.push({ kind: "overflows", label: b.label, needed_width: b.needed_width, width: b.box.width });
    if (b.background_samples.length === 0) {
      out.push({ kind: "no_background_samples", label: b.label });
      continue;
    }
    const worst = Math.min(...b.background_samples.map((s) => contrastRatio(b.color, s)));
    const required = requiredContrast(b.px, b.bold);
    if (worst < required) out.push({ kind: "low_contrast", label: b.label, worst: Math.round(worst * 100) / 100, required });
  }
  return out;
}
