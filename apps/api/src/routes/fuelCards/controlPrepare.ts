import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { getAppLocals } from "../../lib/appLocals.js";
import { EfsSoapError } from "../../lib/efsSoapSession.js";
import { apiError } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { enforceCardWriteLimit } from "../../middleware/cardWriteLimit.js";
import { hasFreshAuth } from "../../middleware/requireFreshAuth.js";
import { CardControlError, CardMutationReplay, type CardMutationContext } from "../../services/efsCardControl.js";
import { loadCardControlAccess, type CardScope } from "../../services/efsCardControlAccess.js";
import { loadCardNumber } from "../../services/efsCardMirror.js";
import { getEfsSoapCredentials } from "../../services/efsSoapCredentials.js";
import { refusal } from "./controlRefusal.js";

/**
 * The request-shaped half of every card write: who is asking, may they, and about which card.
 *
 * Extracted from `control.ts` in Step 3.5 because there are now TWO routers that need it — the
 * hand-written one for the four capabilities still on `CardMutationIntentSpec`, and the generated
 * one driving `card_lock` from its descriptor. A second copy of this sequence is a second place for
 * the kill switch, the entitlement check or the write limiter to be forgotten, and the ordering
 * below is load-bearing in both directions. Step 3.7 deletes the hand-written caller; this stays.
 *
 * TENANCY. `getSupabaseAdmin` is the service role and bypasses RLS, so `orgId` comes from the
 * verified JWT and every query chains `.eq("org_id", orgId)`. A card belonging to another org is a
 * 404, never a 403 — we do not confirm that another tenant's card exists.
 */

/** Idempotency-Key header. uuid v4 from the browser, one per drawer-open per intent. */
const idempotencyKeySchema = z.string().uuid();

export interface Prepared {
  ctx: CardMutationContext;
  access: Awaited<ReturnType<typeof loadCardControlAccess>>;
}

/**
 * Everything the handlers need, resolved once: the gate, the credentials, the card, the PAN.
 *
 * Returns null after having already answered the request. Ordered so the cheapest and least
 * informative refusal comes first — a caller who is not entitled learns nothing about whether the
 * card id they guessed exists.
 *
 * ── The write limiter is LAST, and that is the whole reason `preflightStepUp` exists ─────────────
 * A slot is only spent once the caller is authorised, the card exists and the request is well-formed
 * — so it really is an attempt to change a card. A body-only refusal, like "this override is for
 * more uses than you may grant without re-authenticating", must therefore happen BEFORE this
 * function is called, or a refused request burns a slot the operator never got to use
 * (docs/27 §5, prepare steps 6 and 7).
 */
export async function prepare(
  req: Request,
  res: Response,
  scope: CardScope,
  /**
   * The capability key, so the promotion gate can answer for THIS action (Step 4.2). Optional only
   * because `scope` alone is what the four hand-written handlers passed before the registry existed;
   * every caller in the generated router supplies it, and the fitness test in router.test.ts is what
   * keeps that true.
   */
  capabilityKey?: string,
): Promise<Prepared | null> {
  const { env } = getAppLocals(req);
  const orgId = req.auth!.orgId!;

  // Pure, and therefore before anything expensive: a missing or malformed replay key is a client
  // bug and deserves a straight answer rather than three round trips followed by one.
  const key = idempotencyKeySchema.safeParse(req.header("Idempotency-Key") ?? undefined);
  if (!key.success) {
    res.status(400).json(apiError("invalid_request", "Idempotency-Key must be a uuid."));
    return null;
  }

  // The deploy-wide kill switch first, and before any database work: it is the cheapest of the four
  // ANDed facts and the only one that can be answered without a round trip. A deployment with card
  // control off should not be querying settings tables to find that out.
  if (!env.EFS_CARD_CONTROL_ENABLED) {
    const [code, message] = refusal("kill_switch", scope);
    res.status(403).json(apiError(code, message));
    return null;
  }

  const admin = getSupabaseAdmin(env);
  const access = await loadCardControlAccess(admin, env, orgId, req.auth!.userId, req.auth!.role, capabilityKey);
  if (access.blockedBy !== null || !access.scopes.includes(scope)) {
    // Five ANDed facts, each with its own sentence, because "an admin needs to run the write check"
    // and "EFS has not enabled this for your account" send a person to two different places.
    const [code, message] = refusal(access.blockedBy, scope);
    res.status(403).json(apiError(code, message));
    return null;
  }

  const creds = await getEfsSoapCredentials(admin, env, orgId);
  if (!creds?.enabled) {
    res.status(409).json(apiError("efs_not_configured", "EFS is not connected for this company."));
    return null;
  }

  const cardNumber = await loadCardNumber(admin, env, orgId, String(req.params.id));
  if (!cardNumber) {
    res.status(404).json(apiError("not_found", "That card is not in this company."));
    return null;
  }

  // Last, and only now: the caller is authorised, the card exists and the request is well-formed,
  // so this really is an attempt to change a card and is worth a slot against their daily cap.
  if (!(await enforceCardWriteLimit(req, res))) return null;

  return {
    access,
    ctx: {
      admin, env, creds, orgId,
      efsCardId: String(req.params.id),
      cardNumber,
      userId: req.auth!.userId,
      reason: "",
      expectedVersion: "",
      idempotencyKey: key.data ?? null,
      stepUp: hasFreshAuth(req),
    },
  };
}

/**
 * What a reused Idempotency-Key must be asked FOR (audit P1-2 / migration 0180). The key alone
 * replays the recorded outcome; the fingerprint proves the replayed request is the SAME request.
 * `reason` and `expectedVersion` are excluded deliberately: neither changes what is being asked,
 * and expectedVersion legitimately differs when a client retries after a card_state_changed 409
 * with the same key (no ledger row was opened, so the key is still live).
 */
export function mutationFingerprint(intent: string, efsCardId: string, body: Record<string, unknown>): string {
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(body).sort()) {
    if (key === "reason" || key === "expectedVersion") continue;
    sanitized[key] = body[key];
  }
  return createHash("sha256").update(`${intent}:${efsCardId}:${JSON.stringify(sanitized)}`).digest("hex");
}

export const badRequest = (res: Response, error: z.ZodError): void => {
  res.status(400).json(apiError("invalid_request", error.issues[0]?.message ?? "Invalid request"));
};

/**
 * Vendor failures and our own refusals map to different statuses on purpose.
 *
 * `efs_echo_unfaithful` gets its own code because it is a bug in US, not a vendor problem, and must
 * never reach an operator dressed up as "EFS is having trouble".
 */
export function controlErrorResponse(res: Response, error: unknown): void {
  // A settled replay is a 200, not a failure: the caller asked for something that already happened,
  // and the useful answer is what it did. `idempotent: true` is the flag a client switches on.
  if (error instanceof CardMutationReplay) {
    res.json({ ok: error.outcome.status === "succeeded", idempotent: true, ...error.outcome });
    return;
  }
  if (error instanceof CardControlError) {
    res.status(error.status).json({ ...apiError(error.code, error.message), ...(error.detail ?? {}) });
    return;
  }
  if (error instanceof EfsSoapError) {
    const status = error.code === "echo_unfaithful" ? 502 : error.code === "rate_limited" ? 429 : 502;
    res.status(status).json(apiError(`efs_${error.code}`, error.message));
    return;
  }
  throw error;
}
