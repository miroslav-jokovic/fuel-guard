#!/usr/bin/env node
/**
 * Fitness function — every colour token must be inside the sRGB gamut.
 *
 * ── The failure this exists for, which shipped and nothing caught ───────────────────────────────
 * Reported as "noticeable difference between the dashboard on Mac and PC — same monitor, but the
 * colours are quite different". Measured 2026-08-25: 64 of 264 colour tokens named colours that no
 * sRGB display can produce. `--ramp-caution-200` was `oklch(92.7% 0.08 45)` — 0.212 of linear
 * overshoot, so far outside that Display-P3 cannot hold it either.
 *
 * That is not a wide-gamut design decision. It is what happens when a palette is authored in OKLCH
 * by picking round numbers for chroma: the OKLCH space is much larger than any display's, and
 * nothing in the pipeline was checking.
 *
 * ── Why it looks different on two machines and not just "slightly wrong" on both ─────────────────
 * A browser meeting an out-of-gamut colour has to gamut-map it, and Chrome does not resolve
 * `oklch()` to `rgb()` first — verified in the browser, `getComputedStyle` returns
 * `oklch(0.927 0.08 45)` unchanged. The colour stays device-independent all the way to PAINT, where
 * the mapping happens against the actual display profile. macOS colour-manages through the ICC
 * profile and will paint into Display-P3 on capable hardware; Windows does not behave the same way.
 * Same page, same monitor, two machines, two results — and only for the tokens that need mapping.
 *
 * In-gamut colours have no such freedom: every platform paints them the same. So the fix and this
 * gate are the same thing — keep every token somewhere every display can actually reproduce.
 *
 * ── What "fixing" a token means ─────────────────────────────────────────────────────────────────
 * Reduce CHROMA at the same lightness and hue, which is what CSS Color 4 specifies as the reference
 * gamut-mapping algorithm anyway. Lightness is what carries contrast, so `lint:ui-contrast` keeps
 * passing; hue is what carries identity. The colour becomes slightly less saturated and stays
 * recognisably itself. `maxChroma` below is the same binary search the one-off fix used.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SOURCES = ["primitives.light", "primitives.dark", "roles.light", "roles.dark", "theme"];
const OKLCH = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/;

/**
 * OKLCH → linear sRGB. Deliberately the same arithmetic as `check-chart-colors.mjs`'s `oklchToHex`
 * and `packages/tokens/build.mjs`: three copies is two too many, but a shared helper would be the
 * first thing in `scripts/` to need one and that is a bigger change than this gate.
 */
function toLinearSrgb(lightness, chroma, hueDeg) {
  const h = (hueDeg * Math.PI) / 180;
  const a = chroma * Math.cos(h);
  const b = chroma * Math.sin(h);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

// 1e-4 of slack, because the boundary is where floating point disagrees with itself and a token
// sitting exactly on the hull is not the bug this is looking for.
const inSrgb = (l, c, h) => toLinearSrgb(l, c, h).every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** The largest chroma this lightness and hue can carry inside sRGB. */
function maxChroma(lightness, hueDeg) {
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (inSrgb(lightness, mid, hueDeg)) lo = mid;
    else hi = mid;
  }
  return lo;
}

function walk(node, path, onValue) {
  if (!node || typeof node !== "object") return;
  if (typeof node.$value === "string") {
    onValue(path, node.$value);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith("$")) walk(value, path ? `${path}.${key}` : key, onValue);
  }
}

const offenders = [];
let scanned = 0;

for (const file of SOURCES) {
  const json = JSON.parse(readFileSync(`${root}packages/tokens/src/${file}.json`, "utf8"));
  walk(json, "", (path, raw) => {
    const m = OKLCH.exec(raw.trim());
    if (!m) return;
    scanned += 1;
    const lightness = Number(m[1]) / 100;
    const chroma = Number(m[2]);
    const hue = Number(m[3]);
    if (inSrgb(lightness, chroma, hue)) return;
    offenders.push({ file, path, raw, chroma, max: maxChroma(lightness, hue) });
  });
}

if (offenders.length > 0) {
  console.error(`\n✗ ${offenders.length} colour token(s) name a colour no sRGB display can produce.`);
  console.error("  Each is gamut-mapped at paint time, which is why the same page looks different on");
  console.error("  macOS and Windows. Reduce chroma at the same lightness and hue:\n");
  for (const o of offenders) {
    const suggestion = Math.floor(o.max * 0.998 * 1e4) / 1e4;
    console.error(`  ${o.file}  ${o.path}`);
    console.error(`    ${o.raw}  →  chroma ${o.chroma} is over the limit, use ${suggestion} or less`);
  }
  console.error("\n  Then run `pnpm gen:tokens`.\n");
  process.exit(1);
}

console.log(`✓ token gamut ok — all ${scanned} oklch() token(s) inside sRGB, so every display agrees.`);
