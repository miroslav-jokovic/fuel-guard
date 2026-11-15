import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APPLY_COPY } from "./strings";

/**
 * The driving record, yes/no gates first and the lists only on Yes (C3c2c1, §6.4 item 6).
 *
 * The gates are plain words for (b)(7), (b)(8) and (b)(9), each held against the regulation as fetched
 * from the eCFR and committed (docs/plans/recruitment/cfr-391-21/391.21.txt, as of 2026-09-24): every
 * phrase the question depends on is found in the source, and its plain counterpart in the question.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const s391_21 = readFileSync(join(HERE, "../../../../../docs/plans/recruitment/cfr-391-21/391.21.txt"), "utf8")
  .replace(/\s+/g, " ");
const copy = APPLY_COPY.safety;

describe("the three questions, against the regulation", () => {
  it("(b)(7): any accident the driver was involved in, in 3 years", () => {
    expect(s391_21).toContain("all motor vehicle accidents in which the applicant was involved during the 3 years");
    for (const plain of ["In the last 3 years", "were you involved in", "motor vehicle accident"]) {
      expect(copy.accidentsQuestion).toContain(plain);
    }
  });

  it("(b)(8): convicted, or bond or collateral forfeited, in 3 years — parking excepted", () => {
    expect(s391_21).toContain(
      "violations of motor vehicle laws or ordinances (other than violations involving only parking) of which the applicant was convicted or forfeited bond or collateral during the 3 years",
    );
    for (const plain of ["In the last 3 years", "convicted", "traffic law", "forfeit bond or collateral"]) {
      expect(copy.violationsQuestion).toContain(plain);
    }
    expect(copy.violationsQuestionHint).toContain("Parking");
  });

  it("(b)(9): denied, and suspended or revoked, asked apart as the carrier's page 2 asks them — with no time limit", () => {
    expect(s391_21).toContain("any denial, revocation, or suspension of any license, permit, or privilege to operate a motor vehicle");
    // F2c (P4): A is the denial and B the suspension or revocation; together they ask the paragraph's three.
    for (const plain of ["denied", "license, permit or privilege", "operate a motor vehicle", "ever"]) {
      expect(copy.deniedQuestion).toContain(plain);
    }
    for (const plain of ["suspended or revoked", "license, permit or privilege", "ever"]) {
      expect(copy.suspendedQuestion).toContain(plain);
    }
    expect(copy.deniedQuestion).not.toContain("suspended");
    // The paragraph has no window, so neither question may invent one.
    for (const q of [copy.deniedQuestion, copy.suspendedQuestion]) expect(q).not.toMatch(/last \d+ years/);
  });
});
