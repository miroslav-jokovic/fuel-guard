import { z } from "zod";
import { vendorInt } from "./cardControlContract.js";

/**
 * The ACCOUNT-level documents EFS will describe itself with (execution plan Step 7.1).
 *
 * `cardControlContract.ts` models one CARD. This models the things a card points AT and the things
 * that bound it: which prompts the account owns, which policies exist and what they are called, the
 * product vocabulary, the contracts and their credit ceilings, the refreshing limits, the location
 * groups, and the account's own identity. Phase 7 exists because none of it has ever been read, and
 * Phases 9–12 are scoped from what it turns out to say.
 *
 * ── Every field here was read out of the checked-in WSDL, not inferred ──────────────────────────
 * `docs/efs/CardManagementWS.wsdl` (checked in by Step 0.11) is the source for every name, every
 * type and every nillable marker below — extracted from the `<complexType>` declarations rather than
 * from the integration guide, because the guide's prose and this binding have already disagreed
 * twice in ways that cost live round trips (see `efsLocationSearch.ts`). Standing rule 10 asks for a
 * citation per field; the WSDL type name above each schema is that citation, and
 * `efsAccountOps.test.ts` re-derives the field lists from the WSDL so this file cannot drift from it.
 *
 * ── Read-tolerant, deliberately, and this is NOT what Step 7.3 asks for ─────────────────────────
 * `vendorInt` and the nullable strings here mean an unexpected value is recorded rather than fatal.
 * That is right for a first read of an account nobody has ever inventoried: the point of the
 * exercise is to find out what this account actually says, and a schema that refuses the answer
 * tells us nothing. **Step 7.3 is the opposite** — once the inventory is known, the scan must FAIL on
 * an unmodelled field. These are different jobs at different times; do not harden this file into
 * 7.3's gate without reading that step.
 */

/** A double EFS handed us — money and rates. Same tolerance as `vendorInt`, without the truncation. */
const vendorNumber = z.coerce.number().nullable().catch(null);

/** A boolean EFS handed us. The ops layer parses true/false/True/False/1/0 before this sees it. */
const vendorBool = z.boolean().nullable().catch(null);

// ─── getPromptTypes → StringArray ──────────────────────────────────────────────────────────────

/**
 * The Info IDs this account owns.
 *
 * The single most load-bearing answer in the inventory: `EFS_EDITABLE_INFO_IDS` is what the prompts
 * drawer offers, and it is currently a list this codebase chose. This is the list the ACCOUNT has.
 * Phase 9 is scoped by the difference.
 */
export const promptTypesSchema = z.array(z.string());
export type PromptTypes = z.infer<typeof promptTypesSchema>;

// ─── getPolicyDescriptions → WSPolicyDescriptionArray ──────────────────────────────────────────

/** WSDL `WSPolicyDescription`. What each policy number is called, and which contract owns it. */
export const wsPolicyDescriptionSchema = z.object({
  contractId: vendorInt,
  description: z.string().nullable(),
  policyNumber: vendorInt,
});
export type WsPolicyDescription = z.infer<typeof wsPolicyDescriptionSchema>;

// ─── getProducts → WSProductArray ──────────────────────────────────────────────────────────────

/**
 * WSDL `WSProduct`. The account's fuel and merchandise vocabulary.
 *
 * `code` is what a limit's `limitId` refers to, which is why this is in the inventory at all: today
 * `limitLabel()` maps a handful of codes it was told about, and every other limit on a card renders
 * as its raw code.
 */
export const wsProductSchema = z.object({
  code: z.string().nullable(),
  description: z.string().nullable(),
  fuelType: vendorInt,
  fuelUse: vendorInt,
  group: z.string().nullable(),
  phraseId: vendorInt,
  shellClProduct: vendorInt,
  shellFuelType: vendorInt,
  shellPriceGroup: z.string().nullable(),
});
export type WsProduct = z.infer<typeof wsProductSchema>;

// ─── getProductGroups → WSProductGroupArray ────────────────────────────────────────────────────

/** WSDL `WSProductGroup`. `isFuel` is the flag that decides gallons-versus-dollars on a limit. */
export const wsProductGroupSchema = z.object({
  description: z.string().nullable(),
  groupId: z.string().nullable(),
  groupNumber: vendorInt,
  isFuel: vendorBool,
});
export type WsProductGroup = z.infer<typeof wsProductGroupSchema>;

// ─── getContracts → WSContractArray ────────────────────────────────────────────────────────────

/** WSDL `WSContract`. `contractId` is the key `getCreditLimits` is called per — see Step 7.2. */
export const wsContractSchema = z.object({
  checkFee: vendorNumber,
  contractId: vendorInt,
  country: z.string().nullable(),
  currency: z.string().nullable(),
  description: z.string().nullable(),
  issuerId: vendorInt,
  limitMethod: vendorInt,
  masterContract: vendorBool,
  status: z.string().nullable(),
});
export type WsContract = z.infer<typeof wsContractSchema>;

// ─── getCreditLimits → WSCreditLimits ──────────────────────────────────────────────────────────

/**
 * WSDL `WSCreditLimits`. The real ceiling, per contract.
 *
 * `uom` is not decoration: every amount here is denominated by it, and the same disease that made a
 * 100-gallon ULSD cap render as "$100" on a card page (see `cardControlModel.ts`) applies to these
 * numbers. Nothing may format one of these without it.
 */
export const wsCreditLimitsSchema = z.object({
  contractStatus: z.string().nullable(),
  transLimit: vendorNumber,
  origLimit: vendorNumber,
  creditAvailable: vendorNumber,
  dailyLimit: vendorNumber,
  dailyAvailable: vendorNumber,
  totalAvailable: vendorNumber,
  maxMoneyCode: vendorInt,
  uom: z.string().nullable(),
});
export type WsCreditLimits = z.infer<typeof wsCreditLimitsSchema>;

// ─── getCardRefreshingLimits / getPolicyRefreshingLimits ───────────────────────────────────────

/**
 * The six refreshing counters, shared by the card and policy documents.
 *
 * WSDL `WSPolicyRefreshingLimitsData` is exactly these six; `WSCardRefreshingLimitsData` is these six
 * plus `refreshingLimitSource`. Modelled once and extended, so a field added to one and not the other
 * is a visible difference rather than two drifting lists.
 */
export const refreshingLimitCountersSchema = z.object({
  dayCntLimit: vendorInt,
  dayAmtLimit: vendorInt,
  weekCntLimit: vendorInt,
  weekAmtLimit: vendorInt,
  monCntLimit: vendorInt,
  monAmtLimit: vendorInt,
});

/** WSDL `WSPolicyRefreshingLimitsData`. */
export const wsPolicyRefreshingLimitsSchema = refreshingLimitCountersSchema;
export type WsPolicyRefreshingLimits = z.infer<typeof wsPolicyRefreshingLimitsSchema>;

/**
 * WSDL `WSCardRefreshingLimitsData`.
 *
 * `refreshingLimitSource` is the CARD/POLICY/BOTH question again, for a fourth kind of rule — the
 * card page already renders `infoSource`, `limitSource`, `locationSource` and `timeSource`, and this
 * is a fifth source field that no surface has ever shown.
 */
export const wsCardRefreshingLimitsSchema = refreshingLimitCountersSchema.extend({
  refreshingLimitSource: z.string().nullable(),
});
export type WsCardRefreshingLimits = z.infer<typeof wsCardRefreshingLimitsSchema>;

// ─── getLocationGroupDescriptions → WSLocationGroupDescriptionArray ────────────────────────────

/**
 * WSDL `WSLocationGroupDescription`.
 *
 * `ruleBased` matters more than it looks: a rule-based group's membership is computed by EFS, so its
 * contents cannot be enumerated with `getLocGrpLocs` the way an explicit group's can.
 */
export const wsLocationGroupDescriptionSchema = z.object({
  grpId: vendorInt,
  name: z.string().nullable(),
  ruleBased: vendorBool,
  editable: vendorBool,
});
export type WsLocationGroupDescription = z.infer<typeof wsLocationGroupDescriptionSchema>;

// ─── getLocationGroups → WSLocationGroupArray ──────────────────────────────────────────────────

/**
 * WSDL `WSLocationGroup`. The groups in force for ONE card or ONE policy.
 *
 * ⚠ Not an account-level call, despite sitting in an account inventory. Its WSDL `parameterOrder` is
 * `clientId cardNum policyNum`, so it always asks about a specific card or policy — which is why
 * Step 7.2's account walk uses `getLocationGroupDescriptions` and reaches this one only through its
 * optional `sampleCards`.
 */
export const wsLocationGroupSchema = z.object({
  grpId: vendorInt,
  name: z.string().nullable(),
  carrierId: vendorInt,
});
export type WsLocationGroup = z.infer<typeof wsLocationGroupSchema>;

// ─── getSitePolicyDescriptions → WSSitePolicyDescriptionArray ──────────────────────────────────

/** WSDL `WSSitePolicyDescription`. Carries a nested `WSPolicyDescription`, which is why it is last. */
export const wsSitePolicyDescriptionSchema = z.object({
  sitePolicy: vendorInt,
  siteDescription: z.string().nullable(),
  /** Nillable in the WSDL, so a site policy with no policy behind it is a state EFS can report. */
  sitePolicyPolicy: wsPolicyDescriptionSchema.nullable(),
});
export type WsSitePolicyDescription = z.infer<typeof wsSitePolicyDescriptionSchema>;

// ─── getCarrierInfo → WSCarrierInfo ────────────────────────────────────────────────────────────

/**
 * WSDL `WSCarrierInfo`. Who this account IS, according to EFS.
 *
 * `locationGroups` is an account-level CAPABILITY flag, not a list — false means the whole
 * location-group mechanism is off for this carrier, which would make every location-group question
 * in Phase 12 moot. Reading it first is why Step 7.2's sequence starts here.
 */
export const wsCarrierInfoSchema = z.object({
  name: z.string().nullable(),
  carrierId: vendorInt,
  locationGroups: vendorBool,
});
export type WsCarrierInfo = z.infer<typeof wsCarrierInfoSchema>;

// ─── getLastMileage → WSLastMileageArray ───────────────────────────────────────────────────────

/**
 * WSDL `WSLastMileage`. The odometer or hubometer reading EFS holds for one UNIT.
 *
 * The reading a SecureFuel account compares the driver's pump entry against (`docs/37` §1), and the
 * first thing in this integration that is keyed on a unit rather than on a card or an account.
 *
 * ── Why `mileage` is `vendorInt` and not `z.number()` ──────────────────────────────────────────
 * The WSDL declares it `int`, so a strict number would be defensible — but this schema's job is to
 * record what the account actually says (see this file's header), and the one field we are about to
 * make a *decision* from is the worst place to throw on a surprise. A reading we cannot parse
 * becomes null, the comparison against Samsara reports "EFS's copy is unreadable", and an operator
 * sees that instead of a 500.
 */
export const wsLastMileageSchema = z.object({
  unit: z.string().nullable(),
  /** `ODRD` (odometer) or `HBRD` (hubometer) — the same code the prompt carries. */
  code: z.string().nullable(),
  mileage: vendorInt,
});
export type WsLastMileage = z.infer<typeof wsLastMileageSchema>;

/**
 * The two mileage codes, and the reason this is a closed set rather than a free string.
 *
 * `overrideLastMileage` takes this code as a parameter and the operation returns NOTHING (`docs/37`
 * §3) — so a typo'd code is a write dispatched into a reading we never look at, reported as success.
 * The guide names exactly these two (p97, p135).
 */
export const EFS_MILEAGE_CODES = ["ODRD", "HBRD"] as const;
export type EfsMileageCode = (typeof EFS_MILEAGE_CODES)[number];

// ─── serverTime → xsd:dateTime ─────────────────────────────────────────────────────────────────

/**
 * EFS's own clock, verbatim.
 *
 * Kept as a STRING and not parsed to a Date on purpose. The whole reason to ask is to compare EFS's
 * idea of now against ours, and `parseEfsDateTime` exists because EFS servers are Central Time with
 * an optional offset (p10-11) — a bare `new Date()` on this value lands five or six hours out and
 * would answer the question wrongly while looking like it had answered it.
 */
export const serverTimeSchema = z.string();
export type ServerTime = z.infer<typeof serverTimeSchema>;
