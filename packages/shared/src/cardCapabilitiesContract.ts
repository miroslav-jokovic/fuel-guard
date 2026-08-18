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
  /** Retiring a card, its own scope since Phase 8.1 / migration 0199 — see cardDeactivate.contract.ts. */
  canDeactivate: z.boolean(),
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
  /**
   * The prompt ids THIS account allows an operator to edit — Step 9.1's client half.
   *
   * ── Why it belongs here and not on `/settings` ──────────────────────────────────────────────────
   * Step 9.1 made the editable set an ACCOUNT fact resolved server-side, cached per org, and
   * threaded to the write path. The browser never received it, so `promptDrafts.ts` went on keying
   * the UI to the hardcoded DRID/UNIT pair: the API accepted twenty-four ids and the drawer offered
   * two. `/settings` was the obvious home and is the wrong one — it is admin-only, while editing
   * prompts is granted by the `prompts` SCOPE, so an approver who may edit prompts and is not an
   * admin would have been shown the fallback pair with nothing saying why.
   *
   * This object is already computed server-side per card, for exactly this class of fact: the
   * browser can see a role but not an entitlement, a kill switch, a promotion state — or an account's
   * prompt catalogue.
   *
   * Never empty. `resolveEditableInfoIds` answers an unread account with the DRID/UNIT fallback
   * rather than nothing, so the client never has to decide what an absent set means — the same
   * guarantee `PlanCtx.editableInfoIds` gives the write path, from the same function.
   */
  editableInfoIds: z.array(z.string()).readonly(),
  /**
   * The product limits THIS account can cap — Step 10.3's client half, and 9.1's lesson applied
   * before the defect rather than after it.
   *
   * 9.1 shipped a resolved prompt vocabulary to the write path and to nothing else, so the API
   * accepted 24 ids while the drawer offered 2. The product picker is the same shape one phase on:
   * built first, it would have been fed from `EFS_LIMIT_LABELS` — our transcription of the guide's
   * table — and this account has fifteen groups that table does not contain, while the table has two
   * (CNG, LNG) the account does not carry as groups.
   *
   * ⚠ Resolved from `getProductGroups`, NOT `getProducts`, against both handoffs. The guide points
   * `groupId` at its Limit IDs table and `getProducts.code` at nothing; ten documented limit ids
   * including **DSL** exist only as groups on this account. See `resolveLimitVocabulary`.
   *
   * Never empty, exactly like `editableInfoIds`: an unwalked account resolves to the guide's table
   * rather than to nothing, so the client never has to decide what an absent list means.
   */
  limitOptions: z.array(z.object({
    limitId: z.string(),
    label: z.string(),
    unit: z.enum(["gallons", "units", "dollars"]),
  })).readonly(),
});
export type CardCapabilities = z.infer<typeof cardCapabilitiesSchema>;
