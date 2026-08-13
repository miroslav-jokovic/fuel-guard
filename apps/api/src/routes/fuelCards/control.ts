import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  CARD_OVERRIDE_STEP_UP_ABOVE_USES,
  clearOverrideSchema,
  grantOverrideSchema,
  lockCardSchema,
  efsStatusEquals,
  rolesThatCanView,
  rolesThatManage,
  setPromptsSchema,
  unlockCardSchema,
} from "@fuelguard/shared";
import { getAppLocals } from "../../lib/appLocals.js";
import { EfsSoapError } from "../../lib/efsSoapSession.js";
import { apiError, asyncHandler, dbErrorResponse } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { enforceCardWriteLimit } from "../../middleware/cardWriteLimit.js";
import { DEFAULT_STEP_UP_MAX_AGE_SEC, hasFreshAuth, stepUpRequired } from "../../middleware/requireFreshAuth.js";
import {
  CardControlError,
  CardMutationReplay,
  executeCardMutation,
  type CardMutationContext,
  type CardMutationIntentSpec,
} from "../../services/efsCardControl.js";
import {
  OVERRIDE_FIELDS,
  lockEdits,
  overrideClearEdits,
  overrideClearedLanded,
  overrideGrantEdits,
  promptsEdits,
  unlockEdits,
} from "../../services/efsCardEdits.js";
import { loadCardControlAccess, type CardScope } from "../../services/efsCardControlAccess.js";
import { loadCardNumber } from "../../services/efsCardMirror.js";
import { getEfsSoapCredentials } from "../../services/efsSoapCredentials.js";
import { ActionRefusalError, assertPromptRemovalAllowed } from "./controlRefusal.js";

/**
 * Changing a fuel card. Five endpoints, one per INTENT.
 *
 * ── EXPLICIT NON-GOALS. Do not add these casually; each is excluded for a stated reason. ─────────
 *
 *  • No `removeCard`. It is a hard delete in the EFS system (p128) with no undo. `Hold` or `Inactive`
 *    is always the answer, and both are reversible from this same router.
 *  • No `setCardPin`. A driver-held secret; handing one over safely is a whole feature, not a field.
 *  • No card ordering (`createOrder`, `replaceLostOrStolenCard`, `reissueDamagedCard`,
 *    `transferCard`). They cost money per card and involve shipping addresses.
 *  • No `managedFuelAction`. Needs `fuel_plans` integration and an "exactly one card per Driver ID"
 *    precondition this product cannot assert.
 *  • No `setPolicy`. Fleet-wide blast radius by construction.
 *  • No product-limit overrides. That p194 recipe requires DELIBERATELY dropping the limits array —
 *    the exact shape of the disaster the echo guard exists to prevent. Phase C, with its own
 *    confirmation and step-up.
 *  • No `setCardRefreshingLimits` / the `…OVER` convention, no bulk actions, no location-group or
 *    blocklist editing, no `handEnter=DISALLOW` (worth doing — it kills a whole skimming class — but
 *    it needs station-compatibility confirmation from WEX first).
 *
 * ── Why one endpoint per intent rather than a PATCH taking a partial card ────────────────────────
 * A generic patch puts the vendor document's shape on the wire, makes the audit action undecidable
 * without diffing two documents, makes per-intent rate limits and approver scopes impossible, and
 * invites precisely the "just send what changed" mental model that EFS's full-document write punishes
 * by deleting everything you left out.
 *
 * ── Why synchronous rather than queued ───────────────────────────────────────────────────────────
 * "Locked" has to mean *EFS says Hold, verified* — three paced calls, two to four seconds. A 202 plus
 * a job to poll gives a dispatcher a spinner and a page they may close, and at 2am when a truck has
 * been broken into, "queued" is the wrong word. The queue is also the wrong tool: `dispatchJob`'s
 * per-(org,kind) slot would serialise every card write in the org, and its dedup key would 409 two
 * dispatchers locking two DIFFERENT cards.
 *
 * TENANCY. `getSupabaseAdmin` is the service role and bypasses RLS, so `orgId` comes from the verified
 * JWT and every query chains `.eq("org_id", orgId)`. A card belonging to another org is a 404, never a
 * 403 — we do not confirm that another tenant's card exists.
 */

/** Idempotency-Key header. uuid v4 from the browser, one per drawer-open per intent. */
const idempotencyKeySchema = z.string().uuid();

/**
 * What a reused Idempotency-Key must be asked FOR (audit P1-2 / migration 0180). The key alone
 * replays the recorded outcome; the fingerprint proves the replayed request is the SAME request.
 * `reason` and `expectedVersion` are excluded deliberately: neither changes what is being asked,
 * and expectedVersion legitimately differs when a client retries after a card_state_changed 409
 * with the same key (no ledger row was opened, so the key is still live).
 */
function mutationFingerprint(intent: string, efsCardId: string, body: Record<string, unknown>): string {
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(body).sort()) {
    if (key === "reason" || key === "expectedVersion") continue;
    sanitized[key] = body[key];
  }
  return createHash("sha256").update(`${intent}:${efsCardId}:${JSON.stringify(sanitized)}`).digest("hex");
}

interface Prepared {
  ctx: CardMutationContext;
  access: Awaited<ReturnType<typeof loadCardControlAccess>>;
}

export function fuelCardControlRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canManage = requireRole(...rolesThatManage("fuel"));

  /**
   * Everything the five handlers need, resolved once: the gate, the credentials, the card, the PAN.
   *
   * Returns null after having already answered the request. Ordered so the cheapest and least
   * informative refusal comes first — a caller who is not entitled learns nothing about whether the
   * card id they guessed exists.
   */
  async function prepare(req: Request, res: Response, scope: CardScope): Promise<Prepared | null> {
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
    const access = await loadCardControlAccess(admin, env, orgId, req.auth!.userId, req.auth!.role);
    if (access.blockedBy !== null || !access.scopes.includes(scope)) {
      // Four ANDed facts, each with its own sentence, because "an admin needs to run the write check"
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

  const run = async (res: Response, ctx: CardMutationContext, spec: CardMutationIntentSpec): Promise<void> => {
    try {
      const outcome = await executeCardMutation(ctx, spec);
      // 200 for every RECORDED outcome, including 'failed' and 'sent'. The request succeeded — we
      // asked EFS and wrote down what happened. Returning 502 for a vendor refusal would throw away
      // the mutation id the operator needs in order to look the attempt up.
      res.json({ ok: outcome.status === "succeeded", ...outcome });
    } catch (error) {
      // A refusal decided against the FRESH document (fraud unlock, DRID removal) surfaces before
      // any ledger row exists — the same recovery shape wherever it is thrown from.
      if (error instanceof ActionRefusalError) {
        if (error.code === "step_up_required") { stepUpRequired(res, DEFAULT_STEP_UP_MAX_AGE_SEC, error.message); return; }
        res.status(400).json(apiError(error.code, error.message));
        return;
      }
      controlErrorResponse(res, error);
    }
  };

  // ── Lock / unlock ───────────────────────────────────────────────────────────────────────────────

  router.post("/:id/lock", requireOrg, canManage, asyncHandler(async (req, res) => {
    const body = lockCardSchema.safeParse(req.body ?? {});
    if (!body.success) { badRequest(res, body.error); return; }
    const prepared = await prepare(req, res, "lock");
    if (!prepared) return;

    // NO step-up on a lock. This is the safety action you want frictionless at 2am, it is fully
    // reversible, and friction here has a cost measured in stolen fuel.
    await run(res, {
      ...prepared.ctx,
      reason: body.data.reason,
      expectedVersion: body.data.expectedVersion,
      requestFingerprint: mutationFingerprint("lock", prepared.ctx.efsCardId, body.data),
    }, {
      intent: "lock",
      auditAction: "card.locked",
      // `doc.card.status` — the fresh in-operation read — feeds the H1 casing rule: the write is
      // spelled the way THIS account spells its statuses, or the vendor silently ignores it.
      buildEdits: (doc) => lockEdits(body.data.status, doc.card.status),
      auditMeta: (doc) => ({ statusRequested: body.data.status, statusBefore: doc.card.status }),
    });
  }));

  router.post("/:id/unlock", requireOrg, canManage, asyncHandler(async (req, res) => {
    const body = unlockCardSchema.safeParse(req.body ?? {});
    if (!body.success) { badRequest(res, body.error); return; }
    const prepared = await prepare(req, res, "unlock");
    if (!prepared) return;

    // Unlocking a card EFS has flagged as Fraud is the one status change that needs step-up. Somebody
    // — WEX, or this product's own detection — decided that card was being abused; releasing it is
    // not the reversible safety action a lock is.
    const { data } = await prepared.ctx.admin
      .from("efs_cards").select("status")
      .eq("id", prepared.ctx.efsCardId).eq("org_id", prepared.ctx.orgId).maybeSingle();
    const mirroredStatus = (data as { status?: string } | null)?.status ?? null;
    // efsStatusEquals, not ===: this account reports FRAUD upper-cased, and an exact comparison
    // would have waved the unlock straight past the step-up this branch exists to demand.
    if (efsStatusEquals(mirroredStatus, "Fraud") && !hasFreshAuth(req)) {
      stepUpRequired(
        res, DEFAULT_STEP_UP_MAX_AGE_SEC,
        "This card is flagged for fraud. Confirm your password to unlock it.",
      );
      return;
    }

    const hadFreshAuth = hasFreshAuth(req);
    await run(res, {
      ...prepared.ctx,
      reason: body.data.reason,
      expectedVersion: body.data.expectedVersion,
      requestFingerprint: mutationFingerprint("unlock", prepared.ctx.efsCardId, body.data),
    }, {
      intent: "unlock",
      auditAction: "card.unlocked",
      buildEdits: (doc) => {
        // The mirror check above gives the honest prompt EARLY; this one is the decision that
        // counts, taken against the document EFS reported INSIDE the operation. A card flagged
        // Fraud since the last sweep must not unlock without step-up because our copy was stale
        // (audit P1-7). Thrown here → no ledger row, no dispatch.
        if (efsStatusEquals(doc.card.status, "Fraud") && !hadFreshAuth) {
          throw new ActionRefusalError(
            "This card is flagged for fraud. Confirm your password to unlock it.",
            "step_up_required",
          );
        }
        return unlockEdits(doc.card.status);
      },
      auditMeta: (doc) => ({ statusBefore: doc.card.status, unlockedFromFraud: efsStatusEquals(doc.card.status, "Fraud") || efsStatusEquals(mirroredStatus, "Fraud") }),
    });
  }));

  // ── Overrides ───────────────────────────────────────────────────────────────────────────────────

  router.post("/:id/override", requireOrg, canManage, asyncHandler(async (req, res) => {
    const body = grantOverrideSchema.safeParse(req.body ?? {});
    if (!body.success) { badRequest(res, body.error); return; }
    // Vendor-capped at 9; we require a fresh sign-in above three. One free tank is an exception, four
    // is a decision somebody should have to prove they made.
    if (body.data.uses > CARD_OVERRIDE_STEP_UP_ABOVE_USES && !hasFreshAuth(req)) {
      stepUpRequired(
        res, DEFAULT_STEP_UP_MAX_AGE_SEC,
        `Confirm your password to grant more than ${CARD_OVERRIDE_STEP_UP_ABOVE_USES} uses.`,
      );
      return;
    }
    const prepared = await prepare(req, res, "override");
    if (!prepared) return;

    const { uses, scope } = body.data;
    await run(res, {
      ...prepared.ctx,
      reason: body.data.reason,
      expectedVersion: body.data.expectedVersion,
      requestFingerprint: mutationFingerprint("override_grant", prepared.ctx.efsCardId, body.data),
    }, {
      intent: "override_grant",
      auditAction: "card.override_granted",
      buildEdits: (doc) => overrideGrantEdits(doc, uses, scope),
      auditMeta: (doc) => ({
        overrideUsesBefore: doc.card.overrideUses,
        overrideUsesAfter: uses,
        overrideScope: scope.kind,
        locationId: scope.kind === "location" ? scope.locationId : null,
      }),
    });
  }));

  router.delete("/:id/override", requireOrg, canManage, asyncHandler(async (req, res) => {
    const body = clearOverrideSchema.safeParse(req.body ?? {});
    if (!body.success) { badRequest(res, body.error); return; }
    const prepared = await prepare(req, res, "override");
    if (!prepared) return;

    // D1: the dedicated `deleteOverride` op behind its flag; the proven three-edit echo otherwise.
    // Same intent, same ledger, same finalizers — only the wire mechanism differs, and the audit
    // meta names which one ran so the two are distinguishable in history. The flag stays off until
    // the D1 probe proves entitlement and post-state on the QA card (fix plan D1).
    const viaDeleteOp = getAppLocals(req).env.EFS_CARD_DELETE_OVERRIDE_ENABLED;

    await run(res, {
      ...prepared.ctx,
      reason: body.data.reason,
      expectedVersion: body.data.expectedVersion,
      requestFingerprint: mutationFingerprint("override_clear", prepared.ctx.efsCardId, body.data),
    }, {
      intent: "override_clear",
      auditAction: "card.override_cleared",
      // With the vendor op, no edits are echoed — `[]` is the ledger's honest record of that.
      buildEdits: viaDeleteOp ? () => [] : () => overrideClearEdits(),
      ...(viaDeleteOp
        ? { vendorOp: { op: "deleteOverride" as const, landed: overrideClearedLanded, movesFields: OVERRIDE_FIELDS } }
        : {}),
      auditMeta: (doc) => ({
        overrideUsesBefore: doc.card.overrideUses,
        overrideUsesAfter: 0,
        vendorOp: viaDeleteOp ? "deleteOverride" : "setCardv2",
      }),
    });
  }));

  // ── Prompts ─────────────────────────────────────────────────────────────────────────────────────

  router.post("/:id/prompts", requireOrg, canManage, asyncHandler(async (req, res) => {
    const body = setPromptsSchema.safeParse(req.body ?? {});
    if (!body.success) { badRequest(res, body.error); return; }
    const prepared = await prepare(req, res, "prompts");
    if (!prepared) return;

    const { prompts, allowRemoveDriverId } = body.data;

    /**
     * The removal decision is made against the card EFS reports INSIDE the operation, never against
     * the mirror: a prompt removed in the WEX portal five minutes ago must not make this refuse, and
     * one added there must not slip through unauthorised.
     *
     * It therefore has to happen inside `buildEdits`, which `planCardMutation` calls after the fresh
     * read and BEFORE it opens a ledger row. Throwing from here is what makes the refusal safe: no
     * row is written, nothing is dispatched, and there is no half-finished record of a change that
     * never happened.
     */
    const buildEdits = (doc: Parameters<CardMutationIntentSpec["buildEdits"]>[0]) => {
      const plan = promptsEdits(doc, prompts);
      assertPromptRemovalAllowed(plan.removedInfoIds, allowRemoveDriverId, hasFreshAuth(req));
      return plan.edits;
    };

    try {
      const outcome = await executeCardMutation(
        {
          ...prepared.ctx,
          reason: body.data.reason,
          expectedVersion: body.data.expectedVersion,
          requestFingerprint: mutationFingerprint("prompts_set", prepared.ctx.efsCardId, body.data),
        },
        {
          intent: "prompts_set",
          auditAction: "card.prompts_changed",
          buildEdits,
          auditMeta: (doc) => {
            const plan = promptsEdits(doc, prompts);
            return { promptsBefore: plan.before, promptsAfter: plan.after, removedInfoIds: plan.removedInfoIds };
          },
        },
      );
      res.json({ ok: outcome.status === "succeeded", ...outcome });
    } catch (error) {
      if (error instanceof ActionRefusalError) {
        if (error.code === "step_up_required") { stepUpRequired(res, DEFAULT_STEP_UP_MAX_AGE_SEC, error.message); return; }
        res.status(400).json(apiError(error.code, error.message));
        return;
      }
      controlErrorResponse(res, error);
    }
  }));

  // ── History ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * The mutation ledger for one card. A READ, gated like every other card read
   * (rolesThatCanView("fuel"), the same gate read.ts applies): an auditor who cannot change a card
   * is exactly the person who needs to see what changed — and a driver, whose fueling this surface
   * exists to scrutinise, is exactly who must not browse it (audit P1-4).
   */
  router.get("/:id/history", requireOrg, requireRole(...rolesThatCanView("fuel")), asyncHandler(async (req, res) => {
    const { env } = getAppLocals(req);
    const admin = getSupabaseAdmin(env);
    const orgId = req.auth!.orgId!;
    const { data, error } = await admin
      .from("efs_card_mutations")
      // Explicit columns: the ledger carries before/after documents and redacted vendor XML, and
      // neither belongs in a page render. `select("*")` here would ship both.
      .select("id, intent, status, reason, requested_by, step_up, created_at, completed_at, efs_fault_code, efs_fault_message, drift")
      .eq("org_id", orgId)
      .eq("efs_card_id", String(req.params.id))
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      dbErrorResponse(res, "fuel-cards.history", error, "Could not load the change history");
      return;
    }
    res.json({ mutations: (data ?? []).map(toMutationView) });
  }));

  return router;
}

// ─── Response helpers ──────────────────────────────────────────────────────────────────────────

const badRequest = (res: Response, error: z.ZodError): void => {
  res.status(400).json(apiError("invalid_request", error.issues[0]?.message ?? "Invalid request"));
};


/** One sentence per blocked-by reason, each pointing at what would actually unblock it. */
function refusal(blockedBy: string | null, scope: CardScope): [string, string] {
  switch (blockedBy) {
    case "kill_switch":
      return ["card_control_disabled", "Card actions are switched off for this deployment."];
    case "not_enabled":
      return ["card_control_disabled", "Card actions are not switched on for this company yet. An admin can enable them in Settings → Card control."];
    case "no_credentials":
      return ["efs_not_configured", "EFS is not connected for this company."];
    case "not_entitled":
      return ["card_control_not_entitled", "EFS has not confirmed write access for this account. An admin needs to run the EFS write check."];
    case "role":
      return ["forbidden", "Your role cannot change fuel cards."];
    case "not_approver":
      return ["forbidden", "You are not on this company's card-control approver list."];
    default:
      return ["forbidden", `You are not approved for the "${scope}" action on fuel cards.`];
  }
}

/**
 * Vendor failures and our own refusals map to different statuses on purpose.
 *
 * `efs_echo_unfaithful` gets its own code because it is a bug in US, not a vendor problem, and must
 * never reach an operator dressed up as "EFS is having trouble".
 */
function controlErrorResponse(res: Response, error: unknown): void {
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

interface MutationRow {
  id: string; intent: string; status: string; reason: string;
  requested_by: string | null; step_up: boolean;
  created_at: string; completed_at: string | null;
  efs_fault_code: string | null; efs_fault_message: string | null;
  drift: { unexplained?: { path: string }[] } | null;
}

const toMutationView = (row: unknown) => {
  const r = row as MutationRow;
  return {
    id: r.id,
    intent: r.intent,
    status: r.status,
    reason: r.reason,
    requestedBy: r.requested_by,
    stepUp: r.step_up,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    efsFaultCode: r.efs_fault_code,
    efsFaultMessage: r.efs_fault_message,
    driftFields: r.drift?.unexplained?.map((d) => d.path) ?? null,
  };
};
