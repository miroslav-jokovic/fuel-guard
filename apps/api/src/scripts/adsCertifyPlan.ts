import { EVENTS_SANDBOX_VARIABLES, SANDBOX_VARIABLES } from "../modules/ads/platforms/meta/contract/metaTarget.js";

/**
 * What `pnpm ads:certify` runs for each worker's L4, and the pure half of the command (stage2-kit): which
 * workers, whether it may run, what a run's verdict is, and the draft record a PASS becomes. The command
 * itself (`adsCertify.ts`) only does the I/O around these.
 *
 * Each worker's run is its registry L4 need (scripts/ads-readiness.registry.mjs) made concrete: the suites
 * that ARE that need on `ADS_TARGET=sandbox`, and the variables they read. A need with no suite yet is
 * `unbuilt`, with the exact thing missing — the command says it and certifies nothing, never a substitute.
 * `adsCertify.test.ts` holds this table to the registry's worker names, so a worker added there without a
 * run here fails a test rather than being skipped by `all`.
 */

const CONTRACT = "src/modules/ads/platforms/meta/publisher.contract.test.ts";
const GRAPH_READINGS = "src/modules/ads/platforms/meta/contract/readings.contract.test.ts";
const EVENTS_READINGS = "src/modules/ads/outcomes/outcomeReadings.contract.test.ts";
const ORCHESTRATOR = "src/modules/ads/orchestrator/orchestrator.contract.test.ts";
const MONITOR = "src/modules/ads/monitor/monitor.contract.test.ts";
const LEAD_INTAKE = "src/modules/ads/leads/leadIntake.contract.test.ts";

/** D-AD8 (guard/sandboxOnly.ts): the machine's own allowlist the sandbox account must be on. */
const ALLOWLIST = "META_SANDBOX_AD_ACCOUNT_IDS";

export type WorkerRun =
  | { suites: readonly string[]; vars: readonly string[]; platform?: string; scrape?: boolean }
  | { unbuilt: string };

export const WORKER_RUNS: Readonly<Record<string, WorkerRun>> = {
  // stage2-kit-2c: the runner and machine with the real publisher on the target — created paused, half-made,
  // resumed, read back, deleted and read back deleted.
  "Orchestrator": { suites: [ORCHESTRATOR], vars: [...SANDBOX_VARIABLES, ALLOWLIST] },
  "Budget guard": { unbuilt: "its L4 is the guard over the sandbox account's real spend_cap and amount_spent; its code is Track G's (modules/ads/guard/), so the suite is theirs to write" },
  "Publisher (per adapter)": { suites: [CONTRACT, GRAPH_READINGS], vars: [...SANDBOX_VARIABLES, ALLOWLIST], platform: "meta" },
  "Monitor": { suites: [MONITOR], vars: [...SANDBOX_VARIABLES, ALLOWLIST] },
  // The lead is the one the owner makes with Meta's Lead Ads Testing Tool on the sandbox Page.
  "Lead intake": { suites: [LEAD_INTAKE], vars: [...SANDBOX_VARIABLES, "META_SANDBOX_LEAD_ID", ALLOWLIST] },
  "Outcome feed": { suites: [EVENTS_READINGS], vars: [...SANDBOX_VARIABLES, ...EVENTS_SANDBOX_VARIABLES, ALLOWLIST] },
  "Copywriter": { unbuilt: "its L4 is ads made from its live answers, English and Spanish, created on the sandbox without refusal; publisher.contract.test.ts sends fixed copy, and the run carrying live answers (ANTHROPIC_API_KEY) is stage2-kit 2b" },
  "Art director": { unbuilt: "its L4 is its live prompts rendered by the real Higgsfield API, each picture passing the no-lettering check; that run (and FakeHiggsfield's recorded readings) is stage2-kit 2b, and it needs the owner's Higgsfield key (Q-AD20)" },
  "Checker": { unbuilt: "its L4 is the planted-defect corpus on real Higgsfield renders at the owner's recall threshold; its threshold is the owner's number in workers/checker/baseline.json (Q-AD45, ruled (a)), not set yet; the run is stage2-kit 2b" },
  "Analyst": { unbuilt: "its L4 is a live brief over a sandbox day's real hourly insights, read by the Monitor's sandbox pull (built, stage2-kit-2c); the run is stage2-kit 2b" },
  "Craft judge": { unbuilt: "its L4 is its ranking over the Copywriter's live candidates on a sandbox run, the chosen copy created on Meta without refusal; the run rides the Copywriter's (stage2-kit 2b), and its L3 waits on the owner's rating sheet (Q-AD57)" },
  "Renderer / Higgsfield client": { unbuilt: "its L4 is renders on a small real Higgsfield budget, with FakeHiggsfield's OUR readings (higgsfieldClient.ts) recorded and diffed; stage2-kit 2b, and it needs the owner's Higgsfield key (Q-AD20)" },
  // Its need is "a token scrape over the sandbox run's logs": the Publisher's run, every byte it printed
  // searched for each secret it was given.
  "Security (all)": { suites: [CONTRACT, GRAPH_READINGS], vars: [...SANDBOX_VARIABLES, ALLOWLIST], scrape: true },
};

/** The variables whose VALUES must never appear in a run's output (Security's scrape). */
export const SECRET_VARIABLES = ["META_SANDBOX_TOKEN", "META_SANDBOX_PAGE_TOKEN"] as const;

export type Target = "fake" | "sandbox";

export interface Git {
  /** `git status --porcelain` lines; untracked and modified both count. */
  dirty: string[];
  sha: string;
  /** HEAD is origin/main or an ancestor of it: what ran is what main holds. */
  onOriginMain: boolean;
}

/** `all`, or one registry worker by its exact name. */
export function selectWorkers(arg: string | undefined, registry: readonly string[]): { workers: string[] } | { refusal: string } {
  if (arg === "all") return { workers: [...registry] };
  if (arg && registry.includes(arg)) return { workers: [arg] };
  return { refusal: `name a worker or all: ${registry.map((w) => JSON.stringify(w)).join(", ")}` };
}

export function targetOf(flag: string | undefined, env: NodeJS.ProcessEnv): { target: Target } | { refusal: string } {
  const t = flag ?? env.ADS_TARGET;
  if (flag && env.ADS_TARGET && flag !== env.ADS_TARGET) return { refusal: `--target ${flag} and ADS_TARGET=${env.ADS_TARGET} disagree` };
  if (t === "fake" || t === "sandbox") return { target: t };
  return { refusal: `the target is --target sandbox (a certification) or fake (a rehearsal, certifies nothing); got ${t ?? "none"}` };
}

/**
 * Every reason the run may not start. A rehearsal on the fake skips the tree checks — it writes a draft no
 * gate accepts (its target is not the sandbox). A certification needs a clean tree on main, so the sha it
 * records is the code that ran, and every variable each built worker reads, named per worker.
 */
export function preflight(target: Target, workers: readonly string[], env: NodeJS.ProcessEnv, git: Git): string[] {
  const out: string[] = [];
  if (target === "sandbox") {
    if (git.dirty.length > 0) out.push(`the tree is not clean (${git.dirty.length} path(s): ${git.dirty.slice(0, 5).join("; ")}) — a certification records HEAD's sha, so it runs on exactly what is committed`);
    if (!git.onOriginMain) out.push(`HEAD ${git.sha.slice(0, 7)} is not on origin/main — certify what main holds (git fetch; git switch --detach origin/main)`);
    for (const w of workers) {
      const run = WORKER_RUNS[w];
      if (!run || "unbuilt" in run) continue;
      const missing = run.vars.filter((v) => !env[v]);
      if (missing.length > 0) out.push(`${w} needs ${missing.join(", ")}`);
    }
  }
  return out;
}

export interface SuiteResult {
  exitCode: number;
  passed: number;
  failed: number;
  /** Skipped or todo: a certification run is every test, run. */
  notRun: number;
}

export type Verdict = { worker: string; verdict: "PASS" | "FAIL" | "NOT BUILT"; why: string[] };

/** One worker's verdict from its suites' results, the readings' differences and (Security) the scrape. */
export function verdictOf(worker: string, results: readonly SuiteResult[], differences: readonly string[], leaks: readonly string[] = []): Verdict {
  const why: string[] = [];
  for (const r of results) {
    if (r.exitCode !== 0 || r.failed > 0) why.push(`${r.failed} test(s) failed (exit ${r.exitCode})`);
    if (r.notRun > 0) why.push(`${r.notRun} test(s) not run`);
    if (r.passed === 0) why.push("no test passed — a suite that ran nothing certifies nothing");
  }
  why.push(...differences, ...leaks);
  return { worker, verdict: why.length === 0 ? "PASS" : "FAIL", why };
}

/** Every secret VALUE found in the run's output, by variable name only (the value is never printed). */
export function scrape(output: string, env: NodeJS.ProcessEnv): string[] {
  return SECRET_VARIABLES.filter((v) => (env[v] ?? "").length >= 8 && output.includes(env[v]!)).map((v) => `the value of ${v} appears in the run's output`);
}

export interface DraftRecord { worker: string; platform?: string; level: "L4"; target: Target; run_date: string; sha: string; result: "pass"; evidence: string }

/** The draft a PASS becomes; a person commits it into scripts/ads-certifications.json in a PR. */
export function draftRecord(worker: string, target: Target, sha: string, runDate: string, evidence: string): DraftRecord {
  const run = WORKER_RUNS[worker];
  const platform = run && "platform" in run ? run.platform : undefined;
  return { worker, ...(platform ? { platform } : {}), level: "L4", target, run_date: runDate, sha, result: "pass", evidence };
}

/** The run's date in Central time, the zone every ads date is kept in. */
export const centralDate = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
