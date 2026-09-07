import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyFills,
  frameSquare,
  outputs,
  recolourMark,
  relativeLuminance,
  roleHex,
} from '../scripts/gen-app-icons.mjs';

/**
 * The store icons are rasterised from apps/web/public/SilvicomLogoS.svg (DIRECTION-B-PLAN §6 P1.4).
 * The PNGs themselves are not compared here — @resvg/resvg-js is a per-platform native binary and a
 * byte-diff of its output between a Mac and an ubuntu runner would fail for reasons that are not
 * the icon. What IS pinned is every decision made before the rasteriser is reached: which fills are
 * the mark, what the recoloured SVG says, and where the framing puts it.
 */

const ROOT = join(import.meta.dirname, '..');
const MARK: string = readFileSync(join(ROOT, '../web/public/SilvicomLogoS.svg'), 'utf8');

describe('relativeLuminance', () => {
  it('puts black at 0 and white at 1', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('reads the brand navy as dark and the mark highlight as light', () => {
    expect(relativeLuminance('#18274d')).toBeCloseTo(0.0218, 4);
    expect(relativeLuminance('#f2f2f2')).toBeCloseTo(0.8879, 4);
  });

  it('decodes the sRGB transfer function rather than reading channels raw', () => {
    // Mid-grey is the only place the two differ enough to see: 0x80/255 is 0.502 read raw and
    // 0.216 decoded. Every colour in the real mark sits at one end or the other, so a version of
    // this that skipped gamma agreed with the correct one on every value the icons actually use.
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 4);
    expect(relativeLuminance('#6b6b6b')).toBeCloseTo(0.147, 3);
  });

  it('expands three-digit hex', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(relativeLuminance('#ffffff'), 10);
  });

  it('refuses something that is not a colour rather than scoring it 0', () => {
    // A silent 0 would classify a broken value as "part of the mark" and paint it white.
    expect(() => relativeLuminance('#12g4')).toThrow(/hex/);
  });
});

describe('classifyFills', () => {
  it('splits the real mark into three dark fills and one light one, in source order', () => {
    const { mark, knockout } = classifyFills(MARK);
    expect(mark).toEqual(['#18274d', '#1a284d', '#18274c']);
    expect(knockout).toEqual(['#f2f2f2']);
  });

  it('splits where white stops being the better ink — between #6b6b6b and #808080', () => {
    // The real mark's colours are 0.022 and 0.888, so ANY threshold between them classifies the
    // file identically and the constant would mean nothing. These two straddle 0.1791 (0.147 and
    // 0.216) and are the only reason the threshold is pinned at all.
    expect(classifyFills('<style>.a{fill:#6b6b6b;}.b{fill:#808080;}</style>')).toEqual({
      mark: ['#6b6b6b'],
      knockout: ['#808080'],
    });
  });

  it('de-duplicates a colour used by several classes', () => {
    const svg = '<style>.a{fill: #111111;}.b{fill: #111111;}.c{fill:#eeeeee;}</style>';
    expect(classifyFills(svg)).toEqual({ mark: ['#111111'], knockout: ['#eeeeee'] });
  });

  it('is case-insensitive about the source hex', () => {
    expect(classifyFills('<style>.a{fill: #18274D;}</style>').mark).toEqual(['#18274d']);
  });

  it('accepts a mark drawn without a knockout', () => {
    expect(classifyFills('<style>.a{fill:#101010;}</style>')).toEqual({
      mark: ['#101010'],
      knockout: [],
    });
  });

  it('refuses a source with no dark fill instead of rasterising white on white', () => {
    expect(() => classifyFills('<style>.a{fill:#fefefe;}</style>')).toThrow(/no dark fill/);
  });
});

describe('recolourMark', () => {
  const repaint = (colours: { mark: string; knockout: string }): string =>
    recolourMark(MARK, colours) as string;

  it('turns every dark fill white and the light fill into the knockout colour', () => {
    const out = repaint({ mark: '#ffffff', knockout: '#14263f' });
    expect(out).toContain('fill: #ffffff');
    expect(out).toContain('fill: #14263f');
    // The point of the exercise: none of the source navies survive anywhere.
    expect(out).not.toMatch(/#18274[cd]/i);
    expect(out).not.toMatch(/#1a284d/i);
    expect(out).not.toMatch(/#f2f2f2/i);
  });

  it('can leave the knockout as a hole', () => {
    expect(repaint({ mark: '#ffffff', knockout: 'none' })).toContain('fill: none');
  });

  it('keeps every path — it repaints the drawing, it does not redraw it', () => {
    const shapes = (svg: string) => (/<path|<polygon/g.exec(svg) ? svg.split(/<path|<polygon/).length - 1 : 0);
    const before = shapes(MARK);
    expect(shapes(repaint({ mark: '#ffffff', knockout: 'none' }))).toBe(before);
    expect(before).toBeGreaterThan(0);
  });

  it('paints the knockout the same as the mark when asked, which is what makes a silhouette', () => {
    const out = repaint({ mark: '#ffffff', knockout: '#ffffff' });
    expect(out).not.toMatch(/#f2f2f2/i);
    expect(out.split('fill: #ffffff').length - 1).toBe(4);
  });
});

describe('frameSquare', () => {
  const frame = (svg: string, options: { coverage: number; background?: string; repeat?: number }) =>
    frameSquare(svg, options);
  const square = (svg: string) => {
    const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    if (!box) throw new Error('no viewBox');
    return { width: Number(box[1]), height: Number(box[2]) };
  };
  const translate = (svg: string) => {
    const g = /translate\(([-\d.]+),([-\d.]+)\)/.exec(svg);
    if (!g) throw new Error('no translate');
    return { x: Number(g[1]), y: Number(g[2]) };
  };

  it('makes a square canvas whose side is the mark’s longest edge over the coverage', () => {
    const framed = frame(MARK, { coverage: 0.5 });
    const { width, height } = square(framed);
    expect(width).toBe(height);
    expect(width).toBeCloseTo(789.51 / 0.5, 3);
  });

  it('centres the mark on both axes', () => {
    const framed = frame(MARK, { coverage: 0.72 });
    const side = square(framed).width;
    // Equal margin left/right and top/bottom is the whole claim; the assertion is written as the
    // two margins rather than as one number so a change to the framing reads as what it broke.
    expect(translate(framed).x).toBeCloseTo((side - 789.51) / 2, 3);
    expect(translate(framed).y).toBeCloseTo((side - 670.49) / 2, 3);
  });

  it('a lower coverage means more margin, not a smaller canvas', () => {
    const wide = square(frame(MARK, { coverage: 0.9 })).width;
    const narrow = square(frame(MARK, { coverage: 0.5 })).width;
    expect(narrow).toBeGreaterThan(wide);
    expect(translate(frame(MARK, { coverage: 0.5 })).x).toBeGreaterThan(
      translate(frame(MARK, { coverage: 0.9 })).x,
    );
  });

  it('omits the background plate unless one is asked for', () => {
    expect(frame(MARK, { coverage: 0.7 })).not.toContain('<rect');
    expect(frame(MARK, { coverage: 0.7, background: '#14263f' })).toContain(
      'fill="#14263f"',
    );
  });

  it('draws the mark once by default and `repeat` times when asked', () => {
    const once = frame(MARK, { coverage: 0.84 });
    const thrice = frame(MARK, { coverage: 0.84, repeat: 3 });
    expect(once.split('<g transform').length - 1).toBe(1);
    expect(thrice.split('<g transform').length - 1).toBe(3);
  });

  it('refuses a repeat that would draw nothing', () => {
    expect(() => frame(MARK, { coverage: 0.8, repeat: 0 })).toThrow(/repeat/);
  });

  it('refuses a coverage outside (0,1]', () => {
    expect(() => frame(MARK, { coverage: 0 })).toThrow(/coverage/);
    expect(() => frame(MARK, { coverage: 1.2 })).toThrow(/coverage/);
  });

  it('honours a viewBox that does not start at the origin', () => {
    // Illustrator exports one occasionally, and ignoring minX/minY would slide the mark off-centre
    // by exactly that offset.
    const shifted = MARK.replace('viewBox="0 0 789.51 670.49"', 'viewBox="10 20 789.51 670.49"');
    const framed = frame(shifted, { coverage: 0.5 });
    const side = square(framed).width;
    expect(translate(framed).x).toBeCloseTo((side - 789.51) / 2 - 10, 3);
    expect(translate(framed).y).toBeCloseTo((side - 670.49) / 2 - 20, 3);
  });

  it('refuses a source with no viewBox rather than framing it at a guess', () => {
    expect(() => frame('<svg><path/></svg>', { coverage: 0.5 })).toThrow(/viewBox/);
  });
});

describe('roleHex', () => {
  const roles = JSON.parse(
    readFileSync(join(ROOT, 'src/theme/theme.roles.json'), 'utf8'),
  ) as Record<string, Record<string, string>>;

  it('reads the navy the icons stand on out of the theme, not out of a literal', () => {
    expect(roleHex(roles, 'light', 'hero')).toBe('#14263f');
  });

  it('refuses a role that does not exist', () => {
    expect(() => roleHex(roles, 'light', 'not-a-role')).toThrow(/no light.not-a-role/);
  });

  it('refuses channels that are not three 0-255 integers', () => {
    expect(() => roleHex({ light: { hero: '20 38' } }, 'light', 'hero')).toThrow(/channels/);
    expect(() => roleHex({ light: { hero: '20 38 300' } }, 'light', 'hero')).toThrow(/channels/);
  });
});

interface IconSpec {
  file: string;
  size: number;
  coverage: number;
  background: string;
  mark: string;
  knockout: string;
  repeat?: number;
}

describe('the four outputs', () => {
  const specs = outputs({ hero: '#14263f', white: '#ffffff' }) as IconSpec[];
  const spec = (name: string): IconSpec => {
    const found = specs.find((s) => s.file.includes(name));
    if (!found) throw new Error(`no ${name} output`);
    return found;
  };

  it('writes exactly the four files app.config.ts references', () => {
    expect(specs.map((s) => s.file)).toEqual([
      'assets/icon.png',
      'assets/adaptive-icon.png',
      'assets/splash-icon.png',
      'assets/notification-icon.png',
    ]);
  });

  it('gives the iOS icon an opaque plate and the other three none', () => {
    // An App Store icon with transparency is a submission rejection, not a rendering quirk.
    expect(spec('icon.png').background).toBe('#14263f');
    expect(specs.slice(1).every((s) => s.background === 'none')).toBe(true);
  });

  it('keeps the adaptive foreground inside Android’s circular safe zone', () => {
    expect(spec('adaptive').coverage).toBeLessThanOrEqual(0.61);
  });

  it('makes the notification icon a solid silhouette, overdrawn to close the seams', () => {
    const notification = spec('notification');
    expect(notification.knockout).toBe(notification.mark);
    expect(notification.repeat).toBeGreaterThan(1);
    expect(notification.size).toBe(96);
  });

  it('gives the iOS icon a knockout the same colour as its plate, so it stays opaque', () => {
    expect(spec('icon.png').knockout).toBe(spec('icon.png').background);
  });
});
