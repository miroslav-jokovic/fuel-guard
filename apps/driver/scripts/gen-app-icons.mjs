#!/usr/bin/env node
/**
 * Rasterise the four store icons from the ONE brand mark (DIRECTION-B-PLAN §6 P1.4).
 *
 * Until this script the driver app had no icon at all: `app.config.ts` declared none, so every
 * build shipped Expo's white-on-grey placeholder — on the home screen, in the app switcher, and in
 * the notification shade. Play and the App Store both reject that, and a driver looking for the app
 * on a phone with forty icons was looking for the one with no name on it.
 *
 * SOURCE OF TRUTH is apps/web/public/SilvicomLogoS.svg, the same mark the web app's favicon and
 * header use. Copying it into apps/driver/assets/ as a second SVG would be a copy with a delay fuse
 * (root CLAUDE.md, "Deriving beats restating"): the day marketing redraws the mark, one of the two
 * would move. The outputs ARE committed — a store build must not depend on a native rasteriser
 * being installed — but they are regenerated with `pnpm --filter @silvicom/driver gen:icons`.
 *
 * WHY THE MARK IS INVERTED. The source draws a navy mark with the "360" knocked out in near-white.
 * On a navy chrome (the app's `hero` role) that mark disappears. Every output here swaps the two
 * roles — white mark, background showing through the digits — which is the same drawing, read the
 * other way up. Nothing is redrawn and no colour is invented: the navy comes from `theme.roles.json`.
 *
 * NOT A CI GATE, deliberately. `--check` exists and works, but @resvg/resvg-js is a per-platform
 * native binary and a byte-comparison of its PNG output across a Mac and an ubuntu runner is a gate
 * that fails for reasons that are not the icon. The PURE half — which fills are the mark, what the
 * recoloured and framed SVG is — is unit-tested instead (tests/app-icon-model.test.ts).
 *
 *   node scripts/gen-app-icons.mjs           write the four PNGs
 *   node scripts/gen-app-icons.mjs --check   exit non-zero if any committed PNG differs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const MARK_SVG = join(ROOT, '../web/public/SilvicomLogoS.svg');
const ROLES = join(ROOT, 'src/theme/theme.roles.json');

/**
 * The mark's own colours are not named anywhere we control — it is an Illustrator export, and a
 * re-export can shift `#18274d` by a digit. Classifying by LUMINANCE rather than by a list of
 * hexes means a re-export keeps working: the dark fills are the mark, the light fill is the
 * knockout, and that is true of the drawing rather than of one file's bytes.
 *
 * The threshold is derived, not chosen. The question this classifier is really answering is "does
 * WHITE belong on this colour?", because white is what the dark fills become. WCAG's contrast ratio
 * makes that exact: white beats black on a colour whose relative luminance is below
 * sqrt(1.05 * 0.05) - 0.05 = 0.1791. A round 0.5 was the first version and was untestable — every
 * colour in the real mark sits at 0.02 or 0.87, so any threshold between them classified the file
 * identically and the constant meant nothing.
 */
const LUMINANCE_MIDPOINT = Math.sqrt(1.05 * 0.05) - 0.05;

/** sRGB relative luminance (WCAG 2.x). Exported only so the classifier can be tested at the
 *  boundary rather than through it. */
export function relativeLuminance(hex) {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a hex colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(full.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Split the `<style>` block's fill colours into the mark and the knockout.
 *
 * Returns lower-cased hex strings, de-duplicated, in first-appearance order. A source with no light
 * fill (a mark drawn without the digits) is legitimate and yields an empty `knockout`; a source with
 * no dark fill is not, and throws — silently rasterising an all-white mark onto a white background
 * is exactly the failure this would otherwise hide.
 */
export function classifyFills(svg) {
  const mark = [];
  const knockout = [];
  for (const match of svg.matchAll(/fill:\s*(#[0-9a-fA-F]{3,6})\s*[;}]/g)) {
    const hex = match[1].toLowerCase();
    const bucket = relativeLuminance(hex) < LUMINANCE_MIDPOINT ? mark : knockout;
    if (!bucket.includes(hex)) bucket.push(hex);
  }
  if (mark.length === 0) throw new Error('the mark SVG declares no dark fill — nothing to invert');
  return { mark, knockout };
}

/**
 * Repaint the mark. `mark` is what the dark fills become; `knockout` is what the light fills
 * become, and `'none'` leaves them as holes so whatever is behind shows through.
 *
 * A string replacement on the `<style>` block rather than a DOM edit, because the block IS the
 * colour table: every path in the source carries a class and no inline fill, so there is exactly
 * one place a colour is written. Anything with an inline fill would be untouched and would show up
 * immediately as a wrongly-coloured shape in the rendered PNG.
 */
export function recolourMark(svg, { mark, knockout }) {
  const fills = classifyFills(svg);
  let next = svg;
  for (const hex of fills.mark) next = replaceFill(next, hex, mark);
  for (const hex of fills.knockout) next = replaceFill(next, hex, knockout);
  return next;
}

function replaceFill(svg, from, to) {
  return svg.replaceAll(
    new RegExp(`fill:\\s*${from}\\s*(?=[;}])`, 'gi'),
    () => `fill: ${to}`,
  );
}

/**
 * Wrap the mark in a square canvas, centred, covering `coverage` of the shorter side.
 *
 * A nested `<svg>` element would be the tidier answer and is not used: the mark carries its colours
 * in a `<style>` block, and how a renderer scopes CSS inside a nested viewport is renderer business.
 * A `<g transform>` inside one root is plain geometry that every renderer agrees on.
 *
 * `background` of `'none'` leaves the canvas transparent — which is what an Android adaptive-icon
 * foreground, a splash image and a notification silhouette all need. Only the iOS icon is opaque,
 * because iOS composites nothing behind it.
 *
 * `repeat` draws the mark that many times in the same place, which sounds pointless and is not.
 * The source paints the "360" INTO holes cut out of the leaf, so two antialiased edges meet along
 * every digit: 50% coverage over 50% coverage is 75%, not 100%, and the seam shows as a ghost
 * outline of each digit. Invisible at 1024px, and the whole reading of the 96px notification
 * silhouette at 24dp. Overdrawing composites the gap closed without touching the geometry and
 * without a pixel-level threshold, which would take the antialiasing off the OUTER edge too.
 */
export function frameSquare(svg, { coverage, background = 'none', repeat = 1 }) {
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error(`repeat must be >= 1: ${repeat}`);
  if (!(coverage > 0 && coverage <= 1)) throw new Error(`coverage must be in (0,1]: ${coverage}`);
  const viewBox = svg.match(/viewBox\s*=\s*"([^"]+)"/);
  if (!viewBox) throw new Error('the mark SVG has no viewBox');
  const [minX, minY, width, height] = viewBox[1].trim().split(/[\s,]+/).map(Number);
  if (![minX, minY, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error(`the mark SVG has an unusable viewBox: ${viewBox[1]}`);
  }

  const side = Math.max(width, height) / coverage;
  const translateX = (side - width) / 2 - minX;
  const translateY = (side - height) / 2 - minY;
  const inner = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'));
  const plate =
    background === 'none'
      ? ''
      : `<rect x="0" y="0" width="${round(side)}" height="${round(side)}" fill="${background}"/>`;

  const group = `<g transform="translate(${round(translateX)},${round(translateY)})">${inner}</g>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(side)} ${round(side)}">` +
    plate +
    group.repeat(repeat) +
    `</svg>`
  );
}

/** Four decimal places: enough that a 1024px render cannot see the rounding, few enough that the
 *  generated SVG is diffable when something looks wrong. */
function round(n) {
  return Number(n.toFixed(4));
}

/** theme.roles.json stores "R G B"; a `<rect fill>` wants #RRGGBB. Same conversion app.config.ts
 *  does, for the same reason — the navy has one home. */
export function roleHex(roles, appearance, role) {
  const value = roles?.[appearance]?.[role];
  if (!value) throw new Error(`theme.roles.json has no ${appearance}.${role}`);
  const channels = value.trim().split(/\s+/).map(Number);
  if (channels.length !== 3 || channels.some((c) => !Number.isInteger(c) || c < 0 || c > 255)) {
    throw new Error(`theme.roles.json ${appearance}.${role} is not three 0-255 channels: ${value}`);
  }
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The four outputs, and why each is shaped the way it is.
 *
 * `coverage` is the fraction of the square the mark's own viewBox spans, so a smaller number means
 * more margin. The numbers are not taste: Android masks an adaptive foreground down to a 66/108
 * circle, iOS rounds the corners of a full-bleed square, a splash image is drawn at 160dp however
 * big the asset is, and a notification icon is a 24dp silhouette.
 */
export function outputs({ hero, white }) {
  return [
    {
      file: 'assets/icon.png',
      size: 1024,
      // iOS and the Play listing both show this one full-bleed, so it carries the navy plate. The
      // digits are knocked out to the plate colour rather than to transparency — an opaque icon
      // with holes in it is a rejection.
      coverage: 0.72,
      background: hero,
      mark: white,
      knockout: hero,
    },
    {
      file: 'assets/adaptive-icon.png',
      size: 1024,
      // 0.56, not 0.66: the guaranteed-safe region is a CIRCLE of 66/108 of the canvas, and this
      // mark's widest points sit at mid-height where a circular mask is at its narrowest.
      coverage: 0.56,
      background: 'none',
      mark: white,
      // Transparent, so the launcher's background layer — `adaptiveIcon.backgroundColor`, the same
      // navy — shows through the digits. One colour, declared once, in app.config.ts.
      knockout: 'none',
    },
    {
      file: 'assets/splash-icon.png',
      size: 512,
      // expo-splash-screen draws this at `imageWidth` (160dp) whatever the asset's size, so margin
      // baked into the asset is margin that cannot be tuned later. Almost none.
      coverage: 0.96,
      background: 'none',
      mark: white,
      knockout: 'none',
    },
    {
      file: 'assets/notification-icon.png',
      size: 96,
      coverage: 0.84,
      background: 'none',
      mark: white,
      // SOLID, not knocked out. Android throws away the colour and keeps the alpha, so at 24dp the
      // "360" is three transparent specks in a tinted blob — noise where a recognisable silhouette
      // should be. The digits are painted the same white as the mark, which fills them in.
      knockout: white,
      // …and painting them the same colour is not enough on its own: see `repeat` in frameSquare.
      // Measured on 2026-09-07 at 96px — 1 pass leaves visible ghost digits, 3 leaves none.
      repeat: 3,
    },
  ];
}

async function main() {
  const check = process.argv.includes('--check');
  const { Resvg } = await import('@resvg/resvg-js');
  const source = readFileSync(MARK_SVG, 'utf8');
  const roles = JSON.parse(readFileSync(ROLES, 'utf8'));
  const hero = roleHex(roles, 'light', 'hero');

  let failed = 0;
  for (const output of outputs({ hero, white: '#ffffff' })) {
    const svg = frameSquare(
      recolourMark(source, { mark: output.mark, knockout: output.knockout }),
      { coverage: output.coverage, background: output.background, repeat: output.repeat ?? 1 },
    );
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: output.size } })
      .render()
      .asPng();
    const path = join(ROOT, output.file);

    if (check) {
      let committed = null;
      try {
        committed = readFileSync(path);
      } catch {
        /* absent counts as different */
      }
      if (!committed || !committed.equals(png)) {
        console.error(`✗ ${output.file} differs from what this script would write`);
        failed += 1;
      } else {
        console.log(`✓ ${output.file}`);
      }
    } else {
      writeFileSync(path, png);
      console.log(`wrote ${output.file} (${output.size}px, ${png.length} bytes)`);
    }
  }

  if (failed > 0) {
    console.error(
      `\n${failed} icon(s) out of date. Run: pnpm --filter @silvicom/driver gen:icons`,
    );
    process.exit(1);
  }
}

// Importable for tests; only the CLI path touches the filesystem or the native rasteriser.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
