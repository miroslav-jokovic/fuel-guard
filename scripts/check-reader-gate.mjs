#!/usr/bin/env node
/**
 * Fitness function — the BOL reader's merge gate (READER-CORRECTNESS-PLAN RC8, D-RC3).
 *
 * Promise 1 — no value reaches the placard calculation unless independent witnesses agree on it or a person
 * acted on it — is held by tests that run each layer over every case it can meet (D-RC1): the table census
 * (RC1), stored-read replay (RC2), the pairing and agreement properties (RC3), the calculator's action
 * sequences (RC4), the paper audit's golden census (RC5). Each already fails `build` when a layer lets a
 * wrong value through. What none of them can catch is its own absence: a file renamed out of a test glob, an
 * `it.skip` left in after a debugging session, a census whose loop was narrowed to the one BOL being fixed.
 * Then `build` stays green and means less, and nobody can see it — the failure `lint:wsdl` hid for ten days.
 *
 * So this gate pins them: every file in REQUIRED exists, every title listed there is still a test title in it,
 * and no test in it is skipped, focused, left as a todo or expected to fail. Renaming or retiring one of these
 * tests is a decision about Promise 1, made by editing this list in the same PR, where review sees it.
 *
 * `--list` prints each file's test titles (to update the list); `--self-test` proves the checks catch what they
 * claim to.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/** The tests that hold Promise 1, by plan step. A title ending in "…" matches by its prefix (a templated title). */
export const REQUIRED = [
  {
    step: "RC1 table census",
    file: "packages/hazmat-data/src/resolveLine.census.test.ts",
    titles: [
      "the table census — every entry, every legal printing (RC1)",
      "never resolves a printing to another row of the table",
      "never refuses a correct printing the paper can be resolved from",
    ],
  },
  {
    step: "D-PC1 the table's subsidiary classes are present",
    file: "packages/hazmat-data/src/subsidiaryClasses.test.ts",
    titles: ["loads the subsidiary classes column (6) lists, dataset …"],
  },
  {
    step: "RC2 replay of a stored read",
    file: "apps/api/src/modules/document-reading/read/replay.test.ts",
    titles: [
      "reproduces a read judged by today's code with no diff at all",
      "refuses a read with no stored inputs instead of judging it on pass A alone",
    ],
  },
  {
    step: "RC3 pairing over every one-character misread",
    file: "apps/api/src/modules/document-reading/evidence/alignLines.property.test.ts",
    titles: [
      "alignLines over every one-character misread (RC3)",
      "keeps every misread line one line, paired with itself, and every other line with its own",
      "never pairs two different products that each reader read alone",
    ],
  },
  {
    step: "RC3 agreement over formatting",
    file: "apps/api/src/modules/document-reading/evidence/agreement.property.test.ts",
    titles: [
      "never makes two readers disagree over formatting",
      "always makes them disagree over a changed letter, digit or mark",
    ],
  },
  {
    step: "R-M2 agreement over cell extent",
    file: "apps/api/src/modules/document-reading/evidence/readingExtent.property.test.ts",
    titles: [
      "never agrees when the longer reading adds a regulated element",
      "never agrees with a reading that stops inside the basic description",
    ],
  },
  {
    step: "RC4 calculator action sequences",
    file: "apps/web/src/features/hazmat/HazmatCalculatorForm.sequence.test.ts",
    titles: [
      "HazmatCalculatorForm — a read's value changes only by a person's act (RC4)",
      "holds over 40 seeded sequences of 14 acts…",
      "reached every act, every read, and the acts that settle a disputed field, many times over",
    ],
  },
  {
    step: "RC5 paper audit golden census",
    file: "packages/hazmat-golden/src/paperGoldenCensus.test.ts",
    titles: [
      "the paper audit over a golden paper for every table row (RC5), dataset …",
      "passes every rule on a correctly printed paper, in drums and in a cargo tank",
      "fails only its own rule: …",
      "never matches a paper to the look-alike row that excepts more (the placard path's Limited Quantity, P1)",
    ],
  },
  {
    step: "Q-RC7 the page settling a split UN/NA number",
    file: "apps/api/src/modules/document-reading/evidence/idWitness.test.ts",
    titles: [
      "never settles a number the paper does not print — not when the OCR misread it too, nor on a misprint",
      "says nothing when both numbers are printed, when the row is another line's, or with no OCR",
    ],
  },
  {
    step: "R-M1 RQ over every Appendix A row",
    file: "packages/hazmat-golden/src/rqCensus.test.ts",
    titles: ["never passes a package holding the RQ unless RQ is printed, and fails only at or over it"],
  },
  {
    step: "Audit rules wait for an unconfirmed row",
    file: "packages/hazmat-engine/src/bol/paperRowGate.test.ts",
    titles: ["answers cannot_tell, naming the field, on every rule whose verdict depends on the row"],
  },
];

const TEST_TITLE = /\b(?:it|test|describe)(?:\.each\s*\([\s\S]*?\))?\s*\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
/** Any way vitest has to not run a test, or to pass it on failure. */
const NOT_RUN = /\b(?:it|test|describe)\s*\.\s*(skip|only|todo|fails|skipIf|runIf)\b|\bx(?:it|describe)\s*\(/g;

export function titlesOf(source) {
  return [...source.matchAll(TEST_TITLE)].map((m) => m[2]);
}

/** What is wrong with one required file's source, given the titles it must hold; [] when nothing is. */
export function problems(source, titles) {
  const found = titlesOf(source);
  const out = [];
  for (const t of titles) {
    const prefix = t.endsWith("…") ? t.slice(0, -1) : null;
    const ok = prefix ? found.some((f) => f.startsWith(prefix)) : found.includes(t);
    if (!ok) out.push(`missing test "${t}"`);
  }
  for (const m of source.matchAll(NOT_RUN)) out.push(`a test is not run: "${m[0].replace(/\s+/g, "")}"`);
  return out;
}

function selfTest() {
  const clean = `describe("a census", () => { it("never accepts a wrong value", () => {}); it(\`holds \${1} times\`, () => {}); });`;
  const cases = [
    ["clean file", clean, ["a census", "never accepts a wrong value", "holds …"], 0],
    ["renamed test", clean.replace("never accepts", "rarely accepts"), ["never accepts a wrong value"], 1],
    ["it.skip", clean.replace('it("never', 'it.skip("never'), ["never accepts a wrong value"], 1],
    ["describe.only", clean.replace("describe(", "describe.only("), ["a census"], 1],
    ["it.todo", `${clean} it.todo("later");`, [], 1],
    ["it.fails", `${clean} it.fails("broken", () => {});`, [], 1],
    ["skipIf", `${clean} it.skipIf(process.env.CI)("x", () => {});`, [], 1],
    ["xit", `${clean} xit("x", () => {});`, [], 1],
    ["template prefix gone", clean.replace("holds", "held"), ["holds …"], 1],
  ];
  let bad = 0;
  for (const [name, source, titles, expected] of cases) {
    const got = problems(source, titles).length;
    // A skipped test is also reported as missing its title; what matters is that it is reported at all.
    if ((got > 0) !== (expected > 0)) {
      bad++;
      console.error(`self-test "${name}": expected ${expected} problem(s), got ${got}`);
    }
  }
  if (bad) process.exit(1);
  console.log(`check-reader-gate self-test: ${cases.length} cases ok`);
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--self-test")) return selfTest();
  if (args.has("--list")) {
    for (const { file } of REQUIRED) {
      const path = join(ROOT, file);
      console.log(`== ${file}`);
      if (existsSync(path)) for (const t of titlesOf(readFileSync(path, "utf8"))) console.log(`   ${t}`);
    }
    return;
  }
  const failures = [];
  for (const { step, file, titles } of REQUIRED) {
    const path = join(ROOT, file);
    if (!existsSync(path)) {
      failures.push(`${step}: ${file} is gone`);
      continue;
    }
    for (const p of problems(readFileSync(path, "utf8"), titles)) failures.push(`${step}: ${file}: ${p}`);
  }
  if (failures.length) {
    console.error("The BOL reader's Promise-1 tests (READER-CORRECTNESS-PLAN RC8) are not all in force:");
    for (const f of failures) console.error(`  - ${f}`);
    console.error("Restore the test, or change REQUIRED in scripts/check-reader-gate.mjs in this PR and say why.");
    process.exit(1);
  }
  console.log(`check-reader-gate: ${REQUIRED.length} Promise-1 test files in force, none skipped`);
}

main();
