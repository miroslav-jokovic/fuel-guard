import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppDateField from "./AppDateField.vue";
import AppDateTimeField from "./AppDateTimeField.vue";
import AppMonthField from "./AppMonthField.vue";

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
  it("shows ONE clear control, not the library's as well", async () => {
    // Reported 2026-09-01: two X's side by side. VueDatePicker renders its own clear button even
    // when `#dp-input` replaces its input, so the field carried ours ("Clear date") AND its own
    // ("Clear value"). `:clearable="false"` is what removes the second; without it this counts two.
    const w = await field();
    const labels = w.findAll("button").map((b) => b.attributes("aria-label") ?? "");
    expect(labels.filter((l) => /clear/i.test(l))).toEqual(["Clear date"]);
  });

  it("still clears through OUR button", async () => {
    const w = await field();
    await w.findAll("button").find((b) => b.attributes("aria-label") === "Clear date")!.trigger("click");
    // `""`, never null — the contract this component's header states.
    expect(w.emitted("update:modelValue")?.at(-1)).toEqual([""]);
  });

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

/**
 * The month shape (D-AX4), which replaces five regex-validated text boxes in the driver application.
 *
 * ⚠ Every assertion here is about the LIBRARY doing what the prop promises, because that is the part
 * that could not be known by reading: VueDatePicker's month-picker mode emits `{ month, year }`
 * objects by default, and whether `model-type` still governs it is a fact about v14 and not about
 * this component. If these pass, `yyyy-MM` in and `yyyy-MM` out is real.
 */
describe("the month shape of the same control", () => {
  const monthField = async (props: Record<string, unknown> = {}) => {
    const w = mount(AppMonthField, { props: { modelValue: "2024-03", ...props } });
    await flush();
    return w;
  };

  it("takes a `yyyy-MM` value and shows it as a month, with no day in sight", async () => {
    expect(shown(await monthField())).toBe("03/2024");
  });

  it("gives back `yyyy-MM`, which is what the contract stores", async () => {
    // The regex these fields used to carry was `/^\d{4}-\d{2}$/`; a picker that emitted a full date
    // would fail that schema at the Send button rather than at the field, which is the worst place.
    const w = await monthField();
    await w.find("input").setValue("11/2025");
    await w.find("input").trigger("keydown.enter");
    await flush();
    expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["2025-11"]);
  });

  it("shows nothing for an empty value rather than this month", async () => {
    expect(shown(await monthField({ modelValue: "" }))).toBe("");
    expect(shown(await monthField({ modelValue: null }))).toBe("");
  });

  it("says month, not date, on both of its buttons", async () => {
    // A screen reader announcing "choose a date" on a control that offers months is a small lie, and
    // the person it misleads is the one who most depends on the label being true.
    const w = await monthField();
    const labels = w.findAll("button").map((b) => b.attributes("aria-label") ?? "");
    expect(labels).toContain("Choose a month");
    expect(labels).toContain("Clear month");
    expect(labels.filter((l) => /clear/i.test(l))).toEqual(["Clear month"]);
  });

  it("clears to an empty string like every other shape", async () => {
    const w = await monthField();
    await w.find('button[aria-label="Clear month"]').trigger("click");
    expect(w.emitted("update:modelValue")?.at(-1)).toEqual([""]);
  });

  it("leaves the day field's wording untouched", async () => {
    // The day shape's labels are asserted by name above; this is the guard that the shared `noun`
    // did not quietly reword them.
    const w = await field();
    expect(w.find('button[aria-label="Choose a date"]').exists()).toBe(true);
  });
});
