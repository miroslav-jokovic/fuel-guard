import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, reactive, ref } from "vue";
import { AppButton } from "@silvicom/ui";
import type { ApplicationSection } from "@silvicom/shared";
import { emptyDraft, type ApplicationDraft } from "@/features/apply/draft";
import { setApplyLanguage } from "@/features/apply/language";
import { APPLY_COPY } from "@/features/apply/strings";
import type { SectionIssue } from "@/features/apply/useApplicationWizard";
import TaskWalk from "./TaskWalk.vue";
import { useTaskWalk } from "./useTaskWalk";

/** The open task drawn one screen at a time (F4 PR 1b-1): where the driver is, whose row, and its removal. */
async function walking() {
  const draft = reactive<ApplicationDraft>(emptyDraft());
  const inTask = ref(false);
  const issues = ref<SectionIssue[]>([]);
  const walk = useTaskWalk(
    draft,
    { section: ref<ApplicationSection>("safety"), issues, setIssues: (v) => { issues.value = v; }, focusIssue: vi.fn() },
    { inTask, finish: vi.fn(), leave: vi.fn() },
    () => "2026-11-13",
  );
  inTask.value = true;
  await nextTick();
  return { draft, walk, w: mount(TaskWalk, { props: { walk } }) };
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
