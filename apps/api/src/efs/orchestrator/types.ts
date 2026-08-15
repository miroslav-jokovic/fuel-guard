import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardMutationIntent } from "@fuelguard/shared";
import type { Target } from "@fuelguard/shared";
import type { Env } from "../../env.js";
import type { CardEdit } from "../../lib/efsCardEcho.js";
import type { CardDocument } from "../../lib/efsCardXml.js";
import type { EfsSoapCredentials } from "../../services/efsSoapCredentials.js";
import type { Governance, Mutation, Snapshot, Step, VerifyPlan } from "../types.js";

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
  reason: string;
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
}
