/**
 * WCAG 2.x relative luminance and contrast. ONE home, for runtime and tooling alike.
 *
 * Moved here on 2026-11-01 from `apps/driver/scripts/srgb.mjs` (which still owns colour parsing for its
 * build tooling and now imports this) when the ads render check (`ads/renderGeometry.ts`) needed the
 * same arithmetic at runtime: a second copy is what `lint:scanner-parity` exists to refuse, and the
 * driver's build script was not a home the API or the web app could import.
 *
 * IT IS NOT THE SCANNER'S LUMA, and the two must not be merged. `packages/capture-engine`'s metrics
 * compute a GAMMA-ENCODED luma over pixel buffers, for blur and glare. This applies the sRGB transfer
 * function FIRST and computes linear-light luminance, which is what WCAG 2.x defines contrast in terms
 * of. This file is `check-scanner-parity.mjs`'s carve-out for exactly that reason.
 *
 * ⚠ NO IMPORTS, and erasable TypeScript only: `apps/driver/scripts/srgb.mjs` is run by plain `node`
 * (`gen:icons`), which loads this file through Node's own type stripping.
 */

export type RgbChannels = readonly [number, number, number];

/** WCAG 2.x relative luminance of 0–255 sRGB channels: 0 for black, 1 for white. */
export function relativeLuminanceOf(channels: RgbChannels): number {
  const [r, g, b] = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1:1 to 21:1. Order-independent by definition. */
export function contrastRatioOf(a: RgbChannels, b: RgbChannels): number {
  const la = relativeLuminanceOf(a);
  const lb = relativeLuminanceOf(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
