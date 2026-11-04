/**
 * `pnpm ads:eval <worker> [--record] [--json]` — ask the REAL model every fixture of one ads model worker
 * and report how often its answer is one the worker accepts (ADS-AGENT-BUILD-WORKFLOW §4R "Claude replay +
 * live eval"; required before a prompt or model version ships).
 *
 * The request and the verdict are the worker's own (`EVAL_WORKERS` in `modules/ads/workers/agentFixtures.ts`),
 * so this cannot ask differently from production. It is a developer's measurement, not a worker: it calls
 * the model with the developer's ANTHROPIC_API_KEY through `callForcedTool` directly — no org, no budget,
 * no `ad_generations` row — because there is no carrier whose month it should be billed to. It reads and
 * writes nothing but the fixture files.
 *
 * Planted fixtures (an answer a person wrote to plant a defect) are skipped: they say nothing about the
 * model. A model fixture is AGREED when the live answer reaches the verdict the worker needs — `ready` —
 * for its input (a recorded `refused` is a case the old model got wrong; the live model should do better).
 *
 * `--record` replaces each model fixture's recording with today's answer, keeping its `expect` honest by
 * setting it to the verdict that answer gets, and writes `baseline.json` beside the fixtures: prompt
 * version, model, the counts and the agreement. `lint:agent-fixtures` then holds every recording and the
 * baseline to the prompt version in force.
 *
 * stdout: one line per fixture, then one line of JSON summary (with `--json`, only that line).
 */
import { writeFileSync } from "node:fs";
import { loadEnv } from "../env.js";
import { anthropicClient, callForcedTool } from "../lib/anthropic.js";
import { EVAL_WORKERS, loadFixtures, type EvalWorker } from "../modules/ads/workers/agentFixtures.js";

export interface EvalSummary {
  worker: string;
  prompt_version: string;
  model: string;
  fixtures: number;
  asked: number;
  agreed: number;
  agreement: number;
  planted_skipped: number;
}

async function run<F, T>(name: string, w: EvalWorker<F, T>, record: boolean, json: boolean): Promise<EvalSummary> {
  const env = loadEnv(process.env);
  const client = anthropicClient(env);
  const all = loadFixtures(w);
  const asked = all.filter((x) => w.source(x.fixture) === "model");
  let agreed = 0;
  let model = "";
  for (const { file, fixture } of asked) {
    const req = w.request(fixture);
    model = req.model;
    const out = await callForcedTool(client, req);
    const output = out.kind === "ok" ? out.value : out.kind === "off_schema" ? out.raw : null;
    const { verdict, findings } = out.kind === "no_tool_use" ? { verdict: "off_schema", findings: [] } : w.judge(fixture, output);
    if (verdict === "ready") agreed += 1;
    if (!json) console.log(`${verdict === "ready" ? "✓" : "✗"} ${w.name(fixture)}  ${verdict}${findings.length ? ` (${findings.join(", ")})` : ""}`);
    if (record) {
      const next = w.withRecording(fixture, { source: "model", prompt_version: w.promptVersion, model: req.model, recorded_at: new Date().toISOString(), output });
      const withExpect = { ...(next as object), expect: verdict, ...(verdict === "refused" ? { expect_findings: findings } : { expect_findings: undefined }) };
      writeFileSync(file, `${JSON.stringify(withExpect, null, 2)}\n`);
    }
  }
  const summary: EvalSummary = {
    worker: name, prompt_version: w.promptVersion, model, fixtures: all.length, asked: asked.length, agreed,
    agreement: asked.length ? Math.round((agreed / asked.length) * 1000) / 1000 : 0,
    planted_skipped: all.length - asked.length,
  };
  if (record) writeFileSync(new URL("../baseline.json", w.dir), `${JSON.stringify({ ...summary, recorded_at: new Date().toISOString() }, null, 2)}\n`);
  console.log(JSON.stringify(summary));
  return summary;
}

const [workerName] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const worker = workerName ? (EVAL_WORKERS as Record<string, EvalWorker<unknown, unknown>>)[workerName] : undefined;
if (!worker) {
  console.error(`usage: pnpm ads:eval <${Object.keys(EVAL_WORKERS).join("|")}> [--record] [--json]`);
  process.exit(2);
}
await run(workerName!, worker, process.argv.includes("--record"), process.argv.includes("--json"));
