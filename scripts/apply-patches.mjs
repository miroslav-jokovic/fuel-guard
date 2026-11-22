/**
 * apply-patches.mjs
 *
 * Applies targeted string replacements to node_modules after every `pnpm install`.
 * Idempotent — safe to run multiple times.
 *
 * WORKAROUND, labelled as CLAUDE.md asks: each entry routes around an upstream bug we cannot fix in
 * this repo, and each says what removes it. When the upstream release changes the text, the script
 * prints "patch target not found" — that is the cue to check whether the entry can go.
 *
 * Current patches:
 *   expo-modules-jsi (SDK 58) — Swift 6.2 (Xcode 26.2 and 26.3) refuses `withEncodedValue` in
 *     Runtime/Values/JavaScriptObject.swift: "sending 'slot' risks causing data races". The pointer is
 *     `nonisolated(unsafe)`, yet `JavaScriptActor.assumeIsolated`'s closure still may not capture it.
 *     The fix passes the address in as a plain `UInt` and rebuilds the pointer inside the closure;
 *     the closure still runs synchronously on the same thread, so nothing about the call changes.
 *     Upstream: https://github.com/expo/expo/issues/52754 (open since 2026-11-02; 58.0.23, the
 *     latest SDK 58 release on 2026-11-22, still has it). Removed by the expo-modules-jsi release
 *     that fixes that issue. Without it no iOS build of the driver app compiles (Visual 2026 V3b,
 *     D-DV24). There is no iOS CI job, so nothing in CI would notice its absence.
 *
 * Retired: SDK 57's `abs(milliseconds)` → `milliseconds.magnitude` in Coding/JavaScriptCodable+Date.swift.
 *   SDK 58's expo-modules-jsi ships that fix itself.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");

const JSI_OBJECT = "apple/Sources/ExpoModulesJSI/Runtime/Values/JavaScriptObject.swift";

const patches = [
  {
    package: "expo-modules-jsi",
    file: JSI_OBJECT,
    from: "    nonisolated(unsafe) let slot = buffer.baseAddress!\n",
    to:
      "    let slot = buffer.baseAddress!\n" +
      "    // Passed as an integer so the isolated closure captures no non-Sendable pointer (expo/expo#52754).\n" +
      "    let slotAddress = UInt(bitPattern: slot)\n",
  },
  {
    package: "expo-modules-jsi",
    file: JSI_OBJECT,
    from: "      try JavaScriptActor.assumeIsolated {\n        try encode(JavaScriptValue.Slot(slot), runtime)\n",
    to:
      "      try JavaScriptActor.assumeIsolated {\n" +
      "        let slot = UnsafeMutablePointer<facebook.jsi.Value>(bitPattern: slotAddress)!\n" +
      "        try encode(JavaScriptValue.Slot(slot), runtime)\n",
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
