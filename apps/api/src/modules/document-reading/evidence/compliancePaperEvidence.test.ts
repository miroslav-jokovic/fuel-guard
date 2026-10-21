import { describe, expect, it } from "vitest";
import { compliancePaperBatchSchema, type FieldEvidence } from "@silvicom/shared";
import { compliancePaperEvidence } from "./compliancePaperEvidence.js";
import type { OcrPage } from "./rowWitness.js";

/**
 * A pile of papers' evidence (UNIT-FILES-PLAN UF7b2): one reader, so a null is `not_read`; the OCR witness on
 * the identifiers the matcher files a paper by and on the expiry; a list of VINs backed only when the page
 * prints every one of them.
 */
const batch = () =>
  compliancePaperBatchSchema.parse({
    papers: [{ pageFrom: 1, pageTo: 1, kind: "irp", vins: ["1FUJHHDR0RLVW9438", "1FUJHHDR0RLVW9439"], plates: [{ number: "P 123 456", state: "IL" }], expiresOn: "02/28/2027" }],
  });
const at = (ev: FieldEvidence[], path: string) => ev.find((e) => e.path === path)!;
const ocrOf = (...texts: string[]): OcrPage[] => [
  { page: 1, width: 1000, height: 1000, items: texts.map((text) => ({ text, box: { x: 0, y: 0, width: 10, height: 10 } })) },
];

describe("compliancePaperEvidence", () => {
  it("is one reader's: a field it left empty is not read, a field it read waits for the person", () => {
    const ev = compliancePaperEvidence(batch(), null, "rule-1");
    expect(at(ev, "papers[0].issuedOn").status).toBe("not_read");
    expect(at(ev, "papers[0].unitNumbers").status).toBe("not_read");
    expect(at(ev, "papers[0].expiresOn").status).toBe("check");
    expect(ev.flatMap((e) => e.sources.map((s) => s.reader))).not.toContain("passB");
  });

  it("backs the expiry and the plate wherever the page prints them, however punctuated", () => {
    const ev = compliancePaperEvidence(batch(), null, "rule-1", ocrOf("EXPIRES 02-28-2027", "PLATE P123456"));
    expect(at(ev, "papers[0].expiresOn").sources.find((s) => s.reader === "ocr")?.value).toEqual(["passA"]);
    expect(at(ev, "papers[0].plates[0].number").sources.find((s) => s.reader === "ocr")?.value).toEqual(["passA"]);
  });

  it("⚠ backs a list of VINs only when the page prints every one — one VIN the page lacks is not confirmed", () => {
    const both = compliancePaperEvidence(batch(), null, "rule-1", ocrOf("1FUJHHDR0RLVW9438", "1FUJHHDR0RLVW9439"));
    expect(at(both, "papers[0].vins").sources.find((s) => s.reader === "ocr")?.value).toEqual(["passA"]);
    const one = compliancePaperEvidence(batch(), null, "rule-1", ocrOf("1FUJHHDR0RLVW9438"));
    expect(at(one, "papers[0].vins").sources.find((s) => s.reader === "ocr")?.value).toEqual([]);
  });

  it("never asks the witness about a field nobody decides on", () => {
    const ev = compliancePaperEvidence(compliancePaperBatchSchema.parse({ papers: [{ title: "CAB CARD" }] }), null, "rule-1", ocrOf("CAB CARD"));
    expect(at(ev, "papers[0].title").sources.map((s) => s.reader)).toEqual(["passA"]);
  });
});
