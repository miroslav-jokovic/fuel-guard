import { describe, expect, it } from "vitest";
import {
  parseCitation,
  referenceForCitation,
  parseReferenceStore,
  type ReferenceStore,
} from "./referenceText.js";

const STORE: ReferenceStore = {
  version: "2026-07-13",
  provisional: false,
  source: "eCFR Title 49 @ 2026-07-13",
  sections: {
    "172.504": {
      citation: "49 CFR 172.504",
      sectionNumber: "172.504",
      subject: "General placarding requirements.",
      sourceVersion: "2026-07-13",
      paragraphs: [
        { designator: "a", text: "(a) General. …" },
        { designator: "f", text: "(f) Each placard must be readable and durable." },
      ],
    },
  },
};

describe("parseCitation", () => {
  it("splits section + designators", () => {
    expect(parseCitation("49 CFR 172.504(f)(2)")).toEqual({ sectionNumber: "172.504", designators: ["f", "2"] });
    expect(parseCitation("172.504(f)")).toEqual({ sectionNumber: "172.504", designators: ["f"] });
    expect(parseCitation("§ 177.848")).toEqual({ sectionNumber: "177.848", designators: [] });
    expect(parseCitation("not a citation")).toEqual({ sectionNumber: null, designators: [] });
  });
});

describe("referenceForCitation", () => {
  it("resolves a section + its top-level paragraph", () => {
    const r = referenceForCitation(STORE, "49 CFR 172.504(f)");
    expect(r).not.toBeNull();
    expect(r!.section.subject).toBe("General placarding requirements.");
    expect(r!.paragraph!.designator).toBe("f");
  });

  it("returns the section with null paragraph when no designator is cited", () => {
    const r = referenceForCitation(STORE, "49 CFR 172.504");
    expect(r!.paragraph).toBeNull();
  });

  it("returns null for a section not in the store (UI links out to eCFR instead)", () => {
    expect(referenceForCitation(STORE, "49 CFR 173.150(b)")).toBeNull();
  });
});

describe("parseReferenceStore", () => {
  it("validates a store and applies defaults", () => {
    const parsed = parseReferenceStore({ version: "x", sections: {} });
    expect(parsed.provisional).toBe(true); // default
    expect(parsed.sections).toEqual({});
  });
});
