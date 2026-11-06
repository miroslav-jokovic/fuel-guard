/**
 * `pnpm ads:certify <worker|all> --target sandbox` — run each worker's L4 (ADS-AGENT-BUILD-WORKFLOW §4R) and
 * write a DRAFT certification for every PASS (stage2-kit; ADS-RUNBOOK §7 is the owner's order of steps).
 *
 * For each worker it runs the suites `adsCertifyPlan.ts` names with ADS_TARGET set, each in its own vitest
 * process, keeping every byte printed; re-records the fakes' OUR readings on the target and diffs them
 * against the committed recording (`platforms/meta/contract/readings.ts`); and prints one verdict per worker:
 * PASS, FAIL (with each failed test, difference or leak) or NOT BUILT (with what is missing).
 *
 * It REFUSES, before running anything, when a variable a worker reads is missing (named, per worker), when
 * the sandbox ad account fails D-AD8's own check (`guard/sandboxOnly.ts`, the one definition: on this
 * machine's allowlist and no payment method), when the tree is dirty, or when HEAD is not on origin/main.
 *
 * It never commits, pushes or edits scripts/ads-certifications.json. A PASS becomes a record in
 * `ads-certifications.draft.json` (gitignored), held to the readiness gate's own shape check; the run's
 * logs and `summary.json` (its evidence) stay under `.ads-certify/` (gitignored). A person copies the record
 * into ads-certifications.json in a PR, with the summary in its body.
 *
 * `--target fake` is a rehearsal: the same suites on FakeMeta, no tree checks, and a draft whose target the
 * gate refuses — so a rehearsal can never be committed as a certification.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnv } from "../env.js";
import { sandboxOnlyVerdict } from "../modules/ads/guard/sandboxOnly.js";
import { MetaGraph } from "../modules/ads/platforms/meta/graphClient.js";
import { centralDate, draftRecord, preflight, scrape, selectWorkers, targetOf, verdictOf, WORKER_RUNS, type DraftRecord, type Git, type SuiteResult, type Verdict } from "./adsCertifyPlan.js";

export const API_DIR = fileURLToPath(new URL("../../", import.meta.url));
export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const DRAFT = "ads-certifications.draft.json";

export interface CertifyIO {
  /** Where `.ads-certify/` and the draft go: the repo root, or a test's temporary folder. */
  root: string;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  git: () => Git;
  /** One suite file in its own vitest process; `out` is that suite's ADS_CERTIFY_OUT. */
  runSuite: (file: string, env: NodeJS.ProcessEnv, out: string) => SuiteResult & { output: string };
  /** D-AD8 on the sandbox account: null when it may be used, else why not. */
  checkSandboxAccount: (env: NodeJS.ProcessEnv) => Promise<string | null>;
  print: (line: string) => void;
}

type Registry = { READINESS: Array<{ worker: string }>; CAMPAIGN_WORKERS: Record<string, unknown> };
type Gate = { certificationProblems: (certs: unknown, registry: unknown, table: unknown) => string[] };
const load = async <T>(rel: string): Promise<T> => (await import(pathToFileURL(join(ROOT, rel)).href)) as T;

export async function certify(argv: readonly string[], io: CertifyIO): Promise<number> {
  const registry = await load<Registry>("scripts/ads-readiness.registry.mjs");
  const at = argv.indexOf("--target");
  const flag = at >= 0 ? argv[at + 1] : undefined;
  const positional = argv.filter((a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1));
  const picked = selectWorkers(positional[0], registry.READINESS.map((r) => r.worker));
  const target = targetOf(flag, io.env);
  const refuse = (lines: string[]) => {
    io.print("ads:certify REFUSED — nothing was run:");
    for (const l of lines) io.print(`  - ${l}`);
    return 2;
  };
  if ("refusal" in picked || "refusal" in target) return refuse([..."refusal" in picked ? [picked.refusal] : [], ..."refusal" in target ? [target.refusal] : []]);

  const git = io.git();
  const refusals = preflight(target.target, picked.workers, io.env, git);
  if (refusals.length > 0) return refuse(refusals);
  const built = picked.workers.filter((w) => !("unbuilt" in WORKER_RUNS[w]!));
  if (target.target === "sandbox" && built.length > 0) {
    const account = await io.checkSandboxAccount(io.env);
    if (account) return refuse([`D-AD8 refuses the sandbox account: ${account}`]);
  }

  const now = io.now();
  const dir = join(io.root, ".ads-certify", `${now.toISOString().replace(/[:.]/g, "-")}-${git.sha.slice(0, 7)}`);
  mkdirSync(dir, { recursive: true });
  const ran = new Map<string, SuiteResult & { output: string; differences: string[] }>();
  const verdicts: Verdict[] = [];
  for (const worker of picked.workers) {
    const run = WORKER_RUNS[worker]!;
    if ("unbuilt" in run) { verdicts.push({ worker, verdict: "NOT BUILT", why: [run.unbuilt] }); continue; }
    const results = run.suites.map((file) => {
      if (!ran.has(file)) {
        const out = join(dir, file.replace(/[^a-z0-9]+/gi, "_"));
        mkdirSync(out, { recursive: true });
        const r = io.runSuite(file, { ...io.env, ADS_TARGET: target.target, ADS_CERTIFY_OUT: out, CI: "true" }, out);
        writeFileSync(join(out, "output.log"), r.output);
        const differences = readdirSync(out).filter((f) => /^readings-.*\.json$/.test(f))
          .flatMap((f) => (JSON.parse(readFileSync(join(out, f), "utf8")) as { differences: string[] }).differences);
        ran.set(file, { ...r, differences });
      }
      return ran.get(file)!;
    });
    const leaks = "scrape" in run && run.scrape ? scrape(results.map((r) => r.output).join("\n"), io.env) : [];
    verdicts.push(verdictOf(worker, results, results.flatMap((r) => r.differences), leaks));
  }

  const runDate = centralDate(now);
  const summaryPath = join(dir, "summary.json");
  const evidence = summaryPath.startsWith(io.root) ? summaryPath.slice(io.root.length).replace(/^\/+/, "") : summaryPath;
  const drafts: DraftRecord[] = verdicts.filter((v) => v.verdict === "PASS").map((v) => draftRecord(v.worker, target.target, git.sha, runDate, evidence));
  writeFileSync(summaryPath, `${JSON.stringify({ target: target.target, sha: git.sha, run_date: runDate, verdicts, suites: Object.fromEntries([...ran].map(([f, r]) => [f, { exitCode: r.exitCode, passed: r.passed, failed: r.failed, notRun: r.notRun, differences: r.differences }])) }, null, 2)}\n`);

  io.print(`ads:certify on ${target.target} at ${git.sha.slice(0, 7)} (${runDate}) — evidence ${evidence}`);
  for (const v of verdicts) {
    io.print(`  ${v.verdict.padEnd(9)} ${v.worker}`);
    for (const w of v.why) io.print(`              ${w}`);
  }
  if (drafts.length > 0) {
    const gate = await load<Gate>("scripts/check-ads-readiness.mjs");
    const problems = gate.certificationProblems(drafts, registry.READINESS, registry.CAMPAIGN_WORKERS);
    writeFileSync(join(io.root, DRAFT), `${JSON.stringify({ "//": "DRAFT from pnpm ads:certify — copy each record into scripts/ads-certifications.json in a PR, with the evidence summary in its body; never commit this file.", certifications: drafts }, null, 2)}\n`);
    io.print(`  draft: ${drafts.length} record(s) in ${DRAFT}`);
    if (target.target === "fake") io.print("  a rehearsal: the readiness gate refuses these records, because an L4 run's target is the sandbox");
    else if (problems.length > 0) {
      for (const p of problems) io.print(`  the readiness gate refuses the draft: ${p}`);
      return 1;
    }
  }
  return verdicts.every((v) => v.verdict === "PASS") ? 0 : 1;
}

function realGit(): Git {
  const git = (...a: string[]) => spawnSync("git", a, { cwd: ROOT, encoding: "utf8" });
  git("fetch", "--quiet", "origin", "main");
  return {
    dirty: git("status", "--porcelain").stdout.split("\n").filter((l) => l.trim() !== ""),
    sha: git("rev-parse", "HEAD").stdout.trim(),
    onOriginMain: git("merge-base", "--is-ancestor", "HEAD", "origin/main").status === 0,
  };
}

export function runVitest(file: string, env: NodeJS.ProcessEnv, out: string): SuiteResult & { output: string } {
  const json = join(out, "vitest.json");
  // vitest's own CLI, resolved the way apps/api resolves it (pnpm hoists it; there may be no .bin here).
  const cli = join(dirname(createRequire(join(API_DIR, "package.json")).resolve("vitest/package.json")), "vitest.mjs");
  const r = spawnSync(process.execPath, [cli, "run", file, "--reporter=default", "--reporter=json", `--outputFile.json=${json}`], { cwd: API_DIR, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? `\nads:certify could not start vitest: ${r.error.message}\n` : ""}`;
  if (!existsSync(json)) return { exitCode: r.status ?? 1, passed: 0, failed: 1, notRun: 0, output };
  const j = JSON.parse(readFileSync(json, "utf8")) as { numPassedTests: number; numFailedTests: number; numPendingTests: number; numTodoTests: number };
  return { exitCode: r.status ?? 1, passed: j.numPassedTests, failed: j.numFailedTests, notRun: j.numPendingTests + j.numTodoTests, output };
}

async function realSandboxCheck(env: NodeJS.ProcessEnv): Promise<string | null> {
  const graph = new MetaGraph({ token: env.META_SANDBOX_TOKEN!, throttleKey: "ads-certify" });
  // The host's allowlist comes through the typed Env (envAds.ts) since the 2026-11-06 env split (#2115), parsed the
  // way the server parses it; the host's name still comes from the raw environment, as simulatorGate reads it.
  const v = await sandboxOnlyVerdict({ env: loadEnv(env), processEnv: env }, "meta", env.META_SANDBOX_AD_ACCOUNT_ID!, async () => graph);
  if (!v.ok) return v.message;
  // On a host simulatorGate reads as production, D-AD8 checks nothing (it answers yes unread); a
  // certification must be where the check runs, so that answer is a refusal here, not a pass.
  return v.checked ? null : "this machine reads as production to simulatorGate, where D-AD8 checks nothing — run it from a laptop or staging";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const io: CertifyIO = { root: ROOT, env: process.env, now: () => new Date(), git: realGit, runSuite: runVitest, checkSandboxAccount: realSandboxCheck, print: (l) => console.log(l) };
  process.exit(await certify(process.argv.slice(2), io));
}
