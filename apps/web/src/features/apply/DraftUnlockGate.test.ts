import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const unlock = vi.hoisted(() => vi.fn());
vi.mock("./useApplication", async (orig) => ({
  ...(await orig<typeof import("./useApplication")>()),
  unlockApplicationDraft: unlock,
}));
const DraftUnlockGate = (await import("./DraftUnlockGate.vue")).default;
const { APPLY_COPY } = await import("./strings");

/**
 * The date-of-birth gate (D-APP16) and what it hands up (C3c2c2): the body, and a v2 link's Part 1 facts.
 * Only a LOCKED answer is a wrong date; "unlocked, nothing to resume" is a real answer, not a failure.
 */
const answer = async (draft: Record<string, unknown>) => {
  unlock.mockResolvedValue({ draft });
  const w = mount(DraftUnlockGate, { props: { token: "t", carrier: "Silvicom Inc" } });
  w.findComponent({ name: "AppDateField" }).vm.$emit("update:modelValue", "1980-04-01");
  await flushPromises();
  await w.findAll("button").find((b) => b.text().includes(APPLY_COPY.unlock.action))!.trigger("click");
  await flushPromises();
  return w;
};

describe("the unlock gate", () => {
  it("hands up the body and Part 1's facts together", async () => {
    const partOne = { intake: { phone: "+13125550142" }, licences: [], asOf: "2026-09-27" };
    const w = await answer({ locked: false, payload: { first_name: "Susan" }, partOne, revision: 6 });
    expect(w.emitted("unlocked")![0]![0]).toEqual({ payload: { first_name: "Susan" }, partOne, revision: 6 });
  });

  it("treats an unlocked answer with no body as nothing to resume, never as a wrong date", async () => {
    const w = await answer({ locked: false, payload: null });
    // No revision served (an API from before C3d1b): null, which asks the server for no check.
    expect(w.emitted("unlocked")![0]![0]).toEqual({ payload: {}, partOne: null, revision: null });
    expect(w.text()).not.toContain(APPLY_COPY.unlock.failed);
  });

  it("says the date was wrong only when the answer is still locked, and hands up nothing", async () => {
    const w = await answer({ locked: true, payload: null });
    expect(w.emitted("unlocked")).toBeUndefined();
    expect(w.text()).toContain(APPLY_COPY.unlock.failed);
  });

  /** D-AW14 (C3s3a): only a SENT sign link counts, so only its answer carries the tries left. */
  it("says how many tries are left on a sent sign link, and nothing about tries on any other", async () => {
    const counted = await answer({ locked: true, payload: null, attemptsLeft: 2 });
    expect(counted.text()).toContain(APPLY_COPY.unlock.attemptsLeft(2));
    expect(counted.text()).toContain("2 more wrong answers");
    const last = await answer({ locked: true, payload: null, attemptsLeft: 1 });
    expect(last.text()).toContain("One more wrong answer");
    const uncounted = await answer({ locked: true, payload: null });
    expect(uncounted.text()).not.toContain("wrong answer");
  });

  it("stops asking once the link has stopped, and says to ask for it again", async () => {
    unlock.mockRejectedValue(Object.assign(new Error("stopped"), { code: "sign_link_locked" }));
    const w = mount(DraftUnlockGate, { props: { token: "t", carrier: "Silvicom Inc" } });
    w.findComponent({ name: "AppDateField" }).vm.$emit("update:modelValue", "1980-04-01");
    await flushPromises();
    await w.findAll("button").find((b) => b.text().includes(APPLY_COPY.unlock.action))!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain(APPLY_COPY.unlock.lockedOut("Silvicom Inc"));
    expect(w.findComponent({ name: "AppDateField" }).exists()).toBe(false);
    expect(w.findAll("button")).toHaveLength(0);
  });

  it("treats any other failure as a wrong answer to try again, never as a stopped link", async () => {
    unlock.mockRejectedValue(Object.assign(new Error("dead"), { code: "invalid_link" }));
    const w = mount(DraftUnlockGate, { props: { token: "t", carrier: "Silvicom Inc" } });
    w.findComponent({ name: "AppDateField" }).vm.$emit("update:modelValue", "1980-04-01");
    await flushPromises();
    await w.findAll("button").find((b) => b.text().includes(APPLY_COPY.unlock.action))!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain(APPLY_COPY.unlock.failed);
    expect(w.text()).not.toContain(APPLY_COPY.unlock.lockedOut("Silvicom Inc"));
  });
});
