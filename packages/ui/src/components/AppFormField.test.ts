import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import AppFormField from "./AppFormField.vue";
import AppInput from "./AppInput.vue";

/**
 * The seam between a labelled field and the control inside it.
 *
 * ⚠ Written 2026-09-11 because the seam was broken and nothing said so. `AppFormField` declared the
 * ARIA wiring on its `<slot>` tag, the template compiler camelised the names, and a caller spreading
 * them rendered `ariadescribedby` — an attribute no browser and no screen reader knows. The error was
 * visible in red and inaudible, which is the failure mode a form can least afford.
 */
const field = (props: Record<string, unknown>) =>
  mount(AppFormField, {
    props,
    slots: { default: (slotProps: Record<string, unknown>) => h(AppInput, { ...slotProps }) },
  });

describe("what a control is handed", () => {
  it("spreads ARIA attributes a browser recognises, not camelised ones", () => {
    const input = field({ label: "First name", error: "This is needed." }).find("input");
    expect(input.attributes("aria-describedby")).toBe(input.attributes("id") + "-description");
    expect(input.attributes("aria-invalid")).toBe("true");
    // The exact shape of the regression: a hyphen-free key that looks almost right in a DOM dump.
    expect(input.attributes("ariadescribedby")).toBeUndefined();
    expect(input.attributes("ariainvalid")).toBeUndefined();
  });

  it("points describedby at the element that actually holds the message", () => {
    const w = field({ label: "First name", error: "This is needed." });
    const id = w.find("input").attributes("aria-describedby")!;
    expect(w.find(`#${id}`).text()).toBe("This is needed.");
  });

  it("describes the hint when there is no error, so the two never both claim the id", () => {
    const w = field({ label: "Phone", hint: "So we can contact you." });
    const id = w.find("input").attributes("aria-describedby")!;
    expect(w.find(`#${id}`).text()).toBe("So we can contact you.");
    expect(w.find("input").attributes("aria-invalid")).toBeUndefined();
  });

  it("says nothing when there is nothing to say", () => {
    const input = field({ label: "Middle name" }).find("input");
    expect(input.attributes("aria-describedby")).toBeUndefined();
    expect(input.attributes("aria-invalid")).toBeUndefined();
    expect(input.attributes("aria-required")).toBeUndefined();
  });

  it("marks a required field for the reader who cannot see the asterisk", () => {
    expect(field({ label: "Last name", required: true }).find("input").attributes("aria-required")).toBe("true");
  });

  it("still gives the id to a caller that only wants that", () => {
    // Every existing call site destructures `{ id }` and nothing else; this is what keeps them working.
    const w = mount(AppFormField, {
      props: { label: "Licence number", id: "cdl" },
      slots: { default: ({ id }: { id: string }) => h("input", { id }) },
    });
    expect(w.find("input").attributes("id")).toBe("cdl");
    expect(w.find("label").attributes("for")).toBe("cdl");
  });
});
