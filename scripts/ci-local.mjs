#!/usr/bin/env node
/**
 * `pnpm ci:local` — run, on this machine, the steps .github/workflows/ci.yml runs on a pull request.
 *
 *   pnpm ci:local                       every job ci.yml has, three at a time
 *   pnpm ci:local --job gates,typecheck only those jobs
 *   pnpm ci:local --jobs 5              how many jobs run at once
 *   pnpm ci:local --list                print what would run and what is skipped, and why
 *   node scripts/ci-local.mjs --self-test
 *
 * WHY (CI-FEEDBACK-LOOP-V2-PLAN.md D-CIF4, 2026-10-16). 25 of 200 PR runs had failed, and each red
 * run cost a full CI cycle. The recurring cause was a local run of a GUESSED subset: a list of
 * `lint:*` names that missed the package-scoped design-token gate, the migration-ordering script
 * invoked directly, `test:rls`, and the matrix self-test. A hand-kept list here would drift the same
 * way. So nothing is listed: the steps are READ from ci.yml, every job runs unless it is one of the
 * three below that cannot run here, and a matrix job runs once, unsharded, as shard 1/1.
 *
 * It fails CLOSED. A `${{ }}` expression or step `if:` this file cannot evaluate stops the run with
 * the expression named, instead of skipping the step or substituting a guess; the self-test runs
 * in CI's gates job, so a step added to ci.yml that this cannot evaluate is red on its own PR.
 *
 * Differences from CI, all deliberate:
 *   - steps that install CI's toolchain (`uses:` actions, anything writing $GITHUB_PATH) are
 *     skipped: this machine's own pnpm, gitleaks and Chromium are used;
 *   - a failing step does not stop its job: every step reports, so one run lists every failure;
 *   - CI checks the COMMIT. The secret scan reads `git archive HEAD` and some suites enumerate
 *     `git ls-files`, so uncommitted or untracked files are warned about up front.
 */
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "ci.yml");

/** Jobs that cannot run here. Any other job — including one added tomorrow — runs. */
const SKIPPED_JOBS = {
  plan: "push-only: asks GitHub whether main's tree was already proven",
  build: "the required-check aggregator; it runs nothing",
  "native-android": "needs the Android SDK and a Gradle build (see its ci.yml comment)",
};

/** Step `if:` conditions, as a local run of a pull request evaluates them. */
const CONDITIONS = {
  "github.event_name == 'pull_request'": true,
  "runner.environment == 'github-hosted'": false,
  "!cancelled() && needs.plan.outputs.reuse != 'true'": true,
};

/** `${{ }}` expressions in env and run lines. Functions are evaluated once, on first use. */
const EXPRESSIONS = {
  "strategy.job-index": "0",
  "strategy.job-total": "1",
  "vars.CI_RUNNER && '3' || ''": "",
  "runner.os == 'Linux' && '--with-deps' || ''": process.platform === "linux" ? "--with-deps" : "",
  "github.event.pull_request.base.sha": () => git("merge-base", "HEAD", "origin/main"),
  "github.base_ref == 'production' && github.event.pull_request.head.sha || ''": "",
};

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

/** ci.yml as JSON. Ruby parses the YAML: it ships with macOS and GitHub's ubuntu image, and no
 *  workspace package depends on a YAML parser (scripts/check-ci-verdict.sh does the same). */
function loadWorkflow(path) {
  const script = "require 'yaml'; require 'json'; print JSON.generate(YAML.load_file(ARGV[0]))";
  return JSON.parse(execFileSync("ruby", ["-e", script, path], { encoding: "utf8" }));
}

const unwrap = (expr) => expr.replace(/^\$\{\{\s*|\s*\}\}$/g, "").trim();

function condition(expr, where) {
  if (expr === undefined) return true;
  const key = unwrap(String(expr));
  if (!(key in CONDITIONS)) {
    throw new Error(`${where}: ci:local cannot evaluate \`if: ${key}\` — add it to CONDITIONS`);
  }
  return CONDITIONS[key];
}

const resolved = new Map();
function substitute(text, where) {
  return String(text).replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, key) => {
    if (!(key in EXPRESSIONS)) {
      throw new Error(`${where}: ci:local cannot evaluate \`\${{ ${key} }}\` — add it to EXPRESSIONS`);
    }
    if (!resolved.has(key)) {
      const v = EXPRESSIONS[key];
      resolved.set(key, typeof v === "function" ? v() : v);
    }
    return resolved.get(key);
  });
}

function substituteEnv(env, where) {
  return Object.fromEntries(Object.entries(env ?? {}).map(([k, v]) => [k, substitute(v, where)]));
}

/**
 * Every job and step of the workflow, each either `run` or `skip` with a reason. Throws on
 * anything it cannot evaluate. Pure apart from the lazily-run git lookups.
 */
function plan(workflow) {
  const globalEnv = substituteEnv(workflow.env, "workflow env");
  const jobs = [];
  for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
    if (name in SKIPPED_JOBS) {
      jobs.push({ name, skip: SKIPPED_JOBS[name], steps: [] });
      continue;
    }
    if (!condition(job.if, `job ${name}`)) {
      jobs.push({ name, skip: "its `if:` is false for a pull request", steps: [] });
      continue;
    }
    const jobEnv = { ...globalEnv, ...substituteEnv(job.env, `job ${name}`) };
    const steps = (job.steps ?? []).map((step, i) => {
      const label = step.name ?? step.uses ?? `step ${i + 1}`;
      const where = `${name} › ${label}`;
      if (!step.run) return { label, skip: `toolchain action (${step.uses})` };
      if (/\$GITHUB_PATH\b/.test(step.run)) return { label, skip: "installs a CI tool on GITHUB_PATH" };
      if (!condition(step.if, where)) return { label, skip: `\`if: ${unwrap(step.if)}\` is false here` };
      return {
        label,
        run: substitute(step.run, where),
        cwd: join(ROOT, step["working-directory"] ?? ""),
        env: { ...jobEnv, ...substituteEnv(step.env, where) },
      };
    });
    jobs.push({ name, steps, sharded: Boolean(job.strategy?.matrix) });
  }
  return jobs;
}

/**
 * Each job's share of the cores. In CI every job has a machine to itself, so vitest and the matrix
 * runner each take every core they see; run three jobs at once here and each takes all fourteen.
 * Measured 2026-10-16 with all seven jobs at once: 75 vitest timeouts at 5 s and a Playwright
 * server that never came up in 60 s — the same overload the self-hosted Mac trial hit on 2026-09-30
 * (ci.yml's VITEST_MAX_WORKERS comment). An explicit value in the environment still wins.
 */
let coreShare = 0;
const SHARED_CAPS = ["VITEST_MAX_WORKERS", "MATRIX_CONCURRENCY"];

function runStep(job, step, index, logDir) {
  const slug = step.label.replace(/[^a-z0-9]+/gi, "-").slice(0, 50);
  const log = join(logDir, `${job}--${String(index + 1).padStart(2, "0")}-${slug}.log`);
  const out = createWriteStream(log);
  const started = Date.now();
  return new Promise((resolve) => {
    // The shell GitHub's runners use for `run:` on Linux and macOS.
    const child = spawn("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run], {
      cwd: step.cwd,
      env: withCoreShare({ ...process.env, ...step.env, CI: "true" }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    const keep = (chunk) => {
      out.write(chunk);
      tail = (tail + chunk.toString()).slice(-6000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const finish = (code) => {
      out.end();
      resolve({ job, label: step.label, code, log, tail, seconds: (Date.now() - started) / 1000 });
    };
    child.on("close", (code) => finish(code ?? 1));
    child.on("error", (err) => {
      keep(`failed to start: ${err.message}\n`);
      finish(1);
    });
  });
}

function withCoreShare(env) {
  for (const k of SHARED_CAPS) if (!env[k]) env[k] = String(coreShare);
  return env;
}

async function runJob(job, logDir) {
  const results = [];
  for (const [i, step] of job.steps.entries()) {
    if (step.skip) continue;
    const r = await runStep(job.name, step, i, logDir);
    results.push(r);
    const mark = r.code === 0 ? "✓" : "✗";
    console.log(`${mark} ${job.name} › ${step.label}  ${r.seconds.toFixed(1)}s`);
  }
  return results;
}

async function pool(items, limit, fn) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) results.push(...(await fn(items[next++])));
  });
  await Promise.all(workers);
  return results;
}

function option(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (arg) return arg.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function printPlan(jobs) {
  for (const job of jobs) {
    if (job.skip) {
      console.log(`- ${job.name}: SKIPPED — ${job.skip}`);
      continue;
    }
    console.log(`- ${job.name}${job.sharded ? " (unsharded: shard 1/1)" : ""}`);
    for (const s of job.steps) {
      console.log(s.skip ? `    skip  ${s.label} — ${s.skip}` : `    run   ${s.label}: ${s.run.split("\n")[0]}`);
    }
  }
}

function warnIfUncommitted() {
  const dirty = git("status", "--porcelain").split("\n").filter(Boolean);
  if (dirty.length === 0) return;
  console.log(
    `⚠ ${dirty.length} uncommitted or untracked path(s). CI tests the commit: the secret scan reads ` +
      "`git archive HEAD` and some suites enumerate `git ls-files`, so commit (or at least " +
      "`git add`) before trusting a green run here.\n",
  );
}

/**
 * What CI's `./.github/actions/setup` does before every job and this file skips as a toolchain step:
 * `pnpm install --frozen-lockfile`, then the React Native build of @silvicom/shared. Without them every
 * step fails for a reason that is not the change — `eslint: command not found`, `Cannot find module
 * 'typescript'`, a matrix importing packages/shared/dist — and a fresh worktree reported 7 of 41 gates
 * red that way twice on 2026-10-16. So the run stops first and names the two commands instead.
 *
 * "Installed from THIS lockfile" is exact, not guessed from a timestamp: pnpm keeps a byte-identical
 * copy of the lockfile it installed at node_modules/.pnpm/lock.yaml, so a lockfile changed by a pull
 * or a rebase since the last install is caught too.
 */
function setupProblems(root = ROOT) {
  const problems = [];
  const lock = join(root, "pnpm-lock.yaml");
  const installed = join(root, "node_modules", ".pnpm", "lock.yaml");
  if (!existsSync(installed)) problems.push("the workspace is not installed");
  else if (!readFileSync(lock).equals(readFileSync(installed))) {
    problems.push("pnpm-lock.yaml changed since the last install");
  }
  if (!existsSync(join(root, "packages", "shared", "dist", "index.js"))) {
    problems.push("packages/shared/dist is missing (the driver app's and one matrix's build of @silvicom/shared)");
  }
  return problems;
}

/** Fixture checks of the evaluator, then a full plan of the real ci.yml. */
function selfTest() {
  const bad = [];
  const expectThrow = (what, wf) => {
    try {
      plan(wf);
      bad.push(`${what} was accepted`);
    } catch {
      // refused, as it should be
    }
  };
  expectThrow("an unknown step if:", { jobs: { j: { steps: [{ run: "x", if: "github.ref == 'x'" }] } } });
  expectThrow("an unknown expression", { jobs: { j: { steps: [{ run: "echo ${{ github.sha }}" }] } } });
  expectThrow("an unknown job if:", { jobs: { j: { if: "always()", steps: [] } } });
  const [sharded] = plan({
    jobs: { t: { strategy: { matrix: { shard: [1, 2] } }, steps: [{ run: "x --shard=$(( ${{ strategy.job-index }} + 1 ))/${{ strategy.job-total }}" }] } },
  });
  if (sharded.steps[0].run !== "x --shard=$(( 0 + 1 ))/1") bad.push(`shard rewrite gave: ${sharded.steps[0].run}`);
  const [newJob] = plan({ jobs: { brand_new: { steps: [{ run: "true" }] } } });
  if (newJob.skip || newJob.steps[0].skip) bad.push("a job ci:local has never heard of was not run");

  // The setup check, against a throwaway root: absent, stale lockfile, missing dist, then ready.
  const tmp = mkdtempSync(join(tmpdir(), "ci-local-setup-"));
  const put = (rel, text) => {
    mkdirSync(join(tmp, rel, ".."), { recursive: true });
    writeFileSync(join(tmp, rel), text);
  };
  put("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  const said = () => setupProblems(tmp).join(" | ");
  if (!said().includes("not installed")) bad.push(`an uninstalled workspace read as: ${said() || "ready"}`);
  put("node_modules/.pnpm/lock.yaml", "lockfileVersion: '9.0'\n# older\n");
  if (!said().includes("changed since")) bad.push(`a stale install read as: ${said() || "ready"}`);
  put("node_modules/.pnpm/lock.yaml", "lockfileVersion: '9.0'\n");
  if (!said().includes("shared/dist")) bad.push(`a missing shared build read as: ${said() || "ready"}`);
  put("packages/shared/dist/index.js", "");
  if (said()) bad.push(`a ready workspace read as: ${said()}`);
  rmSync(tmp, { recursive: true, force: true });

  const jobs = plan(loadWorkflow(WORKFLOW));
  const runnable = jobs.flatMap((j) => j.steps.filter((s) => !s.skip));
  if (runnable.length < 20) bad.push(`only ${runnable.length} runnable steps in ci.yml — the reader is broken`);
  for (const name of Object.keys(SKIPPED_JOBS)) {
    if (!jobs.some((j) => j.name === name)) bad.push(`SKIPPED_JOBS names \`${name}\`, which ci.yml no longer has`);
  }
  for (const b of bad) console.error(`FAIL: ${b}`);
  console.log(bad.length ? "ci-local self-test FAILED" : `ci-local self-test passed (${runnable.length} steps runnable)`);
  return bad.length ? 1 : 0;
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();

  let jobs = plan(loadWorkflow(WORKFLOW));
  const only = option("job")?.split(",");
  if (only) {
    const unknown = only.filter((n) => !jobs.some((j) => j.name === n));
    if (unknown.length) throw new Error(`no such job in ci.yml: ${unknown.join(", ")}`);
    jobs = jobs.filter((j) => only.includes(j.name));
  }
  if (process.argv.includes("--list")) {
    printPlan(jobs);
    return 0;
  }

  const problems = setupProblems();
  if (problems.length) {
    console.error(`ci:local: not set up the way CI's setup step leaves a runner — ${problems.join("; ")}.`);
    console.error("Run: pnpm install --frozen-lockfile && pnpm --filter @silvicom/shared build:rn");
    return 2;
  }
  warnIfUncommitted();
  const runnable = jobs.filter((j) => !j.skip);
  for (const j of jobs.filter((x) => x.skip)) console.log(`- ${j.name}: skipped — ${j.skip}`);
  const limit = Math.max(1, Number(option("jobs")) || 3);
  coreShare = Math.max(2, Math.floor(cpus().length / Math.min(limit, runnable.length)));
  const logDir = join(tmpdir(), `ci-local-${Date.now()}`);
  mkdirSync(logDir, { recursive: true });
  console.log(
    `Running ${runnable.map((j) => j.name).join(", ")} — ${limit} at a time, ${coreShare} workers each. Logs: ${logDir}\n`,
  );

  const started = Date.now();
  const results = await pool(runnable, limit, (job) => runJob(job, logDir));
  const failed = results.filter((r) => r.code !== 0);
  for (const f of failed) {
    console.log(`\n──── ✗ ${f.job} › ${f.label} (exit ${f.code}) — ${f.log}\n${f.tail.split("\n").slice(-25).join("\n")}`);
  }
  const wall = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\n${results.length - failed.length}/${results.length} steps passed in ${wall}s.`);
  if (failed.length) console.log(`FAILED: ${failed.map((f) => `${f.job} › ${f.label}`).join("; ")}`);
  return failed.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`ci:local: ${err.message}`);
    process.exit(2);
  },
);
