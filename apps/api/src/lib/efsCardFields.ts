import { childElements, localName, type XmlElement } from "./efsXml.js";

/**
 * Which card-document fields this product actually MODELS — and what to do about one it does not
 * (execution plan Step 7.3).
 *
 * ── The pin, and the two independent things that check it ───────────────────────────────────────
 * `MODELLED_CARD_FIELDS` is a hand-written list, which standing lesson 4.4 normally forbids. It is
 * the exception that rule names: a PIN that two independent derivations check against, in the same
 * arrangement as `CAPABILITIES_WITH_STEP_UP_GATE`. Neither side owns the list.
 *
 *   1. `efsCardFields.test.ts` → "every field the WSDL declares on a card is modelled" derives the
 *      vendor's DECLARED fields from the checked-in WSDL and asserts every one is pinned here. That
 *      catches a field EFS documents and we ignore. Its mirror image,
 *      `efsCardFields.test.ts` → "pins nothing the WSDL does not declare", catches the typo that
 *      would make the first one vacuously green.
 *   2. `unmodelledCardFields()` derives the fields a REAL document actually carries and reports any
 *      that are not pinned. That catches a field EFS sends without declaring — which this account
 *      has already done twice, with a `status` outside the documented enum and an unrecognised
 *      `infosrc`.
 *
 * Only the second can find what the WSDL does not say, and only the first can find what no card
 * happened to carry. Both are needed and neither is sufficient.
 *
 * ── This is NOT the echo's safety net ───────────────────────────────────────────────────────────
 * A field missing from this list is not lost on write. `serializeSetCardRequest` assembles the
 * request from the ORIGINAL response nodes rather than re-serializing the typed view, precisely so a
 * field nobody has heard of survives a round trip — proven by `getCardV2.unknownField.xml` and by the
 * case that throws when one is dropped. What an unmodelled field costs is READ-side: it cannot be
 * rendered, cannot be filtered on, and cannot be reasoned about by any rule in the product.
 */

/**
 * Every element name the card parser reads, by container.
 *
 * Kept as one flat set rather than per-container maps because the check that matters is "did this
 * document contain something we have never heard of", and the containers are already distinguished
 * by their own element names. Sub-container names (`header`, `infos`, …) are included: they appear
 * as elements in the document too.
 */
export const MODELLED_CARD_FIELDS: ReadonlySet<string> = new Set([
  // WSCardv2 — the document itself
  "cardNumber", "header", "infos", "limits", "locationGroups", "locations", "timeRestrictions",
  // WSCardHeader
  "companyXRef", "handEnter", "infoSource", "limitSource", "locationOverride", "locationSource",
  "overrideAllLocations", "originalStatus", "payrollStatus", "override", "policyNumber", "status",
  "timeSource", "lastUsedDate", "lastTransaction", "payrollUse",
  /**
   * The five payroll capability flags Step 7.3 names. Declared on `WSCardHeader` and never parsed
   * until now, so a card page could not say whether this card may draw cash at an ATM, write a
   * check, or move money by ACH, wire or debit — five separate ways to take money off a fuel card,
   * none of them fuel.
   */
  "payrollAtm", "payrollChk", "payrollAch", "payrollWire", "payrollDebit",
  // WSCardInfo
  "infoId", "lengthCheck", "matchValue", "maximum", "minimum", "reportValue", "validationType",
  "value",
  /**
   * ⚠ The THIRD place a prompt can keep its value, and the plan does not mention it.
   *
   * `efsCardAttribution.ts` says a prompt stores its value "in `matchValue` … and in `reportValue`",
   * and reads exactly those two. The WSDL declares `numericMatchValue` alongside them. That is the
   * same defect that has now bitten twice: the Phase 1 `reportValue` bug, and the 2026-08-14 live QA
   * report where a Unit Number changed in the prompts panel and not in the header above it — both
   * "a reader that knew about one of the places a prompt keeps its value".
   *
   * Read-side only (the echo preserves it either way), but the read side is where attribution lives:
   * `UNIT` and `DRID` are the two prompts most likely to hold a NUMBER.
   */
  "numericMatchValue",
  // WSCardLimitv2
  "hours", "limit", "limitId", "minHours", "autoRollMap", "autoRollMax",
  // WSCardTimeRestriction
  "beginTime", "day", "endTime",
]);

/**
 * SOAP scaffolding and vendor envelope elements that are not card fields.
 *
 * Explicit rather than inferred: an element we cannot classify must count as unmodelled, because the
 * failure this whole mechanism exists to prevent is a real field being waved through.
 */
const NON_FIELD_ELEMENTS: ReadonlySet<string> = new Set([
  "Envelope", "Body", "Header", "Fault", "faultcode", "faultstring", "detail",
  "getCardv2Response", "getCardResponse", "return", "result", "value",
]);

/**
 * Every element in this document that the product does not model.
 *
 * Returns names, never values: the caller logs and renders this, and a value could be anything the
 * vendor put in the field. Deduplicated and sorted so two scans of the same fleet produce the same
 * string and a diff means something.
 */
export function unmodelledCardFields(root: XmlElement | null | undefined): string[] {
  // A DIAGNOSTIC must never be the reason a sweep fails. `parseCardDocument` throws on a document
  // with no card element, so by the time a real caller gets here `root` is always present — but the
  // post-mutation path builds a `CardDocument` from an already-parsed read, and a caller that hands
  // this an incomplete one should get "nothing to report", not an exception thrown from inside the
  // mirror's write. Reported by four attribution tests going red on exactly that shape.
  if (!root) return [];
  const found = new Set<string>();
  const walk = (el: XmlElement): void => {
    for (const child of childElements(el)) {
      const name = localName(child);
      if (!MODELLED_CARD_FIELDS.has(name) && !NON_FIELD_ELEMENTS.has(name)) found.add(name);
      walk(child);
    }
  };
  walk(root);
  return [...found].sort();
}
