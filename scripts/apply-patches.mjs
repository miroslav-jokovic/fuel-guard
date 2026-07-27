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

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");

const patches = [
  {
    file: "expo-modules-jsi/apple/Sources/ExpoModulesJSI/Coding/JavaScriptCodable+Date.swift",
    from: "abs(milliseconds) <=",
    to: "milliseconds.magnitude <=",
  },
];

for (const { file, from, to } of patches) {
  const filePath = join(root, "node_modules", file);
  if (!existsSync(filePath)) {
    console.log(`[apply-patches] skip ${file} — not installed`);
    continue;
  }
  const original = readFileSync(filePath, "utf8");
  if (original.includes(to)) {
    console.log(`[apply-patches] ✓ already applied: ${file}`);
    continue;
  }
  if (!original.includes(from)) {
    console.warn(`[apply-patches] ⚠ patch target not found in ${file} — may need updating`);
    continue;
  }
  writeFileSync(filePath, original.replace(from, to), "utf8");
  console.log(`[apply-patches] ✓ patched: ${file}`);
}
