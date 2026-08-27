import {
  type WsPolicy,
  parseEfsDateTime,
  wsPolicySchema,
} from "@silvicom/shared";
import type { Env } from "../../../env.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { redactCardXml } from "./efsCardXml.js";
import { type CardDocument, parseCardDocument } from "./efsCardXml.js";
import {
  EfsSoapError,
  type EfsRequestOptions,
  type EfsSession,
  parseSoap,
  requestXml,
  withEfsSession,
} from "./efsSoapSession.js";
import { childElements, collectElements, findDescendant, localName, xmlEscape, type XmlElement } from "./efsXml.js";
import type { SoapPriority } from "./soapClient.js";

/**
 * EFS `CardManagementWS` CARD operations — the read half.
 *
 * READ ONLY, deliberately. `setCardV2` does not live here yet and must not until the entitlement
 * probe has proved three things on the QA endpoint: that our service account may write at all, that a
 * zero-edit echo round-trips, and that a no-op write leaves `cardVersion` unchanged. Until then, the
 * only way to change a card is the WEX portal, which is exactly where we were before — and Phase A is
 * worth shipping on its own, because a Cards page showing vendor truth is something Silvicom 360 has
 * never had. `fuel_cards` rows today are INFERRED by learnCardAssignments, not read from EFS.
 *
 * Everything here goes through `withEfsSession`, so N concurrent page loads cost one login and share
 * the circuit breaker with the transaction feeds (see efsSoapSession.ts).
 *
 * ── A note on request shapes ─────────────────────────────────────────────────────────────────────
 * The guide documents each operation's INPUT FIELDS but not always the element nesting around them,
 * and its two-column tables render ambiguously for the search operations in particular. Where that is
 * true the code says so at the call site and takes the most literal reading. The QA probe is what
 * settles it; nothing here is a silent guess.
 *
 * `searchLocation` — the operation where that ambiguity actually bit — lives in efsLocationSearch.ts,
 * split out at this file's 500-line budget, together with the request-shape ladder that resolves it.
 */

const OPS = {
  getCardV2: "getCardv2",
  getCard: "getCard",
  getCardSummaries: "getCardSummaries",
  getCardSummariesV2: "getCardSummariesV2",
  getCardsWithNoDriverId: "getCardsWithNoDriverId",
  getPolicy: "getPolicy",
} as const;

/**
 * Emit the element only when the value is present.
 *
 * Exported alongside `elAlways` for `efsAccountOps.ts` (Step 7.1) — same arrangement as
 * `callCardOp` / `resultRecords` / `text`: the canonical home stays here and the split operation
 * modules import. A second copy would be a second place for the escaping to go wrong.
 */
export const el = (name: string, value: string | number | null | undefined): string =>
  value === null || value === undefined || value === "" ? "" : `<${name}>${xmlEscape(String(value))}</${name}>`;

/**
 * Emit the element even when the value is empty.
 *
 * ⚠ This is not a style choice. `docs/plans/EFS-SOAP-INTEGRATION-PLAN.md` records what the transaction
 * feeds learned against the production WSDL: **"EFS's Axis2 binding rejects omitted filter elements
 * even though the WSDL marks them nillable."** That is why the working rejected-feed request sends
 * `<cardNum></cardNum><invoice></invoice><locationId>0</locationId>` rather than leaving them out.
 *
 * The guide describing a field as "optional" or "you can leave this field blank" means SEND IT EMPTY,
 * not omit it. Anything the binding expects structurally uses this helper; `el` is only for fields
 * whose omission the binding demonstrably tolerates (clientId+cardNumber-style required pairs).
 *
 * Exported — along with `callCardOp`, `resultRecords` and `text` — for `efsLocationSearch.ts`, the
 * operation module split out of this file at the 500-line budget. Same arrangement as the
 * soapClient/efsTls split: the canonical home stays here, the split module imports.
 */
export const elAlways = (name: string, value: string | number | null | undefined): string =>
  `<${name}>${value === null || value === undefined ? "" : xmlEscape(String(value))}</${name}>`;

/** Reads run in the interactive lane by default: a person is usually waiting on one. */
const DEFAULT_PRIORITY: SoapPriority = "interactive";

export interface CardOpOptions extends EfsRequestOptions {
  priority?: SoapPriority;
}

export async function callCardOp(
  env: Env,
  creds: EfsSoapCredentials,
  operation: string,
  body: (session: EfsSession) => string,
  opts: CardOpOptions,
): Promise<string> {
  const priority = opts.priority ?? DEFAULT_PRIORITY;
  return withEfsSession(
    env, creds, priority,
    async (session) => {
      const response = await requestXml(env, creds, operation, body(session), priority, {
        ...opts,
        cookie: session.cookie,
      });
      return response.body;
    },
    opts,
  );
}

/**
 * Pull the repeated record elements out of a response.
 *
 * Tolerant on purpose. The feeds' `responseValues` assumes `<result><value>…`, and several of these
 * operations are documented only as "Array containing:" with no element names at all. So: find the
 * container (`result` or `return`, else the response element itself), then prefer `<value>` children
 * if there are any and fall back to every child that has children of its own. A record with no
 * sub-elements — `getCardsWithNoDriverId` returns bare card numbers — is handled by its own caller.
 */
export function resultRecords(root: XmlElement): XmlElement[] {
  const container = findDescendant(root, "result") ?? findDescendant(root, "return") ?? root;
  const values = collectElements(container, "value");
  if (values.length > 0) return values;
  return childElements(container).filter((child) => childElements(child).length > 0);
}

export function text(parent: XmlElement, name: string): string | null {
  const found = collectElements(parent, name)[0];
  if (!found) return null;
  const attr = found.getAttribute("xsi:nil") ?? found.getAttribute("nil");
  if (attr === "true" || attr === "1") return null;
  const value = (found.textContent ?? "").trim();
  return value === "" ? null : value;
}

/** Case-insensitive field read. EFS is inconsistent about leading capitals (`Gpsid`, `Vin`, `Infosrc`). */
function textAnyCase(parent: XmlElement, ...names: string[]): string | null {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const child of childElements(parent)) {
    if (!wanted.has(localName(child).toLowerCase())) continue;
    const value = (child.textContent ?? "").trim();
    if (value !== "") return value;
  }
  return null;
}

// ─── getCardv2 ─────────────────────────────────────────────────────────────────────────────────

/**
 * Fetch one card's full configuration.
 *
 * v2 rather than v1 for a specific reason: v2 additionally returns the card-level refreshing /
 * auto-roll limits (`autoRollMap`, `autoRollMax`, p38). Those fields are part of the document, so
 * reading with v1 and writing with setCardV2 would echo a document that never contained them — which
 * is the deletion this whole design exists to prevent.
 */
export async function getCardV2(
  env: Env,
  creds: EfsSoapCredentials,
  cardNumber: string,
  opts: CardOpOptions = {},
): Promise<CardDocument> {
  const xml = await callCardOp(
    env, creds, OPS.getCardV2,
    (session) =>
      `<CardManagementEP_getCardv2>${el("clientId", session.clientId)}${el("cardNumber", cardNumber)}</CardManagementEP_getCardv2>`,
    opts,
  );
  return parseCardDocument(xml);
}

// ─── getCardSummaries ──────────────────────────────────────────────────────────────────────────

/** Search types accepted by getCardSummaries / getCardSummariesV2 (p44–45). */
export type CardSearchType =
  | "NUMBER" | "XREF" | "UNIT" | "DRIVERID" | "DRIVERNAME" | "POLICY" | "GPSID" | "VIN" | "STATUS";

export interface CardSearch {
  type: CardSearchType;
  /** For STATUS the parameter is a single letter: A active, H hold, U fraud, I inactive (p44). */
  searchParam: string;
}

export interface CardSummaryRow {
  cardNumber: string;
  policyNumber: number | null;
  companyXref: string | null;
  unitNumber: string | null;
  driverId: string | null;
  driverName: string | null;
  /**
   * REMAINING OVERRIDE USES, 0–9 — an int per the live WSDL, not the guide's "boolean(1)". The
   * boolean parse read a 2–9 use count as null → false, so a card with three exceptions left showed
   * "no override" in the mirror and the fleet view (audit W1) — the exact exception-visibility this
   * product sells.
   */
  override: number;
  /** The card is currently BEING overridden — a distinct field in the response (p44). */
  beingOverridden: boolean;
  status: string | null;
  payrollStatus: string | null;
  infoSource: string | null;
  cardSubfleet: string | null;
}

/**
 * List the fleet's cards.
 *
 * ⚠ THE RESPONSE CONTAINS FULL CARD NUMBERS FOR THE ENTIRE FLEET IN ONE BODY. It must never be
 * logged, never persisted raw, and never attached to an error. Every throw below redacts first.
 *
 * Search shape: RESOLVED by the live WSDL (2026-08-12) where the guide's tables rendered
 * ambiguously. v2 takes ONE `request` part (WSCardSummaryV2Req) whose children are `payrUse` and a
 * `filter` element holding repeated `clause{type, searchParam}` records; v1 takes one `request`
 * with `type`/`searchParam`/`payrUse` as direct children — a single clause by construction. The
 * previous builder emitted repeated `<request>` siblings, which matched neither (audit W2); the
 * unfiltered call — one empty `<request>`, the mirror sweep's shape that runs every night — is
 * unchanged. Filtered searches remain probe-before-depend: the shape is now WSDL-true, but no
 * production path consumes a filtered search until one QA probe call has seen it answered.
 */
export async function getCardSummaries(
  env: Env,
  creds: EfsSoapCredentials,
  opts: CardOpOptions & { searches?: readonly CardSearch[]; payrollUse?: "P" | "B" | "N"; useV2?: boolean } = {},
): Promise<CardSummaryRow[]> {
  // The guide documents BOTH getCardSummaries (p44) and getCardSummariesV2 (p45), and says nothing
  // about which one a given account is provisioned for. When v2 comes back refused rather than
  // broken, fall back to v1 ONCE. That single extra call is what separates "this account is on the
  // older API surface" from "EFS is blocking us outright" — and it answers the question in
  // production, where the alternative is a round trip through support to ask.
  if (opts.useV2 === undefined) {
    try {
      return await getCardSummaries(env, creds, { ...opts, useV2: true });
    } catch (error) {
      if (!(error instanceof EfsSoapError) || (error.code !== "not_allowed" && error.code !== "soap_fault")) throw error;
      console.warn(`[efs-cards] getCardSummariesV2 refused (${error.code}: ${error.message}) — retrying the v1 operation once`);
      try {
        return await getCardSummaries(env, creds, { ...opts, useV2: false });
      } catch (fallbackError) {
        // Name BOTH outcomes. "v2 refused, v1 also refused" is an account-level block; "v2 refused,
        // v1 worked" is a provisioning difference. One sentence, and nobody has to guess which.
        const second = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new EfsSoapError(
          `EFS refused both card-list operations — v2: ${error.message}; v1: ${second}`,
          error.code,
          { v2: error.detail, v1: second },
        );
      }
    }
  }
  const operation = opts.useV2 === false ? OPS.getCardSummaries : OPS.getCardSummariesV2;
  const useV1 = opts.useV2 === false;
  const searches = opts.searches ?? [];
  if (useV1 && searches.length > 1) {
    // WSCardSummaryReq holds exactly one type/searchParam pair. Silently sending only the first
    // would return a DIFFERENT fleet subset than the caller asked for.
    throw new EfsSoapError("getCardSummaries (v1) supports at most one search clause", "not_implemented");
  }
  // With no filters at all, still send ONE empty <request>. Omitting it entirely is what the binding
  // is documented to reject (see elAlways), and "no search" is the normal case for the mirror sweep —
  // so this is the shape that runs every night, not an edge case.
  let requestElements = "<request></request>";
  if (searches.length > 0 || opts.payrollUse) {
    const payrUse = opts.payrollUse ? elAlways("payrUse", opts.payrollUse) : "";
    if (useV1) {
      const one = searches[0];
      requestElements = `<request>${one ? `${elAlways("type", one.type)}${elAlways("searchParam", one.searchParam)}` : ""}${payrUse}</request>`;
    } else {
      const clauses = searches
        .map((c) => `<clause>${elAlways("type", c.type)}${elAlways("searchParam", c.searchParam)}</clause>`)
        .join("");
      requestElements = `<request>${payrUse}<filter>${clauses}</filter></request>`;
    }
  }
  const xml = await callCardOp(
    env, creds, operation,
    (session) =>
      `<CardManagementEP_${operation}>${elAlways("clientId", session.clientId)}${requestElements}</CardManagementEP_${operation}>`,
    { priority: "backfill", ...opts },
  );

  try {
    return resultRecords(parseSoap(xml)).map((record) => ({
      cardNumber: text(record, "cardNumber") ?? "",
      policyNumber: toInt(text(record, "policyNumber")),
      companyXref: textAnyCase(record, "companyXref", "companyXRef"),
      unitNumber: text(record, "unitNumber"),
      driverId: text(record, "driverId"),
      driverName: text(record, "driverName"),
      override: toInt(text(record, "override")) ?? 0,
      beingOverridden: truthy(text(record, "beingOverridden")),
      status: text(record, "status"),
      payrollStatus: text(record, "payrollStatus"),
      infoSource: textAnyCase(record, "infosrc", "infoSource"),
      cardSubfleet: text(record, "cardSubfleet"),
    })).filter((row) => row.cardNumber !== "");
  } catch (error) {
    // Never let a parse failure carry the fleet's PANs into a log line or a Sentry event.
    throw new EfsSoapError(
      `Could not read the EFS card list: ${error instanceof Error ? error.message : String(error)}`,
      "malformed_response",
      { sample: redactCardXml(xml).slice(0, 400) },
    );
  }
}

/** Cards with no Driver ID assigned — "handy for finding cards available to be assigned" (p46). */
export async function getCardsWithNoDriverId(
  env: Env,
  creds: EfsSoapCredentials,
  opts: CardOpOptions & { cardType?: "P" | "B" | "N" | "Y" | "L" } = {},
): Promise<string[]> {
  const xml = await callCardOp(
    env, creds, OPS.getCardsWithNoDriverId,
    (session) =>
      `<CardManagementEP_getCardsWithNoDriverId>${elAlways("clientId", session.clientId)}${elAlways("cardType", opts.cardType ?? "")}</CardManagementEP_getCardsWithNoDriverId>`,
    { priority: "backfill", ...opts },
  );
  // Output is a bare list of card numbers (`<value>` leaves), not records — resultRecords would drop
  // them because they have no children.
  const container = findDescendant(parseSoap(xml), "result") ?? parseSoap(xml);
  return collectElements(container, "value")
    .map((v) => (v.textContent ?? "").trim())
    .filter(Boolean);
}

// ─── getPolicy ─────────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a policy's configuration.
 *
 * Required for an honest card page, not a nicety: getCard returns CARD-level prompts, limits and time
 * restrictions ONLY, even when the source says BOTH (p36–37). Without this call the screen shows half
 * the rules the pump will actually enforce.
 */
export async function getPolicy(
  env: Env,
  creds: EfsSoapCredentials,
  policyNumber: number,
  opts: CardOpOptions = {},
): Promise<WsPolicy> {
  const xml = await callCardOp(
    env, creds, OPS.getPolicy,
    (session) =>
      `<CardManagementEP_getPolicy>${el("clientId", session.clientId)}${el("policyNumber", policyNumber)}</CardManagementEP_getPolicy>`,
    opts,
  );
  const root = parseSoap(xml);
  const policy = findDescendant(root, "result") ?? findDescendant(root, "return") ?? root;

  const parsed = wsPolicySchema.safeParse({
    policyNumber,
    description: text(policy, "description"),
    handEnter: parseBool(text(policy, "handEnter")),
    infos: collectElements(policy, "infos").map((e) => ({
      infoId: text(e, "infoId") ?? "",
      validationType: text(e, "validationType"),
      matchValue: text(e, "matchValue"),
      reportValue: text(e, "reportValue"),
      // Step 7.3. `WSPolicy.infos` is the same `WSCardInfo` type as a card's, so a POLICY-level
      // prompt carries this field too — and on this account every card is `infoSource: BOTH`, so
      // policy prompts are in force fleet-wide. Caught by the schema, not by review.
      numericMatchValue: text(e, "numericMatchValue"),
      lengthCheck: parseBool(text(e, "lengthCheck")),
      minimum: toInt(text(e, "minimum") ?? text(e, "Minimum")),
      maximum: toInt(text(e, "maximum")),
      value: text(e, "value"),
    })),
    limits: collectElements(policy, "limits").map((e) => ({
      limitId: text(e, "limitId") ?? "",
      limit: toInt(text(e, "limit")) ?? 0,
      hours: toInt(text(e, "hours")),
      minHours: toInt(text(e, "minHours")),
      autoRollMap: toInt(text(e, "autoRollMap")),
      autoRollMax: toInt(text(e, "autoRollMax")),
    })),
    locationGroups: collectElements(policy, "locationGroups").map((e) => (e.textContent ?? "").trim()).filter(Boolean),
    locations: collectElements(policy, "locations").map((e) => (e.textContent ?? "").trim()).filter(Boolean),
    timeRestrictions: collectElements(policy, "timeRestrictions").map((e) => ({
      day: toInt(text(e, "day")) ?? 0,
      beginTime: text(e, "beginTime"),
      endTime: text(e, "endTime"),
    })),
  });
  if (!parsed.success) {
    throw new EfsSoapError(
      `EFS policy ${policyNumber} had an unexpected shape: ${parsed.error.issues[0]?.path.join(".")}`,
      "malformed_response",
      { issues: parsed.error.issues.slice(0, 5) },
    );
  }
  return parsed.data;
}

// ─── small helpers ─────────────────────────────────────────────────────────────────────────────

function toInt(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** EFS writes booleans as true/false, True/False and 1/0 depending on the field and the version. */
function parseBool(value: string | null): boolean | null {
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return null;
}

const truthy = (value: string | null): boolean => parseBool(value) === true;

/** Convenience for the mirror: EFS datetimes are Central Time (p10) and often carry no offset. */
export const efsTimestamp = (value: string | null): string | null => parseEfsDateTime(value);
