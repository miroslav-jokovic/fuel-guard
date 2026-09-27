import { describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import SafetyHistoryFields from "./SafetyHistoryFields.vue";
import { provideApplyIssues } from "./issues";
import { emptyAccident, emptyDraft, type ApplicationDraft } from "./draft";
import { fieldId } from "./fieldLabels";
import type { SectionIssue } from "./useApplicationWizard";
import { APPLY_COPY } from "./strings";

/**
 * The driving record, yes/no gates first and the lists only on Yes (C3c2c1, §6.4 item 6).
 *
 * The gates are plain words for (b)(7), (b)(8) and (b)(9), each held against the regulation as fetched
 * from the eCFR and committed (docs/plans/recruitment/cfr-391-21/391.21.txt, as of 2026-09-24): every
 * phrase the question depends on is found in the source, and its plain counterpart in the question.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const s391_21 = readFileSync(join(HERE, "../../../../../docs/plans/recruitment/cfr-391-21/391.21.txt"), "utf8")
  .replace(/\s+/g, " ");
const copy = APPLY_COPY.safety;

describe("the three questions, against the regulation", () => {
  it("(b)(7): any accident the driver was involved in, in 3 years", () => {
    expect(s391_21).toContain("all motor vehicle accidents in which the applicant was involved during the 3 years");
    for (const plain of ["In the last 3 years", "were you involved in", "motor vehicle accident"]) {
      expect(copy.accidentsQuestion).toContain(plain);
    }
  });

  it("(b)(8): convicted, or bond or collateral forfeited, in 3 years — parking excepted", () => {
    expect(s391_21).toContain(
      "violations of motor vehicle laws or ordinances (other than violations involving only parking) of which the applicant was convicted or forfeited bond or collateral during the 3 years",
    );
    for (const plain of ["In the last 3 years", "convicted", "traffic law", "forfeit bond or collateral"]) {
      expect(copy.violationsQuestion).toContain(plain);
    }
    expect(copy.violationsQuestionHint).toContain("Parking");
  });

  it("(b)(9): any licence, permit or privilege ever denied, revoked or suspended — with no time limit", () => {
    expect(s391_21).toContain("any denial, revocation, or suspension of any license, permit, or privilege to operate a motor vehicle");
    for (const plain of ["licence, permit or privilege", "drive a motor vehicle", "denied, revoked or suspended", "ever"]) {
      expect(copy.deniedQuestion).toContain(plain);
    }
    // The paragraph has no window, so the question must not invent one.
    expect(copy.deniedQuestion).not.toMatch(/last \d+ years/);
  });
});

const mountScreen = (over: Partial<ApplicationDraft> = {}, issues: SectionIssue[] = []) => {
  const draft = ref<ApplicationDraft>({ ...emptyDraft(), ...over });
  const w = mount(
    defineComponent({
      setup() {
        provideApplyIssues(ref(issues));
        return () => h(SafetyHistoryFields, {
          modelValue: draft.value,
          "onUpdate:modelValue": (v: ApplicationDraft) => { draft.value = v; },
        });
      },
    }),
  );
  return { w, draft };
};
/** The group for one question, found by its legend. */
const group = (w: ReturnType<typeof mountScreen>["w"], legend: string) =>
  w.findAll("fieldset").find((f) => f.find("legend").text() === legend)!;
const choose = async (w: ReturnType<typeof mountScreen>["w"], legend: string, answer: "yes" | "no") => {
  await group(w, legend).findAll('input[type="radio"]')[answer === "yes" ? 0 : 1]!.setValue(true);
};
const chosen = (w: ReturnType<typeof mountScreen>["w"], legend: string) =>
  group(w, legend).findAll('input[type="radio"]').map((r) => (r.element as HTMLInputElement).checked);

describe("the gates", () => {
  it("start with nothing chosen and no list open", () => {
    const { w } = mountScreen();
    for (const legend of [copy.accidentsQuestion, copy.violationsQuestion, copy.deniedQuestion]) {
      expect(chosen(w, legend)).toEqual([false, false]);
    }
    expect(w.find("#apply-accidents-0-nature").exists()).toBe(false);
    expect(w.find("#apply-violations-0-offence").exists()).toBe(false);
    expect(w.find("#apply-licence_denial_detail").exists()).toBe(false);
    // Nor a way to add one: the list is behind the answer, not beside it.
    expect(w.findAll("button").some((b) => b.text() === copy.addAccident || b.text() === copy.addViolation)).toBe(false);
  });

  it("opens the first accident on Yes", async () => {
    const { w, draft } = mountScreen();
    await choose(w, copy.accidentsQuestion, "yes");
    expect(draft.value.declares_no_accidents).toBe(false);
    expect(draft.value.accidents).toHaveLength(1);
    expect(w.find("#apply-accidents-0-nature").exists()).toBe(true);
  });

  /**
   * A draft from before C3c2c1 can hold both — the old checkbox hid the rows it did not clear. It reads
   * as No (what the driver last said), and a Yes brings the kept accident back rather than a blank.
   */
  it("reads an old 'none' with rows as No, and a Yes brings the kept rows back instead of a blank one", async () => {
    const kept = { ...emptyAccident(), nature: "Rear-ended" };
    const { w, draft } = mountScreen({ declares_no_accidents: true, accidents: [kept] });
    expect(chosen(w, copy.accidentsQuestion)).toEqual([false, true]);
    expect(w.find("#apply-accidents-0-nature").exists()).toBe(false);
    await choose(w, copy.accidentsQuestion, "yes");
    expect(draft.value.accidents).toEqual([kept]);
  });

  it("stays on Yes when the last accident is removed, rather than reading as unanswered", async () => {
    const { w } = mountScreen();
    await choose(w, copy.accidentsQuestion, "yes");
    await w.findAll("button").find((b) => b.text() === copy.remove)!.trigger("click");
    expect(chosen(w, copy.accidentsQuestion)).toEqual([true, false]);
  });

  it("declares none on No, and clears a list it closes — a hidden accident would still be filed", async () => {
    const { w, draft } = mountScreen({ accidents: [{ ...emptyAccident(), nature: "Rear-ended" }] });
    expect(chosen(w, copy.accidentsQuestion)).toEqual([true, false]);
    await choose(w, copy.accidentsQuestion, "no");
    expect(draft.value.declares_no_accidents).toBe(true);
    expect(draft.value.accidents).toEqual([]);
  });

  it("does the same for convictions", async () => {
    const { w, draft } = mountScreen();
    await choose(w, copy.violationsQuestion, "yes");
    expect(draft.value.violations).toHaveLength(1);
    await choose(w, copy.violationsQuestion, "no");
    expect(draft.value.declares_no_violations).toBe(true);
    expect(draft.value.violations).toEqual([]);
  });

  it("reads a saved 'none' back as No", () => {
    const { w } = mountScreen({ declares_no_accidents: true, declares_no_violations: true, licence_ever_denied: false });
    for (const legend of [copy.accidentsQuestion, copy.violationsQuestion, copy.deniedQuestion]) {
      expect(chosen(w, legend)).toEqual([false, true]);
    }
  });

  it("asks what happened only on a (b)(9) Yes, and forgets it on No", async () => {
    const { w, draft } = mountScreen();
    await choose(w, copy.deniedQuestion, "yes");
    expect(draft.value.licence_ever_denied).toBe(true);
    await w.find("#apply-licence_denial_detail").setValue("Unpaid ticket, 2019");
    await choose(w, copy.deniedQuestion, "no");
    expect(draft.value.licence_ever_denied).toBe(false);
    expect(draft.value.licence_denial_detail).toBe("");
    expect(w.find("#apply-licence_denial_detail").exists()).toBe(false);
  });

  it("puts a refusal under the question that answers it, on the control focus moves to", () => {
    const issue = (path: string[]): SectionIssue => ({
      path, key: path[0]!, message: "x", label: "x", say: `say ${path[0]}`, fieldId: fieldId(path), section: "safety",
    });
    const { w } = mountScreen({}, [issue(["accidents"]), issue(["licence_ever_denied"])]);
    expect(group(w, copy.accidentsQuestion).attributes("id")).toBe("apply-accidents");
    expect(group(w, copy.deniedQuestion).attributes("id")).toBe("apply-licence_ever_denied");
    expect(w.text()).toContain("say accidents");
    expect(w.text()).toContain("say licence_ever_denied");
    expect(w.text()).not.toContain("say violations");
  });

  it("makes every choice a 44 px row", () => {
    const { w } = mountScreen();
    for (const label of w.findAll("fieldset label")) expect(label.classes()).toContain("min-h-11");
  });
});
