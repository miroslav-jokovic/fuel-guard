import { describe, it, expect } from "vitest";
import { applicationDraftPayloadSchema, driverApplicationSchema } from "@silvicom/shared";
import {
  emptyDraft,
  fromDraftPayload,
  toApplication,
  emptyEmployer,
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
    key: "40000000-0000-4000-8000-00000000000a", employer_name: "Old Carrier", usdot_number: "123456", address_line1: "12 Depot Rd", city: "Joliet", state: "IL",
    phone: "555-0100", email: "hr@oldcarrier.test", position_held: "Driver",
    started_on: "2023-01-01", ended_on: "2025-06-30",
    operated_cmv: true, dot_regulated: true, reason_for_leaving: "Better route",
    subject_to_fmcsr: true, safety_sensitive: true,
  }],
  declares_no_accidents: true, declares_no_violations: true,
  // (b)(9) answered — `emptyDraft` leaves it unanswered since C3c2c1, so a complete draft says No itself.
  licence_ever_denied: false,
  certified: true, signed_name: "Susan Godfrey",
});

const parse = (draft: ApplicationDraft) => driverApplicationSchema.safeParse(toApplication(draft));

/**
 * A draft with something in EVERY field, including the optional ones and the ones a driver usually
 * leaves alone. `complete()` is the minimum a valid application needs; this is the maximum the form
 * can hold, and it is what a totality test has to be given to mean anything.
 */
const everything = (): ApplicationDraft => ({
  ...complete(),
  middle_name: "Jane",
  // The canonical code, unlike `complete()`'s deliberate lowercase: normalising a legacy free-text
  // state is the job of the D-AX5 test below, and a round-trip test that also normalises would be
  // unable to tell a lost answer from a corrected one.
  cdl_state: "PA",
  other_names: ["Susan Bellweather"],
  addresses: [
    { line1: "1 Road", line2: "Apt 4", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: "" },
    { line1: "9 Old Way", line2: "", city: "Gary", state: "IN", postal_code: "46402", from: "2017-03", to: "2019-12" },
  ],
  cdl_class: "A",
  additional_licences: [{ issuing_authority: "IL", number: "HM-9", expires_at: "2027-05-01", kind: "Hazmat endorsement" }],
  equipment_experience: [
    { equipment_class: "tractor_tanker", equipment_type: "Tank", from: "2021-02", to: "2023-08", approx_miles: "180000" },
  ],
  accidents: [{ occurred_on: "2024-06-02", nature: "Rear-ended at a light", fatalities: "0", injuries: "1", hazmat_spill: false }],
  declares_no_accidents: false,
  violations: [{ occurred_on: "2024-02-11", offence: "Speeding", state: "IL", penalty: "$120" }],
  declares_no_violations: false,
  licence_ever_denied: true,
  licence_denial_detail: "Suspended for 30 days in 2016.",
  prior_failed_pre_employment_test: true,
  declares_no_employment: false,
  // A written gap, so "carries every answer" round-trips a real one rather than an empty list (C3c1).
  employment_gaps: [{ from: "2023-09-26", to: "2024-01-15", explanation: "School" }],
  questionnaire: { proof_of_age: true },
  // A written note (C3c2c2), so the round trip carries a real one, not the empty default.
  correction_note: "My phone number ends in 42, not 24.",
});

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

  /**
   * ⚠ Totality, because the spot checks above are exactly what let one field through.
   *
   * `prior_failed_pre_employment_test` — §40.25(j)'s two-year question, and by this file's own
   * reckoning the most consequential answer on the form — was missing from `toDraftPayload` from the
   * day it was added until 2026-09-11. A driver who ticked it, closed the tab and came back had
   * answered NO, with nothing on screen saying so, because `fromDraftPayload` floors every missing
   * key at the empty draft. Nothing failed: every test asked about a field somebody had remembered.
   *
   * This one asks about all of them, so the next field added cannot go the same way.
   */
  it("carries every answer the form can hold", () => {
    const draft = everything();
    const restored = fromDraftPayload(toDraftPayload(draft));
    // The three that are deliberately NOT saved, each for a reason written where it is dropped: the
    // SSN (D-APP3) and the two halves of the certification, which is an act and not an answer.
    const notSaved = new Set(["ssn", "certified", "signed_name"]);
    for (const key of Object.keys(draft) as (keyof ApplicationDraft)[]) {
      if (notSaved.has(key)) continue;
      expect(restored[key], `${key} did not survive the round trip`).toEqual(draft[key]);
    }
  });

  /**
   * The office's edit path re-parses the saved payload before it writes a correction, and it parses
   * it with `applicationDraftPayloadSchema`. If what autosave writes is not what that schema accepts,
   * every correction to every real application is refused — which is what happened while it used the
   * CERTIFIED contract instead, and could not be seen from either side alone.
   */
  it("writes a payload the office's edit path accepts", () => {
    const parsed = applicationDraftPayloadSchema.safeParse(toDraftPayload(everything()));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  /**
   * C3c1 (AW1): a gap's explanation is an answer, so it survives a reload — and a box nobody has written
   * in yet is NOT saved, because the contract refuses an empty explanation and the office's correction
   * path parses the whole saved draft with it. One empty box saved would refuse every office correction.
   */
  it("saves the gaps written about, and never an empty one the office's edit path would refuse", () => {
    const draft = everything();
    draft.employment_gaps = [
      { from: "2023-09-26", to: "2024-01-15", explanation: "School" },
      { from: "2025-03-01", to: "2025-06-01", explanation: "  " },
    ];
    const payload = toDraftPayload(draft);
    expect(payload.employment_gaps).toEqual([{ from: "2023-09-26", to: "2024-01-15", explanation: "School" }]);
    expect(applicationDraftPayloadSchema.safeParse(payload).success).toBe(true);
    expect(fromDraftPayload(payload).employment_gaps).toEqual([{ from: "2023-09-26", to: "2024-01-15", explanation: "School" }]);
  });

  it("files only the explanations written, trimmed", () => {
    const draft = everything();
    draft.employment_gaps = [
      { from: "2023-09-26", to: "2024-01-15", explanation: " Medical leave " },
      { from: "2025-03-01", to: "2025-06-01", explanation: "" },
    ];
    expect((toApplication(draft) as { employment_gaps: unknown }).employment_gaps).toEqual([
      { from: "2023-09-26", to: "2024-01-15", explanation: "Medical leave" },
    ]);
  });

  /**
   * Q-AW33 (C3c2b): §391.21(b)(10)(iv)'s two answers are `null` until given, and `null` survives every
   * step to the contract — so the v2 filing rule that refuses a blank can see one. They started `false`
   * behind unticked boxes, which filed a "No" nobody gave.
   */
  it("starts both (b)(10)(iv) answers unanswered, never No", () => {
    expect(emptyEmployer().subject_to_fmcsr).toBeNull();
    expect(emptyEmployer().safety_sensitive).toBeNull();
    expect(emptyDraft().employers[0]!.subject_to_fmcsr).toBeNull();
  });

  it("carries an unanswered (b)(10)(iv) question through autosave, resume and the contract as null", () => {
    const draft = everything();
    draft.employers[0] = { ...draft.employers[0]!, subject_to_fmcsr: null, safety_sensitive: null };
    const payload = toDraftPayload(draft);
    expect(applicationDraftPayloadSchema.safeParse(payload).success).toBe(true);
    const restored = fromDraftPayload(payload);
    expect(restored.employers[0]!.subject_to_fmcsr).toBeNull();
    expect(restored.employers[0]!.safety_sensitive).toBeNull();
    const filed = toApplication(restored) as { employers: Array<Record<string, unknown>> };
    expect(filed.employers[0]!.subject_to_fmcsr).toBeNull();
    expect(filed.employers[0]!.safety_sensitive).toBeNull();
  });

  it("keeps a saved yes or no — a draft from before C3c2b keeps its false — and reads anything else as unanswered", () => {
    const [yes, legacy, junk, absent] = fromDraftPayload({
      employers: [
        { employer_name: "A", subject_to_fmcsr: true, safety_sensitive: false },
        { employer_name: "B", subject_to_fmcsr: false, safety_sensitive: false },
        { employer_name: "C", subject_to_fmcsr: "yes", safety_sensitive: 1 },
        { employer_name: "D" },
      ],
    }).employers;
    expect([yes!.subject_to_fmcsr, yes!.safety_sensitive]).toEqual([true, false]);
    expect([legacy!.subject_to_fmcsr, legacy!.safety_sensitive]).toEqual([false, false]);
    expect([junk!.subject_to_fmcsr, junk!.safety_sensitive]).toEqual([null, null]);
    expect([absent!.subject_to_fmcsr, absent!.safety_sensitive]).toEqual([null, null]);
  });

  /**
   * C3c2c1: §391.21(b)(9)'s statement is unanswered until given. It started `false`, which made the
   * "no such denial has occurred" statement for the driver. Null never reaches autosave — the office's
   * correction path parses the saved draft with a `.partial()` schema, where absent is allowed and null
   * is not — and it reaches the contract as null, which refuses it.
   */
  it("leaves (b)(9) unanswered, saves nothing for it until answered, and files a blank the contract refuses", () => {
    expect(emptyDraft().licence_ever_denied).toBeNull();
    const draft = everything();
    draft.licence_ever_denied = null;
    const payload = toDraftPayload(draft);
    expect("licence_ever_denied" in payload).toBe(false);
    expect(applicationDraftPayloadSchema.safeParse(payload).success).toBe(true);
    expect(fromDraftPayload(payload).licence_ever_denied).toBeNull();
    const parsed = driverApplicationSchema.safeParse(toApplication(draft));
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.some((i) => i.path[0] === "licence_ever_denied")).toBe(true);
  });

  it("keeps a saved (b)(9) yes or no, and reads anything else as unanswered", () => {
    expect(fromDraftPayload({ licence_ever_denied: true }).licence_ever_denied).toBe(true);
    expect(fromDraftPayload({ licence_ever_denied: false }).licence_ever_denied).toBe(false);
    expect(fromDraftPayload({ licence_ever_denied: "no" }).licence_ever_denied).toBeNull();
    expect(toDraftPayload({ ...everything(), licence_ever_denied: false }).licence_ever_denied).toBe(false);
  });

  /**
   * C3c2c2 (Q-AW34): "Something wrong? Tell us" is saved like an answer and never filed — a note to the
   * office, not something the applicant certifies. The contract is strict, so filing it would refuse the
   * whole document; the draft schema takes it, so the office's correction path still parses the draft.
   */
  it("saves the note to the office, and never files it", () => {
    const draft = everything();
    expect(toDraftPayload(draft).correction_note).toBe("My phone number ends in 42, not 24.");
    expect(applicationDraftPayloadSchema.safeParse(toDraftPayload(draft)).success).toBe(true);
    expect("correction_note" in (toApplication(draft) as Record<string, unknown>)).toBe(false);
    expect(fromDraftPayload({ correction_note: 7 }).correction_note).toBe("");
  });

  it("drops a saved gap row it cannot read rather than rendering it", () => {
    const restored = fromDraftPayload({ employment_gaps: [{ from: "2023-09-26", to: 7, explanation: "x" }, "junk"] });
    expect(restored.employment_gaps).toEqual([]);
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

  /**
   * AW1 (C2b3): the office records phone calls against an employer's key before filing, so the key
   * must survive every save — and an entry saved before keys existed gets one on load, kept from then on.
   */
  it("keeps an employer's key across the round trip, and mints one for an entry saved without", () => {
    // An entry as a pre-AW1 draft stored it: every field, and no key.
    const { key: _minted, ...unkeyed } = emptyEmployer();
    const saved = (over: Record<string, unknown>) => ({ ...unkeyed, started_on: "2023-01-01", ...over });
    const kept = fromDraftPayload(toDraftPayload(fromDraftPayload({
      employers: [saved({ key: "40000000-0000-4000-8000-00000000000a", employer_name: "A" })],
    })));
    expect(kept.employers[0]!.key).toBe("40000000-0000-4000-8000-00000000000a");
    const legacy = fromDraftPayload({ employers: [saved({ employer_name: "A" }), saved({ employer_name: "B", key: "not-a-uuid" })] });
    const [a, b] = legacy.employers;
    expect(a!.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(b!.key).not.toBe("not-a-uuid");
    expect(a!.key).not.toBe(b!.key);
    expect(toApplicationEmployerKeys(legacy)).toEqual([a!.key, b!.key]);
  });

  it("treats no draft at all as a blank form", () => {
    // The blank employer's key is minted per call (AW1), so it is the one field compared by shape.
    const blank = emptyDraft();
    expect(fromDraftPayload(null)).toEqual({
      ...blank,
      employers: blank.employers.map((e) => ({ ...e, key: expect.stringMatching(/^[0-9a-f-]{36}$/) })),
    });
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
    // v2 since Q-HM14 (`applying_as`): the definition an applicant is served today.
    expect(filled.questionnaire_version).toBe("silvicom_driver@v2");
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

/**
 * The jurisdiction picker's migration (D-AX5).
 *
 * ⚠ The failure this prevents is invisible, which is why it is worth its own describe block: a
 * driver resumes, the state field is blank, and nothing on the page says an answer was dropped.
 */
describe("a draft saved before the state fields had a picker", () => {
  const saved = (over: Record<string, unknown>) =>
    fromDraftPayload({ ...toDraftPayload(complete()), ...over });

  it("reads a full state name back as the code the picker can show", () => {
    const restored = saved({
      cdl_state: "Illinois",
      addresses: [{ ...complete().addresses[0], state: "illinois" }],
      employers: [{ ...complete().employers[0], state: "TEXAS" }],
    });
    expect(restored.cdl_state).toBe("IL");
    expect(restored.addresses[0]!.state).toBe("IL");
    expect(restored.employers[0]!.state).toBe("TX");
  });

  it("reads a lower-case code back as a code", () => {
    expect(saved({ cdl_state: "il" }).cdl_state).toBe("IL");
  });

  it("blanks a value no picker could display, rather than carrying it invisibly", () => {
    // A value the control cannot show but would still submit is one nobody can correct. An empty
    // field is a thing the driver can see.
    expect(saved({ cdl_state: "Bavaria" }).cdl_state).toBe("");
    expect(saved({ cdl_state: "I1" }).cdl_state).toBe("");
  });
});

/** The keys the filed payload carries, in order — what `submit_driver_application` matches calls by. */
function toApplicationEmployerKeys(d: ReturnType<typeof fromDraftPayload>): unknown[] {
  return ((toApplication(d) as { employers: Array<{ key: unknown }> }).employers).map((e) => e.key);
}
