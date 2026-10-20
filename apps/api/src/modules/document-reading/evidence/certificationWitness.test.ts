import { describe, expect, it } from "vitest";
import { emptyShippingDocument, printedHazmatLineSchema } from "@silvicom/shared";
import { certificationShown } from "./certificationWitness.js";
import type { OcrPage } from "./rowWitness.js";
import { shippingEvidence } from "./shippingEvidence.js";
import { auditFieldStates, auditForRead } from "./paperAudit.js";

/**
 * The certification witness (R-M3) over every way a page can lay out §172.204's two statements — wrapped at
 * every word count from 3 to 12 per printed line, in any case — and over every page that lacks one of their
 * words, or prints them too far apart to be one statement. Then the audit: one reader abstaining is settled by
 * the witness; one reader reading "absent" never is.
 */
const A1 = "This is to certify that the above-named materials are properly classified, described, packaged, marked and labeled, and are in proper condition for transportation according to the applicable regulations of the Department of Transportation.";
const A2 = "I hereby declare that the contents of this consignment are fully and accurately described above by the proper shipping name, and are classified, packaged, marked and labelled/placarded, and are in all respects in proper condition for transport according to applicable international and national governmental regulations.";
const BOILERPLATE = "Subject to Section 7 of the conditions, if this shipment is to be delivered to the consignee without recourse on the consignor, the consignor shall sign the following statement: The carrier shall not make delivery of this shipment without payment of freight and all other lawful charges.";

/** A page printing `text` in lines of `perLine` words, one OCR item per line. */
function page(text: string, perLine: number, top = 100): OcrPage {
  const words = text.split(" ");
  const items = [];
  for (let i = 0, row = 0; i < words.length; i += perLine, row++) {
    items.push({ text: words.slice(i, i + perLine).join(" "), box: { x: 50, y: top + row * 30, width: 600, height: 24 } });
  }
  return { page: 1, width: 1536, height: 2048, items };
}
const KEY_WORDS = /^(certify|declare|classified,?|described,?|packaged,?|marked|labell?ed(,|\/placarded,)?)$/i;

describe("certificationShown", () => {
  it("finds either statement however the page wraps it, in any case", () => {
    const missed: string[] = [];
    for (const text of [A1, A2]) for (let n = 3; n <= 12; n++) for (const t of [text, text.toUpperCase(), text.toLowerCase()]) {
      if (!certificationShown([page(t, n)])) missed.push(`${t.slice(0, 20)}… /${n}`);
      if (!certificationShown([{ ...page(t, n), items: [...page(BOILERPLATE, 7, 900).items, ...page(t, n).items] }])) missed.push(`beside boilerplate /${n}`);
    }
    expect(missed).toEqual([]);
  });

  it("never finds a statement that lacks one of its words, or a page that does not print one", () => {
    const found: string[] = [];
    for (const text of [A1, A2]) {
      const words = text.split(" ");
      words.forEach((w, i) => {
        if (!KEY_WORDS.test(w)) return;
        const without = [...words.slice(0, i), "xxxx", ...words.slice(i + 1)].join(" ");
        // A1's "certify" and A2's "declare" are each the other set's only difference: dropping one leaves the
        // other set short of it too.
        for (let n = 3; n <= 12; n++) if (certificationShown([page(without, n)])) found.push(`no "${w}" /${n}`);
      });
    }
    expect(certificationShown([page(BOILERPLATE, 7)])).toBeNull();
    expect(certificationShown([])).toBeNull();
    expect(found).toEqual([]);
  });

  it("never joins the words of a statement spread across the page", () => {
    const spread = A1.split(" ").flatMap((w) => [w, ...Array.from({ length: 12 }, (_, k) => `filler${k}`)]).join(" ");
    expect(certificationShown([page(spread, 8)])).toBeNull();
  });
});

describe("the audit takes the witness only beside an abstaining reader", () => {
  const doc = (cert: boolean | null) => {
    const d = emptyShippingDocument();
    d.hazmat.lines = [printedHazmatLineSchema.parse({ idText: "UN1830", psn: "Sulfuric acid", hazardClass: "8", pg: "II", packageCount: 2, packaging: "2 TOTES", grossWeightLb: 6750 })];
    d.hazmat.emergencyPhone = "8004249300";
    d.hazmat.shipperCertification = cert;
    return d;
  };
  const ocr = [page(A1, 8)];
  const cert = (a: boolean | null, b: boolean | null, pages: OcrPage[] | null) => {
    const ev = shippingEvidence(doc(a), doc(b), "10", pages);
    return { state: auditFieldStates(ev)["hazmat.shipperCertification"], rule: auditForRead(doc(a), ev)?.results.find((r) => r.ruleId === "paper_certification") };
  };

  it("passes the certification when one reader read it and the other abstained, either way round", () => {
    for (const [a, b] of [[true, null], [null, true]] as const) {
      expect(cert(a, b, ocr)).toMatchObject({ state: "read", rule: { outcome: "pass", reason: "present" } });
    }
  });

  it("never settles a reader reading it absent, nor one reader alone without the page's words", () => {
    for (const [a, b] of [[true, false], [false, true], [false, null], [null, false], [null, null]] as const) {
      expect(cert(a, b, ocr).rule?.outcome, `${a}/${b}`).not.toBe("pass");
    }
    expect(cert(true, null, null).rule).toMatchObject({ outcome: "cannot_tell", reason: "field_unconfirmed" });
    expect(cert(true, null, [page(BOILERPLATE, 7)]).rule).toMatchObject({ outcome: "cannot_tell", reason: "field_unconfirmed" });
  });

  it("leaves two readers who agree as they were, with or without the page's words", () => {
    expect(cert(true, true, null).rule).toMatchObject({ outcome: "pass" });
    expect(cert(true, true, [page(BOILERPLATE, 7)]).rule).toMatchObject({ outcome: "pass" });
    expect(cert(true, true, ocr).rule).toMatchObject({ outcome: "pass" });
  });
});
