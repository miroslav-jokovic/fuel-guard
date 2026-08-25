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

  /**
   * ── THE AFFORDANCE, NOT JUST THE BEHAVIOUR ────────────────────────────────────────────────────
   * Every test above proves the multi-select WORKS. All of them passed while an unchosen truck
   * rendered nothing at all — no box, no outline — because the mode reused single-select's
   * `opacity-0` tick. A filter can be completely correct and still give the user no sign it takes
   * more than one answer, so what a row LOOKS like is pinned here alongside what it emits.
   */
  const boxes = () => document.querySelectorAll<HTMLElement>("[role='option'] span[aria-hidden='true']");

  it("draws a box on every row, including the ones not picked", async () => {
    const w = mount(FilterSelect, { props: { modelValue: ["754"], options: OPTIONS, label: "Trucks", multiple: true }, attachTo: document.body });
    await open(w);
    expect(boxes().length).toBe(OPTIONS.length);
    // The empty ones carry a visible border rather than nothing at all.
    const unpicked = boxes()[2]!;
    expect(unpicked.className).toContain("border-edge-control");
    expect(unpicked.className).not.toContain("opacity-0");
    w.unmount();
  });

  it("fills the box of a picked row and leaves the rest outlined", async () => {
    const w = mount(FilterSelect, { props: { modelValue: ["754"], options: OPTIONS, label: "Trucks", multiple: true }, attachTo: document.body });
    await open(w);
    expect(boxes()[1]!.className).toContain("bg-brand-600");
    expect(boxes()[2]!.className).toContain("bg-surface");
    w.unmount();
  });

  it("ticks the 'all' row when nothing is picked, so the panel agrees with the trigger", async () => {
    const w = mount(FilterSelect, { props: { modelValue: [], options: OPTIONS, label: "Trucks", multiple: true }, attachTo: document.body });
    await open(w);
    expect(boxes()[0]!.className).toContain("bg-brand-600");
    w.unmount();
  });

  it("keeps the box out of the accessibility tree — aria-selected is what is announced", async () => {
    const w = mount(FilterSelect, { props: { modelValue: ["754"], options: OPTIONS, label: "Trucks", multiple: true }, attachTo: document.body });
    await open(w);
    expect(boxes()[1]!.getAttribute("aria-hidden")).toBe("true");
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
    // A nested focusable control would break both the listbox and the arrow-key handling.
    expect(document.querySelectorAll("[role='option'] input").length).toBe(0);
    w.unmount();
  });

  it("does not put boxes on a single-select panel, where exactly one row is in force", async () => {
    const w = mount(FilterSelect, { props: { modelValue: "754", options: OPTIONS, label: "Unit" }, attachTo: document.body });
    await open(w);
    expect(boxes().length).toBe(0);
    w.unmount();
  });

  it("announces itself as multi-selectable to a screen reader", async () => {
    const w = mount(FilterSelect, { props: { modelValue: [], options: OPTIONS, label: "Trucks", multiple: true }, attachTo: document.body });
    await open(w);
    expect(document.querySelector("[role='listbox']")?.getAttribute("aria-multiselectable")).toBe("true");
    w.unmount();
  });
});
