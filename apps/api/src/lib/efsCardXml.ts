import { createHash } from "node:crypto";
import { type WsCard, wsCardSchema } from "@fuelguard/shared";
import { EfsSoapError, parseSoap } from "./efsSoapSession.js";
import { childElements, collectElements, localName, type XmlElement } from "./efsXml.js";

/**
 * The EFS card document: parse, edit, serialize, and refuse to send a lossy echo.
 *
 * ── The rule this whole file exists to obey (guide p134, p137, verbatim) ─────────────────────────
 *
 *   "Make sure you echo back all fields from the getCard response, changing the applicable fields.
 *    Only remove fields or blank them out if you intend to remove them. This method does not assume
 *    that only changed values are being changed and other values remain the same. For example, if the
 *    system gets an <infos> record for Driver ID in the getCard response, if the system drops that
 *    <infos> record in the setCard, the card will no longer have a Driver ID assigned."
 *
 * setCardV2 is a full-document write. Anything you omit, you delete. EFS will cheerfully accept a
 * well-formed request that removes a driver assignment.
 *
 * ── Why the echo is built from the DOM and not from a typed model ────────────────────────────────
 *
 * The obvious design is: parse into a typed object, mutate it, serialize it back. It is wrong here,
 * for one reason that outweighs all the others — a typed serializer can only emit fields it knows
 * about, and WEX ships schema changes without notice. The first undocumented field they add is
 * silently deleted from every card we touch, and nothing in our tests would say so.
 *
 * Secondary reasons, each of which would need its own special case in a typed serializer and none of
 * which needs any code at all here:
 *   • `elementToValue` collapses one repeated element into a scalar (see efsXml.ts) — an off-by-one
 *     that deletes a prompt.
 *   • `<originalStatus xsi:nil="true"/>` must go back with the attribute, not as an empty element.
 *   • `override` and `locationOverride` are typed boolean(1) but carry a use-count and a location id.
 *   • Element order is preserved for free.
 *
 * So: `card` is a lossy VIEW for rendering, validating and versioning. `root` is the source of truth
 * for the echo. Every untouched element goes back byte-identical because it is the same node.
 *
 * ── The guard ────────────────────────────────────────────────────────────────────────────────────
 *
 * `assertEchoFidelity` runs in PRODUCTION on every write, costs microseconds, and throws rather than
 * sending anything it cannot account for. It is what turns "we were careful" into "this cannot
 * happen".
 */

// ─── Field vocabulary ──────────────────────────────────────────────────────────────────────────

/** Repeated sub-objects. Each is zero-to-many and each is semantically load-bearing. */
export const CARD_COLLECTIONS = ["infos", "limits", "locationGroups", "locations", "timeRestrictions"] as const;
export type CardCollection = (typeof CARD_COLLECTIONS)[number];
export const COLLECTION_SET: ReadonlySet<string> = new Set(CARD_COLLECTIONS);

/**
 * Header fields we look for when locating the card element inside a response envelope.
 *
 * We do NOT hard-code a wrapper name. The guide documents the operation's OUTPUT fields but not the
 * element that holds them, and the two plausible shapes (`<return>…` and `<result><value>…`) both
 * appear elsewhere in this WSDL. Recognising the card by its own contents works for either, and for
 * whatever third shape the QA probe turns up.
 */
const CARD_MARKERS = ["status", "policyNumber", "handEnter", "infoSource", "limitSource", "payrollStatus"];

/**
 * Excluded from the version hash. These change on their own — `lastUsedDate` on every fill — and
 * including them would 409 a dispatcher who opened the drawer while the truck was fuelling.
 */
const VOLATILE_FIELDS: ReadonlySet<string> = new Set(["lastUsedDate", "lastTransaction", "beingOverridden"]);

export const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
/**
 * Canonical leaf encoding. Real values are prefixed `v`, an xsi:nil leaf is the bare `n`, and a
 * container is the bare `c`. The prefixes exist so no real value can ever collide with a sentinel:
 * a field whose literal text is "n" encodes as "vn", not as nil.
 */
export const NIL = "n";
export const CONTAINER = "c";
export const encodeLeaf = (text: string): string => `v${text}`;

// ─── Parsing ───────────────────────────────────────────────────────────────────────────────────

export interface CardDocument {
  /** The card element from the response. THE source of truth for any echo. */
  root: XmlElement;
  /** Lossy typed view — for the UI, validation and versioning. NEVER serialized back. */
  card: WsCard;
  /** Optimistic-concurrency token over the mutable configuration. */
  version: string;
  /** The response body with card numbers redacted. Safe to persist and log; never used to build a write. */
  redactedXml: string;
}

/**
 * Accepts BOTH spellings of the nil attribute. The guide's own getCardv2 example writes
 * `<originalStatus xsi:nil="1" .../>` (p38) while the XML Schema canonical form is `"true"` — and the
 * two must be treated identically, because a nil read as a real value comes back as the literal
 * string "1", and a nil echoed as an empty element is a DIFFERENT document from the one we received.
 */
export function isNil(element: XmlElement): boolean {
  const attr = element.getAttribute("xsi:nil") ?? element.getAttribute("nil");
  return attr === "true" || attr === "1";
}

function leafText(element: XmlElement): string | null {
  if (isNil(element)) return null;
  const text = (element.textContent ?? "").trim();
  return text === "" ? null : text;
}

function firstText(parent: XmlElement, name: string): string | null {
  const found = collectElements(parent, name)[0];
  return found ? leafText(found) : null;
}

function numberOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** EFS writes booleans as `true`/`false`, `True`/`False`, and occasionally `1`/`0`. Accept all. */
function boolOrNull(value: string | null): boolean | null {
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "y" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "n" || v === "no") return false;
  return null;
}

/** Locate the card element by its contents rather than by a guessed wrapper name. */
function findCardRoot(root: XmlElement): XmlElement | null {
  const looksLikeCard = (el: XmlElement): boolean => {
    const names = new Set(childElements(el).map(localName));
    // Two markers, not one: a `<status>` on its own could belong to almost anything in this WSDL.
    return CARD_MARKERS.filter((m) => names.has(m)).length >= 2;
  };
  const queue: XmlElement[] = [root];
  while (queue.length > 0) {
    const el = queue.shift()!;
    if (looksLikeCard(el)) return el; // breadth-first → the SHALLOWEST match, i.e. the outermost card
    queue.push(...childElements(el));
  }
  return null;
}

function parseInfos(root: XmlElement): WsCard["infos"] {
  return collectElements(root, "infos").map((el) => ({
    infoId: firstText(el, "infoId") ?? "",
    validationType: (firstText(el, "validationType") as WsCard["infos"][number]["validationType"]) ?? null,
    matchValue: firstText(el, "matchValue"),
    reportValue: firstText(el, "reportValue"),
    lengthCheck: boolOrNull(firstText(el, "lengthCheck")),
    minimum: numberOrNull(firstText(el, "minimum") ?? firstText(el, "Minimum")),
    maximum: numberOrNull(firstText(el, "maximum")),
    value: firstText(el, "value"),
  }));
}

function parseLimits(root: XmlElement): WsCard["limits"] {
  return collectElements(root, "limits").map((el) => ({
    limitId: firstText(el, "limitId") ?? "",
    limit: numberOrNull(firstText(el, "limit")) ?? 0,
    hours: numberOrNull(firstText(el, "hours")),
    minHours: numberOrNull(firstText(el, "minHours")),
    autoRollMap: numberOrNull(firstText(el, "autoRollMap")),
    autoRollMax: numberOrNull(firstText(el, "autoRollMax")),
  }));
}

/**
 * Render the value at a zod issue path so a validation failure can quote it.
 *
 * Redacted and short: the path can land on a field that carries operational data, and this string
 * ends up in an API error, a job row and a Sentry event.
 */
export function describeAtPath(raw: unknown, path: readonly PropertyKey[]): string {
  // `readonly PropertyKey[]` because that is what zod 4 types `issue.path` as. A symbol segment
  // cannot occur in a document parsed from XML, but the signature accepts it so the call site
  // compiles without a cast — and indexing with a PropertyKey is well-defined either way.
  let node: unknown = raw;
  for (const key of path) {
    if (node === null || typeof node !== "object") return "not present";
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  if (node === null) return "null";
  if (node === undefined) return "absent";
  const text = typeof node === "object" ? JSON.stringify(node) : String(node);
  return JSON.stringify(redactCardXml(text).slice(0, 80));
}

/**
 * Parse a getCard/getCardv2 response.
 *
 * Throws `EfsSoapError` on a fault (via parseSoap), on unparseable XML, or when no card element can
 * be found. That last one is deliberately loud: a silent empty card would look like "this card has no
 * prompts and no limits", which is exactly the document that DELETES them if it were ever echoed.
 */
export function parseCardDocument(xml: string): CardDocument {
  const envelope = parseSoap(xml); // throws on SOAP Fault
  const root = findCardRoot(envelope);
  if (!root) {
    throw new EfsSoapError(
      "EFS returned a card response we could not read — no card element found",
      "malformed_response",
    );
  }
  const raw = {
    status: firstText(root, "status"),
    originalStatus: firstText(root, "originalStatus"),
    payrollStatus: firstText(root, "payrollStatus"),
    payrollUse: firstText(root, "payrollUse"),
    policyNumber: numberOrNull(firstText(root, "policyNumber")),
    companyXRef: firstText(root, "companyXRef"),
    handEnter: firstText(root, "handEnter"),
    infoSource: firstText(root, "infoSource"),
    limitSource: firstText(root, "limitSource"),
    locationSource: firstText(root, "locationSource"),
    timeSource: firstText(root, "timeSource"),
    // `override` is documented boolean(1); p194 sets it to a 1–9 use count. Read the number.
    overrideUses: numberOrNull(firstText(root, "override")),
    // `locationOverride` is documented boolean(1); p194 sets it to a 6-digit location id. A bare
    // "0"/"1" means "no single-location override", so it is not an id and must not be shown as one.
    locationOverrideId: (() => {
      const value = firstText(root, "locationOverride");
      return value === null || value === "0" || value === "1" ? null : value;
    })(),
    overrideAllLocations: boolOrNull(firstText(root, "overrideAllLocations")),
    lastUsedDate: firstText(root, "lastUsedDate"),
    lastTransaction: firstText(root, "lastTransaction"),
    infos: parseInfos(root),
    limits: parseLimits(root),
    locationGroups: collectElements(root, "locationGroups").map((el) => leafText(el) ?? "").filter(Boolean),
    locations: collectElements(root, "locations").map((el) => leafText(el) ?? "").filter(Boolean),
    timeRestrictions: collectElements(root, "timeRestrictions").map((el) => ({
      day: numberOrNull(firstText(el, "day")) ?? 0,
      beginTime: firstText(el, "beginTime"),
      endTime: firstText(el, "endTime"),
    })),
  };

  const parsed = wsCardSchema.safeParse(raw);
  if (!parsed.success) {
    // Name the field AND quote what EFS actually sent.
    //
    // The first version of this message named only the path, and production duly reported
    // `status — Invalid option: expected one of "Active"|…`. Which value? Unknown. Diagnosing it cost
    // a second production round trip that a dozen characters here would have avoided. An error about
    // an unexpected value that does not contain the value is not a diagnostic.
    const issue = parsed.error.issues[0];
    throw new EfsSoapError(
      `EFS card document had an unexpected shape: ${issue?.path.join(".")} — ${issue?.message}` +
        ` (EFS sent: ${describeAtPath(raw, issue?.path ?? [])})`,
      "malformed_response",
      { issues: parsed.error.issues.slice(0, 5) },
    );
  }

  return { root, card: parsed.data, version: cardVersion(root), redactedXml: redactCardXml(xml) };
}

// ─── Canonical form ────────────────────────────────────────────────────────────────────────────

/**
 * A document reduced to `path → ordered leaf values`. Whitespace, attribute order and element
 * formatting all normalise away; repeated elements append in document order; `xsi:nil` is a distinct
 * sentinel so a nil field can never compare equal to an empty one.
 *
 * This is the representation both the version hash and the fidelity guard are built on, which is what
 * makes them agree with each other by construction.
 */
export type CanonicalDoc = Map<string, string[]>;

export function canonicalize(root: XmlElement, exclude: ReadonlySet<string> = new Set()): CanonicalDoc {
  const out: CanonicalDoc = new Map();
  const push = (path: string, value: string): void => {
    const existing = out.get(path);
    if (existing) existing.push(value);
    else out.set(path, [value]);
  };
  const walk = (element: XmlElement, prefix: string): void => {
    for (const child of childElements(element)) {
      const name = localName(child);
      if (exclude.has(name)) continue;
      const path = `${prefix}/${name}`;
      const grandchildren = childElements(child);
      if (grandchildren.length === 0) {
        push(path, isNil(child) ? NIL : encodeLeaf((child.textContent ?? "").trim()));
      } else {
        // Mark the container itself so an emptied collection is distinguishable from an absent one.
        push(path, CONTAINER);
        walk(child, path);
      }
    }
  };
  walk(root, "");
  return out;
}

function canonicalString(doc: CanonicalDoc): string {
  return [...doc.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, values]) => `${path}=${values.join("")}`)
    .join("");
}

/**
 * Optimistic-concurrency token. EFS gives us no ETag, no lastModified and no row version, so we make
 * one from the mutable configuration itself. Volatile fields are excluded (see VOLATILE_FIELDS): a
 * fill in progress must not invalidate a screen an operator is reading.
 */
export function cardVersion(root: XmlElement): string {
  return createHash("sha256").update(canonicalString(canonicalize(root, VOLATILE_FIELDS))).digest("hex");
}

// ─── Redaction ─────────────────────────────────────────────────────────────────────────────────

/**
 * Strip card numbers before anything is logged, persisted or shipped to Sentry.
 *
 * Two passes on purpose. The element pass catches `<cardNumber>` and `<cardNum>` wherever they appear;
 * the digit-run pass catches every other place a PAN turns up — a fault message quoting the number
 * back at us, an `<external_ref>`, a field WEX adds next year. A `getCardSummariesV2` response carries
 * the whole fleet's PANs in one body, so the general pass is not belt-and-braces, it is the one that
 * does most of the work.
 *
 * ── The exception, and why it is narrow ──────────────────────────────────────────────────────────
 * EFS puts a SUPPORT REFERENCE NUMBER in its fault strings — `Not Allowed 109491436176`,
 * `ERROR running command 109491258416`. Those are 12 digits, so the general pass ate them, and the
 * diagnostic dutifully reported `Not Allowed ••••3445` — masking the single value WEX support asks
 * for, in the one message whose entire purpose is to carry it. Two full rounds of diagnostics went
 * back to the vendor without it.
 *
 * TWO conditions must hold before a digit run is spared, and they are deliberately redundant:
 *
 *   1. It directly follows one of EFS's own fault prefixes. Those introduce a support reference, and
 *      a refusal of `getCardSummariesV2` is not about any one card in the first place.
 *   2. It is at most 14 digits. Every EFS card number we have seen is 17–19 (`7083…`), so a run this
 *      short cannot be a PAN.
 *
 * Either alone would be an argument. Requiring both means the PAN rule is not resting on a guess
 * about the vendor's message formats — if WEX ever does quote a card number after "Not Allowed", the
 * length bound still masks it. There is a test for exactly that.
 */
const EFS_FAULT_REFERENCE = /\b(Not\s*Allowed|ERROR running command|Invalid policy number for)\s+(\d{6,14})\b/gi;

export function redactCardXml(xml: string): string {
  // Park the references, redact everything, then put them back. Simpler and safer than trying to
  // write one regex that redacts digit runs EXCEPT after certain phrases.
  const references: string[] = [];
  const parked = xml.replace(EFS_FAULT_REFERENCE, (_m, prefix: string, ref: string) => {
    references.push(ref);
    return `${prefix} @@EFSREF${references.length - 1}@@`;
  });

  const redacted = parked
    .replace(/(<(?:cardNumber|cardNum|CardNumber)>)([^<]*)(<\/)/gi, (_m, open, value: string, close) =>
      `${open}${maskDigits(value)}${close}`)
    .replace(/\b\d{12,25}\b/g, (digits) => maskDigits(digits));

  return redacted.replace(/@@EFSREF(\d+)@@/g, (_m, i: string) => references[Number(i)] ?? "");
}

function maskDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `••••${digits.slice(-4)}` : "••••";
}

// Display masking lives in @fuelguard/shared so the API and both front ends share one rule.
export { maskPan } from "@fuelguard/shared";
