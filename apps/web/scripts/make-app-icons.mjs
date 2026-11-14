#!/usr/bin/env node
/**
 * The installed app's icons, drawn from the brand mark (`public/SilvicomLogoS.svg`) — one shape per platform,
 * because each platform finishes an icon differently (CHAT-WEB-PUSH-PLAN.md D-WP16):
 *
 *   · `icon-192.png`, `icon-512.png` (manifest, purpose "any") — a PC shows this exactly as given. macOS does
 *     not round or pad an installed web app's icon for Chrome or Edge, so a full-bleed square sits in the Dock
 *     larger and sharper-cornered than every icon beside it (the owner's MacBook, 2026-11-14). These carry the
 *     macOS shape themselves: a rounded square on Apple's grid (824 of 1024, so 10% clear on each side),
 *     transparent outside it.
 *   · `icon-maskable-192.png`, `icon-maskable-512.png` (purpose "maskable") — Android cuts its own circle or
 *     squircle out of the picture, so this one is full-bleed with the mark inside the middle 80% safe zone.
 *     Without it Android shrinks the "any" icon onto a white disc.
 *   · `apple-touch-icon.png` — iPhone and iPad round the corners themselves and paint transparency black, so
 *     full-bleed and opaque.
 *
 * Run: `node apps/web/scripts/make-app-icons.mjs` (needs the repo's Playwright Chromium). The PNGs are
 * committed; this is how they are remade when the mark changes — never edit them by hand.
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pub = resolve(here, "../public");
const NAVY_TOP = "#213665";
const NAVY = "#18274d"; // the manifest's theme_color and the mark's own navy

/** The mark in white with its "360" in navy: `.st3` is the digits, the other three classes the S and its triangles. */
const mark = readFileSync(resolve(pub, "SilvicomLogoS.svg"), "utf8")
  .replace(/<\?xml[^>]*\?>/, "")
  .replace(/<style>[\s\S]*?<\/style>/, `<style>.st0,.st1,.st2{fill:#fff}.st3{fill:${NAVY}}</style>`);

/**
 * @param size   output pixels
 * @param plate  fraction of the canvas the navy plate covers (1 = full-bleed)
 * @param radius plate corner radius as a fraction of the plate (0 = square)
 * @param art    fraction of the canvas the mark's width takes
 */
function page(size, { plate, radius, art }) {
  const p = size * plate;
  return `<!doctype html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:transparent">
    <div style="width:${p}px;height:${p}px;border-radius:${p * radius}px;background:linear-gradient(180deg,${NAVY_TOP},${NAVY});display:grid;place-items:center">
      ${mark.replace("<svg ", `<svg style="width:${size * art}px;display:block" `)}
    </div></body>`;
}

const SHAPES = {
  // Apple's macOS grid: an 824 px plate on a 1024 px canvas, corners ≈ 22.5% of the plate.
  any: { plate: 824 / 1024, radius: 0.225, art: 0.54 },
  maskable: { plate: 1, radius: 0, art: 0.52 },
  apple: { plate: 1, radius: 0, art: 0.62 },
};
const FILES = [
  ["icon-192.png", 192, SHAPES.any, true],
  ["icon-512.png", 512, SHAPES.any, true],
  ["icon-maskable-192.png", 192, SHAPES.maskable, false],
  ["icon-maskable-512.png", 512, SHAPES.maskable, false],
  ["apple-touch-icon.png", 180, SHAPES.apple, false],
];

const outDir = process.argv[2] ? resolve(process.argv[2]) : resolve(pub, "icons");
const browser = await chromium.launch();
for (const [name, size, shape, transparent] of FILES) {
  const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(page(size, shape));
  await p.screenshot({ path: resolve(outDir, name), omitBackground: transparent });
  await p.close();
  console.log(`wrote ${name} (${size}px)`);
}
await browser.close();
