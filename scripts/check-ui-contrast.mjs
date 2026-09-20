#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(`${root}packages/ui/src/tokens.generated.css`, "utf8");

/**
 * Both schemes, not one (D-DS10).
 *
 * Every role is a `light-dark(light, dark)` pair since D-DS2, so a gate that read the first value
 * would have checked half the product and reported a clean bill for the other half. Dark is where a
 * contrast regression is MORE likely, not less: the light palette was tuned against white over
 * years, the dark one was derived in an afternoon.
 */
function scheme(value, want) {
  const pair = value.match(/^light-dark\(\s*(.+?)\s*,\s*(.+?)\s*\)$/);
  if (!pair) return value;                      // single-valued: the same in both schemes
  return want === "light" ? pair[1] : pair[2];
}

function declaration(name) {
  const match = source.match(
    new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*:\\s*([^;]+);`, "m"),
  );
  if (!match) throw new Error(`Missing production token ${name}`);
  return match[1].trim();
}

/**
 * Follow `var(--x)` to the value it names (D-DT17).
 *
 * The roles this gate was written for are all literal `oklch()`. The chip's gradient stops are not:
 * `--chip-danger-from` is `light-dark(var(--ramp-danger-500), var(--ramp-danger-600))`, because the
 * two schemes need DIFFERENT ramp steps and a token that restated the numbers could drift from the
 * ramp it was copied out of. Resolving the reference is what lets the gate check a derived role at
 * all; without it every such pair would have to be checked against a hand-copied literal, which is
 * the arrangement this whole token pipeline exists to stop.
 *
 * ⚠ The scheme is applied at EVERY hop, not just the first: `--chip-danger-from` picks the dark
 * branch, and `--ramp-danger-600` — which it resolves to — has a dark branch of its own.
 */
function resolve(name, want, depth = 0) {
  if (depth > 8) throw new Error(`${name} resolves in a circle`);
  const value = scheme(declaration(name), want);
  const reference = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  return reference ? resolve(reference[1], want, depth + 1) : value;
}

function token(name, want) {
  const value = resolve(name, want);
  const parsed = value.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!parsed) throw new Error(`${name} must be an opaque oklch() value in ${want}, received ${value}`);
  return {
    l: Number(parsed[1]) / (parsed[2] ? 100 : 1),
    c: Number(parsed[3]),
    h: Number(parsed[4]),
  };
}

function luminance({ l: lightness, c: chroma, h: hue }) {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const red = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background, want) {
  const a = luminance(token(foreground, want));
  const b = luminance(token(background, want));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const pairs = [
  ["primary text / surface", "--ink", "--surface", 4.5],
  ["primary text / canvas", "--ink", "--canvas", 4.5],
  ["secondary text / surface", "--ink-secondary", "--surface", 4.5],
  ["tertiary text / surface", "--ink-tertiary", "--surface", 4.5],
  ["tertiary text / canvas", "--ink-tertiary", "--canvas", 4.5],
  ["sidebar text / navigation", "--ink-secondary", "--surface-navigation", 4.5],
  ["sidebar muted text / navigation", "--ink-tertiary", "--surface-navigation", 4.5],
  ["control border / surface", "--edge-control", "--surface", 3],
  ["control border / canvas", "--edge-control", "--canvas", 3],
  ["identity foreground / accent", "--ink", "--brand-accent", 4.5],
  ["action foreground / action", "--action-primary-foreground", "--action-primary", 4.5],
  ["action foreground / hover", "--action-primary-foreground", "--action-primary-hover", 4.5],
  ["link / surface", "--link", "--surface", 4.5],
  ["focus / surface", "--focus-ring", "--surface", 3],
  ["focus / canvas", "--focus-ring", "--canvas", 3],
  ["danger foreground / solid", "--danger-solid-foreground", "--danger-solid", 4.5],
  ["danger text / subtle surface", "--danger-text", "--danger-surface", 4.5],
  ["danger status / tint", "--ramp-danger-700", "--ramp-danger-50", 4.5],
  ["caution status / tint", "--ramp-caution-700", "--ramp-caution-50", 4.5],
  ["warning status / tint", "--ramp-warning-700", "--ramp-warning-50", 4.5],
  ["success status / tint", "--ramp-success-700", "--ramp-success-50", 4.5],
  ["info status / tint", "--ramp-info-700", "--ramp-info-50", 4.5],
  /**
   * The solid icon chip, BOTH stops (D-DT17 §4.2b).
   *
   * 3:1, not 4.5: the glyph is a non-text graphic, which is what WCAG 1.4.11 governs. Both stops
   * are checked rather than an average, because the gradient's lighter end is where a white glyph
   * goes first and an average would hide it.
   *
   * ⚠ This is the pair the whole light/dark step split exists for. The dark ramps turn over
   * between 300 and 400 — dark `success-400` is L 79% against `success-300` at 48% — so reusing
   * light's 500→700 in dark puts the glyph on a pale ground at 1.78:1. Re-step a chip and this
   * gate is what tells you, in the scheme you were not looking at.
   */
  ...["danger", "caution", "warning", "success", "info", "brand", "neutral"].flatMap((tone) => [
    [`chip glyph / ${tone} head`, "--chip-glyph", `--chip-${tone}-from`, 3],
    [`chip glyph / ${tone} foot`, "--chip-glyph", `--chip-${tone}-to`, 3],
  ]),
];

let failed = false;
for (const want of ["light", "dark"]) {
  console.log(`── ${want} scheme`);
  for (const [label, foreground, background, minimum] of pairs) {
    const ratio = contrast(foreground, background, want);
    const pass = ratio + Number.EPSILON >= minimum;
    console.log(`${pass ? "✓" : "✗"} ${label}: ${ratio.toFixed(2)}:1 (minimum ${minimum}:1)`);
    failed ||= !pass;
  }
}

/**
 * ── The chip's gradient, structurally (D-DT17) ──────────────────────────────────────────────────
 *
 * Two rules that are not about contrast and are here anyway, because this is the script that reads
 * the sheet and resolving a `var()` chain is the thing it now knows how to do. They exist for the
 * same reason the ratios above do: a chip is drawn from four tokens per tone, and a reader who
 * wants to know whether the set is coherent has nowhere else to look.
 *
 *   1. Every tone declares the whole set. A missing `--elevation-chip-<tone>` is a `shadow-chip-*`
 *      class that Tailwind emits nothing for, and a chip with no glow renders in silence.
 *   2. Both stops stay on ONE hue's ramp, in BOTH schemes. A green→blue chip invents a colour
 *      relationship the token system does not have; the dark branch is the half nobody looks at,
 *      and it is the branch that had to be re-stepped by hand.
 *
 * The tone list is read off the sheet rather than listed here — an eighth tone must be checked by
 * having arrived, not by somebody remembering to add it in two places.
 */
const chipTones = [...source.matchAll(/^\s*--chip-([a-z]+)-from\s*:/gm)].map((m) => m[1]);
console.log(`── chip gradients (${chipTones.length} tones)`);
if (chipTones.length === 0) {
  console.log("✗ no --chip-*-from tokens found — this check has gone blind, not quiet");
  failed = true;
}
for (const tone of chipTones) {
  const missing = [`--chip-${tone}-to`, `--chip-${tone}-glow`, `--elevation-chip-${tone}`].filter(
    (name) => !new RegExp(`^\\s*${name}\\s*:`, "m").test(source),
  );
  const hues = new Set();
  for (const want of ["light", "dark"]) {
    for (const stop of [`--chip-${tone}-from`, `--chip-${tone}-to`]) {
      const step = scheme(declaration(stop), want).match(/^var\(\s*--ramp-([a-z]+)-\d+\s*\)$/);
      hues.add(step ? step[1] : `not a ramp step (${stop}, ${want})`);
    }
  }
  const ok = missing.length === 0 && hues.size === 1 && hues.has(tone);
  console.log(
    `${ok ? "✓" : "✗"} ${tone}: stops on ${[...hues].join(" + ")}` +
      (missing.length ? `; missing ${missing.join(", ")}` : ""),
  );
  failed ||= !ok;
}

if (failed) process.exit(1);
