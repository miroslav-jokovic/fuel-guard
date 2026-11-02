import { describe, expect, it } from "vitest";
import { driverApplicationSchema } from "./applicationContract.js";
import {
  ALWAYS_OFFERED_CAPTURE_SLOTS,
  REQUIRABLE_QUESTION_IDS,
  WITHHOLDABLE_CAPTURE_SLOTS,
  captureSlotOffered,
  defaultRequiredQuestions,
  offeredCaptureSlots,
  offeredDocumentSlotsOf,
  offeredDocumentSlotsSchema,
  requiredQuestionIds,
  requiredQuestionsOf,
  requiredQuestionsSchema,
  requiredQuestionsToStamp,
  withRequiredQuestions,
} from "./applicationFormSettings.js";
import { APPLICATION_CAPTURE_REQUESTED } from "./applicationCaptureContract.js";
import { questionnaireForApplicant, questionnaireRef } from "./questionnaireContract.js";
import { recruitingSettingsSchema, RECRUITING_SETTINGS_DEFAULTS } from "./recruitingSettingsContract.js";

/** §11 (HIRING-WORKFLOW-AUDIT-2026-10-31, D-RS1…D-RS7): the two settings and the stamp. */

const SERVED = questionnaireForApplicant();
const SEVEN = ["position", "applying_as", "heard_from", "legally_work", "proof_of_age", "may_contact_employers", "education"];
const ANSWERS: Record<string, unknown> = {
  position: "Company driver", applying_as: "company_driver", heard_from: "A friend", legally_work: true,
  proof_of_age: true, may_contact_employers: true,
  education: [{ school: "Joliet High", years_completed: 4, field_of_study: "", graduated: true, graduated_when: "1998" }],
};
const DOCUMENT = {
  first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
  email: "s@example.test", phone: "555-0111",
  addresses: [{ line1: "1 Road", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: null }],
  cdl_number: "PA334554", cdl_state: "PA", cdl_expires_at: "2029-01-01",
  experience: "Eight years, dry van and reefer.",
  accidents: [], declares_no_accidents: true, violations: [], declares_no_violations: true,
  licence_ever_denied: false, employers: [], declares_no_employment: true,
  questionnaire_version: questionnaireRef(SERVED), questionnaire_answers: ANSWERS,
  certified: true, signed_name: "Susan Godfrey",
};
const missing = (doc: object): string[] => {
  const r = driverApplicationSchema.safeParse(doc);
  return r.success ? [] : r.error.issues.map((i) => i.path.join(".")).sort();
};

describe("which questions a carrier may require (D-RS2)", () => {
  it("is every served question except the one asked only after another answer", () => {
    expect(REQUIRABLE_QUESTION_IDS).not.toContain("military_when");
    expect(REQUIRABLE_QUESTION_IDS).toHaveLength(SERVED.questions.length - 1);
  });

  it("defaults to the served definition's own seven (D-RS1)", () => {
    expect([...defaultRequiredQuestions()].sort()).toEqual([...SEVEN].sort());
  });
});

describe("the definition as this applicant is asked it", () => {
  it("is untouched with no stamp", () => {
    expect(withRequiredQuestions(SERVED, null)).toBe(SERVED);
    expect(withRequiredQuestions(SERVED, undefined)).toBe(SERVED);
  });

  it("requires exactly the stamp, and drops a required question's skip (D-RS5)", () => {
    const def = withRequiredQuestions(SERVED, ["position", "references"]);
    expect(def.questions.filter((q) => q.required).map((q) => q.id)).toEqual(["position", "references"]);
    expect(def.questions.find((q) => q.id === "references")!.skip).toBeUndefined();
    // An optional question keeps its skip.
    expect(def.questions.find((q) => q.id === "military_service")!.skip).toBeDefined();
  });

  it("never requires a conditional question, whatever the stamp says", () => {
    expect(requiredQuestionIds(SERVED, ["military_when"])).toEqual([]);
  });

  it("requires nothing for an empty stamp", () => {
    expect(requiredQuestionIds(SERVED, [])).toEqual([]);
  });
});

describe("the rule reads the stamp on the payload (D-RS4)", () => {
  it("no stamp: today's seven", () => {
    expect(missing({ ...DOCUMENT, questionnaire_answers: {} })).toEqual(SEVEN.map((id) => `questionnaire_answers.${id}`).sort());
  });

  it("a stamp naming two: only those two are refused", () => {
    expect(missing({ ...DOCUMENT, questionnaire_answers: {}, questionnaire_required: ["heard_from", "references"] }))
      .toEqual(["questionnaire_answers.heard_from", "questionnaire_answers.references"]);
  });

  it("an empty stamp: nothing is refused", () => {
    expect(missing({ ...DOCUMENT, questionnaire_answers: {}, questionnaire_required: [] })).toEqual([]);
  });

  it("a required question's skip is not an answer (D-RS5)", () => {
    const doc = { ...DOCUMENT, questionnaire_answers: { ...ANSWERS, references: "I'd rather not say" }, questionnaire_required: [...SEVEN, "references"] };
    expect(missing(doc)).toEqual(["questionnaire_answers.references"]);
    // …while the same skip on an optional question still is.
    expect(missing({ ...doc, questionnaire_required: SEVEN })).toEqual([]);
  });

  it("a stamp decides even beside v2's version — the version cannot be used to dodge it (Q-RS3)", () => {
    const doc = { ...DOCUMENT, questionnaire_version: "silvicom_driver@v2", questionnaire_answers: { position: "Driver" }, questionnaire_required: ["heard_from"] };
    expect(missing(doc)).toEqual(["questionnaire_answers.heard_from"]);
  });

  it("v2 with no stamp still requires nothing (the draft in flight)", () => {
    expect(missing({ ...DOCUMENT, questionnaire_version: "silvicom_driver@v2", questionnaire_answers: {} })).toEqual([]);
  });
});

describe("what the Send stamps (D-RS3)", () => {
  it("is the product default when the carrier has not chosen", () => {
    expect(requiredQuestionsToStamp(null).sort()).toEqual([...SEVEN].sort());
  });

  it("is the carrier's set, unknown ids dropped", () => {
    expect(requiredQuestionsToStamp(["references", "nonsense", "military_when"])).toEqual(["references"]);
  });

  it("is an empty array, never null, for a carrier that requires nothing", () => {
    expect(requiredQuestionsToStamp([])).toEqual([]);
  });

  it("a stored set is narrowed and deduplicated on read; null stays null", () => {
    expect(requiredQuestionsOf(["position", "position", "gone"])).toEqual(["position"]);
    expect(requiredQuestionsOf(null)).toBeNull();
  });
});

describe("documents offered (D-RS6)", () => {
  it("always offers the licence and the medical card, which a carrier cannot withhold", () => {
    expect(ALWAYS_OFFERED_CAPTURE_SLOTS).toEqual(["cdl_front", "cdl_back", "medical_card"]);
    for (const s of ALWAYS_OFFERED_CAPTURE_SLOTS) expect(WITHHOLDABLE_CAPTURE_SLOTS).not.toContain(s);
    expect(offeredCaptureSlots([])).toEqual(["cdl_front", "cdl_back", "medical_card"]);
  });

  it("offers every slot with no setting (P9's behaviour)", () => {
    expect(offeredCaptureSlots(null)).toEqual(APPLICATION_CAPTURE_REQUESTED);
  });

  it("offers the carrier's choice in the catalogue's order", () => {
    expect(offeredCaptureSlots(["passport", "twic"])).toEqual(["cdl_front", "cdl_back", "medical_card", "twic", "passport"]);
  });

  it("refuses staging only in a withheld slot — never the selfie or the marks", () => {
    expect(captureSlotOffered("passport", ["twic"])).toBe(false);
    expect(captureSlotOffered("twic", ["twic"])).toBe(true);
    expect(captureSlotOffered("medical_card", [])).toBe(true);
    expect(captureSlotOffered("selfie", [])).toBe(true);
    expect(captureSlotOffered("signature_mark", [])).toBe(true);
    expect(captureSlotOffered("passport", null)).toBe(true);
  });

  it("narrows a stored set to withholdable slots; null stays null", () => {
    expect(offeredDocumentSlotsOf(["passport", "cdl_front", "gone"])).toEqual(["passport"]);
    expect(offeredDocumentSlotsOf(null)).toBeNull();
  });
});

describe("the settings PUT (D-RS7)", () => {
  const base = { invite_ttl_days: 14, reminders_enabled: true, reminder_after_hours: 48 };

  it("keeps both absent (a screen served before this reader)", () => {
    const r = recruitingSettingsSchema.parse(base);
    expect("required_questions" in r).toBe(false);
    expect("offered_document_slots" in r).toBe(false);
  });

  it("takes null as 'use the standard set'", () => {
    const r = recruitingSettingsSchema.parse({ ...base, required_questions: null, offered_document_slots: null });
    expect(r.required_questions).toBeNull();
    expect(r.offered_document_slots).toBeNull();
  });

  it("refuses a question that may not be required, and a slot that may not be withheld", () => {
    expect(requiredQuestionsSchema.safeParse(["military_when"]).success).toBe(false);
    expect(offeredDocumentSlotsSchema.safeParse(["cdl_front"]).success).toBe(false);
    expect(offeredDocumentSlotsSchema.safeParse(["selfie"]).success).toBe(false);
  });

  it("deduplicates", () => {
    expect(requiredQuestionsSchema.parse(["position", "position"])).toEqual(["position"]);
    expect(offeredDocumentSlotsSchema.parse(["twic", "twic"])).toEqual(["twic"]);
  });

  it("defaults both to null — the standard sets", () => {
    expect(RECRUITING_SETTINGS_DEFAULTS.required_questions).toBeNull();
    expect(RECRUITING_SETTINGS_DEFAULTS.offered_document_slots).toBeNull();
  });
});
