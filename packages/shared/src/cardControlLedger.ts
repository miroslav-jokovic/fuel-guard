import { z } from "zod";

/**
 * What a card change LEAVES BEHIND, and who is allowed to make one.
 *
 * Split out of `cardControlContract.ts` in Step 3.7, when that file crossed the 500-line budget.
 * The line the split follows is the one the design already draws: `cardControlContract.ts` is the
 * shape of a REQUEST — what the browser may ask for and what the API will accept — while everything
 * here is the shape of the RECORD and of the permission behind it. The two change for different
 * reasons and are read by different screens.
 *
 * Both are re-exported from the package index, so no consumer's import changed.
 */

// ─── Mutation ledger (history view) ────────────────────────────────────────────────────────────

export const CARD_MUTATION_INTENTS = ["lock", "unlock", "override_grant", "override_clear", "prompts_set"] as const;
export type CardMutationIntent = (typeof CARD_MUTATION_INTENTS)[number];

/**
 * `sent` is a real, terminal outcome and not a transient one: the write was dispatched and we could
 * not confirm what happened — a timeout, or a re-read that itself failed. It is shown to operators as
 * "Unverified" rather than hidden, because a mutation whose result nobody knows is exactly the thing
 * a human needs to go and check.
 */
export const CARD_MUTATION_STATUSES = ["pending", "sent", "succeeded", "failed", "drift_detected"] as const;
export type CardMutationStatus = (typeof CARD_MUTATION_STATUSES)[number];

export const cardMutationSchema = z.object({
  id: z.string().uuid(),
  intent: z.enum(CARD_MUTATION_INTENTS),
  status: z.enum(CARD_MUTATION_STATUSES),
  reason: z.string(),
  requestedBy: z.string().uuid().nullable(),
  requestedByName: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  efsFaultMessage: z.string().nullable(),
  driftFields: z.array(z.string()).nullable(),
});
export type CardMutation = z.infer<typeof cardMutationSchema>;

export const CARD_MUTATION_INTENT_LABELS: Record<CardMutationIntent, string> = {
  lock: "Locked card",
  unlock: "Unlocked card",
  override_grant: "Granted override",
  override_clear: "Cleared override",
  prompts_set: "Changed prompts",
};

export const CARD_MUTATION_STATUS_LABELS: Record<CardMutationStatus, string> = {
  pending: "Not sent",
  sent: "Unverified",
  succeeded: "Applied",
  failed: "Refused by EFS",
  drift_detected: "Applied, with other changes",
};

// ─── Who may use card control ──────────────────────────────────────────────────────────────────

/**
 * The four things an approver can be trusted with, independently.
 *
 * Canonical here rather than in the API, because three surfaces have to agree on the exact strings:
 * the `efs_card_control_approvers.scopes` array (0173), the capability gate that reads it, and the
 * settings UI that grants it. A typo in any one of them is a silent permission change.
 *
 * The split is not decorative. The most-requested arrangement in a real fleet is a yard manager who
 * can lock a stolen card at 2am but cannot grant fuel exceptions — `['lock','unlock']` without
 * `override`. Granting all four is a choice somebody makes, not the only option.
 */
export const CARD_CONTROL_SCOPES = ["lock", "unlock", "override", "prompts"] as const;
export type CardControlScope = (typeof CARD_CONTROL_SCOPES)[number];

export const CARD_SCOPE_LABELS: Record<CardControlScope, string> = {
  lock: "Lock a card",
  unlock: "Unlock a card",
  override: "Grant fuel exceptions",
  prompts: "Change pump prompts",
};

/** One line each, for the settings screen — what the person can actually do to a truck. */
export const CARD_SCOPE_DESCRIPTIONS: Record<CardControlScope, string> = {
  lock: "Stop a card working at every location, immediately.",
  unlock: "Let a stopped card buy fuel again.",
  override: "Allow purchases outside the card's normal limits. This one spends money.",
  prompts: "Change what the pump asks the driver for, including the Driver ID check.",
};

export const isCardControlScope = (value: string): value is CardControlScope =>
  (CARD_CONTROL_SCOPES as readonly string[]).includes(value);

/**
 * Roles that may hold card-control scopes at all.
 *
 * A HARD FLOOR, not a default. The approver list narrows this set; it can never widen it, and the
 * API re-checks the role on every write rather than trusting the row. A dispatcher granting fuel
 * exceptions is precisely the pattern this product exists to DETECT, so naming one as an approver is
 * refused rather than quietly honoured — if a customer wants that person to have it, the answer is to
 * change their role, which is itself an audited act with consequences they can see.
 *
 * Derived from `rolesThatManage("fuel")` at the call site rather than duplicated, so this stays in
 * step with every other fuel-section write in the product.
 */
export const CARD_APPROVER_ELIGIBLE_SECTION = "fuel" as const;

// ─── Settings and approver requests ────────────────────────────────────────────────────────────

/**
 * Both fields optional, because the settings screen has two independent switches and sending the one
 * you did not touch is how a UI accidentally reverts somebody else's change.
 */
export const cardControlSettingsPatchSchema = z
  .object({
    /** The org's opt-in. Default false: being able to READ cards must never imply changing them. */
    enabled: z.boolean().optional(),
    /**
     * Whether the named-approver list is enforced on top of the role.
     *
     * Turning this OFF hands write access to every admin and fleet manager in the company at once,
     * which is why it is a separate, audited switch and not a side effect of enabling card control.
     */
    requireApprover: z.boolean().optional(),
  })
  .refine((v) => v.enabled !== undefined || v.requireApprover !== undefined, {
    message: "Nothing to change.",
  });
export type CardControlSettingsPatch = z.infer<typeof cardControlSettingsPatchSchema>;

export const cardApproverGrantSchema = z.object({
  /** At least one. An approver row with no scopes is a person who looks authorised and is not. */
  scopes: z.array(z.enum(CARD_CONTROL_SCOPES)).min(1).max(CARD_CONTROL_SCOPES.length),
});
export type CardApproverGrant = z.infer<typeof cardApproverGrantSchema>;

export const cardApproverSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().nullable(),
  role: z.string().nullable(),
  scopes: z.array(z.string()),
  grantedBy: z.string().uuid().nullable(),
  grantedAt: z.string().nullable(),
});
export type CardApprover = z.infer<typeof cardApproverSchema>;

/**
 * The audit vocabulary for card control, in one place.
 *
 * Entity `efs_cards` for anything about a card, `efs_card_control_settings` for anything about who may
 * touch one. Dotted `noun.verb_past`, matching the rest of the audit log. Card control is ENTIRELY
 * compliance-relevant, so every one of these carries VALUES in `meta` — not just field names — which
 * is the AUDITED_VALUE_FIELDS rule from routes/roster/drivers.ts applied to the whole surface.
 */
export const CARD_CONTROL_AUDIT_ACTIONS = {
  controlEnabled: "card.control_enabled",
  controlDisabled: "card.control_disabled",
  approverPolicyChanged: "card.approver_policy_changed",
  approverGranted: "card.approver_granted",
  approverRevoked: "card.approver_revoked",
  locked: "card.locked",
  unlocked: "card.unlocked",
  overrideGranted: "card.override_granted",
  overrideCleared: "card.override_cleared",
  promptsChanged: "card.prompts_changed",
  mutationFailed: "card.mutation_failed",
  mutationUnverified: "card.mutation_unverified",
  driftDetected: "card.drift_detected",
  probed: "integration.efs_soap.card_control_probed",
} as const;
