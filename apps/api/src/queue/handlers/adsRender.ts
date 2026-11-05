import { renderClientFor, renderInputFromPayload, renderStep } from "../../modules/ads/index.js";
import type { JobHandler } from "../types.js";

/**
 * One Higgsfield render moved one step (C3; `modules/ads/creative/higgsfield/render.ts`). Idempotent by the
 * render's key, so the queue's at-least-once delivery and retries cost nothing: a `started` row is
 * submitted again under the same Idempotency-Key, which Higgsfield answers with the original request.
 *
 * Not finished yet (`pending`) THROWS, so the queue retries with its backoff — that is the poll. When the
 * attempts run out the row stays `started`, and the next job for the same creative (the compose step, C5)
 * picks it up where it was, at no cost. A refusal or a finished render completes the job with its answer.
 */
export const adsRenderHandler: JobHandler = async (ctx, job) => {
  const input = renderInputFromPayload(job.org_id, job.payload);
  const renderer = await renderClientFor(ctx.admin, ctx.env, job.org_id, input.model);
  if (!renderer.ok) return { ok: false, detail: `higgsfield ${renderer.reason}` };
  const out = await renderStep({ admin: ctx.admin, client: renderer.client, now: () => new Date(), prices: renderer.prices }, input);
  if (out.kind === "pending") throw new Error(`ads_render: still rendering (${out.why})`);
  return { ok: out.kind === "stored", detail: JSON.stringify(out) };
};
