import { CARD_MUTATIONS_PER_HOUR_DEFAULT, type CardMutationIntent, type Target } from "@fuelguard/shared";
import type { Env } from "../../env.js";
import { CardControlError } from "../../services/efsCardControlErrors.js";
import { mutationLedgerEvidence } from "../../services/efsCardMutationEvidence.js";
import { CardMutationReplay, type CardMutationContext, type CardMutationOutcome } from "./types.js";
import type { CardEdit } from "../../lib/efsCardEcho.js";
import type { CardDocument } from "../../lib/efsCardXml.js";

/**
 * The one place that writes the mutation ledger — and the seam a second target kind would slot into.
 *
 * ── This is a seam, not a second table (docs/27 §5.2) ────────────────────────────────────────────
 * `efs_card_mutations` keys on `efs_card_id`, so it can only record a mutation of a CARD. No
 * account-scoped operation is scheduled: `LocGrp*` is conditional on the account using location
 * groups, `setPolicy` is an explicit non-goal, ordering is speculative. Building `efs_object_mutations`
 * now would be an abstraction accommodating cases that do not exist in code, so it is not built. What
 * is built is the interface, and `insertPending` REFUSES a non-card target rather than contorting one
 * into a card row — which is what makes docs/27 §12's claim ("non-card operations are shut out until
 * the second LedgerAdapter exists") true rather than aspirational.
 *
 * When the first account-scoped op arrives the work is bounded and known: a second implementation
 * over a table with these columns minus `expected_version` / `before_document` / `after_document`,
 * plus `target_kind` / `target_ref`, and a one-in-flight index on the pair. Write that down; do not
 * build it.
 *
 * ── Deviation from the illustrative interface in docs/27 §5.2 ────────────────────────────────────
 * That sketch lists `findReplay` as a method. Here it is private: the only caller is `insertPending`'s
 * unique-violation branch, and exposing it would invite a read-then-write replay check, which is a
 * race by construction — the very thing the index exists to prevent. The capacity assertions are two
 * methods rather than none because both are ledger COUNTS, and both fail closed.
 */
export interface LedgerAdapter {
  /** The org-wide hourly ceiling. Fail-closed. */
  assertOrgCapacity(ctx: CardMutationContext): Promise<void>;
  /** Refuse a second mutation while one is unresolved on the same target. Fail-closed. */
  assertNoneInFlight(ctx: CardMutationContext): Promise<void>;
  /** Opens the row BEFORE anything is dispatched. Throws CardControlError or CardMutationReplay. */
  insertPending(ctx: CardMutationContext, row: PendingRow): Promise<{ id: string }>;
  /** One call per step. `stepIndex` is null for a capability that is not a sequence. */
  markSent(ctx: CardMutationContext, mutationId: string, stepIndex: number | null): Promise<void>;
  /** The terminal write. Loud on failure, never fatal — see the note on the implementation. */
  settle(ctx: CardMutationContext, mutationId: string, patch: Record<string, unknown>): Promise<void>;
}

/**
 * What opening a row needs, and nothing more.
 *
 * The capability's four identifying facts rather than the capability itself: the ledger has no
 * business holding a `buildEdits` or a `dispatch`, and taking the whole descriptor would mean casting
 * away its body type at every call site for the sake of fields the ledger never reads.
 */
export interface PendingRow {
  intent: CardMutationIntent;
  capabilityKey: string | null;
  requestBody: Record<string, unknown> | null;
  target: Target;
  before: CardDocument;
  edits: readonly CardEdit[];
}

export const cardLedger = (): LedgerAdapter => ({
  assertOrgCapacity,
  assertNoneInFlight,
  insertPending,
  markSent: async (ctx, mutationId, stepIndex) => {
    await ctx.admin
      .from("efs_card_mutations")
      // `attempts: 1` counts DISPATCH attempts of the row, and a sequence is still one attempt at one
      // mutation — a step is not a retry. `step_index` stays null for a single-step capability, so a
      // reader can tell "step 0 of a sequence" from "not a sequence at all".
      .update({ status: "sent", attempts: 1, ...(stepIndex === null ? {} : { step_index: stepIndex }) })
      .eq("id", mutationId)
      .eq("org_id", ctx.orgId);
  },
  settle: async (ctx, mutationId, patch) => {
    const { error } = await ctx.admin
      .from("efs_card_mutations")
      .update({ ...patch, completed_at: new Date().toISOString() })
      .eq("id", mutationId)
      .eq("org_id", ctx.orgId);
    // Loud, and not fatal. The vendor call already happened; failing the request now would tell the
    // operator nothing happened when something did.
    if (error) console.error(`[card-control] could not settle mutation ${mutationId}: ${error.message}`);
  },
});

async function insertPending(ctx: CardMutationContext, row: PendingRow): Promise<{ id: string }> {
  const { before, edits } = row;
  if (row.target.kind !== "card") {
    // Fail closed, and say why. The alternative — writing the row anyway with a null `efs_card_id` —
    // would put an unkeyed mutation in the card ledger and defeat the one-in-flight index for every
    // card at once.
    throw new CardControlError(
      "That operation is not supported yet.",
      "unsupported_target",
      501,
      { targetKind: row.target.kind },
    );
  }

  // The row exists BEFORE dispatch. If this process dies mid-write, what remains is a visible
  // 'pending' row naming the card, the intent and the person — not silence.
  const { data, error } = await ctx.admin
    .from("efs_card_mutations")
    .insert({
      org_id: ctx.orgId,
      efs_card_id: ctx.efsCardId,
      intent: row.intent,
      capability_key: row.capabilityKey,
      request_body: row.requestBody,
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

  return { id: (data as { id: string }).id };
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
async function assertOrgCapacity(ctx: CardMutationContext): Promise<void> {
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

/** Everything one orchestration can legitimately take: read + write + two verify reads, each on its
 *  own interactive deadline, plus the second-look pause, plus pacing margin. */
function inFlightWindowMs(env: Env): number {
  const perCall = env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS ?? 10_000;
  const secondLook = env.EFS_CARD_VERIFY_RETRY_MS ?? 3_000;
  return 4 * perCall + secondLook + 15_000;
}

/**
 * Refuse a second mutation while one is unresolved on the SAME card.
 *
 * `expectedVersion` already stops two dispatchers changing a card from the same stale screen, but it
 * cannot stop a second write dispatched while the first is still in flight — both read the same
 * version. A card with a 'pending' or 'sent' row has an outcome nobody knows yet, and stacking a
 * second write on top of an unknown is how a card ends up in a state nobody can explain.
 */
async function assertNoneInFlight(ctx: CardMutationContext): Promise<void> {
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
    //
    // 'partial' is deliberately NOT in this list. It is terminal, it can be days old, and a card that
    // half-applied a sequence is exactly the card an operator needs to be able to act on next.
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
