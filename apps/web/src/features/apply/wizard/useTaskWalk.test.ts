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
    const { walk, open } = walkOf("documents");
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

/**
 * "Where you have lived" (F4 PR 1b-3, SCREEN-MAP 2.5–2.6a). `AS_OF` 2026-11-13 opens the three years in
 * 2023-11. The draft's first address is the home Part 1 holds, as the unlock lays it in (`applyPartOne`).
 */
describe("the address walk", () => {
  const HOME = { line1: "1 Road", line2: "", city: "Joliet", state: "IL", postal_code: "60432" };
  async function atAddresses(movedIn = "") {
    const made = walkOf("addresses");
    made.draft.addresses = [{ ...made.draft.addresses[0]!, ...HOME, from: movedIn, to: "" }];
    await made.open();
    return made;
  }
  const write = (walk: ReturnType<typeof walkOf>["walk"], column: string, value: string) =>
    walk.binding.write(`application.addresses[].${column}`, value, walk.current.value!.row);

  it("asks only when the driver moved to the home Part 1 holds, and closes when that covers the three years", async () => {
    const { walk, draft, hub } = await atAddresses();
    expect(ids(walk)).toEqual(["addresses.moved_in"]);
    write(walk, "from", "2020-01");
    expect(walk.atEnd.value).toBe(true);
    walk.next();
    expect(hub.inTask.value).toBe(false);
    expect(draft.addresses).toHaveLength(1);
  });

  it("refuses a blank month on its own screen, and adds no home for it", async () => {
    const { walk, draft, issues } = await atAddresses();
    walk.next();
    expect(issues.value.map((i) => i.path)).toEqual([["addresses", 0, "from"]]);
    expect(draft.addresses).toHaveLength(1);
    expect(walk.current.value?.screen?.id).toBe("addresses.moved_in");
  });

  it("walks the home before, and the one before that, until the three years are covered", async () => {
    const { walk, draft, hub } = await atAddresses("2025-02");
    // Short of three years: Continue is not the task's close, it asks for the home before.
    expect(walk.atEnd.value).toBe(false);
    walk.next();
    expect(walk.current.value).toMatchObject({ screen: { id: "addresses.home" }, row: 1, ordinal: 1 });
    // It ends the month the home after it begins, so the driver types one month a home.
    expect(draft.addresses[1]).toMatchObject({ to: "2025-02", from: "", city: "" });

    write(walk, "city", "Gary");
    write(walk, "state", "IN");
    walk.next();
    expect(walk.current.value?.screen?.id).toBe("addresses.dates");
    write(walk, "from", "2024-01");
    expect(walk.atEnd.value).toBe(false);
    walk.next();
    expect(walk.current.value).toMatchObject({ screen: { id: "addresses.home" }, row: 2, ordinal: 2 });
    expect(draft.addresses[2]!.to).toBe("2024-01");

    write(walk, "city", "Dayton");
    write(walk, "state", "OH");
    walk.next();
    write(walk, "from", "2023-11");
    expect(walk.atEnd.value).toBe(true);
    walk.next();
    expect(hub.inTask.value).toBe(false);
    expect(draft.addresses).toHaveLength(3);
  });

  it("lets an earlier home's street and ZIP be left for the office, but not its city", async () => {
    const { walk, issues } = await atAddresses("2025-02");
    walk.next();
    walk.next();
    expect(issues.value.map((i) => i.path.join("."))).toContain("addresses.1.city");
    expect(walk.current.value?.screen?.id).toBe("addresses.home");
    // A message goes as its own answer is given; the other stays until its box is filled too.
    write(walk, "city", "Gary");
    await nextTick();
    expect(issues.value.map((i) => i.path.join("."))).toEqual(["addresses.1.state"]);
    write(walk, "state", "IN");
    await nextTick();
    expect(issues.value).toEqual([]);
    walk.next();
    expect(walk.current.value?.screen?.id).toBe("addresses.dates");
  });

  it("asks the home lived in now first, whatever order the draft holds the homes in", async () => {
    const { walk, draft } = await atAddresses("2025-02");
    draft.addresses = [
      { ...draft.addresses[0]!, ...HOME, city: "Gary", state: "IN", from: "2023-11", to: "2025-02", key: "k-earlier" },
      { ...draft.addresses[0]!, key: "k-now" },
    ];
    await nextTick();
    expect(walk.steps.value.map((s) => [s.screen?.id, s.row, s.ordinal])).toEqual([
      ["addresses.moved_in", 1, 1],
      ["addresses.home", 0, 1],
      ["addresses.dates", 0, 1],
    ]);
  });

  it("asks a second home with no end month when the driver moved out, as an earlier home", async () => {
    const { walk, draft, issues } = await atAddresses("2020-01");
    draft.addresses = [...draft.addresses, { ...draft.addresses[0]!, city: "Gary", state: "IN", from: "2018-01", to: "", key: "k-second" }];
    await nextTick();
    expect(ids(walk)).toEqual(["addresses.moved_in", "addresses.home", "addresses.dates"]);
    walk.next();
    walk.next();
    walk.next();
    expect(walk.current.value?.screen?.id).toBe("addresses.dates");
    expect(issues.value.map((i) => [i.path.join("."), i.say])).toEqual([["addresses.1.to", "Give the month you moved out of this address"]]);
  });

  it("removes an earlier home and asks again for the months it covered", async () => {
    const { walk, draft } = await atAddresses("2025-02");
    walk.next();
    write(walk, "city", "Gary");
    write(walk, "state", "IN");
    walk.next();
    write(walk, "from", "2023-11");
    expect(walk.atEnd.value).toBe(true);
    walk.removeRow();
    await nextTick();
    expect(draft.addresses).toHaveLength(1);
    expect(walk.current.value?.screen?.id).toBe("addresses.moved_in");
    expect(walk.atEnd.value).toBe(false);
  });
});

/**
 * "Where you have worked" (F4 PR 1b-4, SCREEN-MAP 2.8–2.17). `AS_OF` 2026-11-13: the three years open on
 * 2023-11-13.
 */
describe("the employment walk", () => {
  const J = "application.employers[].";
  async function atWork() {
    const made = walkOf("employment");
    await made.open();
    return made;
  }
  const answer = (walk: ReturnType<typeof walkOf>["walk"], column: string, value: unknown) =>
    walk.binding.write(`${J}${column}`, value, walk.current.value!.row);
  /** One job, start to "any other?", as a driver who drove there since before the three years. */
  function job(walk: ReturnType<typeof walkOf>["walk"], over: { from?: string; to?: string; dot?: unknown } = {}) {
    answer(walk, "employer_name", "Midwest Freight");
    walk.next();
    walk.next(); // the place is optional
    answer(walk, "started_on", over.from ?? "2020-01-01");
    answer(walk, "ended_on", over.to ?? "");
    walk.next();
    answer(walk, "operated_cmv", true);
    walk.next();
    answer(walk, "dot_regulated", over.dot ?? true);
    walk.next();
    answer(walk, "reason_for_leaving", "Better pay or miles");
    walk.next();
  }

  it("asks whether there was a job with nothing chosen, though a new draft holds a blank one", async () => {
    const { walk, draft } = await atWork();
    expect(draft.employers).toEqual([]);
    expect(walk.current.value?.screen?.id).toBe("employment.any");
    expect(walk.binding.read("application.declares_no_employment")).toBeNull();
  });

  it("walks a job a question at a time, files a driving job as Driver, and never asks its title", async () => {
    const { walk, draft } = await atWork();
    walk.binding.write("application.declares_no_employment", true);
    walk.next();
    expect(walk.current.value?.screen?.id).toBe("employment.job_name");
    job(walk);
    expect(walk.current.value?.another).toBe("employers");
    expect(ids(walk).filter((id) => id.startsWith("employment.job_"))).toEqual([
      "employment.job_name", "employment.job_place", "employment.job_dates", "employment.job_drove", "employment.job_dot", "employment.job_reason",
    ]);
    expect(draft.employers[0]).toMatchObject({
      employer_name: "Midwest Freight", position_held: "Driver", operated_cmv: true,
      dot_regulated: true, subject_to_fmcsr: true, safety_sensitive: true, reason_for_leaving: "Better pay or miles",
    });
  });

  it("asks the job's title only when the driver did not drive there", async () => {
    const { walk, draft } = await atWork();
    walk.binding.write("application.declares_no_employment", true);
    walk.next();
    answer(walk, "employer_name", "Warehouse Co");
    walk.next();
    walk.next();
    answer(walk, "started_on", "2020-01-01");
    walk.next();
    answer(walk, "operated_cmv", true);
    answer(walk, "operated_cmv", false);
    expect(draft.employers[0]!.position_held).toBe("");
    walk.next();
    expect(walk.current.value?.screen?.id).toBe("employment.job_position");
  });

  it("refuses a job with no name on its own screen, and a blank start date on its own", async () => {
    const { walk, issues } = await atWork();
    walk.binding.write("application.declares_no_employment", true);
    walk.next();
    walk.next();
    expect(walk.current.value?.screen?.id).toBe("employment.job_name");
    expect(issues.value.map((i) => i.path.join("."))).toEqual(["employers.0.employer_name"]);
    answer(walk, "employer_name", "Midwest Freight");
    walk.next();
    walk.next();
    walk.next();
    expect(walk.current.value?.screen?.id).toBe("employment.job_dates");
    expect(issues.value.map((i) => i.path.join("."))).toEqual(["employers.0.started_on"]);
  });

  it("takes Not sure as an answer: the three DOT answers stay open for the office, and the driver moves on", async () => {
    const { walk, draft, issues } = await atWork();
    walk.binding.write("application.declares_no_employment", true);
    walk.next();
    job(walk, { dot: "not_sure" });
    expect(issues.value).toEqual([]);
    expect(walk.current.value?.another).toBe("employers");
    expect(draft.employers[0]).toMatchObject({ dot_regulated: null, subject_to_fmcsr: null, safety_sensitive: null, dot_not_sure: true });
    expect(walk.binding.read(`${J}dot_regulated`, 0)).toBe("not_sure");
    // Answering it after all is the answer, and no longer "Not sure".
    walk.binding.write(`${J}dot_regulated`, false, 0);
    expect(draft.employers[0]).toMatchObject({ dot_regulated: false, subject_to_fmcsr: false, safety_sensitive: false, dot_not_sure: false });
  });

  it("will not pass the DOT question unanswered", async () => {
    const { walk, issues } = await atWork();
    walk.binding.write("application.declares_no_employment", true);
    walk.next();
    answer(walk, "employer_name", "Midwest Freight");
    walk.next();
    walk.next();
    answer(walk, "started_on", "2020-01-01");
    walk.next();
    answer(walk, "operated_cmv", true);
    walk.next();
    walk.next();
    expect(walk.current.value?.screen?.id).toBe("employment.job_dot");
    expect(issues.value.map((i) => i.path.join("."))).toContain("employers.0.dot_regulated");
  });

  it("asks what the driver was doing in each gap the jobs leave, on a screen of its own", async () => {
    const { walk, draft } = await atWork();
    walk.binding.write("application.declares_no_employment", true);
    walk.next();
    job(walk, { from: "2025-06-01" });
    await nextTick();
    // 2023-11-13 → 2025-05-31 has no job: one gap, asked after the jobs.
    expect(draft.employment_gaps).toHaveLength(1);
    expect(ids(walk)).toContain("employment.gap");
    walk.answerAnother(false);
    walk.next();
    expect(walk.current.value?.screen?.id).toBe("employment.gap");
    walk.next();
    expect(walk.current.value?.screen?.id).toBe("employment.gap");
    walk.binding.write("application.employment_gaps[].explanation", "School or training", 0);
    walk.next();
    expect(walk.current.value?.screen?.id).toBe("employment.equipment");
  });

  it("makes a row of each class picked, keeps what was typed on a kept pick, and asks each on its own screen", async () => {
    const { walk, draft } = await atWork();
    walk.binding.write("application.declares_no_employment", false);
    await nextTick();
    const CLASS = "application.equipment_experience[].equipment_class";
    const [first, second] = ["tractor_semitrailer", "straight_truck"];
    walk.binding.write(CLASS, [first]);
    draft.equipment_experience[0]!.approx_miles = "100000";
    walk.binding.write(CLASS, [first, second]);
    expect(draft.equipment_experience.map((r) => [r.equipment_class, r.approx_miles])).toEqual([[first, "100000"], [second, ""]]);
    expect(walk.binding.read(CLASS)).toEqual([first, second]);
    expect(ids(walk).filter((id) => id === "employment.equipment_detail")).toHaveLength(2);
    walk.binding.write(CLASS, [second]);
    expect(draft.equipment_experience.map((r) => r.equipment_class)).toEqual([second]);
  });

  it("does not refuse the picks for being empty, and the close asks for the experience if neither was given", async () => {
    const { walk, hub, issues, draft } = await atWork();
    walk.binding.write("application.declares_no_employment", false);
    // The carrier's own question on this task, answered: it is not what this test is about.
    (draft.questionnaire as Record<string, unknown>).may_contact_employers = true;
    await nextTick();
    // No job at all is three years with none: one gap, explained.
    expect(draft.employment_gaps).toHaveLength(1);
    draft.employment_gaps[0]!.explanation = "Family";
    for (let i = 0; i < 12 && walk.current.value?.screen?.id !== "employment.equipment"; i += 1) walk.next();
    expect(walk.current.value?.screen?.id).toBe("employment.equipment");
    walk.next();
    expect(issues.value).toEqual([]);
    expect(walk.current.value?.screen?.id).toBe("employment.experience");
    // Nothing picked and nothing written: the task's close refuses, and opens the picks.
    for (let i = 0; i < 6 && hub.inTask.value && walk.current.value?.screen?.id !== "employment.equipment"; i += 1) walk.next();
    expect(hub.inTask.value).toBe(true);
    expect(walk.current.value?.screen?.id).toBe("employment.equipment");
  });
});
