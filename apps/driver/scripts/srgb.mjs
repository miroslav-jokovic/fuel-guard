/**
 * WCAG relative luminance and contrast, for build-time tooling. ONE home.
 *
 * WHY IT IS ITS OWN FILE. `tests/theme-colors.test.ts` carried this arithmetic inline, and
 * `scripts/gen-app-icons.mjs` needed the same thing on 2026-09-07 to decide which of the brand
 * mark's fills should become white. Two copies of a formula is the copy-with-a-delay-fuse the root
 * CLAUDE.md warns about, and `lint:scanner-parity` is the gate that noticed: the Rec.709 weights
 * below are the same three numbers the scanner's quality metrics use, so the repo already refuses to
 * let them appear in more than one place without saying why.
 *
 * IT IS NOT THE SCANNER'S LUMA, and the two must not be merged. `packages/capture-engine`'s metrics
 * compute a GAMMA-ENCODED luma over pixel buffers, for blur and glare. This applies the sRGB
 * transfer function FIRST and computes linear-light luminance, which is what WCAG 2.x defines
 * contrast in terms of. Pointing either at the other would silently change every number both
 * produce. This file is `check-scanner-parity.mjs`'s carve-out for exactly that reason.
 *
 * Accepts a colour as `#rgb`, `#rrggbb`, or the `"R G B"` channel triple `theme.roles.json` stores
 * for NativeWind's `rgb(var(--role))` — one entry point, because the two callers hold colours in
 * different forms and converting at each call site is how the second copy starts.
 */

/** @param {string} color `#rgb`, `#rrggbb`, or `"R G B"` @returns {[number, number, number]} 0-255 */
export function toChannels(color) {
  const value = String(color).trim();

  if (value.startsWith('#')) {
    const digits = value.slice(1);
    const full =
      digits.length === 3
        ? digits
            .split('')
            .map((c) => c + c)
            .join('')
        : digits;
    if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a hex colour: ${color}`);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  }

  const channels = value.split(/\s+/).map(Number);
  if (channels.length !== 3 || channels.some((c) => !Number.isInteger(c) || c < 0 || c > 255)) {
    throw new Error(`not three 0-255 channels: ${color}`);
  }
  return channels;
}

/** `#RRGGBB`, upper case. The inverse of the `"R G B"` half of `toChannels`. */
export function toHex(color) {
  return `#${toChannels(color)
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

/**
 * WCAG 2.x relative luminance: 0 for black, 1 for white.
 *
 * The sRGB-to-linear step is the part that is easy to drop and impossible to see. Mid-grey is 0.502
 * read raw and 0.216 decoded, and both look plausible.
 */
export function relativeLuminance(color) {
  const [r, g, b] = toChannels(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1:1 to 21:1. Order-independent by definition. */
export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The luminance at which white and black contrast EQUALLY against a colour:
 * `sqrt(1.05 × 0.05) − 0.05 = 0.1791`. Below it, white is the better ink; above it, black is.
 *
 * Derived rather than chosen, because a round "0.5" is untestable against a two-tone logo — every
 * colour in the Silvicom mark sits at 0.022 or 0.888, so any threshold between them classifies the
 * file identically and the constant means nothing. Found by mutation testing on 2026-09-07: two
 * mutants of the old 0.5 threshold survived, and this is what replaced it.
 */
export const WHITE_BEATS_BLACK_BELOW = Math.sqrt(1.05 * 0.05) - 0.05;
