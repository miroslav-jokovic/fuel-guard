import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FilterSelect from "./FilterSelect.vue";

/**
 * An option's figure has its own column (2026-10-19). The Dispatcher filter used to put its counts in
 * the label, and on the 240 px panel "ANETA · Aneta Maslenkova (9, 4 empty now)" truncated before the
 * count. Now the name truncates, the figure does not, and the trigger names only what is chosen.
 */
const options = [
  { value: "", label: "All", count: "206 · 102 empty" },
  { value: "IVO", label: "IVO", count: "15 · 6 empty" },
];

describe("FilterSelect's count column", () => {
  it("draws each figure apart from its name, where truncation cannot reach it", async () => {
    const w = mount(FilterSelect, { props: { modelValue: "", options, label: "Dispatcher" }, attachTo: document.body });
    await w.find("button").trigger("click");
    await flushPromises();
    const row = [...document.querySelectorAll<HTMLElement>("[role='option']")].find((b) => b.textContent?.includes("IVO"))!;
    const [name, figure] = [...row.querySelectorAll("span")].filter((s) => !s.getAttribute("aria-hidden"));
    expect(name!.textContent).toBe("IVO");
    expect(name!.className).toContain("truncate");
    expect(figure!.textContent).toBe("15 · 6 empty");
    expect(figure!.className).toContain("shrink-0");
    expect(figure!.className).not.toContain("truncate");
    w.unmount();
  });

  it("names only the choice on the trigger, without its figure", () => {
    const w = mount(FilterSelect, { props: { modelValue: "IVO", options, label: "Dispatcher" } });
    expect(w.find("button").text()).toContain("Dispatcher: IVO");
    expect(w.find("button").text()).not.toContain("15");
  });
});
