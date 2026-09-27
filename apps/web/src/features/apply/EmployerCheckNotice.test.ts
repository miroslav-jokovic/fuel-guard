import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import EmployerCheckNotice from "./EmployerCheckNotice.vue";
import { APPLY_COPY } from "./strings";

/**
 * §391.21(d) and §391.23(i), read against the regulation as fetched from the eCFR and committed
 * (docs/plans/recruitment/cfr-391-21/, current as of 2026-09-24). The rights are the regulation's own
 * clauses in the second person, so each is turned back into the third person here and must then appear
 * in the source word for word — a right shortened on the screen cannot pass.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const source = (name: string): string =>
  readFileSync(join(HERE, "../../../../../docs/plans/recruitment/cfr-391-21", name), "utf8").replace(/\s+/g, " ");
const s391_21 = source("391.21.txt");
const s391_23 = source("391.23.txt");
const copy = APPLY_COPY.employerCheck;

/** The screen's second person, back into the regulation's third. */
const asRegulation = (right: string): string =>
  right.replace(/\.$/, "").replace("to us", "to the prospective employer").replace("and you cannot", "and the driver cannot");

describe("the notice before sending (C3c2a)", () => {
  it("states each §391.23(i)(1) right in the regulation's own words", () => {
    expect(copy.rights).toHaveLength(3);
    // Whole clauses: each ends in the source at ";" or "." — a shortened right is a prefix of the real
    // one and would pass a bare substring check.
    for (const right of copy.rights) {
      const clause = asRegulation(right);
      expect(s391_23.includes(`${clause};`) || s391_23.includes(`${clause}.`), clause).toBe(true);
    }
  });

  it("says what §391.21(d) says will happen to the (b)(10) answers", () => {
    expect(s391_21).toContain("may be used, and the applicant's previous employers will be contacted, for the purpose of investigating the applicant's safety performance history");
    for (const part of ["may be used", "previous employers will be contacted", "safety performance history"]) {
      expect(copy.use).toContain(part);
    }
  });

  it("keeps every limit §391.23(i)(2) sets on asking to see the records", () => {
    for (const limit of ["written request", "30 days after being employed or being notified of denial", "five (5) business days", "thirty (30) days"]) {
      expect(s391_23).toContain(limit);
    }
    const howTo = copy.howTo.join(" ");
    for (const limit of [
      "in writing", "30 days after you are hired or told you were not",
      "within 5 business days of your request", "within 5 business days of receiving it", "within 30 days",
    ]) {
      expect(howTo).toContain(limit);
    }
  });

  it("renders all of it", () => {
    const text = mount(EmployerCheckNotice).text();
    for (const line of [copy.use, copy.rightsIntro, ...copy.rights, ...copy.howTo]) expect(text).toContain(line);
  });
});
