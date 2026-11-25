import { transcodeVersion } from "../../modules/training/index.js";
import type { JobHandler } from "../types.js";

/**
 * `training_transcode` — make the phone versions and the poster of one uploaded safety film
 * (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS §8.2). Payload `{ versionId }`, written by
 * `POST /api/training/versions/:id/uploaded`.
 *
 * IDEMPOTENT (plan Q9): a version no longer `processing` is skipped, and a refusal (not a video, the
 * bytes changed, ffmpeg missing) is recorded on the version as its reason — a RESULT, never a throw,
 * because re-reading a file that is not a video reads nothing five times.
 */
export const trainingTranscodeHandler: JobHandler = async (ctx, job) => {
  const versionId = typeof job.payload.versionId === "string" ? job.payload.versionId : "";
  if (!versionId) throw new Error("training_transcode job has no versionId");
  return { ...(await transcodeVersion(ctx.admin, job.org_id, versionId)) };
};
