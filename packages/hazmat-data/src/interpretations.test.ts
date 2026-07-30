import { describe, expect, it } from "vitest";
import { parseInterpretations, interpretationById } from "./interpretations.js";
import { loadInterpretations } from "./index.js";

describe("interpretations dataset", () => {
  it("loads + validates the committed interpretations.json", () => {
    const file = loadInterpretations();
    expect(file.interpretations.length).toBe(6);
    for (const i of file.interpretations) {
      expect(i.url).toContain("phmsa.dot.gov/regulations/title49/interp/");
      expect(i.cfrSections.length).toBeGreaterThan(0);
      expect(i.summary.length).toBeGreaterThan(10);
    }
  });

  it("has exactly the six plan-designated letters", () => {
    const ids = loadInterpretations().interpretations.map((i) => i.id).sort();
    expect(ids).toEqual(["07-0100", "14-0178", "15-0187R", "18-0023", "18-0096", "25-0024"]);
  });

  it("looks up by id, tolerating case/whitespace", () => {
    const file = loadInterpretations();
    expect(interpretationById(file, "15-0187r")!.date).toBe("2016-12-21");
    expect(interpretationById(file, " 18-0023 ")!.cfrSections).toContain("172.336(c)");
    expect(interpretationById(file, "99-9999")).toBeNull();
  });

  it("parseInterpretations applies defaults", () => {
    const parsed = parseInterpretations({ edition: "x", interpretations: [{ id: "1", url: "u", summary: "s........." }] });
    expect(parsed.interpretations[0]!.affectsRules).toEqual([]);
    expect(parsed.interpretations[0]!.cfrSections).toEqual([]);
  });
});
