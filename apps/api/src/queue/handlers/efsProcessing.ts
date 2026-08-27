import { processEfsProcessingRun } from "../../modules/efs/services/efsProcessing.js";
import type { JobHandler } from "../types.js";

export const efsProcessingHandler: JobHandler = async (ctx, job) => {
  const processingId = typeof job.payload.processingId === "string" ? job.payload.processingId : null;
  if (!processingId) throw new Error("EFS processing job is missing processingId");
  return processEfsProcessingRun(ctx.admin, ctx.env, processingId);
};
