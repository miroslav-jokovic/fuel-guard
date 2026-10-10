/**
 * The size a page is sent at, so the vision API never resizes it (DOCUMENT-READER-PLAN §7A D-DR16, R1).
 *
 * WHY. Claude's vision input has two resolution tiers (Anthropic, *Vision* and *Coordinates* docs,
 * read 2026-10-10): STANDARD — at most 1,568 px on either side AND at most 1,568 visual tokens, one token
 * per 28×28 patch — and HIGH-RESOLUTION, for Claude 4.7 and later — 2,576 px AND 4,784 tokens. An image
 * over either limit is downsized by the API, with a resample we neither choose nor see. Until this file
 * the working copy was capped at a 1,568 px LONG EDGE with no token check, so a letter page went out at
 * 1212×1568 = 2,464 tokens and the pinned Sonnet 4.6 shrank it again to 952×1232 — 7-pt type at about
 * 6 px, after two resamples. VLM-RobustBench (ICML 2026) measured resampling among the costliest
 * perturbations a vision model meets. So the page is resized ONCE, from the verified original, to the
 * exact size the model's tier accepts, and nothing downstream resizes it again.
 *
 * `resizedSize` is Anthropic's published reference implementation, transcribed (binary search on the long
 * edge, half-to-even rounding on the short one, the 28-px padding counted against the edge limit). It is
 * pinned by "standard tier: a 2000×1500 photo (Samsara's size, F-DR11) resizes to 1270×952 — LIVE, not
 * the table's 1269" and its neighbours — the docs' worked examples and the live API's own answers, not
 * numbers derived here.
 *
 * NOT YET: the docs' `transformations: { oversized_image: "error" }` on each image block, which turns a
 * silent server-side resize into a 400. SDK 0.107.0 does not type the field; it lands with the SDK
 * upgrade rather than as a cast around the request type.
 */

export type VisionTier = "standard" | "high";

export interface TierLimits {
  maxEdge: number;
  maxTokens: number;
}

export const TIER_LIMITS: Readonly<Record<VisionTier, TierLimits>> = {
  standard: { maxEdge: 1568, maxTokens: 1568 },
  high: { maxEdge: 2576, maxTokens: 4784 },
};

/**
 * Above 20 images in one request the API applies a stricter per-image limit; the docs' way to stay under
 * it on every platform is neither side over 2,000 px. Today a read sends at most `maxPdfPages` (10) pages,
 * so this binds only once an assembly (D-DR14) can be longer.
 */
export const MANY_IMAGES_THRESHOLD = 20;
export const MANY_IMAGES_MAX_EDGE = 2000;

/**
 * The tier of a model id. The docs name the high-resolution tier "Claude 4.7 and later models", so the
 * rule is the id's generation: `claude-<family>-<major>-<minor>[-date]` at 4.7 or later is high. Anything
 * else — an older `claude-3-5-sonnet-…` id, an alias this pattern does not know — is STANDARD: a page
 * sized for the standard tier fits both, so the wrong guess costs resolution, never a refused request.
 */
export function visionTierOf(model: string): VisionTier {
  const m = /^claude-[a-z]+-(\d+)-(\d+)(?:-|$)/.exec(model);
  if (!m) return "standard";
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > 4 || (major === 4 && minor >= 7) ? "high" : "standard";
}

/** Visual tokens an image costs: one per 28×28 patch. */
export function visualTokens(width: number, height: number): number {
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}

/** Python's round(): half to even, as the live API resolves an exact .5 (the docs' note on Math.round). */
function roundTiesToEven(value: number): number {
  const floor = Math.floor(value);
  if (value - floor !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

/** The size the API would resize an image to before padding; an image that already fits comes back unchanged. */
export function resizedSize(width: number, height: number, limits: TierLimits): { width: number; height: number } {
  const { maxEdge, maxTokens } = limits;
  const fits = (w: number, h: number): boolean =>
    Math.ceil(w / 28) * 28 <= maxEdge && Math.ceil(h / 28) * 28 <= maxEdge && visualTokens(w, h) <= maxTokens;
  if (fits(width, height)) return { width, height };
  if (height > width) {
    const r = resizedSize(height, width, limits);
    return { width: r.height, height: r.width };
  }
  const aspect = width / height;
  let lo = 1; // fits
  let hi = width; // does not
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid, Math.max(roundTiesToEven(mid / aspect), 1))) lo = mid;
    else hi = mid;
  }
  return { width: lo, height: Math.max(roundTiesToEven(lo / aspect), 1) };
}

/** The limits a read's pages are sized to: the model's tier, tightened when the request carries many images. */
export function sendLimitsFor(model: string, imageCount: number): TierLimits {
  const tier = TIER_LIMITS[visionTierOf(model)];
  return imageCount > MANY_IMAGES_THRESHOLD ? { ...tier, maxEdge: Math.min(tier.maxEdge, MANY_IMAGES_MAX_EDGE) } : tier;
}
