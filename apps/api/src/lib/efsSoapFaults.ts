import {
  childElements,
  elementToValue,
  findDescendant,
  localName,
  parseXml,
  textValue,
  type XmlElement,
} from "./efsXml.js";

// ─── Errors ────────────────────────────────────────────────────────────────────────────────────

/** Small structured error so callers can distinguish transport failures from SOAP faults from
 *  data problems. */
export class EfsSoapError extends Error {
  constructor(
    message: string,
    public code:
      | "not_implemented"
      | "transport"
      | "soap_fault"
      | "auth"
      | "malformed_response"
      | "rate_limited"
      | "tls"
      // The endpoint URL itself was refused before any socket was opened (lib/ssrfGuard.ts).
      | "blocked_endpoint"
      // `InvalidClientId` — the session token expired (daily, ~03:00 CT). Re-login ONCE, then retry.
      | "session_expired"
      // `AccountLockedException` — the shared service account is locked out. Opens the breaker.
      | "account_locked"
      // `NotAllowed` — EFS refused the OPERATION, not the credential. Distinct from `auth` because the
      // remedy is different: an allowlist entry or an entitlement from WEX, not a new password.
      | "not_allowed"
      // A write was well-formed but the vendor refused it ("a decline error with text", p136).
      | "declined"
      // OUR OWN guard refused to send a lossy full-document echo. Never a vendor condition — this is
      // a bug in the serializer and must be visible as one. See lib/efsCardXml.ts.
      | "echo_unfaithful",
    public detail?: unknown,
  ) {
    super(message);
    this.name = "EfsSoapError";
  }
}

/**
 * Documented fault names (guide p9, p118), checked BEFORE the substring heuristics below. Those
 * heuristics were written when `auth` was the only outcome that mattered; a named exception is exact,
 * and misreading `InvalidClientId` means we either never refresh a session or hammer the account with
 * logins that cannot help.
 */
const FAULT_CODES: ReadonlyArray<[RegExp, EfsSoapError["code"], string?]> = [
  [/AccountLockedException/i, "account_locked", "The EFS account is locked after too many failed logins. It has to be unlocked by WEX."],
  [/InvalidLoginException/i, "auth", "EFS rejected the password for this service account."],
  [/InvalidAccountException/i, "auth", "EFS does not recognise this service account username."],
  [/InvalidClientId/i, "session_expired"],
  [/flying\s*j/i, "soap_fault", "EFS returned a Flying J operation response."],
  // The guide names this fault "NotAllowed" (p9); the service actually emits "Not Allowed 109491436176"
  // — a space, and a reference number that changes per request. Matching only the documented spelling
  // meant a real access refusal fell through to the generic heuristic and was reported as an untyped
  // soap_fault with no explanation. Match both spellings; the raw faultstring (with the reference WEX
  // support will ask for) is preserved in `detail`.
  // The guide defines this exactly, and more narrowly than we had been saying: "NotAllowed: Access
  // blocked by firewall. Contact your account manager." (p9). Not an entitlement gap, and not a
  // request we built wrong. Say what the vendor says — every hour spent re-reading our own request
  // bodies after one of these is an hour the guide already told us not to spend.
  [/Not\s*Allowed/i, "not_allowed", "EFS blocked this request at their firewall. The integration guide (p9) defines NotAllowed as \"Access blocked by firewall — contact your account manager\", so it is not a credential problem and not a malformed request. Quote the reference number to WEX."],
  // The vendor's OWN code for "you built the request wrong": "InvalidParameterNameID: Incorrect
  // parameter value. Correct and retry." (p9). Deliberately distinct from not_allowed — EFS separates
  // our fault from their firewall, so our error surface does too.
  [/InvalidParameterNameID/i, "soap_fault", "EFS rejected a parameter value in our request. Per the guide (p9) this one is ours to correct — it is not an access problem."],
];

/** Classify a `<Fault>`. The named-exception table wins; the substring heuristics are the fallback for
 * faults the guide does not name. `faultcode` and `detail` are read too — `InvalidClientId` does not
 * always land in `faultstring`. */
function faultError(fault: XmlElement): EfsSoapError {
  const message = textValue(elementToValue(findDescendant(fault, "faultstring") ?? fault)) ?? "EFS SOAP fault";
  const haystack = [
    message,
    textValue(elementToValue(findDescendant(fault, "faultcode") ?? fault)) ?? "",
    findDescendant(fault, "detail")?.textContent ?? "",
  ].join(" ");
  for (const [pattern, code, friendly] of FAULT_CODES) {
    if (!pattern.test(haystack)) continue;
    // KEEP THE VENDOR'S OWN WORDS IN THE MESSAGE, not just in `detail`.
    //
    // EFS formats these faults as "<name> <reference>" — "Not Allowed 109491436176" — and the
    // reference is the first thing WEX support asks for. An earlier version of this replaced the
    // faultstring with the friendly text, which read better and threw away the only part of the
    // string anybody outside this codebase can act on. The job ledger stores `message`, so anything
    // not in `message` is effectively lost to whoever is reading the failure.
    return new EfsSoapError(
      friendly ? `${friendly} (EFS said: "${message}")` : message,
      code,
      { faultstring: message },
    );
  }
  const lower = message.toLowerCase();
  const code = /rate|limit|429/.test(lower)
    ? "rate_limited"
    : /auth|login|password|user|credential|clientid/.test(lower)
      ? "auth"
      : "soap_fault";
  return new EfsSoapError(message, code);
}

/** Parse an envelope and throw on a SOAP Fault. Returns the document element on success. */
export function parseSoap(xml: string): XmlElement {
  const root = parseXml(xml);
  if (!root) throw new EfsSoapError("EFS returned malformed XML", "malformed_response");
  const fault = findDescendant(root, "Fault");
  if (fault) throw faultError(fault);
  return root;
}

export function responseValues(xml: string): Record<string, unknown>[] {
  const root = parseSoap(xml);
  const result = findDescendant(root, "result");
  if (!result) return [];
  return childElements(result)
    .filter((child) => localName(child) === "value")
    .map((child) => elementToValue(child))
    .flatMap((value) =>
      Array.isArray(value)
        ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
        : value && typeof value === "object" ? [value as Record<string, unknown>] : [],
    );
}

export function responseResult(xml: string): string {
  const root = parseSoap(xml);
  const result = findDescendant(root, "result");
  const value = result ? textValue(elementToValue(result)) : null;
  if (!value) throw new EfsSoapError("EFS login response did not contain a clientId", "auth");
  return value;
}
