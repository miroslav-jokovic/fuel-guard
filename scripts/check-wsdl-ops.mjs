#!/usr/bin/env node
/**
 * Fitness function — every CardManagementWS operation emitted by the API is present in the checked-in WSDL.
 *
 * The EFS endpoint is Axis2 and its operation spelling is case-sensitive. A request can be perfectly
 * shaped and still fail at dispatch when the name differs from the binding, so this keeps code and the
 * retrieved contract tied together.
 *
 * ── WHY THIS FILE HAS A --self-test, ADDED 2026-09-05 ────────────────────────────────────────────
 * Because it spent time reporting success while checking nothing, and twice over.
 *
 *   1. It read the operations table from a path spelled here — `apps/api/src/lib/efsCardOps.ts`. On
 *      2026-08-26 (9ef029e) the whole EFS surface moved to `apps/api/src/modules/efs/lib/`, so
 *      `readFileSync` threw ENOENT and killed the process before one operation was compared. A crash
 *      is not a failing check, and nothing in CI invoked this script either, so main stayed green
 *      with the gate dead for ten days.
 *   2. Under that, `/const OPS = \{…\n\};/` never matched `const OPS = { … } as const;` — which is
 *      how `efsCardOps.ts` has always declared it. The `?? ""` fallback turned "cannot read the
 *      table" into "the table is empty", so even before the move this gate checked 24 literal
 *      wrappers and silently skipped all six interpolated names.
 *
 * Both failures were silent, and a silent gate is worse than no gate: it is a claim of coverage.
 * So the two fixes are structural rather than one-line — the OPS table is read from the file the
 * walker is already holding (a path cannot go stale if it is not written down), an interpolated
 * wrapper whose names cannot be resolved is a FAILURE rather than a quiet zero, and `--self-test`
 * proves all three detectors still fire.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SOURCE_ROOT = join(ROOT, "apps", "api", "src");
const WSDL = join(ROOT, "docs", "efs", "CardManagementWS.wsdl");
const SKIP = new Set(["node_modules", "dist", "coverage"]);
const SOURCE_EXT = ".ts";

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith(SOURCE_EXT) && !full.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/**
 * Every operation name one source file can send, and every reason it might not be knowable.
 *
 * Pure, and takes the source text rather than a path, so `--self-test` drives the detectors with
 * synthetic files instead of writing any — and so the OPS lookup cannot reach for a file that has
 * moved.
 */
export function scanSource(source, label) {
  const ops = [];
  const unresolved = [];

  // The visible form: `<CardManagementEP_getCarrierInfo>`. `efsAccountOps.ts` emits its thirteen
  // this way ON PURPOSE, and says so in its header — a literal is what this gate can read.
  for (const match of source.matchAll(/<CardManagementEP_([A-Za-z0-9]+)(?:\s|>)/g)) ops.push(match[1]);

  for (const match of source.matchAll(/CardManagementEP_\$\{([^}]+)\}/g)) {
    const expression = match[1].trim();
    if (expression !== "operation") {
      unresolved.push(`${label} uses unresolved operation expression ${expression}`);
      continue;
    }
    // `as const` is optional here; requiring it was defect 2 in the header.
    const object = /const OPS = \{([\s\S]*?)\n\}(?:\s+as\s+const)?;/.exec(source)?.[1];
    if (object === undefined) {
      unresolved.push(
        `${label} builds CardManagementEP_\${operation} but declares no \`const OPS = { … };\` — ` +
          `the names it can send are invisible to this gate`,
      );
      continue;
    }
    for (const value of object.matchAll(/:\s*"([A-Za-z0-9]+)"/g)) ops.push(value[1]);
  }
  return { ops, unresolved };
}

/** Operation names the WSDL binds. */
export function wsdlOperations(wsdl) {
  return new Set([...wsdl.matchAll(/<operation\s+name="([^"]+)"/g)].map((match) => match[1]));
}

/** The whole verdict for a set of already-read files. Returns the lines a failure would print. */
export function check(files, wsdl) {
  const codeOps = new Map();
  const unresolved = [];
  for (const { label, source } of files) {
    const scan = scanSource(source, label);
    for (const op of scan.ops) codeOps.set(op, label);
    unresolved.push(...scan.unresolved);
  }
  const bound = wsdlOperations(wsdl);
  const missing = [...codeOps.entries()].filter(([op]) => !bound.has(op));
  const problems = [
    ...(wsdl ? [] : ["the checked-in WSDL is missing"]),
    ...unresolved,
    ...missing.map(([op, label]) => `${label} constructs CardManagementEP_${op}, but WSDL has no matching operation`),
  ];
  return { codeOps, bound, problems };
}

/** Each detector, driven with a synthetic file, so "this gate can fail" is a property CI holds. */
function selfTest() {
  const cases = [
    [
      "an operation the WSDL does not bind",
      [{ label: "f.ts", source: `send("<CardManagementEP_getInvented>")` }],
      "<operation name=\"getCard\"/>",
      /no matching operation/,
    ],
    [
      "an interpolated wrapper in a file with no OPS table",
      [{ label: "f.ts", source: "send(`<CardManagementEP_${operation}>`)" }],
      "<operation name=\"getCard\"/>",
      /invisible to this gate/,
    ],
    [
      "an operation name built from something other than `operation`",
      [{ label: "f.ts", source: "send(`<CardManagementEP_${whateverThisIs}>`)" }],
      "<operation name=\"getCard\"/>",
      /unresolved operation expression/,
    ],
    [
      "a missing WSDL, which would otherwise pass everything",
      [{ label: "f.ts", source: `send("<CardManagementEP_getCard>")` }],
      "",
      /WSDL is missing/,
    ],
    [
      // Defect 2 in the header, pinned: `as const` is how the real file declares it.
      "an `as const` OPS table, whose names must be READ rather than skipped",
      [{
        label: "f.ts",
        source: 'const OPS = {\n  a: "getInvented",\n} as const;\nsend(`<CardManagementEP_${operation}>`)',
      }],
      "<operation name=\"getCard\"/>",
      /getInvented/,
    ],
  ];

  let failed = 0;
  for (const [name, files, wsdl, expected] of cases) {
    const { problems } = check(files, wsdl);
    const hit = problems.some((p) => expected.test(p));
    if (!hit) {
      failed++;
      console.error(`  ✗ detector did not fire for ${name} — got: ${JSON.stringify(problems)}`);
    }
  }
  // And the converse, which is the half a detector test usually forgets: a clean file must be silent.
  const clean = check(
    [{ label: "f.ts", source: 'const OPS = {\n  a: "getCard",\n} as const;\nsend(`<CardManagementEP_${operation}>`)' }],
    '<operation name="getCard"/>',
  );
  if (clean.problems.length) {
    failed++;
    console.error(`  ✗ fired on a clean file — got: ${JSON.stringify(clean.problems)}`);
  }

  if (failed) {
    console.error(`✗ WSDL gate self-test failed (${failed}).`);
    process.exit(1);
  }
  console.log(`✓ WSDL gate self-test ok — ${cases.length} detector(s) fire, and none fires on a clean file.`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const files = walk(SOURCE_ROOT).map((file) => ({
    label: relative(ROOT, file),
    source: readFileSync(file, "utf8"),
  }));
  const wsdl = existsSync(WSDL) ? readFileSync(WSDL, "utf8") : "";
  const { codeOps, bound, problems } = check(files, wsdl);
  if (problems.length) {
    console.error("✗ WSDL operation check failed:");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(`✓ WSDL operations ok — ${codeOps.size} code operation name(s) found in ${bound.size} WSDL operations.`);
}
