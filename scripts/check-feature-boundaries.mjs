#!/usr/bin/env node
/**
 * Fitness function — web features must not import each other's internals.
 * Shared code lives in @/composables, @/components, @/lib, @/stores. Accepted cross-feature deps are
 * listed in ALLOW with a reason; anything else fails so new coupling can't creep in.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const FEATURES = join(ROOT, "apps/web/src/features");
const ALLOW = new Set([
  "anomalies -> ai", // AnomalyDetail uses the AI-verification card + hooks
]);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|vue)$/.test(e.name)) out.push(p);
  }
  return out;
}

let features;
try { features = readdirSync(FEATURES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
catch { console.log("no features dir — skipping"); process.exit(0); }

const violations = [];
for (const feat of features) {
  for (const file of walk(join(FEATURES, feat))) {
    for (const m of readFileSync(file, "utf8").matchAll(/from\s+["']@\/features\/([a-z0-9-]+)\//gi)) {
      const target = m[1];
      if (target === feat || ALLOW.has(`${feat} -> ${target}`)) continue;
      violations.push(`${relative(ROOT, file)}  ->  @/features/${target}/…`);
    }
  }
}

if (violations.length) {
  console.error(`✗ ${violations.length} cross-feature import(s) — move shared code to @/composables, or add to ALLOW with a reason:`);
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}
console.log("✓ feature boundaries ok — no unlisted cross-feature imports.");
