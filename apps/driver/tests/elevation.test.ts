import { describe, expect, it } from 'vitest';
import roleValues from '@/theme/theme.roles.json';
import { contrastRatio } from '../scripts/srgb.mjs';
import { cardElevation, cardSurfaceClass, castsShadow, type ElevationStep } from '@/theme/elevation';
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

  it('steps the edge alongside the surface, so the two are never told apart by fill alone', () => {
    for (const appearance of appearances.filter((a) => !castsShadow(a))) {
      expect(cardSurfaceClass(appearance, 'resting')).toContain('border-edge-subtle');
      expect(cardSurfaceClass(appearance, 'raised')).toContain('border-edge');
      expect(cardSurfaceClass(appearance, 'raised')).not.toContain('border-edge-subtle');
    }
  });
});
