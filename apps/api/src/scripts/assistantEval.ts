/**
 * `pnpm --filter @silvicom/api eval:assistant --org <uuid> [--only id,id] [--answers] [--record]` — ask Ask AI's
 * eval set of the REAL model, over one carrier's REAL data, and say how many it gets right (F21 R7,
 * PLAN Step 1c). Never in CI.
 *
 * ── WHAT IT COSTS AND TOUCHES ────────────────────────────────────────────────────────────────────
 * The developer's ANTHROPIC_API_KEY, at Haiku 5.5's list price, about $0.002 an answer, so about $0.05
 * for the whole set. The carrier's data is READ through each tool, with the service role of the
 * `.env` it runs with (`apps/api/.env` points at PRODUCTION), and sent to the model provider exactly
 * as an Ask AI answer would send it. Nothing is written to the database: no usage row, no audit row,
 * no budget spent. `--org` is required so nobody runs it against a carrier by default.
 *
 * `--record` writes `eval/baseline.json` (model, date, score, each case's verdict) so the next run,
 * after a prompt, tool-description or model change, can be compared with it.
 *
 * `--answers` prints each answer's text under its line, so a failure can be read before anything is
 * tuned: "called nothing" is a refusal, a question back, or a made-up number, and the fix differs
 * (PLAN §6, the first baseline, 2026-11-11). The text goes to this terminal ONLY, never into
 * `baseline.json`: that file is committed and the repository is public (`runAssistantEval`'s `onCase`).
 *
 * stdout: one line per case, then the score and the cost.
 */
import { writeFileSync } from "node:fs";
import { AI_MODELS } from "@silvicom/shared";
import { loadEnv } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { ASSISTANT_EVAL_SET } from "../modules/insights/eval/assistantEvalSet.js";
import { runAssistantEval } from "../modules/insights/eval/assistantEval.js";

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

const orgId = arg("org");
if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) {
  console.error("Usage: eval:assistant --org <org uuid> [--only id,id] [--answers] [--record]");
  process.exit(2);
}
const only = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const cases = only ? ASSISTANT_EVAL_SET.filter((c) => only.includes(c.id)) : ASSISTANT_EVAL_SET;
if (cases.length === 0) {
  console.error(`No case matches --only ${only?.join(",")}`);
  process.exit(2);
}

const env = loadEnv(process.env);
if (!env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set.");
  process.exit(2);
}

const showAnswers = process.argv.includes("--answers");
const run = await runAssistantEval(getSupabaseAdmin(env), env, orgId, cases, (v, answer) => {
  console.log(`${v.pass ? "✓" : "✗"} ${v.id}  [${v.tools.join(", ") || "no tool"}] ${((v.latencyMs ?? 0) / 1000).toFixed(1)}s${v.why.length ? `  — ${v.why.join("; ")}` : ""}`);
  for (const s of v.searches ?? []) console.log(`    ⌕ the API's own tool search ${s}`);
  if (showAnswers) console.log(`${answer.replace(/^/gm, "    │ ")}\n`);
});
const dollars = (run.costMicroUsd / 1_000_000).toFixed(4);
console.log(`\n${run.passed}/${run.total} passed, ${AI_MODELS.assistant}, $${dollars}`);
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
console.log(`answer time: median ${sec(run.latency.p50Ms)}, p90 ${sec(run.latency.p90Ms)}, slowest ${sec(run.latency.maxMs)}`);
console.log(`first streamed event: median ${sec(run.latency.firstEventP50Ms)}, p90 ${sec(run.latency.firstEventP90Ms)}`);

if (process.argv.includes("--record")) {
  const baseline = { model: AI_MODELS.assistant, recordedAt: new Date().toISOString(), passed: run.passed, total: run.total, costUsd: Number(dollars), latency: run.latency, verdicts: run.verdicts };
  writeFileSync(new URL("../modules/insights/eval/baseline.json", import.meta.url), `${JSON.stringify(baseline, null, 2)}\n`);
  console.log("Recorded eval/baseline.json");
}
