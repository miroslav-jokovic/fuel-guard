import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  CARD_OVERRIDE_STEP_UP_ABOVE_USES,
  clearOverrideSchema,
  grantOverrideSchema,
  lockCardSchema,
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
import { lockEdits, overrideClearEdits, overrideGrantEdits, promptsEdits, unlockEdits } from "../../services/efsCardEdits.js";
import { loadCardControlAccess, type CardScope } from "../../services/efsCardControlAccess.js";
import { loadCardNumber } from "../../services/efsCardMirror.js";
import { getEfsSoapCredentials } from "../../services/efsSoapCredentials.js";

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
const idempotencyKeySchema = z.string().uuid().optional();

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

    // The deploy-wide kill switch first, and before any database work: it is the cheapest of the four
    // ANDed facts and the only one that can be answered without a round trip. A deployment with card
    // control off should not be querying settings tables to find that out.
    if (!env.EFS_CARD_CONTROL_ENABLED) {
      const [code, message] = refusal("kill_switch", scope);
      res.status(403).json(apiError(code, message));
      return null;
    }

    // Pure, and therefore before anything expensive: a malformed replay key is a client bug and
    // deserves a straight answer rather than three round trips followed by one.
    const key = idempotencyKeySchema.safeParse(req.header("Idempotency-Key") ?? undefined);
    if (!key.success) {
      res.status(400).json(apiError("invalid_request", "Idempotency-Key must be a uuid."));
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
    await run(res, { ...prepared.ctx, reason: body.data.reason, expectedVersion: body.data.expectedVersion }, {
      intent: "lock",
      auditAction: "card.locked",
      buildEdits: () => lockEdits(body.data.status),
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
    if (mirroredStatus === "Fraud" && !hasFreshAuth(req)) {
      stepUpRequired(
        res, DEFAULT_STEP_UP_MAX_AGE_SEC,
        "This card is flagged for fraud. Confirm your password to unlock it.",
      );
      return;
    }

    await run(res, { ...prepared.ctx, reason: body.data.reason, expectedVersion: body.data.expectedVersion }, {
      intent: "unlock",
      auditAction: "card.unlocked",
      buildEdits: () => unlockEdits(),
      auditMeta: (doc) => ({ statusBefore: doc.card.status, unlockedFromFraud: mirroredStatus === "Fraud" }),
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
    await run(res, { ...prepared.ctx, reason: body.data.reason, expectedVersion: body.data.expectedVersion }, {
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

    await run(res, { ...prepared.ctx, reason: body.data.reason, expectedVersion: body.data.expectedVersion }, {
      intent: "override_clear",
      auditAction: "card.override_cleared",
      buildEdits: () => overrideClearEdits(),
      auditMeta: (doc) => ({ overrideUsesBefore: doc.card.overrideUses, overrideUsesAfter: 0 }),
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
      if (plan.removedInfoIds.includes("DRID")) {
        // Dropping the driver-ID record stops the pump asking who is fuelling, and every downstream
        // attribution decision loses its strongest signal — the guide warns about exactly this (p137).
        // Explicit flag AND a fresh sign-in; never a side effect of clearing a text box.
        if (!allowRemoveDriverId) {
          throw new PromptRefusalError(
            "Removing the Driver ID prompt needs allowRemoveDriverId: true — it stops the pump checking who is fuelling.",
            "invalid_request",
          );
        }
        if (!hasFreshAuth(req)) {
          throw new PromptRefusalError("Confirm your password to remove the Driver ID prompt.", "step_up_required");
        }
      }
      return plan.edits;
    };

    try {
      const outcome = await executeCardMutation(
        { ...prepared.ctx, reason: body.data.reason, expectedVersion: body.data.expectedVersion },
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
      if (error instanceof PromptRefusalError) {
        if (error.code === "step_up_required") { stepUpRequired(res, DEFAULT_STEP_UP_MAX_AGE_SEC, error.message); return; }
        res.status(400).json(apiError(error.code, error.message));
        return;
      }
      controlErrorResponse(res, error);
    }
  }));

  // ── History ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * The mutation ledger for one card. A READ, so it is open to everyone who can view the card — an
   * auditor who cannot change a card is exactly the person who needs to see what changed.
   */
  router.get("/:id/history", requireOrg, asyncHandler(async (req, res) => {
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

/**
 * A prompts change this caller is not allowed to make, discovered only once the fresh card document
 * is in hand. Thrown from `buildEdits` so `planCardMutation` aborts before it writes a ledger row.
 */
class PromptRefusalError extends Error {
  constructor(message: string, public code: "invalid_request" | "step_up_required") {
    super(message);
    this.name = "PromptRefusalError";
  }
}

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
