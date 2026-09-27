import { describe, expect, it } from "vitest";
import type { ApplicationCaptureView, PartOneStatus } from "@silvicom/shared";
import {
  emptyPartOneAnswers,
  firstWrite,
  licenceList,
  resumeScreen,
  screeningPayload,
  validateAbout,
  validateAddress,
  validateLicence,
  validateOtherLicence,
  validateOtherLicences,
  validateScreening,
  type PartOneAnswers,
} from "./partOneScreens";

/**
 * Part 1's pure rules (C3a). The one that matters most is the first write's ORDER, because 0376 drops a
 * date of birth sent before the current licence exists, and refuses a licence list sent before §40.25(j)
 * — each without the other half of the page ever knowing.
 */

const filled = (): PartOneAnswers => ({
  ...emptyPartOneAnswers(),
  phone: "(708) 236-5732",
  date_of_birth: "1985-03-07",
  address_line1: "1 Main St",
  city: "Joliet",
  state: "IL",
  postal_code: "60432",
  cdl: { state_code: "IL", licence_number: "D123-4567", cdl_class: "A", expires_on: "2029-01-01", endorsements: ["N", "H"] },
  otherHeld: true,
  others: [{ state_code: "IN", agency: "", licence_number: "IN-555", expires_on: "" }],
  prior_positive_2y: false,
  dot_program_30d: true,
  dot_tested_6m: true,
  dot_random_12m: false,
});

const status = (over: Partial<PartOneStatus> = {}): PartOneStatus => ({
  completedAt: null, contact: true, address: true, licences: true, screening: true,
  medicalCardPending: false, rights: false, ...over,
});
const cap = (slot: string): ApplicationCaptureView => ({ slot, capturedAt: "2026-09-27T10:00:00Z" }) as ApplicationCaptureView;

describe("the first write", () => {
  it("sends §40.25(j) with the held answers first, then the licences, then the date of birth", () => {
    const writes = firstWrite(filled());
    expect(writes.map((w) => w.kind)).toEqual(["intake", "licences", "intake"]);
    expect(writes[0]!.body).toMatchObject({
      prior_positive_2y: false, dot_program_30d: true, dot_tested_6m: true, dot_random_12m: false,
      phone: "(708) 236-5732", address_line1: "1 Main St", city: "Joliet", state: "IL", postal_code: "60432",
      cdl_class: "A", endorsements: ["N", "H"],
    });
    // Never the date of birth in the first call: no licence exists yet, and 0376 would drop it.
    expect(writes[0]!.body).not.toHaveProperty("date_of_birth");
    expect(writes[2]!.body).toEqual({ date_of_birth: "1985-03-07" });
  });

  it("puts the current CDL at position 0 and the others after it, in the order given", () => {
    const [, licences] = firstWrite(filled());
    expect((licences!.body as Array<{ state_code: string; licence_number: string }>).map((l) => [l.state_code, l.licence_number]))
      .toEqual([["IL", "D123-4567"], ["IN", "IN-555"]]);
  });

  it("drops the other licences when the answer to the gate became No", () => {
    expect(licenceList({ ...filled(), otherHeld: false })).toHaveLength(1);
  });

  /** A "No" to the 30-day program makes the follow-ups moot; a changed mind must not leave stale leads. */
  it("sends the two follow-ups only when they were asked", () => {
    expect(screeningPayload({ ...filled(), dot_program_30d: false })).toEqual({ prior_positive_2y: false, dot_program_30d: false });
  });
});

describe("each screen's check", () => {
  it("names a blank field in words, and a typed one by the rule it broke", () => {
    expect(validateAbout(emptyPartOneAnswers())).toEqual({
      phone: "Enter your mobile phone number.", date_of_birth: "Enter your date of birth.",
    });
    const young = validateAbout({ ...filled(), date_of_birth: "2015-01-01", phone: "123" });
    expect(Object.keys(young).sort()).toEqual(["date_of_birth", "phone"]);
    expect(young.phone).toMatch(/US mobile number/);
    expect(validateAbout(filled())).toEqual({});
  });

  it("refuses an address outside the US and a ZIP that is not five digits", () => {
    expect(validateAddress({ ...filled(), state: "ON", postal_code: "6043" })).toMatchObject({
      state: expect.any(String), postal_code: expect.any(String),
    });
    expect(validateAddress(filled())).toEqual({});
  });

  it("needs the CDL's state, number, class and expiry", () => {
    expect(Object.keys(validateLicence(emptyPartOneAnswers())).sort()).toEqual(
      ["cdl_class", "expires_on", "licence_number", "state_code"],
    );
    expect(validateLicence(filled())).toEqual({});
  });

  it("refuses a Yes with nothing added, and an unanswered gate", () => {
    expect(validateOtherLicences({ ...filled(), otherHeld: null })).toHaveProperty("otherHeld");
    expect(validateOtherLicences({ ...filled(), others: [] })).toHaveProperty("otherHeld");
    expect(validateOtherLicences({ ...filled(), otherHeld: false, others: [] })).toEqual({});
  });

  it("refuses the current CDL or a listed licence typed again — 0376's unique index, in words", () => {
    const a = filled();
    expect(validateOtherLicence({ state_code: "IL", agency: "", licence_number: "d123-4567", expires_on: "" }, a))
      .toEqual({ licence_number: "This licence is already on the list." });
    expect(validateOtherLicence({ state_code: "IN", agency: "", licence_number: "IN-555", expires_on: "" }, a))
      .toHaveProperty("licence_number");
    expect(validateOtherLicence({ state_code: "WI", agency: "", licence_number: "W-1", expires_on: "" }, a)).toEqual({});
  });

  it("asks the follow-ups only after a Yes to the 30-day program", () => {
    const base = { ...emptyPartOneAnswers(), prior_positive_2y: false };
    expect(validateScreening({ ...base, dot_program_30d: false })).toEqual({});
    expect(Object.keys(validateScreening({ ...base, dot_program_30d: true })).sort()).toEqual(["dot_random_12m", "dot_tested_6m"]);
    expect(validateScreening(emptyPartOneAnswers())).toHaveProperty("prior_positive_2y");
  });
});

describe("where a returning applicant resumes", () => {
  it("starts from the beginning until §40.25(j) is on file — nothing before it could be saved", () => {
    expect(resumeScreen(status({ screening: false }), false, [])).toBe("about");
  });

  it("goes back to screen 3 when the date of birth did not land", () => {
    expect(resumeScreen(status(), false, [])).toBe("about");
  });

  it("opens on the first photograph still owed, then the rights", () => {
    expect(resumeScreen(status(), true, [])).toBe("cdl_front");
    expect(resumeScreen(status(), true, [cap("cdl_front")])).toBe("cdl_back");
    expect(resumeScreen(status(), true, [cap("cdl_front"), cap("cdl_back")])).toBe("medical_card");
    expect(resumeScreen(status({ medicalCardPending: true }), true, [cap("cdl_front"), cap("cdl_back")])).toBe("rights");
    expect(resumeScreen(status(), true, [cap("cdl_front"), cap("cdl_back"), cap("medical_card")])).toBe("rights");
  });
});
