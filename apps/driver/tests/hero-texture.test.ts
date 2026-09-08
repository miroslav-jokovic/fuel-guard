import { describe, expect, it } from 'vitest';
import roleValues from '@/theme/theme.roles.json';
import { contrastRatio } from '../scripts/srgb.mjs';
import { HERO_TEXTURE_CEILING, heroTextureOpacity, worstHeroBackground } from '@/theme/heroTexture';
import type { ThemeKey } from '@/theme/colors';

const appearances = Object.keys(roleValues) as ThemeKey[];

/**
 * D-DB20. The hero stopped being one flat colour, so every foreground that lands on it now lands on
 * a RANGE of colours. These assert the worst end of that range, which is the only end that matters.
 */
describe('the hero texture', () => {
  it('cannot cost a hero tone its contrast', () => {
    for (const appearance of appearances) {
      const worst = worstHeroBackground(appearance);
      const roles = roleValues[appearance] as Record<string, string>;
      for (const tone of ['on-hero', 'on-hero-secondary', 'on-hero-muted'] as const) {
        expect(
          contrastRatio(roles[tone] ?? '', worst),
          `${tone} on the brightest pixel the texture may produce (${appearance}, ${worst})`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('is switched off entirely in the high-contrast appearances', () => {
    // A decorative texture is what that setting exists to remove, and it would spend the very
    // margin the setting exists to create. Off means the hero is flat colour and the existing
    // assertions in theme-colors.test.ts are the whole story there.
    expect(heroTextureOpacity('highContrastLight')).toBe(0);
    expect(heroTextureOpacity('highContrastDark')).toBe(0);
    for (const appearance of ['highContrastLight', 'highContrastDark'] as const) {
      const hero = (roleValues[appearance] as Record<string, string>).hero;
      expect(worstHeroBackground(appearance).split(' ').map(Number)).toEqual(
        (hero ?? '').split(' ').map(Number),
      );
    }
  });

  it('is held back on the dark hero, where the texture lightens rather than darkens', () => {
    // The asset is toned toward the LIGHT hero (32 40 58). On the dark hero (15 18 25) it is the
    // brighter of the two, so it eats a white foreground's margin instead of adding to it.
    expect(heroTextureOpacity('dark')).toBeLessThan(heroTextureOpacity('light'));
  });

  it('keeps the ceiling below the hero tones it has to sit under', () => {
    // A ceiling at or above a foreground's own value would be a texture that can erase it outright,
    // whatever the ratio arithmetic says afterwards.
    for (const appearance of appearances.filter((a) => heroTextureOpacity(a) > 0)) {
      const roles = roleValues[appearance] as Record<string, string>;
      for (const tone of ['on-hero', 'on-hero-secondary', 'on-hero-muted'] as const) {
        const darkest = Math.min(...(roles[tone] ?? '').split(' ').map(Number));
        expect(HERO_TEXTURE_CEILING, `${tone} (${appearance})`).toBeLessThan(darkest);
      }
    }
  });
});
