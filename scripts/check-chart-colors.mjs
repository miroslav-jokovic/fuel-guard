#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(`${root}apps/web/src/features/dashboard/chartTheme.ts`, "utf8");
const tokensCss = readFileSync(`${root}packages/ui/src/tokens.generated.css`, "utf8");

/**
 * The fallbacks must BE the tokens (D-DS15).
 *
 * ── Why this check exists ───────────────────────────────────────────────────────────────────────
 * chartTheme.ts carries a hex for every --viz-* role because canvas cannot read CSS variables, and
 * jsdom has no computed styles at all. Nothing ever compared those hexes to the tokens they mirror,
 * so they drifted: measured 2026-08-23 while re-theming, SIXTEEN of the nineteen were already wrong
 * — --viz-spend said #059669 where the token resolved to #009966, --viz-severity-critical #991b1b
 * against #9f0712. Every rule below still passed, because they only ever judged the fallbacks
 * against each other. A palette that agrees with itself and not with the product is the failure this
 * whole file was supposed to prevent.
 *
 * The browser was always right — getComputedStyle wins there — so this drift showed up only in
 * jsdom, which is exactly where nobody looks at a chart.
 */
const declared = new Map();
for (const m of tokensCss.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) declared.set(m[1], m[2].trim());

/**
 * Follow `var(--x)` hops, then take the LIGHT half of a `light-dark()` pair.
 *
 * The fallbacks exist for jsdom, which has no computed styles and no colour scheme, so light is the
 * scheme they stand in for. Taking the light half is not a shortcut — it is the correct comparison.
 *
 * ⚠ This function returned the raw `light-dark(…)` string for one commit after D-DS2 landed, and
 * because the caller treated an unparseable value as "skip", the whole check went silent: a
 * --viz-brand fallback of #000000 passed. Anything that cannot be parsed is now a FAILURE, not a
 * shrug, which is the only way a gate survives the format of its input changing under it.
 */
function resolveToken(name) {
  let value = declared.get(name);
  for (let hop = 0; value && /^var\(\s*--[\w-]+\s*\)$/.test(value) && hop < 8; hop += 1) {
    value = declared.get(value.match(/^var\(\s*(--[\w-]+)\s*\)$/)[1]);
  }
  if (!value) return null;
  const pair = value.match(/^light-dark\(\s*(.+?)\s*,\s*(.+?)\s*\)$/);
  return pair ? pair[1] : value;
}

function oklchToHex(value) {
  const m = value.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!m) return null;
  const lightness = Number(m[1]) / (m[2] ? 100 : 1);
  const chroma = Number(m[3]);
  const radians = (Number(m[4]) * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mid = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * mid + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mid - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mid + 1.707614701 * s,
  ];
  const encode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055);
  return `#${linear.map((c) => Math.round(Math.min(255, Math.max(0, encode(c) * 255))).toString(16).padStart(2, "0")).join("")}`;
}

function fallback(name) {
  const match = source.match(new RegExp(`"${name}"\\s*:\\s*"(#[0-9a-fA-F]{6})"`));
  if (!match) throw new Error(`Missing chart fallback ${name}`);
  return match[1];
}

function linear(hex) {
  return [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
}

function contrast(hex) {
  const [r, g, b] = linear(hex);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (luminance + 0.05);
}

const simulations = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function simulate(rgb, matrix) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * rgb[index], 0));
}

function distance(a, b) {
  return Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0));
}

const severity = [
  ["critical", fallback("--viz-severity-critical")],
  ["high", fallback("--viz-severity-high")],
  ["medium", fallback("--viz-severity-medium")],
  ["low", fallback("--viz-severity-low")],
];

const cost = [
  ["moving", fallback("--viz-cost-moving")],
  ["idle", fallback("--viz-cost-idle")],
  ["reefer", fallback("--viz-cost-reefer")],
];

let failed = false;
function validatePalette(name, palette) {
  for (const [label, hex] of palette) {
    const ratio = contrast(hex);
    const pass = ratio >= 3;
    console.log(`${pass ? "✓" : "✗"} ${name} ${label} / white: ${ratio.toFixed(2)}:1`);
    failed ||= !pass;
  }

  for (const [mode, matrix] of Object.entries(simulations)) {
    const colors = palette.map(([label, hex]) => [label, simulate(linear(hex), matrix)]);
    let minimum = Number.POSITIVE_INFINITY;
    let closest = "";
    for (let first = 0; first < colors.length; first++) {
      for (let second = first + 1; second < colors.length; second++) {
        const pairDistance = distance(colors[first][1], colors[second][1]);
        if (pairDistance < minimum) {
          minimum = pairDistance;
          closest = `${colors[first][0]} / ${colors[second][0]}`;
        }
      }
    }
    const pass = minimum >= 0.1;
    console.log(`${pass ? "✓" : "✗"} ${name} ${mode} minimum separation: ${minimum.toFixed(3)} (${closest})`);
    failed ||= !pass;
  }
}

validatePalette("severity", severity);
validatePalette("cost", cost);

console.log("");
let drifted = 0;
for (const m of source.matchAll(/"(--[\w-]+)":\s*"(#[0-9a-fA-F]{6})"/g)) {
  const [, name, declaredHex] = m;
  const token = resolveToken(name);
  if (!token) {
    console.error(`✗ ${name} has a chart fallback but no token in tokens.generated.css`);
    drifted += 1;
    continue;
  }
  const expected = oklchToHex(token);
  if (!expected) {
    console.error(`✗ ${name} resolves to "${token}", which this check cannot read — it is not an ` +
      `opaque oklch() value. Teach it the new format rather than letting the comparison pass.`);
    drifted += 1;
  } else if (expected !== declaredHex) {
    console.error(`✗ ${name} fallback ${declaredHex} but the token is ${expected}`);
    drifted += 1;
  }
}
if (drifted) {
  console.error(`\n✗ ${drifted} chart fallback(s) disagree with tokens.generated.css.`);
  failed = true;
} else {
  console.log("✓ every chart fallback matches its design token");
}

if (failed) process.exit(1);
