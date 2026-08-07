#!/usr/bin/env node
/**
 * Fitness function — shared design-token contract.
 *
 * `packages/ui/src/tokens.css` is the canonical shared token source. The web app may add
 * web-only tokens (fonts and workspace navigation), but every token defined by the shared
 * package must exist in the web stylesheet with the exact same value. Comparing declarations
 * instead of whole files prevents false failures from those intentional platform-specific
 * extensions while still catching visual drift in the shared contract.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const webPath = `${root}apps/web/src/style.css`;
const sharedPath = `${root}packages/ui/src/tokens.css`;

function customProperties(css, source) {
  const properties = new Map();
  for (const match of css.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) {
    const [, name, rawValue] = match;
    const value = rawValue.trim();
    const previous = properties.get(name);
    if (previous !== undefined && previous !== value) {
      throw new Error(`${source} defines ${name} with conflicting values (${previous} vs ${value}).`);
    }
    properties.set(name, value);
  }
  return properties;
}

let webTokens;
let sharedTokens;
try {
  webTokens = customProperties(readFileSync(webPath, "utf8"), webPath);
  sharedTokens = customProperties(readFileSync(sharedPath, "utf8"), sharedPath);
} catch (error) {
  console.error(`✗ could not inspect design tokens: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const missing = [];
const drift = [];
for (const [name, expected] of sharedTokens) {
  const actual = webTokens.get(name);
  if (actual === undefined) missing.push(name);
  else if (actual !== expected) drift.push(`${name}: shared=${expected}, web=${actual}`);
}

if (missing.length || drift.length) {
  console.error("✗ design-token drift between packages/ui and apps/web.");
  if (missing.length) console.error(`  Missing from web: ${missing.join(", ")}`);
  for (const detail of drift) console.error(`  ${detail}`);
  process.exit(1);
}

console.log(`✓ token parity ok — ${sharedTokens.size} shared declarations match; web-only extensions allowed`);
