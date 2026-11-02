import { beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { useConfirmStore } from "@silvicom/ui";
import EmployerFormDrawer from "./EmployerFormDrawer.vue";
import { blankEmployer, type EmployerFields } from "./employerRow";
import { EMPLOYMENT_FORM_COPY } from "./employmentCopy";

/**
 * One job in a panel, for every surface (HW5b). EM-5: Remove asks first — and because the confirm is
 * IN the panel, no surface can mount the form without it.
 */
const SlideOverStub = {
  template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "description"],
};
const copy = EMPLOYMENT_FORM_COPY;
const saved: EmployerFields = { ...blankEmployer(), employer_name: "Old Carrier", started_on: "2024-01-01" };

const panel = (props: Record<string, unknown> = {}) =>
  mount(EmployerFormDrawer, {
    props: { open: true, employer: saved, copy, idPrefix: "p", asOf: "2026-09-26", removable: true, ...props },
    global: { stubs: { SlideOver: SlideOverStub } },
    attachTo: document.body,
  });
const press = (w: ReturnType<typeof panel>, label: string) =>
  w.findAll("button").find((b) => b.text().trim() === label)!.trigger("click");

beforeEach(() => setActivePinia(createPinia()));

describe("removing a job (EM-5)", () => {
  it("asks first, naming the job, and removes nothing until the answer is yes", async () => {
    const w = panel();
    await press(w, copy.removeJob);
    await flushPromises();
    const confirm = useConfirmStore();
    expect(confirm.pending).toMatchObject({ title: "Remove Old Carrier?", confirmLabel: copy.removeConfirm, tone: "danger" });
    expect(w.emitted("remove")).toBeUndefined();
    confirm.answer(true);
    await flushPromises();
    expect(w.emitted("remove")).toHaveLength(1);
    w.unmount();
  });

  it("removes nothing when the answer is no", async () => {
    const w = panel();
    await press(w, copy.removeJob);
    await flushPromises();
    useConfirmStore().answer(false);
    await flushPromises();
    expect(w.emitted("remove")).toBeUndefined();
    w.unmount();
  });

  it("asks in the page's own words, Cancel included", async () => {
    const w = panel({ copy: { ...copy, drawerCancel: "Cancelar" } });
    await press(w, copy.removeJob);
    await flushPromises();
    expect(useConfirmStore().pending?.cancelLabel).toBe("Cancelar");
    w.unmount();
  });

  it("offers no Remove for a new job — Cancel already discards it", () => {
    const w = panel({ employer: null, removable: false });
    expect(w.findAll("button").some((b) => b.text().trim() === copy.removeJob)).toBe(false);
    w.unmount();
  });
});

describe("saving and cancelling", () => {
  it("edits a copy: Save hands it over, and the job it was given is untouched", async () => {
    const w = panel();
    await w.find("#p-employer_name").setValue("Renamed");
    expect(saved.employer_name).toBe("Old Carrier");
    await press(w, copy.drawerSave);
    expect((w.emitted("save")![0]![0] as EmployerFields).employer_name).toBe("Renamed");
    w.unmount();
  });

  it("hands the working copy back on Cancel, so a list can keep what was typed", async () => {
    const w = panel({ employer: null });
    await w.find("#p-employer_name").setValue("Half Carrier");
    await press(w, copy.drawerCancel);
    expect((w.emitted("close")![0]![0] as EmployerFields).employer_name).toBe("Half Carrier");
    w.unmount();
  });

  it("starts a new job from a gap's dates", () => {
    const w = panel({ employer: null, prefill: { started_on: "2024-02-01", ended_on: "2024-06-01" } });
    const dates = w.findAllComponents({ name: "AppDateField" }).map((d) => d.props("modelValue"));
    expect(dates).toEqual(["2024-02-01", "2024-06-01"]);
    w.unmount();
  });

  it("shows the surface's refusal under its box and moves the cursor to the first one", async () => {
    const w = panel();
    await w.setProps({ errors: { reason_for_leaving: "Say why you left this job" } });
    await flushPromises();
    expect(w.find("#p-reason_for_leaving").attributes("aria-invalid")).toBe("true");
    expect(w.text()).toContain("Say why you left this job");
    expect(document.activeElement?.id).toBe("p-reason_for_leaving");
    w.unmount();
  });
});
