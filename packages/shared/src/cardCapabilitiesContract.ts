import { z } from "zod";

/**
 * Every reason a card change can be unavailable.
 *
 * Extracted from the object in Step 6.1 so the per-capability map below reuses the SAME enum. Two
 * lists would let one grow a reason the other cannot express, and the drawer would then have an
 * operation it can disable and cannot explain — which is the whole of invariant 6.
 */
export const cardBlockedBySchema = z.enum([
  "kill_switch",
  "not_enabled",
  "not_entitled",
  "role",
  "not_approver",
  "no_credentials",
  "endpoint_changed",
  /**
   * Step 4.2. The org may write, and this particular capability has not been promoted here.
   *
   * Distinct from `not_entitled` on purpose: that one means EFS has not confirmed the ACCOUNT
   * may write at all, and sends an admin to run the write check. This one means our own
   * promotion record says nobody has approved this capability for this org yet, and sends them
   * to a proof run. Same 403, two different next actions — which is why every reason in this
   * enum has its own sentence.
   */
  "not_promoted",
  /** Promoted once and switched off since. Reversible by a person, and never by a backfill. */
  "capability_suspended",
]);
export type CardBlockedBy = z.infer<typeof cardBlockedBySchema>;

/**
 * What the client may do, decided by the SERVER. The client never infers this from a role: the answer
 * depends on the org's write entitlement, the deploy kill switch and the approver list, none of which
 * the browser can see.
 */
export const cardCapabilitiesSchema = z.object({
  canLock: z.boolean(),
  canUnlock: z.boolean(),
  canOverride: z.boolean(),
  canSetPrompts: z.boolean(),
  writeEntitlement: z.enum(["unknown", "confirmed", "denied"]),
  blockedBy: cardBlockedBySchema.nullable(),
  /**
   * Why each individual capability is unavailable, keyed by capability key — null meaning "it is".
   *
   * ── Why the four `can*` booleans were not enough (Step 6.1, invariants 6 and 7) ─────────────────
   * They answer at SCOPE granularity, and promotion is per CAPABILITY. The read path deliberately
   * calls `loadCardControlAccess` without a `capabilityKey`, because passing one there would blank
   * the entire card-control UI the moment a single capability were suspended — so until now nothing
   * about promotion reached the browser at all. The consequence was visible on QA, where
   * `override_grant` is correctly unpromoted: the drawer showed "Grant exception", the operator
   * pressed it, and the API answered 403 `card_control_not_promoted`. A button that exists and
   * cannot work is the defect invariant 6 names, and this map is what lets the drawer disable it
   * with the reason attached instead.
   *
   * Keyed by the contract's own `key`, so it spans both `override_clear` mechanisms without the
   * client needing to know which one is mounted.
   */
  capabilityStates: z.record(z.string(), cardBlockedBySchema.nullable()),
  /**
   * Which EFS installation these writes reach — invariant 7's badge.
   *
   * Null when the answer is not established, which is not the same as production: a kill-switched
   * deploy is refused before the credential row is ever read. The header shows a badge for
   * `sandbox` and says nothing for the other two, because "you are about to change a REAL card" is
   * the default assumption an operator should already hold, and a badge on every screen is a badge
   * nobody reads.
   */
  environment: z.enum(["sandbox", "production"]).nullable(),
});
export type CardCapabilities = z.infer<typeof cardCapabilitiesSchema>;
