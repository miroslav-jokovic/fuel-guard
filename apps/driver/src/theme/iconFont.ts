import type { TextStyle } from 'react-native';
import { MATERIAL_SYMBOLS, type MaterialSymbolName } from './materialSymbols.generated';

/**
 * Icons are glyphs of the bundled Material Symbols font (Visual 2026 D-DV11, step V8), not SVG.
 *
 * WHY. `Icon` drew HugeIcons through a hand-written name map (`hugeIcons.ts`), and the map was wrong
 * where it could not find a match: `schedule` drew an hourglass, both `radio_button_*` drew the same
 * ring, `pin_drop` drew an envelope with a pin. Every call site names a Material Symbol already, and
 * the fonts subset to exactly those names were bundled and unused. A name now IS its glyph.
 *
 * MEASURED, 2026-11-20: all 112 codepoints in `materialSymbols.generated.ts` equal Google's published
 * list (material-design-icons `variablefont/MaterialSymbolsRounded[…].codepoints`), and both bundled
 * fonts carry every one of them in their cmap. The fonts are subset by codepoint with no ligature
 * table, so the codepoint is the only way in, which is what `glyph` returns.
 *
 * iOS's SF Symbols, the other half of D-DV11, need `expo-symbols`, a native module, and wait for the
 * next native build (V3b or V9). Until then both platforms draw Material Symbols, which is still the
 * platform-family look D-DV11 asks for and one icon set instead of a vendor's.
 */
export const ICON_FACE = 'MaterialSymbolsRounded';
export const ICON_FACE_FILL = 'MaterialSymbolsRoundedFill';

export function iconGlyph(name: MaterialSymbolName, fill: boolean, size: number): { glyph: string; style: TextStyle } {
  return {
    glyph: String.fromCodePoint(MATERIAL_SYMBOLS[name]),
    style: {
      fontFamily: fill ? ICON_FACE_FILL : ICON_FACE,
      fontSize: size,
      lineHeight: size,
      // The glyph box is the icon's box: no Android font padding, no wrap, centred in a square.
      includeFontPadding: false,
      textAlign: 'center',
      width: size,
      height: size,
    },
  };
}
