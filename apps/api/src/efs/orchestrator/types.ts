import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardMutationIntent } from "@fuelguard/shared";
import type { Target } from "@fuelguard/shared";
import type { Env } from "../../env.js";
import type { CardEdit } from "../../lib/efsCardEcho.js";
import type { CardDocument } from "../../lib/efsCardXml.js";
import type { EfsSoapCredentials } from "../../services/efsSoapCredentials.js";
import type { Governance, Mutation, PlanCtx, Snapshot, Step, VerifyPlan } from "../types.js";

/**
 * What one orchestration is, in types. No behaviour, so everything else can import it freely.
 *
 * Lifted out of `efsCardControl.ts` in Step 3.4 for one reason: `ledger.ts` needs `CardMutationReplay`
 * at RUNTIME, and `efsCardControl.ts` needs `ledger.ts` at runtime. Left where they were, the two
 * modules would form a runtime cycle — the kind that resolves to `undefined` at class-extension time
 * under some bundlers and works fine under vitest, which is the worst failure mode available.
 */

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
  /**
   * Who authorised the APPLY, as distinct from who requested it (Step 5.3).
   *
   * `approved_by` has existed on `efs_card_mutations` since migration 0177 with nothing writing it,
   * so every card write in the product's history is unattributable on the question "who said yes".
   * The seam reserved for this — `planCardMutation` / `applyCardMutation` — is already two functions
   * with a re-validated `expected_version` between them, and this is the field that crosses it.
   *
   * Today plan and apply run back to back in one request, so this defaults to `userId` and the
   * mutation is a recorded SELF-approval. That is the honest record of what happened, and it follows
   * migration 0142's precedent for loads, where an org that wants two people sets a flag and
   * `approved_by = created_by` is otherwise a legitimate, recorded outcome. When Phase C adds the
   * approval route, it supplies a different principal here and nothing else has to move — which was
   * the entire point of putting the column in 0177 ahead of the feature.
   */
  approvedBy?: string | null;
  expectedVersion: string;
  idempotencyKey?: string | null;
  /** True when the caller re-authenticated for this action. Recorded as evidence. */
  stepUp?: boolean;
  /**
   * Set ONLY by the live prover (Step 4.5): the `efs_capability_proofs` row this write belongs to.
   *
   * Two effects, and they are deliberately the same fact rather than two flags. The mutation is
   * exempt from the org hourly cap — a six-capability sweep is a dozen writes and would otherwise
   * fail with `org_hourly_cap_reached`, a 429 the proof record cannot distinguish from the vendor
   * refusing — and the ledger row records WHICH proof exempted it. An exemption nobody can attribute
   * is one nobody can audit, so there is no way to claim the first without recording the second.
   */
  proofRunId?: string | null;
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
 * A capability as the orchestrator executes it: the four axes of docs/27 §3, plus the body they are
 * all parameterised by and the two keys the ledger records.
 *
 * The body travels HERE rather than through every call site because the capability's own functions
 * take it as an argument (`buildEdits(doc, body)`, `judge(…, body, …)`), while the legacy specs close
 * over it. Carrying it on the resolved capability is what lets one orchestrator serve both until 3.7.
 */
export interface ResolvedCapability<TBody> {
  /** The COARSE audit key, and the only one the pre-capability routes have. */
  intent: CardMutationIntent;
  /** `efs_card_mutations.capability_key`. Null on the legacy path — those routes have no descriptor. */
  capabilityKey: string | null;
  /** `efs_card_mutations.request_body`, redacted. Null on the legacy path, for the same reason. */
  requestBody: Record<string, unknown> | null;
  auditAction: string;
  target: Target;
  mutation: Mutation<TBody>;
  verify: VerifyPlan<TBody>;
  governance: Governance<TBody>;
  /** Header fields a dedicated vendor op is EXPECTED to move — recorded as vendor-maintained drift. */
  vendorMovesFields: readonly string[];
  body: TBody;
}

/** One unit of dispatch-then-verify. A non-sequence capability is a sequence of exactly one. */
export type ResolvedStep<TBody> = Step<TBody>;

export interface CardMutationPlan<TBody = unknown> {
  mutationId: string;
  capability: ResolvedCapability<TBody>;
  /** The card document the ledger row records, and the baseline drift is measured from. */
  before: CardDocument;
  /**
   * The whole pre-state, `extra` included. `judge` compares snapshots, not documents, so a capability
   * whose state lives outside the card document (`getCardRefreshingLimits`) would silently be judged
   * against half of it if only `before` survived the plan.
   */
  beforeSnapshot: Snapshot;
  /** The FIRST step's edits, built before the ledger row opened. Later steps build their own. */
  edits: CardEdit[];
  auditMeta: Record<string, unknown>;
  /**
   * What `plan` handed the capability's hooks, carried forward so later steps of a sequence build
   * their edits against the SAME resolved editable set as step 0.
   *
   * Re-resolving in `dispatch` would be a second database read that can disagree with the first: an
   * inventory walk finishing mid-sequence would give step 2 a different editable set from step 0,
   * and on a `replaceAll` surface a set that changed between steps decides which records are rebuilt
   * and which are passed through. One resolution per request, or the request is not one decision.
   */
  planCtx: PlanCtx;
}

/**
 * What the settle phase is allowed to see.
 *
 * Deliberately narrower than the plan: nothing in here can dispatch, snapshot or judge, so a
 * finaliser cannot accidentally acquire the power to re-run the write it is recording.
 */
export interface SettleFacts {
  mutationId: string;
  intent: CardMutationIntent;
  before: CardDocument;
  edits: readonly CardEdit[];
  auditMeta: Record<string, unknown>;
  auditAction: string;
  vendorMovesFields: readonly string[];
  /** Null for a single-step capability; the failing step's index for a sequence. */
  stepIndex: number | null;
  /** Named by the capability, shown to the operator when a sequence half-fails. */
  stepLabel: string | null;
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
  /**
   * `partial` is terminal but ACTIONABLE (docs/27 §5.1, migration 0190): a sequenced capability that
   * applied some steps and failed one is not `failed`, and telling an operator it is would send them
   * to re-run steps that already landed.
   */
  status: "succeeded" | "failed" | "drift_detected" | "sent" | "partial";
  /** The card as the verifying re-read found it. Null only when that re-read itself failed. */
  version: string | null;
  driftFields: string[];
  faultCode: string | null;
  faultMessage: string | null;
  /** Set only on `partial`: which step stopped, and what the capability calls it. */
  stepIndex?: number;
  stepLabel?: string;
  /**
   * Milliseconds from the write returning to the re-read that FIRST SAW the change (Step 4.7).
   *
   * Measured inside `verifyStep`, which is the only place that knows which read was the one that
   * saw it. Null unless a step landed — an unlanded write has no apply latency, and zero would be
   * a measurement rather than the absence of one.
   *
   * ── Why this is not "how long the mutation took" ────────────────────────────────────────────────
   * `prove.ts` used to time the whole `dispatch()` call and store the result in a column documented
   * as this interval. That number also carried the planning read, the write itself, the mirror
   * update, the ledger writes and — decisively — the deliberate `EFS_CARD_VERIFY_RETRY_MS` pause.
   * It read 4562 ms against a vendor that applies a status edit in ~850 ms, and the next person to
   * compare the two would have concluded the account had degraded nine-fold.
   *
   * On a sequenced capability this is the LAST landed step's latency, not the sum: the question the
   * column answers is "how long does this vendor take to apply an edit", and a sum answers "how long
   * does this capability take", which is what the ledger's own timestamps already tell you.
   */
  applyLatencyMs?: number | null;
}
