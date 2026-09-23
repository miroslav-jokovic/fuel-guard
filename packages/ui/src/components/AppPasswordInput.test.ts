import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppPasswordInput from "./AppPasswordInput.vue";

/**
 * The show/hide toggle on a password field.
 *
 * What is ours, and pinned: hidden by default, the button flips the input's `type` and says which way
 * it will go, and attributes reach the INPUT — an `AppFormField` label and a password manager both
 * find the field by `id` and `autocomplete`, and neither looks at a wrapper div.
 */
const mountField = () =>
  mount(AppPasswordInput, {
    props: { modelValue: "hunter2" },
    attrs: { id: "password", autocomplete: "current-password", required: true },
  });

const input = (w: ReturnType<typeof mountField>) => w.find("input").element as HTMLInputElement;

describe("AppPasswordInput", () => {
  it("starts hidden", () => {
    const w = mountField();
    expect(input(w).type).toBe("password");
    expect(w.find("button").attributes("aria-label")).toBe("Show password");
    expect(w.find("button").attributes("aria-pressed")).toBe("false");
  });

  it("shows the password, and hides it again, from the eye button", async () => {
    const w = mountField();
    await w.find("button").trigger("click");
    expect(input(w).type).toBe("text");
    expect(w.find("button").attributes("aria-label")).toBe("Hide password");
    expect(w.find("button").attributes("aria-pressed")).toBe("true");

    await w.find("button").trigger("click");
    expect(input(w).type).toBe("password");
  });

  it("puts id, autocomplete and required on the input, not the wrapper", () => {
    const w = mountField();
    expect(input(w).id).toBe("password");
    expect(input(w).getAttribute("autocomplete")).toBe("current-password");
    expect(input(w).required).toBe(true);
    expect(w.find("div").attributes("id")).toBeUndefined();
  });

  it("emits what is typed", async () => {
    const w = mountField();
    await w.find("input").setValue("correct horse");
    expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["correct horse"]);
  });

  it("is a plain button, so it can never submit the sign-in form", () => {
    expect(mountField().find("button").attributes("type")).toBe("button");
  });
});
