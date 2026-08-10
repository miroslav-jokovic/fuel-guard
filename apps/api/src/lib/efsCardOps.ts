import {
  type EfsLocation,
  type WsPolicy,
  parseEfsDateTime,
  wsPolicySchema,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
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
 * worth shipping on its own, because a Cards page showing vendor truth is something FuelGuard has
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
 */

const OPS = {
  getCardV2: "getCardv2",
  getCard: "getCard",
  getCardSummaries: "getCardSummaries",
  getCardSummariesV2: "getCardSummariesV2",
  getCardsWithNoDriverId: "getCardsWithNoDriverId",
  getPolicy: "getPolicy",
  searchLocation: "searchLocation",
} as const;

const el = (name: string, value: string | number | null | undefined): string =>
  value === null || value === undefined || value === "" ? "" : `<${name}>${xmlEscape(String(value))}</${name}>`;

/** Reads run in the interactive lane by default: a person is usually waiting on one. */
const DEFAULT_PRIORITY: SoapPriority = "interactive";

export interface CardOpOptions extends EfsRequestOptions {
  priority?: SoapPriority;
}

async function call(
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
function resultRecords(root: XmlElement): XmlElement[] {
  const container = findDescendant(root, "result") ?? findDescendant(root, "return") ?? root;
  const values = collectElements(container, "value");
  if (values.length > 0) return values;
  return childElements(container).filter((child) => childElements(child).length > 0);
}

function text(parent: XmlElement, name: string): string | null {
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
  const xml = await call(
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
  /** The card has an override configured. */
  override: boolean;
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
 * Search shape: the guide shows a `request` element carrying `payrUse` alongside a repeated `request`
 * array carrying `type`/`searchParam` (p45). That is genuinely ambiguous in the source document, so
 * the default here sends NO search at all — the fields are documented as "Optional search features",
 * and an unfiltered list is what the mirror sweep wants anyway. Filters are exercised by the probe
 * before anything depends on them.
 */
export async function getCardSummaries(
  env: Env,
  creds: EfsSoapCredentials,
  opts: CardOpOptions & { searches?: readonly CardSearch[]; payrollUse?: "P" | "B" | "N"; useV2?: boolean } = {},
): Promise<CardSummaryRow[]> {
  const operation = opts.useV2 === false ? OPS.getCardSummaries : OPS.getCardSummariesV2;
  const searches = (opts.searches ?? [])
    .map((s) => `<request>${el("type", s.type)}${el("searchParam", s.searchParam)}</request>`)
    .join("");
  const payrollUse = opts.payrollUse ? `<request>${el("payrUse", opts.payrollUse)}</request>` : "";
  const xml = await call(
    env, creds, operation,
    (session) =>
      `<CardManagementEP_${operation}>${el("clientId", session.clientId)}${payrollUse}${searches}</CardManagementEP_${operation}>`,
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
      override: truthy(text(record, "override")),
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
  const xml = await call(
    env, creds, OPS.getCardsWithNoDriverId,
    (session) =>
      `<CardManagementEP_getCardsWithNoDriverId>${el("clientId", session.clientId)}${el("cardType", opts.cardType ?? "")}</CardManagementEP_getCardsWithNoDriverId>`,
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
  const xml = await call(
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

// ─── searchLocation ────────────────────────────────────────────────────────────────────────────

export interface LocationQuery {
  locId?: string | null;
  state?: string | null;
  city?: string | null;
  /** A "like" search (p132). */
  name?: string | null;
  country?: "USA" | "CAN" | "MXN" | null;
  chainId?: string | null;
}

/**
 * Find EFS locations. Backs the single-location override picker — an operator knows "the Love's on
 * I-57", not a 6-digit id, and p194 requires a valid id.
 *
 * "the system needs to select 1 to many items to search, not all are required" (p132): an entirely
 * empty query would ask EFS for every location it has, so we refuse it here rather than find out what
 * that does to a paced connection.
 */
export async function searchLocation(
  env: Env,
  creds: EfsSoapCredentials,
  query: LocationQuery,
  opts: CardOpOptions = {},
): Promise<EfsLocation[]> {
  const fields =
    el("locId", query.locId) + el("state", query.state) + el("city", query.city) +
    el("name", query.name) + el("country", query.country) + el("chainId", query.chainId);
  if (fields === "") {
    throw new EfsSoapError("A location search needs at least one criterion", "not_implemented");
  }
  const xml = await call(
    env, creds, OPS.searchLocation,
    (session) => `<CardManagementEP_searchLocation>${el("clientId", session.clientId)}${fields}</CardManagementEP_searchLocation>`,
    opts,
  );
  return resultRecords(parseSoap(xml)).map((record) => ({
    locId: text(record, "locId") ?? "",
    name: text(record, "name"),
    city: text(record, "city"),
    state: text(record, "state"),
    country: text(record, "country"),
    addr1: text(record, "addr1"),
    phone: text(record, "phone"),
  })).filter((l) => l.locId !== "");
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
