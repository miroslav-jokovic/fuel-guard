import { describe, expect, it } from "vitest";
import {
  answersToStamp,
  carrierAnswerIssues,
  carrierQuestionCreateSchema,
  carrierQuestionnaire,
  carrierQuestionsToStamp,
  carrierStampOf,
  CARRIER_QUESTION_KINDS,
  type CarrierQuestion,
  type CarrierQuestionStampItem,
} from "./carrierQuestionsContract.js";
import { RATHER_NOT_SAY } from "./questionnaireContract.js";

/** HIRING-WORKFLOW-AUDIT-2026-10-31 §15.3 — the carrier's own questions (D-CQ1..D-CQ5). */

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";
const TERMINAL: CarrierQuestionStampItem = {
  id: ID1, wording: "Which terminal would you report to?", hint: null, kind: "select", choices: ["Melrose Park", "Joliet"], required: true,
};
const START: CarrierQuestionStampItem = { id: ID2, wording: "Can you start within two weeks?", hint: "Most do", kind: "boolean", choices: null, required: false };
const MILES: CarrierQuestionStampItem = { id: ID3, wording: "How many miles last year?", hint: null, kind: "number", choices: null, required: false };
const STAMP = [TERMINAL, START, MILES];

describe("the kinds a carrier may ask", () => {
  it("are the questionnaire's own, less the grid", () => {
    expect(CARRIER_QUESTION_KINDS).toEqual(["text", "longtext", "boolean", "select", "date", "number"]);
  });

  // Compared with 0567's `kind in (…)` in `apps/api/src/modules/recruiting/carrierQuestions.test.ts`: this
  // package has no Node types to read a migration with.
});

describe("a new question", () => {
  it("needs at least two different choices when it is one of a list", () => {
    expect(carrierQuestionCreateSchema.safeParse({ wording: "Pick", kind: "select", choices: ["One"] }).success).toBe(false);
    expect(carrierQuestionCreateSchema.safeParse({ wording: "Pick", kind: "select", choices: ["One", "One"] }).success).toBe(false);
    expect(carrierQuestionCreateSchema.safeParse({ wording: "Pick", kind: "select", choices: ["One", "Two"] }).success).toBe(true);
  });

  it("takes no choices of any other kind, and a blank hint is none", () => {
    expect(carrierQuestionCreateSchema.safeParse({ wording: "Name", kind: "text", choices: ["a", "b"] }).success).toBe(false);
    const ok = carrierQuestionCreateSchema.parse({ wording: "  Name  ", kind: "text", hint: "  " });
    expect(ok).toEqual({ wording: "Name", hint: null, kind: "text", choices: null, required: false });
  });

  it("refuses the grid", () => {
    expect(carrierQuestionCreateSchema.safeParse({ wording: "References", kind: "table" }).success).toBe(false);
  });
});

describe("the stamp at Send (D-CQ2)", () => {
  const row = (over: Partial<CarrierQuestion>): CarrierQuestion => ({
    id: ID1, wording: "W", hint: null, kind: "text", choices: null, required: false, position: 0, created_at: "t", retired_at: null, ...over,
  });

  it("copies the live list in order, with what each asks and whether it is required", () => {
    expect(carrierQuestionsToStamp([row({ id: ID2, required: true }), row({ id: ID1, retired_at: "t" })])).toEqual([
      { id: ID2, wording: "W", hint: null, kind: "text", choices: null, required: true },
    ]);
  });

  it("reads a malformed stored stamp as no questions rather than throwing", () => {
    expect(carrierStampOf({ nope: 1 })).toEqual([]);
    expect(carrierStampOf(null)).toEqual([]);
    expect(carrierStampOf(STAMP)).toEqual(STAMP);
  });
});

describe("the stamp as a questionnaire (D-CQ3)", () => {
  it("keeps the carrier's words, hint and choices, and offers optional ones the built-in skip", () => {
    const [terminal, start] = carrierQuestionnaire(STAMP).questions;
    expect(terminal).toMatchObject({ id: ID1, label: TERMINAL.wording, kind: "select", required: true,
      choices: [{ value: "Melrose Park", label: "Melrose Park" }, { value: "Joliet", label: "Joliet" }] });
    expect(terminal!.skip).toBeUndefined();
    expect(start).toMatchObject({ id: ID2, hint: "Most do", skip: RATHER_NOT_SAY });
    expect(start!.required).toBeUndefined();
  });
});

describe("checking the answers against the stamp", () => {
  it("asks for a required answer, and nothing more", () => {
    expect(carrierAnswerIssues(STAMP, {})).toEqual([
      { path: ["carrier_answers", ID1], message: `Answer the question "${TERMINAL.wording}"` },
    ]);
    expect(carrierAnswerIssues(STAMP, { [ID1]: "Joliet" })).toEqual([]);
  });

  it("refuses a choice that is not one of the question's own", () => {
    expect(carrierAnswerIssues(STAMP, { [ID1]: "Gary" })).toHaveLength(1);
  });

  it("refuses the wrong kind of answer", () => {
    expect(carrierAnswerIssues(STAMP, { [ID1]: "Joliet", [ID2]: "maybe" })).toHaveLength(1);
    expect(carrierAnswerIssues(STAMP, { [ID1]: "Joliet", [ID3]: "lots" })).toHaveLength(1);
  });

  it("takes \"I'd rather not say\" on an optional question and never on a required one", () => {
    expect(carrierAnswerIssues(STAMP, { [ID1]: "Joliet", [ID2]: RATHER_NOT_SAY.value })).toEqual([]);
    expect(carrierAnswerIssues(STAMP, { [ID1]: RATHER_NOT_SAY.value })).toHaveLength(1);
  });

  it("asks nothing of an application with no stamp", () => {
    expect(carrierAnswerIssues(null, { anything: 1 })).toEqual([]);
    expect(carrierAnswerIssues([], {})).toEqual([]);
  });

  it("files only answers to the stamp's own questions", () => {
    expect(answersToStamp(STAMP, { [ID1]: "Joliet", stranger: "x", [ID3]: "" })).toEqual({ [ID1]: "Joliet" });
    expect(answersToStamp(STAMP, {})).toBeNull();
  });
});
