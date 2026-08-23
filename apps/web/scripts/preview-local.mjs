#!/usr/bin/env node
/**
 * One command that turns a working tree into a URL you can point a browser at.
 *
 * ── Why this script exists (D-DS13, docs/plans/design-system/DESIGN-SYSTEM-2026.md) ──────────────
 * `vite dev` does not run on every machine: it crashes in the rolldown dependency optimiser with
 * `RangeError: WebAssembly.Memory.grow(): Maximum memory size exceeded`, reproduced on Node 23.6.0
 * (2026-08-18) and 26.7.0 (2026-08-21 and 2026-08-23) — two majors apart, so it is vite/rolldown
 * rather than the runtime. It fails while scanning node_modules, BEFORE touching project code, so
 * it is never a regression from your change, and clearing node_modules/.vite does not help.
 *
 * `vite build` is unaffected — measured at ~0.7s for this app. So the working loop is
 * build → preview → browser, which is what this script is. Until 2026-08-23 the standing belief in
 * this project was that local visual verification was impossible; that was only ever true of `dev`.
 *
 * ── Why it loads .env itself ────────────────────────────────────────────────────────────────────
 * `vite.config.ts` reads `process.env.VITE_SUPABASE_*` directly rather than Vite's `loadEnv`, so a
 * production build throws "Production web build is missing: …" even when apps/web/.env exists —
 * dotenv files are loaded by Vite for the CLIENT bundle, not into the config's own process.env.
 * Rather than change that guard (it is deliberate: it stops a credential-less bundle reaching
 * Railway), this script exports the file the way a shell would.
 *
 * The design-system lab at /__design-system is switched on, because it is the only surface that
 * renders real primitives without a login — see apps/web/CLAUDE.md.
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const envPath = `${webRoot}.env`;

/**
 * Minimal dotenv reader. Deliberately not a dependency: this runs before install-time tooling is
 * guaranteed and the format we need is the one a POSIX shell would accept with `set -a`.
 * Values are never printed — only key names appear in diagnostics.
 */
function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const result = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let [, key, value] = match;
    value = value.trim();
    // Strip one matching pair of surrounding quotes; leave inner quotes alone.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim(); // unquoted values may carry a trailing comment
    }
    result[key] = value;
  }
  return result;
}

const REQUIRED = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];

const fileEnv = readEnvFile(envPath);
// A non-empty value already in the environment wins, so CI and one-off shell overrides behave as
// expected; the file fills in the rest. Starting from process.env keeps PATH, HOME and the like.
const env = { ...process.env };
for (const [key, value] of Object.entries(fileEnv)) if (!env[key]) env[key] = value;

const missing = REQUIRED.filter((key) => !env[key]);
if (missing.length) {
  console.error(`\n✗ Cannot build: ${missing.join(", ")} not set.`);
  console.error(
    existsSync(envPath)
      ? `  apps/web/.env exists but does not define ${missing.length > 1 ? "them" : "it"}.`
      : `  apps/web/.env does not exist. Copy apps/web/.env.example and fill it in.`,
  );
  console.error(`  Or export ${missing.join(" and ")} in your shell.\n`);
  process.exit(1);
}

const portArgIndex = process.argv.indexOf("--port");
const port = portArgIndex === -1 ? "4173" : process.argv[portArgIndex + 1];

// The lab is the only surface that renders real primitives without a login.
env.VITE_ENABLE_DESIGN_SYSTEM_LAB = "true";

/**
 * Resolve vite's own binary instead of trusting PATH. pnpm hoists it to the workspace root, so
 * apps/web/node_modules/.bin/vite does not exist and a bare spawn("vite") only works when the
 * caller happens to be pnpm. `vite/bin/vite.js` is not in the package's `exports`, so go through
 * package.json and its declared `bin` entry. No shell: arguments stay unescaped-by-nobody.
 */
const require = createRequire(import.meta.url);
const vitePackagePath = require.resolve("vite/package.json");
const viteBin = join(dirname(vitePackagePath), require(vitePackagePath).bin.vite);

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [viteBin, ...args], { cwd: webRoot, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`vite ${args[0]} exited ${code}`)),
    );
  });
}

try {
  await run(["build"]);
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
}

console.log(`\n  Design system lab → http://localhost:${port}/__design-system`);
console.log(`  Everything else is behind the login wall.\n`);

await run(["preview", "--port", port]);
