import type { z } from "zod";
import { type CapabilityContract, cardLockContract, cardUnlockContract, deleteOverrideContract, overrideClearContract, overrideGrantContract, promptsSetContract } from "@fuelguard/shared";
import { cardLockBehaviour } from "./capabilities/cardLock.behaviour.js";
import { cardUnlockBehaviour } from "./capabilities/cardUnlock.behaviour.js";
import { overrideGrantBehaviour } from "./capabilities/overrideGrant.behaviour.js";
import { deleteOverrideBehaviour, overrideClearBehaviour } from "./capabilities/overrideClear.behaviour.js";
import { promptsSetBehaviour } from "./capabilities/promptsSet.behaviour.js";
import { resolveCapability } from "./orchestrator/resolve.js";
import { executeCapability } from "../services/efsCardControl.js";
import type { CardMutationContext, CardMutationOutcome } from "./orchestrator/types.js";
import type { CapabilityBehaviour, Landing, ReadCtx, Snapshot } from "./types.js";
import type { CardEdit } from "../lib/efsCardEcho.js";
import type { Env } from "../env.js";

/**
 * Contract + behaviour, paired by key, packaged so the router can serve them without knowing any
 * capability's body type.
 *
 * ── Why the generic disappears HERE and nowhere else ─────────────────────────────────────────────
 * Each capability's body is a different `z.infer`, so a list of them has no single element type. The
 * usual escape is a `ResolvedCapability<unknown>` and a cast at every call site — which does not even
 * typecheck, because `buildEdits(doc, body)` makes the type an input position.
 *
 * Instead `mount` closes over the generic completely: it parses with the contract's own schema and
 * hands back a `run` that already knows what it is running. The router sees `unknown` in and an
 * outcome out, and there is no cast anywhere in the chain — which is the point, since the value being
 * widened would be the request body of a write against a real fuel card.
 */
/** What the prover needs off a proof plan, with the body type widened away. */
export interface RegisteredProof {
  precondition: (snap: Snapshot) => boolean;
  sample: (snap: Snapshot) => unknown;
  revert: (snap: Snapshot) => { capability: string; body: unknown };
}

export interface MountedCapability {
  contract: CapabilityContract<z.ZodTypeAny>;
  /**
   * The capability's proof plan (Step 4.5), or null when it has none.
   *
   * Structurally typed rather than `ProofPlan<TBody>`, and that is what makes it assignable without
   * a cast: the prover never needs the body's type — it hands `sample()`'s output straight back to
   * `accept()`, which parses it with the contract's own schema. Widening the return to `unknown`
   * here is safe in a way that casting to `ProofPlan<never>` is not.
   *
   * Derived through `mount` so there is no second hand-maintained map. A capability missing from
   * such a map is one the prover cannot resolve — which reports OEG-5 false on a revert that never
   * dispatched, and leaves a QA card changed.
   */
  proof: RegisteredProof | null;
  /** Validate a request body. Returns what the route needs, or the schema's own error. */
  accept: (raw: unknown) => AcceptedRequest | { ok: false; error: z.ZodError };
  /**
   * How a settled-but-unverified row of this capability is judged LATER, by the background sweep.
   *
   * Non-generic on purpose: the reconciler reads its inputs out of jsonb columns, so there is no
   * parsed body to be generic over. It reads the card through the capability's OWN `snapshot`,
   * which is what lets a capability whose state lives outside the card document be reconciled at
   * all (docs/27 §5.2).
   */
  reconcile: ReconcilePlan | null;
}

export interface ReconcilePlan {
  snapshot: (ctx: ReadCtx) => Promise<Snapshot>;
  judge: (after: Snapshot, edits: readonly CardEdit[], body: unknown) => Landing;
}

export interface AcceptedRequest {
  ok: true;
  /**
   * The sentence to show if this request needs a fresh sign-in, or null. Answered BEFORE `prepare()`
   * so a refusal never spends a rate-limit slot (docs/27 §5, prepare step 6).
   */
  stepUpMessage: string | null;
  expectedVersion: string;
  reason: string;
  /** The sanitized body the Idempotency-Key fingerprint is taken over. */
  fingerprintBody: Record<string, unknown>;
  run: (ctx: CardMutationContext) => Promise<CardMutationOutcome>;
}

/** Every card contract's schema produces these two; the route reads them without knowing the rest. */
interface CardMutationRequestFields {
  expectedVersion: string;
  reason: string;
}

export const mount = <TBody extends CardMutationRequestFields>(
  contract: CapabilityContract<z.ZodType<TBody>>,
  behaviour: CapabilityBehaviour<TBody>,
): MountedCapability => ({
  contract,
  proof: behaviour.proof ?? null,
  accept: (raw) => {
    const parsed = contract.schema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error };
    const body = parsed.data;
    return {
      ok: true,
      stepUpMessage: behaviour.preflightStepUp?.(body) ?? null,
      expectedVersion: body.expectedVersion,
      reason: body.reason,
      fingerprintBody: Object.fromEntries(Object.entries(body)),
      run: (ctx) => executeCapability(ctx, resolveCapability(contract, behaviour, body)),
    };
  },
  reconcile: behaviour.verify.reconcile
    ? { snapshot: behaviour.verify.snapshot, judge: behaviour.verify.reconcile }
    : null,
});

/**
 * Contract and behaviour for every capability that EXISTS, mounted or not.
 *
 * `override_clear` and `delete_override` are both here and only one is ever served: they are the two
 * mechanisms of one intent, and `mountedCapabilities` picks. Keeping the unmounted one in this table
 * is what lets the fitness test check it — a capability nothing can reach is still a capability that
 * must declare a valid bucket, scope and (being direct) its `vendorMovesFields`.
 */
export const ALL_CAPABILITIES: readonly MountedCapability[] = [
  mount(cardLockContract, cardLockBehaviour),
  mount(cardUnlockContract, cardUnlockBehaviour),
  mount(overrideGrantContract, overrideGrantBehaviour),
  mount(overrideClearContract, overrideClearBehaviour),
  mount(deleteOverrideContract, deleteOverrideBehaviour),
  mount(promptsSetContract, promptsSetBehaviour),
];

/**
 * Every capability's behaviour, keyed by contract key, derived from `ALL_CAPABILITIES`.
 *
 * Derived rather than hand-listed, and that is the whole point: a second literal map would be a
 * fourth place a capability has to be registered, and the fourth one to be forgotten is a capability
 * the prover silently cannot resolve — reporting OEG-5 false on a revert that never dispatched.
 * Includes the unmounted clear mechanism deliberately, because `delete_override` is exactly the
 * capability a proof run is meant to characterise before it is ever mounted (finding D1).
 */
export const capabilityRegistry = (): Readonly<Record<string, MountedCapability>> =>
  Object.fromEntries(ALL_CAPABILITIES.map((c) => [c.contract.key, c]));

/**
 * What the router actually serves, for one deployment.
 *
 * The only place that answers "which mechanism clears an override". It was an `if` inside the
 * handler; making it a property of the registry is what gives **Step 4.2** somewhere to put the
 * promotion lookup when it retires `EFS_CARD_DELETE_OVERRIDE_ENABLED` — the flag becomes a
 * `delete_override` promotion state and this function reads that instead.
 *
 * The flag stays off until the D1 probe proves the account is entitled to the op and records what
 * EFS actually sets the three override fields to afterwards (fix plan D1).
 */
export function mountedCapabilities(env: Env): readonly MountedCapability[] {
  const clearKey = env.EFS_CARD_DELETE_OVERRIDE_ENABLED ? "delete_override" : "override_clear";
  const mounted = ALL_CAPABILITIES.filter((c) => !isClearMechanism(c) || c.contract.key === clearKey);
  // Two capabilities on one method+path is a coin toss decided by registration order, and the loser
  // is silently unreachable. Refuse to build the router at all rather than serve whichever won.
  const seen = new Set<string>();
  for (const c of mounted) {
    const route = `${c.contract.route.method} ${c.contract.route.path}`;
    if (seen.has(route)) throw new Error(`two capabilities are mounted on ${route}`);
    seen.add(route);
  }
  return mounted;
}

const isClearMechanism = (c: MountedCapability): boolean =>
  c.contract.key === "override_clear" || c.contract.key === "delete_override";

/**
 * Find the reconcile plan for a `capability_key` read out of the ledger.
 *
 * Searches ALL_CAPABILITIES, not the mounted list. A row written by `delete_override` must still be
 * reconcilable after the flag flips and that mechanism stops being served — the write happened, and
 * un-mounting a capability cannot retroactively make its unverified rows unanswerable.
 *
 * Null for a key nothing declares: a row written by a capability that has since been deleted is a
 * question this code can no longer answer, and guessing with another capability's predicate would
 * settle it wrongly rather than leave it visible.
 */
export const reconcilePlanFor = (capabilityKey: string): ReconcilePlan | null =>
  ALL_CAPABILITIES.find((c) => c.contract.key === capabilityKey)?.reconcile ?? null;
