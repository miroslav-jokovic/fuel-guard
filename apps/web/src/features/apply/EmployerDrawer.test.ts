import { describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import EmployerDrawer from "./EmployerDrawer.vue";
import ApplyEmploymentFields from "./ApplyEmploymentFields.vue";
import { provideApplyIssues } from "./issues";
import { emptyDraft, emptyEmployer, type DraftEmployer } from "./draft";
import { fieldId } from "./fieldLabels";
import type { SectionIssue } from "./useApplicationWizard";
import { APPLY_COPY } from "./strings";

/**
 * One employer per screen on a v2 link (C3c2b, §6.4 item 4, Q-AW33).
 *
 * The panel is kept — it already was one job per screen — and on a v2 link it asks, in §6.4's order,
 * what a v2 filing refuses a job without, and checks it on Save with the filing's own rules. A legacy
 * link keeps the owner's 2026-09-11 panel: three fields, the rest optional.
 *
 * `ASOF` is 09/26/2026, so the (b)(10) window opens 09/26/2023.
 */
const ASOF = "2026-09-26";
const copy = APPLY_COPY.employment;

const SlideOverStub = {
  template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "description"],
};

/** A job in the last three years with everything a v2 filing asks — override to take pieces away. */
const recent = (over: Partial<DraftEmployer> = {}): DraftEmployer => ({
  ...emptyEmployer(),
  employer_name: "Old Carrier", started_on: "2024-01-01", ended_on: "",
  address_line1: "12 Depot Rd", city: "Joliet", state: "IL", reason_for_leaving: "Better route",
  subject_to_fmcsr: true, safety_sensitive: false,
  ...over,
});

const panel = (employer: DraftEmployer | null, v2AsOf: string | null = ASOF) =>
  mount(EmployerDrawer, {
    props: { open: true, index: 0, employer, v2AsOf },
    global: { stubs: { SlideOver: SlideOverStub } },
    attachTo: document.body,
  });

const button = (w: ReturnType<typeof panel>, label: string) =>
  w.findAll("button").find((b) => b.text().trim() === label)!;

/** The panel's controls outside the optional disclosure, in document order, by id. */
const mainRun = (w: ReturnType<typeof panel>): string[] => {
  const details = w.find("details").element;
  return w
    // Controls only: an input, or a question's fieldset — not a hint's `-description` paragraph.
    .findAll("input[id^='apply-employers-0-'], fieldset[id^='apply-employers-0-']")
    .filter((el) => !details.contains(el.element))
    .map((el) => el.attributes("id")!)
    .filter((id, i, all) => all.indexOf(id) === i);
};

describe("a v2 link's panel", () => {
  it("asks, in §6.4's order: name, from, to, address, reason, the two (iv) questions", () => {
    // A saved job whose dates put it in the last three years, so both questions are on screen.
    const w = panel(recent());
    expect(mainRun(w)).toEqual([
      "apply-employers-0-employer_name",
      "apply-employers-0-started_on",
      "apply-employers-0-ended_on",
      "apply-employers-0-address_line1",
      "apply-employers-0-city",
      "apply-employers-0-state",
      "apply-employers-0-reason_for_leaving",
      "apply-employers-0-subject_to_fmcsr",
      "apply-employers-0-safety_sensitive",
    ]);
    // Asked once: nothing the main run asks is repeated inside the disclosure (one id, one box).
    for (const id of ["address_line1", "city", "state", "reason_for_leaving", "subject_to_fmcsr"]) {
      expect(w.findAll(`#apply-employers-0-${id}`), id).toHaveLength(1);
    }
    // Drove a CMV comes last, after the questions, and outside the disclosure.
    const details = w.find("details").element;
    const cmv = w.findAll("label").find((l) => l.text().includes(copy.operatedCmv))!;
    expect(details.contains(cmv.element)).toBe(false);
    const fmcsr = w.find("#apply-employers-0-safety_sensitive").element;
    expect(fmcsr.compareDocumentPosition(cmv.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    w.unmount();
  });

  it("asks the (iv) questions only once the dates put the job in the last three years", async () => {
    const fresh = panel(null);
    expect(fresh.find("#apply-employers-0-subject_to_fmcsr").exists()).toBe(false);
    fresh.unmount();

    const old = panel(recent({ started_on: "2018-01-01", ended_on: "2022-06-30" }));
    expect(old.find("#apply-employers-0-subject_to_fmcsr").exists()).toBe(false);
    expect(old.find("#apply-employers-0-safety_sensitive").exists()).toBe(false);
    old.unmount();

    // Straddling the boundary is (b)(10) too — the filing's own `employmentSegments`.
    const straddle = panel(recent({ started_on: "2018-01-01", ended_on: "2024-06-30" }));
    expect(straddle.find("#apply-employers-0-subject_to_fmcsr").exists()).toBe(true);
    straddle.unmount();
  });

  it("will not save a job with an unanswered question, and says so under that question", async () => {
    const w = panel(recent({ employer_name: "", subject_to_fmcsr: null, safety_sensitive: null }));
    await w.find("#apply-employers-0-employer_name").setValue("Old Carrier");
    await button(w, copy.drawerSave).trigger("click");

    expect(w.emitted("save")).toBeUndefined();
    expect(w.text()).toContain("Say whether the Federal Motor Carrier Safety Regulations applied to you in this job");
    expect(w.text()).toContain("Say whether this job was subject to DOT drug and alcohol testing");
    // Focus lands on the first question it complains about.
    expect(document.activeElement?.id).toBe("apply-employers-0-subject_to_fmcsr");
    // The hint that explains the term stays beside the refusal — the moment the driver needs it.
    expect(w.text()).toContain(copy.subjectToFmcsrHint);

    const groups = w.findAll("fieldset");
    await groups[0]!.findAll('input[type="radio"]')[1]!.setValue(true);
    await groups[1]!.findAll('input[type="radio"]')[0]!.setValue(true);
    await button(w, copy.drawerSave).trigger("click");
    const saved = w.emitted("save")![0]![0] as DraftEmployer;
    expect([saved.subject_to_fmcsr, saved.safety_sensitive]).toEqual([false, true]);
    w.unmount();
  });

  it("will not save a job without its address or its reason for leaving", async () => {
    const w = panel(recent({ employer_name: "", address_line1: "", reason_for_leaving: "" }));
    await w.find("#apply-employers-0-employer_name").setValue("Old Carrier");
    await button(w, copy.drawerSave).trigger("click");
    expect(w.emitted("save")).toBeUndefined();
    expect(w.find("#apply-employers-0-address_line1").attributes("aria-invalid")).toBe("true");
    expect(w.find("#apply-employers-0-reason_for_leaving").attributes("aria-invalid")).toBe("true");
    w.unmount();
  });

  it("saves a job from years four to ten without the (iv) answers the regulation does not ask of it", async () => {
    const w = panel(recent({ started_on: "2018-01-01", ended_on: "2022-06-30", subject_to_fmcsr: null, safety_sensitive: null }));
    await button(w, copy.drawerSave).trigger("click");
    const saved = w.emitted("save")![0]![0] as DraftEmployer;
    expect(saved.subject_to_fmcsr).toBeNull();
    w.unmount();
  });

  it("shows at once what a saved job still owes when it is reopened, and nothing on a new one", () => {
    const owed = panel(recent({ reason_for_leaving: "", safety_sensitive: null }));
    expect(owed.text()).toContain("Say why you left this job");
    expect(owed.text()).toContain("Say whether this job was subject to DOT drug and alcohol testing");
    owed.unmount();

    const fresh = panel(null);
    expect(fresh.find("[aria-invalid='true']").exists()).toBe(false);
    fresh.unmount();
  });
});

describe("a legacy link's panel", () => {
  it("keeps three fields in front and the rest optional — the (iv) questions included", () => {
    const w = panel(recent(), null);
    expect(mainRun(w)).toEqual([
      "apply-employers-0-employer_name",
      "apply-employers-0-started_on",
      "apply-employers-0-ended_on",
    ]);
    const details = w.find("details").element;
    expect(details.contains(w.find("#apply-employers-0-subject_to_fmcsr").element)).toBe(true);
    expect(details.contains(w.find("#apply-employers-0-reason_for_leaving").element)).toBe(true);
    w.unmount();
  });

  it("saves a job with the questions unanswered — as null, which is what they are — and asks nothing new", async () => {
    const w = panel(recent({ employer_name: "", address_line1: "", reason_for_leaving: "", subject_to_fmcsr: null, safety_sensitive: null }), null);
    await w.find("#apply-employers-0-employer_name").setValue("Old Carrier");
    await button(w, copy.drawerSave).trigger("click");
    const saved = w.emitted("save")![0]![0] as DraftEmployer;
    expect([saved.subject_to_fmcsr, saved.safety_sensitive]).toEqual([null, null]);
    w.unmount();
  });
});

describe("the job list", () => {
  /** The employment screen under a page that has refused something, as `ApplyPage` provides it. */
  const listWith = (issues: SectionIssue[]) =>
    mount(
      defineComponent({
        setup() {
          provideApplyIssues(ref(issues));
          const draft = ref({ ...emptyDraft(), employers: [recent(), recent({ employer_name: "Second Carrier" })] });
          return () => h(ApplyEmploymentFields, { modelValue: draft.value, asOf: ASOF, v2AsOf: ASOF });
        },
      }),
      { global: { stubs: { SlideOver: SlideOverStub } } },
    );
  const issueAt = (path: (string | number)[]): SectionIssue => ({
    path, key: "employers", message: "x", label: "x", say: "x", fieldId: fieldId(path), section: "employment",
  });

  it("says on a job's own row that an answer inside it is missing — and on no other row", () => {
    const w = listWith([issueAt(["employers", 1, "safety_sensitive"])]);
    const rows = w.findAll("li");
    expect(rows[0]!.text()).not.toContain(copy.jobNeedsAnswers);
    expect(rows[1]!.text()).toContain(copy.jobNeedsAnswers);
  });

  it("does not flag job 2 for a problem in job 11", () => {
    // By id prefix, so "apply-employers-1-" must not match "apply-employers-10-…".
    const eleven = Array.from({ length: 11 }, (_, i) => recent({ employer_name: `Carrier ${i + 1}` }));
    const w = mount(
      defineComponent({
        setup() {
          provideApplyIssues(ref([issueAt(["employers", 10, "reason_for_leaving"])]));
          const draft = ref({ ...emptyDraft(), employers: eleven });
          return () => h(ApplyEmploymentFields, { modelValue: draft.value, asOf: ASOF, v2AsOf: ASOF });
        },
      }),
      { global: { stubs: { SlideOver: SlideOverStub } } },
    );
    const flagged = w.findAll("li").map((row) => row.text().includes(copy.jobNeedsAnswers));
    expect(flagged.filter(Boolean)).toHaveLength(1);
    expect(flagged[10]).toBe(true);
  });

  it("says nothing when nothing is refused", () => {
    expect(listWith([]).text()).not.toContain(copy.jobNeedsAnswers);
  });
});
