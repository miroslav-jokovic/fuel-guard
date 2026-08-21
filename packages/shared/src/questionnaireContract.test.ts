import { describe, it, expect } from "vitest";
import {
  EEO_ANSWER_KEY,
  QUESTION_KINDS,
  SILVICOM_DRIVER_V1,
  questionnaireAnswersSchema,
  questionnaireByRef,
  questionnaireForApplicant,
  questionnaireRef,
  readableAnswers,
} from "./questionnaireContract.js";
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
  it("is internally coherent — every question usable by a screen that renders it", () => {
    const seen = new Set<string>();
    for (const q of SILVICOM_DRIVER_V1.questions) {
      expect(QUESTION_KINDS as readonly string[]).toContain(q.kind);
      expect(q.label, q.id).toBeTruthy();
      // Ids are what the answers are keyed by; a duplicate would silently overwrite an answer.
      expect(seen.has(q.id), `duplicate question id ${q.id}`).toBe(false);
      seen.add(q.id);
      if (q.kind === "select") expect(q.options?.length, q.id).toBeGreaterThan(0);
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
      "driving_experience",
      "education",
      "military_service",
      "military_when",
      "other_training",
      "references",
    ]);
  });

  /** The packet asks for three, and says why they may not be relatives or former supervisors. */
  it("asks for three references and the four classes of equipment the packet lists", () => {
    const refs = SILVICOM_DRIVER_V1.questions.find((q) => q.id === "references");
    expect(refs?.maxRows).toBe(3);
    const grid = SILVICOM_DRIVER_V1.questions.find((q) => q.id === "driving_experience");
    const classes = grid?.columns?.find((c) => c.id === "equipment_class")?.options;
    expect(classes).toHaveLength(4);
    expect(classes?.[0]).toBe("Straight truck");
  });

  it("is addressed by id and version, so an answer set can find its own questions", () => {
    const ref = questionnaireRef(SILVICOM_DRIVER_V1);
    expect(ref).toBe("silvicom_driver@v1");
    expect(questionnaireByRef(ref)).toBe(SILVICOM_DRIVER_V1);
    expect(questionnaireForApplicant()).toBe(SILVICOM_DRIVER_V1);
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
      driving_experience: [
        { equipment_class: "Straight truck", equipment_type: "Van", from: "2019-01-01", to: "2021-06-01", approx_miles: 180000 },
      ],
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
      driving_experience: [{ equipment_class: "A class this version no longer offers" }],
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
