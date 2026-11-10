import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppTypedDate from "./AppTypedDate.vue";

/** APPLICATION-SCREEN-MAP §9 (D-AM6): the box the driver types a date into. */
const TODAY = "2026-11-09";
const box = (props: Record<string, unknown> = {}) =>
  mount(AppTypedDate, { props: { id: "d", today: TODAY, ...props } });

async function type(w: ReturnType<typeof box>, value: string) {
  await w.find("input").setValue(value);
}

describe("typing a date", () => {
  it("draws the slashes, emits the day, and says it in words — 1001 is October 1 of this year", async () => {
    const w = box();
    await type(w, "1001");
    expect((w.find("input").element as HTMLInputElement).value).toBe("10/01");
    expect(w.emitted("update:modelValue")!.at(-1)).toEqual(["2026-10-01"]);
    expect(w.find("[data-testid='typed-date-reading']").text()).toBe("October 1, 2026");
  });

  it("reads 10011985 as October 1, 1985, in the page's language", async () => {
    const w = box({ kind: "dob", language: "es" });
    await type(w, "10011985");
    expect(w.emitted("update:modelValue")!.at(-1)).toEqual(["1985-10-01"]);
    expect(w.find("[data-testid='typed-date-reading']").text()).toBe("1 de octubre de 1985");
  });

  it("emits nothing and says why when the date cannot be, and says nothing while it is half-typed", async () => {
    const w = box();
    await type(w, "0230");
    expect(w.emitted("update:modelValue")!.at(-1)).toEqual([""]);
    expect(w.find("[data-testid='typed-date-reading']").text()).toBe("That month does not have that day.");
    expect(w.find("input").attributes("aria-invalid")).toBe("true");

    await type(w, "10/0");
    expect(w.find("[data-testid='typed-date-reading']").text()).toBe("");
    expect(w.find("input").attributes("aria-invalid")).toBeUndefined();
  });

  it("asks a date of birth for its year instead of assuming this one", async () => {
    const w = box({ kind: "dob", problems: { needsYear: "Falta el año." } });
    await type(w, "1001");
    expect(w.emitted("update:modelValue")!.at(-1)).toEqual([""]);
    expect(w.find("[data-testid='typed-date-reading']").text()).toBe("Falta el año.");
  });

  it("shows a stored value the way it would have been typed, and opens the number pad", () => {
    const w = box({ modelValue: "1985-10-01" });
    const input = w.find("input");
    expect((input.element as HTMLInputElement).value).toBe("10/01/1985");
    expect(input.attributes("inputmode")).toBe("numeric");
    // The words are announced with whatever the field already describes the box with.
    expect(input.attributes("aria-describedby")).toContain("d-reading");
  });

  it("takes a month on a month field", async () => {
    const w = box({ kind: "month" });
    await type(w, "0319");
    expect(w.emitted("update:modelValue")!.at(-1)).toEqual(["2019-03"]);
    expect(w.find("[data-testid='typed-date-reading']").text()).toBe("March 2019");
  });

  it("keeps a half-typed date when the parent re-renders with no value", async () => {
    const w = box();
    await type(w, "10/0");
    await w.setProps({ modelValue: "" });
    expect((w.find("input").element as HTMLInputElement).value).toBe("10/0");
  });
});
