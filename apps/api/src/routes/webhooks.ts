import { Router } from "express";
import { asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { processSamsaraWebhook } from "../services/fuelEvents.js";

/** Inbound integration webhooks. No user auth — authenticated by provider signature instead. */
export function webhooksRouter(): Router {
  const router = Router();

  // Samsara alert webhook (sudden fuel-level drop → siphoning signal).
  router.post(
    "/samsara",
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const rawBody: Buffer =
        (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
      const result = await processSamsaraWebhook(admin, env, rawBody, {
        signature: req.header("X-Samsara-Signature") ?? undefined,
        timestamp: req.header("X-Samsara-Timestamp") ?? undefined,
      });
      // Reject only bad signatures (401). Accepted-but-ignored events return 200 so Samsara won't retry.
      if (!result.ok && result.reason === "bad_signature") {
        res.status(401).json({ ok: false });
        return;
      }
      res.json({ ok: true, stored: result.stored, reason: result.reason });
    }),
  );

  return router;
}
