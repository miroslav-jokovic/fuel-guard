import { z } from "zod";
import type { ForcedToolRequest } from "../../../lib/anthropic.js";

/**
 * What every model worker's fixtures and `ads:eval` share (workflow C2; §4R): the recording's shape and the eval
 * contract. Its own module so a worker that keeps its eval beside itself (the Researcher and the Swipe reader,
 * V2r) imports it without importing `agentFixtures.ts`, which imports every worker's eval — a cycle in which this
 * schema would be read before it was defined. `agentFixtures.ts` re-exports both, so no caller changed.
 */

export const recordingSchema = z.object({
  source: z.enum(["model", "planted"]),
  prompt_version: z.string(),
  model: z.string(),
  recorded_at: z.iso.datetime({ offset: true }),
  output: z.unknown(),
});

/** What `ads:eval` needs to ask and judge one worker, so it cannot ask differently from the worker. */
export interface EvalWorker<F, T> {
  promptVersion: string;
  dir: URL;
  parse: (raw: unknown) => F;
  name: (f: F) => string;
  source: (f: F) => "model" | "planted";
  /** May be async: the checker cuts its text band out of the image first. */
  request: (f: F) => ForcedToolRequest<T> | Promise<ForcedToolRequest<T>>;
  /** The verdict the worker would reach on `output`, in the fixture's `expect` vocabulary. */
  judge: (f: F, output: unknown) => { verdict: string; findings: string[] };
  /**
   * The worker's one second ask after a refusal of `output`, or null when the worker would stop (the Copywriter's
   * fit pass, CQ2). `ads:eval` asks it too, so the baseline measures the worker's whole behaviour, and records the
   * FINAL answer.
   */
  refine?: (f: F, output: unknown) => ForcedToolRequest<T> | null;
  withRecording: (f: F, recording: z.infer<typeof recordingSchema>) => F;
  /**
   * Whether a live verdict is the RIGHT one. Absent = it must be `ready` (a generator: every brief
   * deserves usable copy). A judge (the checker) is right when it refuses what was planted and passes
   * what was clean, so it supplies its own.
   */
  agrees?: (f: F, verdict: string, findings: string[]) => boolean;
}
