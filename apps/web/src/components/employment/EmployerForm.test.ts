import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import EmployerForm from "./EmployerForm.vue";
import { blankEmployer, type EmployerFields } from "./employerRow";
import { EMPLOYMENT_FORM_COPY, EMPLOYMENT_OFFICE_COPY, type EmploymentFormCopy } from "./employmentCopy";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The ONE employer form (HW5b, HIRING-WORKFLOW-AUDIT-2026-10-31 §4.5, EM-3/EM-5/EM-10).
 *
 * What is pinned: the same boxes with the same defaults whoever mounts it (the applicant's words, the
 * office's words); the DOT question asked, not tucked away; the (iv) questions appearing for a job in
 * the three years and STAYING once seen or answered; the street present; and — moved here from
 * `EmployerQuestions.test.ts` — the (iv) wording held against §391.21 as committed
 * (docs/plans/recruitment/cfr-391-21/391.21.txt).
 */
const ASOF = "2026-09-26"; // the (b)(10) window opens 09/26/2023
const HERE = dirname(fileURLToPath(import.meta.url));
const s391_21 = readFileSync(join(HERE, "../../../../../docs/plans/recruitment/cfr-391-21/391.21.txt"), "utf8")
  .replace(/\s+/g, " ");

const form = (employer: EmployerFields, copy: EmploymentFormCopy = EMPLOYMENT_FORM_COPY, idPrefix = "apply-employers-2") => {
  const model = { value: employer };
  const w = mount(EmployerForm, {
    props: {
      modelValue: employer,
      copy,
      idPrefix,
      asOf: ASOF,
      "onUpdate:modelValue": (v: EmployerFields) => {
        model.value = v;
        void w.setProps({ modelValue: v });
      },
    },
  });
  return { w, model };
};

/** Every control's field name, in document order — inputs and the yes/no groups. */
const fieldsOf = (w: ReturnType<typeof form>["w"], prefix: string): string[] =>
  w.findAll(`input[id^='${prefix}-'], fieldset[id^='${prefix}-']`).map((el) => el.attributes("id")!.slice(prefix.length + 1));

describe("one form for everyone (HW5b, EM-5)", () => {
  it("asks the same things, in the same order, of the applicant and of the office", () => {
    const applicant = fieldsOf(form(blankEmployer(), APPLY_COPY.employment, "apply-employers-0").w, "apply-employers-0");
    const office = fieldsOf(form(blankEmployer(), EMPLOYMENT_OFFICE_COPY, "office-employer").w, "office-employer");
    expect(applicant).toEqual(office);
    expect(applicant).toEqual([
      "employer_name", "started_on", "ended_on", "position_held", "address_line1", "city", "state",
      "reason_for_leaving", "operated_cmv", "dot_regulated", "phone", "email", "usdot_number",
    ]);
  });

  it("starts a new job at the applicant's defaults: drove a truck Yes, DOT-regulated Yes, the (iv) answers unanswered", () => {
    const fresh = blankEmployer();
    expect([fresh.operated_cmv, fresh.dot_regulated, fresh.subject_to_fmcsr, fresh.safety_sensitive]).toEqual([true, true, null, null]);
    const { w } = form(fresh);
    const checked = (id: string) =>
      w.find(`fieldset#apply-employers-2-${id}`).findAll("input[type=radio]").map((r) => (r.element as HTMLInputElement).checked);
    expect(checked("operated_cmv")).toEqual([true, false]);
    expect(checked("dot_regulated")).toEqual([true, false]);
  });

  it("EM-3: has a street box", () => {
    expect(form(blankEmployer(), EMPLOYMENT_OFFICE_COPY, "office-employer").w.find("input#office-employer-address_line1").exists()).toBe(true);
  });
});

describe("the DOT question (EM-10)", () => {
  it("is asked in the main run, not behind the optional disclosure", () => {
    const { w } = form(blankEmployer());
    const group = w.find("fieldset#apply-employers-2-dot_regulated");
    expect(group.exists()).toBe(true);
    expect(w.find("details").element.contains(group.element)).toBe(false);
    expect(w.text()).toContain(EMPLOYMENT_FORM_COPY.dotQuestion);
  });

  it("records a No as false", async () => {
    const { w, model } = form(blankEmployer());
    await w.find("fieldset#apply-employers-2-dot_regulated").findAll("input[type=radio]")[1]!.setValue(true);
    expect(model.value.dot_regulated).toBe(false);
  });
});

describe("the two (b)(10)(iv) questions — the form never changes shape behind the cursor", () => {
  const iv = (w: ReturnType<typeof form>["w"]) => w.find("fieldset#apply-employers-2-subject_to_fmcsr").exists();

  it("are not asked of a job before its dates are in, nor of one from years four to ten", () => {
    expect(iv(form(blankEmployer()).w)).toBe(false);
    expect(iv(form({ ...blankEmployer(), started_on: "2018-01-01", ended_on: "2022-06-30" }).w)).toBe(false);
  });

  it("are asked of a job in the last three years, a straddling one included", () => {
    expect(iv(form({ ...blankEmployer(), started_on: "2024-01-01" }).w)).toBe(true);
    expect(iv(form({ ...blankEmployer(), started_on: "2018-01-01", ended_on: "2024-06-30" }).w)).toBe(true);
  });

  it("stay on screen once they have appeared, when a date typed later moves the job out of the three years", async () => {
    const { w } = form({ ...blankEmployer(), started_on: "2024-01-01" });
    expect(iv(w)).toBe(true);
    await w.setProps({ modelValue: { ...(w.props("modelValue") as EmployerFields), started_on: "2018-01-01", ended_on: "2019-01-01" } });
    expect(iv(w)).toBe(true);
  });

  it("stay on screen for an old job whose answers were already given", () => {
    expect(iv(form({ ...blankEmployer(), started_on: "2018-01-01", ended_on: "2019-01-01", subject_to_fmcsr: false }).w)).toBe(true);
  });

  it("start with neither Yes nor No chosen, and record each answer on its own field", async () => {
    const { w, model } = form({ ...blankEmployer(), started_on: "2024-01-01" });
    const groups = ["subject_to_fmcsr", "safety_sensitive"].map((f) => w.find(`fieldset#apply-employers-2-${f}`));
    expect(groups.flatMap((g) => g.findAll("input[type=radio]")).some((r) => (r.element as HTMLInputElement).checked)).toBe(false);
    await groups[0]!.findAll("input[type=radio]")[0]!.setValue(true);
    await w.find("fieldset#apply-employers-2-safety_sensitive").findAll("input[type=radio]")[1]!.setValue(true);
    expect([model.value.subject_to_fmcsr, model.value.safety_sensitive]).toEqual([true, false]);
  });
});

describe("the (b)(10)(iv) questions, against the regulation", () => {
  const copy = APPLY_COPY.employment;
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

  it("asks each as a question, not a statement to tick — on both sides of the desk", () => {
    for (const c of [EMPLOYMENT_FORM_COPY, EMPLOYMENT_OFFICE_COPY]) {
      expect(c.subjectToFmcsr).toMatch(/\?$/);
      expect(c.safetySensitive).toMatch(/\?$/);
      expect(c.droveTruck).toMatch(/\?$/);
      expect(c.dotQuestion).toMatch(/\?$/);
    }
  });
});

describe("on the applicant's phone", () => {
  it("makes each yes/no choice a 48 px row", () => {
    const w = mount(EmployerForm, {
      props: { modelValue: { ...blankEmployer(), started_on: "2024-01-01" }, copy: EMPLOYMENT_FORM_COPY, idPrefix: "p", asOf: ASOF, touch: true },
    });
    const labels = w.findAll("fieldset label");
    expect(labels).toHaveLength(8);
    for (const label of labels) expect(label.classes()).toContain("min-h-12");
  });
});
