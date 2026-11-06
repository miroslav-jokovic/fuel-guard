import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

/**
 * The step-up prompt's three answers (Q-AD41 (b), 2026-11-06): a confirmed password lets the act through; a refused
 * one is told to check it; a server that cannot check any password says so and sends the person to an administrator,
 * instead of the "check your password" staging showed for two weeks while every password was right.
 */
const answer = vi.hoisted(() => ({ value: "verified" as "verified" | "refused" | "unavailable" }));
vi.mock("@/lib/stepUp", () => ({ verifyStepUp: async () => answer.value }));

import StepUpPrompt from "./StepUpPrompt.vue";

async function confirmWith(result: typeof answer.value) {
  answer.value = result;
  const w = mount(StepUpPrompt, { props: { reason: "Confirm your password to continue." } });
  await w.find("input[type=password]").setValue("hunter2");
  await w.find("form").trigger("submit");
  await flushPromises();
  return w;
}

beforeEach(() => {
  answer.value = "verified";
});

describe("StepUpPrompt", () => {
  it("a confirmed password lets the act through", async () => {
    const w = await confirmWith("verified");
    expect(w.emitted("confirmed")).toHaveLength(1);
    expect(w.text()).not.toContain("Could not confirm");
  });

  it("a refused password is told to check it, and nothing goes through", async () => {
    const w = await confirmWith("refused");
    expect(w.text()).toContain("Could not confirm your password. Check it and try again.");
    expect(w.find("input[type=password]").classes()).toContain("ring-danger-600");
    expect(w.emitted("confirmed")).toBeUndefined();
  });

  it("a server that cannot check passwords says so, and never blames the password", async () => {
    const w = await confirmWith("unavailable");
    expect(w.text()).toContain("The server can't confirm passwords right now. Tell your administrator.");
    expect(w.text()).not.toContain("Check it and try again");
    expect(w.find("input[type=password]").classes()).not.toContain("ring-danger-600");
    expect(w.emitted("confirmed")).toBeUndefined();
  });
});
