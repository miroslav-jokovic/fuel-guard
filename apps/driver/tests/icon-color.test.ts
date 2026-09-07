import { describe, expect, it, vi } from 'vitest';
import { roleColors } from '@/theme/colors';
import {
  resolveIconColor,
  roleKeyForToken,
  tokenFromClassName,
} from '@/theme/iconColor';

/**
 * The bug this exists for (2026-09-07): `Icon` resolved its colour through a hand-written `switch`
 * covering 19 of the theme's ~50 roles, and anything unlisted fell through to `ink` SILENTLY. The
 * navy tab bar passes `text-on-hero` and `text-on-hero-muted`; neither was a case; all four tab
 * icons rendered in near-black ink on a near-black bar and the tab bar looked like it had none.
 *
 * So the cases below are mostly about the roles nobody thought to list, and about the fallback being
 * loud rather than quiet.
 */

const light = roleColors.light;

describe('tokenFromClassName', () => {
  it('finds the token when the class stands alone', () => {
    expect(tokenFromClassName('text-on-hero')).toBe('on-hero');
  });

  it('finds it among other classes', () => {
    expect(tokenFromClassName('mt-1 text-ink-muted shrink-0')).toBe('ink-muted');
  });

  it('takes the whole hyphenated token, not the first segment', () => {
    // Stopping at the first hyphen turns `on-hero-muted` into `on`, which names no role and lands
    // back on the silent ink fallback — the same invisible icon by a different route.
    expect(tokenFromClassName('text-on-hero-muted')).toBe('on-hero-muted');
  });

  it('is undefined when there is no text- class', () => {
    expect(tokenFromClassName('bg-hero rounded-t-2xl')).toBeUndefined();
    expect(tokenFromClassName(undefined)).toBeUndefined();
  });

  it('does not match a class that merely contains "text-"', () => {
    expect(tokenFromClassName('mytext-hero')).toBeUndefined();
  });
});

describe('roleKeyForToken', () => {
  it('camel-cases a kebab role name the way colors.ts does', () => {
    expect(roleKeyForToken('on-hero')).toBe('onHero');
    expect(roleKeyForToken('on-hero-secondary')).toBe('onHeroSecondary');
    expect(roleKeyForToken('sync-failed')).toBe('syncFailed');
  });

  it('leaves a single-word role alone', () => {
    expect(roleKeyForToken('danger')).toBe('danger');
  });

  it('maps brand-fg to inkInverse, the one token that is not a role', () => {
    expect(roleKeyForToken('brand-fg')).toBe('inkInverse');
  });
});

describe('resolveIconColor', () => {
  it('resolves the hero roles the tab bar uses — the ones the old switch missed', () => {
    expect(resolveIconColor('text-on-hero', undefined, light)).toBe(light.onHero);
    expect(resolveIconColor('text-on-hero-muted', undefined, light)).toBe(light.onHeroMuted);
  });

  it('gives the hero roles a colour that is NOT ink', () => {
    // The regression was invisible precisely because the wrong answer was a valid colour. This is
    // the assertion that would have failed while the switch was in place.
    expect(resolveIconColor('text-on-hero', undefined, light)).not.toBe(light.ink);
    expect(resolveIconColor('text-on-hero-muted', undefined, light)).not.toBe(light.ink);
  });

  it('still resolves every role the old switch listed', () => {
    for (const [token, key] of [
      ['brand', 'brand'],
      ['danger', 'danger'],
      ['warning', 'warning'],
      ['success', 'success'],
      ['info', 'info'],
      ['ink', 'ink'],
      ['ink-secondary', 'inkSecondary'],
      ['ink-inverse', 'inkInverse'],
      ['ink-subtle', 'inkSubtle'],
      ['ink-muted', 'inkMuted'],
      ['sync-failed', 'syncFailed'],
      ['operation-current', 'operationCurrent'],
      ['brand-fg', 'inkInverse'],
    ] as const) {
      expect(resolveIconColor(`text-${token}`, undefined, light)).toBe(
        (light as unknown as Record<string, string>)[key],
      );
    }
  });

  it('prefers an explicit colour over the class', () => {
    expect(resolveIconColor('text-danger', '#123456', light)).toBe('#123456');
  });

  it('falls back to ink when there is no class at all', () => {
    expect(resolveIconColor(undefined, undefined, light)).toBe(light.ink);
  });

  it('reports an unknown token instead of swallowing it', () => {
    const onUnknown = vi.fn();
    expect(resolveIconColor('text-not-a-role', undefined, light, onUnknown)).toBe(light.ink);
    expect(onUnknown).toHaveBeenCalledWith('not-a-role');
  });

  it('does not report a token it resolved', () => {
    const onUnknown = vi.fn();
    resolveIconColor('text-on-hero', undefined, light, onUnknown);
    expect(onUnknown).not.toHaveBeenCalled();
  });

  it('works in every appearance, not only light', () => {
    for (const appearance of ['light', 'dark', 'highContrastLight', 'highContrastDark'] as const) {
      const colors = roleColors[appearance];
      expect(resolveIconColor('text-on-hero', undefined, colors)).toBe(colors.onHero);
    }
  });
});
