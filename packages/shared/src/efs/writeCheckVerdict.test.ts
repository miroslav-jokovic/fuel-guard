import { describe, expect, it } from "vitest";
import { WRITE_CHECK_PLAIN_VERDICT, WRITE_CHECK_RECOMMENDATIONS, writeCheckPlainVerdict } from "./writeCheckVerdict.js";

/**
 * CCF3 (D-CCF6): the admin who runs the write check reads these, not the judge's engineering verdict.
 * The words they must never contain are the ones plan W4 found on the page.
 */
describe("the write check's plain verdict", () => {
  it("has a sentence for every code the judge can return", () => {
    for (const code of WRITE_CHECK_RECOMMENDATIONS) {
      expect(writeCheckPlainVerdict(code), code).toBe(WRITE_CHECK_PLAIN_VERDICT[code]);
    }
  });

  it("speaks to an office reader, not to an engineer", () => {
    for (const sentence of Object.values(WRITE_CHECK_PLAIN_VERDICT)) {
      expect(sentence).not.toMatch(/Phase [AB]|write_entitlement|readOnly|POST \/api|apps\/|\.ts\b|fixture|serializer|echo|setCardV2|docs\//i);
      expect(sentence).not.toContain("!");
      expect(sentence.trim().endsWith(".")).toBe(true);
    }
  });

  it("falls back to null for a code this build does not know, so the page shows the server's own text", () => {
    expect(writeCheckPlainVerdict("a_code_from_a_newer_api")).toBeNull();
    expect(writeCheckPlainVerdict(null)).toBeNull();
    expect(writeCheckPlainVerdict("toString")).toBeNull();
  });
});
