import { describe, it, expect } from "vitest";
import { questionnaireForApplicant } from "@silvicom/shared";
import { editableFields, matchingFields, pathKey } from "./editableFields";
import { emptyDraft, toDraftPayload, type ApplicationDraft } from "./draft";

/**
 * What the office may correct, and — more to the point — what it may not.
 *
 * ⚠ The test that matters is the one about rows the payload does not have. `fromDraftPayload` floors
 * an empty application at one blank address and one blank employer so the FORM has something to
 * render; a list built from that would offer the office a box whose write the server refuses, because
 * `withValueAt` on a missing `addresses` key builds an object where the contract wants an array.
 * Offering a control that cannot save is worse than offering none.
 */

const questionnaire = questionnaireForApplicant();

const filled = (): ApplicationDraft => ({
  ...emptyDraft(),
  first_name: "Susan",
  last_name: "Godfrey",
  date_of_birth: "1980-04-01",
  addresses: [
    { line1: "1 Road", line2: "", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: "" },
  ],
  employers: [
    {
      employer_name: "Old Carrier", usdot_number: "", address_line1: "", city: "Jolliet", state: "IL",
      phone: "", email: "", position_held: "Driver", started_on: "2023-01-01", ended_on: "2025-06-30",
      operated_cmv: true, dot_regulated: true, reason_for_leaving: "", subject_to_fmcsr: true,
      safety_sensitive: true,
    },
  ],
  other_names: ["Susan Bellweather"],
  declares_no_accidents: true,
  questionnaire: { position: "Line-haul driver", legally_work: true },
});

const fieldsOf = (draft: ApplicationDraft) => editableFields(toDraftPayload(draft), questionnaire);
const keys = (draft: ApplicationDraft) => fieldsOf(draft).map((f) => pathKey(f.path));

describe("which answers the office is offered", () => {
  it("addresses every answer by its contract path, in the words the driver's screen used", () => {
    const found = fieldsOf(filled());
    const city = found.find((f) => pathKey(f.path) === "employers.0.city");
    expect(city?.label).toBe("Employer 1 · City");
    expect(city?.value).toBe("Jolliet");
    expect(city?.kind).toBe("text");
  });

  it("marks a yes/no answer as one, so it is not offered as a box to type into", () => {
    const operated = fieldsOf(filled()).find((f) => pathKey(f.path) === "employers.0.operated_cmv");
    expect(operated?.kind).toBe("boolean");
    expect(operated?.value).toBe(true);
  });

  it("⚠ offers no row the payload does not have", () => {
    // An empty draft renders one blank address and one blank employer on the FORM. Neither is in the
    // payload, and an edit to one would be an invention rather than a correction — and would be
    // refused by the server, which is the worse half.
    const blank = keys({ ...emptyDraft(), addresses: [], employers: [] });
    expect(blank.some((k) => k.startsWith("addresses."))).toBe(false);
    expect(blank.some((k) => k.startsWith("employers."))).toBe(false);
  });

  it("never offers the certification, the signature or the social security number", () => {
    // §391.21(b) is certified once, by the applicant, about the finished document; the SSN never
    // enters a draft at all (D-APP3). None of the three is an answer this screen may change.
    const found = keys({ ...filled(), certified: true, signed_name: "Susan Godfrey", ssn: "123456789" });
    expect(found).not.toContain("certified");
    expect(found).not.toContain("signed_name");
    expect(found).not.toContain("ssn");
  });

  it("labels the carrier's own questions with the question that was asked", () => {
    const answer = fieldsOf(filled()).find((f) => pathKey(f.path) === "questionnaire.position");
    expect(answer?.label).toBe("Position you are applying for");
    expect(answer?.value).toBe("Line-haul driver");
  });

  it("keeps a plain-string row addressable by position", () => {
    const name = fieldsOf(filled()).find((f) => pathKey(f.path) === "other_names.0");
    expect(name?.value).toBe("Susan Bellweather");
    expect(name?.label).toBe("Name 1");
  });

  it("treats no draft at all as nothing to correct", () => {
    expect(editableFields(null, questionnaire)).toEqual([]);
  });
});

describe("finding one field among sixty", () => {
  it("matches on any word of the label, because that is what the office has to go on", () => {
    const found = fieldsOf(filled());
    expect(matchingFields(found, "employer 1").length).toBeGreaterThan(0);
    expect(matchingFields(found, "CITY").some((f) => pathKey(f.path) === "employers.0.city")).toBe(true);
    expect(matchingFields(found, "")).toHaveLength(found.length);
    expect(matchingFields(found, "nothing like this")).toHaveLength(0);
  });
});
