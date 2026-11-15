#!/usr/bin/env node
/**
 * Has a published critical or high advisory reached the office app since somebody last looked?
 * (INSTALLED-APP-PLAN §5a finding A4, work item IA11.)
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────────────────────────────────
 * The security audit of 2026-11-15 ran `pnpm audit --prod` for the first time and found 119
 * published advisories, 3 critical and 69 high. Nothing in CI had ever asked. An advisory is
 * published against code that is ALREADY merged, so no pull request can catch it — the question
 * has to be asked on a clock, which is why this runs nightly (advisories.yml) rather than as a
 * `lint:*` gate.
 *
 * ── WHAT "REACHES" MEANS, AND WHY THE AUDIT REPORT CANNOT ANSWER IT ───────────────────────────────
 * `pnpm audit` reports ONE dependency path per vulnerable version, not one per package that
 * installs it. Measured 2026-11-15: zod 4.4.3 is a direct dependency of api, web, admin-api and
 * six workspace packages, and the report listed it under `apps__admin-api>zod` alone; vue 3.5.39's
 * server renderer is in the web app's tree and was listed only under `apps__admin`. Reading the
 * first segment of `paths` therefore says "the console only" about a library the office app ships.
 * So the audit report is used for exactly one fact — which (library, version) pairs are vulnerable
 * — and where each pair is installed is read from `pnpm ls --prod` per office package, which
 * follows workspace links (web → @silvicom/shared → zod).
 *
 * ── WHAT IT FAILS ON ──────────────────────────────────────────────────────────────────────────────
 *   1. A critical or high advisory reaching web, api, admin or admin-api that
 *      scripts/advisory-baseline.json does not accept FOR THAT PACKAGE. Accepting an advisory in
 *      the console does not accept it in the API.
 *   2. A baseline entry that no longer describes anything — the advisory is gone from a package it
 *      names, or gone altogether. The baseline may only shrink; an upgrade that closes an advisory
 *      removes its line in the same PR.
 *   3. Anything that would make a pass meaningless: an audit report without an `advisories` map
 *      (the registry answered an error), or an office package whose tree came back empty.
 *
 * The driver app is NOT judged here: its build tooling ships through its own release lanes
 * (driver-android / driver-store) and never runs on a server or in the office browser.
 * Moderate and low advisories are counted in the output and do not fail the run.
 *
 * Run:  node scripts/check-advisories.mjs
 *       node scripts/check-advisories.mjs --self-test
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The four packages whose production dependencies run in the office browser or on a server. */
export const OFFICE_PACKAGES = ["@silvicom/web", "@silvicom/api", "@silvicom/admin", "@silvicom/admin-api"];
const FAILING = new Set(["critical", "high"]);
const BASELINE_PATH = fileURLToPath(new URL("./advisory-baseline.json", import.meta.url));

/** Every `name@version` in one `pnpm ls --json` tree, workspace links followed. */
export function installedSet(tree) {
  const set = new Set();
  const walk = (deps) => {
    for (const [name, dep] of Object.entries(deps ?? {})) {
      set.add(`${name}@${dep.version}`);
      walk(dep.dependencies);
      walk(dep.optionalDependencies);
    }
  };
  walk(tree.dependencies);
  walk(tree.optionalDependencies);
  return set;
}

/**
 * Pure verdict. `audit` is `pnpm audit --json`; `installed` maps an office package to its
 * `name@version` set; `baseline` is advisory-baseline.json's `accepted` list.
 */
export function judge(audit, installed, baseline) {
  const problems = [];
  if (!audit || typeof audit.advisories !== "object" || audit.advisories === null) {
    return { problems: ["The audit report has no `advisories` map — the registry did not answer, so nothing was checked."], reaching: [], below: 0 };
  }
  for (const pkg of OFFICE_PACKAGES) {
    if (!installed[pkg] || installed[pkg].size === 0) {
      problems.push(`${pkg}: its dependency tree came back empty — is the workspace installed?`);
    }
  }

  const reaching = [];
  let below = 0;
  for (const advisory of Object.values(audit.advisories)) {
    const versions = [...new Set((advisory.findings ?? []).map((f) => f.version))];
    const packages = OFFICE_PACKAGES.filter((pkg) =>
      versions.some((v) => installed[pkg]?.has(`${advisory.module_name}@${v}`)),
    );
    if (packages.length === 0) continue;
    if (!FAILING.has(advisory.severity)) {
      below += 1;
      continue;
    }
    reaching.push({
      id: advisory.github_advisory_id,
      library: advisory.module_name,
      severity: advisory.severity,
      versions,
      patched: advisory.patched_versions,
      title: advisory.title,
      packages,
    });
  }

  const accepted = new Map(baseline.map((entry) => [entry.id, entry]));
  for (const found of reaching) {
    const entry = accepted.get(found.id);
    const unaccepted = found.packages.filter((pkg) => !entry?.reaches.includes(pkg));
    if (unaccepted.length > 0) {
      problems.push(
        `NEW ${found.severity}: ${found.library} ${found.versions.join(", ")} in ${unaccepted.join(", ")} — ` +
          `${found.title} (${found.id}; fixed in ${found.patched}).`,
      );
    }
  }
  const byId = new Map(reaching.map((found) => [found.id, found]));
  for (const entry of baseline) {
    const found = byId.get(entry.id);
    const gone = entry.reaches.filter((pkg) => !found?.packages.includes(pkg));
    if (gone.length > 0) {
      problems.push(
        `STALE baseline entry ${entry.id} (${entry.library}): no longer reaches ${gone.join(", ")} — ` +
          `remove ${found ? "those packages from it" : "the entry"} in scripts/advisory-baseline.json.`,
      );
    }
  }
  return { problems, reaching, below };
}

function selfTest() {
  const advisory = (id, library, severity, version, path) => ({
    github_advisory_id: id,
    module_name: library,
    severity,
    title: `${library} problem`,
    patched_versions: ">=9.9.9",
    findings: [{ version, paths: [path] }],
  });
  const installed = {
    "@silvicom/web": new Set(["zod@4.4.3", "vue@3.5.39"]),
    "@silvicom/api": new Set(["zod@4.4.3", "express@5.0.0"]),
    "@silvicom/admin": new Set(["vue@3.5.39"]),
    "@silvicom/admin-api": new Set(["zod@4.4.3"]),
  };
  // The report names admin-api alone, exactly as pnpm did for zod on 2026-11-15.
  const zod = advisory("GHSA-zod", "zod", "high", "4.4.3", "apps__admin-api>zod");
  const audit = (...list) => ({ advisories: Object.fromEntries(list.map((a, i) => [i, a])) });
  const everywhere = ["@silvicom/web", "@silvicom/api", "@silvicom/admin-api"];
  const cases = [
    ["a clean report passes", judge(audit(), installed, []).problems.length === 0],
    [
      "an advisory reported under one package is found in every package that installs that version",
      judge(audit(zod), installed, []).reaching[0].packages.join() === everywhere.join(),
    ],
    ["a new high advisory fails", judge(audit(zod), installed, []).problems.some((p) => p.startsWith("NEW high"))],
    [
      "an advisory accepted for every package it reaches passes",
      judge(audit(zod), installed, [{ id: "GHSA-zod", library: "zod", reaches: everywhere }]).problems.length === 0,
    ],
    [
      "accepting it for the console's API does not accept it for the API",
      judge(audit(zod), installed, [{ id: "GHSA-zod", library: "zod", reaches: ["@silvicom/admin-api"] }]).problems.some(
        (p) => p.startsWith("NEW high") && p.includes("@silvicom/api") && !p.includes("@silvicom/admin-api"),
      ),
    ],
    [
      "a baseline entry for an advisory that is gone fails",
      judge(audit(), installed, [{ id: "GHSA-zod", library: "zod", reaches: everywhere }]).problems.some((p) => p.startsWith("STALE")),
    ],
    [
      "a baseline entry naming a package the advisory left fails",
      judge(audit(zod), { ...installed, "@silvicom/api": new Set(["zod@4.6.7"]) }, [
        { id: "GHSA-zod", library: "zod", reaches: everywhere },
      ]).problems.some((p) => p.startsWith("STALE") && p.includes("@silvicom/api")),
    ],
    [
      "a moderate advisory is counted and does not fail",
      (() => {
        const verdict = judge(audit(advisory("GHSA-m", "express", "moderate", "5.0.0", "apps__api>express")), installed, []);
        return verdict.problems.length === 0 && verdict.below === 1;
      })(),
    ],
    [
      "a critical advisory in the driver app alone is not judged",
      judge(audit(advisory("GHSA-d", "shell-quote", "critical", "1.0.0", "apps__driver>shell-quote")), installed, []).problems.length === 0,
    ],
    [
      "a vulnerable version an office package does not install is not judged",
      judge(audit(advisory("GHSA-v", "zod", "high", "3.25.76", "apps__driver>zod")), installed, []).problems.length === 0,
    ],
    ["a report without advisories fails", judge({ error: { code: "ERR" } }, installed, []).problems.length === 1],
    [
      "an empty tree for an office package fails",
      judge(audit(), { ...installed, "@silvicom/web": new Set() }, []).problems.some((p) => p.includes("@silvicom/web")),
    ],
  ];
  const failed = cases.filter(([, ok]) => !ok);
  for (const [name, ok] of cases) console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  console.log(`RESULT ${cases.length - failed.length}/${cases.length} self-test cases`);
  process.exit(failed.length === 0 ? 0 : 1);
}

/** `pnpm audit` exits 1 whenever it finds anything, so its exit code is not an error here. */
function pnpmJson(args) {
  let out;
  try {
    out = execFileSync("pnpm", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] });
  } catch (error) {
    out = error.stdout;
    if (!out) throw error;
  }
  return JSON.parse(out);
}

function main() {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")).accepted;
  const audit = pnpmJson(["audit", "--prod", "--json"]);
  const installed = {};
  for (const pkg of OFFICE_PACKAGES) {
    const trees = pnpmJson(["ls", "--prod", "--depth", "Infinity", "--json", "--filter", pkg]);
    installed[pkg] = trees.length === 1 ? installedSet(trees[0]) : new Set();
  }
  const { problems, reaching, below } = judge(audit, installed, baseline);

  for (const pkg of OFFICE_PACKAGES) console.log(`${pkg}: ${installed[pkg].size} installed production packages`);
  console.log(`${reaching.length} critical/high advisories reach the office app, ${baseline.length} accepted; ${below} moderate/low (not judged).`);
  for (const found of reaching) {
    console.log(`  ${found.severity.padEnd(8)} ${found.library} ${found.versions.join(", ")} → ${found.packages.join(", ")}  ${found.id}`);
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`✗ ${problem}`);
    console.error(`RESULT ${problems.length} problem(s). Upgrade the library, or — with a reason somebody can check — accept it in scripts/advisory-baseline.json.`);
    process.exit(1);
  }
  console.log("RESULT no new critical or high advisory reaches web, api, admin or admin-api.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--self-test")) selfTest();
  else main();
}
