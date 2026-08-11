#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(`${root}apps/web/src/features/dashboard/chartTheme.ts`, "utf8");

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

let failed = false;
for (const [label, hex] of severity) {
  const ratio = contrast(hex);
  const pass = ratio >= 3;
  console.log(`${pass ? "✓" : "✗"} ${label} / white: ${ratio.toFixed(2)}:1`);
  failed ||= !pass;
}

for (const [mode, matrix] of Object.entries(simulations)) {
  const colors = severity.map(([label, hex]) => [label, simulate(linear(hex), matrix)]);
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
  console.log(`${pass ? "✓" : "✗"} ${mode} minimum separation: ${minimum.toFixed(3)} (${closest})`);
  failed ||= !pass;
}

if (failed) process.exit(1);
