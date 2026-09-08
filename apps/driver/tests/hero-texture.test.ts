import { describe, expect, it } from 'vitest';
import roleValues from '@/theme/theme.roles.json';
import { contrastRatio } from '../scripts/srgb.mjs';
import { HERO_TEXTURES, heroTextureOpacity, worstHeroBackground, type HeroTextureName } from '@/theme/heroTexture';
import type { ThemeKey } from '@/theme/colors';

const appearances = Object.keys(roleValues) as ThemeKey[];

/**
 * D-DB20. The hero stopped being one flat colour, so every foreground that lands on it now lands on
 * a RANGE of colours. These assert the worst end of that range, which is the only end that matters.
 */
describe('the hero texture', () => {
  it('every texture is safe for every tone it is allowed to back', () => {
    for (const [name, texture] of Object.entries(HERO_TEXTURES) as [HeroTextureName, (typeof HERO_TEXTURES)[HeroTextureName]][]) {
      for (const appearance of appearances) {
        const worst = worstHeroBackground(appearance, name);
        const roles = roleValues[appearance] as Record<string, string>;
        for (const tone of texture.tones) {
          expect(
            contrastRatio(roles[tone] ?? '', worst),
            `${name}: ${tone} on the brightest pixel it may produce (${appearance}, ${worst})`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('gives the screen hero the tighter ceiling, because it carries the tone with the least room', () => {
    // The auth mast may be looser ONLY because it carries the mark alone. If the two ever converge,
    // the looser one has stopped being a deliberate choice and become an accident.
    expect(HERO_TEXTURES.band.ceiling).toBeLessThan(HERO_TEXTURES.auth.ceiling);
    expect(HERO_TEXTURES.band.tones).toContain('on-hero-muted');
    expect(HERO_TEXTURES.auth.tones).not.toContain('on-hero-muted');
  });

  it('is switched off entirely in the high-contrast appearances', () => {
    // A decorative texture is what that setting exists to remove, and it would spend the very
    // margin the setting exists to create. Off means the hero is flat colour and the existing
    // assertions in theme-colors.test.ts are the whole story there.
    expect(heroTextureOpacity('highContrastLight')).toBe(0);
    expect(heroTextureOpacity('highContrastDark')).toBe(0);
    for (const appearance of ['highContrastLight', 'highContrastDark'] as const) {
      const hero = (roleValues[appearance] as Record<string, string>).hero;
      expect(worstHeroBackground(appearance, 'band').split(' ').map(Number)).toEqual(
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
    for (const [name, texture] of Object.entries(HERO_TEXTURES) as [HeroTextureName, (typeof HERO_TEXTURES)[HeroTextureName]][]) {
      for (const appearance of appearances.filter((a) => heroTextureOpacity(a) > 0)) {
        const roles = roleValues[appearance] as Record<string, string>;
        for (const tone of texture.tones) {
          const darkest = Math.min(...(roles[tone] ?? '').split(' ').map(Number));
          expect(texture.ceiling, `${name}: ${tone} (${appearance})`).toBeLessThan(darkest);
        }
      }
    }
  });
});
