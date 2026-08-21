import { describe, it, expect } from "vitest";
import { driverApplicationSchema } from "@fuelguard/shared";
import {
  emptyDraft,
  fromDraftPayload,
  toApplication,
  toDraftPayload,
  type ApplicationDraft,
} from "./draft";

/**
 * The draft → contract conversion, which is where a form quietly asserts things on somebody's behalf
 * if nobody is watching.
 */

const complete = (): ApplicationDraft => ({
  ...emptyDraft(),
  // §391.21(b)(6): a complete application answers at least one half of it.
  experience: "Eight years, dry van and reefer.",
  first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
  email: "s@example.test", phone: "555-0111",
  addresses: [{ line1: "1 Road", line2: "", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: "" }],
  cdl_number: "PA334554", cdl_state: "pa", cdl_expires_at: "2029-01-01",
  employers: [{
    employer_name: "Old Carrier", usdot_number: "123456", address_line1: "12 Depot Rd", city: "Joliet", state: "IL",
    phone: "555-0100", email: "hr@oldcarrier.test", position_held: "Driver",
    started_on: "2023-01-01", ended_on: "2025-06-30",
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
    // ⚠ `experience` used to be the example here and no longer can be: §391.21(b)(6) is mandatory
    // content, so a complete application answers it. `cdl_class` is genuinely optional — (b)(5) asks
    // for the licence, and the class is detail some drivers leave blank.
    expect(sent.cdl_class).toBeNull();
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

/**
 * §391.23(c)(2) requires the previous employer's name AND address in the record of every inquiry,
 * and the form has always asked for the address — 0220's projection was throwing it away (0222).
 * Pinned here at the point it enters the document, because that is where it was lost.
 */
describe("what a §391.23 inquiry will need later", () => {
  it("carries the employer's address and email into the certified application", () => {
    const parsed = parse(complete());
    expect(parsed.success).toBe(true);
    const employer = parsed.success ? parsed.data.employers[0] : null;
    expect(employer?.address_line1).toBe("12 Depot Rd");
    expect(employer?.email).toBe("hr@oldcarrier.test");
  });

  it("sends an unfilled email as null rather than as an empty string", () => {
    const draft = complete();
    draft.employers[0]!.email = "";
    const parsed = parse(draft);
    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.employers[0]?.email : "x").toBeNull();
  });
});

/**
 * The autosave payload (A2, D-APP3).
 *
 * The draft table is prunable, plain jsonb, and holds a stranger's personal data. One key may never
 * reach it, and "excluded by construction" has to mean something a future edit cannot quietly
 * undo — hence an explicit key list rather than a spread, and hence this test.
 */
describe("what autosave sends", () => {
  it("never emits an ssn key, even when one is sitting on the draft object", () => {
    // A3 adds an SSN field to the form. This is that future, forced early: the payload builder must
    // not carry it, and it must not need anyone to remember.
    const draft = { ...complete(), ssn: "123456789" } as unknown as ApplicationDraft;
    const payload = toDraftPayload(draft);
    expect("ssn" in payload).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("123456789");
  });

  it("does not save the certification — that is an act, not an answer", () => {
    const payload = toDraftPayload(complete());
    expect("certified" in payload).toBe(false);
    expect("signed_name" in payload).toBe(false);
  });

  it("carries the answers a driver would be furious to retype", () => {
    const payload = toDraftPayload(complete());
    expect(payload.first_name).toBe("Susan");
    expect(payload.date_of_birth).toBe("1980-04-01");
    expect((payload.employers as unknown[]).length).toBe(1);
  });
});

describe("coming back to a saved draft", () => {
  it("restores what was typed", () => {
    const restored = fromDraftPayload(toDraftPayload(complete()));
    expect(restored.first_name).toBe("Susan");
    expect(restored.date_of_birth).toBe("1980-04-01");
    expect(restored.employers[0]?.employer_name).toBe("Old Carrier");
    // Round-trips back into a document the contract still accepts.
    expect(parse({ ...restored, certified: true, signed_name: "Susan Godfrey" }).success).toBe(true);
  });

  it("comes back uncertified, whatever was saved", () => {
    const restored = fromDraftPayload({ ...toDraftPayload(complete()), certified: true, signed_name: "Susan Godfrey" });
    // §391.21(b) is certified once, about the finished document. A restored tick would be a
    // certification of answers the driver has since changed.
    expect(restored.certified).toBe(false);
    expect(restored.signed_name).toBe("");
  });

  /** The payload is unvalidated by design, so junk is a state that actually occurs — and a resumed
   *  session must never put the form into something it cannot render. */
  it("survives a payload full of the wrong types", () => {
    const restored = fromDraftPayload({
      first_name: 42, addresses: "not an array", employers: [], declares_no_accidents: "yes",
    } as unknown as Record<string, unknown>);
    expect(restored.first_name).toBe("");
    expect(restored.addresses).toHaveLength(1);
    expect(restored.employers).toHaveLength(1);
    expect(restored.declares_no_accidents).toBe(false);
  });

  it("treats no draft at all as a blank form", () => {
    expect(fromDraftPayload(null)).toEqual(emptyDraft());
  });
});

/**
 * The carrier's questions through the same conversion (A9, D-APP12).
 *
 * The definition is data, so the round-trip is the test that matters: what the driver typed has to
 * come back as what the driver typed, and what they left blank has to come back as unanswered rather
 * than as an empty answer.
 */
describe("the questionnaire", () => {
  const answered = (): ApplicationDraft => ({
    ...complete(),
    questionnaire: {
      position: "Company driver",
      legally_work: true,
      may_contact_employers: false,
      heard_from: "   ",
      references: [
        { full_name: "Ann Reyes", years_known: 6, phone: "555-0134" },
        // Added and left blank — an accidental "Add another" is not a reference.
        { full_name: "", years_known: "", phone: "" },
      ],
    },
  });

  it("stamps the version only when something was actually answered", () => {
    const blank = toApplication(complete()) as Record<string, unknown>;
    expect(blank.questionnaire_version).toBeNull();
    expect(blank.questionnaire_answers).toBeNull();

    const filled = toApplication(answered()) as Record<string, unknown>;
    expect(filled.questionnaire_version).toBe("silvicom_driver@v1");
  });

  it("drops what nobody answered, and keeps false, which is an answer", () => {
    const answers = (toApplication(answered()) as Record<string, unknown>)
      .questionnaire_answers as Record<string, unknown>;
    expect(answers.position).toBe("Company driver");
    // `false` is a real answer to "may we contact your previous employers?" and must survive.
    expect(answers.may_contact_employers).toBe(false);
    // Whitespace is not an answer.
    expect("heard_from" in answers).toBe(false);
    expect(answers.references).toHaveLength(1);
  });

  it("produces a document the contract still accepts", () => {
    const parsed = driverApplicationSchema.safeParse({
      ...(toApplication(answered()) as Record<string, unknown>),
      certified: true,
      signed_name: "Susan Godfrey",
    });
    expect(parsed.success).toBe(true);
  });

  it("autosaves and restores the answers", () => {
    const restored = fromDraftPayload(toDraftPayload(answered()));
    expect(restored.questionnaire.position).toBe("Company driver");
    expect(restored.questionnaire.may_contact_employers).toBe(false);
  });

  it("survives a saved questionnaire that is not an object", () => {
    const restored = fromDraftPayload({ questionnaire: "not an object" } as unknown as Record<string, unknown>);
    expect(restored.questionnaire).toEqual({});
  });
});
