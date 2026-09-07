import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  relativeLuminance,
  toChannels,
  toHex,
  WHITE_BEATS_BLACK_BELOW,
} from '../scripts/srgb.mjs';

/**
 * `scripts/srgb.mjs` is the one home for WCAG luminance and contrast in this app (2026-09-07). It
 * is used by `tests/theme-colors.test.ts` to assert every theme's contrast and by
 * `scripts/gen-app-icons.mjs` to decide which of the brand mark's fills become white, so an error
 * here is an error in both — which is the reason it has tests of its own rather than being trusted
 * because two callers happen to agree.
 */

describe('toChannels', () => {
  it('reads six-digit hex', () => {
    expect(toChannels('#14263f')).toEqual([20, 38, 63]);
  });

  it('expands three-digit hex', () => {
    expect(toChannels('#fff')).toEqual([255, 255, 255]);
  });

  it('reads the "R G B" triple theme.roles.json stores', () => {
    expect(toChannels('20 38 63')).toEqual([20, 38, 63]);
  });

  it('tolerates the whitespace a hand-edited JSON value picks up', () => {
    expect(toChannels('  20   38  63 ')).toEqual([20, 38, 63]);
  });

  it('is case-insensitive about hex', () => {
    expect(toChannels('#14263F')).toEqual(toChannels('#14263f'));
  });

  it('refuses a hex string that is not one', () => {
    expect(() => toChannels('#12g4')).toThrow(/hex/);
    expect(() => toChannels('#12345')).toThrow(/hex/);
  });

  it('refuses a triple that is the wrong length or out of range', () => {
    expect(() => toChannels('20 38')).toThrow(/three 0-255/);
    expect(() => toChannels('20 38 300')).toThrow(/three 0-255/);
    expect(() => toChannels('20 38 63.5')).toThrow(/three 0-255/);
  });
});

describe('toHex', () => {
  it('pads a channel below 16 rather than dropping a digit', () => {
    // "20 38 63" → #14263F. Without the pad the blue channel would emit "3f" fine but a value like
    // 10 would emit "a", and #14 26 a is a four-and-a-half digit colour nothing renders.
    expect(toHex('20 38 63')).toBe('#14263F');
    expect(toHex('0 10 255')).toBe('#000AFF');
  });

  it('round-trips a hex colour', () => {
    expect(toHex('#14263f')).toBe('#14263F');
  });
});

describe('relativeLuminance', () => {
  it('puts black at 0 and white at 1', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('decodes the sRGB transfer function rather than reading channels raw', () => {
    // Mid-grey is the only place the two differ enough to see: 0x80/255 is 0.502 read raw and
    // 0.216 decoded. Every colour in the brand mark sits at one end or the other, so a version of
    // this that skipped gamma agreed with the correct one on every value the icons actually use —
    // and survived a mutant until this case existed.
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 4);
    expect(relativeLuminance('#6b6b6b')).toBeCloseTo(0.147, 3);
  });

  it('weights green far above blue, which is what makes it luminance and not an average', () => {
    // The three weights are asserted as a PROPERTY rather than as three decimals. Copying the
    // constants out of the implementation would pass whatever the implementation said — and would
    // put the Rec.709 triple in a second file, which `lint:scanner-parity` refuses on purpose.
    const red = relativeLuminance('#ff0000');
    const green = relativeLuminance('#00ff00');
    const blue = relativeLuminance('#0000ff');
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
    expect(green).toBeGreaterThan(blue * 5);
    expect(red + green + blue).toBeCloseTo(1, 10);
  });

  it('reads the brand navy as dark and the mark highlight as light', () => {
    expect(relativeLuminance('#18274d')).toBeCloseTo(0.0218, 4);
    expect(relativeLuminance('#f2f2f2')).toBeCloseTo(0.8879, 4);
  });

  it('takes a channel triple as readily as a hex string', () => {
    expect(relativeLuminance('20 38 63')).toBeCloseTo(relativeLuminance('#14263f'), 12);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 6);
  });

  it('is 1:1 for a colour on itself', () => {
    expect(contrastRatio('#14263f', '#14263f')).toBeCloseTo(1, 12);
  });

  it('does not care which argument is the foreground', () => {
    expect(contrastRatio('#14263f', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#14263f'), 12);
  });

  it('adds the 0.05 flare term — without it black on black is a division by zero', () => {
    expect(Number.isFinite(contrastRatio('#000000', '#000000'))).toBe(true);
    expect(contrastRatio('#000000', '#000000')).toBeCloseTo(1, 12);
  });
});

describe('WHITE_BEATS_BLACK_BELOW', () => {
  it('is the luminance where white and black contrast equally', () => {
    const grey = WHITE_BEATS_BLACK_BELOW;
    // Not asserted as 0.1791: the claim is the PROPERTY, and a decimal copied from the constant
    // would pass whatever the constant said.
    expect((1.05 / (grey + 0.05)) - ((grey + 0.05) / 0.05)).toBeCloseTo(0, 10);
  });

  it('calls white the better ink on the brand navy and black the better ink on the highlight', () => {
    expect(relativeLuminance('#18274d')).toBeLessThan(WHITE_BEATS_BLACK_BELOW);
    expect(relativeLuminance('#f2f2f2')).toBeGreaterThan(WHITE_BEATS_BLACK_BELOW);
  });

  it('sits between #6b6b6b and #808080, which is the only pair that pins it', () => {
    expect(relativeLuminance('#6b6b6b')).toBeLessThan(WHITE_BEATS_BLACK_BELOW);
    expect(relativeLuminance('#808080')).toBeGreaterThan(WHITE_BEATS_BLACK_BELOW);
  });
});
