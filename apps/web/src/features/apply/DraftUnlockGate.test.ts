import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const unlock = vi.hoisted(() => vi.fn());
const code = vi.hoisted(() => ({ request: vi.fn(), verify: vi.fn() }));
vi.mock("./useApplication", async (orig) => ({
  ...(await orig<typeof import("./useApplication")>()),
  unlockApplicationDraft: unlock,
}));
vi.mock("./unlockCode", () => ({ requestUnlockCode: code.request, unlockWithCode: code.verify }));
const DraftUnlockGate = (await import("./DraftUnlockGate.vue")).default;
const { APPLY_COPY } = await import("./strings");

/**
 * The date-of-birth gate (D-APP16) and what it hands up (C3c2c2): the body, and a v2 link's Part 1 facts.
 * Only a LOCKED answer is a wrong date; "unlocked, nothing to resume" is a real answer, not a failure.
 */
const answer = async (draft: Record<string, unknown>) => {
  unlock.mockResolvedValue({ draft });
  const w = mount(DraftUnlockGate, { props: { token: "t", carrier: "Silvicom Inc" } });
  w.findComponent({ name: "AppTypedDate" }).vm.$emit("update:modelValue", "1980-04-01");
  await flushPromises();
  await w.findAll("button").find((b) => b.text().includes(APPLY_COPY.unlock.action))!.trigger("click");
  await flushPromises();
  return w;
};

describe("the unlock gate", () => {
  /**
   * D-AM6 (APPLICATION-SCREEN-MAP §9): the date of birth is TYPED, the way it is written on paper — the
   * real box, real keystrokes, not a component event. Eight digits are the date; four ask for the year.
   */
  it("⚠ takes a date of birth typed as 04011980, says it in words, and asks for the year when given only 0401", async () => {
    unlock.mockResolvedValue({ draft: { locked: false, payload: {}, revision: 1 } });
    const w = mount(DraftUnlockGate, { props: { token: "t", carrier: "Silvicom Inc" } });
    const box = w.find("input[inputmode='numeric']");
    await box.setValue("0401");
    expect(w.text()).toContain(APPLY_COPY.dates.problems.needsYear);
    expect(w.findAll("button").find((b) => b.text().includes(APPLY_COPY.unlock.action))!.attributes("disabled")).toBeDefined();

    await box.setValue("04011980");
    expect((box.element as HTMLInputElement).value).toBe("04/01/1980");
    expect(w.text()).toContain("April 1, 1980");
    await w.findAll("button").find((b) => b.text().includes(APPLY_COPY.unlock.action))!.trigger("click");
    await flushPromises();
    expect(unlock).toHaveBeenLastCalledWith("t", "1980-04-01");
  });

  it("hands up the body and Part 1's facts together", async () => {
    const partOne = { intake: { phone: "+13125550142" }, licences: [], asOf: "2026-09-27" };
    const w = await answer({ locked: false, payload: { first_name: "Susan" }, partOne, revision: 6 });
    expect(w.emitted("unlocked")![0]![0]).toEqual({ payload: { first_name: "Susan" }, partOne, revision: 6 });
  });

  it("treats an unlocked answer with no body as nothing to resume, never as a wrong date", async () => {
    const w = await answer({ locked: false, payload: null, revision: 0 });
    // Revision 0: nothing saved yet, which the first save names as its expectation.
    expect(w.emitted("unlocked")![0]![0]).toEqual({ payload: {}, partOne: null, revision: 0 });
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
    w.findComponent({ name: "AppTypedDate" }).vm.$emit("update:modelValue", "1980-04-01");
    await flushPromises();
    await w.findAll("button").find((b) => b.text().includes(APPLY_COPY.unlock.action))!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain(APPLY_COPY.unlock.lockedOut("Silvicom Inc"));
    expect(w.findComponent({ name: "AppTypedDate" }).exists()).toBe(false);
    expect(w.findAll("button")).toHaveLength(0);
  });

  it("treats any other failure as a wrong answer to try again, never as a stopped link", async () => {
    unlock.mockRejectedValue(Object.assign(new Error("dead"), { code: "invalid_link" }));
    const w = mount(DraftUnlockGate, { props: { token: "t", carrier: "Silvicom Inc" } });
    w.findComponent({ name: "AppTypedDate" }).vm.$emit("update:modelValue", "1980-04-01");
    await flushPromises();
    await w.findAll("button").find((b) => b.text().includes(APPLY_COPY.unlock.action))!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain(APPLY_COPY.unlock.failed);
    expect(w.text()).not.toContain(APPLY_COPY.unlock.lockedOut("Silvicom Inc"));
  });
});

/**
 * F0b: when the date of birth ON FILE is wrong, the driver's own right answer never matches — so once
 * one answer has failed, the screen offers a code sent where the link went, and a right code hands up
 * the same release the date would.
 */
describe("a code in place of the date of birth (F0b)", () => {
  const button = (w: ReturnType<typeof mount>, text: string) => w.findAll("button").find((b) => b.text().includes(text))!;
  const failedOnce = async () => {
    const w = await answer({ locked: true, payload: null, revision: 0 });
    expect(w.text()).toContain(APPLY_COPY.unlock.failed);
    return w;
  };

  it("is not offered before a date of birth has failed", () => {
    const w = mount(DraftUnlockGate, { props: { token: "t", carrier: "Silvicom Inc" } });
    expect(w.find("[data-unlock-code]").exists()).toBe(false);
  });

  it("emails a code, says where masked, and opens the application with it", async () => {
    code.request.mockResolvedValue({ outcome: "sent", channel: "email", to: "s•••@example.test", expiresInMinutes: 10 });
    code.verify.mockResolvedValue({ draft: { locked: false, payload: { first_name: "Susan" }, revision: 4 } });
    const w = await failedOnce();
    await button(w, APPLY_COPY.unlock.codeByEmail).trigger("click");
    await flushPromises();
    expect(code.request).toHaveBeenCalledWith("t", "email", "en");
    expect(w.text()).toContain(APPLY_COPY.unlock.codeSent("s•••@example.test", 10));

    await w.find("[data-unlock-code] input").setValue("042917");
    await button(w, APPLY_COPY.unlock.codeAction).trigger("click");
    await flushPromises();
    expect(code.verify).toHaveBeenCalledWith("t", "042917");
    expect(w.emitted("unlocked")![0]![0]).toEqual({ payload: { first_name: "Susan" }, partOne: null, revision: 4 });
  });

  it("says why a text could not go, in the driver's words, and offers no code box", async () => {
    code.request.mockResolvedValue({ outcome: "held", channel: "sms", held: "quiet_hours" });
    const w = await failedOnce();
    await button(w, APPLY_COPY.unlock.codeByText).trigger("click");
    await flushPromises();
    expect(w.text()).toContain(APPLY_COPY.unlock.codeHeld.quiet_hours);
    expect(w.find("[data-unlock-code] input").exists()).toBe(false);
  });

  it("says a wrong or spent code is refused, and hands up nothing", async () => {
    code.request.mockResolvedValue({ outcome: "sent", channel: "email", to: "s•••@example.test", expiresInMinutes: 10 });
    code.verify.mockRejectedValue(Object.assign(new Error("no"), { code: "code_not_accepted" }));
    const w = await failedOnce();
    await button(w, APPLY_COPY.unlock.codeByEmail).trigger("click");
    await flushPromises();
    await w.find("[data-unlock-code] input").setValue("000000");
    await button(w, APPLY_COPY.unlock.codeAction).trigger("click");
    await flushPromises();
    expect(w.text()).toContain(APPLY_COPY.unlock.codeRefused);
    expect(w.emitted("unlocked")).toBeUndefined();
  });
});

