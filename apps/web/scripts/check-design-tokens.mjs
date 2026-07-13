#!/usr/bin/env node
/**
 * Design-token linter: fails if templates use raw palette utilities, hex
 * colors, or inline color styles instead of the semantic tokens defined in
 * src/style.css (see docs/DESIGN-SYSTEM.md).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname;

// Files allowed to contain raw color values, with the reason.
const ALLOW = new Set([
  "style.css", // defines the tokens themselves
  "features/dashboard/chartTheme.ts", // jsdom fallbacks for canvas charts
]);

const BANNED_HUES =
  "(?:slate|gray|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)";
const UTIL_PREFIX =
  "(?:bg|text|ring|border|divide|placeholder|outline|decoration|fill|stroke|accent|caret|from|via|to|shadow)";

const RULES = [
  {
    name: "raw palette utility (use semantic tokens)",
    re: new RegExp(`\\b${UTIL_PREFIX}-${BANNED_HUES}-\\d+(?:/\\d+)?\\b`, "g"),
  },
  { name: "hex color (use tokens / chartTheme)", re: /#[0-9a-fA-F]{3,8}\b/g },
  {
    name: "inline color style (use token classes)",
    re: /style="[^"]*(?:color|background)[^"]*"/g,
  },
];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(vue|ts|css|html)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) yield p;
  }
}

let failures = 0;
for (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  if (ALLOW.has(rel)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes("token-check-disable-line")) return;
    for (const rule of RULES) {
      for (const m of line.matchAll(rule.re)) {
        failures++;
        console.error(`${rel}:${i + 1}  ${rule.name}  →  ${m[0]}`);
      }
    }
  });
}

if (failures) {
  console.error(`\n✗ ${failures} design-token violation(s). See docs/DESIGN-SYSTEM.md.`);
  process.exit(1);
}
console.log("✓ design tokens clean");
