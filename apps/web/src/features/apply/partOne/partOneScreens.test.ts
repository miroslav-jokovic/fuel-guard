import { describe, expect, it } from "vitest";
import type { AamvaLicence, ApplicationCaptureView, PartOneStatus } from "@silvicom/shared";
import {
  emptyPartOneAnswers,
  firstWrite,
  licenceList,
  PART_ONE_SCREENS,
  prefillFromLicence,
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
  others: [{ state_code: "IN", agency: "", licence_number: "IN-555", expires_on: "2021-06-30" }],
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
    expect(validateOtherLicence({ state_code: "IL", agency: "", licence_number: "d123-4567", expires_on: "2029-01-01" }, a))
      .toEqual({ licence_number: "This licence is already on the list." });
    expect(validateOtherLicence({ state_code: "IN", agency: "", licence_number: "IN-555", expires_on: "2021-06-30" }, a))
      .toHaveProperty("licence_number");
    expect(validateOtherLicence({ state_code: "WI", agency: "", licence_number: "W-1", expires_on: "2020-01-31" }, a)).toEqual({});
  });

  /** Q-AW35 (a): filing refuses a licence with no date, and no screen after this one can ask for it. */
  it("needs another licence's expiry date, a past one included", () => {
    const entry = { state_code: "OH", agency: "", licence_number: "OH-1", expires_on: "" };
    expect(validateOtherLicence(entry, filled())).toEqual({ expires_on: "Enter the expiry date printed on the licence." });
    expect(validateOtherLicence({ ...entry, expires_on: "  " }, filled())).toEqual({ expires_on: "Enter the expiry date printed on the licence." });
    expect(validateOtherLicence({ ...entry, expires_on: "2019-05-01" }, filled())).toEqual({});
  });

  it("asks the follow-ups only after a Yes to the 30-day program", () => {
    const base = { ...emptyPartOneAnswers(), prior_positive_2y: false };
    expect(validateScreening({ ...base, dot_program_30d: false })).toEqual({});
    expect(Object.keys(validateScreening({ ...base, dot_program_30d: true })).sort()).toEqual(["dot_random_12m", "dot_tested_6m"]);
    expect(validateScreening(emptyPartOneAnswers())).toHaveProperty("prior_positive_2y");
  });
});

describe("where a returning applicant resumes", () => {
  const both = [cap("cdl_front"), cap("cdl_back")];

  it("photographs the CDL first — its barcode fills the typed screens after it (Q-AW31)", () => {
    expect(PART_ONE_SCREENS.slice(0, 3)).toEqual(["cdl_front", "cdl_back", "about"]);
    expect(resumeScreen(status({ screening: false }), false, [])).toBe("cdl_front");
    expect(resumeScreen(status({ screening: false }), false, [cap("cdl_front")])).toBe("cdl_back");
  });

  it("starts at screen 3 until §40.25(j) is on file — nothing typed before it could be saved", () => {
    expect(resumeScreen(status({ screening: false }), false, both)).toBe("about");
  });

  it("goes back to screen 3 when the date of birth did not land", () => {
    expect(resumeScreen(status(), false, both)).toBe("about");
  });

  it("asks for a CDL photo still owed before anything else, then the medical card, then the rights", () => {
    expect(resumeScreen(status(), true, [])).toBe("cdl_front");
    expect(resumeScreen(status(), true, [cap("cdl_front")])).toBe("cdl_back");
    expect(resumeScreen(status(), true, both)).toBe("medical_card");
    expect(resumeScreen(status({ medicalCardPending: true }), true, both)).toBe("rights");
    expect(resumeScreen(status(), true, [...both, cap("medical_card")])).toBe("rights");
  });
});

describe("what the licence's barcode fills in (AW5)", () => {
  const licence = (over: Partial<AamvaLicence> = {}): AamvaLicence => ({
    aamvaVersion: 10, iin: "636035", issuingState: "IL", licenceNumber: "J12345678901",
    familyName: "KOWALSKI", firstName: "ANNA", middleName: null,
    dateOfBirth: "1979-11-30", expiresOn: "2027-11-30",
    address: { line1: "123 N STATE ST", line2: "APT 4B", city: "CHICAGO", state: "IL", postalCode: "60601" },
    ...over,
  });

  it("fills every blank box it can, and names each one", () => {
    const a = emptyPartOneAnswers();
    expect(prefillFromLicence(a, licence()).sort()).toEqual([
      "address_line1", "address_line2", "cdl.expires_on", "cdl.licence_number", "cdl.state_code",
      "city", "date_of_birth", "postal_code", "state",
    ]);
    expect(a).toMatchObject({
      date_of_birth: "1979-11-30", address_line1: "123 N STATE ST", address_line2: "APT 4B", city: "CHICAGO",
      state: "IL", postal_code: "60601",
      cdl: { state_code: "IL", licence_number: "J12345678901", expires_on: "2027-11-30", cdl_class: "" },
    });
  });

  it("never replaces what the driver typed", () => {
    const a = { ...emptyPartOneAnswers(), date_of_birth: "1985-03-07" };
    expect(prefillFromLicence(a, licence())).not.toContain("date_of_birth");
    expect(a.date_of_birth).toBe("1985-03-07");
  });

  it("fills the address and the CDL each as a whole or not at all — one typed box keeps the block the driver's", () => {
    const a = emptyPartOneAnswers();
    a.postal_code = "60432";
    a.cdl.licence_number = "D123";
    expect(prefillFromLicence(a, licence())).toEqual(["date_of_birth"]);
    expect(a).toMatchObject({ address_line1: "", city: "", postal_code: "60432" });
    expect(a.cdl).toMatchObject({ state_code: "", licence_number: "D123", expires_on: "" });
  });

  it("names only what the barcode actually held", () => {
    const a = emptyPartOneAnswers();
    const filled = prefillFromLicence(a, licence({
      issuingState: null, expiresOn: null, dateOfBirth: null,
      address: { line1: "1 MAIN ST", line2: null, city: "JOLIET", state: null, postalCode: null },
    }));
    expect(filled.sort()).toEqual(["address_line1", "cdl.licence_number", "city"]);
    expect(a).toMatchObject({ address_line2: "", state: "", postal_code: "", cdl: { state_code: "", expires_on: "" } });
  });

  it("leaves an address with no street or no city for the driver to type", () => {
    const a = emptyPartOneAnswers();
    prefillFromLicence(a, licence({ address: { line1: null, line2: null, city: "CHICAGO", state: "IL", postalCode: "60601" } }));
    expect(a).toMatchObject({ city: "", state: "", postal_code: "" });
  });
});
