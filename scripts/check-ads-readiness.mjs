#!/usr/bin/env node
/**
 * Fitness function — the ads agent's readiness gate and scorecard (ADS-AGENT-BUILD-WORKFLOW.md §4R, step 8).
 *
 * §4R: every ads worker and the orchestrator climb five levels in order — L1 unit-proven, L2 fault-proven,
 * L3 scenario-proven, L4 sandbox-certified (credentials enter here), L5 canary — and no real campaign runs
 * on a worker that has not reached L4. The tests that prove each level already fail `build` when a rule
 * breaks. What none of them can catch is its own absence: a file renamed out of a glob, an `it.skip` left
 * after debugging, a golden scenario deleted. Then the scorecard would claim a level nobody can show.
 *
 * So this file does two things over `scripts/ads-readiness.registry.mjs`:
 *
 *   gate  (`pnpm lint:ads-readiness`) — every pinned test file exists, holds every pinned title, and runs
 *         every test in it (no skip, only, todo, fails, skipIf, runIf, xit); every pinned golden scenario
 *         file exists; and the registry names exactly the workers of §4R's table. Any of those broken
 *         fails `build`. An open `gap` does not: it is the scorecard being honest about a level not yet
 *         reached.
 *   scorecard (`pnpm ads:readiness`) — worker × level. A worker is AT level n when every level up to n
 *         has needs and none of them is a gap. Levels are climbed in order, so an L3 need met above an
 *         L2 gap still leaves the worker at L1.
 *
 * Copied from `scripts/check-reader-gate.mjs` (RC8): the same title scan and the same NOT_RUN list, so a
 * test either gate trusts is a test both would. `--self-test` proves the checks catch what they claim to.
 *
 *   launch card (`apps/api/src/modules/ads/guard/launchReadiness.json`) — §4R: "Production launch is refused in
 *         code" below L4, reading the scorecard at the deployed sha. The API cannot run this file (it reads
 *         test sources), so what it needs is committed: the workers a real campaign uses and those at L4 or above.
 *         A worker moving from L2 to L3 does not touch it, so the tracks climbing to L3 cannot conflict over it.
 *         The gate fails when it disagrees with the registry; `--write-launch-card` rewrites it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { READINESS, SCENARIO_DIR } from "./ads-readiness.registry.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
export const LEVELS = ["L1", "L2", "L3", "L4", "L5"];
const WORKFLOW = "docs/plans/recruitment/ADS-AGENT-BUILD-WORKFLOW.md";
const LAUNCH_CARD = "apps/api/src/modules/ads/guard/launchReadiness.json";

// `ok` is a PGlite matrix's assertion: the same-person match is only provable in SQL, so §4R pins one.
const TEST_TITLE = /\b(?:it|test|describe|ok)(?:\.each\s*\([\s\S]*?\))?\s*\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
/** Any way vitest has to not run a test, or to pass it on failure. */
const NOT_RUN = /\b(?:it|test|describe)\s*\.\s*(skip|only|todo|fails|skipIf|runIf)\b|\bx(?:it|describe)\s*\(/g;

export function titlesOf(source) {
  return [...source.matchAll(TEST_TITLE)].map((m) => m[2]);
}

/** What is wrong with one pinned file's source, given the titles it must hold; [] when nothing is. */
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

/** The worker names of §4R's "What each worker must survive" table: each row's bold first cell. */
export function workersInWorkflow(markdown) {
  const start = markdown.indexOf("### What each worker must survive");
  if (start < 0) return null;
  const end = markdown.indexOf("\n---", start);
  const table = markdown.slice(start, end < 0 ? undefined : end);
  return [...table.matchAll(/^\|\s*\*\*([^*]+)\*\*/gm)].map((m) => m[1].trim());
}

/** Registry shape errors: a need that is neither pinned nor a gap, or both; a level missing. */
export function shapeProblems(registry) {
  const out = [];
  for (const { worker, levels } of registry) {
    for (const level of LEVELS) {
      const needs = levels[level];
      if (!Array.isArray(needs) || needs.length === 0) { out.push(`${worker} ${level}: no needs listed (say what it needs, or a gap)`); continue; }
      for (const n of needs) {
        const pinned = (n.tests?.length ?? 0) + (n.scenarios?.length ?? 0) > 0;
        if (pinned === Boolean(n.gap)) out.push(`${worker} ${level} "${n.need}": must be pinned to tests OR be a gap, not ${pinned ? "both" : "neither"}`);
      }
    }
  }
  return out;
}

/** Every broken pin in the registry, reading files through `read` (null = no such file). */
export function pinProblems(registry, read) {
  const out = [];
  const golden = new Set();
  for (const { worker, levels } of registry) {
    for (const level of LEVELS) {
      for (const n of levels[level] ?? []) {
        for (const { file, titles } of n.tests ?? []) {
          const src = read(file);
          if (src === null) out.push(`${worker} ${level}: ${file} is gone`);
          else for (const p of problems(src, titles)) out.push(`${worker} ${level}: ${file}: ${p}`);
        }
        for (const s of n.scenarios ?? []) {
          golden.add(s);
          if (read(`${SCENARIO_DIR}/${s}`) === null) out.push(`${worker} ${level}: golden scenario ${s} is gone`);
        }
      }
    }
  }
  return out;
}

/** The level each worker is at, and the first open need above it. */
export function scorecard(registry) {
  return registry.map(({ worker, levels }) => {
    let at = 0;
    let next = null;
    for (const [i, level] of LEVELS.entries()) {
      const gap = (levels[level] ?? []).find((n) => n.gap);
      if (gap) { next = { level, need: gap.need, gap: gap.gap }; break; }
      at = i + 1;
    }
    return { worker, level: at === 0 ? "L0" : LEVELS[at - 1], next };
  });
}

/** What the Launch door reads: who a real campaign uses, and who has reached L4. Sorted by the registry's order. */
export function launchCard(registry) {
  const certified = scorecard(registry).filter((c) => Number(c.level.slice(1)) >= 4).map((c) => c.worker);
  return { required: registry.filter((r) => !r.notAtLaunch).map((r) => r.worker), certified };
}

const launchCardText = (registry) => `${JSON.stringify(launchCard(registry), null, 2)}\n`;

function selfTest() {
  const clean = `describe("a guard", () => { it("refuses a launch", () => {}); it(\`killed at \${1}\`, () => {}); });`;
  const titleCases = [
    ["clean file", clean, ["a guard", "refuses a launch", "killed at …"], true],
    ["renamed test", clean.replace("refuses a", "allows a"), ["refuses a launch"], false],
    ["a matrix assertion", `ok("names the first lead", a === b);`, ["names the first lead"], true],
    ["it.skip", clean.replace('it("refuses', 'it.skip("refuses'), ["refuses a launch"], false],
    ["describe.only", clean.replace("describe(", "describe.only("), ["a guard"], false],
    ["it.todo", `${clean} it.todo("later");`, [], false],
    ["it.fails", `${clean} it.fails("broken", () => {});`, [], false],
    ["runIf", `${clean} it.runIf(false)("x", () => {});`, [], false],
    ["xit", `${clean} xit("x", () => {});`, [], false],
    ["template prefix gone", clean.replace("killed", "died"), ["killed at …"], false],
  ];
  const pinned = (titles) => ({ need: "n", tests: [{ file: "a.test.ts", titles }] });
  const gap = { need: "g", gap: "later" };
  const full = (needs) => Object.fromEntries(LEVELS.map((l) => [l, needs[l] ?? [gap]]));
  const files = { "a.test.ts": clean, [`${SCENARIO_DIR}/s.yaml`]: "name: s" };
  const read = (f) => files[f] ?? null;
  const cases = [
    ...titleCases.map(([name, src, titles, ok]) => [name, () => (problems(src, titles).length === 0) === ok]),
    ["a scenario that is gone is a broken pin", () => pinProblems([{ worker: "W", levels: full({ L1: [{ need: "n", scenarios: ["gone.yaml"] }] }) }], read).length === 1],
    ["a scenario that exists is not", () => pinProblems([{ worker: "W", levels: full({ L1: [{ need: "n", scenarios: ["s.yaml"] }] }) }], read).length === 0],
    ["a file that is gone is a broken pin", () => pinProblems([{ worker: "W", levels: full({ L1: [{ need: "n", tests: [{ file: "b.test.ts", titles: [] }] }] }) }], read).length === 1],
    ["a gap is not a broken pin", () => pinProblems([{ worker: "W", levels: full({}) }], read).length === 0],
    ["a need both pinned and a gap is refused", () => shapeProblems([{ worker: "W", levels: full({ L1: [{ ...pinned(["a guard"]), gap: "x" }] }) }]).length === 1],
    ["a need neither pinned nor a gap is refused", () => shapeProblems([{ worker: "W", levels: full({ L1: [{ need: "n" }] }) }]).length === 1],
    ["an empty level is refused", () => shapeProblems([{ worker: "W", levels: { ...full({}), L2: [] } }]).length === 1],
    ["all gaps is L0", () => scorecard([{ worker: "W", levels: full({}) }])[0].level === "L0"],
    ["L1 and L2 met is L2", () => scorecard([{ worker: "W", levels: full({ L1: [pinned(["a guard"])], L2: [pinned(["a guard"])] }) }])[0].level === "L2"],
    ["an L3 met above an L2 gap stays L1", () => scorecard([{ worker: "W", levels: full({ L1: [pinned(["a guard"])], L3: [pinned(["a guard"])] }) }])[0].level === "L1"],
    ["one gap among met needs holds the level", () => scorecard([{ worker: "W", levels: full({ L1: [pinned(["a guard"]), gap] }) }])[0].level === "L0"],
    ["a worker below L4 is not certified", () => launchCard([{ worker: "W", levels: full({ L1: [pinned(["a guard"])] }) }]).certified.length === 0],
    ["a worker with L1 to L4 met is certified", () => launchCard([{ worker: "W", levels: full(Object.fromEntries(LEVELS.slice(0, 4).map((l) => [l, [pinned(["a guard"])]]))) }]).certified[0] === "W"],
    ["a worker kept out of launch is not required", () => launchCard([{ worker: "W", notAtLaunch: "later", levels: full({}) }, { worker: "V", levels: full({}) }]).required.join() === "V"],
    ["the workflow table's bold names are read", () => JSON.stringify(workersInWorkflow("### What each worker must survive\n| W | x |\n|---|\n| **Orchestrator** | a |\n| **Publisher** (per adapter) | b |\n\n---\n| **Not this** |")) === '["Orchestrator","Publisher"]'],
  ];
  let bad = 0;
  for (const [name, check] of cases) {
    if (!check()) { bad++; console.error(`self-test "${name}" failed`); }
  }
  if (bad) process.exit(1);
  console.log(`check-ads-readiness self-test: ${cases.length} cases ok`);
}

const readFile = (f) => {
  const p = join(ROOT, f);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

function printScorecard(card) {
  const width = Math.max(...card.map((c) => c.worker.length));
  console.log(`Ads readiness (ADS-AGENT-BUILD-WORKFLOW §4R) — ${LEVELS.join(" → ")}\n`);
  for (const { worker, level, next } of card) {
    const bar = LEVELS.map((l) => (LEVELS.indexOf(l) < Number(level.slice(1)) ? "■" : "·")).join(" ");
    console.log(`  ${worker.padEnd(width)}  ${bar}  ${level}${next ? `   next ${next.level}: ${next.need} — ${next.gap}` : ""}`);
  }
  console.log("\nA real campaign needs L4 for every worker it uses (§4R).");
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--self-test")) return selfTest();
  if (args.has("--write-launch-card")) writeFileSync(join(ROOT, LAUNCH_CARD), launchCardText(READINESS));
  const failures = [...shapeProblems(READINESS), ...pinProblems(READINESS, readFile)];
  if (readFile(LAUNCH_CARD) !== launchCardText(READINESS)) failures.push(`${LAUNCH_CARD} disagrees with the registry: run node scripts/check-ads-readiness.mjs --write-launch-card`);
  const table = workersInWorkflow(readFile(WORKFLOW) ?? "");
  if (!table || table.length === 0) failures.push(`${WORKFLOW}: §4R's worker table was not found — the registry cannot be checked against it`);
  else {
    const listed = READINESS.map((r) => r.worker);
    for (const w of table) if (!listed.includes(w)) failures.push(`§4R names worker "${w}", which the registry does not list`);
    for (const w of listed) if (!table.includes(w)) failures.push(`the registry lists worker "${w}", which §4R's table does not name`);
  }
  if (failures.length) {
    console.error("The ads readiness tests (ADS-AGENT-BUILD-WORKFLOW §4R) are not all in force:");
    for (const f of failures) console.error(`  - ${f}`);
    console.error("Restore the test, or change scripts/ads-readiness.registry.mjs in this PR and say why.");
    process.exit(1);
  }
  const card = scorecard(READINESS);
  if (args.has("--json")) return console.log(JSON.stringify(card, null, 2));
  if (args.has("--scorecard")) return printScorecard(card);
  const pins = READINESS.flatMap((r) => LEVELS.flatMap((l) => r.levels[l])).filter((n) => !n.gap).length;
  console.log(`check-ads-readiness: ${pins} needs pinned across ${READINESS.length} workers, all in force — ${card.map((c) => `${c.worker} ${c.level}`).join(", ")}`);
}

main();
