import { Router } from "express";
import { asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { processSamsaraWebhook } from "../modules/fuel/index.js";
import { handleInboundSms } from "../services/applicationSms.js";
import { verifyTwilioSignature } from "../lib/twilioSignature.js";

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

  /**
   * Inbound SMS — the opt-out path (A11b, D-APP13).
   *
   * ⚠ An unverifiable receiver REJECTS. The recruiting plan's rule for webhooks, and it bites harder
   * here than anywhere else in the product: a forged inbound message could revoke a real driver's
   * consent, and — worse in the other direction — an attacker who could make us BELIEVE a STOP had
   * arrived when it had not would leave us texting somebody who had opted out. So a request with no
   * verifiable signature is a 401 and changes nothing.
   *
   * Twilio retries a non-2xx, so a genuine message we choose to ignore (anything that is not an
   * opt-out) answers 200 with an empty TwiML body — which is also what stops Twilio auto-replying.
   */
  router.post(
    "/sms",
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const signature = req.header("X-Twilio-Signature");
      // The full URL Twilio signed, which is what it hashed — not the path Express saw behind a proxy.
      const url = `${env.PUBLIC_API_URL ?? ""}${req.originalUrl}`;
      const params = (req.body ?? {}) as Record<string, string>;
      if (!verifyTwilioSignature(env.TWILIO_AUTH_TOKEN, url, params, signature)) {
        res.status(401).json({ ok: false });
        return;
      }

      const admin = getSupabaseAdmin(env);
      const { revoked } = await handleInboundSms(admin, params.From ?? "", params.Body ?? "");
      // Empty TwiML: accepted, and no auto-reply. A carrier sends its own STOP confirmation.
      res.set("Content-Type", "text/xml").send("<Response></Response>");
      void revoked;
    }),
  );

  return router;
}
