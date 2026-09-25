import { describe, it, expect } from "vitest";
import {
  EEO_ANSWER_KEY,
  QUESTION_KINDS,
  SILVICOM_DRIVER_V1,
  questionnaireAnswersSchema,
  questionnaireByRef,
  questionnaireForApplicant,
  questionnaireRef,
  questionsForScreen,
  readableAnswers,
  APPLYING_AS_QUESTION_ID,
  SILVICOM_DRIVER_V2,
  applyingAsOf,
  choiceLabel,
  questionnaireAnswersOf,
} from "./questionnaireContract.js";
import { APPLICATION_SECTION_ORDER } from "./applicationSections.js";
import { driverApplicationSchema } from "./applicationContract.js";
import { planApplicationIntake } from "./applicationIntake.js";

/**
 * The carrier's questions (A9, D-APP12).
 *
 * Two things are worth pinning and they pull in opposite directions. The definition has to be a
 * faithful transcription of a piece of paper — so it is checked for shape, not for prose. And the
 * answers have to stay exactly where they are put: `payload`, and nowhere else. The second half is
 * the one that would fail silently, so it is tested against the real projection rather than by
 * reading the code.
 */

describe("the definition", () => {
  it.each([SILVICOM_DRIVER_V1, SILVICOM_DRIVER_V2])("is internally coherent — every question usable by a screen that renders it ($version)", (def) => {
    const seen = new Set<string>();
    for (const q of def.questions) {
      expect(QUESTION_KINDS as readonly string[]).toContain(q.kind);
      expect(q.label, q.id).toBeTruthy();
      // Ids are what the answers are keyed by; a duplicate would silently overwrite an answer.
      expect(seen.has(q.id), `duplicate question id ${q.id}`).toBe(false);
      seen.add(q.id);
      if (q.kind === "select") expect((q.options ?? q.choices)?.length, q.id).toBeGreaterThan(0);
      if (q.kind === "table") {
        expect(q.columns?.length, q.id).toBeGreaterThan(0);
        const cols = new Set<string>();
        for (const c of q.columns ?? []) {
          expect(cols.has(c.id), `duplicate column ${q.id}.${c.id}`).toBe(false);
          cols.add(c.id);
          if (c.kind === "select") expect(c.options?.length, c.id).toBeGreaterThan(0);
        }
      }
    }
  });

  /** §6.1's pile 2, item by item — the transcription is the step, so its completeness is the test. */
  it("carries every question the owner's packet actually asks", () => {
    const ids = SILVICOM_DRIVER_V1.questions.map((q) => q.id);
    expect(ids).toEqual([
      "position",
      "heard_from",
      "legally_work",
      "proof_of_age",
      "may_contact_employers",
      "education",
      "military_service",
      "military_when",
      "other_training",
      "references",
    ]);
  });

  /** The packet asks for three, and says why they may not be relatives or former supervisors. */
  it("asks for three references", () => {
    expect(SILVICOM_DRIVER_V1.questions.find((q) => q.id === "references")?.maxRows).toBe(3);
  });

  /**
   * ⚠ The driving-experience grid was here and is not any more. It is §391.21(b)(6) — the paragraph
   * requires "the type of equipment ... which he/she has operated", and FMCSA's own sample
   * application lays it out as exactly that grid — so it lives in `driverApplicationSchema` as
   * `equipment_experience`. A regulated answer sitting in a blob D-APP12 projects nowhere is not what
   * §391.51 wants to find.
   */
  it("does not ask for driving experience, which is the regulation's question and not the carrier's", () => {
    expect(SILVICOM_DRIVER_V1.questions.map((q) => q.id)).not.toContain("driving_experience");
  });

  it("is addressed by id and version, so an answer set can find its own questions", () => {
    const ref = questionnaireRef(SILVICOM_DRIVER_V1);
    expect(ref).toBe("silvicom_driver@v1");
    expect(questionnaireByRef(ref)).toBe(SILVICOM_DRIVER_V1);
    // ⚠ v1 stays addressable after v2 is served: answer sets filed against it still name it.
    expect(questionnaireByRef("silvicom_driver@v2")).toBe(SILVICOM_DRIVER_V2);
    expect(questionnaireForApplicant()).toBe(SILVICOM_DRIVER_V2);
  });

  it("changes nothing in v2 but the one question Q-HM14 added", () => {
    const v2 = SILVICOM_DRIVER_V2.questions.filter((q) => q.id !== APPLYING_AS_QUESTION_ID);
    expect(v2).toEqual(SILVICOM_DRIVER_V1.questions);
    expect(questionsForScreen(SILVICOM_DRIVER_V2, "identity").map((q) => q.id)).toEqual([
      "position", "applying_as", "heard_from", "legally_work", "proof_of_age",
    ]);
  });

  /**
   * `payload` is historical jsonb. A document filed against a definition this build no longer carries
   * must still render — the rule `render.ts` applies to every other field it reads.
   */
  it("returns null for a version nobody has ever served, rather than throwing", () => {
    expect(questionnaireByRef("silvicom_driver@v99")).toBeNull();
    expect(questionnaireByRef(null)).toBeNull();
  });
});

describe("the answers", () => {
  const schema = questionnaireAnswersSchema(SILVICOM_DRIVER_V1);

  it("accepts a filled-in set", () => {
    const parsed = schema.safeParse({
      position: "Company driver",
      legally_work: true,
      may_contact_employers: true,
      references: [{ full_name: "Ann Reyes", years_known: 6, phone: "555-0134" }],
    });
    expect(parsed.success).toBe(true);
  });

  /**
   * Everything is nullish, and that is the decision rather than an oversight: the questionnaire is
   * answered inside the §391.21 flow, and a carrier's own question must never be the thing that stops
   * a federally-required application being sent — the same reasoning that leaves
   * `APPLICATION_CAPTURE_REQUIRED` empty. See the contract's note on why there is no `required` flag.
   */
  it("accepts an empty set, because a carrier's question is not worth a lost candidate", () => {
    expect(schema.safeParse({}).success).toBe(true);
  });

  /** The whole document, with nothing answered — the client and the server agree exactly here. */
  it("does not make the application itself refusable", () => {
    const withNoAnswers = driverApplicationSchema.safeParse({
      first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
      email: "s@example.test", phone: "555-0111",
      addresses: [{ line1: "1 Road", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: null }],
      cdl_number: "PA334554", cdl_state: "PA", cdl_expires_at: "2029-01-01",
      // §391.21(b)(6) is the regulation's own requirement and is answered here; the point of the
      // assertion below is that the CARRIER's questions are what does not make a document refusable.
      experience: "Eight years, dry van and reefer.",
      accidents: [], declares_no_accidents: true,
      violations: [], declares_no_violations: true,
      licence_ever_denied: false,
      employers: [], declares_no_employment: true,
      questionnaire_version: null, questionnaire_answers: null,
      certified: true, signed_name: "Susan Godfrey",
    });
    expect(withNoAnswers.success).toBe(true);
  });

  it("refuses a table longer than the paper asks for", () => {
    const four = Array.from({ length: 4 }, () => ({ full_name: "X", years_known: 1, phone: "5" }));
    expect(schema.safeParse({ references: four }).success).toBe(false);
  });

  /**
   * A stored `select` answer is displayed beside the question that produced it and never matched on,
   * so an option that a later version dropped must still parse.
   */
  it("does not narrow a stored select answer to today's options", () => {
    const parsed = schema.safeParse({
      education: [{ school: "A school", graduated: true, graduated_when: "1999" }],
    });
    expect(parsed.success).toBe(true);
  });
});

/**
 * D-APP12, as the assertions that would actually catch a regression.
 *
 * The rule reads "the answers are projected nowhere", and the inverse of 2026-08-20's lesson applies:
 * a projection can silently DROP a field the contract collects, and here nothing must project one at
 * all. So this runs the real projection over a real application and looks for the answers in what
 * comes out.
 */
describe("questionnaire answers are projected nowhere", () => {
  const APPLICATION = driverApplicationSchema.parse({
    first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
    email: "s@example.test", phone: "555-0111",
    addresses: [{ line1: "1 Road", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: null }],
    cdl_number: "PA334554", cdl_state: "PA", cdl_expires_at: "2029-01-01",
    experience: "Eight years, dry van and reefer.",
    accidents: [], declares_no_accidents: true,
    violations: [], declares_no_violations: true,
    licence_ever_denied: false,
    employers: [], declares_no_employment: true,
    questionnaire_version: "silvicom_driver@v1",
    questionnaire_answers: {
      position: "UNIQUE-POSITION-STRING",
      heard_from: "UNIQUE-HEARD-STRING",
      [EEO_ANSWER_KEY]: { race: "UNIQUE-EEO-STRING" },
    },
    certified: true, signed_name: "Susan Godfrey",
  });

  it("keeps them out of the driver patch and the employment rows", () => {
    const { driverPatch, employment } = planApplicationIntake(APPLICATION);
    const projected = JSON.stringify({ driverPatch, employment });
    expect(projected).not.toContain("UNIQUE-POSITION-STRING");
    expect(projected).not.toContain("UNIQUE-HEARD-STRING");
    expect(projected).not.toContain("questionnaire");
  });

  /** Voluntary self-identification must not be visible to the person deciding the hire. */
  it("hides the reserved EEO key from anything that reads answers", () => {
    const readable = readableAnswers(APPLICATION.questionnaire_answers as Record<string, unknown>);
    expect(readable.position).toBe("UNIQUE-POSITION-STRING");
    expect(EEO_ANSWER_KEY in readable).toBe(false);
    expect(JSON.stringify(readable)).not.toContain("UNIQUE-EEO-STRING");
  });

  it("survives an application that answered nothing at all", () => {
    expect(readableAnswers(null)).toEqual({});
    expect(readableAnswers(undefined)).toEqual({});
  });
});

/**
 * Where each question is asked (D-AX7).
 *
 * ⚠ The last assertion is the one that matters: every question has exactly one home. A typo in a
 * `screen` value would otherwise put a question on a screen nothing renders, and it would vanish from
 * the form with no error anywhere — the same silent-drop shape as the `location`/`state` defect that
 * filed every traffic conviction with no place attached.
 */
describe("which screen a carrier question is asked on", () => {
  it("puts the workbook's page-1 questions on the first screen", () => {
    expect(questionsForScreen(SILVICOM_DRIVER_V1, "identity").map((q) => q.id)).toEqual([
      "position",
      "heard_from",
      "legally_work",
      "proof_of_age",
    ]);
  });

  it("asks about contacting employers where the employers are listed", () => {
    // The one deliberate departure from the paper, which has it on page 1.
    expect(questionsForScreen(SILVICOM_DRIVER_V1, "employment").map((q) => q.id)).toEqual([
      "may_contact_employers",
    ]);
  });

  it("leaves the workbook's page-16 questions on the carrier's own screen", () => {
    expect(questionsForScreen(SILVICOM_DRIVER_V1, "questions").map((q) => q.id)).toEqual([
      "education",
      "military_service",
      "military_when",
      "other_training",
      "references",
    ]);
  });

  it("defaults a question that says nothing to the carrier's own screen", () => {
    const def = {
      ...SILVICOM_DRIVER_V1,
      questions: [{ id: "anything", label: "Anything", kind: "text" as const }],
    };
    expect(questionsForScreen(def, "questions").map((q) => q.id)).toEqual(["anything"]);
    expect(questionsForScreen(def, "identity")).toEqual([]);
  });

  it("gives every question exactly one home, so none can be lost to a typo", () => {
    const homes = APPLICATION_SECTION_ORDER.flatMap((section) =>
      questionsForScreen(SILVICOM_DRIVER_V1, section).map((q) => q.id),
    );
    expect([...homes].sort()).toEqual([...SILVICOM_DRIVER_V1.questions.map((q) => q.id)].sort());
    expect(new Set(homes).size).toBe(homes.length);
  });
});

/**
 * Q-HM14 (ruled (b), 2026-09-24): the one questionnaire answer that DECIDES something — which lines
 * of page 31 the applicant signs and which reason page 22 carries. So it is the one answer stored as
 * a key and narrowed by the schema, and the one read the same way from a draft and a filed payload.
 */
describe("what the applicant is applying as", () => {
  const question = SILVICOM_DRIVER_V2.questions.find((q) => q.id === APPLYING_AS_QUESTION_ID)!;
  const schema = questionnaireAnswersSchema(SILVICOM_DRIVER_V2);

  it("stores a key and refuses anything else, where a plain select stores whatever it was given", () => {
    expect(schema.safeParse({ applying_as: "owner_operator" }).success).toBe(true);
    expect(schema.safeParse({ applying_as: "company_driver" }).success).toBe(true);
    expect(schema.safeParse({ applying_as: null }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ applying_as: "Owner-operator" }).success).toBe(false);
    expect(schema.safeParse({ applying_as: "both" }).success).toBe(false);
  });

  it("reads the same answer from a draft's `questionnaire` and a filed `questionnaire_answers`", () => {
    expect(applyingAsOf({ questionnaire: { applying_as: "company_driver" } })).toBe("company_driver");
    expect(applyingAsOf({ questionnaire_answers: { applying_as: "owner_operator" } })).toBe("owner_operator");
    // The filed key wins when both are present — it is what was certified.
    expect(
      applyingAsOf({ questionnaire_answers: { applying_as: "owner_operator" }, questionnaire: { applying_as: "company_driver" } }),
    ).toBe("owner_operator");
    expect(questionnaireAnswersOf({ questionnaire: { position: "Driver" } })).toEqual({ position: "Driver" });
  });

  it("reads no answer as null, never as a guess", () => {
    expect(applyingAsOf({})).toBeNull();
    expect(applyingAsOf(null)).toBeNull();
    expect(applyingAsOf({ questionnaire_answers: null })).toBeNull();
    expect(applyingAsOf({ questionnaire_answers: { position: "Owner operator" } })).toBeNull();
    expect(applyingAsOf({ questionnaire_answers: { applying_as: "Owner-operator" } })).toBeNull();
  });

  it("shows a person the label, and every other answer unchanged", () => {
    expect(choiceLabel(question, "owner_operator")).toBe("Owner-operator");
    expect(choiceLabel(question, "company_driver")).toBe("Company driver");
    const position = SILVICOM_DRIVER_V2.questions.find((q) => q.id === "position")!;
    expect(choiceLabel(position, "Driver")).toBe("Driver");
    expect(choiceLabel(position, true)).toBe(true);
  });
});
