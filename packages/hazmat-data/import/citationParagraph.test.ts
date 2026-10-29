import { describe, expect, it } from "vitest";
import { paragraphAt } from "./citationParagraph.js";

/** The shapes eCFR prints (TC0.5): a heading before an inline child, a numeral after a number, a letter after (h). */
const P = (designator: string | null, text: string) => ({ designator, text });
const section = [
  P(null, "Lead-in."),
  P("a", "(a) General. (1) First rule."),
  P("i", "(i) First numeral under (a)(1)."),
  P("ii", "(ii) Second numeral."),
  P("2", "(2) Second rule."),
  P("b", "(b)(1) Inline child of (b)."),
  P("2", "(2) Sibling under (b)."),
  P("h", "(h) Eighth letter."),
  P("i", "(i) Ninth letter, not a numeral."),
];

describe("paragraphAt — the paragraph a citation's designators name", () => {
  it("finds a child printed after its parent's heading, and ends at the next paragraph of its depth", () => {
    expect(paragraphAt(section, ["a", "1"])).toBe("(a) General. (1) First rule.\n(i) First numeral under (a)(1).\n(ii) Second numeral.");
  });

  it("reads a roman numeral after a number as a numeral", () => {
    expect(paragraphAt(section, ["a", "1", "ii"])).toBe("(ii) Second numeral.");
  });

  it("reads (i) after (h) as a letter", () => {
    expect(paragraphAt(section, ["i"])).toBe("(i) Ninth letter, not a numeral.");
  });

  it("finds a child printed in its parent's paragraph with no heading", () => {
    expect(paragraphAt(section, ["b", "1"])).toBe("(b)(1) Inline child of (b).");
    expect(paragraphAt(section, ["b", "2"])).toBe("(2) Sibling under (b).");
  });

  it("answers null for a path the section does not have, and the whole section for none", () => {
    expect(paragraphAt(section, ["c"])).toBeNull();
    expect(paragraphAt(section, ["a", "3"])).toBeNull();
    expect(paragraphAt(section, [])).toContain("Lead-in.");
  });
});
