import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICON_FACE, ICON_FACE_FILL, iconGlyph } from '@/theme/iconFont';
import { MATERIAL_SYMBOLS } from '@/theme/materialSymbols.generated';

const ROOT = join(__dirname, '..');

/** The codepoints in a TrueType file's format-4 or format-12 cmap, read without a font library. */
function cmapCodepoints(file: string): Set<number> {
  const font = readFileSync(join(ROOT, 'assets/fonts', file));
  let cmap = -1;
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    if (font.toString('latin1', 12 + 16 * i, 16 + 16 * i) === 'cmap') cmap = font.readUInt32BE(20 + 16 * i);
  }
  const out = new Set<number>();
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const sub = cmap + font.readUInt32BE(cmap + 4 + 8 * i + 4);
    const format = font.readUInt16BE(sub);
    if (format === 12) {
      const groups = font.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g++) {
        const start = font.readUInt32BE(sub + 16 + 12 * g);
        const end = font.readUInt32BE(sub + 20 + 12 * g);
        for (let c = start; c <= end; c++) out.add(c);
      }
    } else if (format === 4) {
      const segX2 = font.readUInt16BE(sub + 6);
      for (let s = 0; s < segX2; s += 2) {
        const end = font.readUInt16BE(sub + 14 + s);
        const start = font.readUInt16BE(sub + 16 + segX2 + s);
        for (let c = start; c <= end && c !== 0xffff; c++) out.add(c);
      }
    }
  }
  return out;
}

describe('icons are Material Symbols glyphs (Visual 2026 D-DV11, V8)', () => {
  it('every icon name has its glyph in both bundled fonts, outline and filled', () => {
    for (const file of ['MaterialSymbolsRounded.ttf', 'MaterialSymbolsRoundedFill.ttf']) {
      const present = cmapCodepoints(file);
      const missing = Object.entries(MATERIAL_SYMBOLS).filter(([, cp]) => !present.has(cp)).map(([n]) => n);
      expect(missing, file).toEqual([]);
    }
  });

  it('draws the name\'s own codepoint, in the filled face only when asked', () => {
    expect(iconGlyph('schedule', false, 24)).toMatchObject({
      glyph: String.fromCodePoint(MATERIAL_SYMBOLS.schedule),
      style: { fontFamily: ICON_FACE, fontSize: 24, width: 24, height: 24 },
    });
    expect(iconGlyph('check_circle', true, 18).style.fontFamily).toBe(ICON_FACE_FILL);
  });

  it('loads the two faces the glyphs ask for, from the files that hold them', () => {
    const layout = readFileSync(join(ROOT, 'app/_layout.tsx'), 'utf8');
    expect(layout).toContain('[ICON_FACE]: require("../assets/fonts/MaterialSymbolsRounded.ttf") as number');
    expect(layout).toContain('[ICON_FACE_FILL]: require("../assets/fonts/MaterialSymbolsRoundedFill.ttf") as number');
  });
});
