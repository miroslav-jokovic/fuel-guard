// Rasterizes the HugeIcons used by the bottom tab bar into template PNGs (D51 follow-up).
//
// NativeTabs (expo-router/unstable-native-tabs) renders a truly native tab bar, so it can't host
// react-native-svg components directly — the `src` icon prop only accepts a static image, which
// the OS then tints using the tab bar's `iconColor`. This script converts the same HugeIcons SVGs
// used everywhere else in the app (src/theme/hugeIcons.ts) into @1x/@2x/@3x PNGs so the tab bar
// icons look identical in style to the rest of the app instead of falling back to SF Symbols /
// Android system icons.
//
// Run with: node scripts/gen-tab-icons.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  Home01Icon,
  TruckIcon,
  NavigationIcon,
  ActivityIcon,
  MoreHorizontalIcon,
} from '@hugeicons/core-free-icons';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'assets', 'tab-icons');
const BASE_SIZE = 24; // @1x — matches the size used elsewhere in the app (Icon default is 24).
const SCALES = [1, 2, 3];

// name -> [icon, strokeWidth for default state, strokeWidth for selected state]
// Selected uses the same thicker stroke as `fill` in src/components/Icon.tsx (2.1) so the tab
// bar's selected icon matches the "filled" look used for emphasis elsewhere in the app.
const TAB_ICONS = {
  home: [Home01Icon, 1.8, 2.1],
  loads: [TruckIcon, 1.8, 2.1],
  navigate: [NavigationIcon, 1.8, 2.1],
  score: [ActivityIcon, 1.8, 2.1],
  more: [MoreHorizontalIcon, 1.8, 2.1],
};

function attrsToString(attrs, strokeWidth) {
  return Object.entries(attrs)
    .filter(([key]) => key !== 'key')
    .map(([key, value]) => {
      const svgKey = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      const svgValue = svgKey === 'stroke-width' ? strokeWidth : value;
      return `${svgKey}="${svgValue}"`;
    })
    .join(' ');
}

function toSvg(iconElement, strokeWidth) {
  const body = iconElement
    .map(([tag, attrs]) => `<${tag} ${attrsToString(attrs, strokeWidth)} />`)
    .join('');
  // Solid black glyph on transparent background — the tab bar applies its own tint (iconColor)
  // via template rendering, so the baked-in color itself doesn't matter.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BASE_SIZE}" height="${BASE_SIZE}" viewBox="0 0 24 24" fill="none" stroke="#000000">${body}</svg>`;
}

async function renderPng(svg, scale, filePath) {
  const size = BASE_SIZE * scale;
  const png = await sharp(Buffer.from(svg), { density: 72 * scale })
    .resize(size, size)
    .png()
    .toBuffer();
  await writeFile(filePath, png);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const [name, [icon, defaultStroke, selectedStroke]] of Object.entries(TAB_ICONS)) {
    for (const scale of SCALES) {
      const suffix = scale === 1 ? '' : `@${scale}x`;
      await renderPng(toSvg(icon, defaultStroke), scale, path.join(OUT_DIR, `${name}${suffix}.png`));
      await renderPng(
        toSvg(icon, selectedStroke),
        scale,
        path.join(OUT_DIR, `${name}-selected${suffix}.png`)
      );
    }
    console.log(`✓ ${name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
