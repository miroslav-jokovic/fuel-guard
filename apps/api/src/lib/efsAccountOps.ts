import {
  type WsCardRefreshingLimits,
  type WsCarrierInfo,
  type WsContract,
  type WsCreditLimits,
  type EfsMileageCode,
  type WsLastMileage,
  wsLastMileageSchema,
  type WsLocationGroup,
  type WsLocationGroupDescription,
  type WsPolicyDescription,
  type WsPolicyRefreshingLimits,
  type WsProduct,
  type WsProductGroup,
  wsCardRefreshingLimitsSchema,
  wsCarrierInfoSchema,
  wsContractSchema,
  wsCreditLimitsSchema,
  wsLocationGroupDescriptionSchema,
  wsLocationGroupSchema,
  wsPolicyDescriptionSchema,
  wsPolicyRefreshingLimitsSchema,
  wsProductGroupSchema,
  wsProductSchema,
  wsSitePolicyDescriptionSchema,
  type WsSitePolicyDescription,
} from "@fuelguard/shared";
import type { z } from "zod";
import type { Env } from "../env.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { type CardOpOptions, callCardOp, el, elAlways, resultRecords, text } from "./efsCardOps.js";
import { EfsSoapError, parseSoap } from "./efsSoapSession.js";
import { collectElements, findDescendant, type XmlElement } from "./efsXml.js";

/**
 * The fifteen ACCOUNT-level read operations (execution plan Step 7.1, extended by `docs/37` §6).
 *
 * Read-only, every one. Nothing in this file can change anything at EFS — which is why Step 7.2 can
 * expose them behind an admin route with no probe flag, and why Phase 7 is safe to run against the
 * production org: the same posture as the echo scan and the linking sweep before it.
 *
 * ⚠ **That invariant is why `overrideLastMileage` is NOT here**, even though its read half
 * `getLastMileage` is. This file's whole safety argument is "nothing in it can change anything", and
 * one write would end it for all fifteen. The override lives on its own, with its own audit and its
 * own re-read verification (`docs/37` §4).
 *
 * Split from `efsCardOps.ts` rather than added to it, on the seam that file already uses: it answers
 * "what does EFS say about this CARD", and this answers "what does EFS say about this ACCOUNT". It
 * also keeps `efsCardOps.ts` inside the 500-line budget, which thirteen more operations would not.
 *
 * ── Three of the thirteen do NOT return `<result>`, and the plan's template would miss them ──────
 * Step 7.1 says to follow `getPolicy` "exactly". `getPolicy` reads its payload out of `<result>` (or
 * `<return>`), and following that exactly here would silently parse three operations as empty:
 *
 *   getCardRefreshingLimits    -> <cardRefreshingLimitsData>     (WSDL part name)
 *   getPolicyRefreshingLimits  -> <policyRefreshingLimitsData>
 *   serverTime                 -> <serverTime>
 *
 * Read out of `<message name="CardManagementEP_…Response"><part name="…">` in the checked-in WSDL,
 * not guessed. `payload()` below takes the expected part name for exactly this reason, and the test
 * suite re-derives all thirteen from the WSDL so a fourth one cannot be added without noticing.
 *
 * ⚠ PAN DISCIPLINE. `getCardRefreshingLimits` is the only operation here that takes a card number.
 * It is passed straight through to the request and never logged, never put in an error, and the
 * caller — Step 7.2's `sampleCards` — resolves it from `efs_cards.id` through `loadCardNumber` so no
 * PAN reaches a route parameter.
 */

/**
 * Operation names, byte-for-byte as the Axis2 binding spells them.
 *
 * Every one is emitted below as a LITERAL element wrapper rather than interpolated, because that is
 * what `scripts/check-wsdl-ops.mjs` can see: the gate greps source for the CardManagementEP_ prefix
 * followed by a name, and checks each against the WSDL. Building the wrapper from a variable would
 * resolve to `efsCardOps.ts`'s OPS table — which does not contain these — and every name in this
 * file would go unchecked while the gate still reported success.
 *
 * ⚠ Which also means a PROSE example of that prefix, written with a placeholder name, is read by the
 * gate as a real operation and fails it. This paragraph used to carry one. Same trap as
 * `lint:ui-adoption`, which counts raw elements named in comments.
 */

/**
 * The container a response's payload actually sits in. See the docblock: three of these are not
 * `result`.
 *
 * `findDescendant`, not `collectElements`: the latter walks DIRECT children only, and the payload
 * sits under the response element inside the SOAP body. `getPolicy` uses the same recursive walk for
 * the same reason. The `result` / `return` fallbacks after the named part are what `getPolicy` does,
 * kept so an operation whose binding disagrees with its own WSDL part name still parses.
 */
function payload(xml: string, part: string): XmlElement {
  const root = parseSoap(xml);
  return findDescendant(root, part) ?? findDescendant(root, "result") ?? findDescendant(root, "return") ?? root;
}

/** Parse one record, or throw the same shaped error `getPolicy` throws. */
function parseOne<T extends z.ZodTypeAny>(schema: T, value: unknown, operation: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new EfsSoapError(
      `EFS ${operation} had an unexpected shape: ${parsed.error.issues[0]?.path.join(".")}`,
      "malformed_response",
      { issues: parsed.error.issues.slice(0, 5) },
    );
  }
  return parsed.data;
}

/** EFS writes booleans as true/false, True/False and 1/0 depending on the field and the version. */
function bool(value: string | null): boolean | null {
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return null;
}

// ─── getCarrierInfo ────────────────────────────────────────────────────────────────────────────

/**
 * Who this account is, and whether location groups are switched on for it at all.
 *
 * First in Step 7.2's sequence deliberately: `locationGroups: false` makes every location-group
 * question downstream moot, and finding that out after twelve more calls is finding it out late.
 */
export async function getCarrierInfo(
  env: Env,
  creds: EfsSoapCredentials,
  opts: CardOpOptions = {},
): Promise<WsCarrierInfo> {
  const xml = await callCardOp(
    env, creds, "getCarrierInfo",
    (session) => `<CardManagementEP_getCarrierInfo>${el("clientId", session.clientId)}</CardManagementEP_getCarrierInfo>`,
    { priority: "backfill", ...opts },
  );
  const node = payload(xml, "result");
  return parseOne(wsCarrierInfoSchema, {
    name: text(node, "name"),
    carrierId: text(node, "carrierId"),
    locationGroups: bool(text(node, "locationGroups")),
  }, "getCarrierInfo");
}

// ─── getPromptTypes ────────────────────────────────────────────────────────────────────────────

/**
 * The Info IDs this account owns.
 *
 * A `StringArray`, so the records are bare `<value>` leaves with no children — `resultRecords` would
 * drop them, exactly as it would for `getCardsWithNoDriverId`, whose caller handles the same shape.
 */
export async function getPromptTypes(
  env: Env,
  creds: EfsSoapCredentials,
  opts: CardOpOptions = {},
): Promise<string[]> {
  const xml = await callCardOp(
    env, creds, "getPromptTypes",
    (session) => `<CardManagementEP_getPromptTypes>${el("clientId", session.clientId)}</CardManagementEP_getPromptTypes>`,
    { priority: "backfill", ...opts },
  );
  return collectElements(payload(xml, "result"), "value")
    .map((v) => (v.textContent ?? "").trim())
    .filter(Boolean);
}

// ─── getPolicyDescriptions ─────────────────────────────────────────────────────────────────────

/** What each policy number is called, and which contract owns it. Drives Step 7.2's per-policy walk. */
export async function getPolicyDescriptions(
  env: Env,
  creds: EfsSoapCredentials,
  opts: CardOpOptions = {},
): Promise<WsPolicyDescription[]> {
  const xml = await callCardOp(
    env, creds, "getPolicyDescriptions",
    (session) => `<CardManagementEP_getPolicyDescriptions>${el("clientId", session.clientId)}</CardManagementEP_getPolicyDescriptions>`,
    { priority: "backfill", ...opts },
  );
  return resultRecords(payload(xml, "result")).map((e, i) =>
    parseOne(wsPolicyDescriptionSchema, readPolicyDescription(e), `getPolicyDescriptions[${i}]`));
}

const readPolicyDescription = (e: XmlElement) => ({
  contractId: text(e, "contractId"),
  description: text(e, "description"),
  policyNumber: text(e, "policyNumber"),
});

// ─── getProducts ───────────────────────────────────────────────────────────────────────────────

/** The account's product vocabulary — what a limit's `limitId` actually refers to. */
export async function getProducts(
  env: Env,
  creds: EfsSoapCredentials,
  opts: CardOpOptions = {},
): Promise<WsProduct[]> {
  const xml = await callCardOp(
    env, creds, "getProducts",
    (session) => `<CardManagementEP_getProducts>${el("clientId", session.clientId)}</CardManagementEP_getProducts>`,
    { priority: "backfill", ...opts },
  );
  return resultRecords(payload(xml, "result")).map((e, i) => parseOne(wsProductSchema, {
    code: text(e, "code"),
    description: text(e, "description"),
    fuelType: text(e, "fuelType"),
    fuelUse: text(e, "fuelUse"),
    group: text(e, "group"),
    phraseId: text(e, "phraseId"),
    shellClProduct: text(e, "shellClProduct"),
    shellFuelType: text(e, "shellFuelType"),
    shellPriceGroup: text(e, "shellPriceGroup"),
  }, `getProducts[${i}]`));
}

// ─── getProductGroups ──────────────────────────────────────────────────────────────────────────

/** Product groups. `isFuel` is what decides gallons-versus-dollars when a limit is rendered. */
export async function getProductGroups(
  env: Env,
  creds: EfsSoapCredentials,
  opts: CardOpOptions = {},
): Promise<WsProductGroup[]> {
  const xml = await callCardOp(
    env, creds, "getProductGroups",
    (session) => `<CardManagementEP_getProductGroups>${el("clientId", session.clientId)}</CardManagementEP_getProductGroups>`,
    { priority: "backfill", ...opts },
  );
  return resultRecords(payload(xml, "result")).map((e, i) => parseOne(wsProductGroupSchema, {
    description: text(e, "description"),
    groupId: text(e, "groupId"),
    groupNumber: text(e, "groupNumber"),
    isFuel: bool(text(e, "isFuel")),
  }, `getProductGroups[${i}]`));
}

// ─── getContracts ──────────────────────────────────────────────────────────────────────────────

/** The account's contracts. `contractId` is the key `getCreditLimits` is then called once per. */
export async function getContracts(
  env: Env,
  creds: EfsSoapCredentials,
  opts: CardOpOptions = {},
): Promise<WsContract[]> {
  const xml = await callCardOp(
    env, creds, "getContracts",
    (session) => `<CardManagementEP_getContracts>${el("clientId", session.clientId)}</CardManagementEP_getContracts>`,
    { priority: "backfill", ...opts },
  );
  return resultRecords(payload(xml, "result")).map((e, i) => parseOne(wsContractSchema, {
    checkFee: text(e, "checkFee"),
    contractId: text(e, "contractId"),
    country: text(e, "country"),
    currency: text(e, "currency"),
    description: text(e, "description"),
    issuerId: text(e, "issuerId"),
    limitMethod: text(e, "limitMethod"),
    masterContract: bool(text(e, "masterContract")),
    status: text(e, "status"),
  }, `getContracts[${i}]`));
}

// ─── getCreditLimits ───────────────────────────────────────────────────────────────────────────

/**
 * The real credit ceiling for one contract.
 *
 * WSDL `parameterOrder="clientId contractId"` — per contract, never account-wide, which is why Step
 * 7.2 runs it inside the loop over `getContracts`.
 */
export async function getCreditLimits(
  env: Env,
  creds: EfsSoapCredentials,
  contractId: number,
  opts: CardOpOptions = {},
): Promise<WsCreditLimits> {
  const xml = await callCardOp(
    env, creds, "getCreditLimits",
    (session) =>
      `<CardManagementEP_getCreditLimits>${el("clientId", session.clientId)}${el("contractId", contractId)}</CardManagementEP_getCreditLimits>`,
    { priority: "backfill", ...opts },
  );
  const node = payload(xml, "result");
  return parseOne(wsCreditLimitsSchema, {
    contractStatus: text(node, "contractStatus"),
    transLimit: text(node, "transLimit"),
    origLimit: text(node, "origLimit"),
    creditAvailable: text(node, "creditAvailable"),
    dailyLimit: text(node, "dailyLimit"),
    dailyAvailable: text(node, "dailyAvailable"),
    totalAvailable: text(node, "totalAvailable"),
    maxMoneyCode: text(node, "maxMoneyCode"),
    uom: text(node, "uom"),
  }, "getCreditLimits");
}

// ─── getCardRefreshingLimits ───────────────────────────────────────────────────────────────────

/**
 * One card's refreshing limits — and a FIFTH source field no surface has ever shown.
 *
 * ⚠ Its response part is `cardRefreshingLimitsData`, NOT `result`. Following `getPolicy`'s template
 * exactly would parse this as empty and report a card with no refreshing limits at all.
 *
 * ⚠ Takes a full card number. The only PAN-bearing operation in this file — see the header.
 */
export async function getCardRefreshingLimits(
  env: Env,
  creds: EfsSoapCredentials,
  cardNumber: string,
  opts: CardOpOptions = {},
): Promise<WsCardRefreshingLimits> {
  const xml = await callCardOp(
    env, creds, "getCardRefreshingLimits",
    (session) =>
      `<CardManagementEP_getCardRefreshingLimits>${el("clientId", session.clientId)}${el("cardNumber", cardNumber)}</CardManagementEP_getCardRefreshingLimits>`,
    { priority: "backfill", ...opts },
  );
  const node = payload(xml, "cardRefreshingLimitsData");
  return parseOne(wsCardRefreshingLimitsSchema, {
    refreshingLimitSource: text(node, "refreshingLimitSource"),
    ...readRefreshingCounters(node),
  }, "getCardRefreshingLimits");
}

// ─── getPolicyRefreshingLimits ─────────────────────────────────────────────────────────────────

/**
 * One policy's refreshing limits.
 *
 * ⚠ Two traps, both from the WSDL and neither visible from the plan. The request parameter is
 * `policy`, not `policyNumber` — `parameterOrder="clientId policy"` — and the response part is
 * `policyRefreshingLimitsData`, not `result`.
 */
export async function getPolicyRefreshingLimits(
  env: Env,
  creds: EfsSoapCredentials,
  policyNumber: number,
  opts: CardOpOptions = {},
): Promise<WsPolicyRefreshingLimits> {
  const xml = await callCardOp(
    env, creds, "getPolicyRefreshingLimits",
    (session) =>
      `<CardManagementEP_getPolicyRefreshingLimits>${el("clientId", session.clientId)}${el("policy", policyNumber)}</CardManagementEP_getPolicyRefreshingLimits>`,
    { priority: "backfill", ...opts },
  );
  return parseOne(
    wsPolicyRefreshingLimitsSchema,
    readRefreshingCounters(payload(xml, "policyRefreshingLimitsData")),
    "getPolicyRefreshingLimits",
  );
}

/** The six counters both refreshing-limit documents share — one reader, so they cannot drift. */
const readRefreshingCounters = (e: XmlElement) => ({
  dayCntLimit: text(e, "dayCntLimit"),
  dayAmtLimit: text(e, "dayAmtLimit"),
  weekCntLimit: text(e, "weekCntLimit"),
  weekAmtLimit: text(e, "weekAmtLimit"),
  monCntLimit: text(e, "monCntLimit"),
  monAmtLimit: text(e, "monAmtLimit"),
});

// ─── getLocationGroupDescriptions ──────────────────────────────────────────────────────────────

/** Every location group the account has, with whether its membership is rule-based or explicit. */
export async function getLocationGroupDescriptions(
  env: Env,
  creds: EfsSoapCredentials,
  opts: CardOpOptions = {},
): Promise<WsLocationGroupDescription[]> {
  const xml = await callCardOp(
    env, creds, "getLocationGroupDescriptions",
    (session) => `<CardManagementEP_getLocationGroupDescriptions>${el("clientId", session.clientId)}</CardManagementEP_getLocationGroupDescriptions>`,
    { priority: "backfill", ...opts },
  );
  return resultRecords(payload(xml, "result")).map((e, i) => parseOne(wsLocationGroupDescriptionSchema, {
    grpId: text(e, "grpId"),
    name: text(e, "name"),
    ruleBased: bool(text(e, "ruleBased")),
    editable: bool(text(e, "editable")),
  }, `getLocationGroupDescriptions[${i}]`));
}

// ─── getLocationGroups ─────────────────────────────────────────────────────────────────────────

/**
 * The location groups in force for ONE card or ONE policy.
 *
 * ⚠ NOT an account-level call. `parameterOrder="clientId cardNum policyNum"`, so it always asks about
 * a specific card or policy — which is why Step 7.2's account walk uses
 * `getLocationGroupDescriptions` and reaches this one only through its optional `sampleCards`.
 *
 * Both filters are sent even when empty, via `elAlways`: this binding rejects omitted filter elements
 * even where the WSDL marks them nillable (see `elAlways`'s own docblock, and the rejected-feed
 * request that proved it).
 */
export async function getLocationGroups(
  env: Env,
  creds: EfsSoapCredentials,
  target: { cardNumber?: string | null; policyNumber?: number | null },
  opts: CardOpOptions = {},
): Promise<WsLocationGroup[]> {
  const xml = await callCardOp(
    env, creds, "getLocationGroups",
    (session) =>
      `<CardManagementEP_getLocationGroups>${el("clientId", session.clientId)}`
      + `${elAlways("cardNum", target.cardNumber ?? "")}${elAlways("policyNum", target.policyNumber ?? "")}`
      + `</CardManagementEP_getLocationGroups>`,
    { priority: "backfill", ...opts },
  );
  return resultRecords(payload(xml, "result")).map((e, i) => parseOne(wsLocationGroupSchema, {
    grpId: text(e, "grpId"),
    name: text(e, "name"),
    carrierId: text(e, "carrierId"),
  }, `getLocationGroups[${i}]`));
}

// ─── getSitePolicyDescriptions ─────────────────────────────────────────────────────────────────

/** Site policies, each carrying a nested `WSPolicyDescription` that may legitimately be absent. */
export async function getSitePolicyDescriptions(
  env: Env,
  creds: EfsSoapCredentials,
  opts: CardOpOptions = {},
): Promise<WsSitePolicyDescription[]> {
  const xml = await callCardOp(
    env, creds, "getSitePolicyDescriptions",
    (session) => `<CardManagementEP_getSitePolicyDescriptions>${el("clientId", session.clientId)}</CardManagementEP_getSitePolicyDescriptions>`,
    { priority: "backfill", ...opts },
  );
  return resultRecords(payload(xml, "result")).map((e, i) => {
    const [nested] = collectElements(e, "sitePolicyPolicy");
    return parseOne(wsSitePolicyDescriptionSchema, {
      sitePolicy: text(e, "sitePolicy"),
      siteDescription: text(e, "siteDescription"),
      sitePolicyPolicy: nested ? readPolicyDescription(nested) : null,
    }, `getSitePolicyDescriptions[${i}]`);
  });
}

// ─── doesCardPosition ──────────────────────────────────────────────────────────────────────────

/**
 * Whether this account uses SecureFuel at all (`docs/37` §6 A).
 *
 * > *"This method will return if the customer uses secure fuel. If has secure fuel rules of 1 or 2
 * > and a member type of customer, this will return true."* (guide p30)
 *
 * The cheapest question in the inventory and the one that gates every other odometer question: on an
 * account that answers false, the accrual window, the stored mileage and the override are all
 * inert. Asking it costs one call and no parameters beyond the session.
 *
 * ⚠ Response part is `doesCardPosition`, not `result` — read from
 * `<message name="CardManagementEP_doesCardPositionResponse"><part name="doesCardPosition">` in the
 * checked-in WSDL. A fourth operation joins the three named in this file's header.
 *
 * ⚠ It does NOT say WHICH of the two rules applies, and the guide gives no operation that does. That
 * is open question 2 in `docs/37` §7 — one rule may be odometer-only and the other add position, and
 * the difference decides what this product can honestly tell an operator about a decline.
 */
export async function doesCardPosition(
  env: Env,
  creds: EfsSoapCredentials,
  opts: CardOpOptions = {},
): Promise<boolean | null> {
  const xml = await callCardOp(
    env, creds, "doesCardPosition",
    (session) => `<CardManagementEP_doesCardPosition>${el("clientId", session.clientId)}</CardManagementEP_doesCardPosition>`,
    { priority: "backfill", ...opts },
  );
  return bool((payload(xml, "doesCardPosition").textContent ?? "").trim());
}

// ─── getLastMileage ────────────────────────────────────────────────────────────────────────────

/**
 * The odometer or hubometer reading EFS holds, per UNIT (`docs/37` §6 D).
 *
 * The reading a SecureFuel account compares the driver's pump entry against, and the state
 * `overrideLastMileage` corrects. It is also the ONLY way to judge whether that override landed:
 * the write's response message has no parts at all (`docs/37` §3), so this read is the verification.
 *
 * ── The `search` wrapper is READ, not guessed ───────────────────────────────────────────────────
 * `efsLocationSearch.ts` had to discover its wrapper by trying shapes against the live binding and
 * remembering which one ADB accepted — the WSDL was not available when it was written. It is now:
 * `<message name="CardManagementEP_getLastMileage"><part name="search" type="ns2:WSLastMileageSearch">`.
 * The element is `search`, on the vendor's own authority, so no shape ladder is needed here.
 *
 * ── One `WSLastMileageSearch`, not an array ─────────────────────────────────────────────────────
 * The guide says *"Search Array, 1 to many"* (p84) and the WSDL declares a single
 * `WSLastMileageSearch` with no `…SearchArray` type anywhere in it. The WSDL wins, as it has in five
 * prior discrepancies. `docs/37` §7 question 3 is whether the binding nonetheless accepts repeats;
 * until that is probed, one unit per call.
 *
 * ── Both criteria are sent even when empty, and that is what "All" means ────────────────────────
 * `elAlways`, per the rule this binding taught the transaction feeds: it "rejects omitted filter
 * elements even though the WSDL marks them nillable". Sending both empty is the wire equivalent of
 * the WEX portal's **All** radio, which returns every unit's row in one page — so a fleet-wide drift
 * comparison may cost one round trip rather than one per unit.
 *
 * ⚠ That last part is an INFERENCE from the portal's UI, not from the wire, and it is the first
 * thing to probe live. If empty criteria are refused rather than treated as "all", the caller must
 * pass a unit and the fleet view costs N calls — which changes what §6 D can afford, not whether it
 * works.
 *
 * ⚠ `code` on the wire is `ODRD` / `HBRD`. The portal DISPLAYS it as "odometer"; that label is not a
 * wire value, and sending it would be the same class of mistake as reading `M:1, X:1800` as a
 * string. `EFS_MILEAGE_CODES` is the closed set for exactly this reason.
 */
export async function getLastMileage(
  env: Env,
  creds: EfsSoapCredentials,
  search: { unit?: string | null; code?: EfsMileageCode | null } = {},
  opts: CardOpOptions = {},
): Promise<WsLastMileage[]> {
  const xml = await callCardOp(
    env, creds, "getLastMileage",
    (session) =>
      `<CardManagementEP_getLastMileage>${el("clientId", session.clientId)}`
      + `<search>${elAlways("unit", search.unit ?? "")}${elAlways("code", search.code ?? "")}</search>`
      + `</CardManagementEP_getLastMileage>`,
    { priority: "backfill", ...opts },
  );
  return resultRecords(payload(xml, "result")).map((e, i) => parseOne(wsLastMileageSchema, {
    unit: text(e, "unit"),
    code: text(e, "code"),
    mileage: text(e, "mileage"),
  }, `getLastMileage[${i}]`));
}

// ─── serverTime ────────────────────────────────────────────────────────────────────────────────

/**
 * EFS's own clock, verbatim.
 *
 * ⚠ Response part is `serverTime`, not `result`.
 *
 * Returned as the raw string. The point of asking is to compare EFS's now against ours, and EFS
 * servers are Central Time with an optional offset (p10-11) — parsing it here with a bare `new Date`
 * would land five or six hours out and answer the question wrongly while appearing to answer it.
 */
export async function serverTime(
  env: Env,
  creds: EfsSoapCredentials,
  opts: CardOpOptions = {},
): Promise<string | null> {
  const xml = await callCardOp(
    env, creds, "serverTime",
    (session) => `<CardManagementEP_serverTime>${el("clientId", session.clientId)}</CardManagementEP_serverTime>`,
    { priority: "backfill", ...opts },
  );
  // `payload`, not a direct-children scan: the value sits under the response element inside the SOAP
  // body, and `collectElements` walks direct children only. Caught by this operation returning null
  // against its own fixture.
  const value = (payload(xml, "serverTime").textContent ?? "").trim();
  return value || null;
}
