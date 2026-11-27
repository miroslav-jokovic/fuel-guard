import { processTenstreetPost } from "../../modules/recruiting/index.js";
import type { JobHandler } from "../types.js";
import { leadRecipientsFor } from "./leadSinkFor.js";

/**
 * One kept Tenstreet post becomes a lead (TENSTREET-INTAKE-PLAN TS3). Who hears a new lead is an ads setting and
 * recruiting may not import ads (D-AD17), so the recipients cross here, as for Meta's leads. A store or database
 * fault throws and the queue retries; an unreadable post is marked and done (`processPost.ts`).
 */
export const tenstreetPostProcessHandler: JobHandler = async (ctx, job) => {
  const postId = (job.payload as { postId?: unknown } | null)?.postId;
  if (typeof postId !== "string" || !postId) throw new Error("tenstreet_post_process: payload.postId is required");
  const r = await processTenstreetPost({ admin: ctx.admin, env: ctx.env, configured: leadRecipientsFor(ctx.admin) }, job.org_id, postId);
  return { ok: true, detail: JSON.stringify(r) };
};
