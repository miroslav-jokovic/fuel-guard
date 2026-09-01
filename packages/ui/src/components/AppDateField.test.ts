import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppDateField from "./AppDateField.vue";
import AppDateTimeField from "./AppDateTimeField.vue";

/**
 * The date field, after it stopped being `<input type="date">` (D-DS17).
 *
 * ── WHAT IS WORTH PINNING HERE, AND WHAT IS NOT ────────────────────────────────────────────────
 * Not the calendar. Choosing a day, the arrow keys, the month grid and the Escape handling belong to
 * VueDatePicker and have their own suite upstream; asserting them here would test the dependency.
 *
 * What is ours is the seam, and every case below is a way the seam has a history of going wrong:
 * the `id` reaching the real input the `#dp-input` slot renders (an `AppFormField` label pointing at
 * nothing is a label no screen reader reads), the ISO string in and the formatted string out, `""`
 * rather than `null` on the way back, and the popup state living on a button instead of on the input.
 */

const shown = (w: { find: (s: string) => { element: Element } }) =>
  (w.find("input").element as HTMLInputElement).value;

/**
 * Awaited, and that is not incidental: VueDatePicker formats the input's display value in a watcher
 * that runs AFTER mount, so a synchronous read sees an empty field on a component holding a date.
 * Every "the picker shows nothing" report should start by checking this — the first version of this
 * file read synchronously and reported three failures against a component that was correct.
 */
const field = async (props: Record<string, unknown> = {}) => {
  const w = mount(AppDateField, { props: { modelValue: "2026-06-16", ...props } });
  await flush();
  return w;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the seam between the caller and the picker", () => {
  it("puts the caller's id on the real input, so a FormField label still points at something", async () => {
    const w = await field({ id: "issued-on" });
    expect(w.find("input").attributes("id")).toBe("issued-on");
  });

  it("passes an aria-label through to the input as well — some callers have no visible label", async () => {
    const w = await field({ "aria-label": "Repair date for brake hose" });
    expect(w.find("input").attributes("aria-label")).toBe("Repair date for brake hose");
  });

  it("takes an ISO value and shows it the way this product writes dates", async () => {
    expect(shown(await field())).toBe("06/16/2026");
  });

  it("shows nothing at all for an empty value, rather than a formatted epoch", async () => {
    // `""` and `null` both mean "no date chosen" and both arrive from real callers; a picker handed
    // an empty string can otherwise decide that is 1970.
    expect(shown(await field({ modelValue: "" }))).toBe("");
    expect(shown(await field({ modelValue: null }))).toBe("");
  });

  it("gives back an empty string when cleared, never null", async () => {
    // `''::date` is a Postgres error and callers branch on `v === ""` (`InspectionItemRow`), so the
    // string the native input used to emit has to keep being the string that travels.
    const w = await field();
    await w.find('button[aria-label="Clear date"]').trigger("click");
    expect(w.emitted("update:modelValue")).toEqual([[""]]);
  });

  it("offers nothing to clear when there is nothing in the field", async () => {
    const w = await field({ modelValue: "" });
    expect(w.find('button[aria-label="Clear date"]').exists()).toBe(false);
  });
});

describe("who owns the popup state", () => {
  it("keeps it on the calendar button and off the input", async () => {
    // `aria-expanded` on a plain text input is an `aria-allowed-attr` violation, which is how this
    // was found — `accessibilityPrimitives.test.ts` failed on the first version of this component.
    const w = await field();
    const button = w.find('button[aria-label="Choose a date"]');
    expect(button.attributes("aria-haspopup")).toBe("dialog");
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(w.find("input").attributes("aria-expanded")).toBeUndefined();
  });

  it("disables the calendar with the field, so a completed report offers no way in", async () => {
    const w = await field({ disabled: true });
    expect(w.find('button[aria-label="Choose a date"]').attributes("disabled")).toBeDefined();
    expect(w.find("input").attributes("disabled")).toBeDefined();
    expect(w.find('button[aria-label="Clear date"]').exists()).toBe(false);
  });
});

describe("the date-and-time shape of the same control", () => {
  it("reads the wire format `datetime-local` used, so FillUpForm and the hazmat card are untouched", async () => {
    const w = mount(AppDateTimeField, { props: { modelValue: "2026-06-16T14:30" } });
    await flush();
    expect(shown(w)).toBe("06/16/2026 14:30");
  });
});
