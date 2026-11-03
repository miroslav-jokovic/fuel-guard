import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { pgQueueDriver } from "../../../queue/pgDriver.js";
import type { QueueDriver } from "../../../queue/types.js";
import { adsLeadFetchDedupKey, answerSubscribe, receiveLeadgenDelivery, SIGNATURE_HEADER, type LeadFetchEnqueue } from "../leads/leadgenWebhook.js";

/**
 * `/api/webhooks/meta` (B4b) — mounted public, like Samsara's and Telnyx's receivers: no user auth, the
 * signature is the authentication. Everything it decides is in `leads/leadgenWebhook.ts`; this file only
 * hands it the RAW bytes `appHttp.ts` captured (never `JSON.stringify(req.body)` — see the SMS receiver in
 * `routes/webhooks.ts` for why there is no fallback) and the queue.
 *
 * ── WHY THE QUEUE DRIVER, NOT `dispatchJob` ────────────────────────────────────────────────────────────
 * In `JOB_EXECUTION_MODE=inprocess` (production's mode, `queue/inprocessDrain.ts`), `dispatchJob` runs the
 * handler INLINE — here that would be a Graph read per lead inside Meta's request, and a 1000-lead batch
 * past Meta's patience. So every lead becomes a durable `queued` row first; the 200 then means "held",
 * and only after it is sent does this process run those rows (`drainKindNow`). In queue mode the consumer
 * runs them and the kick does nothing.
 *
 * The kick is handed in by the composition root (`app.ts`), not imported: `queue/inprocessDrain.ts` loads
 * every job handler, one of which loads this module, so importing it here would be a cycle.
 */
export interface MetaWebhookDeps {
  /** Injectable for tests; production opens the service-role client and the real queue. */
  admin?: (env: Env) => SupabaseClient;
  enqueue?: (admin: SupabaseClient) => LeadFetchEnqueue;
  /** Run up to `n` queued `ads_lead_fetch` rows in this process, after the answer is sent. */
  kick: (env: Env, admin: SupabaseClient, n: number) => Promise<unknown>;
}

/**
 * The real queue: one durable row per lead, keyed so a duplicate delivery is the ledger's own conflict. The
 * driver answers `{ conflict }` rather than throwing org's `JobConflictError`, so ads needs no edge into org.
 */
export const queueEnqueue = (admin: SupabaseClient, driver: QueueDriver = pgQueueDriver(admin)): LeadFetchEnqueue => async (orgId, payload) => {
  const r = await driver.enqueue("ads_lead_fetch", { orgId, payload, dedupKey: adsLeadFetchDedupKey(orgId, payload.leadgenId) });
  return "conflict" in r ? "conflict" : "queued";
};

export function metaWebhookRouter(deps: MetaWebhookDeps): Router {
  const router = Router();
  const openAdmin = deps.admin ?? getSupabaseAdmin;
  const makeEnqueue = deps.enqueue ?? ((admin: SupabaseClient) => queueEnqueue(admin));
  const kick = deps.kick;

  router.get("/", (req, res) => {
    const a = answerSubscribe(getAppLocals(req).env, req.query as Record<string, unknown>);
    if (typeof a.body === "string") {
      res.status(a.status).type("text/plain").set("X-Content-Type-Options", "nosniff").send(a.body);
      return;
    }
    res.status(a.status).json(a.body);
  });

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
      // The admin client is opened only once a secret exists: an unconfigured receiver touches nothing.
      const admin = env.META_APP_SECRET ? openAdmin(env) : (null as unknown as SupabaseClient);
      const a = await receiveLeadgenDelivery({ env, admin, enqueue: makeEnqueue(admin) }, rawBody, req.header(SIGNATURE_HEADER) ?? undefined);
      res.status(a.status).json(a.body);
      const queued = typeof a.body === "object" && typeof a.body.queued === "number" ? a.body.queued : 0;
      if (queued > 0) void kick(env, admin, queued).catch(() => {});
    }),
  );

  return router;
}
