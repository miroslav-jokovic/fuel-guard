import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODELLED_CARD_FIELDS, unmodelledCardFields } from "./efsCardFields.js";
import { parseCardDocument } from "./efsCardXml.js";

/**
 * Step 7.3 — "model every field production sends", and the honest limits of doing that offline.
 *
 * ── What this file CAN prove ────────────────────────────────────────────────────────────────────
 * That every field the vendor DECLARES is modelled. The WSDL is checked in, so this is a complete,
 * mechanical answer for the declared surface — and it is a stronger answer than the step's own
 * Verify would have produced, because a single recorded production card only carries the fields THAT
 * card happens to have, while this covers all of them.
 *
 * ── What it CANNOT prove, and the step's Verify is the part still owed ──────────────────────────
 * That production sends nothing UNDECLARED. This account has already done exactly that twice — a
 * `status` outside the documented enum, and an `infosrc` value the old check constraint rejected — so
 * it is a live risk, not a theoretical one. `getCardV2.production.xml`, redacted from a real
 * production card, is what closes it, and `unmodelledCardFields()` is the mechanism that will report
 * it when somebody records one.
 */

const WSDL = readFileSync(fileURLToPath(new URL("../../../../../../docs/efs/CardManagementWS.wsdl", import.meta.url)), "utf8");
const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/efs/${name}`, import.meta.url)), "utf8");

/** The vendor's declared field names for one complexType, straight out of the checked-in WSDL. */
function declaredFields(complexType: string): string[] {
  const body = new RegExp(`<complexType name="${complexType}">([\\s\\S]*?)</complexType>`).exec(WSDL)?.[1] ?? "";
  return [...body.matchAll(/<element\b[^>]*?\bname="([^"]+)"/g)].map((m) => m[1]!);
}

/** Every complexType that makes up a `getCardv2` document. */
const CARD_TYPES = ["WSCardv2", "WSCardHeader", "WSCardInfo", "WSCardLimitv2", "WSCardTimeRestriction"];

describe("every field the WSDL declares on a card is modelled", () => {
  for (const type of CARD_TYPES) {
    it(`${type}`, () => {
      const declared = declaredFields(type);
      // Guard the derivation itself: a typo in the type name would produce an empty list and a
      // vacuously green test — the tautology standing rule 6 is about.
      expect(declared.length, `${type} declared no fields — check the WSDL type name`).toBeGreaterThan(0);
      expect(declared.filter((f) => !MODELLED_CARD_FIELDS.has(f))).toEqual([]);
    });
  }

  it("names the five payroll flags and the third prompt value field specifically", () => {
    /**
     * The step names five; the WSDL diff found six. `numericMatchValue` is the one the plan does not
     * mention, and it is the more interesting of the two: `efsCardAttribution.ts` reads a prompt's
     * value from `matchValue` then `reportValue`, and its own docblock called that "the two places a
     * prompt keeps its value". There are three. `UNIT` and `DRID` — the two prompts the attribution
     * columns are built from — are exactly the ones likely to hold a number.
     */
    for (const field of ["payrollAtm", "payrollChk", "payrollAch", "payrollWire", "payrollDebit"]) {
      expect(MODELLED_CARD_FIELDS.has(field), `${field} must be modelled`).toBe(true);
    }
    expect(MODELLED_CARD_FIELDS.has("numericMatchValue")).toBe(true);
  });

  it("pins nothing the WSDL does not declare", () => {
    // The other direction. A field pinned here but declared nowhere is either a typo — which would
    // make the assertions above pass while the parser reads nothing — or a field observed live, and
    // the second case needs a comment saying where it was seen.
    const declared = new Set(CARD_TYPES.flatMap(declaredFields));
    expect([...MODELLED_CARD_FIELDS].filter((f) => !declared.has(f))).toEqual([]);
  });
});

describe("unmodelledCardFields", () => {
  it("reports a field this product has never heard of", () => {
    // The fixture the echo tests already use for exactly this shape: it carries fields nobody has
    // modelled, deliberately, to prove the write path preserves them.
    const doc = parseCardDocument(fixture("getCardV2.unknownField.xml"));
    expect(unmodelledCardFields(doc.root)).toEqual(
      expect.arrayContaining(["futureFlag", "secureFuelZid", "unknownPerRecordField"]),
    );
  });

  it("says nothing about a document made entirely of modelled fields", () => {
    // The positive control. Without it, a function that returned every element name would satisfy
    // the case above perfectly — and would fail every scan on every account forever.
    const doc = parseCardDocument(fixture("getCardV2.full.xml"));
    expect(unmodelledCardFields(doc.root)).toEqual([]);
  });

  it("reports names, never values", () => {
    // This reaches logs and an API response. A value could be anything the vendor put in the field,
    // including something that should not leave the process.
    const doc = parseCardDocument(fixture("getCardV2.unknownField.xml"));
    expect(unmodelledCardFields(doc.root).join(" ")).not.toContain("keep-me");
    expect(unmodelledCardFields(doc.root).join(" ")).not.toContain("Z-99812");
  });

  it("is stable and deduplicated across a fleet-sized corpus", () => {
    // Sorted and unique so two scans of the same account produce the same string — otherwise a diff
    // between two scan outputs is noise and nobody reads the third one.
    const doc = parseCardDocument(fixture("getCardV2.unknownField.xml"));
    const once = unmodelledCardFields(doc.root);
    expect(once).toEqual([...new Set(once)].sort());
  });
});
