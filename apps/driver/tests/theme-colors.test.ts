import { describe, expect, it } from 'vitest';
import roleValues from '@/theme/theme.roles.json';

type Rgb = readonly [number, number, number];

function parseRgb(value: string): Rgb {
  const channels = value.split(' ').map(Number);
  if (channels.length !== 3) throw new Error(`Invalid RGB value: ${value}`);
  return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0];
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(parseRgb(foreground));
  const b = luminance(parseRgb(background));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('Direction B semantic colors', () => {
  it('keeps the same semantic vocabulary in every appearance', () => {
    const expected = Object.keys(roleValues.light).sort();
    for (const theme of Object.values(roleValues)) {
      expect(Object.keys(theme).sort()).toEqual(expected);
    }
  });

  it.each(Object.entries(roleValues))('%s keeps operational text and primary actions readable', (_, theme) => {
    const contentSurfaces = [
      'canvas',
      'surface',
      'surface-subtle',
      'surface-muted',
      'surface-raised',
      'surface-selected',
      'brand-subtle',
    ] as const;
    for (const background of contentSurfaces) {
      expect(contrast(theme.ink, theme[background]), `ink on ${background}`).toBeGreaterThanOrEqual(7);
    }
    for (const foreground of ['ink-secondary', 'ink-muted', 'ink-subtle'] as const) {
      for (const background of contentSurfaces) {
        expect(contrast(theme[foreground], theme[background]), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(theme['brand-fg'], theme.brand)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme['brand-fg'], theme['brand-pressed'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme['ink-inverse'], theme['surface-inverse'])).toBeGreaterThanOrEqual(7);
    expect(contrast(theme['ink-inverse'], theme.danger)).toBeGreaterThanOrEqual(4.5);
    for (const foreground of [
      'brand', 'danger', 'warning', 'caution', 'success', 'info',
      'operation-current', 'operation-next', 'operation-complete', 'operation-blocked',
      'sync-local', 'sync-pending', 'sync-failed',
      // Direction B §2.1: amber and lavender as TEXT on the sheet, wherever a chip or a row value
      // uses them. The fills (`action`, `accent`) are checked against their own foregrounds below.
      'action-ink', 'accent-ink',
    ] as const) {
      for (const background of contentSurfaces) {
        expect(contrast(theme[foreground], theme[background]), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  /**
   * The navy hero is the half of Direction B the old assertions could not see: `hero`, `hero-raised`
   * and `hero-tile` are not content surfaces, so nothing stopped a 12pt grey caption landing on navy
   * at 2:1. Per D-DB1 the hero carries only three foregrounds, and `on-hero-muted` is deliberately
   * held to the deepest ground alone — it may carry axis labels and timestamps, never anything a
   * driver has to read.
   */
  it.each(Object.entries(roleValues))('%s keeps the hero region readable', (_, theme) => {
    for (const background of ['hero', 'hero-raised'] as const) {
      expect(contrast(theme['on-hero'], theme[background]), `on-hero on ${background}`).toBeGreaterThanOrEqual(7);
    }
    for (const background of ['hero', 'hero-raised', 'hero-tile'] as const) {
      expect(contrast(theme['on-hero-secondary'], theme[background]), `on-hero-secondary on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(theme['on-hero-muted'], theme.hero), 'on-hero-muted on hero').toBeGreaterThanOrEqual(4.5);
  });

  /**
   * Fills and the one foreground each is allowed to carry. `action` and `accent` hold the same value
   * in every appearance — they are the safety amber and the lavender, not theme-relative inks — so
   * their text is `action-fg`, never `ink`: in the dark themes `ink` is near-white and would land on
   * lavender at 1.4:1.
   */
  it.each(Object.entries(roleValues))('%s keeps text on the action and accent fills readable', (_, theme) => {
    expect(contrast(theme['action-fg'], theme.action), 'action-fg on action').toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme['action-fg'], theme['action-pressed']), 'action-fg on action-pressed').toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme['action-fg'], theme.accent), 'action-fg on accent').toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.success, theme['success-soft']), 'success on success-soft').toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.danger, theme['danger-soft']), 'danger on danger-soft').toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme['accent-ink'], theme['accent-soft']), 'accent-ink on accent-soft').toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme['action-ink'], theme['action-soft']), 'action-ink on action-soft').toBeGreaterThanOrEqual(4.5);
  });
});
