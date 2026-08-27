#!/usr/bin/env node
/**
 * Fitness function — architectural boundaries that must hold as the codebase grows.
 *
 *  1. Feature isolation (web + driver + api): a feature under `apps/<app>/src/features/<name>` — and,
 *     since the 2026-08-26 re-founding, an API module under `apps/api/src/modules/<name>` (D-ARC1,
 *     docs/ARCHITECTURE.md) — must not import a sibling's internals, via alias OR a relative path that
 *     climbs across. Shared code lives in `@/composables`, `@/components`, `@/lib`, `@/stores`.
 *  2. Hazmat packages stay dependency-free (D3 / G5): `@hazmat/engine`, `@hazmat/data` and
 *     `@hazmat/placards` may not import `@silvicom/*` or the web `@/` alias; engine↔data stay apart, and
 *     placards may lean on the engine only (it renders placards for engine verdicts).
 *  3. Engine determinism: `@hazmat/engine` (the pure decision engine) may not use non-deterministic APIs
 *     (Date.now, argless new Date, Math.random, performance.now) or do I/O (fetch, require, node builtins),
 *     so a verdict is a pure function of its inputs — reproducible and testable.
 *
 * Accepted cross-feature deps go in the per-app ALLOW sets with a reason; anything else fails.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const violations = [];

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|vue)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Which feature (if any) an absolute path belongs to, relative to a features root. */
function featureOf(absPath, featuresDir) {
  const prefix = featuresDir + sep;
  if (!absPath.startsWith(prefix)) return null;
  return absPath.slice(prefix.length).split(sep)[0] || null;
}

/**
 * Check one app's feature dir: no feature may reach into a sibling feature. Catches BOTH the `@/features/`
 * alias form and relative paths resolved onto the filesystem, so a `../otherFeature/x` leak can't hide.
 * Missing dir (e.g. the driver app not yet on this branch) → skip silently; the check activates on arrival.
 */
function checkFeatureIsolation(featuresDir, allow, label) {
  let features;
  try {
    features = readdirSync(featuresDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return; // no features dir for this app — nothing to check yet
  }
  const known = new Set(features);
  for (const feat of features) {
    for (const file of walk(join(featuresDir, feat))) {
      const src = readFileSync(file, "utf8");
      // Static `from "…"` / `import "…"` AND dynamic `import("…")` — the dynamic form was a known bypass.
      for (const m of src.matchAll(/(?:from|import)\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']/g)) {
        const spec = m[1] ?? m[2];
        let target = null;
        const alias = /^@\/features\/([a-z0-9-]+)(?:\/|$)/i.exec(spec);
        if (alias) target = alias[1];
        else if (spec.startsWith(".")) target = featureOf(resolve(dirname(file), spec), featuresDir);
        if (!target || !known.has(target) || target === feat) continue;
        if (allow.has(`${feat} -> ${target}`)) continue;
        const kind = label === "api" ? "modules" : "features";
        violations.push(`[${label}] ${relative(ROOT, file)}  ->  ${kind}/${target}/…  (cross-${kind === "modules" ? "module" : "feature"} import)`);
      }
    }
  }
}

// Empty since 2026-08-26: the one entry ("anomalies -> ai") outlived its feature — features/ai was
// dissolved and nothing imports it. An allow-list entry with no matching import is how the NEXT leak
// gets waved through, so a dead entry is treated as rot, not as slack.
const WEB_ALLOW = new Set([]);
// Kept empty, and the story is worth keeping: an earlier audit predicted `features/loads/useLoads.ts`
// would be flagged for reaching into `features/auth` + `features/home`. It never was — both hooks were
// PROMOTED to `apps/driver/src/session/`, which is the intended fix for every entry that tries to land
// here: promote the shared thing out of `features/`, don't allow-list the leak.
const DRIVER_ALLOW = new Set([]);
// apps/api modules (D-ARC1, docs/ARCHITECTURE.md): the carve-outs land under apps/api/src/modules/<name>,
// and module isolation is enforced from the FIRST module — the dir not existing yet skips silently, the
// same forward-arming as the driver check below.
const API_ALLOW = new Set([
  // Samsara's roster syncs defer to McLeod on identity fields when the org has declared McLeod
  // roster master (isTmsRosterMaster, via mcleod's index only). A real cross-collector rule,
  // recorded here so the day it changes, this entry says who depended on it.
  "samsara -> mcleod",
]);
checkFeatureIsolation(join(ROOT, "apps/web/src/features"), WEB_ALLOW, "web");
checkFeatureIsolation(join(ROOT, "apps/driver/src/features"), DRIVER_ALLOW, "driver");
checkFeatureIsolation(join(ROOT, "apps/api/src/modules"), API_ALLOW, "api");

// ── real-data guarantee (hardening plan Phase 2): sample/placeholder data may ONLY be imported by
// the dev-only component gallery. Production surfaces render live API data or nothing — a sample
// import anywhere else is how fake fuel stops end up demoed to a customer as if they were real. ──
const SAMPLE_IMPORT = /(?:from|import)\s+["'][^"']*\/(sample[A-Z][A-Za-z]*|sample-[a-z-]+)["']/g;
const SAMPLE_ALLOWED = new Set(["apps/driver/app/gallery.tsx"]);
let driverAppFiles = [];
for (const rel of ["apps/driver/app", "apps/driver/src"]) {
  try { driverAppFiles.push(...walk(join(ROOT, rel))); } catch { /* app not on this branch */ }
}
for (const file of driverAppFiles) {
  const relPath = relative(ROOT, file);
  if (SAMPLE_ALLOWED.has(relPath) || /sample[A-Z][A-Za-z]*\.(ts|tsx)$/.test(file)) continue;
  for (const m of readFileSync(file, "utf8").matchAll(SAMPLE_IMPORT)) {
    violations.push(`${relPath}  imports ${m[1]}  (sample data is gallery-only — real-data guarantee)`);
  }
}

// ── package boundary: @hazmat/* stay dependency-free of the app and of each other (D3 / G5).
// `@hazmat/placards` was unscanned until 2026-08-26 — the exact blind spot this scan exists to
// prevent. It may import @hazmat/engine (it renders placards for engine verdicts, declared as a
// real dependency), but the app boundary holds for it like its siblings. ──
for (const [rel, forbiddenSpecs] of [
  ["packages/hazmat-engine", ["@silvicom/", "@/", "@hazmat/data"]],
  ["packages/hazmat-data", ["@silvicom/", "@/", "@hazmat/engine"]],
  ["packages/hazmat-placards", ["@silvicom/", "@/", "@hazmat/data"]],
]) {
  const forbidden = new RegExp(`from\\s+["'](${forbiddenSpecs.map((s) => s.replace("/", "\\/")).join("|")})`, "g");
  let pkgFiles;
  try { pkgFiles = walk(join(ROOT, rel)); } catch { continue; }
  for (const file of pkgFiles) {
    for (const m of readFileSync(file, "utf8").matchAll(forbidden)) {
      violations.push(`${relative(ROOT, file)}  ->  ${m[1]}…  (hazmat packages must stay dependency-free — D3/G5)`);
    }
  }
}

// ── engine determinism: a verdict must be a pure function of its inputs (audit: engine-determinism). ──
// Scope is @hazmat/engine ONLY — @hazmat/data legitimately does I/O (it loads the dataset). Tests exempt.
const DETERMINISM_RULES = [
  [/\bDate\.now\s*\(/, "Date.now()"],
  [/\bnew\s+Date\s*\(\s*\)/, "new Date() (argless — use an injected clock)"],
  [/\bMath\.random\s*\(/, "Math.random()"],
  [/\bperformance\.now\s*\(/, "performance.now()"],
  [/\bfetch\s*\(/, "fetch() (I/O)"],
  [/\brequire\s*\(/, "require() (I/O)"],
  [/\bimport\s*\(/, "dynamic import() (I/O)"],
  [/from\s+["'](?:node:|fs|os|crypto|child_process|http|https|net|dns|dgram)["']/, "node builtin import (I/O)"],
  [/from\s+["']@supabase\//, "@supabase client import (I/O — the engine must not touch the DB)"],
];
let engineFiles;
try { engineFiles = walk(join(ROOT, "packages/hazmat-engine/src")); } catch { engineFiles = []; }
for (const file of engineFiles) {
  if (/\.test\.tsx?$/.test(file)) continue; // tests may use clocks/random
  const src = readFileSync(file, "utf8");
  for (const [re, what] of DETERMINISM_RULES) {
    if (re.test(src)) {
      violations.push(`${relative(ROOT, file)}  uses ${what}  (@hazmat/engine must stay deterministic/pure)`);
    }
  }
}

if (violations.length) {
  console.error(`✗ ${violations.length} boundary violation(s):`);
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}
console.log("✓ boundaries ok — feature isolation (web + driver + api modules), hazmat packages dependency-free, engine deterministic.");
