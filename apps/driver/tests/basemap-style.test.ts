import { describe, expect, it } from 'vitest';
import roleValues from '@/theme/theme.roles.json';
import upstream from '@/lib/basemap/openfreemap-liberty.json';
import { basemapPalette, basemapStyle, paintedColours } from '@/lib/basemap/basemapStyle';

const rgb = (s: string) => s.match(/\d+/g)!.map(Number) as [number, number, number];

/**
 * Hue in degrees and chroma 0–1 (how far from grey) of an "rgb(r, g, b)" colour. Chroma, not HSL
 * saturation: HSL calls a near-black navy "87% saturated", which is not what an eye sees.
 */
function hueChroma(colour: string): { hue: number; chroma: number } {
  const [r, g, b] = rgb(colour).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = 60 * (((g - b) / d) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
  }
  return { hue: (hue + 360) % 360, chroma: d };
}

describe('basemapStyle (D-DV28)', () => {
  for (const isDark of [false, true]) {
    const theme = isDark ? 'dark' : 'light';
    const style = basemapStyle(isDark);

    it(`paints nothing yellow, orange or amber in the ${theme} theme`, () => {
      for (const colour of paintedColours(style).filter((c) => c.startsWith('rgb('))) {
        const { hue, chroma } = hueChroma(colour);
        // Amber (our ONE action colour) and liberty's yellow/orange roads sit at 20–65°.
        if (chroma > 0.06) expect([colour, hue >= 20 && hue <= 65]).toEqual([colour, false]);
      }
    });

    it(`leaves no upstream colour literal behind in the ${theme} theme`, () => {
      const colours = paintedColours(style).filter((c) => /^(#|hsl|rgba?\()/.test(c));
      expect(colours.every((c) => c.startsWith('rgb('))).toBe(true);
    });

    it(`draws the land in the app's own canvas colour in the ${theme} theme`, () => {
      const background = style.layers.find((l) => l.id === 'background') as unknown as { paint: Record<string, string> };
      expect(rgb(background.paint['background-color']!)).toEqual(roleValues[theme].canvas.split(' ').map(Number));
    });

    it(`removes POI labels, the shaded relief and 3D buildings, and keeps highway shields, in the ${theme} theme`, () => {
      const ids = style.layers.map((l) => l.id);
      expect(ids.some((id) => id.startsWith('poi'))).toBe(false);
      expect(ids).not.toContain('natural_earth');
      expect(ids).not.toContain('building-3d');
      expect(ids).toContain('highway-shield-us-interstate');
      expect(Object.keys(style.sources)).toEqual(['openmaptiles']);
    });
  }

  it('draws the same map in both themes, layer for layer', () => {
    expect(basemapStyle(true).layers.map((l) => l.id)).toEqual(basemapStyle(false).layers.map((l) => l.id));
  });

  it('keeps OpenFreeMap tiles, glyphs and sprite, so only the colours are ours', () => {
    const style = basemapStyle(false);
    expect(style.glyphs).toBe(upstream.glyphs);
    expect(style.sprite).toBe(upstream.sprite);
    expect(style.version).toBe(8);
  });

  it('keeps water blue but too muted to read as the live cyan', () => {
    for (const isDark of [false, true]) {
      const { hue, chroma } = hueChroma(basemapPalette(isDark).water);
      const live = hueChroma(`rgb(${roleValues[isDark ? 'dark' : 'light'].accent.split(' ').join(', ')})`);
      expect(hue).toBeGreaterThan(180);
      expect(hue).toBeLessThan(230);
      // The live cyan is at full chroma (0.89); water stays under a third of it.
      expect(chroma).toBeLessThan(live.chroma / 3);
    }
  });
});

describe('basemapStyle leaves nothing to MapLibre\'s black default', () => {
  it('gives every fill and line a colour of its own, in both themes', () => {
    for (const isDark of [false, true]) {
      for (const layer of basemapStyle(isDark).layers as { id: string; type: string; paint?: Record<string, unknown> }[]) {
        if (layer.type === 'fill') expect([layer.id, 'fill-color' in (layer.paint ?? {})]).toEqual([layer.id, true]);
        if (layer.type === 'line') expect([layer.id, 'line-color' in (layer.paint ?? {})]).toEqual([layer.id, true]);
      }
    }
  });
});
