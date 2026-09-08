import { roleColors, type ThemeKey } from './colors';

/**
 * The hero texture's contrast budget (D-DB20).
 *
 * `assets/hero-band.webp` is not the owner's artwork as delivered — it is that artwork tone-mapped
 * toward the hero navy with a hard per-channel ceiling, and this file is where the ceiling lives.
 *
 * It has to exist because the raw art has near-white light bands, and no scrim can hold those down
 * without erasing the texture along with them: at 34% over the hero, a 255 pixel composites to 108,
 * and pulling that back under budget needs a 76% flat scrim, at which point nothing of the artwork
 * survives. Compressing the highlights INTO the asset keeps the dark two thirds — the contour lines,
 * the road, the network — and removes only the glare.
 *
 * Regenerate with `scripts/gen-hero-texture.swift` (it prints the peak channel it achieved):
 *
 *   swiftc -O -o /tmp/tonemap scripts/gen-hero-texture.swift
 *   /tmp/tonemap <source.png> /tmp/hero.png 1206 904 52 1.7
 *   cwebp -q 88 -m 6 /tmp/hero.png -o assets/hero-band.webp
 *
 * NOTE THE GAP, because it is real: 'the hero texture cannot cost a hero tone its contrast' below
 * asserts that the CEILING is safe for every tone in every appearance. It cannot assert that the
 * shipped `.webp` respects the ceiling — decoding WebP in the test runner would be a dependency for
 * one number. That half is verified by the generator (which prints its peak) and by measuring the
 * device, and both were done on 2026-09-08: peak 52 at generation, worst on-screen background pixel
 * rgb(45,46,54) in light and rgb(32,33,41) in dark. Change the asset and you must re-measure.
 */
export const HERO_TEXTURE_CEILING = 52;

/**
 * How strongly the texture is drawn per appearance. The asset is toned toward the LIGHT hero, so it
 * sits at full strength there and is held back on the dark hero, where every point of opacity is
 * spent out of a white foreground's margin rather than added to it. High contrast gets none at all:
 * a decorative texture is exactly what that setting exists to remove.
 */
export function heroTextureOpacity(themeKey: ThemeKey): number {
  if (themeKey === 'highContrastLight' || themeKey === 'highContrastDark') return 0;
  return themeKey === 'dark' ? 0.55 : 1;
}

/**
 * The worst background a hero foreground can land on: the ceiling, drawn at this appearance's
 * opacity, over this appearance's hero. Returned as an `r g b` triple so the contrast helper can
 * read it directly.
 */
export function worstHeroBackground(themeKey: ThemeKey): string {
  const opacity = heroTextureOpacity(themeKey);
  const hero = roleColors[themeKey].hero
    .replace(/^rgb\(|\)$/g, '')
    .split(',')
    .map((part) => Number(part.trim()));
  return hero
    .map((channel) => Math.round(channel * (1 - opacity) + HERO_TEXTURE_CEILING * opacity))
    .join(' ');
}
