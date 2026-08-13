import { z } from "zod";
import {
  EFS_CARD_STATUSES,
  EFS_CONFIG_SOURCES,
  EFS_EDITABLE_INFO_IDS,
  EFS_HAND_ENTER,
  EFS_MATCH_VALUE_MAX,
  EFS_OVERRIDE_MAX_USES,
  EFS_OVERRIDE_MIN_USES,
  EFS_POLICY_MAX,
  EFS_POLICY_MIN,
  EFS_VALIDATION_TYPES,
  EFS_LOCK_STATUSES,
} from "./efsCardCatalog.js";

/**
 * The wire contract for EFS card control. One source of truth; never redefine these per app.
 *
 * Two things to know before changing anything here.
 *
 * 1. `WSCard` is a lossy VIEW of the vendor document. It exists to render a page, validate an edit and
 *    compute a version. It is NEVER serialized back to EFS. `setCardV2` is a full-document write
 *    (p137): anything absent from the request is DELETED, and WEX adds fields without telling us, so
 *    the echo is built by transforming the raw response DOM — see apps/api/src/lib/efsCardXml.ts. If
 *    you find yourself adding a field here so that it "round-trips", you are in the wrong file.
 *
 * 2. Mutations are one endpoint per INTENT, not a generic patch. A partial `WSCard` on the wire would
 *    make the audit action undecidable without diffing, make per-intent rate limits and approver
 *    scopes impossible, and invite exactly the "just send what changed" mental model that the EFS
 *    full-document semantic punishes.
 */

// ─── The card document (read view) ─────────────────────────────────────────────────────────────

/**
 * A vendor-supplied enum on the READ path.
 *
 * Deliberately NOT `z.enum()`. The guide types these fields as `string (8)` and then names a few
 * example values (p35–38); it does not promise the list is closed, and WEX ships values without
 * telling us. Production proved the point: a card came back with a `status` outside our five, zod
 * rejected the document, and `getCardv2` failed outright — the whole card page taken down by a value
 * we only ever wanted to *print*.
 *
 * The rule this encodes: **reads are tolerant, writes are strict.** Receiving an unrecognised value is
 * a fact to display verbatim (`cardStatusLabel` already falls back to the raw string); *sending* one
 * is a bug, which is why `lockCardSchema.status` below is a real `z.enum` over EFS_LOCK_STATUSES.
 *
 * `known` is unused at runtime and present for the reader: it documents what we expect to see, and
 * keeps the constant referenced so a catalog change still shows up here in a grep.
 */
const vendorEnum = (known: readonly string[]): z.ZodNullable<z.ZodString> => {
  void known;
  return z.string().nullable();
};

/**
 * A vendor-supplied number on the READ path. Same reasoning: a policy number or override count
 * outside the documented range is worth showing and worth alerting on, but it must not be able to
 * make an entire card unreadable. Range checks belong on the write schemas, where we choose the
 * value.
 */
const vendorInt = z.coerce.number().int().nullable().catch(null);

/**
 * A policy number WE choose — a route parameter or a probe input, not something EFS handed us. Strict
 * on purpose, and the mirror image of `vendorInt` above: asking EFS for policy 139445 earns
 * "Invalid policy number", which is a request we should never have sent. 1–99 per the guide (p84).
 */
export const policyNumberSchema = z.coerce.number().int().min(EFS_POLICY_MIN).max(EFS_POLICY_MAX);

/** A pump prompt. `matchValue` with EXACT_MATCH is what makes the pump VALIDATE the entry. */
export const wsCardInfoSchema = z.object({
  infoId: z.string(),
  validationType: vendorEnum(EFS_VALIDATION_TYPES),
  matchValue: z.string().nullable(),
  reportValue: z.string().nullable(),
  lengthCheck: z.boolean().nullable(),
  minimum: z.coerce.number().nullable(),
  maximum: z.coerce.number().nullable(),
  /** Accrual value for ODRD/HBRD under ACCRUAL_CHECK; "0" or empty for every other combination (p36). */
  value: z.string().nullable(),
});
export type WsCardInfo = z.infer<typeof wsCardInfoSchema>;

/** A per-product cap. `limit` is GALLONS for fuel/DEF and DOLLARS otherwise — see limitUnit(). */
export const wsCardLimitSchema = z.object({
  limitId: z.string(),
  // PostgREST hands numerics back as number|string, hence coerce throughout this file.
  // Read-tolerant: EFS_LIMIT_MAX is our sanity bound for values we SET, and a vendor limit above it
  // must be visible rather than fatal. See vendorEnum.
  limit: z.coerce.number().catch(0),
  /** Hours the limit is good for before resetting. */
  hours: vendorInt,
  /** Minimum hours between uses. */
  minHours: vendorInt,
  /** v2 only. `autoRollMax` of 0 means "no daily maximum" (p138) — NOT "no limit at all". */
  autoRollMap: vendorInt,
  autoRollMax: vendorInt,
});
export type WsCardLimit = z.infer<typeof wsCardLimitSchema>;

/** Only the time-of-day part applies; the date reads 1970-01-01 and is meaningless (p37). */
export const wsTimeRestrictionSchema = z.object({
  /** 1–7 per the guide; read-tolerant so an out-of-range day cannot make the card unreadable. */
  day: z.coerce.number().int().catch(0),
  beginTime: z.string().nullable(),
  endTime: z.string().nullable(),
});
export type WsTimeRestriction = z.infer<typeof wsTimeRestrictionSchema>;

export const wsCardSchema = z.object({
  status: vendorEnum(EFS_CARD_STATUSES),
  /** Frequently returned as xsi:nil (p35), which is why this is nullable rather than optional. */
  originalStatus: z.string().nullable(),
  payrollStatus: z.string().nullable(),
  payrollUse: z.string().nullable(),
  /** Documented 1–99 (EFS_POLICY_MIN/MAX); read tolerantly — see vendorInt. */
  policyNumber: vendorInt,
  companyXRef: z.string().nullable(),
  handEnter: vendorEnum(EFS_HAND_ENTER),
  infoSource: vendorEnum(EFS_CONFIG_SOURCES),
  limitSource: vendorEnum(EFS_CONFIG_SOURCES),
  locationSource: vendorEnum(EFS_CONFIG_SOURCES),
  timeSource: vendorEnum(EFS_CONFIG_SOURCES),
  /**
   * The guide types `override` as boolean(1) but the Overrides appendix (p194) sets it to 1–9 as a
   * COUNT of remaining uses. We surface the count, because "true" would throw the number away.
   */
  overrideUses: vendorInt,
  /** Likewise typed boolean(1) but carrying a 6-digit EFS location id when a single-location
   *  override is active (p194). */
  locationOverrideId: z.string().nullable(),
  overrideAllLocations: z.boolean().nullable(),
  lastUsedDate: z.string().nullable(),
  lastTransaction: z.string().nullable(),
  /** Empty array means the card genuinely has no CARD-level records — not "unknown", not "unchanged". */
  infos: z.array(wsCardInfoSchema),
  limits: z.array(wsCardLimitSchema),
  locationGroups: z.array(z.string()),
  /** A BLOCKLIST: "a list of locations that this card is BLOCKED from using" (p36). Not an allowlist. */
  locations: z.array(z.string()),
  timeRestrictions: z.array(wsTimeRestrictionSchema),
});
export type WsCard = z.infer<typeof wsCardSchema>;

/** Policy-level configuration (getPolicy, p84), needed because getCard omits it even under BOTH. */
export const wsPolicySchema = z.object({
  policyNumber: z.coerce.number().int(),
  description: z.string().nullable(),
  handEnter: z.boolean().nullable(),
  infos: z.array(wsCardInfoSchema),
  limits: z.array(wsCardLimitSchema),
  locationGroups: z.array(z.string()),
  locations: z.array(z.string()),
  timeRestrictions: z.array(wsTimeRestrictionSchema),
});
export type WsPolicy = z.infer<typeof wsPolicySchema>;

// ─── Effective configuration (card vs policy) ──────────────────────────────────────────────────

export type EffectiveOrigin = "card" | "policy" | "policy-overridden" | "policy-ignored";

export interface EffectiveRow<T> {
  value: T;
  origin: EffectiveOrigin;
}

/**
 * Combine card-level and policy-level records into what a pump will actually enforce.
 *
 * Two rules from the guide, and they interact:
 *   • "Card level always trumps policy" (p37) — a card record with the same key wins.
 *   • The `source` field decides whether policy records apply at all: CARD means policy is ignored,
 *     POLICY means the card has none of its own, BOTH means combine.
 *
 * Policy rows are RETURNED rather than dropped even when they lose, tagged `policy-overridden` or
 * `policy-ignored`, so the UI can show why a rule the operator can see in the WEX portal is not in
 * force here. Silently omitting them produces the worst kind of support call: "the policy says 100
 * gallons, your screen doesn't mention it, which one is real?"
 */
export function mergeEffectiveConfig<T>(
  cardRecords: readonly T[],
  policyRecords: readonly T[],
  source: string | null,
  keyOf: (record: T) => string,
): EffectiveRow<T>[] {
  const rows: EffectiveRow<T>[] = cardRecords.map((value) => ({ value, origin: "card" as const }));
  const cardKeys = new Set(cardRecords.map(keyOf));
  // Anything other than an explicit POLICY/BOTH means policy records do not apply. Defaulting an
  // unknown/absent source to "ignored" is the conservative direction: we under-claim what the pump
  // will enforce rather than showing a limit that is not actually in force.
  const policyApplies = source === "POLICY" || source === "BOTH";
  for (const value of policyRecords) {
    rows.push({
      value,
      origin: !policyApplies ? "policy-ignored" : cardKeys.has(keyOf(value)) ? "policy-overridden" : "policy",
    });
  }
  return rows;
}

/** Whether a merged row is actually enforced at the pump. */
export const isEnforced = (origin: EffectiveOrigin): boolean => origin === "card" || origin === "policy";

// ─── Read responses ────────────────────────────────────────────────────────────────────────────

/** One row of the cards list. Never carries a PAN — `last4` and a masked ref only. */
export const efsCardSummarySchema = z.object({
  id: z.string().uuid(),
  last4: z.string().length(4),
  maskedRef: z.string(),
  status: vendorEnum(EFS_CARD_STATUSES),
  policyNumber: vendorInt,
  driverIdPrompt: z.string().nullable(),
  unitPrompt: z.string().nullable(),
  driverName: z.string().nullable(),
  overrideUses: z.coerce.number().int().nullable(),
  lastUsedDate: z.string().nullable(),
  vehicleId: z.string().uuid().nullable(),
  driverId: z.string().uuid().nullable(),
  syncedAt: z.string(),
  syncError: z.string().nullable(),
});
export type EfsCardSummary = z.infer<typeof efsCardSummarySchema>;

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
  blockedBy: z
    .enum(["kill_switch", "not_enabled", "not_entitled", "role", "not_approver", "no_credentials"])
    .nullable(),
});
export type CardCapabilities = z.infer<typeof cardCapabilitiesSchema>;

// ─── Write requests (one per intent) ───────────────────────────────────────────────────────────

/**
 * Why every mutation carries a reason: it is the cheapest column in the schema and the most valuable
 * one six months later, when somebody asks why a card was locked on a Tuesday night.
 */
/**
 * OPTIONAL as of 2026-08-12 (product decision B1): the mutation stands on actor, intent, step-up
 * flag and the before/after documents; the free-text why is welcome but no longer demanded. Kept
 * as a field (defaulting to empty) so an org that wants reasons back gets a UI change, not an API
 * change. min(3) applies only when a reason IS given — a one-letter reason is noise, not evidence.
 */
export const cardReasonSchema = z.union([
  z.string().trim().min(3).max(200),
  z.string().trim().max(0),
]).default("");

/**
 * The optimistic-concurrency token, computed by us over the mutable part of the card document. EFS
 * offers no ETag, no lastModified and no row version, so this is the only defence against two
 * dispatchers editing one card — or against a change made in the WEX portal between the read that
 * drew the screen and the write that acts on it.
 */
export const cardVersionSchema = z.string().min(16);

export const lockCardSchema = z.object({
  expectedVersion: cardVersionSchema,
  reason: cardReasonSchema,
  /**
   * Hold is reversible and is what we default to; Inactive is offered for a card being retired.
   * EFS_LOCK_STATUSES, not EFS_WRITABLE_STATUSES: `Active` here was an unlock reachable through the
   * lock route, skipping the fraud step-up and mislabelling the audit trail (audit P0-3). The full
   * writable set remains what the PRODUCT may ever send; this schema is what LOCK may ask for.
   */
  status: z.enum(EFS_LOCK_STATUSES).default("Hold"),
});
export type LockCardRequest = z.infer<typeof lockCardSchema>;

export const unlockCardSchema = z.object({
  expectedVersion: cardVersionSchema,
  reason: cardReasonSchema,
});

export const overrideScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  // 6-digit EFS location id per p194; the field is int(7) in searchLocation output, so accept 1-7.
  z.object({
    kind: z.literal("location"),
    // 1–7 digits AND non-zero: "0" (any width) is LOCATION_OVERRIDE_NONE, the sentinel that means
    // "no single-location override" — granting uses against it arms NEITHER scope, and the driver
    // is declined everywhere while the ledger says they're covered (audit P1-6c).
    locationId: z.string().regex(/^[0-9]{1,7}$/).refine((v) => Number(v) > 0, {
      message: "locationId 0 means no override — pick a real EFS location id.",
    }),
  }),
]);
export type OverrideScope = z.infer<typeof overrideScopeSchema>;

export const grantOverrideSchema = z.object({
  expectedVersion: cardVersionSchema,
  uses: z.coerce.number().int().min(EFS_OVERRIDE_MIN_USES).max(EFS_OVERRIDE_MAX_USES),
  scope: overrideScopeSchema,
  reason: cardReasonSchema,
});
export type GrantOverrideRequest = z.infer<typeof grantOverrideSchema>;

export const clearOverrideSchema = z.object({
  expectedVersion: cardVersionSchema,
  reason: cardReasonSchema,
});

export const promptInputSchema = z.object({
  infoId: z.enum(EFS_EDITABLE_INFO_IDS),
  validationType: z.enum(["EXACT_MATCH", "REPORT_ONLY"]),
  matchValue: z.string().trim().max(EFS_MATCH_VALUE_MAX).nullable(),
  reportValue: z.string().trim().max(EFS_MATCH_VALUE_MAX).nullable(), remove: z.boolean().default(false),
}).refine((p) => p.remove || p.validationType !== "EXACT_MATCH" || (p.matchValue ?? "").length > 0,
  // The pump validates driver entry AGAINST this value. Empty + EXACT_MATCH means nothing a driver
  // types can ever match: the card silently stops fueling (audit P1-6a). Clearing the value while
  // keeping validation on is never what an operator meant — make them pick one.
  { message: "EXACT_MATCH needs a value to match — clear the validation type instead of the value." },
);
export type PromptInput = z.infer<typeof promptInputSchema>;

export const setPromptsSchema = z.object({
  expectedVersion: cardVersionSchema,
  /**
   * Full-replace is the EFS semantic, not a convenience: the API carries every prompt record and
   * requires explicit `remove: true` before omitting one from the setCardV2 document.
   */
  replaceAll: z.literal(true),
  // Bounded by what is actually editable, and UNIQUE by infoId: EFS's prompts array is a full
  // replace, and two records with one infoId is a document shape the vendor never emits — on this
  // vendor, "accepted and ignored" is the documented failure mode for shapes it has never seen
  // (audit P1-6b). The append loop in efsCardEdits would have pushed both.
  prompts: z.array(promptInputSchema)
    .max(EFS_EDITABLE_INFO_IDS.length)
    .refine(
      (list) => new Set(list.map((p) => p.infoId)).size === list.length,
      { message: "Each prompt may appear once." },
    ),
  /**
   * Dropping the DRID record stops the pump asking who is fuelling, and every downstream attribution
   * decision loses its strongest signal. Explicit opt-in plus step-up re-auth; never a side effect of
   * clearing a text box.
   */
  allowRemoveDriverId: z.boolean().default(false),
  reason: cardReasonSchema,
});
export type SetPromptsRequest = z.infer<typeof setPromptsSchema>;

/** Location search backing the single-location override picker (searchLocation, p132). */
export const locationSearchSchema = z.object({
  locId: z.string().nullable(),
  state: z.string().nullable(),
  city: z.string().nullable(),
  name: z.string().nullable(),
  country: z.enum(["USA", "CAN", "MXN"]).nullable(),
});

export const efsLocationSchema = z.object({
  locId: z.string(),
  name: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().nullable(),
  addr1: z.string().nullable(),
  phone: z.string().nullable(),
});
export type EfsLocation = z.infer<typeof efsLocationSchema>;

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
