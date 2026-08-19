#!/usr/bin/env node
/**
 * Fitness function — comments that make proof claims about tests must quote a real test title.
 *
 * A plain reference only proves that a test file exists. A proof claim must identify the exact
 * scenario that carries the claim, so a renamed or weakened test cannot leave the comment looking
 * authoritative. Test files are skipped because their own descriptions naturally contain test names.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP = new Set(["node_modules", "dist", "coverage", ".git", ".pnpm-store", "android", "ios", ".expo"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".vue"]);
const TEST_REF = /(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.test\.ts\b/g;
const PROOF_CLAIM = /\b(?:prove|proves|proven|asserted by|pinned by|recorded as a property|tripwire|verified in|go red|fails CI if)\b/i;
const COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g;
const TEST_TITLE = /\b(?:it|describe)(?:\.each)?\s*(?:\([^)]*\)\s*)?\(\s*(["'`])([\s\S]*?)\1/g;
const NO_TEST_CLAIM = "[no-test-claim]";
// Pre-existing uncited proof claims. This list may only shrink; a moved or missing entry fails.
// Baseline of claims that predate this check. It may only SHRINK — efsIngest.ts's entry was
// retired on 2026-08-19 by citing the four scenarios that actually prove the faithfulness contract.
const KNOWN_UNCITED = new Map([]);

function sourceRoots() {
  return ["apps", "packages"].flatMap((rootName) =>
    readdirSync(join(ROOT, rootName), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(ROOT, rootName, entry.name, "src")),
  );
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXTENSIONS.has(full.slice(full.lastIndexOf(".")))) out.push(full);
  }
  return out;
}

function commentsIn(source) {
  return [...source.matchAll(COMMENT)];
}

function testTitles(source) {
  return [...source.matchAll(TEST_TITLE)].map((match) => match[2]);
}

const files = sourceRoots().flatMap((root) => walk(root));
const testFiles = files.filter((file) => file.endsWith(".test.ts"));
const claims = [];

for (const file of files) {
  if (file.endsWith(".test.ts")) continue;
  const source = readFileSync(file, "utf8");
  for (const comment of commentsIn(source)) {
    for (const ref of comment[0].matchAll(TEST_REF)) {
      const position = comment.index + ref.index;
      claims.push({
        file,
        line: source.slice(0, position).split("\n").length,
        reference: ref[0],
        text: comment[0],
      });
    }
  }
}

const failures = [];
const seenKnownUncited = new Set();
for (const claim of claims) {
  const claimPath = relative(ROOT, claim.file);
  const direct = join(ROOT, claim.reference.replace(/^\.\//, ""));
  const sibling = join(dirname(claim.file), claim.reference);
  const candidates = existsSync(direct)
    ? [direct]
    : existsSync(sibling)
      ? [sibling]
      : testFiles.filter((file) => file.endsWith(`/${claim.reference}`) || basename(file) === basename(claim.reference));
  const target = candidates.length === 1 ? candidates[0] : null;
  if (!target) {
    failures.push(`${claimPath}:${claim.line} names ${claim.reference}, but the test file was not found`);
    continue;
  }
  if (claim.text.includes(NO_TEST_CLAIM)) continue;
  if (KNOWN_UNCITED.get(claimPath) === claim.line) {
    seenKnownUncited.add(claimPath);
    continue;
  }
  if (!PROOF_CLAIM.test(claim.text)) continue;
  const quoted = [...claim.text.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (quoted.length === 0) {
    failures.push(`${relative(ROOT, claim.file)}:${claim.line} claims proof from ${claim.reference}, but quotes no test scenario`);
    continue;
  }
  const titles = testTitles(readFileSync(target, "utf8"));
  if (!quoted.some((fragment) => titles.some((title) => title.includes(fragment)))) {
    failures.push(`${relative(ROOT, claim.file)}:${claim.line} quotes no title fragment found in ${claim.reference}`);
  }
}

for (const [file, line] of KNOWN_UNCITED) {
  if (!seenKnownUncited.has(file)) failures.push(`${file}:${line} known uncited claim moved or disappeared — remove the baseline entry`);
}

if (failures.length) {
  console.error(`✗ ${failures.length} comment-claim violation(s):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`✓ comment claims ok — ${claims.length} test reference(s) resolved.`);
