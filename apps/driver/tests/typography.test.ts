import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISPLAY_FACE, DISPLAY_FACE_BOLD, TYPE, textStyle, type TextVariant } from '@/theme/typography';

const ROOT = join(__dirname, '..');
const variants = Object.keys(TYPE) as TextVariant[];
const displayVariants = variants.filter((v) => TYPE[v].face === 'display');

describe('the type system (Visual 2026 D-DV8, D-DV15)', () => {
  it('sets exactly the screen title and the lone hero figure in the display face', () => {
    expect(displayVariants.sort()).toEqual(['numericHero', 'screenTitle']);
  });

  it('never promises tabular figures from the display face, which has no tnum', () => {
    for (const variant of displayVariants) {
      expect(textStyle(variant, { tabular: true }).fontVariant, variant).toBeUndefined();
    }
  });

  it('makes every figure that aligns with another tabular, in the platform face', () => {
    for (const variant of ['numericInline', 'numericCompact'] as const) {
      const style = textStyle(variant);
      expect(style.fontFamily, variant).toBeUndefined();
      expect(style.fontVariant, variant).toEqual(['tabular-nums']);
    }
    expect(textStyle('body', { tabular: true }).fontVariant).toEqual(['tabular-nums']);
    expect(textStyle('body').fontVariant).toBeUndefined();
  });

  it('gives platform text a weight and no family, so the OS face and Dynamic Type apply', () => {
    for (const variant of variants.filter((v) => TYPE[v].face === 'platform')) {
      const style = textStyle(variant);
      expect(style.fontFamily, variant).toBeUndefined();
      expect(style.fontWeight, variant).toMatch(/^[4-7]00$/);
    }
  });

  it('steps every platform weight up one under Bold Text, and the display face to its Black cut', () => {
    expect(textStyle('body').fontWeight).toBe('400');
    expect(textStyle('body', { boldText: true }).fontWeight).toBe('500');
    expect(textStyle('rowTitle', { boldText: true }).fontWeight).toBe('700');
    expect(textStyle('rowTitle', { weight: 'regular', boldText: true }).fontWeight).toBe('500');
    expect(textStyle('screenTitle').fontFamily).toBe(DISPLAY_FACE);
    expect(textStyle('screenTitle', { boldText: true }).fontFamily).toBe(DISPLAY_FACE_BOLD);
  });

  it('starts at 13pt: nothing a driver reads in a cab is smaller', () => {
    for (const variant of variants) expect(TYPE[variant].fontSize, variant).toBeGreaterThanOrEqual(13);
  });

  it('never gives the display face a line height that cuts the top off its capitals and figures', () => {
    // iOS trims an over-tall line from the top, so the line must keep the cap height: natural height
    // (ascent + descent) minus the space above the caps (ascent - cap height), i.e. descent + cap height.
    const font = readFileSync(join(ROOT, 'assets/fonts/BigShouldersDisplay-ExtraBold.ttf'));
    const table = (tag: string) => {
      for (let i = 0; i < font.readUInt16BE(4); i++) {
        if (font.toString('latin1', 12 + 16 * i, 16 + 16 * i) === tag) return font.readUInt32BE(20 + 16 * i);
      }
      throw new Error(`no ${tag} table`);
    };
    const upm = font.readUInt16BE(table('head') + 18);
    const descent = -font.readInt16BE(table('hhea') + 6);
    const capHeight = font.readInt16BE(table('OS/2') + 88);
    for (const variant of displayVariants) {
      const { fontSize, lineHeight } = TYPE[variant];
      const floor = ((descent + capHeight) / upm) * fontSize;
      expect(lineHeight, `${variant} at ${fontSize}pt keeps its cap height`).toBeGreaterThanOrEqual(Math.ceil(floor) + 1);
    }
  });

  it('loads exactly the two display cuts the styles ask for, from files that exist', () => {
    const layout = readFileSync(join(ROOT, 'app/_layout.tsx'), 'utf8');
    expect(layout).toContain('[DISPLAY_FACE]: require("../assets/fonts/BigShouldersDisplay-ExtraBold.ttf") as number');
    expect(layout).toContain('[DISPLAY_FACE_BOLD]: require("../assets/fonts/BigShouldersDisplay-Black.ttf") as number');
    for (const file of ['BigShouldersDisplay-ExtraBold.ttf', 'BigShouldersDisplay-Black.ttf', 'BigShouldersDisplay-OFL.txt']) {
      expect(() => readFileSync(join(ROOT, 'assets/fonts', file)), file).not.toThrow();
    }
  });
});
