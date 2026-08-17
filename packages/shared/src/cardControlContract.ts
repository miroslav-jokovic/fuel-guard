import { z } from "zod";
import {
  EFS_CARD_STATUSES,
  EFS_CONFIG_SOURCES,
  EFS_DYNAMIC_INFO_IDS,
  EFS_HAND_ENTER,
  EFS_INFO_LABELS,
  EFS_MATCH_VALUE_MAX,
  EFS_OVERRIDE_MAX_USES,
  EFS_OVERRIDE_MIN_USES,
  EFS_POLICY_MAX,
  EFS_POLICY_MIN,
  EFS_PROMPT_ACCRUAL_MAX,
  EFS_VALIDATION_TYPES,
  EFS_LOCK_STATUSES,
} from "./efsCardCatalog.js";
import type { EffectiveRow } from "./cardControlEffectiveConfig.js";

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
/**
 * An integer EFS handed US. Read-tolerantly: a value outside the documented range is news about the
 * account, not a reason to make the card unreadable.
 *
 * Exported for `efsAccountContract.ts` (Step 7.1), which parses thirteen more vendor documents and
 * needs the identical tolerance. A second copy of this one-liner is exactly the drift that ends with
 * two schemas disagreeing about what EFS is allowed to say.
 */
export const vendorInt = z.coerce.number().int().nullable().catch(null);

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
  /**
   * The THIRD field a prompt can carry its value in (Step 7.3), declared on `WSCardInfo` and never
   * read until now. `UNIT` and `DRID` are the two prompts most likely to hold a number, and they are
   * exactly the two the attribution columns are built from — see `efsCardAttribution.ts`, whose own
   * docblock said there were two places and has now been corrected.
   */
  numericMatchValue: z.string().nullable(),
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
  /**
   * Five separate ways to take MONEY off a fuel card, none of them fuel (Step 7.3). Declared on
   * `WSCardHeader` and unparsed until now, so nothing in the product could say whether a card may
   * draw at an ATM, write a check, or move money by ACH, wire or debit. Strings, not booleans: EFS
   * types them `string` and this account's vocabulary for them is one of the questions Step 7.6 asks.
   */
  payrollAtm: z.string().nullable(),
  payrollChk: z.string().nullable(),
  payrollAch: z.string().nullable(),
  payrollWire: z.string().nullable(),
  payrollDebit: z.string().nullable(),
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

export { isEnforced, type EffectiveOrigin, type EffectiveRow } from "./cardControlEffectiveConfig.js";

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
export {
  cardBlockedBySchema,
  cardCapabilitiesSchema,
  type CardBlockedBy,
  type CardCapabilities,
} from "./cardCapabilitiesContract.js";

// ─── Write requests (one per intent) ───────────────────────────────────────────────────────────

/**
 * ── `reason` is GONE from the write path (Phase 6.5, 2026-08-16) ────────────────────────────────
 *
 * Decision B1 (2026-08-12, Miki) removed it. A session then reinstated it per-capability on
 * 2026-08-13, logging the change as its own authority, and Phase 6 shipped a required `Why *` field
 * in front of the person who had deleted it four days earlier. That row is vacated.
 *
 * What an audit trail is here: **time, person, action** — plus the before/after documents, the
 * step-up flag and the vendor's own fault text, all of which the ledger already carries and none of
 * which anybody has to type. A free-text box that every operator fills with "n/a" to get past it is
 * not evidence; it is a toll.
 *
 * `efs_card_mutations.reason` STAYS in the database, nullable with a `''` default since migration
 * 0180 and its CHECK relaxed by 0181 — so the schema has agreed with B1 all along and only these
 * contracts drifted back. The column is not dropped: that is a one-way door for a field that costs
 * nothing empty, and rule 12 forbids editing an applied migration.
 */

/**
 * The optimistic-concurrency token, computed by us over the mutable part of the card document. EFS
 * offers no ETag, no lastModified and no row version, so this is the only defence against two
 * dispatchers editing one card — or against a change made in the WEX portal between the read that
 * drew the screen and the write that acts on it.
 */
export const cardVersionSchema = z.string().min(16);

export const lockCardSchema = z.object({
  expectedVersion: cardVersionSchema,
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
});

/**
 * Retiring a card. Shaped like the unlock — no `status` field — and that is the whole design.
 *
 * The handoff's question for Phase 8.1 was "can it reach any status other than `Inactive`?" This is
 * the answer: there is nothing to put another status IN. A schema of `z.enum(["Inactive"])` would
 * have been a validated constraint; an absent field is an unrepresentable one, and the difference
 * matters because P0-3 happened when a schema that COULD carry `Active` eventually did.
 *
 * Declared separately from `unlockCardSchema` rather than aliased. They are identical today and mean
 * opposite things, and a shared alias is how a field added for one of them silently arrives on the
 * other.
 */
export const deactivateCardSchema = z.object({
  expectedVersion: cardVersionSchema,
});
export type DeactivateCardRequest = z.infer<typeof deactivateCardSchema>;

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
});
export type GrantOverrideRequest = z.infer<typeof grantOverrideSchema>;

export const clearOverrideSchema = z.object({
  expectedVersion: cardVersionSchema,
});

/**
 * One prompt, as an operator may submit it (Step 9.2).
 *
 * ── `infoId` is a string here, and validated where the ANSWER lives ──────────────────────────────
 * It was `z.enum(EFS_EDITABLE_INFO_IDS)`. That enum is a compile-time constant and the editable set
 * is now per-ACCOUNT, resolved from `getPromptTypes` — so the enum could only ever be right for an
 * account that happens to match it. Worse, the two disagreeing is not inert: a submission the schema
 * accepts but the resolved set excludes used to append a SECOND record with the same `infoId`
 * (audit P1-6b's duplicate shape). `promptsEdits` refuses that as of Step 9.1c, and this schema
 * stops pretending it can decide the question at parse time.
 *
 * Shape only, then: four upper-case letters, which is what `string (4)` means in the guide's own
 * table (p36). Whether THIS account offers it is a runtime fact and is answered by the runtime.
 *
 * ── All seven validation types, and DYNAMIC is card-level ────────────────────────────────────────
 * The guide lists seven on the CARD pages (p36, p135, p138) and six on the POLICY pages (p84, p146),
 * omitting `DYNAMIC` from the latter. This schema describes a card write, so seven is correct here —
 * and that asymmetry is the vendor's, recorded rather than smoothed over.
 */
export const promptInputSchema = z.object({
  infoId: z.string().trim().toUpperCase().regex(/^[A-Z]{4}$/, "An Info ID is four letters."),
  validationType: z.enum(EFS_VALIDATION_TYPES),
  matchValue: z.string().trim().max(EFS_MATCH_VALUE_MAX).nullable(),
  reportValue: z.string().trim().max(EFS_MATCH_VALUE_MAX).nullable(),
  /**
   * The accrual value, and ONLY meaningful for `ACCRUAL_CHECK`.
   *
   * The guide, verbatim (p36, p135, p138): *"For the accrual check method for odometer or hubometer,
   * this is the accrual value. For all other info ids/validation type combos just leave as `<value/>`
   * or `<value>0</value>`."*
   *
   * Typed as an integer here although the vendor describes it three different ways — `int` in the
   * WSDL's `WSCardInfo`, "String" on the guide's card pages, "int(24)" on setPolicy (p146). An
   * integer is the only reading all three admit, production returns `"0"`, and the wire form is
   * digits either way.
   */
  value: z.coerce.number().int().min(0).max(EFS_PROMPT_ACCRUAL_MAX).nullable().default(null),
  /**
   * Length checking, and the two bounds it gates.
   *
   * `minimum`/`maximum` are "Only checked if lengthCheck is true" (p36, p135) — so sending bounds
   * without the flag is not a smaller version of the feature, it is a no-op the vendor accepts and
   * ignores, which is this account's demonstrated failure mode for shapes it does not expect
   * (audit W3). The refinement below refuses the combination rather than letting an operator believe
   * they set a limit.
   *
   * The guide contradicts itself on what the bounds MEAN — "the maximum value" on the card pages,
   * "Max length" on the policy pages (p84, p146). Both readings are gated on the same flag, so this
   * schema takes no position on which is right; it only refuses the shape that is inert under either.
   */
  lengthCheck: z.boolean().default(false),
  minimum: z.coerce.number().int().min(0).nullable().default(null),
  maximum: z.coerce.number().int().min(0).nullable().default(null),
  remove: z.boolean().default(false),
})
  .refine(
    (p) => p.remove || p.validationType !== "EXACT_MATCH" || (p.matchValue ?? "").length > 0,
    // The pump validates driver entry AGAINST this value. Empty + EXACT_MATCH means nothing a driver
    // types can ever match: the card silently stops fueling (audit P1-6a). Clearing the value while
    // keeping validation on is never what an operator meant — make them pick one.
    { message: "EXACT_MATCH needs a value to match — clear the validation type instead of the value." },
  )
  .refine(
    (p) => p.remove || p.validationType !== "DYNAMIC" || (EFS_DYNAMIC_INFO_IDS as readonly string[]).includes(p.infoId),
    // "DYNAMIC can only be used with CNTN, PPIN and DRID" (p36, p136). PPIN is denied by this product
    // (EFS_UNEDITABLE_INFO_IDS), so in practice this reaches CNTN and DRID — a narrowing of the
    // vendor's rule that belongs to the denial, not to this refinement.
    { message: "DYNAMIC is only valid on the Control number, Personal identifier and Driver ID prompts." },
  )
  .refine(
    (p) => p.remove || p.validationType !== "ACCRUAL_CHECK" || (p.value ?? 0) > 0,
    // An ACCRUAL_CHECK whose accrual is 0 is the guide's own "no accrual configured" sentinel, so
    // submitting one asks the pump to follow an odometer by nothing. Production carries exactly that
    // on both policies (docs/25 Q3) — which is a fact about the account, not a shape to accept from
    // an operator who has just chosen odometer following on purpose.
    { message: "Odometer following needs an accrual value above zero." },
  )
  .refine(
    (p) => p.lengthCheck || (p.minimum === null && p.maximum === null),
    { message: "A minimum or maximum is only checked when length checking is on." },
  )
  .refine(
    (p) => p.minimum === null || p.maximum === null || p.minimum <= p.maximum,
    { message: "The minimum cannot exceed the maximum." },
  );
export type PromptInput = z.infer<typeof promptInputSchema>;

/**
 * The fields Step 9.2 added, at the values that mean "not configured".
 *
 * Exported because `.default()` puts these in the PARSED type, so every caller that builds a
 * `PromptInput` by hand — the drawer's drafts, the add-a-prompt control, their tests — must supply
 * them. Spreading one shared constant is what keeps "an unconfigured prompt" a single definition
 * rather than five literals that drift apart, and it is why `value: 0` and `value: null` cannot come
 * to mean different things in different files.
 *
 * `value: null` rather than `0`: the guide's "leave as <value/> or <value>0</value>" is about the
 * WIRE, and the wire form is produced by `promptsEdits`. In a draft, null says the operator has not
 * chosen an accrual, which is the state an ACCRUAL_CHECK submission is refused for.
 */
export const PROMPT_INPUT_UNSET = {
  value: null,
  lengthCheck: false,
  minimum: null,
  maximum: null,
} as const satisfies Pick<PromptInput, "value" | "lengthCheck" | "minimum" | "maximum">;

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
    // Bounded by the vendor's own vocabulary rather than by what this product happens to allow: the
    // guide's Info IDs table has 26 entries, so no honest card can carry more records than that and
    // a request claiming to is malformed regardless of which ids it names. The old cap was
    // `EFS_EDITABLE_INFO_IDS.length` — 2 — which was a compile-time guess at a per-account fact and
    // would have refused a legitimate five-prompt card the moment Step 9.1 widened the set.
    .max(Object.keys(EFS_INFO_LABELS).length)
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
