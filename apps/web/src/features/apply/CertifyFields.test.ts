import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APPLY_COPY } from "./strings";

/**
 * §391.21(b)(12) prescribes the certification sentence (C3c1). Read against the regulation's own text,
 * committed as fetched from the eCFR (docs/plans/recruitment/cfr-391-21/391.21.txt, current as of
 * 2026-09-24) — never against a copy typed from memory, which is how the box lost "this application
 * was completed by me" in the first place.
 */
const SOURCE = join(dirname(fileURLToPath(import.meta.url)), "../../../../../docs/plans/recruitment/cfr-391-21/391.21.txt");
const regulation = readFileSync(SOURCE, "utf8").replace(/\s+/g, " ");

describe("the certification (C3c1)", () => {
  it("certifies in §391.21(b)(12)'s own words", () => {
    expect(regulation).toContain("(12) The following certification and signature line");
    expect(regulation).toContain(APPLY_COPY.certify.statement);
    expect(APPLY_COPY.certify.statement).toContain("was completed by me");
  });

  it("the committed source is the paragraph (b)(1) and (b)(3) are read from too", () => {
    expect(regulation).toContain("(1) The name and address of the employing motor carrier;");
    expect(regulation).toContain("(3) The addresses at which the applicant has resided during the 3 years preceding the date on which the application is submitted;");
  });
});
