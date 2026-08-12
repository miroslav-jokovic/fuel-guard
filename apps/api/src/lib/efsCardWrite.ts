import type { Env } from "../env.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { assertEchoFidelity, serializeSetCardRequest, type CardEdit } from "./efsCardEcho.js";
import { type CardDocument, redactCardXml } from "./efsCardXml.js";
import { callCardOp, type CardOpOptions } from "./efsCardOps.js";
import { EfsSoapError, parseSoap } from "./efsSoapSession.js";
import { childElements, collectElements, findDescendant, localName, type XmlElement } from "./efsXml.js";

/**
 * `setCardV2` — the only operation in this codebase that CHANGES a fuel card.
 *
 * Kept out of `efsCardOps.ts` from day one rather than when that file next hits its 500-line budget,
 * because the split is semantic before it is arithmetic: everything in that file is a read, and a
 * read that goes wrong costs a page render. Everything here can delete a fleet's driver assignments.
 * Somebody skimming for "where do we write to EFS" should find one file, and it should be short
 * enough to read in full before they change it.
 *
 * ── The three rules this file exists to enforce ──────────────────────────────────────────────────
 *
 * 1. **The request is ALWAYS the full echo, and fidelity is asserted on the exact bytes sent.**
 *    `setCardV2` is a full-document write (guide p137): a field missing from the request is DELETED.
 *    The body is built from the response DOM by `serializeSetCardRequest` and checked by
 *    `assertEchoFidelity` INSIDE the body callback — so the check runs against the string that
 *    actually goes on the wire, on every attempt, in production. A serializer bug throws
 *    `echo_unfaithful` and nothing is dispatched.
 *
 * 2. **`retry: false`, always, with no option to pass otherwise.** A timed-out write may have landed;
 *    retrying it is a SECOND write, and for an override that is a second free tank of fuel. The
 *    parameter is not exposed by `setCardV2` below — a caller cannot opt in by accident. Reconciliation
 *    is by re-read, in `services/efsCardControl.ts`.
 *
 * 3. **Success is a classification, not an assumption.** "No news is good news" (p9): a successful
 *    call may return an empty body. So an empty 200 is success, and anything that looks like a
 *    decline — a `Result` of -1, or a result element carrying refusal text — is `declined`. SOAP
 *    Faults never reach here; `requestXml` throws them with the documented code already attached.
 *
 * ── One subtlety about session retry ─────────────────────────────────────────────────────────────
 * `withEfsSession` (via `callCardOp`) re-runs the operation once on `InvalidClientId`. That is safe
 * for a write and is not a violation of rule 2: EFS rejects an expired clientId before doing anything
 * with the request, so the first attempt provably did not land. Any other failure propagates.
 */

/**
 * Lowercase `v`, read off the WSDL rather than the guide.
 *
 * The guide writes `setCardV2` throughout (p137) and so did this constant. Axis2 answered
 * "The endpoint reference (EPR) for the Operation not found … WSA Action = setCardV2" — a
 * DISPATCH-phase rejection, so no operation ran and nothing was written. The contract at
 * `…/CardManagementWS?wsdl` declares:
 *
 *     <operation name="setCardv2" parameterOrder="clientId card">
 *
 * The vendor is inconsistent and the guide papers over it: `getCardv2` lowercase, but
 * `getCardSummariesV2` and `getMCTransExtLocV2` uppercase. Only the binding knows, and
 * `docs/22-EFS-CARD-CONTROL.md` now records what it says — check there before adding an operation,
 * rather than trusting a page number.
 */
const OP_SET_CARD_V2 = "setCardv2";

export interface SetCardResult {
  /** The redacted request body, for the ledger. Never the raw one — it carries the PAN. */
  requestXmlRedacted: string;
  /** The redacted response body, for the ledger. */
  responseXmlRedacted: string;
  /** Whatever the vendor put in a `result`/`return` element, when it sent one at all. */
  resultText: string | null;
  /** How the response was read. Recorded on the probe so the classifier can be tightened to reality. */
  shape: "empty" | "result" | "document";
}

/**
 * Send one card document back to EFS with `edits` applied.
 *
 * Throws `EfsSoapError`:
 *   • `echo_unfaithful` — OUR bug. The request did not faithfully echo the card and was NOT sent.
 *   • `declined`        — EFS accepted the request and refused the change.
 *   • anything `requestXml` classifies (`not_allowed`, `auth`, `transport`, `rate_limited`, …).
 */
export async function setCardV2(
  env: Env,
  creds: EfsSoapCredentials,
  doc: CardDocument,
  cardNumber: string,
  edits: readonly CardEdit[],
  opts: Omit<CardOpOptions, "retry"> = {},
): Promise<SetCardResult> {
  let requestXmlRedacted = "";

  const xml = await callCardOp(
    env, creds, OP_SET_CARD_V2,
    (session) => {
      const { xml: body, redactedXml } = serializeSetCardRequest(
        doc, { clientId: session.clientId, cardNumber }, edits,
      );
      // On the exact bytes about to be sent, every time. A guard that runs on a different string than
      // the one dispatched is not a guard.
      assertEchoFidelity(doc, body, edits);
      requestXmlRedacted = redactedXml;
      return body;
    },
    {
      ...opts,
      priority: opts.priority ?? "interactive",
      // Not overridable. See rule 2 in the file docblock.
      retry: false,
    },
  );

  const { resultText, shape } = classifySetCardResponse(xml);
  const responseXmlRedacted = redactCardXml(xml);

  if (isDecline(resultText)) {
    throw new EfsSoapError(
      `EFS refused the card change: ${resultText}`,
      "declined",
      { result: resultText, response: responseXmlRedacted.slice(0, 400) },
    );
  }

  return { requestXmlRedacted, responseXmlRedacted, resultText, shape };
}

/**
 * Read whatever `setCardV2` sent back.
 *
 * The guide is explicit that this is loosely specified — "a successful response or a decline error
 * with text" (p136), and generally "no news is good news" (p9). It does not give the element name of
 * a success, so this looks for a `result`/`return` and reports what shape it found. The probe records
 * `shape` and the observed text, which is how the classifier gets tightened against reality rather
 * than against a reading of the PDF.
 */
export function classifySetCardResponse(xml: string): { resultText: string | null; shape: SetCardResult["shape"] } {
  // Throws on a Fault. Faults normally surface earlier, in requestXml; this is the belt to that
  // braces, and it means a caller using this helper directly cannot miss one.
  const root = parseSoap(xml);
  const result = findDescendant(root, "result") ?? findDescendant(root, "return");
  if (!result) {
    // A body with no result element at all. Under "no news is good news" that is the success shape we
    // expect from a vendor that acknowledges a write by saying nothing.
    return { resultText: null, shape: "empty" };
  }
  if (childElements(result).length > 0) {
    // A structured payload rather than a scalar — some deployments echo the stored card back. Not a
    // decline; a decline is documented as TEXT. Look for a nested scalar anyway so a wrapped
    // "-1" cannot hide inside it.
    return { resultText: firstScalar(result), shape: "document" };
  }
  const text = (result.textContent ?? "").trim();
  return { resultText: text === "" ? null : text, shape: "result" };
}

/** The deepest single scalar under a container, so a wrapped result code is still read. */
function firstScalar(element: XmlElement): string | null {
  for (const child of childElements(element)) {
    if (childElements(child).length === 0) {
      const text = (child.textContent ?? "").trim();
      // `value` and `Result` are the two names this WSDL uses for a scalar payload; anything else at
      // this depth is a field of an echoed card and must not be read as a status code.
      if (text !== "" && /^(value|result)$/i.test(localName(child))) return text;
      continue;
    }
    const nested = firstScalar(child);
    if (nested !== null) return nested;
  }
  return null;
}

/**
 * Whether a result value means the change was refused.
 *
 * `-1` is the documented failure value for the sibling `setCardPin` (p9) and is the only numeric code
 * the guide gives for this family. Everything else here is textual refusal wording: EFS returns
 * "a decline error with text", and a vendor that answers a write with the word "declined" has not
 * applied it. Deliberately does NOT treat an unrecognised non-empty string as a decline — that would
 * turn a future informational response into a false failure, and the reconciling re-read in
 * `efsCardControl.ts` is what actually establishes whether the change landed.
 */
export function isDecline(resultText: string | null): boolean {
  if (resultText === null) return false;
  const text = resultText.trim();
  if (text === "-1") return true;
  return /\b(declin\w*|denied|refus\w*|not\s*allowed|failed|error|invalid)\b/i.test(text);
}

/**
 * Whether a fresh card document proves an edit list landed — WITHOUT the before-document.
 *
 * The background reconciler's question (services/efsCardUnresolved.ts): a `sent` ledger row stores
 * its edits and nothing that can rebuild a CardDocument, so `intentLanded`'s canonical diff is out
 * of reach and this direct field comparison is the honest alternative. Compares only the fields the
 * edits named — everything else moving is DRIFT, a different finding with a different remedy.
 *
 * Values compare CASE-INSENSITIVELY, the same tolerance `vendorNormalisedOnly` grants the live
 * path: this account demonstrably stores `HOLD` for a sent `Hold`, and an exact compare here would
 * re-create the false-failure the tolerance exists to prevent — in the one code path whose whole
 * job is un-sticking rows.
 */
export function editsLanded(after: CardDocument, edits: readonly CardEdit[]): boolean {
  const sameText = (a: string | null, b: string): boolean =>
    a !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
  for (const edit of edits) {
    switch (edit.op) {
      case "setField": {
        if (!sameText(fieldText(after.header, edit.name), edit.value)) return false;
        break;
      }
      case "setFieldNil": {
        if (fieldText(after.header, edit.name) !== null) return false;
        break;
      }
      case "removeAll": {
        if (collectElements(after.root, edit.name).length > 0) return false;
        break;
      }
      case "replaceAll": {
        if (collectElements(after.root, edit.name).length !== edit.records.length) return false;
        break;
      }
      case "appendRecord": {
        // Cannot be asserted by count alone without knowing the prior count, and the caller has the
        // before-document for that. Phase 1 uses no appendRecord edits; when Phase C does, this is the
        // branch to make exact rather than the one to trust.
        break;
      }
    }
  }
  return true;
}

function fieldText(root: XmlElement, name: string): string | null {
  const found = collectElements(root, name)[0];
  if (!found) return null;
  const nil = found.getAttribute("xsi:nil") ?? found.getAttribute("nil");
  if (nil === "true" || nil === "1") return null;
  const text = (found.textContent ?? "").trim();
  return text === "" ? null : text;
}
