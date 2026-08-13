import type { SupabaseClient } from "@supabase/supabase-js";
import { CARD_MUTATIONS_PER_HOUR_DEFAULT, type CardMutationIntent } from "@fuelguard/shared";
import type { Env } from "../env.js";
import type { CardEdit } from "../lib/efsCardEcho.js";
import type { CardDocument } from "../lib/efsCardXml.js";
import { getCardV2 } from "../lib/efsCardOps.js";
import { deleteOverrideOp, setCardV2 } from "../lib/efsCardWrite.js";
import { EfsSoapError } from "../lib/efsSoapSession.js";
import { sleepWithAbort, withEfsCardWriteDeadline } from "./efsCardWriteDeadline.js";
import {
  finalizeFailed,
  finalizeLanded,
  finalizeUnsent,
  finalizeUnverified,
  intentLanded,
  updateMirror,
} from "./efsCardReconcile.js";
import type { EfsSoapCredentials } from "./efsSoapCredentials.js";
import { mutationLedgerEvidence } from "./efsCardMutationEvidence.js";
import { cardOpOptions } from "./efsCardOperationOptions.js";

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
      | "idempotency_key_reused"
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
   * sha256 over (intent, card, sanitized body) — routes/fuelCards/control.ts#mutationFingerprint.
   * On an Idempotency-Key collision, a DIFFERENT fingerprint refuses instead of replaying: a key
   * reused for another request must never be answered with an unrelated recorded outcome
   * (audit P1-2, migration 0180).
   */
  requestFingerprint?: string | null;
  /**
   * Injectable fetch — tests pass a stub, exactly as the feeds and the mirror do. Threaded through
   * every vendor call in the operation rather than only the first, because the whole point of this
   * service's tests is the SEQUENCE: read, write, re-read.
   */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * A dedicated vendor operation replacing the setCardv2 echo for one intent (fix plan D1).
 *
 * When present, `buildEdits` returns `[]` — the wire write is not an edit list, so the ledger's
 * `edits` column honestly records that nothing was echoed. Verification and drift then need what the
 * edits would have provided:
 *
 *   `landed`      — the direct after-document predicate `intentLanded` cannot be, having no edit
 *                   paths to compare. Written to tolerate every post-state shape the vendor might
 *                   choose (0, nil, absent) until the probe pins the real one down.
 *   `movesFields` — header fields the op is EXPECTED to move. Classified as vendor-maintained in
 *                   the drift record — visible in the ledger, never alarmed as unexplained drift.
 *                   Anything else that moved is still drift, exactly as on the echo path.
 */
export interface CardMutationVendorOp {
  /** The only dedicated write op adopted so far. A union, so the next one extends rather than forks. */
  op: "deleteOverride";
  landed: (after: CardDocument) => boolean;
  movesFields: readonly string[];
}

export interface CardMutationIntentSpec {
  intent: CardMutationIntent;
  /** Built from the freshly-read document — see services/efsCardEdits.ts. */
  buildEdits: (doc: CardDocument) => CardEdit[];
  /** Extra audit `meta` for this intent, computed once the fresh document is in hand. */
  auditMeta?: (doc: CardDocument) => Record<string, unknown>;
  /** The audit action written on success. Failure and drift have their own actions. */
  auditAction: string;
  /** Dispatch a dedicated vendor op instead of the setCardv2 echo. See CardMutationVendorOp. */
  vendorOp?: CardMutationVendorOp;
}

export interface CardMutationPlan {
  mutationId: string;
  intent: CardMutationIntent;
  before: CardDocument;
  edits: CardEdit[];
  auditMeta: Record<string, unknown>;
  auditAction: string;
  vendorOp?: CardMutationVendorOp;
}

/**
 * A replay of an Idempotency-Key that has already SETTLED.
 *
 * Not an error condition, which is why it is not a `CardControlError`: the caller asked for something
 * that already happened, and the honest answer is the outcome it produced the first time. The route
 * returns it as a 200 with `idempotent: true` (plan §5.5, the routes/meHazmat.ts shape).
 *
 * The alternative — 409 on every replay — is safe but unhelpful: a browser that retried after a
 * network blip would be told "already submitted" and left with no idea whether the card changed.
 */
export class CardMutationReplay extends Error {
  constructor(public outcome: CardMutationOutcome) {
    super("This request was already processed.");
    this.name = "CardMutationReplay";
  }
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

  const before = await getCardV2(ctx.env, ctx.creds, ctx.cardNumber, cardOpOptions(ctx));

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
      ...mutationLedgerEvidence(ctx),
      idempotency_key: ctx.idempotencyKey ?? null,
      request_fingerprint: ctx.requestFingerprint ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 is unique_violation, and TWO indexes can raise it, with different meanings:
    //   uq_efs_card_mutations_one_pending  — another mutation on this card is mid-flight RIGHT NOW.
    //     The database is the only guard that cannot race here (audit P0-5): the SELECT-based check
    //     above has a vendor read between it and this insert, wide enough for two operators.
    //   uq_efs_card_mutations_idempotency  — this Idempotency-Key has been seen before; the ONLY
    //     replay defence, since a read-then-write check would be a race by construction, and the
    //     failure mode of a double-submitted override is a driver getting two free tanks.
    if ((error as { code?: string }).code === "23505") {
      if ((error.message ?? "").includes("uq_efs_card_mutations_one_pending")) {
        throw new CardControlError(
          "Another change to this card is still being confirmed. Wait for it to finish, then try again.",
          "mutation_in_flight",
          409,
        );
      }
      throw await replayOf(ctx);
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
    ...(spec.vendorOp ? { vendorOp: spec.vendorOp } : {}),
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
    // One dispatch per plan: the dedicated vendor op when the intent adopted one (D1), else the
    // full-document echo. Both live in efsCardWrite.ts, both retry:false, both classified the same.
    const opts = cardOpOptions(ctx);
    const result = plan.vendorOp
      ? await deleteOverrideOp(ctx.env, ctx.creds, ctx.cardNumber, opts)
      : await setCardV2(ctx.env, ctx.creds, before, ctx.cardNumber, edits, opts);
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
    after = await getCardV2(ctx.env, ctx.creds, ctx.cardNumber, cardOpOptions(ctx));
  } catch (error) {
    readError = error;
  }

  if (!after) {
    return await finalizeUnverified(ctx, plan, { requestXmlRedacted, responseXmlRedacted, writeError, readError });
  }

  // A vendor op has no edit paths to compare, so its own predicate answers "did it land" —
  // deliberately tolerant of every clear-shape (0 / nil / absent) until the probe pins one down.
  const hasLanded = (doc: CardDocument): boolean =>
    plan.vendorOp ? plan.vendorOp.landed(doc) : intentLanded(before, doc, edits);

  let landed = hasLanded(after);

  // A SECOND look before declaring no_change (audit P0-2, incident 2026-08-12). setCardv2's success
  // response is void (WSDL: zero-part setCardv2Response), so an installation that applies writes
  // with any lag makes the immediate re-read see the OLD document — recording a successful lock as
  // `failed` and inviting the operator to retry a change that already landed, the exact double-write
  // this whole design exists to prevent. One more read after a pause is the cheapest defence; the
  // pause is configurable so Phase 0's measured apply latency can tune it (0 disables, tests only).
  const verifyRetryMs = ctx.env.EFS_CARD_VERIFY_RETRY_MS ?? 3_000;
  if (!landed && verifyRetryMs > 0) {
    await sleepWithAbort(verifyRetryMs, ctx.signal);
    try {
      after = await getCardV2(ctx.env, ctx.creds, ctx.cardNumber, cardOpOptions(ctx));
      landed = hasLanded(after);
    } catch {
      // The first re-read stands. It succeeded and is a complete verification on its own; a failed
      // second look must not downgrade a verified `failed` into an unverified `sent`.
    }
  }

  // The mirror follows EFS in every branch, success or failure — fed from the verifying read itself
  // rather than a fourth vendor call (audit B5.1). Best effort: a mirror write that fails must not
  // turn a completed, correctly-recorded mutation into an error.
  await updateMirror(ctx, after);

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
  return withEfsCardWriteDeadline(ctx.env, async (signal) => {
    const scoped = { ...ctx, signal };
    return applyCardMutation(scoped, await planCardMutation(scoped, spec));
  });
}

/**
 * What to throw when an Idempotency-Key collides.
 *
 * The distinction the plan draws, and the reason the index is consulted rather than trusted blindly:
 * a SETTLED key means "you already did this, here is what happened", and an unsettled one means "the
 * first attempt has not finished yet". Only the second is a conflict.
 *
 * If the row cannot be read back — the collision is real, so it exists — the conservative answer is
 * in-flight: telling somebody a write succeeded on the strength of a failed lookup is the one mistake
 * that cannot be walked back.
 */
async function replayOf(ctx: CardMutationContext): Promise<Error> {
  const { data } = await ctx.admin
    .from("efs_card_mutations")
    .select("id, status, after_version, drift, efs_fault_code, efs_fault_message, request_fingerprint")
    .eq("org_id", ctx.orgId)
    .eq("idempotency_key", ctx.idempotencyKey ?? "")
    .maybeSingle();

  const row = data as {
    id: string; status: string; after_version: string | null;
    drift: { unexplained?: { path: string }[] } | null;
    efs_fault_code: string | null; efs_fault_message: string | null;
    request_fingerprint: string | null;
  } | null;

  // A reused key carrying a DIFFERENT request is a client bug, and replaying the recorded outcome
  // would present card A's result as card B's (the drawer's card-swap bug was a live example).
  // Refuse with a distinct code so the client knows to mint a fresh key. Pre-0180 rows have no
  // fingerprint and keep the key-only behaviour they were written under.
  if (
    row && row.request_fingerprint && ctx.requestFingerprint &&
    row.request_fingerprint !== ctx.requestFingerprint
  ) {
    return new CardControlError(
      "This Idempotency-Key was already used for a different request. Retry with a fresh key.",
      "idempotency_key_reused",
      409,
      { mutationId: row.id },
    );
  }

  if (row && row.status !== "pending") {
    return new CardMutationReplay({
      mutationId: row.id,
      status: row.status as CardMutationOutcome["status"],
      version: row.after_version,
      driftFields: row.drift?.unexplained?.map((d) => d.path) ?? [],
      faultCode: row.efs_fault_code,
      faultMessage: row.efs_fault_message,
    });
  }

  return new CardControlError(
    "That request is still being processed. Wait for it to finish before trying again.",
    "mutation_in_flight",
    409,
    { idempotencyKey: ctx.idempotencyKey, mutationId: row?.id ?? null },
  );
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
/** Everything one orchestration can legitimately take: read + write + two verify reads, each on its
 *  own interactive deadline, plus the second-look pause, plus pacing margin. */
function inFlightWindowMs(env: Env): number {
  const perCall = env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS ?? 10_000;
  const secondLook = env.EFS_CARD_VERIFY_RETRY_MS ?? 3_000;
  return 4 * perCall + secondLook + 15_000;
}

async function assertNoMutationInFlight(ctx: CardMutationContext): Promise<void> {
  const { data, error } = await ctx.admin
    .from("efs_card_mutations")
    .select("id, status, created_at")
    .eq("org_id", ctx.orgId)
    .eq("efs_card_id", ctx.efsCardId)
    .in("status", ["pending", "sent"])
    // 'sent' is terminal-unknown and can be days old; only a RECENT one means "in flight". The window
    // is derived from what one mutation can actually take — three paced interactive calls plus the
    // second-look delay plus margin — because the old EFS_CARD_WRITE_TIMEOUT_MS*2 (50s) was SHORTER
    // than a worst-case orchestration, so a legitimately slow first write lost its protection while
    // still mid-flight (audit P0-5). Stale-`pending` unblocking is the reconciler's job, not this
    // window's; `pending` rows are also fenced by the uq_efs_card_mutations_one_pending index.
    .gte("created_at", new Date(Date.now() - inFlightWindowMs(ctx.env)).toISOString())
    .limit(1);
  // FAIL CLOSED (audit P0-5). This guard exists to stop a second full-document write racing an
  // unresolved first one; waving requests through because the ledger cannot be read makes it
  // decoration exactly when things are already going wrong. (The org cap above normally fails
  // closed first — this is the same posture, kept locally so a refactor cannot separate them.)
  if (error) {
    throw new CardControlError(
      "Card changes are paused because the change log is unavailable. Try again shortly.",
      "org_hourly_cap_reached",
      503,
      { reason: "ledger_unavailable" },
    );
  }
  if (data && data.length > 0) {
    throw new CardControlError(
      "Another change to this card is still being confirmed. Wait for it to finish, then try again.",
      "mutation_in_flight",
      409,
      { mutationId: (data[0] as { id: string }).id },
    );
  }
}
