import { z } from "zod";
import {
  EFS_CARD_STATUSES,
  EFS_CONFIG_SOURCES,
  EFS_EDITABLE_INFO_IDS,
  EFS_HAND_ENTER,
  EFS_LIMIT_MAX,
  EFS_MATCH_VALUE_MAX,
  EFS_OVERRIDE_MAX_USES,
  EFS_OVERRIDE_MIN_USES,
  EFS_POLICY_MAX,
  EFS_POLICY_MIN,
  EFS_VALIDATION_TYPES,
  EFS_WRITABLE_STATUSES,
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

/** A pump prompt. `matchValue` with EXACT_MATCH is what makes the pump VALIDATE the entry. */
export const wsCardInfoSchema = z.object({
  infoId: z.string(),
  validationType: z.enum(EFS_VALIDATION_TYPES).nullable(),
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
  limit: z.coerce.number().min(0).max(EFS_LIMIT_MAX),
  /** Hours the limit is good for before resetting. */
  hours: z.coerce.number().int().nullable(),
  /** Minimum hours between uses. */
  minHours: z.coerce.number().int().nullable(),
  /** v2 only. `autoRollMax` of 0 means "no daily maximum" (p138) — NOT "no limit at all". */
  autoRollMap: z.coerce.number().int().nullable(),
  autoRollMax: z.coerce.number().int().nullable(),
});
export type WsCardLimit = z.infer<typeof wsCardLimitSchema>;

/** Only the time-of-day part applies; the date reads 1970-01-01 and is meaningless (p37). */
export const wsTimeRestrictionSchema = z.object({
  day: z.coerce.number().int().min(1).max(7),
  beginTime: z.string().nullable(),
  endTime: z.string().nullable(),
});
export type WsTimeRestriction = z.infer<typeof wsTimeRestrictionSchema>;

export const wsCardSchema = z.object({
  status: z.enum(EFS_CARD_STATUSES).nullable(),
  /** Frequently returned as xsi:nil (p35), which is why this is nullable rather than optional. */
  originalStatus: z.string().nullable(),
  payrollStatus: z.string().nullable(),
  payrollUse: z.string().nullable(),
  policyNumber: z.coerce.number().int().min(EFS_POLICY_MIN).max(EFS_POLICY_MAX).nullable(),
  companyXRef: z.string().nullable(),
  handEnter: z.enum(EFS_HAND_ENTER).nullable(),
  infoSource: z.enum(EFS_CONFIG_SOURCES).nullable(),
  limitSource: z.enum(EFS_CONFIG_SOURCES).nullable(),
  locationSource: z.enum(EFS_CONFIG_SOURCES).nullable(),
  timeSource: z.enum(EFS_CONFIG_SOURCES).nullable(),
  /**
   * The guide types `override` as boolean(1) but the Overrides appendix (p194) sets it to 1–9 as a
   * COUNT of remaining uses. We surface the count, because "true" would throw the number away.
   */
  overrideUses: z.coerce.number().int().min(0).max(EFS_OVERRIDE_MAX_USES).nullable(),
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
  status: z.enum(EFS_CARD_STATUSES).nullable(),
  policyNumber: z.coerce.number().int().nullable(),
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
export const cardReasonSchema = z.string().trim().min(3).max(200);

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
  /** Hold is reversible and is what we default to; Inactive is offered for a card being retired. */
  status: z.enum(EFS_WRITABLE_STATUSES).default("Hold"),
});
export type LockCardRequest = z.infer<typeof lockCardSchema>;

export const unlockCardSchema = z.object({
  expectedVersion: cardVersionSchema,
  reason: cardReasonSchema,
});

export const overrideScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  // 6-digit EFS location id per p194; the field is int(7) in searchLocation output, so accept 1-7.
  z.object({ kind: z.literal("location"), locationId: z.string().regex(/^[0-9]{1,7}$/) }),
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
});
export type PromptInput = z.infer<typeof promptInputSchema>;

export const setPromptsSchema = z.object({
  expectedVersion: cardVersionSchema,
  /**
   * Full-replace is the EFS semantic, not a convenience: prompts absent from a setCardV2 are deleted.
   * Requiring the literal `true` means a caller can never arrive at full-replace by omitting a field.
   */
  replaceAll: z.literal(true),
  prompts: z.array(promptInputSchema).max(20),
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
