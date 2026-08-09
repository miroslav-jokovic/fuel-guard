#!/usr/bin/env node
/**
 * Fitness function: every test file in the repo is actually COLLECTED by its workspace's runner.
 *
 * WHY THIS EXISTS. This repository has now shipped the same bug three times: a test file that is
 * written, committed, reviewed, and never executed. The root package.json carries a comment key
 * recording the first two (the RLS matrices sat un-runnable for months behind stale migration
 * filenames while the ledger quoted their pass counts as fact). The third was found by the
 * 2026-08-09 audit: apps/driver/vitest.config.ts narrowed `include` to 'tests/**' only, so
 * src/data/policy.test.ts (the offline outbox retry policy - 20 cases) and src/lib/jwt.test.ts
 * (driver auth-claim decoding - 4 cases) had never run. Both suites passed the moment they were
 * collected, which is exactly the point: a silent skip does not look like a failure, it looks
 * like success.
 *
 * The check is deliberately static - it resolves each workspace's `include` patterns itself rather
 * than booting vitest. That keeps it fast enough to sit in `pnpm lint`, and it works on a machine
 * whose native toolchain cannot run. If a config ever uses glob syntax this matcher does not
 * understand, the script FAILS rather than guessing; extend globToRegExp at that point.
 *
 * Scope note: only `*.test.*` files are considered. `*.spec.*` belongs to Playwright in this repo
 * (apps/web/e2e), which vitest is correctly not collecting.
 *
 * Run: pnpm lint:tests
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Directories that never contain first-party source. */
const PRUNE = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".expo",
  ".git",
  ".turbo",
  "android",
  "ios",
  "__snapshots__",
]);

/** vitest's own default when a config declares no `include`. */
const VITEST_DEFAULT_INCLUDE = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];

const TEST_FILE_RE = /\.test\.(m|c)?[jt]sx?$/;

// ---------------------------------------------------------------------------
// glob -> RegExp. Supports exactly the syntax vitest configs in this repo use:
//   **/  **  *  ?  ?(a|b)  {a,b}  [jt]
// Anything else is a hard error, on purpose.
// ---------------------------------------------------------------------------
const escapeLiteral = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          out += "(?:[^/]*/)*";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      if (glob[i + 1] === "(") {
        const close = glob.indexOf(")", i);
        if (close === -1) throw new Error(`unbalanced '?(' in glob: ${glob}`);
        const inner = glob.slice(i + 2, close);
        if (/[*?{}[\]]/.test(inner))
          throw new Error(`unsupported nesting inside '?()' in glob: ${glob}`);
        out += `(?:${inner.split("|").map(escapeLiteral).join("|")})?`;
        i = close;
      } else {
        out += "[^/]";
      }
    } else if (c === "{") {
      const close = glob.indexOf("}", i);
      if (close === -1) throw new Error(`unbalanced '{' in glob: ${glob}`);
      const inner = glob.slice(i + 1, close);
      if (/[*?{}[\]]/.test(inner))
        throw new Error(`unsupported nesting inside '{}' in glob: ${glob}`);
      out += `(?:${inner.split(",").map(escapeLiteral).join("|")})`;
      i = close;
    } else if (c === "[") {
      const close = glob.indexOf("]", i);
      if (close === -1) throw new Error(`unbalanced '[' in glob: ${glob}`);
      out += glob.slice(i, close + 1);
      i = close;
    } else {
      out += escapeLiteral(c);
    }
  }
  return new RegExp(`^${out}$`);
}

// ---------------------------------------------------------------------------
function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (PRUNE.has(e.name)) continue;
      walk(join(dir, e.name), acc);
    } else if (e.isFile() && TEST_FILE_RE.test(e.name)) {
      acc.push(join(dir, e.name));
    }
  }
  return acc;
}

/** Workspace dirs from pnpm-workspace.yaml. Only the `dir/*` form this repo uses. */
function workspaceDirs() {
  const yaml = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  const globs = [...yaml.matchAll(/^\s*-\s*["']?([^"'\n]+?)["']?\s*$/gm)].map((m) => m[1]);
  const dirs = [];
  for (const g of globs) {
    if (!g.endsWith("/*")) continue;
    const parent = join(ROOT, g.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const name of readdirSync(parent)) {
      const d = join(parent, name);
      if (statSync(d).isDirectory() && existsSync(join(d, "package.json"))) dirs.push(d);
    }
  }
  return dirs.sort();
}

/** The `include` array from a workspace's vitest config, or null when it declares none. */
function readInclude(wsDir) {
  const candidates = [
    "vitest.config.ts",
    "vitest.config.mts",
    "vitest.config.js",
    "vitest.config.mjs",
  ];
  for (const f of candidates) {
    const p = join(wsDir, f);
    if (!existsSync(p)) continue;
    const src = readFileSync(p, "utf8");
    const m = src.match(/\binclude\s*:\s*\[([\s\S]*?)\]/);
    if (!m) return { file: f, patterns: null };
    const patterns = [...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]);
    if (patterns.length === 0) return { file: f, patterns: null };
    return { file: f, patterns };
  }
  return { file: null, patterns: null };
}

// ---------------------------------------------------------------------------
const problems = [];
const rows = [];

for (const wsDir of workspaceDirs()) {
  const pkg = JSON.parse(readFileSync(join(wsDir, "package.json"), "utf8"));
  const name = pkg.name ?? relative(ROOT, wsDir);
  const testScript = pkg.scripts?.test ?? null;
  const files = walk(wsDir).map((f) => relative(wsDir, f).split(sep).join("/"));

  if (files.length === 0) {
    rows.push({ name, files: 0, collected: 0, note: testScript ? "no test files" : "no tests" });
    continue;
  }

  if (!testScript) {
    problems.push(
      `${name}: has ${files.length} test file(s) but NO "test" script - \`pnpm -r test\` skips it silently.\n` +
        files.map((f) => `    ${f}`).join("\n"),
    );
    rows.push({ name, files: files.length, collected: 0, note: "NO test script" });
    continue;
  }

  if (!/\bvitest\b/.test(testScript)) {
    problems.push(
      `${name}: has ${files.length} test file(s) but its "test" script does not run a test runner:\n` +
        `    "test": ${JSON.stringify(testScript)}\n` +
        `  A script that cannot fail is not a test suite. Give it a real runner, or rename it so it\n` +
        `  stops being counted as one.`,
    );
    rows.push({ name, files: files.length, collected: 0, note: "no runner" });
    continue;
  }

  const { file: cfgFile, patterns } = readInclude(wsDir);
  const include = patterns ?? VITEST_DEFAULT_INCLUDE;
  let regexes;
  try {
    regexes = include.map(globToRegExp);
  } catch (err) {
    problems.push(
      `${name}: ${cfgFile ?? "vitest config"} uses glob syntax this checker cannot resolve - ${err.message}\n` +
        `  Extend globToRegExp in scripts/check-test-collection.mjs rather than weakening the check.`,
    );
    continue;
  }

  const missed = files.filter((f) => !regexes.some((re) => re.test(f)));
  if (missed.length > 0) {
    problems.push(
      `${name}: ${missed.length} test file(s) are NEVER COLLECTED by ${cfgFile ?? "the runner"}.\n` +
        `  include: ${JSON.stringify(include)}\n` +
        missed.map((f) => `    ${f}`).join("\n") +
        `\n  These files look like tests, are committed, and never run. Widen \`include\` or delete them.`,
    );
  }
  rows.push({
    name,
    files: files.length,
    collected: files.length - missed.length,
    note: cfgFile ?? "vitest defaults",
  });
}

const width = Math.max(...rows.map((r) => r.name.length), 9);
console.log("workspace".padEnd(width), "files", "collected", " config");
for (const r of rows) {
  const flag = r.collected < r.files ? " x" : "  ";
  console.log(
    r.name.padEnd(width),
    String(r.files).padStart(5),
    String(r.collected).padStart(9),
    flag,
    r.note,
  );
}

if (problems.length > 0) {
  console.error(`\nFAIL check-test-collection: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error("  " + p + "\n");
  console.error(
    "A test that never runs reads as coverage it has not earned. Fix the collection, not this check.",
  );
  process.exit(1);
}
console.log("\nOK - every *.test.* file in every workspace is collected by its runner");
