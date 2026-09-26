import { describe, it, expect } from "vitest";
import { pdfPageCount, pdfPageTexts, pdfText } from "../../../../testing/pdfText.js";
import { handbookPdf, type HandbookDocumentInput } from "./handbookPdf.js";
import { HANDBOOK_BLOCKS, HANDBOOK_VERSION } from "./handbookText.js";

/**
 * The handbook as drawn (HB2). ⚠ These pin what a text assertion CAN see — values in the right
 * places, the SSN masked, the reading copy blank, one footer per page. The layout itself (the centred
 * mixed-weight ladder, the table, the page breaks) was rasterised and looked at; three defects were
 * found that way and none of them was visible to text (§8 of the plan).
 */
const NAME = "Jovana Petrović-Szczepańska Živković";
const SIGNED_AT = "2026-09-25T19:40:00Z";
const all = (ids: string[]) => new Map(ids.map((id) => [id, { signedName: id === "h4c" ? "Miroslav Jokovic" : "Jovana Petrović", signedAt: SIGNED_AT }]));

const input = (over: Partial<HandbookDocumentInput> = {}): HandbookDocumentInput => ({
  carrier: { name: "Silvicom Inc" },
  driverName: NAME,
  ssnLast4: "1234",
  marks: all(["h1", "h2", "h3", "h4", "h4c", "h5"]),
  driverSignature: null,
  countersign: { fullName: "Miroslav Jokovic", title: "Safety manager", signature: null, appliedBy: "Office User" },
  ...over,
});

describe("the signed handbook", () => {
  it("prints the SSN as •••1234 and never more (D-HB2)", async () => {
    const text = await pdfText(await handbookPdf(input()));
    expect(text).toContain("•••1234");
    expect(text).not.toMatch(/\d{3}-?\d{2}-?1234/);
  });

  it("prints the applicant's name as typed, and each place's date", async () => {
    const text = await pdfText(await handbookPdf(input()));
    expect(text).toContain(NAME);
    expect(text).toContain("09/25/2026");
  });

  it("says who applied the carrier's signature, beside it (D-HB3)", async () => {
    const text = await pdfText(await handbookPdf(input()));
    expect(text).toContain("Miroslav Jokovic, Safety manager. Signature applied from the carrier's file by Office User");
  });

  it("stamps every page with the text version and page x of y", async () => {
    const pdf = await handbookPdf(input());
    const pages = await pdfPageTexts(pdf);
    const n = await pdfPageCount(pdf);
    expect(pages).toHaveLength(n);
    pages.forEach((p, i) => expect(p).toContain(`text ${HANDBOOK_VERSION} · page ${i + 1} of ${n}`));
  });

  it("lays the handbook out on the carrier's eleven sheets — no page added for a footer", async () => {
    // Measured: stamping a footer under the bottom margin used to make pdfkit add a sheet per page.
    expect(await pdfPageCount(await handbookPdf(input()))).toBe(11);
  });
});

describe("the pages", () => {
  /**
   * ⚠ Found by rasterising the blank template, 2026-09-25: block 2 needed 96pt, page 8 had 80, and
   * the block opened page 9 as three bare rules — a signature nobody could tie to what it signs. The
   * paragraph before a signature now travels with it (`keepWithSignature`). Read as text: no page may
   * BEGIN with a signature block's label.
   */
  it("never opens a page with a signature block", async () => {
    // ⚠ A block's first ROW, both labels run together as the text layer reads them — `Silvicom Inc`
    // alone is the countersignature's label AND a line of body text on page 3, so single labels
    // would convict the letterhead. So the carrier's one-field countersignature (`h4c`) is not an
    // opener here; it is drawn straight after the driver's row it countersigns.
    const openers = HANDBOOK_BLOCKS.flatMap((b) =>
      b.k === "sign" && b.fields.length > 1 ? [b.fields.slice(0, 2).map((f) => f.label).join("")] : [],
    );
    const pages = await pdfPageTexts(await handbookPdf(input({ marks: new Map(), countersign: null, driverName: "", ssnLast4: null })));
    expect(pages.some((t) => openers.some((o) => t.includes(o))), "the openers are what the page reads").toBe(true);
    pages.forEach((text, i) => {
      const opener = openers.find((o) => text.trimStart().startsWith(o));
      expect(opener, `page ${i + 1} opens with a signature block`).toBeUndefined();
    });
  });
});

describe("the reading copy", () => {
  it("prints no signature, no date and no countersignature where nothing is signed", async () => {
    const text = await pdfText(await handbookPdf(input({ marks: new Map(), countersign: null, ssnLast4: null })));
    expect(text).not.toContain("Jovana Petrović ");
    expect(text).not.toContain("09/25/2026");
    expect(text).not.toContain("Signature applied from the carrier's file");
    expect(text).not.toContain("•••");
    // The carrier's words are all there — it is the whole handbook, unsigned.
    expect(text).toContain("SAFETY STANDARDS AND POLICIES RECEIPT");
  });

  it("draws exactly the places signed so far", async () => {
    const text = await pdfText(await handbookPdf(input({ marks: all(["h1"]), countersign: null })));
    expect(text.match(/09\/25\/2026/g)).toHaveLength(1);
  });
});
