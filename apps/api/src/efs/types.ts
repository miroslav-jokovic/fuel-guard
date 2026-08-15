import type { z } from "zod";
import type { CapabilityContract, Target } from "@fuelguard/shared";
import type { Env } from "../env.js";
import type { CardEdit } from "../lib/efsCardEcho.js";
import type { CardOpOptions } from "../lib/efsCardOps.js";
import type { SetCardResult } from "../lib/efsCardWrite.js";
import type { CardDocument } from "../lib/efsCardXml.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";

/**
 * The BEHAVIOUR half of a capability: how the write is produced and how landing is judged.
 *
 * API-side, because everything here touches a card document, an edit list or the vendor. The
 * contract stays browser-safe next door in `@fuelguard/shared`; this is the half the orchestrator
 * executes (docs/27 §3, §6.2).
 *
 * ── What a capability may NOT do, and why that is a type and not a rule ─────────────────────────
 * The capability is data plus pure-ish functions. The orchestrator owns every side effect except the
 * vendor call itself, and several of the invariants in docs/27 §4 are enforced right here in the
 * shapes rather than by review:
 *
 *   • `verify` is REQUIRED, so a capability cannot ship without a way to tell whether it landed.
 *   • `direct.dispatch` RECEIVES its opts and never constructs them, so `retry: false` and the
 *     pacing lane cannot become per-capability discretion.
 *   • `sequence` cannot nest — the step's mutation is `Exclude<…, { kind: "sequence" }>`.
 *   • No DB handle reaches a capability at all, so the ledger-before-dispatch ordering stays the
 *     orchestrator's to keep.
 *
 * Nothing consumes these yet. 3.4 teaches the orchestrator to speak this vocabulary; 3.5 migrates
 * `card_lock` and 3.6 the remaining four.
 */

/** What a capability may use to READ. No writer, no database, no logger. */
export interface ReadCtx {
  env: Env;
  creds: EfsSoapCredentials;
  cardNumber: string;
  /** Constructed by the orchestrator — pacing lane, deadline, retry policy. */
  opts: CardOpOptions;
}

/** What `direct.dispatch` is handed. Identical to ReadCtx by design: a capability that can dispatch
 *  still cannot decide HOW, because `opts` arrives already built. */
export type DispatchCtx = ReadCtx;

/** What a post-read step-up decision may consult beyond the snapshot. */
export interface PlanCtx {
  env: Env;
  /** Whether the caller already presented a fresh re-authentication on this request. */
  stepUp: boolean;
}

/**
 * The state a verification compares, from ops the capability NAMED ITSELF.
 *
 * This is the axis the previous design could not express. `setCardRefreshingLimits` writes state that
 * is not in the card document, so its snapshot is `getCardv2` PLUS `getCardRefreshingLimits`. Letting
 * the capability choose its own reads is what removes the need for a third and fourth "kind".
 */
export interface Snapshot {
  /** Present when `target.kind === "card"`. */
  doc: CardDocument | null;
  extra?: unknown;
}

/**
 * Three-valued on purpose.
 *
 * The current code returns a boolean and then patches "we could not tell" with a second-look retry.
 * Making indeterminacy explicit means the second look fires for the right reason — and a capability
 * that genuinely cannot judge, like an ordering op whose fulfilment horizon is days, can say so
 * instead of lying in one direction.
 */
export type Landing = "landed" | "not_landed" | "indeterminate";

export interface VerifyPlan<TBody> {
  /** Names its OWN read ops. */
  snapshot: (ctx: ReadCtx) => Promise<Snapshot>;
  judge: (before: Snapshot, after: Snapshot, body: TBody, edits: readonly CardEdit[]) => Landing;
  /**
   * The same question asked LATER, by the background reconciler, with no before-state to compare to.
   *
   * ── Why this is not just `judge` with a stored `before` ──────────────────────────────────────────
   * `judge` answers "did the edits land, given what the card looked like a moment ago". Hours later
   * that is the wrong question: the ledger stores `before_document` as the typed view, not the raw
   * DOM `intentLanded` diffs against, and even with the DOM the card has legitimately moved since.
   * What the reconciler can honestly ask is "does the card NOW carry what was asked", which is an
   * AFTER-ONLY predicate — `editsLanded` for an echo, the op's own predicate for a direct write.
   *
   * REQUIRED in practice, and the fitness test says so: a capability without one is a capability
   * whose unverified rows sit on an operator's "Unverified" list forever. That is what happened to
   * every `direct` mutation until Step 3.9 — they record no edits, and the reconciler skipped any
   * row with an empty edit list.
   *
   * `body` arrives as `unknown` because it comes back out of a jsonb column. A capability that needs
   * it must PARSE it, never cast: nothing guarantees the row was written by today's schema.
   */
  reconcile?: (after: Snapshot, edits: readonly CardEdit[], body: unknown) => Landing;
}

/**
 * How the write is produced.
 *
 * `echo` is the ONLY kind that touches the echo engine, and it gets `assertEchoFidelity`, the
 * `replaceAll` preservation assertion and WSCardv2 sequence checking for free. Nothing else does, and
 * nothing else needs to — which is the point of naming the kinds rather than branching on operation.
 */
export type Mutation<TBody> =
  | { kind: "echo"; buildEdits: (doc: CardDocument, body: TBody) => CardEdit[] }
  | { kind: "direct"; dispatch: (ctx: DispatchCtx, body: TBody) => Promise<SetCardResult> }
  | { kind: "sequence"; steps: readonly Step<TBody>[] };

export interface Step<TBody> {
  /** Shown to the operator when a sequence half-fails. The UI names the STEP, never a number. */
  label: string;
  mutation: Exclude<Mutation<TBody>, { kind: "sequence" }>;
  /** Each step is judged independently — that is what makes a `partial` outcome recoverable. */
  verify: VerifyPlan<TBody>;
}

/**
 * Who may, when, and how loudly.
 *
 * ── The step-up split is not cosmetic ───────────────────────────────────────────────────────────
 * The three gates that exist today fire at different times with different inputs: override-uses
 * needs the body only and must run BEFORE a rate-limit slot is spent; unlocking a Fraud-flagged card
 * needs the card's CURRENT status rather than the mirror's; DRID removal needs the computed
 * `removedInfoIds` and the caller's `allowRemoveDriverId` together.
 *
 * A single `stepUp(body, doc?)` called once up front makes two of those three silently disappear
 * while every field is still present and every fitness assertion still passes. Splitting them makes
 * the timing a type-level fact.
 */
export interface Governance<TBody> {
  /**
   * Body only. Runs BEFORE prepare(), so a refusal never spends a rate-limit slot.
   *
   * Returns the SENTENCE the operator should read, or null to allow. Not a boolean: the two gates
   * that exist say different things — "Confirm your password to grant more than 3 uses" and "This
   * card is flagged for fraud" — and a gate that fires with the wrong sentence sends a person to the
   * wrong place, which is the same reason `refusal()` has one sentence per blocked-by reason. A
   * boolean would have forced a generic message built from the contract's verb, and both of the real
   * gates would have lost the thing that makes them actionable.
   */
  preflightStepUp?: (body: TBody) => string | null;
  /** Runs AFTER the fresh read, with everything the decision actually needs. Same string-or-null. */
  planStepUp?: (ctx: PlanCtx, snap: Snapshot, body: TBody) => string | null;
  /**
   * Throws ActionRefusalError. Runs after the fresh read, before buildEdits.
   *
   * Takes `PlanCtx` as well as the snapshot, which docs/27 §3.4's sketch did not. The first real
   * precondition is `prompts_set`'s removal check, and it needs three facts at once: which records
   * the change would REMOVE (computed from the fresh document), the caller's explicit
   * `allowRemoveDriverId`, and whether they re-authenticated. Splitting the fresh-auth half into
   * `planStepUp` would mean two call sites for one rule, and the rule raises two DIFFERENT refusals
   * — a missing opt-in is `invalid_request`, a missing password is `step_up_required` — so the split
   * version has to keep them in step by hand. One call, one rule.
   */
  precondition?: (ctx: PlanCtx, snap: Snapshot, body: TBody) => void;
  auditMeta?: (snap: Snapshot, body: TBody) => Record<string, unknown>;
  /** Defaults to redactCardXml. MANDATORY when the contract sets `carriesSecret`. */
  redactRequest?: (xml: string) => string;
  redactResponse?: (xml: string) => string;
}

export interface CapabilityBehaviour<TBody> extends Governance<TBody> {
  target: Target;
  mutation: Mutation<TBody>;
  /** Required, not optional: every write is followed by a verifying re-read. */
  verify: VerifyPlan<TBody>;
  /**
   * Header fields a `direct` mutation is EXPECTED to move, recorded as vendor-maintained drift.
   *
   * Not optional decoration. A `direct` step names its own op and produces no edits, so nothing tells
   * the drift classifier which fields that op owns — and a capability that omits this reports its own
   * successful write as unexplained drift on every run. Step 3.4's first green two-step sequence came
   * back `drift_detected` for exactly this reason; `orchestrator.test.ts` keeps the case.
   *
   * Capability-level rather than step-level because drift is judged ONCE, across the whole mutation:
   * from the document the plan opened to the one the last step left behind.
   */
  vendorMovesFields?: readonly string[];
}

/**
 * Bind a behaviour to its contract so the body type flows from one z.infer.
 *
 * The contract argument is consumed for INFERENCE only. It is not stored, because the registry pairs
 * the two by key and storing it here would create a second, divergable link.
 *
 * ── This did not work until Step 3.5, and nothing noticed ────────────────────────────────────────
 * The signature was `<TContract extends CapabilityContract<never>, TBody>`. Two faults in one line:
 * `CapabilityContract<never>` is not a supertype of any real contract — `TSchema` appears as
 * `schema: TSchema`, so the first real capability failed to compile against it — and `TBody` was a
 * FREE parameter inferred from the behaviour alone. The contract could not constrain the body it was
 * supposedly binding, which is precisely the claim docs/27 §7.3 makes and `types.test.ts` did not
 * check. Deriving `z.infer<TSchema>` here makes the claim true: a behaviour whose `buildEdits` takes
 * a body the contract's schema cannot produce now fails `pnpm typecheck`.
 */
export const defineBehaviour = <TSchema extends z.ZodTypeAny>(
  _contract: CapabilityContract<TSchema>,
  behaviour: CapabilityBehaviour<z.infer<TSchema>>,
): CapabilityBehaviour<z.infer<TSchema>> => behaviour;
