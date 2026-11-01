import { describe, expect, it } from "vitest";
import {
  applicationBeforeCertificationSchema,
  applicationDraftPayloadSchema,
  driverApplicationSchema,
} from "./applicationContract.js";
import { APPLICATION_CROSS_FIELD_RULES, ruleIssuePath } from "./applicationRules.js";
import { sectionOwningPath } from "./applicationSections.js";
import {
  questionnaireForApplicant,
  questionnaireRef,
} from "./questionnaireContract.js";
import {
  choiceLabel,
  questionnaireProgress,
} from "./questionnaireAnswers.js";

/**
 * Q-WF3's seven (owner 2026-10-31), made refusable by both validators at once (§9 P8, AF-1).
 *
 * The list below is the RULING, written out once here on purpose: everything in the product derives the
 * set from the definition's `required` flag, and this is the one place that checks the flag says what
 * the owner said.
 */
const Q_WF3 = [
  "position", "applying_as", "heard_from", "legally_work", "proof_of_age", "may_contact_employers", "education",
];

const SERVED = questionnaireForApplicant();

const ANSWERS: Record<string, unknown> = {
  position: "Company driver",
  applying_as: "company_driver",
  heard_from: "A friend",
  legally_work: true,
  proof_of_age: true,
  may_contact_employers: true,
  education: [{ school: "Joliet High", years_completed: 4, field_of_study: "", graduated: true, graduated_when: "1998" }],
};

const DOCUMENT = {
  first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
  email: "s@example.test", phone: "555-0111",
  addresses: [{ line1: "1 Road", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: null }],
  cdl_number: "PA334554", cdl_state: "PA", cdl_expires_at: "2029-01-01",
  experience: "Eight years, dry van and reefer.",
  accidents: [], declares_no_accidents: true,
  violations: [], declares_no_violations: true,
  licence_ever_denied: false,
  employers: [], declares_no_employment: true,
  questionnaire_version: questionnaireRef(SERVED),
  questionnaire_answers: ANSWERS,
  certified: true, signed_name: "Susan Godfrey",
};

const pathsOf = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }): string[] =>
  r.success ? [] : r.error!.issues.map((i) => i.path.join("."));

describe("the carrier's required questions (§9 P8)", () => {
  it("are exactly Q-WF3's seven, read off the served definition", () => {
    expect(SERVED.questions.filter((q) => q.required).map((q) => q.id).sort()).toEqual([...Q_WF3].sort());
  });

  it("accept a document that answers all seven", () => {
    expect(driverApplicationSchema.safeParse(DOCUMENT).success).toBe(true);
  });

  it.each(Q_WF3)("refuses a document without %s, at questionnaire_answers.<id>, before and at certification", (id) => {
    const { [id]: _gone, ...rest } = ANSWERS;
    const doc = { ...DOCUMENT, questionnaire_answers: rest };
    expect(pathsOf(driverApplicationSchema.safeParse(doc))).toEqual([`questionnaire_answers.${id}`]);
    expect(pathsOf(applicationBeforeCertificationSchema.safeParse(doc))).toEqual([`questionnaire_answers.${id}`]);
    // The rule's own path — the one the wizard reports — is the same path.
    const rule = APPLICATION_CROSS_FIELD_RULES.find((r) => r.at?.[0] === id)!;
    expect(ruleIssuePath(rule)).toEqual(["questionnaire_answers", id]);
  });

  it("refuses all seven when nothing at all was answered, the blank send the audit measured", () => {
    const doc = { ...DOCUMENT, questionnaire_version: null, questionnaire_answers: null };
    expect(pathsOf(driverApplicationSchema.safeParse(doc)).sort()).toEqual(Q_WF3.map((id) => `questionnaire_answers.${id}`).sort());
  });

  it("counts a blank string and an empty grid as not answered", () => {
    const doc = { ...DOCUMENT, questionnaire_answers: { ...ANSWERS, position: "  ", education: [] } };
    expect(pathsOf(driverApplicationSchema.safeParse(doc)).sort()).toEqual(["questionnaire_answers.education", "questionnaire_answers.position"]);
  });

  it("judges an answer set given against v2 by v2, which required nothing", () => {
    const doc = { ...DOCUMENT, questionnaire_version: "silvicom_driver@v2", questionnaire_answers: { position: "Driver" } };
    expect(driverApplicationSchema.safeParse(doc).success).toBe(true);
  });

  it("fires on a body that leaves both questionnaire keys out — a crafted request is refused too", () => {
    const { questionnaire_version: _v, questionnaire_answers: _a, ...bare } = DOCUMENT;
    expect(pathsOf(driverApplicationSchema.safeParse(bare))).toHaveLength(7);
    expect(APPLICATION_CROSS_FIELD_RULES.filter((r) => r.path === "questionnaire_answers")).toHaveLength(7);
  });

  it("leaves a draft with old, unfinished answers savable — the draft is refused nothing", () => {
    const draft = { first_name: "Susan", questionnaire: { position: "Driver ", heard_from: "George" } };
    expect(applicationDraftPayloadSchema.safeParse(draft).success).toBe(true);
  });

  it("sends each refusal to the screen its question is asked on", () => {
    expect(sectionOwningPath(["questionnaire_answers", "position"])).toBe("identity");
    expect(sectionOwningPath(["questionnaire_answers", "may_contact_employers"])).toBe("employment");
    expect(sectionOwningPath(["questionnaire_answers", "education"])).toBe("questions");
    expect(sectionOwningPath(["employers", 0, "employer_name"])).toBe("employment");
  });
});

describe("the questionnaire answers on the API (§9 P8, AF-1)", () => {
  it("are parsed by the questionnaire's schema, not taken as any record", () => {
    const doc = { ...DOCUMENT, questionnaire_answers: { ...ANSWERS, legally_work: "maybe" } };
    expect(pathsOf(driverApplicationSchema.safeParse(doc))).toContain("questionnaire_answers.legally_work");
  });

  it("take an optional question's skip, and refuse it on a required one", () => {
    const skipped = { ...ANSWERS, military_service: "I'd rather not say", other_training: "Doesn't apply", references: "I'd rather not say" };
    expect(driverApplicationSchema.safeParse({ ...DOCUMENT, questionnaire_answers: skipped }).success).toBe(true);
    const onRequired = { ...ANSWERS, legally_work: "I'd rather not say" };
    expect(driverApplicationSchema.safeParse({ ...DOCUMENT, questionnaire_answers: onRequired }).success).toBe(false);
  });
});

describe("a skipped answer, in words", () => {
  it("reads as the skip's label — never as an unanswered box or a no", () => {
    const military = SERVED.questions.find((q) => q.id === "military_service")!;
    expect(choiceLabel(military, "I'd rather not say")).toBe("I'd rather not say");
    expect(choiceLabel(military, false)).toBe(false);
  });

  it("is counted as answered, and a question not asked is not counted at all", () => {
    expect(questionnaireProgress(SERVED, "questions", {})).toEqual({ answered: 0, total: 4 });
    expect(questionnaireProgress(SERVED, "questions", { military_service: true })).toEqual({ answered: 1, total: 5 });
    expect(questionnaireProgress(SERVED, "questions", { military_service: "I'd rather not say", references: "I'd rather not say" }))
      .toEqual({ answered: 2, total: 4 });
  });
});
