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
 * A judge says what "right" is itself (`EvalWorker.agrees`): the checker agrees when it refuses the defect
 * an image was made to carry and passes a clean one (C5a), so its agreement IS its recall on the corpus.
 *
 * `--record` replaces each model fixture's recording with today's answer, keeping its `expect` honest by
 * setting it to the verdict that answer gets, and writes `baseline.json` beside the fixtures: prompt
 * version, model, the counts and the agreement. `lint:agent-fixtures` then holds every recording and the
 * baseline to the prompt version in force.
 *
 * stdout: one line per fixture, then one line of JSON summary (with `--json`, only that line).
 */
import { readFileSync, writeFileSync } from "node:fs";
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

async function run<F, T>(name: string, w: EvalWorker<F, T>, record: boolean, json: boolean, only: string | null): Promise<EvalSummary> {
  const env = loadEnv(process.env);
  const client = anthropicClient(env);
  const all = loadFixtures(w);
  const models = all.filter((x) => w.source(x.fixture) === "model");
  // `--only <prefix>` asks just the fixtures whose name starts with it: a new set recorded without paying to re-ask
  // the rest (the owner approves each recording by its size). See `mergedBaseline` for what it does to the baseline.
  const asked = only ? models.filter((x) => w.name(x.fixture).startsWith(only)) : models;
  if (only && asked.length === 0) throw new Error(`--only ${only}: no model fixture's name starts with it`);
  let agreed = 0;
  let model = "";
  for (const { file, fixture } of asked) {
    const req = await w.request(fixture);
    model = req.model;
    let out = await callForcedTool(client, req);
    let output = out.kind === "ok" ? out.value : out.kind === "off_schema" ? out.raw : null;
    let fitted = false;
    // The worker's one second ask, when it would make one (the Copywriter's fit pass): the recording is the final answer.
    const again = out.kind === "ok" && w.refine ? w.refine(fixture, output) : null;
    if (again) {
      out = await callForcedTool(client, again);
      output = out.kind === "ok" ? out.value : out.kind === "off_schema" ? out.raw : null;
      fitted = true;
    }
    const { verdict, findings } = out.kind === "no_tool_use" ? { verdict: "off_schema", findings: [] } : w.judge(fixture, output);
    const right = w.agrees ? w.agrees(fixture, verdict, findings) : verdict === "ready";
    if (right) agreed += 1;
    if (!json) console.log(`${right ? "✓" : "✗"} ${w.name(fixture)}  ${verdict}${findings.length ? ` (${findings.join(", ")})` : ""}${fitted ? "  [after the fit pass]" : ""}`);
    // A disagreement is only actionable with the words in front of you: `EVAL_SHOW=1` prints the model's answer
    // for each one (never recorded, never on by default — the answer may be long).
    if (!right && process.env.EVAL_SHOW) console.log(JSON.stringify(output, null, 2));
    if (record) {
      const next = w.withRecording(fixture, { source: "model", prompt_version: w.promptVersion, model: req.model, recorded_at: new Date().toISOString(), output });
      const withExpect = { ...(next as object), expect: verdict, ...(verdict === "refused" ? { expect_findings: findings } : { expect_findings: undefined }) };
      // A judge's "findings" are its ranking, not a finding list; they are read by `agrees`, never stored.
      writeFileSync(file, `${JSON.stringify(withExpect, null, 2)}\n`);
    }
  }
  const summary: EvalSummary = {
    worker: name, prompt_version: w.promptVersion, model, fixtures: all.length, asked: asked.length, agreed,
    agreement: asked.length ? Math.round((agreed / asked.length) * 1000) / 1000 : 0,
    planted_skipped: all.length - models.length,
  };
  const baselineFile = new URL("../baseline.json", w.dir);
  if (record) {
    const body = only ? mergedBaseline(JSON.parse(readFileSync(baselineFile, "utf8")), summary, models.length, only) : { ...summary, recorded_at: new Date().toISOString() };
    writeFileSync(baselineFile, `${JSON.stringify(body, null, 2)}\n`);
  }
  console.log(JSON.stringify(summary));
  return summary;
}

/**
 * A partial recording's baseline: the earlier baseline's counts plus this run's, so `lint:agent-fixtures` still
 * sees a baseline over exactly these fixtures. Honest only when the earlier one measured every OTHER model fixture
 * under the same prompt and model, so anything else is refused and the whole set must be re-recorded instead. The
 * parts are kept, so the two runs' dates and agreements stay readable apart.
 */
function mergedBaseline(prior: Record<string, unknown> & EvalSummary, run: EvalSummary, models: number, only: string) {
  if (prior.prompt_version !== run.prompt_version || prior.model !== run.model) {
    throw new Error(`--only: baseline.json is ${prior.prompt_version} on ${prior.model}; this run is ${run.prompt_version} on ${run.model} — re-record the whole set`);
  }
  type Part = EvalSummary & { parts?: unknown };
  const before: Part[] = (prior.parts as Part[] | undefined) ?? [{ ...prior, parts: undefined }];
  if (prior.asked + run.asked !== models) {
    throw new Error(`--only: baseline.json asked ${prior.asked}, this run ${run.asked}, but there are ${models} model fixtures — re-record the whole set`);
  }
  const asked = prior.asked + run.asked;
  const agreed = prior.agreed + run.agreed;
  return {
    worker: run.worker, prompt_version: run.prompt_version, model: run.model, fixtures: run.fixtures, asked, agreed,
    agreement: Math.round((agreed / asked) * 1000) / 1000, planted_skipped: run.planted_skipped,
    recorded_at: new Date().toISOString(),
    parts: [...before.map(({ parts: _p, ...rest }) => rest), { ...run, only, recorded_at: new Date().toISOString() }],
  };
}

const [workerName] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const worker = workerName ? (EVAL_WORKERS as Record<string, EvalWorker<unknown, unknown>>)[workerName] : undefined;
if (!worker) {
  console.error(`usage: pnpm ads:eval <${Object.keys(EVAL_WORKERS).join("|")}> [--record] [--json]`);
  process.exit(2);
}
const onlyAt = process.argv.indexOf("--only");
const only = onlyAt >= 0 ? (process.argv[onlyAt + 1] ?? "") : null;
if (only === "") {
  console.error("--only needs a fixture-name prefix");
  process.exit(2);
}
await run(workerName!, worker, process.argv.includes("--record"), process.argv.includes("--json"), only);
