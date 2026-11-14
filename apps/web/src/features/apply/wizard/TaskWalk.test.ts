import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, reactive, ref } from "vue";
import { AppButton } from "@silvicom/ui";
import type { ApplicationSection, PartOneFactsView } from "@silvicom/shared";
import { emptyDraft, type ApplicationDraft } from "@/features/apply/draft";
import { setApplyLanguage } from "@/features/apply/language";
import { APPLY_COPY } from "@/features/apply/strings";
import type { SectionIssue } from "@/features/apply/useApplicationWizard";
import SsnField from "@/features/apply/SsnField.vue";
import TaskWalk from "./TaskWalk.vue";
import { useTaskWalk } from "./useTaskWalk";

/** The open task drawn one screen at a time (F4 PR 1b-1): where the driver is, whose row, and its removal. */
async function walking(section: ApplicationSection = "safety", partOne: PartOneFactsView | null = null) {
  const draft = reactive<ApplicationDraft>(emptyDraft());
  const inTask = ref(false);
  const issues = ref<SectionIssue[]>([]);
  const walk = useTaskWalk(
    draft,
    { section: ref<ApplicationSection>(section), issues, setIssues: (v) => { issues.value = v; }, focusIssue: vi.fn() },
    { inTask, finish: vi.fn(), leave: vi.fn() },
    () => "2026-11-13",
    () => partOne !== null,
  );
  inTask.value = true;
  await nextTick();
  return { draft, walk, w: mount(TaskWalk, { props: { walk, token: "tok", modelValue: draft, partOne } }) };
}

/** Continue until the step with this key is on show. */
async function walkTo(walk: Awaited<ReturnType<typeof walking>>["walk"], key: string) {
  for (let i = 0; i < 20 && walk.current.value?.key !== key; i += 1) walk.next();
  await nextTick();
  expect(walk.current.value?.key).toBe(key);
}

afterEach(() => setApplyLanguage("en"));

describe("the open task, one screen at a time", () => {
  it("says where the driver is, and asks the screen's question", async () => {
    const { w } = await walking();
    expect(w.text()).toContain(APPLY_COPY.hub.question(1, 4));
    expect(w.text()).toContain(APPLY_COPY.safety.accidentsQuestion);
  });

  it("names the row a loop screen is about and offers its removal, in the page's language", async () => {
    setApplyLanguage("es");
    const { w, walk, draft } = await walking();
    walk.binding.write("application.declares_no_accidents", true);
    walk.next();
    await nextTick();
    expect(w.text()).toContain(APPLY_COPY.safety.walk.accidentRow(1));
    expect(w.text()).toContain(APPLY_COPY.safety.walk.accidentDate);
    const remove = w.findAllComponents(AppButton).find((b) => b.text() === APPLY_COPY.safety.walk.removeAccident);
    expect(remove).toBeDefined();
    await remove!.trigger("click");
    expect(draft.accidents).toEqual([]);
  });

  it("offers a conviction's quick picks, filing the English word whatever the page's language", async () => {
    setApplyLanguage("es");
    const { w, walk, draft } = await walking();
    walk.binding.write("application.declares_no_accidents", false);
    walk.binding.write("application.declares_no_violations", true);
    walk.next(); walk.next(); walk.next();
    await nextTick();
    expect(walk.current.value?.screen?.id).toBe("safety.violation_offence");
    const pick = w.findAllComponents(AppButton).find((b) => b.text() === APPLY_COPY.quickPicks.violation_offence.Speeding);
    expect(pick?.text()).toBe("Exceso de velocidad");
    await pick!.trigger("click");
    expect(draft.violations[0]!.offence).toBe("Speeding");
    // The box reads in the page's language, and typing a pick's own words files the pick.
    const box = w.find("input#" + walk.binding.id("application.violations[].offence", 0));
    expect((box.element as HTMLInputElement).value).toBe("Exceso de velocidad");
    await box.setValue("multa ");
    expect(draft.violations[0]!.offence).toBe("multa ");
    await box.setValue("Exceso de velocidad");
    expect(draft.violations[0]!.offence).toBe("Speeding");
  });

  it("asks \"Any other?\" at a list's end, and says so when Continue is pressed with nothing chosen", async () => {
    const { w, walk, draft } = await walking();
    walk.binding.write("application.declares_no_accidents", true);
    Object.assign(draft.accidents[0]!, { occurred_on: "2025-04-02", nature: "Rear-ended", fatalities: "0", injuries: "0", hazmat_spill: false });
    for (let i = 0; i < 5; i += 1) walk.next();
    walk.next();
    await nextTick();
    expect(w.text()).toContain(APPLY_COPY.safety.walk.anotherAccident);
    expect(w.text()).toContain(APPLY_COPY.hub.chooseYesOrNo);
  });
});

/** "About you" (F4 PR 1b-2): the screens that are not the binding's, and the list of other names. */
describe("About you, one screen at a time", () => {
  const PART_ONE = {
    intake: { phone: "+13125550142" },
    licences: [],
    asOf: "2026-11-13",
  } as unknown as PartOneFactsView;

  it("keeps other names as a list: a box per name, added and removed on the one screen", async () => {
    const { w, walk, draft } = await walking("identity");
    Object.assign(draft, { first_name: "Ana", last_name: "Diaz" });
    walk.next();
    await nextTick();
    const add = w.findAllComponents(AppButton).find((b) => b.text() === APPLY_COPY.identity.addOtherName)!;
    await add.trigger("click");
    await add.trigger("click");
    const boxes = w.findAll("input");
    expect(boxes).toHaveLength(2);
    await boxes[1]!.setValue("Ana Lopez");
    expect(draft.other_names).toEqual(["", "Ana Lopez"]);
    await w.findAllComponents(AppButton).find((b) => b.text() === APPLY_COPY.identity.remove)!.trigger("click");
    expect(draft.other_names).toEqual(["Ana Lopez"]);
  });

  it("asks the SSN with its own control and its own save, never through the draft's answers", async () => {
    const { w, walk, draft } = await walking("identity");
    Object.assign(draft, { first_name: "Ana", last_name: "Diaz", email: "ana@example.com" });
    await walkTo(walk, "identity.ssn");
    expect(w.findComponent(SsnField).exists()).toBe(true);
    expect(w.findComponent(SsnField).props("token")).toBe("tok");
  });

  it("offers how-did-you-hear quick picks in the page's language, filing the English words", async () => {
    setApplyLanguage("es");
    const { w, walk, draft } = await walking("identity");
    Object.assign(draft, { first_name: "Ana", last_name: "Diaz", email: "ana@example.com" });
    draft.questionnaire = { position: "Chofer", applying_as: "company_driver" };
    await walkTo(walk, "questionnaire_answers.heard_from");
    const pick = w.findAllComponents(AppButton).find((b) => b.text() === "Un amigo o un chofer");
    expect(pick).toBeDefined();
    await pick!.trigger("click");
    expect(draft.questionnaire.heard_from).toBe("A friend or a driver");
    expect((w.find("input").element as HTMLInputElement).value).toBe("Un amigo o un chofer");
  });

  it("ends on Part 1's answers, read-only with \"Something wrong? Tell us\"", async () => {
    const { w, walk, draft } = await walking("identity", PART_ONE);
    draft.date_of_birth = "1980-04-01";
    Object.assign(draft, { first_name: "Ana", last_name: "Diaz", email: "ana@example.com" });
    draft.questionnaire = { position: "Driver", applying_as: "company_driver", heard_from: "Indeed", legally_work: true, proof_of_age: true };
    await walkTo(walk, "identity.part_one");
    expect(w.find("[data-part-one-facts]").text()).toContain("(312) 555-0142");
    expect(walk.atEnd.value).toBe(true);
  });
});
