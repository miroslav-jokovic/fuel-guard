import type { z } from "zod";
import { type CapabilityContract, cardLockContract, cardUnlockContract } from "@fuelguard/shared";
import { cardLockBehaviour } from "./capabilities/cardLock.behaviour.js";
import { cardUnlockBehaviour } from "./capabilities/cardUnlock.behaviour.js";
import { resolveCapability } from "./orchestrator/resolve.js";
import { executeCapability } from "../services/efsCardControl.js";
import type { CardMutationContext, CardMutationOutcome } from "./orchestrator/types.js";
import type { CapabilityBehaviour } from "./types.js";

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
export interface MountedCapability {
  contract: CapabilityContract<z.ZodTypeAny>;
  /** Validate a request body. Returns what the route needs, or the schema's own error. */
  accept: (raw: unknown) => AcceptedRequest | { ok: false; error: z.ZodError };
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
});

/**
 * Every capability the API serves from its descriptor.
 *
 * `card_lock` was the pilot (Step 3.5); Step 3.6 adds the rest one commit at a time. Whatever is
 * still driven by `CardMutationIntentSpec` in `routes/fuelCards/control.ts` has not been migrated
 * yet, and 3.7 deletes the hand-written handlers once nothing is left.
 *
 * The router iterates this. So does the cross-registry fitness test, which is what stops a capability
 * being declared and never mounted — the failure apps/api/src/routeAuth.test.ts documents in
 * "discovers the mounted /api routers", where a discovery regex found 26 routers and silently missed
 * the one that mattered (Phase 0 Step 0.7).
 */
export const MOUNTED_CAPABILITIES: readonly MountedCapability[] = [
  mount(cardLockContract, cardLockBehaviour),
  mount(cardUnlockContract, cardUnlockBehaviour),
];
