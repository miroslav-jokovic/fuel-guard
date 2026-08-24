#!/usr/bin/env node
/**
 * `light-dark()` must reach the browser un-transpiled.
 *
 * ── The failure this exists for, which shipped and nothing caught ───────────────────────────────
 * Lightning CSS minifies this project's CSS and, by default, rewrites `light-dark(a, b)` into
 * `var(--lightningcss-light, a) var(--lightningcss-dark, b)`, with the two variables switched by a
 * `@media (prefers-color-scheme: dark)` block. That polyfill follows the OPERATING SYSTEM and
 * nothing else — so setting `color-scheme` on <html>, which is the entire mechanism of the in-app
 * scheme toggle, could never reach it. Choosing Light while the OS was dark changed nothing, and
 * dark had only ever looked right because the OS happened to agree.
 *
 * Every other gate reads the SOURCE CSS, where `light-dark()` is present and correct. The rewrite
 * happens during minification and nothing looked at build output, so the defect was invisible to
 * the whole suite. A person using the toggle found it (2026-08-23, D-DS2).
 *
 * ── Why a script and not a test ─────────────────────────────────────────────────────────────────
 * A vitest file cannot import either vite config: both resolve paths from `import.meta.url`, which
 * is not a file URL under vitest's transform, so the import throws before any assertion runs. This
 * runs in plain node instead.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const CONFIGS = ["apps/web/vite.config.ts", "apps/admin/vite.config.ts"];
const EXCLUDE = /lightningcss:\s*\{\s*exclude:\s*Features\.LightDark\s*\}/;

let failed = false;

for (const relative of CONFIGS) {
  const source = readFileSync(`${root}${relative}`, "utf8");
  if (EXCLUDE.test(source)) {
    console.log(`✓ ${relative} excludes the LightDark transform`);
  } else {
    console.error(
      `✗ ${relative} does not exclude Features.LightDark from Lightning CSS.\n` +
        `  Without it the scheme toggle silently stops working: every themed token becomes a\n` +
        `  prefers-color-scheme polyfill that an explicit color-scheme cannot override.`,
    );
    failed = true;
  }
}

/**
 * Build output is the real proof, but CI builds AFTER it lints, so dist is usually absent here.
 * When it does exist — any local build, or a CI that later moves this step after `pnpm build` —
 * check it, because a config can be right while a toolchain change defeats it anyway.
 */
const dist = `${root}apps/web/dist/assets`;
if (existsSync(dist)) {
  const css = readdirSync(dist)
    .filter((f) => f.endsWith(".css"))
    .map((f) => readFileSync(`${dist}/${f}`, "utf8"))
    .join("");
  if (css.includes("--lightningcss-light")) {
    console.error("✗ built CSS still contains the --lightningcss-* polyfill — the exclusion is not taking effect");
    failed = true;
  } else if (css.includes("light-dark(")) {
    console.log("✓ built CSS carries native light-dark()");
  } else {
    console.log("• built CSS contains no light-dark() at all — nothing to check");
  }
} else {
  console.log("• apps/web/dist absent, so build output was not checked (run pnpm build first)");
}

if (failed) process.exit(1);
