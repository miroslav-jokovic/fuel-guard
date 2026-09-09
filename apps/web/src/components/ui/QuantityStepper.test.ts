import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import QuantityStepper from "./QuantityStepper.vue";

/**
 * The number a technician types with one thumb (INVENTORY-PLAN.md I5).
 *
 * Each assertion here is a failure this control exists to prevent, and every one of them is
 * invisible in a desk browser:
 *
 *   · **`type="number"` is banned.** A stray scroll over a focused numeric input changes the value
 *     silently, the spinner arrows are a 12 px target beside a 48 px one, and `valueAsNumber` is
 *     `NaN` for an empty field. `inputmode="numeric"` gives the keypad with none of that;
 *   · **empty is null, not zero.** A shelf nobody has typed a number for has no count. Emitting 0
 *     for a blank field records a shortage the technician never observed;
 *   · **zero is reachable in one tap.** "None left" is the commonest answer on a shelf walk, and
 *     tapping − eleven times to get there is how somebody stops counting honestly;
 *   · **the value is selected on focus**, so a thumb landing in a field showing `12` and typing `8`
 *     records 8 and not 128 or 812.
 */

const stepper = (modelValue: number | null = null) =>
  mount(QuantityStepper, { props: { modelValue }, attachTo: document.body });
const emitted = (w: ReturnType<typeof stepper>) =>
  (w.emitted("update:modelValue") ?? []).map((e) => (e as [number | null])[0]);

describe("the field itself", () => {
  it("is NEVER type=number — the whole reason this component exists", () => {
    const input = stepper(12).find("input");
    expect(input.attributes("type")).toBe("text");
    expect(input.attributes("inputmode")).toBe("numeric");
  });

  it("shows nothing at all when there is no count yet", () => {
    expect(stepper(null).find("input").element.value).toBe("");
  });

  it("emits null for an emptied field, because empty is not zero", async () => {
    const w = stepper(12);
    await w.find("input").setValue("");
    expect(emitted(w).at(-1)).toBeNull();
  });

  it("strips anything that is not a digit, so a stray keypad decimal cannot become NaN", async () => {
    const w = stepper(null);
    await w.find("input").setValue("1.2");
    expect(emitted(w).at(-1)).toBe(12);
    expect(w.find("input").element.value).toBe("12");
  });

  it("selects its value on focus, so typing replaces rather than appends", async () => {
    const w = stepper(12);
    const input = w.find("input").element as HTMLInputElement;
    await w.find("input").trigger("focus");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(2);
  });
});

describe("the thumb targets", () => {
  /**
   * ⚠ The steps compound against what the FIELD shows, not against the prop it was mounted with.
   * That is the behaviour a `v-model` parent produces anyway, and it is what makes − after + land
   * back where it started rather than two below — a stepper that re-read a stale prop on every tap
   * would move by one and then snap back, which is the bug this assertion is shaped to catch.
   */
  it("steps from what is on screen, so + then − returns to where it started", async () => {
    const w = stepper(4);
    await w.get('[aria-label="One more Counted"]').trigger("click");
    expect(emitted(w).at(-1)).toBe(5);
    await w.get('[aria-label="One fewer Counted"]').trigger("click");
    expect(emitted(w).at(-1)).toBe(4);
  });

  it("treats an empty field as a start of zero rather than NaN", async () => {
    const w = stepper(null);
    await w.get('[aria-label="One more Counted"]').trigger("click");
    expect(emitted(w).at(-1)).toBe(1);
  });

  it("floors at zero, because there is no negative number of things on a shelf", async () => {
    const w = stepper(0);
    await w.get('[aria-label="One fewer Counted"]').trigger("click");
    expect(emitted(w).at(-1)).toBe(0);
  });

  it("reaches zero in ONE tap from any quantity", async () => {
    const w = stepper(11);
    await w.findAll("button").find((b) => b.text() === "0")!.trigger("click");
    expect(emitted(w).at(-1)).toBe(0);
  });
});
