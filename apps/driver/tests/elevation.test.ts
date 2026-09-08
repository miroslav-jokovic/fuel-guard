import { describe, expect, it } from 'vitest';
import roleValues from '@/theme/theme.roles.json';
import { contrastRatio } from '../scripts/srgb.mjs';
import { cardElevation, cardSurfaceClass, castsShadow, heroCardSurfaceClass, type ElevationStep } from '@/theme/elevation';
import { HERO_TEXTURES, heroTextureOpacity } from '@/theme/heroTexture';
import type { ThemeKey } from '@/theme/colors';

const appearances = Object.keys(roleValues) as ThemeKey[];
const steps: ElevationStep[] = ['resting', 'raised'];

/**
 * D-DB19. The point of these is not that the numbers are pretty — it is that the two steps are
 * DISTINGUISHABLE and that each appearance expresses them in the way its own ground can show,
 * which is the part a screenshot on one device would never have caught.
 */
describe('the two-step elevation scale', () => {
  it('casts a shadow only where there is a lighter surface to cast against', () => {
    for (const appearance of appearances) {
      const roles = roleValues[appearance] as Record<string, string>;
      const flat = roles.surface === roles['surface-raised'];
      // Light and high-contrast light have surface === surface-raised (both pure white), so there is
      // nowhere to climb and the step must be cast. The dark appearances have a real raise, and a
      // cast shadow on their near-black canvas is invisible anyway.
      expect(castsShadow(appearance), `${appearance}`).toBe(flat);
    }
  });

  it('gives the raised step more presence than the resting one, wherever it is cast', () => {
    for (const appearance of appearances.filter(castsShadow)) {
      const resting = cardElevation(appearance, 'resting');
      const raised = cardElevation(appearance, 'raised');
      expect(resting, `${appearance} resting`).toBeDefined();
      expect(raised, `${appearance} raised`).toBeDefined();
      expect(raised!.shadowOpacity).toBeGreaterThan(resting!.shadowOpacity);
      expect(raised!.shadowOffset.height).toBeGreaterThan(resting!.shadowOffset.height);
      expect(raised!.elevation).toBeGreaterThan(resting!.elevation);
      // Tinted with the hero navy, never a neutral black — a black shadow reads as grime on a warm
      // ground, which is why D-DB5 reserved shadowColor to this module in the first place.
      const hero = (roleValues[appearance] as Record<string, string>).hero ?? '';
      expect(raised!.shadowColor).toBe(`rgb(${hero.split(' ').join(', ')})`);
    }
  });

  it('returns no shadow at all for the appearances that cannot show one', () => {
    for (const appearance of appearances.filter((a) => !castsShadow(a))) {
      for (const step of steps) {
        expect(cardElevation(appearance, step), `${appearance} ${step}`).toBeUndefined();
      }
    }
  });

  it('climbs a real surface step in the dark appearances', () => {
    for (const appearance of appearances.filter((a) => !castsShadow(a))) {
      const roles = roleValues[appearance] as Record<string, string>;
      expect(cardSurfaceClass(appearance, 'resting')).toContain('bg-surface');
      expect(cardSurfaceClass(appearance, 'raised')).toContain('bg-surface-raised');
      // A step nobody can see is not a step. Both cards must also separate from the canvas they
      // sit on, which is the failure the dark appearances actually had.
      const channel = (role: string) => Number((roles[role] ?? '0 0 0').split(' ')[0]);
      const climb = channel('surface-raised') - channel('surface');
      expect(climb, `${appearance} surface → surface-raised`).toBeGreaterThanOrEqual(10);
      expect(
        contrastRatio(roles.surface ?? '', roles.canvas ?? ''),
        `${appearance} a resting card against its canvas`,
      ).toBeGreaterThan(1.1);
    }
  });

  /**
   * D-DB22. The hero card is translucent so the artwork behind it reads through. It is navy-tinted
   * rather than white-tinted for a measured reason, and this is that reason: `on-hero-muted` had
   * 0.02 of margin on the opaque fill it replaced, so lightening the ground was never available.
   */
  it('keeps the translucent hero card safe for the tightest tone it carries', () => {
    const ALPHA = 0.65; // matches `bg-hero/65` in heroCardSurfaceClass
    for (const appearance of appearances) {
      const roles = roleValues[appearance] as Record<string, string>;
      const opaque = heroCardSurfaceClass(appearance).includes('bg-hero-raised');
      if (opaque) {
        // High contrast draws no texture, so there is nothing to show through and the fill stays solid.
        expect(heroTextureOpacity(appearance), `${appearance}`).toBe(0);
        continue;
      }
      const hero = (roles.hero ?? '').split(' ').map(Number);
      const ground = hero
        .map((channel) => Math.round(HERO_TEXTURES.band.ceiling * (1 - ALPHA) + channel * ALPHA))
        .join(' ');
      for (const tone of ['on-hero', 'on-hero-secondary', 'on-hero-muted'] as const) {
        const translucent = contrastRatio(roles[tone] ?? '', ground);
        expect(translucent, `${tone} on the translucent hero card (${appearance}, ${ground})`).toBeGreaterThanOrEqual(4.5);
        // And it must not be a step BACKWARDS from the opaque fill it replaced.
        expect(
          translucent,
          `${tone}: translucent vs the hero-raised fill it replaced (${appearance})`,
        ).toBeGreaterThanOrEqual(contrastRatio(roles[tone] ?? '', roles['hero-raised'] ?? ''));
      }
    }
  });

  it('steps the edge alongside the surface, so the two are never told apart by fill alone', () => {
    for (const appearance of appearances.filter((a) => !castsShadow(a))) {
      expect(cardSurfaceClass(appearance, 'resting')).toContain('border-edge-subtle');
      expect(cardSurfaceClass(appearance, 'raised')).toContain('border-edge');
      expect(cardSurfaceClass(appearance, 'raised')).not.toContain('border-edge-subtle');
    }
  });
});
