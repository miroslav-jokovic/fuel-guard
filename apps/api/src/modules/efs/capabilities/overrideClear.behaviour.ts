import {
  type OverrideClearBody,
  deleteOverrideContract,
  overrideClearContract,
} from "@silvicom/shared";
import { getCardV2 } from "../lib/efsCardOps.js";
import { deleteOverrideOp } from "../lib/efsCardWrite.js";
import { OVERRIDE_FIELDS, overrideClearEdits, overrideClearedLanded } from "../services/efsCardEdits.js";
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

  /**
   * **Undone by `override_grant`** — the third and last capability whose revert is another one.
   *
   * The mirror image of the grant's plan, and it needs a card that HAS an override to clear. On a
   * fleet where exactly one card in 234 carries a nonzero count, the precondition will usually void
   * the run — correctly. Proving a clear against a card with nothing to clear is the same error as
   * proving a lock against a held card: the write is dispatched, the re-read shows zero uses, and
   * `overrideClearedLanded` reports success for a write that changed nothing.
   *
   * The revert restores exactly the count observed, so a proof run leaves the card carrying the same
   * exception it arrived with rather than a fresh one.
   */
  proof: {
    precondition: (snap) => (snap.doc?.card.overrideUses ?? 0) > 0,
    sample: (): OverrideClearBody => ({ expectedVersion: "" }),
    revert: (snap) => ({
      capability: "override_grant",
      body: {
        uses: snap.doc?.card.overrideUses ?? 1,
        scope: { kind: "all" },
        expectedVersion: "",
      },
    }),
  },

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

  /**
   * The capability that most needs a proof run, and the reason it is flag-gated (finding D1).
   *
   * `deleteOverride`'s POST-STATE IS UNDOCUMENTED. The guide says what the op does (p27), not what it
   * writes into the override trio — 0, nil, or the elements removed entirely — which is why
   * `overrideClearedLanded` is deliberately tolerant of all three and why the flag defaults false.
   * A proof run is exactly the instrument that replaces that tolerance with an observation: it
   * records the after-document, so the three shapes stop being equally plausible.
   *
   * Same plan as the echo clear, because it is the same intent by a different mechanism: needs a
   * card carrying an override, and hands the count back through `override_grant`.
   */
  proof: {
    precondition: (snap) => (snap.doc?.card.overrideUses ?? 0) > 0,
    sample: (): OverrideClearBody => ({ expectedVersion: "" }),
    revert: (snap) => ({
      capability: "override_grant",
      body: {
        uses: snap.doc?.card.overrideUses ?? 1,
        scope: { kind: "all" },
        expectedVersion: "",
      },
    }),
  },
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
