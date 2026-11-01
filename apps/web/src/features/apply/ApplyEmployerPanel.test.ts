import { beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, ref } from "vue";
import ApplyEmploymentFields from "./ApplyEmploymentFields.vue";
import { provideApplyIssues } from "./issues";
import { emptyDraft, emptyEmployer, type ApplicationDraft, type DraftEmployer } from "./draft";
import { fieldId } from "./fieldLabels";
import type { SectionIssue } from "./useApplicationWizard";
import { APPLY_COPY } from "./strings";
import { APPLY_HISTORY_COPY } from "./strings.history";
import { APPLY_HISTORY_COPY_ES } from "./es/strings.es.history";

/**
 * The applicant's job panel — the one employer form (HW5b) with the applicant's own save path: a v2
 * link's Save checks the job with the filing's rules (C3c2b, Q-AW33), a legacy link's with the row
 * schema alone, and a half-typed job is kept as "Unfinished", never as a blank row (§9 P8, AF-4).
 * Ported from `EmployerDrawer.test.ts` when that panel was replaced.
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

function screen(employers: DraftEmployer[], v2AsOf: string | null = ASOF, issues: SectionIssue[] = []) {
  const draft = ref<ApplicationDraft>({ ...emptyDraft(), employers });
  const w = mount(
    defineComponent({
      setup() {
        provideApplyIssues(ref(issues));
        return () => h(ApplyEmploymentFields, {
          modelValue: draft.value, asOf: ASOF, v2AsOf,
          "onUpdate:modelValue": (v: ApplicationDraft) => { draft.value = v; },
        });
      },
    }),
    { global: { stubs: { SlideOver: SlideOverStub } }, attachTo: document.body },
  );
  const press = async (label: string) => {
    await w.findAll("button").find((b) => b.text().trim() === label)!.trigger("click");
    await flushPromises();
  };
  return { draft, w, press };
}

beforeEach(() => setActivePinia(createPinia()));

describe("a v2 link's Save", () => {
  it("will not save a job with an unanswered (iv) question, says so under it, and moves the cursor there", async () => {
    const { draft, w, press } = screen([recent({ subject_to_fmcsr: null, safety_sensitive: null })]);
    await press(copy.editJob);
    await press(copy.drawerSave);
    expect(draft.value.employers[0]!.subject_to_fmcsr).toBeNull();
    expect(w.text()).toContain("Say whether the Federal Motor Carrier Safety Regulations applied to you in this job");
    expect(w.text()).toContain("Say whether this job was subject to DOT drug and alcohol testing");
    expect(document.activeElement?.id).toBe("apply-employers-0-subject_to_fmcsr");
    // The hint that explains the term stays beside the refusal.
    expect(w.text()).toContain(copy.subjectToFmcsrHint);

    await w.find("fieldset#apply-employers-0-subject_to_fmcsr").findAll("input[type=radio]")[1]!.setValue(true);
    await w.find("fieldset#apply-employers-0-safety_sensitive").findAll("input[type=radio]")[0]!.setValue(true);
    await press(copy.drawerSave);
    expect([draft.value.employers[0]!.subject_to_fmcsr, draft.value.employers[0]!.safety_sensitive]).toEqual([false, true]);
    w.unmount();
  });

  it("will not save a job without its address or its reason for leaving", async () => {
    const { w, press } = screen([recent()]);
    await press(copy.editJob);
    await w.find("#apply-employers-0-address_line1").setValue("");
    await w.find("#apply-employers-0-reason_for_leaving").setValue("");
    await press(copy.drawerSave);
    expect(w.find("#apply-employers-0-address_line1").attributes("aria-invalid")).toBe("true");
    expect(w.find("#apply-employers-0-reason_for_leaving").attributes("aria-invalid")).toBe("true");
    w.unmount();
  });

  it("saves a job from years four to ten without the (iv) answers the regulation does not ask of it", async () => {
    const { draft, press } = screen([recent({ started_on: "2018-01-01", ended_on: "2022-06-30", subject_to_fmcsr: null, safety_sensitive: null, reason_for_leaving: "Moved" })]);
    await press(copy.editJob);
    await press(copy.drawerSave);
    expect(draft.value.employers[0]!.subject_to_fmcsr).toBeNull();
    expect(document.body.textContent).not.toContain(copy.drawerSave);
  });

  it("shows at once what a saved job still owes when it is reopened, and nothing on a new one", async () => {
    const { w, press } = screen([recent({ reason_for_leaving: "", safety_sensitive: null })]);
    await press(copy.editJob);
    expect(w.text()).toContain("Say why you left this job");
    expect(w.text()).toContain("Say whether this job was subject to DOT drug and alcohol testing");
    await press(copy.drawerCancel);
    await press(copy.addJob);
    expect(w.find("[data-testid='employer-form'] [aria-invalid='true']").exists()).toBe(false);
    w.unmount();
  });
});

describe("a legacy link's Save", () => {
  it("saves a job with the questions unanswered — as null, which is what they are — and no address", async () => {
    const { draft, press } = screen([recent({ address_line1: "", reason_for_leaving: "", subject_to_fmcsr: null, safety_sensitive: null })], null);
    await press(copy.editJob);
    await press(copy.drawerSave);
    expect([draft.value.employers[0]!.subject_to_fmcsr, draft.value.employers[0]!.safety_sensitive]).toEqual([null, null]);
    expect(document.body.textContent).not.toContain(copy.drawerSave);
  });
});

describe("what each card on the timeline says is missing", () => {
  const issueAt = (path: (string | number)[]): SectionIssue => ({
    path, key: "employers", message: "x", label: "x", say: "x", fieldId: fieldId(path), section: "employment",
  });

  it("counts what the filing still wants of a job, on that job's card alone", () => {
    const { w } = screen([recent({ key: "40000000-0000-4000-8000-00000000000a" }), recent({ key: "40000000-0000-4000-8000-00000000000b", employer_name: "Second Carrier", reason_for_leaving: "", safety_sensitive: null })]);
    expect(w.get('[data-job="40000000-0000-4000-8000-00000000000a"]').text()).toContain(copy.jobComplete);
    expect(w.get('[data-job="40000000-0000-4000-8000-00000000000b"]').text()).toContain(copy.jobMissing(2));
  });

  it("flags job 11 for a refusal the page made in job 11, and not job 2", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => recent({ employer_name: `Carrier ${i + 1}`, started_on: `2024-01-${String(i + 1).padStart(2, "0")}` }));
    const { w, draft } = screen(eleven, ASOF, [issueAt(["employers", 10, "phone"])]);
    const flagged = draft.value.employers.filter((e) => w.get(`[data-job="${e.key}"]`).text().includes(copy.jobMissing(1)));
    expect(flagged.map((e) => e.employer_name)).toEqual(["Carrier 11"]);
  });
});

/**
 * §9 P8 (AF-4): a job saves only with a name and a start date, and a half-filled panel is never a
 * silent blank row — it is kept as typed and named "Unfinished — finish or remove" on the timeline.
 */
describe("a job left unfinished", () => {
  it("cannot be saved blank: Save names both missing answers and keeps the panel open", async () => {
    const { w, press } = screen([recent()], null);
    await press(copy.addJob);
    await press(copy.drawerSave);
    expect(w.find("#apply-employers-1-employer_name").attributes("aria-invalid")).toBe("true");
    expect(w.find("#apply-employers-1-started_on").attributes("aria-invalid")).toBe("true");
    w.unmount();
  });

  it("leaves no row when the new job was closed blank", async () => {
    const { draft, w, press } = screen([recent()]);
    await press(copy.addJob);
    await press(copy.drawerCancel);
    expect(draft.value.employers).toHaveLength(1);
    expect(w.text()).not.toContain(copy.unfinished);
    w.unmount();
  });

  it("keeps a half-filled job and shows it by name as unfinished, never as a blank row", async () => {
    const { draft, w, press } = screen([recent()]);
    await press(copy.addJob);
    await w.find("#apply-employers-1-employer_name").setValue("Half Carrier");
    await press(copy.drawerCancel);
    expect(draft.value.employers.map((e) => e.employer_name)).toEqual(["Old Carrier", "Half Carrier"]);
    const card = w.get(`[data-job="${draft.value.employers[1]!.key}"]`);
    expect(card.text()).toContain(copy.unfinished);
    expect(card.text()).toContain(copy.finish);
    w.unmount();
  });

  it("names a job with dates and no name as a job with no name", async () => {
    const { draft, w } = screen([recent(), { ...emptyEmployer(), started_on: "2021-01-01" }]);
    await flushPromises();
    const card = w.get(`[data-job="${draft.value.employers[1]!.key}"]`);
    expect(card.text()).toContain(copy.noName);
    expect(card.text()).toContain(copy.unfinished);
    w.unmount();
  });

  it("keeps a finished job as saved when its edit is cancelled", async () => {
    const { draft, w, press } = screen([recent()]);
    await press(copy.editJob);
    await w.find("#apply-employers-0-employer_name").setValue("");
    await press(copy.drawerCancel);
    expect(draft.value.employers[0]!.employer_name).toBe("Old Carrier");
    w.unmount();
  });
});

describe("a gap on the applicant's timeline (HW5b)", () => {
  it("adds a job into the gap with the gap's dates already in it", async () => {
    // Recent covers 01/2024 on; the three years open 09/26/2023 — a gap the driver can fill with a job.
    const { draft, w, press } = screen([recent()]);
    await press(copy.addJobHere);
    expect(draft.value.employers).toHaveLength(2);
    expect([draft.value.employers[1]!.started_on, draft.value.employers[1]!.ended_on]).toEqual(["2023-09-26", "2024-01-01"]);
    w.unmount();
  });
});

describe("the screen's own instruction (EM-10)", () => {
  it("no longer tells the applicant time without a job needs no explaining, while the gap boxes ask it — in either language", () => {
    expect(APPLY_HISTORY_COPY.employment.intro).not.toContain("not a gap");
    expect(APPLY_HISTORY_COPY.employment.intro).toContain("you will be asked what you were doing");
    expect(APPLY_HISTORY_COPY_ES.employment.intro).not.toContain("no es un hueco");
    expect(APPLY_HISTORY_COPY_ES.employment.intro).toContain("le preguntaremos qué hacía");
  });
});
