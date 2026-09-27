import { describe, expect, it } from "vitest";
import type { PartOneFactsView } from "@silvicom/shared";
import { emptyAddress, emptyDraft, type ApplicationDraft } from "./draft";
import { aboutYouRows, applyPartOne, licenceRows, partOneStreet } from "./partOneFacts";
import { APPLY_COPY } from "./strings";

/**
 * A v2 applicant's draft with Part 1 laid over it (C3c2c2, Q-AW34) — through filing's own
 * `composeFiledApplication` — and the read-only rows built from the same facts.
 */
const copy = APPLY_COPY.partOneFacts;

const facts = (over: Partial<PartOneFactsView["intake"]> = {}, licences?: PartOneFactsView["licences"]): PartOneFactsView => ({
  intake: {
    phone: "+13125550142", address_line1: "1 Main St", address_line2: null, city: "Joliet", state: "IL",
    postal_code: "60431", prior_positive_2y: true, cdl_class: "A", ...over,
  },
  licences: licences ?? [
    { position: 0, state_code: "IL", agency: null, licence_number: "IL123", expires_on: "2029-03-01" },
    { position: 1, state_code: "OH", agency: "Ohio BMV", licence_number: "OH55", expires_on: "2028-06-30" },
    { position: 2, state_code: "IN", agency: null, licence_number: "IN-OLD", expires_on: "2025-01-01" },
  ],
  asOf: "2026-09-27",
});

const typed = (): ApplicationDraft => ({
  ...emptyDraft(),
  date_of_birth: "1980-04-01",
  phone: "555-0000",
  addresses: [
    { line1: "9 Old Rd", line2: "", city: "Gary", state: "IN", postal_code: "46402", from: "2020-01", to: "2024-05" },
    { line1: "typed", line2: "Apt 1", city: "typed", state: "WI", postal_code: "00000", from: "2024-06", to: "" },
  ],
  cdl_number: "TYPED", cdl_state: "WI", cdl_class: "B", cdl_expires_at: "2027-01-01",
  additional_licences: [{ issuing_authority: "Ohio", number: "DRAFT9", expires_at: "2030-01-01", kind: "permit" }],
  prior_failed_pre_employment_test: false,
});

describe("laying Part 1 over the draft", () => {
  it("takes the phone, the current street, the CDL and its class, the unexpired licences and §40.25(j) from Part 1", () => {
    const draft = typed();
    applyPartOne(draft, facts());
    expect(draft.phone).toBe("+13125550142");
    expect([draft.cdl_number, draft.cdl_state, draft.cdl_class, draft.cdl_expires_at]).toEqual(["IL123", "IL", "A", "2029-03-01"]);
    expect(draft.additional_licences).toEqual([{ issuing_authority: "Ohio BMV", number: "OH55", expires_at: "2028-06-30", kind: "" }]);
    expect(draft.prior_failed_pre_employment_test).toBe(true);
  });

  it("keeps the draft's own shape — Part 1's blank second line is \"\", never null — and the months the applicant gave", () => {
    const draft = typed();
    applyPartOne(draft, facts());
    expect(draft.addresses[1]).toEqual({
      line1: "1 Main St", line2: "", city: "Joliet", state: "IL", postal_code: "60431", from: "2024-06", to: "",
    });
    // History is the applicant's; Part 1 records only where they live now.
    expect(draft.addresses[0]!.line1).toBe("9 Old Rd");
  });

  it("leaves what Part 1 did not record as the applicant typed it", () => {
    const draft = typed();
    applyPartOne(draft, facts({ phone: null, address_line1: null, cdl_class: null, prior_positive_2y: null }, []));
    expect(draft.phone).toBe("555-0000");
    expect(draft.addresses[1]!.line1).toBe("typed");
    expect(draft.cdl_class).toBe("B");
    expect(draft.prior_failed_pre_employment_test).toBe(false);
  });
});

describe("the rows shown", () => {
  it("shows the date of birth on file and Part 1's phone on \"About you\"", () => {
    expect(aboutYouRows(typed(), facts())).toEqual([
      { label: copy.dateOfBirth, value: "04/01/1980" },
      { label: copy.phone, value: "(312) 555-0142" },
    ]);
  });

  it("lists every Part 1 licence, the CDL first with its class, and says which the application lists", () => {
    expect(licenceRows(facts()).map((r) => [r.label, r.value])).toEqual([
      [copy.cdl, `Illinois · IL123 · Class A · ${copy.expires("03/01/2029")}`],
      [copy.otherLicences, `Ohio · Ohio BMV · OH55 · ${copy.expires("06/30/2028")}`],
      [copy.otherLicences, `Indiana · IN-OLD · ${copy.expired}`],
    ]);
  });

  it("says when a licence has no expiry, and when there are no others", () => {
    const noExpiry = facts({}, [
      { position: 0, state_code: "IL", agency: null, licence_number: "IL123", expires_on: "2029-03-01" },
      { position: 1, state_code: "OH", agency: null, licence_number: "OH55", expires_on: null },
    ]);
    expect(licenceRows(noExpiry)[1]!.value).toBe(`Ohio · OH55 · ${copy.noExpiry}`);
    const only = facts({ cdl_class: null }, [facts().licences[0]!]);
    expect(licenceRows(only)).toEqual([
      { label: copy.cdl, value: `Illinois · IL123 · ${copy.expires("03/01/2029")}` },
      { label: copy.otherLicences, value: copy.noOtherLicences },
    ]);
  });
});

describe("the street filing lays over the current address", () => {
  it("is Part 1's, in the draft's shape", () => {
    expect(partOneStreet(facts())).toEqual({ line1: "1 Main St", line2: "", city: "Joliet", state: "IL", postal_code: "60431" });
  });

  it("is none when Part 1's address is incomplete, because filing then files what was typed", () => {
    expect(partOneStreet(facts({ postal_code: null }))).toBeNull();
    // And it agrees with the overlay on the same facts.
    const draft = { ...typed(), addresses: [{ ...emptyAddress(), line1: "typed", city: "typed", from: "2024-06" }] };
    applyPartOne(draft, facts({ postal_code: null }));
    expect(draft.addresses[0]!.line1).toBe("typed");
  });
});
