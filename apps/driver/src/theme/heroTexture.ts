import { roleColors, type ThemeKey } from './colors';

/**
 * The hero textures and their contrast budgets (D-DB20, extended by D-DB21).
 *
 * `assets/hero-*.webp` are not the owner's artwork as delivered — they are that artwork tone-mapped
 * toward the hero navy with a hard per-channel ceiling, and this file is where the ceilings live.
 *
 * The tone-mapping has to happen in the ASSET because the raw art has near-white light bands, and no
 * scrim can hold those down without erasing the texture along with them: at 34% over the hero a 255
 * pixel composites to 108, and pulling that back under budget needs a 76% flat scrim, at which point
 * nothing of the artwork survives. Compressing the highlights into the asset keeps the dark parts —
 * the contour lines, the road, the network — and removes only the glare.
 *
 * **The two ceilings differ because the two heroes carry different text**, which is the whole reason
 * this is a table rather than a constant. Measured against `theme.roles.json`: a white `on-hero`
 * still clears 4.5:1 against a background as light as grey 118, `on-hero-secondary` tolerates 86,
 * and `on-hero-muted` only 52. A screen hero carries all three, so it takes the tightest. The auth
 * mast carries the Silvicom mark and nothing else, so holding it to 52 would have thrown away the
 * sunset to protect a tone that is not on the screen.
 *
 * **A ceiling alone is not enough, and that is the lesson of 2026-09-08.** The first generator
 * blended each pixel toward the hero navy by a gamma curve, which pulls the darks UP exactly as hard
 * as it pulls the highlights down. At the band's ceiling of 52 the whole image ended up living
 * between levels 48 and 54 — **six levels of range** — and the owner's report was simply that he
 * could not see the artwork at all. The auth texture read fine because its looser ceiling left it 32
 * levels. So a texture needs a FLOOR as much as a ceiling: the generator now stretches the source's
 * 1st-to-99th percentile onto [floor, ceiling] instead of blending, and the band occupies 34 levels
 * at the same ceiling it always had. Nothing about the contrast budget moved — the brightest pixel is
 * still 52 — which is why this needed no tone changes, no card change, and no new assertions.
 *
 * Regenerate with `scripts/gen-hero-texture.swift` (it prints the span it mapped and the peak it hit):
 *
 *   swiftc -O -o /tmp/tonemap scripts/gen-hero-texture.swift
 *   /tmp/tonemap <source.png> /tmp/out.png <width> <height> <floor> <ceiling>
 *   cwebp -q 88 -m 6 /tmp/out.png -o assets/hero-<name>.webp
 *
 * Shipped: band `18 52` from the network-map source (34 levels of range, up from six), auth
 * `50 80` from the road crop (30 levels). The auth floor is far higher because its ceiling is
 * higher and its source is a photograph rather than line work — mapped to the same floor as the band
 * it turned into a night scene, at a measured mean of 33 against the 55.8 the owner had approved.
 *
 * NOTE THE GAP, because it is real: 'every texture is safe for every tone it is allowed to back'
 * asserts that the CEILINGS are safe. It cannot assert that a shipped `.webp` respects its ceiling —
 * decoding WebP in the test runner would be a dependency for one number. That half is the generator
 * (which prints its peak) plus a device measurement, and both were done for both assets; the numbers
 * are in the plan entries for 2026-09-08. Change an asset and you must re-measure.
 */
export type HeroTextureName = 'band' | 'auth';

export const HERO_TEXTURES = {
  /** Every hero screen. Capped at `on-hero-muted`'s tolerance, the tightest of the three. */
  band: { ceiling: 52, tones: ['on-hero', 'on-hero-secondary', 'on-hero-muted'] },
  /**
   * The auth mast only, which carries the white mark alone. `on-hero-muted` is NOT permitted there —
   * `lint:design` refuses that tone anywhere under the auth surfaces, because this looser ceiling is
   * only honest for as long as that stays true.
   */
  auth: { ceiling: 80, tones: ['on-hero', 'on-hero-secondary'] },
} as const satisfies Record<HeroTextureName, { ceiling: number; tones: readonly string[] }>;

/**
 * How strongly a texture is drawn per appearance. The assets are toned toward the LIGHT hero, so
 * they sit at full strength there and are held back on the dark hero, where every point of opacity
 * is spent out of a white foreground's margin rather than added to it. High contrast gets none at
 * all: a decorative texture is exactly what that setting exists to remove.
 */
export function heroTextureOpacity(themeKey: ThemeKey): number {
  if (themeKey === 'highContrastLight' || themeKey === 'highContrastDark') return 0;
  return themeKey === 'dark' ? 0.55 : 1;
}

/**
 * The worst background a hero foreground can land on: this texture's ceiling, drawn at this
 * appearance's opacity, over this appearance's hero. Returned as an `r g b` triple so the contrast
 * helper can read it directly.
 */
export function worstHeroBackground(themeKey: ThemeKey, texture: HeroTextureName = 'band'): string {
  const opacity = heroTextureOpacity(themeKey);
  const ceiling = HERO_TEXTURES[texture].ceiling;
  const hero = roleColors[themeKey].hero
    .replace(/^rgb\(|\)$/g, '')
    .split(',')
    .map((part) => Number(part.trim()));
  return hero
    .map((channel) => Math.round(channel * (1 - opacity) + ceiling * opacity))
    .join(' ');
}
