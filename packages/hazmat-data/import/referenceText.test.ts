import { describe, expect, it } from "vitest";
import { extractSectionText } from "./referenceText.js";

// Same section, two DIALECTS: the eCFR "full" XML (DIV8/HEAD/P) and the GovInfo content XML
// (SECTION/SECTNO/SUBJECT/P). The tolerant extractor must yield the same reference text from both.
const ECFR_STYLE = `
<DIV8 N="172.504" TYPE="SECTION">
  <HEAD>§ 172.504 General placarding requirements.</HEAD>
  <P>(a) General. Each person who offers for transportation or transports any hazardous material shall placard the transport vehicle.</P>
  <P>(f) Each placard must be readable &amp; durable.</P>
</DIV8>`;

const GOVINFO_STYLE = `
<SECTION>
  <SECTNO>§ 172.504</SECTNO>
  <SUBJECT>General placarding requirements.</SUBJECT>
  <P>(a) General. Each person who offers for transportation or transports any hazardous material shall placard the transport vehicle.</P>
  <P>(f) Each placard must be readable &amp; durable.</P>
</SECTION>`;

describe("extractSectionText — tolerant across XML dialects", () => {
  it("extracts the same reference text from eCFR-style and GovInfo-style XML", () => {
    const a = extractSectionText(ECFR_STYLE, { sectionNumber: "172.504", sourceVersion: "2026-07-13" });
    const b = extractSectionText(GOVINFO_STYLE, { sectionNumber: "172.504", sourceVersion: "2026-07-13" });

    for (const ref of [a, b]) {
      expect(ref.citation).toBe("49 CFR 172.504");
      expect(ref.sectionNumber).toBe("172.504");
      expect(ref.subject).toBe("General placarding requirements.");
      expect(ref.paragraphs).toHaveLength(2);
      expect(ref.paragraphs[0]!.designator).toBe("a");
      expect(ref.paragraphs[1]!.designator).toBe("f");
      expect(ref.paragraphs[1]!.text).toContain("readable & durable"); // entity decoded, tags stripped
    }
    expect(a.paragraphs).toEqual(b.paragraphs);
  });

  it("strips the § number prefix from a HEAD to get the subject", () => {
    const ref = extractSectionText(`<DIV8 N="177.848" TYPE="SECTION"><HEAD>§ 177.848 Segregation of hazardous materials.</HEAD><P>(a) text</P></DIV8>`, { sectionNumber: "177.848" });
    expect(ref.subject).toBe("Segregation of hazardous materials.");
  });

  it("keeps lead-in text with a null designator and decodes numeric entities", () => {
    const ref = extractSectionText(`<SECTION><SUBJECT>Marking.</SUBJECT><P>Lead-in sentence at 20&#176;C.</P><P>(1) first item</P></SECTION>`, { sectionNumber: "172.301" });
    expect(ref.paragraphs[0]).toEqual({ designator: null, text: "Lead-in sentence at 20°C." });
    expect(ref.paragraphs[1]!.designator).toBe("1");
  });

  it("returns empty paragraphs (not a throw) for a section with no <P>", () => {
    const ref = extractSectionText(`<DIV8 N="172.500" TYPE="SECTION"><HEAD>§ 172.500 Applicability.</HEAD></DIV8>`, { sectionNumber: "172.500" });
    expect(ref.paragraphs).toEqual([]);
    expect(ref.subject).toBe("Applicability.");
  });
});
