#!/usr/bin/env node
/**
 * Fitness function — no NEW god-files.
 * Fails CI if a non-test source file (.ts/.vue) exceeds the line budget, unless it is grandfathered
 * below. The grandfather list may only SHRINK: Phase 3 splits these into modules, then we delete the
 * entry here. Adding a new entry is a deliberate, reviewable act — not something that happens silently.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BUDGET = 500;
const SCAN_DIRS = ["apps", "packages"];
const SKIP = new Set(["node_modules", "dist", ".git", "coverage", ".pnpm-store"]);

// Grandfathered god-files (measured 2026-07-18). Split in Phase 3, then remove from this list.
const GRANDFATHERED = new Set([
  "packages/shared/src/samsara.ts",
  "apps/api/src/services/scoring.ts",
]);

const isSource = (f) =>
  !f.endsWith(".test.ts") && !f.endsWith(".spec.ts") && (extname(f) === ".ts" || extname(f) === ".vue");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (isSource(name)) out.push(full);
  }
  return out;
}

const violations = [];
for (const d of SCAN_DIRS) {
  let files;
  try { files = walk(join(ROOT, d)); } catch { continue; }
  for (const full of files) {
    const rel = relative(ROOT, full);
    const lines = readFileSync(full, "utf8").split("\n").length;
    if (lines > BUDGET && !GRANDFATHERED.has(rel)) violations.push({ rel, lines });
  }
}

const staleAllow = [...GRANDFATHERED].filter((g) => {
  try { statSync(join(ROOT, g)); return false; } catch { return true; }
});
if (staleAllow.length) {
  console.warn("⚠ grandfather entries that no longer exist (remove them from scripts/check-file-size.mjs):");
  for (const s of staleAllow) console.warn("  - " + s);
}

if (violations.length) {
  console.error(`✗ ${violations.length} file(s) over the ${BUDGET}-line budget — split into modules:`);
  for (const v of violations.sort((a, b) => b.lines - a.lines)) console.error(`  ${v.lines}  ${v.rel}`);
  console.error("\nSplit using the smartFueling/ recon/ module pattern (Phase 3). To grandfather deliberately, add the path to GRANDFATHERED.");
  process.exit(1);
}
console.log(`✓ file-size budget ok — no non-grandfathered source file over ${BUDGET} lines (${GRANDFATHERED.size} grandfathered).`);
