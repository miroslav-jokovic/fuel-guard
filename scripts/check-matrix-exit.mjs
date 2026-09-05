#!/usr/bin/env node
/**
 * Fitness function — every behavioural matrix RELEASES its database before it finishes.
 *
 * ── What this costs when it is missing, measured 2026-09-05 ─────────────────────────────────────
 * `supabase/CLAUDE.md` told matrix authors two things: print a `RESULT:` line, and exit non-zero on
 * failure. Both correct, and between them they left the green path unspecified — so 21 of the 59
 * matrices ended with `if (fail > 0) process.exit(1);` and nothing else. When such a matrix PASSES
 * there is no explicit exit, so Node has to decide on its own that the process is finished, and it
 * cannot: PGlite's WASM instance keeps handles on the event loop until it is closed.
 *
 * The result was ten seconds of a process doing absolutely nothing, once per matrix, every run.
 * Instrumented on `fuel-range-totals`: last assertion at 1.27s, process exit at 11.33s. Adding one
 * `await db.close()` took it to 1.32s. Across the suite that was ~210 seconds of a CI run — more
 * than the entire rest of the test step — spent waiting for garbage collection.
 *
 * ── Why a gate and not a note in the docs ───────────────────────────────────────────────────────
 * Because the cost is INVISIBLE. A matrix without this passes, prints the right numbers, and is
 * indistinguishable from a correct one except on a stopwatch. The 21 were written over many months
 * by people copying whichever neighbouring matrix they happened to open, and every one of those
 * copies was individually reasonable. Nothing would ever have flagged the 22nd.
 *
 * ── The rule, and why it has no exceptions ──────────────────────────────────────────────────────
 * Any matrix that constructs a PGlite must close it. Not "must close it OR exit unconditionally":
 * a bare `process.exit()` also terminates promptly, but it can truncate buffered stdout, and
 * `scripts/run-tests.mjs` PARSES stdout for the `RESULT:` line — a truncated one is reported as a
 * matrix that never ran. Closing the database and letting the process end on its own is the shape
 * that is both fast and safe, so it is the only shape allowed here.
 *
 * Run: node scripts/check-matrix-exit.mjs [--self-test]
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const MATRIX_DIR = join(ROOT, "supabase", "tests");

/**
 * Returns the violations in one matrix's source, as human-readable strings.
 *
 * Deliberately textual rather than an AST walk. The thing being asserted is a convention about how
 * these files END, every one of them assigns its handle to a plain `const <name> = new PGlite(`, and
 * a parser here would be more machinery than the rule is worth. If a matrix ever legitimately needs
 * a shape this cannot see, that is the moment to reach for a parser — not before.
 */
export function violationsIn(source) {
  const problems = [];
  const constructions = [...source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new PGlite\s*\(/g)];
  if (constructions.length === 0) return problems;

  for (const m of constructions) {
    const name = m[1];
    const closed = new RegExp(`\\b${name}\\s*\\.\\s*close\\s*\\(`).test(source);
    if (!closed) {
      problems.push(
        `constructs \`${name} = new PGlite(...)\` but never calls \`await ${name}.close()\`. ` +
          `On the green path this leaves Node draining WASM handles for ~10s after the last assertion.`,
      );
    }
  }
  return problems;
}

function selfTest() {
  // A detector that has silently stopped firing is worse than no detector, so prove both directions.
  const cases = [
    {
      name: "flags a matrix that never closes its database",
      src: 'const db = new PGlite({});\nconsole.log("RESULT: 1 passed, 0 failed");\nif (fail > 0) process.exit(1);\n',
      expect: 1,
    },
    {
      name: "accepts a matrix that closes it",
      src: 'const db = new PGlite({});\nawait db.close();\nconsole.log("RESULT: 1 passed, 0 failed");\n',
      expect: 0,
    },
    {
      name: "a bare process.exit() is NOT accepted in place of closing",
      src: 'const db = new PGlite({});\nconsole.log("RESULT: 1 passed, 0 failed");\nprocess.exit(fail ? 1 : 0);\n',
      expect: 1,
    },
    {
      name: "follows the handle's name rather than assuming it is called db",
      src: 'const pg = new PGlite({});\nawait pg.close();\n',
      expect: 0,
    },
    {
      name: "a file that opens no database is not a matrix this rule applies to",
      src: 'import { readFileSync } from "node:fs";\nconsole.log("RESULT: 0 passed, 0 failed");\n',
      expect: 0,
    },
  ];

  let bad = 0;
  for (const c of cases) {
    const got = violationsIn(c.src).length;
    const ok = got === c.expect;
    if (!ok) bad++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.name}${ok ? "" : ` (expected ${c.expect}, got ${got})`}`);
  }

  // The detector must also survive contact with the real corpus: if every matrix on disk were
  // suddenly clean of PGlite constructions, the loop above would pass while checking nothing.
  const withDb = readdirSync(MATRIX_DIR)
    .filter((f) => f.endsWith(".test.mjs"))
    .filter((f) => /new PGlite\s*\(/.test(readFileSync(join(MATRIX_DIR, f), "utf8"))).length;
  const anchored = withDb > 0;
  if (!anchored) bad++;
  console.log(
    `  ${anchored ? "PASS" : "FAIL"}  the rule still applies to something (${withDb} matrices open a database)`,
  );

  if (bad > 0) {
    console.error(`\nFAIL: check-matrix-exit self-test failed ${bad} case(s) — the detector is broken.`);
    process.exit(1);
  }
  console.log("\n✓ check-matrix-exit self-test ok.");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const files = readdirSync(MATRIX_DIR)
    .filter((f) => f.endsWith(".test.mjs"))
    .sort();

  let failed = 0;
  let checked = 0;
  for (const f of files) {
    const problems = violationsIn(readFileSync(join(MATRIX_DIR, f), "utf8"));
    if (problems.length === 0) continue;
    checked++;
    failed += problems.length;
    for (const p of problems) console.error(`${relative(ROOT, join(MATRIX_DIR, f))}: ${p}`);
  }

  if (failed > 0) {
    console.error(
      `\nFAIL: ${failed} unreleased database(s) in ${checked} matrix file(s). ` +
        "Add `await db.close();` immediately before the RESULT line. See this file's header for the " +
        "ten-seconds-per-matrix measurement, and supabase/CLAUDE.md for the rule.",
    );
    process.exit(1);
  }
  console.log(`✓ matrix exit ok — ${files.length} matrices, every PGlite handle is closed.`);
}
