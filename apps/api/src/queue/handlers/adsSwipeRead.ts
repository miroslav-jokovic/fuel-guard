import { z } from "zod";
import { recordId } from "@silvicom/shared";
import { anthropicClient } from "../../lib/anthropic.js";
import { readSwipeEntry } from "../../modules/ads/index.js";
import type { JobHandler } from "../types.js";

/**
 * One swipe-file entry read (ADS-PLATFORM-V2-PLAN V2r; `modules/ads/research/swipeFile.ts`). Idempotent: the read
 * writes only onto the same attempt of a `waiting` entry, and the model call replays under its key
 * (`swipe:<entry>:<attempt>`), so a second delivery costs nothing. A call still in flight THROWS, so the queue's
 * retry is the wait; every other ending is written on the entry in words the office reads.
 */
const payload = z.object({ entryId: recordId() });

export const adsSwipeReadHandler: JobHandler = async (ctx, job) => {
  const { entryId } = payload.parse(job.payload);
  const out = await readSwipeEntry({ admin: ctx.admin, client: anthropicClient(ctx.env), now: () => new Date() }, job.org_id, entryId);
  if (out.kind === "pending") throw new Error(`ads_swipe_read: ${out.why}`);
  return { ok: out.kind !== "unreadable", detail: `${out.kind}: ${out.detail}` };
};
