import type { JobHandler } from "../types.js";
import { splitStack } from "../../modules/evidence/index.js";
import { intakeStoredBytes } from "../../modules/document-reading/index.js";

/**
 * `paper_intake_split` — cut one scanned stack of paper driver files at its cover sheets
 * (DRIVER-PAPER-INTAKE-PLAN PI2). Payload `{ stackId, requestedBy }`, written by
 * `POST /api/compliance/paper-intake/stacks/:id/complete`.
 *
 * IDEMPOTENT: `splitStack` leaves a `split` or `failed` stack as it is and redoes any other from its
 * original bytes. A file that cannot be split is a RESULT (the stack ends `failed` with the reason the
 * page shows), never a throw: retrying a password-protected PDF would open nothing five times.
 */
export const paperIntakeSplitHandler: JobHandler = async (ctx, job) => {
  const stackId = typeof job.payload.stackId === "string" ? job.payload.stackId : "";
  if (!stackId) throw new Error("paper_intake_split job has no stackId");
  const requestedBy = typeof job.payload.requestedBy === "string" ? job.payload.requestedBy : null;
  // Each piece goes to the reader under the `compliance_paper` profile (PI3); the reader's own intake job
  // renders it, and its read lands where `readOfBytes` finds it by the piece's bytes.
  const queueRead = async (bytes: Buffer) => {
    const queued = await intakeStoredBytes(ctx.admin, ctx.env, job.org_id, { bytes, profile: "compliance_paper", requestedBy });
    if (!queued.ok) throw new Error(`could not queue a piece for reading: ${queued.error}`);
  };
  return { ...(await splitStack(ctx.admin, job.org_id, stackId, { queueRead })) };
};
