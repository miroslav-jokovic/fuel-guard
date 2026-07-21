#!/usr/bin/env node
/**
 * Fitness function — design-token single source of truth (interim).
 * Until apps/web is consolidated onto @fuelguard/ui, the token layer exists in two files. This check
 * fails CI if they diverge, so the customer and platform planes can never drift apart visually.
 * Remove this script (and its CI step) once apps/web imports @fuelguard/ui/tokens.css directly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const A = `${root}apps/web/src/style.css`;
const B = `${root}packages/ui/src/tokens.css`;

const a = readFileSync(A, "utf8");
const b = readFileSync(B, "utf8");

if (a !== b) {
  console.error("✗ design-token drift: apps/web/src/style.css and packages/ui/src/tokens.css differ.");
  console.error("  Keep them byte-identical (copy one over the other) until apps/web adopts @fuelguard/ui.");
  process.exit(1);
}
console.log("✓ token parity ok — apps/web/src/style.css === packages/ui/src/tokens.css");
