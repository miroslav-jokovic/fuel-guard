import { Router } from "express";
import { asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { processSamsaraWebhook } from "../modules/samsara/index.js";
import { handleInboundSms } from "../modules/recruiting/index.js";
import { parseTelnyxInboundSms } from "../lib/sms.js";
import { verifyTelnyxSignature } from "../lib/telnyxSignature.js";

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
   * Inbound SMS — the opt-out path (A11b, D-APP13). Telnyx since 2026-09-06.
   *
   * ⚠ An unverifiable receiver REJECTS. The recruiting plan's rule for webhooks, and it bites harder
   * here than anywhere else in the product: a forged inbound message could revoke a real driver's
   * consent, and — worse in the other direction — an attacker who could make us BELIEVE a STOP had
   * arrived when it had not would leave us texting somebody who had opted out. So a request with no
   * verifiable signature is a 401 and changes nothing.
   *
   * Telnyx retries a non-2xx, so a genuine message we choose to ignore — anything that is not an
   * opt-out, and every non-`message.received` event type the messaging profile emits — answers 200.
   * There is no TwiML equivalent to return: the carrier sends its own STOP confirmation, and Telnyx
   * reads a 200 with any body as delivered.
   */
  router.post(
    "/sms",
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      // The bytes Telnyx signed.
      //
      // ⚠ Note what this does NOT do, because the Samsara receiver twelve lines above DOES do it:
      // `?? Buffer.from(JSON.stringify(req.body))`. That fallback is safe for an HMAC over a body we
      // also re-encode, and unsafe here — a re-serialised object has different key order and
      // whitespace, so it would verify by luck on simple payloads and fail on real ones, which is
      // the worst possible failure mode for an opt-out. No signature over bytes we no longer hold.
      //
      // ⚠ And no test can isolate this guard, which is stated rather than hidden: whenever `rawBody`
      // is absent the signature cannot match an empty buffer either, so the request is refused twice
      // over. Its value is that it forbids the fallback above from ever being added back.
      const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
      if (
        !rawBody ||
        !verifyTelnyxSignature(
          env.TELNYX_PUBLIC_KEY,
          rawBody,
          req.header("telnyx-signature-ed25519"),
          req.header("telnyx-timestamp"),
        )
      ) {
        res.status(401).json({ ok: false });
        return;
      }

      const { from, text, isInbound } = parseTelnyxInboundSms(req.body);
      if (!isInbound) {
        // A delivery receipt or a profile event, not a message. Accepted so it is not retried.
        res.json({ ok: true, ignored: true });
        return;
      }

      const admin = getSupabaseAdmin(env);
      const { revoked } = await handleInboundSms(admin, from, text);
      res.json({ ok: true });
      void revoked;
    }),
  );

  return router;
}
