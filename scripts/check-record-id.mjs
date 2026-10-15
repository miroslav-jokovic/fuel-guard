#!/usr/bin/env node
/**
 * Fitness function — a record's id is checked by ONE definition, `recordId()` / `isRecordId()` in
 * `packages/shared/src/recordId.ts` (UI-STANDARDIZATION D-US13).
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────────
 * Zod 4's `z.uuid()` is RFC 9562 strict; Postgres's `uuid` column is not. The contracts refused an id
 * the database holds. Staging's org `…0000a1` has version nibble 0, so Driver Qualification's carrier
 * records answered 400 on staging only (US6b F31, 2026-10-13). The audit on 2026-10-15 counted 283
 * `z.uuid()` / `z.string().uuid()` sites plus eleven API files each holding a hand-written copy of an
 * id regex. That is twelve definitions of one fact, and they already disagreed: the apply draft's
 * regex passed keys the contract then refused. All of them now read `recordId.ts`. This gate stops a
 * thirteenth from appearing.
 *
 * ── WHAT IT REFUSES (outside recordId.ts, comments skipped) ────────────────────────────────────────
 *   · a Zod id check: `z.uuid(`, `z.guid(`, `z.uuidv4(` / `v6` / `v7`, or a chained `.uuid(` / `.guid(`
 *   · a hand-written id regex (`[0-9a-f]{8}-` in any spelling of the class). Test files are exempt
 *     from this half ONLY, because a test asserting that a minted key IS a v4 uuid is checking a
 *     version, not restating what an id is.
 *
 * `--self-test` proves each detector fires and that the exemptions do not swallow it. A gate that
 * cannot fail is not a gate.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCAN = ["apps", "packages", "tools"];
const SKIP = new Set(["node_modules", "dist", "coverage", ".expo", "android", "ios", "graphify-out"]);
const HOME = "packages/shared/src/recordId.ts";

const ZOD_ID = /\bz\s*\.\s*(uuid|guid|uuidv[467])\s*\(|\.\s*(uuid|guid)\s*\(\s*\)/;
const ID_REGEX = /\[(0-9a-f|a-f0-9|0-9a-fA-F|0-9A-Fa-f|A-Fa-f0-9|a-fA-F0-9|\\da-f|a-f\\d|0-9A-F)\]\{8\}-/;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|vue|mjs|mts)$/.test(e)) out.push(p);
  }
  return out;
}

/** Violations in one file's text. `rel` decides the exemptions. */
export function inspect(text, rel) {
  if (rel === HOME) return [];
  const isTest = /\.test\.(ts|tsx|mjs)$/.test(rel) || /\/tests?\//.test(rel);
  const hits = [];
  text.split("\n").forEach((line, i) => {
    if (COMMENT_LINE.test(line)) return;
    if (ZOD_ID.test(line)) hits.push({ rel, line: i + 1, why: "Zod id check — use recordId()", text: line.trim() });
    else if (!isTest && ID_REGEX.test(line))
      hits.push({ rel, line: i + 1, why: "hand-written id regex — use isRecordId()", text: line.trim() });
  });
  return hits;
}

function selfTest() {
  const cases = [
    ["packages/shared/src/x.ts", `  id: z.uuid(),`, 1],
    ["packages/shared/src/x.ts", `  id: z.string().uuid(),`, 1],
    ["apps/api/src/x.ts", `const p = z.guid().safeParse(v);`, 1],
    ["apps/api/src/x.ts", `  id: z.uuidv4(),`, 1],
    ["apps/api/src/x.ts", `const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;`, 1],
    ["apps/web/src/x.vue", `const RX = /[a-f0-9]{8}-[a-f0-9]{4}/;`, 1],
    // the test exemption covers the regex half only
    ["apps/web/src/x.test.ts", `expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);`, 0],
    ["apps/web/src/x.test.ts", `const s = z.uuid();`, 1],
    // comments describe the rule; they are not the rule
    ["apps/api/src/x.ts", ` * was \`z.uuid()\` before D-US13`, 0],
    ["apps/api/src/x.ts", `// [0-9a-f]{8}- is what Postgres stores`, 0],
    // the home and the sanctioned spellings
    [HOME, `  return z.guid();`, 0],
    ["apps/api/src/x.ts", `  id: recordId(),`, 0],
    ["apps/api/src/x.ts", `  .filter((v) => isRecordId(v))`, 0],
    ["apps/api/src/x.ts", `const id = crypto.randomUUID();`, 0],
  ];
  let failed = 0;
  for (const [rel, line, want] of cases) {
    const got = inspect(line, rel).length;
    if (got !== want) {
      failed += 1;
      console.error(`✗ self-test: ${rel}: ${JSON.stringify(line)} → ${got} hit(s), want ${want}`);
    }
  }
  if (failed) process.exit(1);
  console.log(`✓ record-id self-test — ${cases.length} cases`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const hits = SCAN.flatMap((d) => walk(join(ROOT, d))).flatMap((p) =>
    inspect(readFileSync(p, "utf8"), relative(ROOT, p)),
  );
  if (hits.length) {
    for (const h of hits) console.error(`✗ ${h.rel}:${h.line} ${h.why}\n    ${h.text.slice(0, 140)}`);
    console.error(`\n${hits.length} id check(s) outside ${HOME} (D-US13).`);
    process.exit(1);
  }
  console.log(`✓ record ids — one definition (${HOME})`);
}
