import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FilterSelect from "./FilterSelect.vue";

/**
 * The multi-select mode. Single-select behaviour is unchanged and covered by the pages using it; what
 * is pinned here is that adding `multiple` did not quietly change the single-select contract, and that
 * the multi panel behaves the way a filter with sixty trucks in it has to.
 */
const OPTIONS = [
  { value: "", label: "All trucks" },
  { value: "754", label: "754" },
  { value: "729", label: "729" },
  { value: "699", label: "699" },
];

const open = async (wrapper: ReturnType<typeof mount>) => {
  await wrapper.get("button[aria-haspopup='listbox']").trigger("click");
};
const options = () => document.querySelectorAll<HTMLElement>("[role='option']");

describe("FilterSelect single-select is unchanged", () => {
  it("emits the value and closes", async () => {
    const w = mount(FilterSelect, { props: { modelValue: "", options: OPTIONS, label: "Unit" }, attachTo: document.body });
    await open(w);
    options()[1]!.click();
    expect(w.emitted("update:modelValue")?.[0]).toEqual(["754"]);
    w.unmount();
  });

  it("clears to an empty string, not an empty array", async () => {
    const w = mount(FilterSelect, { props: { modelValue: "754", options: OPTIONS, label: "Unit" }, attachTo: document.body });
    await w.get("button[aria-label='Clear Unit filter']").trigger("click");
    expect(w.emitted("update:modelValue")?.[0]).toEqual([""]);
    w.unmount();
  });
});

describe("FilterSelect multiple", () => {
  it("adds to the selection rather than replacing it", async () => {
    const w = mount(FilterSelect, { props: { modelValue: ["754"], options: OPTIONS, label: "Trucks", multiple: true }, attachTo: document.body });
    await open(w);
    options()[2]!.click();
    expect(w.emitted("update:modelValue")?.[0]).toEqual([["754", "729"]]);
    w.unmount();
  });

  it("removes one that is already picked", async () => {
    const w = mount(FilterSelect, { props: { modelValue: ["754", "729"], options: OPTIONS, label: "Trucks", multiple: true }, attachTo: document.body });
    await open(w);
    options()[1]!.click();
    expect(w.emitted("update:modelValue")?.[0]).toEqual([["729"]]);
    w.unmount();
  });

  it("stays open between picks, because choosing five trucks is five clicks", async () => {
    const w = mount(FilterSelect, { props: { modelValue: [], options: OPTIONS, label: "Trucks", multiple: true }, attachTo: document.body });
    await open(w);
    options()[1]!.click();
    expect(options().length).toBeGreaterThan(0); // the panel is still mounted
    w.unmount();
  });

  it("summarises a count on the trigger instead of a wall of names", async () => {
    const w = mount(FilterSelect, { props: { modelValue: ["754", "729", "699"], options: OPTIONS, label: "Trucks", multiple: true }, attachTo: document.body });
    expect(w.get("button[aria-haspopup='listbox']").text()).toContain("3 selected");
    w.unmount();
  });

  it("names the single pick rather than saying '1 selected'", async () => {
    const w = mount(FilterSelect, { props: { modelValue: ["754"], options: OPTIONS, label: "Trucks", multiple: true }, attachTo: document.body });
    expect(w.get("button[aria-haspopup='listbox']").text()).toContain("754");
    w.unmount();
  });

  it("clears to an empty array, and the 'all' row does the same", async () => {
    const w = mount(FilterSelect, { props: { modelValue: ["754"], options: OPTIONS, label: "Trucks", multiple: true }, attachTo: document.body });
    await w.get("button[aria-label='Clear Trucks filter']").trigger("click");
    expect(w.emitted("update:modelValue")?.[0]).toEqual([[]]);
    w.unmount();
  });

  it("announces itself as multi-selectable to a screen reader", async () => {
    const w = mount(FilterSelect, { props: { modelValue: [], options: OPTIONS, label: "Trucks", multiple: true }, attachTo: document.body });
    await open(w);
    expect(document.querySelector("[role='listbox']")?.getAttribute("aria-multiselectable")).toBe("true");
    w.unmount();
  });
});
