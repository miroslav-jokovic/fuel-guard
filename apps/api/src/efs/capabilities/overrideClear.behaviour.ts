import {
  type OverrideClearBody,
  deleteOverrideContract,
  overrideClearContract,
} from "@fuelguard/shared";
import { getCardV2 } from "../../lib/efsCardOps.js";
import { deleteOverrideOp } from "../../lib/efsCardWrite.js";
import { OVERRIDE_FIELDS, overrideClearEdits, overrideClearedLanded } from "../../services/efsCardEdits.js";
import { cardEchoVerify } from "../cardEchoVerify.js";
import { defineBehaviour } from "../types.js";
import type { VerifyPlan } from "../types.js";

/**
 * The two ways to cancel an exception. Same intent, same ledger, same finalizers, different wire.
 *
 * Only one is ever mounted (see `mountedCapabilities`), so these are alternatives rather than a
 * fallback chain: nothing here retries the other mechanism if one fails.
 */

/** Audit meta both mechanisms write, so history reads the same whichever ran. */
const clearMeta = (mechanism: "deleteOverride" | "setCardv2") =>
  (snap: { doc: { card: { overrideUses: number | null } } | null }) => ({
    overrideUsesBefore: snap.doc?.card.overrideUses ?? null,
    overrideUsesAfter: 0,
    // Redundant with `capability_key` on the row and kept anyway: every mutation written before
    // Step 3.6 carries this field, and dropping it would split the history of one intent across two
    // shapes at exactly the point somebody is trying to compare them.
    vendorOp: mechanism,
  });

/** The proven mechanism, and the one that is live today. */
export const overrideClearBehaviour = defineBehaviour(overrideClearContract, {
  target: { kind: "card" },
  mutation: { kind: "echo", buildEdits: () => overrideClearEdits() },
  verify: cardEchoVerify<OverrideClearBody>(),
  auditMeta: clearMeta("setCardv2"),
});

/**
 * A direct op has no edit paths, so its own predicate answers "did it land" — deliberately tolerant
 * of every clear-shape the vendor might choose (0, nil, absent) until the D1 probe pins one down.
 */
const deleteOverrideVerify: VerifyPlan<OverrideClearBody> = {
  snapshot: async (ctx) => ({ doc: await getCardV2(ctx.env, ctx.creds, ctx.cardNumber, ctx.opts) }),
  judge: (_before, after) => {
    if (!after.doc) return "indeterminate";
    return overrideClearedLanded(after.doc) ? "landed" : "not_landed";
  },
  /**
   * Identical to `judge`, and that is the whole point: this op's landing was ALREADY an after-only
   * question, so it reconciles as well hours later as it does live. Until Step 3.9 the reconciler
   * could not ask it — a direct write records no edits, and it skipped every row with an empty edit
   * list, so an unverified `deleteOverride` stayed "Unverified" forever.
   */
  reconcile: (after) => {
    if (!after.doc) return "indeterminate";
    return overrideClearedLanded(after.doc) ? "landed" : "not_landed";
  },
};

export const deleteOverrideBehaviour = defineBehaviour(deleteOverrideContract, {
  target: { kind: "card" },
  /** `ctx.opts` arrives already built, so this cannot choose its own retry policy or pacing lane. */
  mutation: { kind: "direct", dispatch: (ctx) => deleteOverrideOp(ctx.env, ctx.creds, ctx.cardNumber, ctx.opts) },
  verify: deleteOverrideVerify,
  /**
   * NOT optional for a direct mutation. This op moves the three override header fields and produces
   * no edits naming them, so without this the drift classifier reports a perfectly successful clear
   * as unexplained drift on every single run — which is what Step 3.4's first two-step sequence did
   * before anyone had thought about it. apps/api/src/efs/registry.test.ts proves every direct
   * capability declares one, in "declares vendorMovesFields whenever it dispatches a direct op".
   */
  vendorMovesFields: OVERRIDE_FIELDS,
  auditMeta: clearMeta("deleteOverride"),
});
