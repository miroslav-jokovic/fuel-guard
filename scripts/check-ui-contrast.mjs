#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(`${root}packages/ui/src/tokens.generated.css`, "utf8");

function token(name) {
  const match = source.match(
    new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*:\\s*([^;]+);`, "m"),
  );
  if (!match) throw new Error(`Missing production token ${name}`);
  const value = match[1].trim();
  const parsed = value.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!parsed) throw new Error(`${name} must be an opaque oklch() value, received ${value}`);
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

function contrast(foreground, background) {
  const a = luminance(token(foreground));
  const b = luminance(token(background));
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
  ["gold accent foreground / accent", "--ink", "--brand-accent", 4.5],
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
];

let failed = false;
for (const [label, foreground, background, minimum] of pairs) {
  const ratio = contrast(foreground, background);
  const pass = ratio + Number.EPSILON >= minimum;
  console.log(`${pass ? "✓" : "✗"} ${label}: ${ratio.toFixed(2)}:1 (minimum ${minimum}:1)`);
  failed ||= !pass;
}

if (failed) process.exit(1);
