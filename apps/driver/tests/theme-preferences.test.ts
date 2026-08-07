import { describe, expect, it } from 'vitest';
import { resolveThemeKey } from '@/theme/preferences';

describe('resolveThemeKey', () => {
  it('follows the platform appearance in system mode', () => {
    expect(resolveThemeKey('system', 'light', 'standard', false)).toBe('light');
    expect(resolveThemeKey('system', 'dark', 'standard', false)).toBe('dark');
  });

  it('lets an explicit appearance override the platform', () => {
    expect(resolveThemeKey('light', 'dark', 'standard', false)).toBe('light');
    expect(resolveThemeKey('dark', 'light', 'standard', false)).toBe('dark');
  });

  it('automatically uses the high-contrast role map when requested by the platform', () => {
    expect(resolveThemeKey('system', 'light', 'system', true)).toBe('highContrastLight');
    expect(resolveThemeKey('system', 'dark', 'system', true)).toBe('highContrastDark');
  });

  it('supports explicit high contrast without changing light/dark intent', () => {
    expect(resolveThemeKey('light', 'dark', 'high', false)).toBe('highContrastLight');
    expect(resolveThemeKey('dark', 'light', 'high', false)).toBe('highContrastDark');
  });
});
