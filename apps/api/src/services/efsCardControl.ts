import type { SupabaseClient } from "@supabase/supabase-js";
import { CARD_MUTATIONS_PER_HOUR_DEFAULT, type CardMutationIntent } from "@fuelguard/shared";
import type { Env } from "../env.js";
import type { CardEdit } from "../lib/efsCardEcho.js";
import type { CardDocument } from "../lib/efsCardXml.js";
import { getCardV2 } from "../lib/efsCardOps.js";
import { setCardV2 } from "../lib/efsCardWrite.js";
import { EfsSoapError } from "../lib/efsSoapSession.js";
import {
  finalizeFailed,
  finalizeLanded,
  finalizeUnsent,
  finalizeUnverified,
  intentLanded,
  updateMirror,
} from "./efsCardReconcile.js";
import type { EfsSoapCredentials } from "./efsSoapCredentials.js";

/**
 * Changing a fuel card in EFS: one path, one ledger row, one recorded outcome for every branch.
 *
 * ── The shape of every mutation ──────────────────────────────────────────────────────────────────
 *
 *   plan:   fresh getCardv2 → expectedVersion check → build edits → ledger row 'pending'
 *   apply:  setCardV2 (retry:false) → ALWAYS re-read getCardv2 → classify → finalize + audit + mirror
 *
 * Split into two exported functions even though Phase 1 calls them back to back in one request. That
 * seam is what makes maker-checker a route and a UI rather than a schema migration later: `apply`
 * re-validates the version it was planned against, so a stale approval is refused instead of applied
 * blind, and `approved_by` already exists on the ledger.
 *
 * ── The four outcomes, and why "we don't know" is one of them ────────────────────────────────────
 *
 *   intent landed, nothing else moved   → succeeded
 *   intent landed, other fields moved   → drift_detected  (+ audit card.drift_detected)
 *   intent did not land                 → failed          (+ the vendor's own fault text)
 *   the verifying re-read itself failed → sent            (+ audit card.mutation_unverified)
 *
 * `sent` is terminal and is surfaced to operators as "Unverified". A `setCardV2` timeout is NOT a
 * failure — the write may have landed — so it is never retried and never reported as "nothing
 * happened". A mutation whose result nobody knows is exactly the thing a human needs to go and check,
 * and the one thing this system must never do is decide on their behalf that it was fine.
 *
 * ── The mirror is updated in EVERY branch, including failure ─────────────────────────────────────
 * A refused write still teaches us the card's true state. EFS always wins; the mirror follows; the
 * ledger records that it moved. The reverse — pushing our expectation back at EFS — is never done.
 */

// ─── Errors the routes translate into status codes ─────────────────────────────────────────────

/**
 * A refusal that is about US or about the request, not about the vendor. Vendor problems arrive as
 * `EfsSoapError` and keep their own codes, so a route can tell "EFS said no" from "we said no"
 * without inspecting message text.
 */
export class CardControlError extends Error {
  constructor(
    message: string,
    public code:
      | "card_control_disabled"
      | "card_control_not_entitled"
      | "card_state_changed"
      | "mutation_in_flight"
      | "org_hourly_cap_reached"
      | "secrets_key_missing"
      | "not_found",
    public status: number,
    public detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CardControlError";
  }
}

// ─── Inputs ────────────────────────────────────────────────────────────────────────────────────

export interface CardMutationContext {
  admin: SupabaseClient;
  env: Env;
  creds: EfsSoapCredentials;
  orgId: string;
  /** `efs_cards.id`. Every route keys on this uuid; a PAN never appears in a path or an access log. */
  efsCardId: string;
  /** Unsealed inside the route, held only for the duration of the operation. */
  cardNumber: string;
  userId: string;
  reason: string;
  expectedVersion: string;
  idempotencyKey?: string | null;
  /** True when the caller re-authenticated for this action. Recorded as evidence. */
  stepUp?: boolean;
  /**
   * Injectable fetch — tests pass a stub, exactly as the feeds and the mirror do. Threaded through
   * every vendor call in the operation rather than only the first, because the whole point of this
   * service's tests is the SEQUENCE: read, write, re-read.
   */
  fetchImpl?: typeof fetch;
}

export interface CardMutationIntentSpec {
  intent: CardMutationIntent;
  /** Built from the freshly-read document — see services/efsCardEdits.ts. */
  buildEdits: (doc: CardDocument) => CardEdit[];
  /** Extra audit `meta` for this intent, computed once the fresh document is in hand. */
  auditMeta?: (doc: CardDocument) => Record<string, unknown>;
  /** The audit action written on success. Failure and drift have their own actions. */
  auditAction: string;
}

export interface CardMutationPlan {
  mutationId: string;
  intent: CardMutationIntent;
  before: CardDocument;
  edits: CardEdit[];
  auditMeta: Record<string, unknown>;
  auditAction: string;
}

export interface CardMutationOutcome {
  mutationId: string;
  status: "succeeded" | "failed" | "drift_detected" | "sent";
  /** The card as the verifying re-read found it. Null only when that re-read itself failed. */
  version: string | null;
  driftFields: string[];
  faultCode: string | null;
  faultMessage: string | null;
}

// ─── Plan ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Read the card as it is RIGHT NOW, check nothing has moved under the operator, and write the
 * intention down before anything is dispatched.
 *
 * The fresh read is not an optimisation and cannot be served from the mirror: `setCardV2` echoes the
 * document back, so echoing one from ten minutes ago would silently undo whatever changed in the WEX
 * portal since. That is also what makes `expectedVersion` meaningful — it compares the version the
 * operator's screen was drawn from against a document read moments ago, and refuses on any difference.
 */
export async function planCardMutation(
  ctx: CardMutationContext,
  spec: CardMutationIntentSpec,
): Promise<CardMutationPlan> {
  await assertOrgHourlyCap(ctx);
  await assertNoMutationInFlight(ctx);

  const before = await getCardV2(ctx.env, ctx.creds, ctx.cardNumber, {
    priority: "interactive",
    timeoutMs: ctx.env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
    fetchImpl: ctx.fetchImpl,
  });

  if (before.version !== ctx.expectedVersion) {
    // Nothing is sent. The operator gets the fresh card and decides again — the only defence
    // available, since the guide offers no ETag and no row version.
    throw new CardControlError(
      "This card changed in EFS since the screen was drawn.",
      "card_state_changed",
      409,
      { currentVersion: before.version, card: before.card },
    );
  }

  const edits = spec.buildEdits(before);
  const auditMeta = spec.auditMeta?.(before) ?? {};

  // The row exists BEFORE dispatch. If this process dies mid-write, what remains is a visible
  // 'pending' row naming the card, the intent and the person — not silence.
  const { data, error } = await ctx.admin
    .from("efs_card_mutations")
    .insert({
      org_id: ctx.orgId,
      efs_card_id: ctx.efsCardId,
      intent: spec.intent,
      status: "pending",
      reason: ctx.reason,
      requested_by: ctx.userId,
      step_up: ctx.stepUp === true,
      expected_version: ctx.expectedVersion,
      before_version: before.version,
      before_document: before.card,
      edits,
      idempotency_key: ctx.idempotencyKey ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // The partial unique index is the ONLY replay defence — a read-then-write check would be a race
    // by construction, and the failure mode of a double-submitted override is a driver getting two
    // free tanks. 23505 is unique_violation.
    if ((error as { code?: string }).code === "23505") {
      throw new CardControlError(
        "That request was already submitted.",
        "mutation_in_flight",
        409,
        { idempotencyKey: ctx.idempotencyKey },
      );
    }
    throw new Error(`could not open the card mutation ledger row: ${error.message}`);
  }

  return {
    mutationId: (data as { id: string }).id,
    intent: spec.intent,
    before,
    edits,
    auditMeta,
    auditAction: spec.auditAction,
  };
}

// ─── Apply ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Send the write, then find out what actually happened.
 *
 * There is exactly one exit path per outcome and all of them write the ledger, the audit log and the
 * mirror. Nothing here swallows an exception: an error that escapes this function leaves a row in
 * 'pending' or 'sent', which is a visible unresolved state rather than a lost one.
 */
export async function applyCardMutation(
  ctx: CardMutationContext,
  plan: CardMutationPlan,
): Promise<CardMutationOutcome> {
  const { mutationId, before, edits } = plan;

  await ctx.admin
    .from("efs_card_mutations")
    .update({ status: "sent", attempts: 1 })
    .eq("id", mutationId)
    .eq("org_id", ctx.orgId);

  let requestXmlRedacted: string | null = null;
  let responseXmlRedacted: string | null = null;
  let writeError: EfsSoapError | null = null;

  try {
    const result = await setCardV2(ctx.env, ctx.creds, before, ctx.cardNumber, edits, {
      priority: "interactive",
      timeoutMs: ctx.env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
      fetchImpl: ctx.fetchImpl,
    });
    requestXmlRedacted = result.requestXmlRedacted;
    responseXmlRedacted = result.responseXmlRedacted;
  } catch (error) {
    // A dispatch failure is NOT the end of the story. A timeout may have landed, a decline may not
    // have, and only the re-read below can tell the difference — so the error is held, not thrown.
    if (!(error instanceof EfsSoapError)) throw error;
    writeError = error;
    // `echo_unfaithful` is the exception: the request was never sent, so there is nothing to
    // reconcile and no reason to spend a vendor call proving it. Our bug, recorded as ours.
    if (error.code === "echo_unfaithful") {
      return await finalizeUnsent(ctx, plan, error);
    }
  }

  // ALWAYS re-read. This is what turns "EFS returned 200" into "the card says Hold".
  let after: CardDocument | null = null;
  let readError: unknown = null;
  try {
    after = await getCardV2(ctx.env, ctx.creds, ctx.cardNumber, {
      priority: "interactive",
      timeoutMs: ctx.env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
      fetchImpl: ctx.fetchImpl,
    });
  } catch (error) {
    readError = error;
  }

  if (!after) {
    return await finalizeUnverified(ctx, plan, { requestXmlRedacted, responseXmlRedacted, writeError, readError });
  }

  // The mirror follows EFS in every branch, success or failure. Best effort: a mirror write that
  // fails must not turn a completed, correctly-recorded mutation into an error.
  await updateMirror(ctx);

  const landed = intentLanded(before, after, edits);
  if (!landed) {
    return await finalizeFailed(ctx, plan, after, { requestXmlRedacted, responseXmlRedacted, writeError });
  }
  return await finalizeLanded(ctx, plan, after, { requestXmlRedacted, responseXmlRedacted });
}

/** Plan and apply in one call — the Phase 1 route path. */
export async function executeCardMutation(
  ctx: CardMutationContext,
  spec: CardMutationIntentSpec,
): Promise<CardMutationOutcome> {
  return await applyCardMutation(ctx, await planCardMutation(ctx, spec));
}

// ─── Blast-radius caps ─────────────────────────────────────────────────────────────────────────

/**
 * The org-wide hourly ceiling, counted from the ledger.
 *
 * Per-user limits (middleware/cardWriteLimit.ts) do not stop three collaborating accounts, and the
 * scenario worth defending against is not one careless dispatcher — it is a credential-stuffed org
 * quietly unlocking a fleet. Counted across every user and every intent, including rows that failed:
 * fifty refused attempts in an hour is exactly as much of an emergency as fifty successful ones.
 */
async function assertOrgHourlyCap(ctx: CardMutationContext): Promise<void> {
  const limit = ctx.env.EFS_CARD_MAX_MUTATIONS_PER_HOUR ?? CARD_MUTATIONS_PER_HOUR_DEFAULT;
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await ctx.admin
    .from("efs_card_mutations")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId)
    .gte("created_at", since);

  // FAIL CLOSED. This is the last cap between a compromised account and a fleet, and it is the one
  // control that no per-user limit can substitute for. An unavailable ledger is a reason to stop.
  if (error) {
    throw new CardControlError(
      "Card changes are paused because the change log is unavailable. Try again shortly.",
      "org_hourly_cap_reached",
      503,
      { reason: "ledger_unavailable" },
    );
  }
  if ((count ?? 0) >= limit) {
    throw new CardControlError(
      `This company has made ${count} card changes in the last hour, which is its limit. ` +
        "This cap exists to bound the damage from a compromised account — an admin can raise it.",
      "org_hourly_cap_reached",
      429,
      { limit, used: count ?? 0 },
    );
  }
}

/**
 * Refuse a second mutation while one is unresolved on the SAME card.
 *
 * `expectedVersion` already stops two dispatchers changing a card from the same stale screen, but it
 * cannot stop a second write dispatched while the first is still in flight — both read the same
 * version. A card with a 'pending' or 'sent' row has an outcome nobody knows yet, and stacking a
 * second write on top of an unknown is how a card ends up in a state nobody can explain.
 */
async function assertNoMutationInFlight(ctx: CardMutationContext): Promise<void> {
  const { data, error } = await ctx.admin
    .from("efs_card_mutations")
    .select("id, status, created_at")
    .eq("org_id", ctx.orgId)
    .eq("efs_card_id", ctx.efsCardId)
    .in("status", ["pending", "sent"])
    // 'sent' is terminal-unknown and can be days old; only a RECENT one means "in flight". The window
    // is the whole-orchestration deadline plus a margin, so a crashed request unblocks the card by
    // itself rather than needing an admin.
    .gte("created_at", new Date(Date.now() - (ctx.env.EFS_CARD_WRITE_TIMEOUT_MS ?? 25_000) * 2).toISOString())
    .limit(1);
  if (error) return; // The org cap above already failed closed on an unreadable ledger.
  if (data && data.length > 0) {
    throw new CardControlError(
      "Another change to this card is still being confirmed. Wait for it to finish, then try again.",
      "mutation_in_flight",
      409,
      { mutationId: (data[0] as { id: string }).id },
    );
  }
}
