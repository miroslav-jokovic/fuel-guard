import { describe, expect, it } from "vitest";
import { META_CONTACT_TYPES, META_FORBIDDEN_QUESTION_TYPES, META_FORM_CATALOGUE, META_FORM_MAX_QUESTIONS, metaLeadFormQuestions } from "./metaLeadForm.js";

describe("metaLeadForm — what an employment Instant Form may ask", () => {
  it("contact comes from Meta's prefilled types, then the catalogue's questions in the brief's order", () => {
    const r = metaLeadFormQuestions(["hazmat_endorsement", "class_a_held"], "en");
    expect(r.ok && r.questions.map((q) => [q.type, q.key])).toEqual([
      ["FULL_NAME", "full_name"], ["PHONE", "phone"], ["EMAIL", "email"], ["CUSTOM", "hazmat_endorsement"], ["CUSTOM", "class_a_held"],
    ]);
    expect(r.ok && r.locale).toBe("EN_US");
  });

  it("a key outside the counsel fallback catalogue is refused, never passed through as free text", () => {
    for (const k of ["age", "date_of_birth", "criminal_history", "dl_number", "zip", "marital_status", "drug_test"]) {
      expect(metaLeadFormQuestions(["class_a_held", k], "en")).toEqual({ ok: false, refused: [k] });
    }
  });

  it("no output of any catalogue subset carries a prohibited question type, and age is never asked", () => {
    const keys = Object.keys(META_FORM_CATALOGUE);
    for (let mask = 0; mask < 1 << keys.length; mask++) {
      for (const locale of ["en", "es"] as const) {
        const r = metaLeadFormQuestions(keys.filter((_, i) => mask & (1 << i)), locale);
        if (!r.ok) throw new Error("catalogue subset refused");
        for (const q of r.questions) {
          expect(META_FORBIDDEN_QUESTION_TYPES as readonly string[]).not.toContain(q.type);
          expect(`${q.key} ${q.label ?? ""}`).not.toMatch(/\bage\b|birth|edad|nacimiento|gender|zip|criminal|arrest|licen[cs]e number|health/i);
        }
      }
    }
  });

  it("Spanish asks the same questions with the same option keys, in Spanish", () => {
    const en = metaLeadFormQuestions(["class_a_years"], "en");
    const es = metaLeadFormQuestions(["class_a_years"], "es");
    if (!en.ok || !es.ok) throw new Error("refused");
    expect(es.locale).toBe("ES_LA");
    expect(es.questions.map((q) => [q.key, q.options?.map((o) => o.key)])).toEqual(en.questions.map((q) => [q.key, q.options?.map((o) => o.key)]));
    expect(es.questions[3]!.label).toMatch(/años/);
  });

  it("refuses a duplicate question and a form over Meta's 15-question limit", () => {
    expect(metaLeadFormQuestions(["class_a_held", "class_a_held"], "en")).toEqual({ ok: false, refused: ["duplicate_question"] });
    expect(META_FORM_MAX_QUESTIONS - META_CONTACT_TYPES.length).toBeGreaterThanOrEqual(Object.keys(META_FORM_CATALOGUE).length);
  });
});
