import express, { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { pgQueueDriver } from "../../../queue/pgDriver.js";
import { receiveTenstreetPost, tenstreetProcessDedupKey, TENSTREET_WEBHOOK_PATH } from "../tenstreet/receive.js";
import { TENSTREET_MAX_BYTES } from "../tenstreet/tenstreetXml.js";

/**
 * `/api/webhooks/tenstreet/:key` (TENSTREET-INTAKE-PLAN TS3) — public like Meta's receiver: no user auth, the URL's
 * secret and the body's Company ID are the authentication (`receive.ts`). Tenstreet posts `text/xml` UTF-8; this
 * route's own text parser is mounted at its path BEFORE the app's JSON parser (`appHttp.ts`'s order rule), so the
 * body arrives as the string Tenstreet sent. A body of another type reaches `receive.ts` as nothing and is refused
 * there as not XML. Every post becomes a durable row first; the job runs after the answer (`kick`), as Meta's do.
 */
export { TENSTREET_WEBHOOK_PATH };

export interface TenstreetWebhookDeps {
  admin?: (env: Env) => SupabaseClient;
  kick: (env: Env, admin: SupabaseClient, n: number) => Promise<unknown>;
}

export function tenstreetWebhookRouter(deps: TenstreetWebhookDeps): Router {
  const router = Router();
  const openAdmin = deps.admin ?? getSupabaseAdmin;
  router.post(
    "/:key",
    // A little over the parser's own 2 MB, so an oversize body reaches it and is answered REJECTED by name.
    express.text({ type: ["text/xml", "application/xml"], limit: TENSTREET_MAX_BYTES + 64 * 1024 }),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = openAdmin(env);
      const driver = pgQueueDriver(admin);
      const a = await receiveTenstreetPost({
        env, admin,
        enqueue: async (orgId, postId) => {
          const r = await driver.enqueue("tenstreet_post_process", { orgId, payload: { postId }, dedupKey: tenstreetProcessDedupKey(postId) });
          return "conflict" in r ? "conflict" : "queued";
        },
      }, String(req.params.key ?? ""), typeof req.body === "string" ? req.body : undefined);
      res.status(a.status);
      if (a.body) res.type("text/xml").send(a.body);
      else res.end();
      if (a.queued) void deps.kick(env, admin, 1).catch(() => {});
    }),
  );
  return router;
}
