import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import EmployerQuestions from "./EmployerQuestions.vue";
import { emptyEmployer, type DraftEmployer } from "./draft";
import { APPLY_COPY } from "./strings";

/**
 * §391.21(b)(10)(iv)'s two questions, asked Yes/No with nothing chosen (C3c2b, Q-AW33), and their
 * wording held against the regulation as fetched from the eCFR and committed
 * (docs/plans/recruitment/cfr-391-21/391.21.txt, current as of 2026-09-24).
 *
 * The screen may not quote the regulation — `strings.test.ts` forbids a citation in anything a driver
 * reads, and "FMCSRs" is not a driver's word — so each question is plain words for the regulation's.
 * What is pinned is the translation: every phrase of (A) and (B) the question depends on is found in
 * the source, and its plain counterpart is found in the question. A question that drifted to asking
 * something else — "were you DOT-regulated", say — loses a counterpart and fails.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const s391_21 = readFileSync(join(HERE, "../../../../../docs/plans/recruitment/cfr-391-21/391.21.txt"), "utf8")
  .replace(/\s+/g, " ");
const copy = APPLY_COPY.employment;

describe("the (b)(10)(iv) questions, against the regulation", () => {
  it("asks (A) — subject to the FMCSRs while employed by that employer — in plain words", () => {
    expect(s391_21).toContain("(iv) After October 29, 2004, whether the (A) Applicant was subject to the FMCSRs while employed by that previous employer");
    for (const [regulation, plain] of [
      ["subject to the FMCSRs", "did the Federal Motor Carrier Safety Regulations apply to you"],
      ["while employed by that previous employer", "In this job"],
    ] as const) {
      expect(s391_21).toContain(regulation);
      expect(copy.subjectToFmcsr).toContain(plain);
    }
  });

  it("asks (B) — a safety-sensitive function in any DOT mode, subject to drug and alcohol testing — in plain words", () => {
    expect(s391_21).toContain("(B) Job was designated as a safety sensitive function in any DOT regulated mode subject to alcohol and controlled substances testing requirements as required by 49 CFR part 40");
    for (const [regulation, plain, where] of [
      ["safety sensitive function", "safety-sensitive job", copy.safetySensitive],
      ["subject to alcohol and controlled substances testing requirements", "required DOT drug and alcohol testing", copy.safetySensitive],
      ["in any DOT regulated mode", "in any industry it regulates", copy.safetySensitiveHint],
    ] as const) {
      expect(s391_21).toContain(regulation);
      expect(where).toContain(plain);
    }
  });

  it("asks each as a question, not a statement to tick", () => {
    expect(copy.subjectToFmcsr).toMatch(/\?$/);
    expect(copy.safetySensitive).toMatch(/\?$/);
  });
});

const mountQuestions = (employer: DraftEmployer, askWhether = true) => {
  const model = { value: employer };
  const w = mount(EmployerQuestions, {
    props: {
      modelValue: employer,
      index: 2,
      askWhether,
      "onUpdate:modelValue": (v: DraftEmployer) => { model.value = v; },
    },
  });
  return { w, model };
};

describe("asking them", () => {
  it("starts with neither Yes nor No chosen", () => {
    const { w } = mountQuestions(emptyEmployer());
    expect(w.text()).toContain(copy.subjectToFmcsr);
    expect(w.text()).toContain(copy.safetySensitive);
    const radios = w.findAll('input[type="radio"]');
    expect(radios).toHaveLength(4);
    expect(radios.some((r) => (r.element as HTMLInputElement).checked)).toBe(false);
  });

  it("records each answer on its own field", async () => {
    const employer = emptyEmployer();
    const { w } = mountQuestions(employer);
    const groups = w.findAll("fieldset");
    await groups[0]!.findAll('input[type="radio"]')[0]!.setValue(true); // (A) Yes
    await groups[1]!.findAll('input[type="radio"]')[1]!.setValue(true); // (B) No
    expect(employer.subject_to_fmcsr).toBe(true);
    expect(employer.safety_sensitive).toBe(false);
  });

  it("gives each group the id a refusal focuses", () => {
    const { w } = mountQuestions(emptyEmployer());
    expect(w.find("fieldset#apply-employers-2-subject_to_fmcsr").exists()).toBe(true);
    expect(w.find("fieldset#apply-employers-2-safety_sensitive").exists()).toBe(true);
  });

  it("asks neither when the job is not one of the last three years', and still asks about the CMV", () => {
    const { w } = mountQuestions(emptyEmployer(), false);
    expect(w.findAll('input[type="radio"]')).toHaveLength(0);
    expect(w.text()).toContain(copy.operatedCmv);
  });

  it("makes each choice a 44 px row — the Yes/No answers and the CMV box alike", () => {
    const { w } = mountQuestions(emptyEmployer());
    const labels = w.findAll("label");
    expect(labels).toHaveLength(5);
    for (const label of labels) expect(label.classes()).toContain("min-h-11");
  });
});
