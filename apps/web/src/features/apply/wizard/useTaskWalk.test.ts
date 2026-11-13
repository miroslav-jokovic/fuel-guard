import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive, ref } from "vue";
import type { ApplicationSection } from "@silvicom/shared";
import { emptyDraft, type ApplicationDraft } from "@/features/apply/draft";
import { validateSection, type SectionIssue } from "@/features/apply/useApplicationWizard";
import { servedCarrierQuestions } from "@/features/apply/servedForm";
import { useTaskWalk } from "./useTaskWalk";

/**
 * A Part 2 task walked one question to a screen (F4 PR 1b-1). The fakes stand in for the page's wizard
 * and task list; the check is the real `validateSection`, so the walk is held to the task's own rules.
 */
const AS_OF = "2026-11-13";

function walkOf(section: ApplicationSection = "safety", hasPartOne = false) {
  const draft = reactive<ApplicationDraft>(emptyDraft());
  const issues = ref<SectionIssue[]>([]);
  const inTask = ref(false);
  const sectionRef = ref<ApplicationSection>(section);
  const wizard = {
    section: sectionRef,
    issues,
    setIssues: (v: SectionIssue[]) => { issues.value = v; },
    focusIssue: vi.fn(),
  };
  const hub = {
    inTask,
    // The real `hub.finish`: the task's check, then the list — or stay, with the issues shown.
    finish: vi.fn(() => {
      issues.value = validateSection(sectionRef.value, draft, AS_OF);
      if (issues.value.length === 0) inTask.value = false;
    }),
    leave: vi.fn(() => { inTask.value = false; }),
  };
  const walk = useTaskWalk(draft, wizard, hub, () => AS_OF, () => hasPartOne);
  return { draft, walk, hub, issues, open: async () => { inTask.value = true; await nextTick(); } };
}

const ids = (w: ReturnType<typeof walkOf>["walk"]) =>
  w.steps.value.map((s) => s.screen?.id ?? (s.question ? `q:${s.question.q.id}` : s.partOne ? "part_one" : `another:${s.another}`));

afterEach(() => { servedCarrierQuestions.value = []; });

describe("a task walked one question to a screen", () => {
  it("is not active outside a generated task", async () => {
    const { walk, open } = walkOf("employment");
    await open();
    expect(walk.active.value).toBe(false);
    expect(walk.steps.value).toEqual([]);
  });

  it("asks the four gates of a clean record, and nothing else", async () => {
    const { walk, open } = walkOf();
    await open();
    expect(ids(walk)).toEqual(["safety.accidents", "safety.violations", "safety.denied", "safety.suspended"]);
    expect(walk.current.value?.screen?.id).toBe("safety.accidents");
  });

  it("walks each accident's screens after a Yes, and ends the list with \"Any other?\"", async () => {
    const { walk, draft, open } = walkOf();
    await open();
    walk.binding.write("application.declares_no_accidents", true);
    expect(ids(walk).slice(0, 7)).toEqual([
      "safety.accidents", "safety.accident_date", "safety.accident_nature", "safety.accident_casualties",
      "safety.accident_hazmat", "another:accidents", "safety.violations",
    ]);
    expect(walk.steps.value[1]!.row).toBe(0);
    expect(draft.accidents).toHaveLength(1);
  });

  it("refuses Continue with that screen's problem only, and moves on once it is answered", async () => {
    const { walk, issues, open } = walkOf();
    await open();
    walk.next();
    // The gate is unanswered: its own problem, and not the denial question's further on.
    expect(walk.current.value?.screen?.id).toBe("safety.accidents");
    expect(issues.value.length).toBeGreaterThan(0);
    expect(issues.value.every((i) => i.fieldId === "apply-accidents")).toBe(true);
    walk.binding.write("application.declares_no_accidents", false);
    walk.next();
    expect(walk.current.value?.screen?.id).toBe("safety.violations");
  });

  it("asks \"Any other?\" with nothing chosen: Yes walks a new row, No moves on", async () => {
    const { walk, draft, open } = walkOf();
    await open();
    walk.binding.write("application.declares_no_accidents", true);
    Object.assign(draft.accidents[0]!, { occurred_on: "2025-04-02", nature: "Rear-ended", fatalities: "0", injuries: "1", hazmat_spill: false });
    const anotherAt = ids(walk).indexOf("another:accidents");
    for (let i = 0; i < anotherAt; i += 1) walk.next();
    expect(walk.current.value?.another).toBe("accidents");
    walk.next();
    expect(walk.anotherRefused.value).toBe(true);
    expect(walk.current.value?.another).toBe("accidents");
    walk.another.value = true;
    walk.next();
    expect(draft.accidents).toHaveLength(2);
    expect(walk.current.value?.screen?.id).toBe("safety.accident_date");
    expect(walk.current.value?.row).toBe(1);
  });

  it("removes the row on show and lands where it began — on the gate once the list is empty", async () => {
    const { walk, draft, open } = walkOf();
    await open();
    walk.binding.write("application.declares_no_accidents", true);
    walk.next();
    expect(walk.current.value?.row).toBe(0);
    walk.removeRow();
    expect(draft.accidents).toEqual([]);
    expect(walk.current.value?.screen?.id).toBe("safety.accidents");
    expect(walk.binding.read("application.declares_no_accidents")).toBeNull();
  });

  it("closes the task on the last screen, and on a refusal opens the screen holding the problem", async () => {
    const { walk, draft, hub, open } = walkOf();
    await open();
    Object.assign(draft, { declares_no_accidents: true, declares_no_violations: true, licence_ever_denied: false });
    for (let i = 0; i < 3; i += 1) walk.next();
    expect(walk.current.value?.screen?.id).toBe("safety.suspended");
    expect(walk.atEnd.value).toBe(true);
    walk.next();
    // Question B is the last screen's own: refused there, never reaching the task's close.
    expect(hub.finish).not.toHaveBeenCalled();
    draft.licence_suspended = false;
    walk.next();
    expect(hub.finish).toHaveBeenCalledOnce();
    expect(walk.active.value).toBe(false);
  });

  it("sends a refusal at the close to the first screen holding it", async () => {
    const { walk, draft, hub, open } = walkOf();
    await open();
    Object.assign(draft, { declares_no_accidents: true, declares_no_violations: true, licence_ever_denied: false, licence_suspended: false });
    // An answer changed behind the walk's back (another tab's save): the close finds it.
    for (let i = 0; i < 3; i += 1) walk.next();
    draft.licence_ever_denied = null as never;
    walk.next();
    expect(hub.finish).toHaveBeenCalledOnce();
    expect(walk.current.value?.screen?.id).toBe("safety.denied");
  });

  it("goes back a screen, and from the first back to the task list", async () => {
    const { walk, draft, hub, open } = walkOf();
    await open();
    draft.declares_no_accidents = true;
    walk.next();
    walk.back();
    expect(walk.current.value?.screen?.id).toBe("safety.accidents");
    walk.back();
    expect(hub.leave).toHaveBeenCalledOnce();
  });

  it("says a problem no screen holds on the screen in front of the driver, never drops it", async () => {
    const { walk, issues, open } = walkOf();
    await open();
    issues.value = [{ path: ["accidents", 0], key: "accidents", message: "", label: "", say: "Row 1 is not complete", fieldId: "apply-accidents-0", section: "safety" }];
    expect(walk.stray.value).toEqual(["Row 1 is not complete"]);
  });

  it("moves on from a Yes to the first row's screen, not held for the rows it has not asked yet", async () => {
    const { walk, open } = walkOf();
    await open();
    walk.binding.write("application.declares_no_accidents", true);
    walk.next();
    expect(walk.current.value?.screen?.id).toBe("safety.accident_date");
  });

  it("opens the screen a send-summary entry is about", async () => {
    const { walk, draft, open } = walkOf();
    await open();
    draft.declares_no_violations = false;
    draft.violations = [{ occurred_on: "2025-01-02", offence: "Speeding", state: "", penalty: "Fine", key: "k1" }];
    walk.show({ path: ["violations", 0, "state"], key: "violations", message: "", label: "", say: "", fieldId: "apply-violations-0-state", section: "safety" });
    expect(walk.current.value?.screen?.id).toBe("safety.violation_state");
    expect(walk.current.value?.row).toBe(0);
  });

  it("is not active on a task still drawn whole", async () => {
    const { walk, open } = walkOf("licence");
    await open();
    expect(walk.active.value).toBe(false);
  });
});

/**
 * "About you" and the carrier's questions (F4 PR 1b-2): the catalogue's screens, then each question the
 * served definition puts on the task, one to a screen, then — on "About you" — Part 1's answers.
 */
describe("About you and the carrier's questions, one to a screen", () => {
  it("asks the name, other names, email and SSN, then the carrier's page-1 questions, then shows Part 1's answers", async () => {
    const { walk, open } = walkOf("identity", true);
    await open();
    expect(ids(walk)).toEqual([
      "identity.name", "identity.other_names", "identity.email", "identity.ssn",
      "q:position", "q:applying_as", "q:heard_from", "q:legally_work", "q:proof_of_age",
      "part_one",
    ]);
  });

  it("shows no Part 1 screen when the page holds no Part 1 answers", async () => {
    const { walk, open } = walkOf("identity", false);
    await open();
    expect(ids(walk)).not.toContain("part_one");
  });

  it("refuses a required question's screen with its own problem, and moves on once it is answered", async () => {
    const { walk, draft, issues, open } = walkOf("identity");
    await open();
    Object.assign(draft, { first_name: "Ana", last_name: "Diaz", email: "ana@example.com" });
    for (let i = 0; i < 4; i += 1) walk.next();
    expect(walk.current.value?.question?.q.id).toBe("position");
    walk.next();
    expect(walk.current.value?.question?.q.id).toBe("position");
    expect(issues.value.map((i) => i.path)).toEqual([["questionnaire_answers", "position"]]);
    walk.current.value!.question!.answers.set("position", "Driver");
    walk.next();
    expect(walk.current.value?.question?.q.id).toBe("applying_as");
  });

  it("asks \"If so, when?\" only after a yes, and the carrier's own questions after the built-in ones", async () => {
    servedCarrierQuestions.value = [
      { id: "11111111-1111-4111-8111-111111111111", wording: "Which terminal?", hint: null, kind: "text", choices: [], required: false },
    ];
    const { walk, open } = walkOf("questions");
    await open();
    expect(ids(walk)).toEqual(["q:education", "q:military_service", "q:other_training", "q:references", "q:11111111-1111-4111-8111-111111111111"]);
    const military = walk.steps.value[1]!.question!;
    military.answers.set("military_service", true);
    expect(ids(walk)).toContain("q:military_when");
    military.answers.set("military_service", false);
    expect(ids(walk)).not.toContain("q:military_when");
  });

  it("holds a problem under a question's answer on that question's screen — a reference's phone on the references", async () => {
    const { walk, open } = walkOf("questions");
    await open();
    walk.show({ path: ["questionnaire_answers", "references", 1, "phone"], key: "questionnaire_answers", message: "", label: "", say: "", fieldId: "x", section: "questions" });
    expect(walk.current.value?.question?.q.id).toBe("references");
  });

  it("holds one other name's problem on the other-names screen", async () => {
    const { walk, open } = walkOf("identity");
    await open();
    walk.show({ path: ["other_names", 1], key: "other_names", message: "", label: "", say: "Too long", fieldId: "apply-other_names-1", section: "identity" });
    expect(walk.current.value?.screen?.id).toBe("identity.other_names");
    expect(walk.stray.value).toEqual([]);
  });
});
