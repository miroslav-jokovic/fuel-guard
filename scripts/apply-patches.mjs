/**
 * apply-patches.mjs
 *
 * Applies targeted string replacements to node_modules after every `pnpm install`.
 * Idempotent — safe to run multiple times.
 *
 * Current patches:
 *   expo-modules-jsi — fixes Swift 6.2 (Xcode 26) type-ambiguity in JavaScriptCodable+Date.swift:
 *     abs(milliseconds) → milliseconds.magnitude
 *     (abs has multiple overloads; Swift 6 strict concurrency can't resolve without annotation;
 *      .magnitude is the unambiguous Double property equivalent)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");

const patches = [
  {
    package: "expo-modules-jsi",
    file: "apple/Sources/ExpoModulesJSI/Coding/JavaScriptCodable+Date.swift",
    from: "abs(milliseconds) <=",
    to: "milliseconds.magnitude <=",
  },
];

function installedCopies(packageName, relativeFile) {
  const candidates = [join(root, "node_modules", packageName, relativeFile)];
  const pnpmStore = join(root, "node_modules", ".pnpm");
  if (existsSync(pnpmStore)) {
    for (const entry of readdirSync(pnpmStore, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(`${packageName}@`)) continue;
      candidates.push(join(pnpmStore, entry.name, "node_modules", packageName, relativeFile));
    }
  }
  return [...new Set(candidates)];
}

for (const patch of patches) {
  const targets = installedCopies(patch.package, patch.file).filter(existsSync);
  if (!targets.length) {
    console.log(`[apply-patches] skip ${patch.package}/${patch.file} — not installed`);
    continue;
  }
  for (const filePath of targets) {
    const original = readFileSync(filePath, "utf8");
    if (original.includes(patch.to)) {
      console.log(`[apply-patches] ✓ already applied: ${filePath}`);
      continue;
    }
    if (!original.includes(patch.from)) {
      console.warn(`[apply-patches] ⚠ patch target not found in ${filePath} — may need updating`);
      continue;
    }
    writeFileSync(filePath, original.replace(patch.from, patch.to), "utf8");
    console.log(`[apply-patches] ✓ patched: ${filePath}`);
  }
}
