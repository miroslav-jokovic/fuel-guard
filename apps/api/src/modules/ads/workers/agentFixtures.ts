import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import { adBriefSchema, adPresetRecipeSchema } from "@silvicom/shared";
import type { ForcedToolRequest } from "../../../lib/anthropic.js";
import { COPYWRITER_PROMPT_VERSION, buildCopyRequest, judgeCopy, type AdCopy } from "./copywriter/copywriter.js";

/**
 * The model workers' fixtures (workflow C2; §4R "Claude replay + live eval"). One JSON file per case in
 * `workers/<worker>/fixtures/`, read by two things that must agree on what a case is:
 *   · the replay test (CI, every PR): the RECORDED output goes through the worker, through the real rail,
 *     with a client that answers the recording — deterministic and free — and must reach `expect`;
 *   · `pnpm ads:eval <worker>`: asks the real model the same request and judges its answer the same way,
 *     reporting how often the live model is right; `--record` stores its answers as the new recordings.
 * `lint:agent-fixtures` holds the files to this shape without running TypeScript (see that script).
 *
 * ── TWO KINDS OF RECORDING, LABELLED ───────────────────────────────────────────────────────────────
 * `source: "model"` — what the model answered for `input`, recorded by `ads:eval --record` under the
 * prompt version in force; the gate refuses one recorded under an older prompt, so a prompt change is a
 * re-record in the same PR. `source: "planted"` — an answer written by a person to plant a defect (an
 * invented figure, a promise the brief does not make) and prove the judge refuses it. A planted answer
 * is never presented as the model's, and `ads:eval` skips it: it says nothing about the model.
 */

export const recordingSchema = z.object({
  source: z.enum(["model", "planted"]),
  prompt_version: z.string(),
  model: z.string(),
  recorded_at: z.iso.datetime({ offset: true }),
  output: z.unknown(),
});

export const copywriterFixtureSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
  about: z.string().min(10),
  input: z.object({ brief: adBriefSchema, recipe: adPresetRecipeSchema }),
  /** What the worker must answer for the RECORDED output. */
  expect: z.enum(["ready", "refused", "off_schema"]),
  /** For `refused`: the finding kinds, sorted, exactly. */
  expect_findings: z.array(z.string()).optional(),
  recorded: recordingSchema,
}).strict();
export type CopywriterFixture = z.infer<typeof copywriterFixtureSchema>;

/** What `ads:eval` needs to ask and judge one worker, so it cannot ask differently from the worker. */
export interface EvalWorker<F, T> {
  promptVersion: string;
  dir: URL;
  parse: (raw: unknown) => F;
  name: (f: F) => string;
  source: (f: F) => "model" | "planted";
  request: (f: F) => ForcedToolRequest<T>;
  /** The verdict the worker would reach on `output`, in the fixture's `expect` vocabulary. */
  judge: (f: F, output: unknown) => { verdict: string; findings: string[] };
  withRecording: (f: F, recording: z.infer<typeof recordingSchema>) => F;
}

export const COPYWRITER_EVAL: EvalWorker<CopywriterFixture, AdCopy> = {
  promptVersion: COPYWRITER_PROMPT_VERSION,
  dir: new URL("./copywriter/fixtures/", import.meta.url),
  parse: (raw) => copywriterFixtureSchema.parse(raw),
  name: (f) => f.name,
  source: (f) => f.recorded.source,
  request: (f) => buildCopyRequest(f.input.brief, f.input.recipe),
  judge: (f, output) => {
    const parsed = buildCopyRequest(f.input.brief, f.input.recipe).tool.schema.safeParse(output);
    if (!parsed.success) return { verdict: "off_schema", findings: [] };
    const v = judgeCopy(parsed.data, f.input.brief, f.input.recipe);
    return v.ok ? { verdict: "ready", findings: [] } : { verdict: "refused", findings: [...new Set(v.findings.map((x) => x.kind))].sort() };
  },
  withRecording: (f, recorded) => ({ ...f, recorded }),
};

export const EVAL_WORKERS = { copywriter: COPYWRITER_EVAL } as const;

/** Every fixture of a worker, parsed, in file-name order; a file whose `name` is not its file name throws. */
export function loadFixtures<F, T>(w: EvalWorker<F, T>): Array<{ file: URL; fixture: F }> {
  return readdirSync(w.dir).filter((n) => n.endsWith(".json")).sort().map((n) => {
    const file = new URL(n, w.dir);
    const fixture = w.parse(JSON.parse(readFileSync(file, "utf8")));
    if (`${w.name(fixture)}.json` !== n) throw new Error(`${n}: its name is "${w.name(fixture)}"`);
    return { file, fixture };
  });
}
