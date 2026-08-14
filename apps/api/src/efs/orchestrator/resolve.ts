import type { z } from "zod";
import type { CapabilityContract } from "@fuelguard/shared";
import { getCardV2 } from "../../lib/efsCardOps.js";
import { deleteOverrideOp } from "../../lib/efsCardWrite.js";
import { cardEchoVerify } from "../cardEchoVerify.js";
import type { CapabilityBehaviour, Mutation, VerifyPlan } from "../types.js";
import type { CardMutationIntentSpec, CardMutationVendorOp, ResolvedCapability } from "./types.js";

/**
 * Bind a contract to its behaviour and one request body — the registry path.
 *
 * The two halves are paired by KEY in the registry and joined here, which is why neither stores a
 * reference to the other: a stored link is a second pairing that can drift from the first.
 *
 * `governance` is the behaviour itself. `CapabilityBehaviour extends Governance`, so spreading the
 * fields into a fresh object would mean listing them — and a governance field added to the type but
 * forgotten in that list is a gate that silently stops running, which is the failure this codebase
 * has already produced five times (docs/29 §7).
 */
export function resolveCapability<TBody>(
  contract: CapabilityContract<z.ZodTypeAny>,
  behaviour: CapabilityBehaviour<TBody>,
  body: TBody,
): ResolvedCapability<TBody> {
  return {
    intent: contract.intent,
    capabilityKey: contract.key,
    requestBody: ledgerBody(contract, body),
    auditAction: contract.auditAction,
    target: behaviour.target,
    mutation: behaviour.mutation,
    verify: behaviour.verify,
    governance: behaviour,
    vendorMovesFields: behaviour.vendorMovesFields ?? [],
    body,
  };
}

/**
 * The request as the ledger records it, so a reconciler can re-run `verify.judge` against what was
 * actually asked for rather than guessing from the after-state (docs/27 §5.2).
 *
 * `carriesSecret` means the default redaction does not cover this body — a PIN, a password. Nothing
 * is stored in that case, rather than storing a guess about which field is the secret. The
 * cross-registry fitness test pairs `carriesSecret` with an overridden `redactResponse`; this is the
 * same posture applied to the column.
 */
function ledgerBody<TBody>(
  contract: CapabilityContract<z.ZodTypeAny>,
  body: TBody,
): Record<string, unknown> | null {
  if (contract.carriesSecret) return null;
  if (!body || typeof body !== "object") return null;
  return Object.fromEntries(Object.entries(body));
}

/**
 * Translate a pre-capability `CardMutationIntentSpec` into the vocabulary the orchestrator now speaks.
 *
 * ── Why an adapter rather than five rewrites in one commit ───────────────────────────────────────
 * Step 3.4's exit criterion is that `fuelCardsControl.characterisation.test.ts` passes BYTE-
 * IDENTICALLY: the same five routes, the same five request bodies, down to element order. Rewriting
 * the orchestrator and the five call sites together would make a byte difference ambiguous — the new
 * dispatch, or the new descriptor? Here the routes are untouched, so a difference can only be the
 * orchestrator, which is the whole point of writing the characterisation suite first (docs/27 §10).
 *
 * 3.5 migrates `card_lock` to a real descriptor, 3.6 the remaining four, and 3.7 deletes both this
 * function and `CardMutationIntentSpec`.
 *
 * ── What this deliberately does NOT lift out ─────────────────────────────────────────────────────
 * `governance.planStepUp` and `governance.precondition` stay undefined, and the refusals that belong
 * in them stay inside `buildEdits`, where the unlock-from-Fraud check and the DRID-removal check
 * throw `ActionRefusalError` today. Both must fire after the fresh read and before the ledger row
 * opens, and that is exactly where `buildEdits` is called. Splitting them out is a per-capability
 * decision with a per-capability test, so it happens in 3.5 and 3.6 — moving them here would be a
 * behaviour change smuggled into a refactor whose gate cannot see it.
 */
export function resolveIntentSpec(spec: CardMutationIntentSpec): ResolvedCapability<void> {
  const { vendorOp } = spec;
  return {
    intent: spec.intent,
    // Null, honestly: these routes have no descriptor to name. 3.5 fills it in per capability, and
    // a null `capability_key` on a row is how a reader tells a pre-registry mutation from a
    // registry-driven one.
    capabilityKey: null,
    requestBody: null,
    auditAction: spec.auditAction,
    target: { kind: "card" },
    mutation: vendorOp ? directMutation(vendorOp) : { kind: "echo", buildEdits: (doc) => spec.buildEdits(doc) },
    verify: vendorOp ? vendorOpVerify(vendorOp) : cardEchoVerify<void>(),
    governance: {
      auditMeta: (snap) => (snap.doc ? spec.auditMeta?.(snap.doc) ?? {} : {}),
    },
    vendorMovesFields: vendorOp?.movesFields ?? [],
    body: undefined,
  };
}

/**
 * The dedicated vendor op, as a `direct` mutation.
 *
 * The switch has one arm and is a switch anyway: `CardMutationVendorOp.op` is a union so the next op
 * extends rather than forks, and an `if` here would quietly accept a second value by dispatching
 * `deleteOverride` for it. The exhaustive default is the difference between adding an op and
 * mis-sending one.
 */
function directMutation(vendorOp: CardMutationVendorOp): Mutation<void> {
  switch (vendorOp.op) {
    case "deleteOverride":
      // `ctx.opts` arrives already built — the capability cannot choose `retry`, its pacing lane or
      // its deadline, which is what keeps "a write is never retried" unconditional (docs/27 §4).
      return { kind: "direct", dispatch: (ctx) => deleteOverrideOp(ctx.env, ctx.creds, ctx.cardNumber, ctx.opts) };
    default: {
      const unreachable: never = vendorOp.op;
      throw new Error(`unknown card vendor op: ${String(unreachable)}`);
    }
  }
}

/**
 * A vendor op has no edit paths to compare, so its own predicate answers "did it land" —
 * deliberately tolerant of every clear-shape (0 / nil / absent) until the probe pins one down.
 *
 * `indeterminate` when the re-read produced no document, matching `cardEchoVerify`: "we could not
 * tell" is a different fact from "it did not land", and the orchestrator settles them differently.
 */
const vendorOpVerify = (vendorOp: CardMutationVendorOp): VerifyPlan<void> => ({
  snapshot: async (ctx) => ({ doc: await getCardV2(ctx.env, ctx.creds, ctx.cardNumber, ctx.opts) }),
  judge: (_before, after) => {
    if (!after.doc) return "indeterminate";
    return vendorOp.landed(after.doc) ? "landed" : "not_landed";
  },
});
