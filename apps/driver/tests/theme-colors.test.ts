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

describe('Design System 2.0 semantic colors', () => {
  it('keeps the same semantic vocabulary in every appearance', () => {
    const expected = Object.keys(roleValues.light).sort();
    for (const theme of Object.values(roleValues)) {
      expect(Object.keys(theme).sort()).toEqual(expected);
    }
  });

  it.each(Object.entries(roleValues))('%s keeps operational text and primary actions readable', (_, theme) => {
    expect(contrast(theme.ink, theme.canvas)).toBeGreaterThanOrEqual(7);
    expect(contrast(theme['ink-secondary'], theme.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme['ink-muted'], theme.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme['brand-fg'], theme.brand)).toBeGreaterThanOrEqual(4.5);
  });
});
