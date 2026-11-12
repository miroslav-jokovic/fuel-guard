import type { SupabaseClient } from "@supabase/supabase-js";
import { assistantToolsFor, assistantUnitKey, MODULE_KEYS, type ModuleSet } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { askData, type AskTrace } from "../askData.js";
import type { AssistantEvalCase } from "./assistantEvalSet.js";

/**
 * Scoring and running Ask AI's eval set (F21 R7). `scoreCase` is pure and is what the tests pin;
 * `runAssistantEval` asks the real model through `askData` itself, the endpoint's own loop, with the
 * tools the case's role would be given. It writes nothing: no `ai_assistant_usage`, no audit row, no
 * carrier budget. That is the route's work, and an eval is the developer's measurement, as `ads:eval`
 * is. Tool reads are real reads of the carrier named on the command line.
 */

export interface EvalVerdict {
  id: string;
  pass: boolean;
  /** Plain reasons, empty on a pass. */
  why: string[];
  tools: string[];
  outcome: AskTrace["outcome"];
  costMicroUsd: number;
  /**
   * Wall time of the whole answer, every round and tool read — what the route records as `latency_ms`
   * (`routes/ai.ts`). Set by the runner, not `scoreCase`: a clock is not a verdict. Streaming (Step 2d)
   * is built only if the median is over ~5 s (PLAN §6), and production has too few answers to say.
   */
  latencyMs?: number;
}

const ALL_MODULES = new Set(MODULE_KEYS) as ModuleSet;

/** The value matches: equal, or (an array) holding every expected item. Unit numbers compare as units. */
function inputMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    const have = new Set(actual.map((v) => assistantUnitKey(String(v))));
    return expected.every((e) => have.has(assistantUnitKey(String(e))));
  }
  return actual === expected;
}

export function scoreCase(c: AssistantEvalCase, trace: AskTrace): EvalVerdict {
  const why: string[] = [];
  const called = trace.tools.map((t) => t.name);
  if (trace.outcome !== "answered") why.push(`ended as ${trace.outcome}`);
  if (c.expectTools.length === 0) {
    if (called.length > 0) why.push(`called ${called.join(", ")} where no tool should be reachable`);
  } else {
    const hit = trace.tools.find((t) => !t.error && (c.expectTools as string[]).includes(t.name));
    if (!hit) {
      why.push(`expected ${c.expectTools.join(" or ")}, called ${called.join(", ") || "nothing"}`);
    } else if (c.expectInput) {
      const input = (hit.input ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(c.expectInput)) {
        if (!inputMatches(input[k], v)) why.push(`${hit.name}.${k} was ${JSON.stringify(input[k])}, expected ${JSON.stringify(v)}`);
      }
    }
  }
  for (const re of c.mustMention ?? []) if (!re.test(trace.answer)) why.push(`answer does not mention ${re}`);
  return { id: c.id, pass: why.length === 0, why, tools: called, outcome: trace.outcome, costMicroUsd: trace.usage.costMicroUsd };
}

export interface EvalRun {
  verdicts: EvalVerdict[];
  passed: number;
  total: number;
  costMicroUsd: number;
  /** Answer time across the cases, the measurement streaming waits on. */
  latency: { p50Ms: number; p90Ms: number; maxMs: number };
}

/** The value at a share of the sorted times, nearest rank (no interpolation: 23 answers, not a curve). */
export function latencyPercentile(ms: readonly number[], share: number): number {
  if (ms.length === 0) return 0;
  const sorted = [...ms].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))]!;
}

export async function runAssistantEval(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  cases: readonly AssistantEvalCase[],
  /**
   * Called after each case with its verdict and, SEPARATELY, the answer's text. The text is never on
   * the verdict: `--record` writes verdicts to `baseline.json`, which is committed, and this
   * repository is public — an answer carries the carrier's figures and its drivers' names. So the
   * text goes to the developer's terminal (`--answers`) and nowhere else.
   */
  onCase?: (v: EvalVerdict, answer: string) => void,
): Promise<EvalRun> {
  const verdicts: EvalVerdict[] = [];
  for (const c of cases) {
    const allowed = assistantToolsFor(c.role, null, ALL_MODULES);
    const started = Date.now();
    const trace = await askData(admin, env, orgId, c.question, allowed, new Date(), c.history ?? []);
    const v: EvalVerdict = { ...scoreCase(c, trace), latencyMs: Date.now() - started };
    verdicts.push(v);
    onCase?.(v, trace.answer);
  }
  return {
    verdicts,
    passed: verdicts.filter((v) => v.pass).length,
    total: verdicts.length,
    costMicroUsd: verdicts.reduce((n, v) => n + v.costMicroUsd, 0),
    latency: (() => {
      const ms = verdicts.map((v) => v.latencyMs ?? 0);
      return { p50Ms: latencyPercentile(ms, 0.5), p90Ms: latencyPercentile(ms, 0.9), maxMs: Math.max(0, ...ms) };
    })(),
  };
}
