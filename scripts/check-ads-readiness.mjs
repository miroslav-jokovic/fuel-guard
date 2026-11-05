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
 * ── L4 AND L5 ARE NOT TESTS, THEY ARE RUNS (G-launch-gate, 2026-11-05) ────────────────────────────
 * A test file existing says nothing about whether it passed against Meta's sandbox. So L4 and L5 are read
 * from `scripts/ads-certifications.json` ONLY: a worker is at L4 when it is at L3 and a `pass` record names
 * it (and, for a per-platform worker, that platform) at L4 with the run's date, sha and evidence. The
 * registry's L4/L5 needs stay as what the run must cover, shown as "next" until a record closes them.
 *
 * ── WHAT LAUNCH READS ──────────────────────────────────────────────────────────────────────────────
 * The API never reads the repo at runtime. `--write` (`pnpm gen:ads-readiness`) bakes the levels, the
 * campaign-worker table (`CAMPAIGN_WORKERS`) and the certifications into
 * `packages/shared/src/ads/launchReadiness.generated.ts`; the gate regenerates it in memory and fails on
 * any byte of difference, so the file is never hand-edited and Launch's answer is the one committed at the
 * deployed sha (§4R "Production launch is refused in code").
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CAMPAIGN_WORKERS, READINESS, SCENARIO_DIR } from "./ads-readiness.registry.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
export const LEVELS = ["L1", "L2", "L3", "L4", "L5"];
const WORKFLOW = "docs/plans/recruitment/ADS-AGENT-BUILD-WORKFLOW.md";
const CERTIFICATIONS = "scripts/ads-certifications.json";
export const GENERATED = "packages/shared/src/ads/launchReadiness.generated.ts";
/** The levels a run certifies, and the run each must be. */
const RUN_LEVELS = { L4: "sandbox", L5: "canary" };

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

/** Every malformed certification record, or campaign-worker row, against the registry. */
export function certificationProblems(certs, registry, table) {
  const out = [];
  const entry = (w) => registry.find((r) => r.worker === w);
  if (!Array.isArray(certs)) return ["certifications must be a list"];
  certs.forEach((c, i) => {
    const at = `certification ${i + 1} (${c?.worker ?? "?"})`;
    const e = entry(c?.worker);
    if (!e) return out.push(`${at}: no such worker in the registry`);
    if (Boolean(e.perPlatform) !== (typeof c.platform === "string" && c.platform.length > 0)) out.push(`${at}: ${e.perPlatform ? "a per-platform worker names its platform" : "names a platform, but this worker is not per-platform"}`);
    if (!(c.level in RUN_LEVELS)) out.push(`${at}: level must be L4 or L5 — lower levels are tests, not runs`);
    else if (c.target !== RUN_LEVELS[c.level]) out.push(`${at}: an ${c.level} run's target is "${RUN_LEVELS[c.level]}"`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.run_date)) || Number.isNaN(Date.parse(`${c.run_date}T00:00:00Z`))) out.push(`${at}: run_date must be YYYY-MM-DD`);
    if (!/^[0-9a-f]{40}$/.test(String(c.sha))) out.push(`${at}: sha must be the run's full 40-hex commit`);
    if (c.result !== "pass" && c.result !== "fail") out.push(`${at}: result must be "pass" or "fail"`);
    if (typeof c.evidence !== "string" || c.evidence.trim() === "") out.push(`${at}: evidence (the run or PR that shows it) is required`);
  });
  for (const [key, rows] of Object.entries(table)) {
    if (!/^[a-z]+:[a-z]+$/.test(key)) out.push(`campaign workers "${key}": the key is provider:creative_kind`);
    for (const r of rows) {
      const e = entry(r.worker);
      if (!e) out.push(`campaign workers "${key}": no such worker "${r.worker}"`);
      else if (Boolean(e.perPlatform) !== Boolean(r.platform)) out.push(`campaign workers "${key}": "${r.worker}" ${e.perPlatform ? "must name its platform" : "is not per-platform"}`);
    }
  }
  return out;
}

const certified = (certs, worker, level, platform) =>
  certs.some((c) => c.result === "pass" && c.worker === worker && c.level === level && (platform === undefined || c.platform === platform));

/**
 * One worker's level and the first open need above it. L1–L3 from the registry's needs (a gap holds the level);
 * L4 and L5 from passing certifications only. `platform` scopes a per-platform worker's runs; without it, a
 * per-platform worker needs a run for every platform the campaign-worker table uses it on.
 */
export function levelOf(entry, certs = [], table = {}, platform) {
  const platforms = platform !== undefined ? [platform]
    : entry.perPlatform ? [...new Set(Object.values(table).flat().filter((r) => r.worker === entry.worker).map((r) => r.platform))] : [undefined];
  let at = 0;
  for (const [i, level] of LEVELS.entries()) {
    if (level in RUN_LEVELS) {
      const ok = platforms.length > 0 && platforms.every((p) => certified(certs, entry.worker, level, entry.perPlatform ? p : undefined));
      if (!ok) {
        const n = (entry.levels[level] ?? [])[0];
        return { level: at === 0 ? "L0" : LEVELS[at - 1], next: { level, need: n?.need ?? `${level} run`, gap: n?.gap ?? `no passing ${RUN_LEVELS[level]} run in ${CERTIFICATIONS}` } };
      }
    } else {
      const gap = (entry.levels[level] ?? []).find((n) => n.gap);
      if (gap) return { level: at === 0 ? "L0" : LEVELS[at - 1], next: { level, need: gap.need, gap: gap.gap } };
    }
    at = i + 1;
  }
  return { level: LEVELS[at - 1], next: null };
}

/** The level each worker is at, and the first open need above it. */
export function scorecard(registry, certs = [], table = {}) {
  return registry.map((entry) => ({ worker: entry.worker, ...levelOf(entry, certs, table) }));
}

/** The levels Launch reads: every worker by name, and each per-platform worker as `worker|platform`. */
export function launchLevels(registry, certs, table) {
  const out = {};
  for (const entry of registry) out[entry.worker] = levelOf(entry, certs, table).level;
  for (const r of Object.values(table).flat()) {
    if (r.platform) out[`${r.worker}|${r.platform}`] = levelOf(registry.find((e) => e.worker === r.worker), certs, table, r.platform).level;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** The generated module's exact text: deterministic, so the gate can compare bytes. */
export function renderGenerated(registry, certs, table) {
  const workers = Object.fromEntries(Object.entries(table).map(([k, rows]) => [k, rows.map((r) => ({ worker: r.worker, platform: r.platform ?? null }))]));
  const json = (v) => JSON.stringify(v, null, 2);
  return `// GENERATED by \`pnpm gen:ads-readiness\` (scripts/check-ads-readiness.mjs --write) from
// scripts/ads-readiness.registry.mjs and ${CERTIFICATIONS}. DO NOT EDIT: \`lint:ads-readiness\` fails when this
// file differs by a byte from what those two make. Launch reads it (ADS-AGENT-BUILD-WORKFLOW §4R, G-launch-gate).

export type AdsReadinessLevel = "L0" | "L1" | "L2" | "L3" | "L4" | "L5";

export interface AdsCampaignWorker {
  worker: string;
  /** The platform a per-platform worker is certified on; null for a worker certified once for all. */
  platform: string | null;
}

/** Which workers a campaign uses, keyed \`provider:creative_kind\` (the registry's CAMPAIGN_WORKERS). */
export const ADS_CAMPAIGN_WORKERS: Readonly<Record<string, readonly AdsCampaignWorker[]>> = ${json(workers)};

/** Each worker's level, by name and, for a per-platform worker, as \`worker|platform\`. L4/L5 only from a passing run. */
export const ADS_WORKER_LEVELS: Readonly<Record<string, AdsReadinessLevel>> = ${json(launchLevels(registry, certs, table))};

/** The runs behind every L4/L5 above (${CERTIFICATIONS}). */
export const ADS_CERTIFICATIONS: readonly Readonly<Record<string, string>>[] = ${json(certs)};
`;
}

function certCases(full, pinned) {
  const met = (extra = {}) => ({ L1: [pinned(["a guard"])], L2: [pinned(["a guard"])], L3: [pinned(["a guard"])], ...extra });
  const W = { worker: "W", levels: full(met()) };
  const P = { worker: "P", perPlatform: true, levels: full(met()) };
  const table = { "meta:still": [{ worker: "W" }, { worker: "P", platform: "meta" }] };
  const run = (over = {}) => ({ worker: "W", level: "L4", target: "sandbox", run_date: "2026-11-09", sha: "a".repeat(40), result: "pass", evidence: "https://ci/run/1", ...over });
  const lvl = (e, certs, platform) => levelOf(e, certs, table, platform).level;
  return [
    ["L3 with no run stays L3, whatever L4's needs say", () => lvl({ ...W, levels: full(met({ L4: [pinned(["a guard"])] })) }, []) === "L3"],
    ["a passing sandbox run makes L4", () => lvl(W, [run()]) === "L4"],
    ["a failed run does not", () => lvl(W, [run({ result: "fail" })]) === "L3"],
    ["a run above an L2 gap still leaves L1", () => lvl({ ...W, levels: full({ L1: [pinned(["a guard"])] }) }, [run()]) === "L1"],
    ["a per-platform worker is L4 only on the platform its run names", () => lvl(P, [run({ worker: "P", platform: "tiktok" })], "meta") === "L3" && lvl(P, [run({ worker: "P", platform: "meta" })], "meta") === "L4"],
    ["the scorecard row of a per-platform worker needs every platform the table uses", () => scorecard([P], [run({ worker: "P", platform: "tiktok" })], table)[0].level === "L3"],
    ["a well-formed run and table pass", () => certificationProblems([run(), run({ worker: "P", platform: "meta" })], [W, P], table).length === 0],
    ["a short sha is refused", () => certificationProblems([run({ sha: "abc123" })], [W, P], table).length === 1],
    ["an unknown worker is refused", () => certificationProblems([run({ worker: "Nobody" })], [W, P], table).length === 1],
    ["an L3 'run' is refused", () => certificationProblems([run({ level: "L3" })], [W, P], table).length === 1],
    ["an L4 run on the canary is refused", () => certificationProblems([run({ target: "canary" })], [W, P], table).length === 1],
    ["a per-platform run without its platform is refused", () => certificationProblems([run({ worker: "P" })], [W, P], table).length === 1],
    ["a table row naming no such worker is refused", () => certificationProblems([], [W, P], { "meta:still": [{ worker: "Nobody" }] }).length === 1],
    ["the generated module carries each level", () => renderGenerated([W, P], [run()], table).includes('"W": "L4"') && renderGenerated([W, P], [run()], table).includes('"P|meta": "L3"')],
  ];
}

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
    ...certCases(full, pinned),
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
  console.log("\nA real campaign needs L4 for every worker it uses (§4R); Launch refuses one below it (campaigns/launchCertification.ts).");
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--self-test")) return selfTest();
  const raw = readFile(CERTIFICATIONS);
  let certs = [];
  const failures = [...shapeProblems(READINESS), ...pinProblems(READINESS, readFile)];
  try {
    certs = raw === null ? null : JSON.parse(raw).certifications;
  } catch (e) {
    failures.push(`${CERTIFICATIONS}: not JSON (${e.message})`);
  }
  if (certs === null) { failures.push(`${CERTIFICATIONS} is gone`); certs = []; }
  failures.push(...certificationProblems(certs, READINESS, CAMPAIGN_WORKERS));
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
  const generated = renderGenerated(READINESS, certs, CAMPAIGN_WORKERS);
  if (args.has("--write")) {
    writeFileSync(join(ROOT, GENERATED), generated);
    return console.log(`wrote ${GENERATED}`);
  }
  const card = scorecard(READINESS, certs, CAMPAIGN_WORKERS);
  if (args.has("--json")) return console.log(JSON.stringify(card, null, 2));
  if (args.has("--scorecard")) return printScorecard(card);
  if (readFile(GENERATED) !== generated) {
    console.error(`${GENERATED} is not what the registry and ${CERTIFICATIONS} make — run \`pnpm gen:ads-readiness\` and commit it (never edit it by hand).`);
    process.exit(1);
  }
  const pins = READINESS.flatMap((r) => LEVELS.flatMap((l) => r.levels[l])).filter((n) => !n.gap).length;
  console.log(`check-ads-readiness: ${pins} needs pinned across ${READINESS.length} workers, all in force; ${certs.length} certification(s); ${GENERATED} current — ${card.map((c) => `${c.worker} ${c.level}`).join(", ")}`);
}

main();
