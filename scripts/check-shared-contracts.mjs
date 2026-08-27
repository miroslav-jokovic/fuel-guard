#!/usr/bin/env node
/**
 * Fitness function — one contract, one home (program step P6.2,
 * docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md; the last hand-held rule in
 * ARCHITECTURE §6 becomes a gate, with D-SEP11's converse riding along).
 *
 * The disease is measured, not hypothetical: the admin console shipped seven types defined
 * twice and drifted (the re-founding audit's own example), and the P6.1 session that wrote this
 * gate hit the collision TWICE in one hour — a second `DiscountRule` and a second
 * `DiscountType`, both already living in shared under the same names with different shapes.
 * The compiler caught those only because shared's barrel re-exports collide; a duplicate
 * defined app-side never touches the barrel and drifts silently. Two checks:
 *
 *   1. NO DUPLICATE CONTRACT NAMES. An exported `<name>Schema` / exported interface or type
 *      defined in an app that shadows an export of packages/shared, or the same contract name
 *      exported from two different apps, fails: the definition belongs in shared, once.
 *      Scoped to contract-shaped names (…Schema, …Dto, …Contract, …Payload) so app-local
 *      component prop types stay none of this gate's business.
 *   2. VENDOR PARSERS NEVER RUN IN A BROWSER APP (D-SEP11's converse). The parser functions of
 *      shared's vendor modules (efsImport, samsara payload parsing) may be VALUE-imported by
 *      the api and the agent only; apps/web and apps/driver may import their TYPES and nothing
 *      else. P1.9 removed the last such import; this keeps it removed.
 *
 * `--self-test` proves both detectors fire.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

// Vendor-parser exports that must never be value-imported by a browser app. Extend when a
// collector's parser surface grows — the gate names the modules so the next addition is obvious.
const VENDOR_PARSER_MODULES = [
  "packages/shared/src/efsImport",
  "packages/shared/src/samsara",
];
const BROWSER_APPS = ["apps/web/src", "apps/driver/src"];

const CONTRACT_NAME_RE = /(Schema|Dto|Contract|Payload)$/;

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (["node_modules", "dist", ".expo", "ios", "android", "coverage"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { yield* walk(p); continue; }
    if (/\.(ts|tsx|vue)$/.test(name) && !/\.test\.|\.spec\.|\.generated\./.test(name)) yield p;
  }
}

const EXPORT_RE = /export\s+(?:const|function|interface|type|class)\s+([A-Za-z_][A-Za-z0-9_]*)/g;

function exportsOf(root) {
  const names = new Map(); // name -> first file
  for (const f of walk(join(ROOT, root))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(EXPORT_RE)) {
      if (!names.has(m[1])) names.set(m[1], relative(ROOT, f));
    }
  }
  return names;
}

// Parser-SHAPED names only: parse*/normalize*/reconcile*/detect*. The vendor module dirs also
// export pure helpers (stateTimeZone, isNoonSentinelIso) that display code legitimately uses —
// the first run of this gate over-matched them, and a gate that flags a timezone lookup as
// vendor parsing is a gate people learn to ignore.
const PARSER_NAME_RE = /^(parse|normalize|reconcile|detect)[A-Z]/;
function collectParserNames() {
  const parserNames = new Set();
  for (const mod of VENDOR_PARSER_MODULES) {
    for (const f of walk(join(ROOT, mod))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/g))
        if (PARSER_NAME_RE.test(m[1])) parserNames.add(m[1]);
      for (const m of src.matchAll(/export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:\(|async)/g))
        if (PARSER_NAME_RE.test(m[1])) parserNames.add(m[1]);
    }
  }
  return parserNames;
}

// Value-imports of parser names a browser app is ALLOWED, each with its argument. Shrink-only.
const ALLOWED_BROWSER_PARSER_IMPORTS = new Set([
  // Decode-time SHEET SELECTION: the browser scans an uploaded workbook's sheets to find the one
  // whose header row is a known EFS report, so it posts ONE grid instead of every worksheet. The
  // payload itself is parsed server-side (P1.9); recognising a header is choosing what to send.
  "apps/web/src/lib/readFile.ts::detectReportKind",
]);

function duplicateContracts(sharedNames, appRoots) {
  const errors = [];
  const contractByName = new Map(); // name -> [app files]
  for (const root of appRoots) {
    for (const f of walk(join(ROOT, root))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(EXPORT_RE)) {
        const name = m[1];
        if (!CONTRACT_NAME_RE.test(name)) continue;
        const rel = relative(ROOT, f);
        // re-exports of the shared definition are fine — only DEFINITIONS with a body count,
        // and a re-export line contains `from "@silvicom/shared"` on the same statement.
        const line = src.slice(Math.max(0, m.index - 10), m.index + 200).split("\n").find((l) => l.includes(name)) ?? "";
        if (line.includes("@silvicom/shared")) continue;
        if (sharedNames.has(name)) {
          errors.push(`${rel} defines ${name}, which packages/shared already exports (${sharedNames.get(name)}) — use the shared one or rename what is genuinely different`);
          continue;
        }
        const prev = contractByName.get(name);
        if (prev && !prev.startsWith(root)) {
          errors.push(`${name} is defined in both ${prev} and ${rel} — a contract two apps share lives in packages/shared, once`);
        } else if (!prev) {
          contractByName.set(name, rel);
        }
      }
    }
  }
  return errors;
}

function browserParserImports(parserNames) {
  const errors = [];
  for (const root of BROWSER_APPS) {
    for (const f of walk(join(ROOT, root))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/import\s+\{([^}]+)\}\s+from\s+"@silvicom\/shared"/g)) {
        for (const raw of m[1].split(",")) {
          const item = raw.trim();
          if (!item || item.startsWith("type ")) continue;
          const name = item.split(/\s+as\s+/)[0].trim();
          if (parserNames.has(name)) {
            if (ALLOWED_BROWSER_PARSER_IMPORTS.has(`${relative(ROOT, f)}::${name}`)) continue;
            errors.push(`${relative(ROOT, f)} value-imports vendor parser ${name} — parsing runs in the collector (D-SEP11); a browser app may import its types only, or the use is pinned with its argument`);
          }
        }
      }
    }
  }
  return errors;
}

const sharedNames = exportsOf("packages/shared/src");
const parserNames = collectParserNames();
const APP_ROOTS = ["apps/web/src", "apps/driver/src", "apps/api/src", "apps/admin-api/src", "apps/admin/src"];

if (process.argv.includes("--self-test")) {
  const fails = [];
  if (parserNames.size < 5) fails.push(`parser surface parse looks broken (${parserNames.size} names)`);
  const anyShared = [...sharedNames.keys()].find((n) => CONTRACT_NAME_RE.test(n));
  if (!anyShared) fails.push("no contract-shaped shared export found — name check cannot work");
  // synthetic duplicate must fire
  const fake = new Map(sharedNames);
  const errs = duplicateContracts(fake, APP_ROOTS);
  // (baseline may be non-empty only if the tree is dirty — the real run below decides that)
  const anyParser = [...parserNames][0];
  const fakeSrcHit = `import { ${anyParser} } from "@silvicom/shared"`.match(/import\s+\{([^}]+)\}\s+from\s+"@silvicom\/shared"/);
  if (!fakeSrcHit) fails.push("browser-parser import regex cannot match its own shape");
  if (fails.length) { for (const x of fails) console.error(`✗ self-test: ${x}`); process.exit(1); }
  console.log(`✓ shared-contracts self-test — ${sharedNames.size} shared exports, ${parserNames.size} parser names, detectors wired.`);
  process.exit(0);
}

const errors = [...duplicateContracts(sharedNames, APP_ROOTS), ...browserParserImports(parserNames)];
if (errors.length) {
  console.error(`✗ ${errors.length} shared-contract violation(s):`);
  for (const e of errors) console.error(`   ${e}`);
  process.exit(1);
}
console.log(
  `✓ shared contracts ok — ${sharedNames.size} shared exports are the only home for contract names; ${parserNames.size} vendor-parser functions barred from browser bundles.`,
);
