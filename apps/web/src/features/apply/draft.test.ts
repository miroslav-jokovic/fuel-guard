import { describe, it, expect } from "vitest";
import { driverApplicationSchema } from "@fuelguard/shared";
import { emptyDraft, toApplication, type ApplicationDraft } from "./draft";

/**
 * The draft → contract conversion, which is where a form quietly asserts things on somebody's behalf
 * if nobody is watching.
 */

const complete = (): ApplicationDraft => ({
  ...emptyDraft(),
  first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
  email: "s@example.test", phone: "555-0111",
  addresses: [{ line1: "1 Road", line2: "", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: "" }],
  cdl_number: "PA334554", cdl_state: "pa", cdl_expires_at: "2029-01-01",
  employers: [{
    employer_name: "Old Carrier", usdot_number: "123456", address_line1: "", city: "Joliet", state: "IL",
    phone: "555-0100", position_held: "Driver", started_on: "2023-01-01", ended_on: "2025-06-30",
    operated_cmv: true, dot_regulated: true, reason_for_leaving: "Better route",
    subject_to_fmcsr: true, safety_sensitive: true,
  }],
  declares_no_accidents: true, declares_no_violations: true,
  certified: true, signed_name: "Susan Godfrey",
});

const parse = (draft: ApplicationDraft) => driverApplicationSchema.safeParse(toApplication(draft));

describe("what the form sends", () => {
  it("produces a document the server's own schema accepts", () => {
    const parsed = parse(complete());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  /** An empty string is an answer of nothing; `null` is "not answered", which is what the schema means. */
  it("sends null for a blank optional field, never an empty string", () => {
    const sent = toApplication(complete()) as Record<string, unknown>;
    expect(sent.middle_name).toBeNull();
    expect(sent.experience).toBeNull();
    expect((sent.addresses as Array<Record<string, unknown>>)[0]!.to).toBeNull();
  });

  it("normalises the licence state, because PSP matches on it exactly", () => {
    const sent = toApplication(complete()) as { cdl_state: string };
    expect(sent.cdl_state).toBe("PA");
  });

  /** An accidental "Add another" click is not a declaration about somebody's history. */
  it("drops rows the applicant added and left blank", () => {
    const draft = complete();
    draft.employers.push({ ...draft.employers[0]!, employer_name: "" });
    draft.addresses.push({ line1: "", line2: "", city: "", state: "", postal_code: "", from: "", to: "" });
    const sent = toApplication(draft) as { employers: unknown[]; addresses: unknown[] };
    expect(sent.employers).toHaveLength(1);
    expect(sent.addresses).toHaveLength(1);
  });

  /**
   * Empty arrays are ANSWERS only when the applicant said so. A form that submitted with neither an
   * accident nor a declaration would file "no accidents" on their behalf.
   */
  it("cannot submit an empty accident list without the declaration", () => {
    const draft = complete();
    draft.declares_no_accidents = false;
    const parsed = parse(draft);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("accidents");
  });

  it("cannot submit without the §391.21(b) certification", () => {
    const draft = complete();
    draft.certified = false;
    expect(parse(draft).success).toBe(false);
  });

  it("refuses a licence denial with no explanation", () => {
    const draft = complete();
    draft.licence_ever_denied = true;
    expect(parse(draft).success).toBe(false);
    draft.licence_denial_detail = "Suspended for 30 days in 2021";
    expect(parse(draft).success).toBe(true);
  });

  /**
   * A new employer row defaults to DOT-regulated and CMV-driving. The two defaults are not symmetric:
   * a warehouse job wrongly marked regulated produces an inquiry nobody owed, while a driving job
   * wrongly marked otherwise drops a §391.23(a)(2) obligation silently.
   */
  it("defaults a new employer to the answer whose error is visible", () => {
    const fresh = emptyDraft().employers[0]!;
    expect(fresh.dot_regulated).toBe(true);
    expect(fresh.operated_cmv).toBe(true);
  });
});
