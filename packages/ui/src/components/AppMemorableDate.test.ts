import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppMemorableDate from "./AppMemorableDate.vue";

/**
 * The three-box date (Q-AW12). What is pinned is the contract a caller relies on: a whole
 * `yyyy-MM-dd` or `""`, padding done here, what was typed kept while it is incomplete, and the labels
 * and descriptions reaching the boxes a screen reader lands on.
 */

const boxes = (w: ReturnType<typeof mount>) => w.findAll("input");
const emitted = (w: ReturnType<typeof mount>) =>
  (w.emitted("update:modelValue") ?? []).map((e) => e[0]);

describe("AppMemorableDate", () => {
  it("emits nothing but an empty string until all three boxes hold something that fits", async () => {
    const w = mount(AppMemorableDate);
    const [m, d] = boxes(w);
    await m!.setValue("3");
    await d!.setValue("7");
    expect(emitted(w)).toEqual(["", ""]);
  });

  it("pads month and day, so 3 / 7 / 1985 is 1985-03-07", async () => {
    const w = mount(AppMemorableDate);
    const [m, d, y] = boxes(w);
    await m!.setValue("3");
    await d!.setValue("7");
    await y!.setValue("1985");
    expect(emitted(w).at(-1)).toBe("1985-03-07");
  });

  it("does not judge whether the date is real — the caller's schema names that rule", async () => {
    const w = mount(AppMemorableDate);
    const [m, d, y] = boxes(w);
    await m!.setValue("2");
    await d!.setValue("31");
    await y!.setValue("2001");
    expect(emitted(w).at(-1)).toBe("2001-02-31");
  });

  it("keeps digits only, and no more than each box holds", async () => {
    const w = mount(AppMemorableDate);
    const [m, , y] = boxes(w);
    await m!.setValue("1a2b3");
    await y!.setValue("19855");
    expect((m!.element as HTMLInputElement).value).toBe("12");
    expect((y!.element as HTMLInputElement).value).toBe("1985");
  });

  it("shows a whole date it is given, in the boxes", () => {
    const w = mount(AppMemorableDate, { props: { modelValue: "1985-03-07" } });
    expect(boxes(w).map((b) => (b.element as HTMLInputElement).value)).toEqual(["03", "07", "1985"]);
  });

  /**
   * ⚠ The case that bites: a WHOLE date being edited. Clearing the year emits `""`, the parent's model
   * moves from the date to `""`, and the watcher fires — it must not wipe the two boxes still filled.
   */
  it("keeps a half-typed date when the parent's model moves to the empty string it was sent", async () => {
    const w = mount(AppMemorableDate, { props: { modelValue: "1985-03-07" } });
    const [m, d, y] = boxes(w);
    await y!.setValue("");
    expect(emitted(w).at(-1)).toBe("");
    await w.setProps({ modelValue: "" });
    expect([m, d, y].map((b) => (b!.element as HTMLInputElement).value)).toEqual(["03", "07", ""]);
  });

  it("puts the field's id on the month box and a label on every box", () => {
    const w = mount(AppMemorableDate, { props: { id: "dob" } });
    const inputs = boxes(w);
    expect(inputs[0]!.attributes("id")).toBe("dob");
    for (const input of inputs) {
      expect(w.find(`label[for="${input.attributes("id")}"]`).exists()).toBe(true);
    }
  });

  it("carries the form field's description onto every box, not the wrapper", () => {
    const w = mount(AppMemorableDate, { attrs: { "aria-describedby": "dob-description" } });
    for (const input of boxes(w)) expect(input.attributes("aria-describedby")).toBe("dob-description");
    expect(w.find("div").attributes("aria-describedby")).toBeUndefined();
  });

  it("opens the number pad and offers birthday autofill when asked", () => {
    const w = mount(AppMemorableDate, { props: { autocomplete: "bday" } });
    expect(boxes(w).map((b) => b.attributes("autocomplete"))).toEqual(["bday-month", "bday-day", "bday-year"]);
    for (const b of boxes(w)) expect(b.attributes("inputmode")).toBe("numeric");
  });
});
