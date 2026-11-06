import type { JobHandler } from "../types.js";
import { splitStack } from "../../modules/evidence/index.js";

/**
 * `paper_intake_split` — cut one scanned stack of paper driver files at its cover sheets
 * (DRIVER-PAPER-INTAKE-PLAN PI2). Payload `{ stackId }`, written by
 * `POST /api/compliance/paper-intake/stacks/:id/complete`.
 *
 * IDEMPOTENT: `splitStack` leaves a `split` or `failed` stack as it is and redoes any other from its
 * original bytes. A file that cannot be split is a RESULT (the stack ends `failed` with the reason the
 * page shows), never a throw: retrying a password-protected PDF would open nothing five times.
 */
export const paperIntakeSplitHandler: JobHandler = async (ctx, job) => {
  const stackId = typeof job.payload.stackId === "string" ? job.payload.stackId : "";
  if (!stackId) throw new Error("paper_intake_split job has no stackId");
  return { ...(await splitStack(ctx.admin, job.org_id, stackId)) };
};
