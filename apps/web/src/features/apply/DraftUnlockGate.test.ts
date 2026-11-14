import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const unlock = vi.hoisted(() => vi.fn());
const code = vi.hoisted(() => ({ request: vi.fn(), verify: vi.fn(), device: vi.fn() }));
const memory = vi.hoisted(() => ({ read: vi.fn(async (): Promise<string | null> => null), keep: vi.fn(async () => {}), forget: vi.fn(async () => {}) }));
vi.mock("./unlockCode", () => ({
  unlockApplicationDraft: unlock, requestUnlockCode: code.request, unlockWithCode: code.verify, unlockWithDevice: code.device,
}));
vi.mock("./deviceMemory", () => ({ readDeviceToken: memory.read, keepDeviceToken: memory.keep, forgetDeviceToken: memory.forget }));
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
    // No device store was provided (a bundle with no `localKey`): nothing can be remembered, so nothing is asked.
    expect(unlock).toHaveBeenLastCalledWith("t", "1980-04-01", false);
  });

  it("hands up the body and Part 1's facts together", async () => {
    const partOne = { intake: { phone: "+13125550142" }, licences: [], asOf: "2026-09-27" };
    const w = await answer({ locked: false, payload: { first_name: "Susan" }, partOne, revision: 6 });
    expect(w.emitted("unlocked")![0]![0]).toEqual({ payload: { first_name: "Susan" }, partOne, revision: 6, ssnLast4: null });
  });

  /** Q-AM3 (0589): the last four of the SSN on file ride up with the body, and nothing more of it. */
  it("hands up the last four of a saved SSN with the body", async () => {
    const w = await answer({ locked: false, payload: {}, revision: 2, ssnLast4: "6789" });
    expect(w.emitted("unlocked")![0]![0]).toMatchObject({ ssnLast4: "6789" });
  });

  it("treats an unlocked answer with no body as nothing to resume, never as a wrong date", async () => {
    const w = await answer({ locked: false, payload: null, revision: 0 });
    // Revision 0: nothing saved yet, which the first save names as its expectation.
    expect(w.emitted("unlocked")![0]![0]).toEqual({ payload: {}, partOne: null, revision: 0, ssnLast4: null });
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
    expect(code.verify).toHaveBeenCalledWith("t", "042917", false);
    expect(w.emitted("unlocked")![0]![0]).toEqual({ payload: { first_name: "Susan" }, partOne: null, revision: 4, ssnLast4: null });
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

/**
 * U2 (0604): the date of birth is asked once per phone. A right answer with "This is my phone" ticked
 * leaves a token on the device; the next visit sends it before asking anything.
 */
describe("a remembered phone", () => {
  const SPEC = { key: "k".repeat(64), linkExpiresAt: "2099-01-01T00:00:00Z" };
  const RELEASED = { locked: false, payload: { first_name: "Susan" }, revision: 2 };
  const atDesk = (desktop: boolean) =>
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: desktop, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  /** `device` scripts the token's try: set here, after the reset, so no test's script is wiped by the next mount. */
  async function gate(opts: { held?: string | null; desktop?: boolean; spec?: typeof SPEC | null; device?: () => unknown } = {}) {
    for (const f of [unlock, code.verify, code.device, memory.read, memory.keep, memory.forget]) f.mockReset();
    memory.read.mockResolvedValue(opts.held ?? null);
    if (opts.device) code.device.mockImplementation(opts.device);
    atDesk(opts.desktop ?? false);
    const { ref } = await import("vue");
    const { APPLY_LOCAL_COPY } = await import("./deviceCopies");
    const w = mount(DraftUnlockGate, {
      props: { token: "t", carrier: "Silvicom Inc" },
      global: { provide: { [APPLY_LOCAL_COPY as symbol]: ref(opts.spec === undefined ? SPEC : opts.spec) } },
    });
    await flushPromises();
    return w;
  }
  const typeDate = async (w: Awaited<ReturnType<typeof gate>>) => {
    await w.find("input[inputmode='numeric']").setValue("04011980");
    await w.findAll("button").find((b) => b.text().includes(APPLY_COPY.unlock.action))!.trigger("click");
    await flushPromises();
  };

  it("⚠ opens with this phone's token before asking anything, and never draws the date box", async () => {
    const w = await gate({ held: "tok", device: async () => ({ draft: RELEASED }) });
    expect(code.device).toHaveBeenCalledWith("t", "tok");
    expect(w.emitted("unlocked")![0]![0]).toMatchObject({ payload: { first_name: "Susan" }, revision: 2 });
    expect(unlock).not.toHaveBeenCalled();
  });

  it("says it is opening while the token is tried, not a date-of-birth question", async () => {
    const w = await gate({ held: "tok", device: () => new Promise(() => {}) });
    expect(w.find("[data-unlock-opening]").text()).toBe(APPLY_COPY.unlock.opening);
    expect(w.find("input[inputmode='numeric']").exists()).toBe(false);
  });

  it("⚠ forgets a token the server no longer knows, and asks the date of birth", async () => {
    const w = await gate({ held: "tok", device: () => Promise.reject({ code: "device_not_known" }) });
    expect(memory.forget).toHaveBeenCalledWith(SPEC);
    expect(w.find("input[inputmode='numeric']").exists()).toBe(true);
    expect(w.emitted("unlocked")).toBeUndefined();
  });

  it("⚠ keeps the token when the try only failed to reach the server", async () => {
    const w = await gate({ held: "tok", device: () => Promise.reject(new Error("Failed to fetch")) });
    expect(memory.forget).not.toHaveBeenCalled();
    expect(w.find("input[inputmode='numeric']").exists()).toBe(true);
  });

  it("on a phone, asks to be remembered by default and keeps the token a right answer returns", async () => {
    const w = await gate();
    expect(w.find("[data-unlock-remember]").text()).toContain(APPLY_COPY.unlock.remember);
    unlock.mockResolvedValue({ draft: { ...RELEASED, deviceToken: "new-token" } });
    await typeDate(w);
    expect(unlock).toHaveBeenLastCalledWith("t", "1980-04-01", true);
    expect(memory.keep).toHaveBeenCalledWith(SPEC, "new-token");
  });

  it("does not ask to be remembered once the driver unticks it", async () => {
    const w = await gate();
    await w.find("[data-unlock-remember] input[type='checkbox']").setValue(false);
    unlock.mockResolvedValue({ draft: RELEASED });
    await typeDate(w);
    expect(unlock).toHaveBeenLastCalledWith("t", "1980-04-01", false);
    expect(memory.keep).not.toHaveBeenCalled();
  });

  it("⚠ never offers it on a computer, and never asks the server for it there", async () => {
    const w = await gate({ desktop: true });
    expect(w.find("[data-unlock-remember]").exists()).toBe(false);
    unlock.mockResolvedValue({ draft: RELEASED });
    await typeDate(w);
    expect(unlock).toHaveBeenLastCalledWith("t", "1980-04-01", false);
  });

  it("keeps nothing a wrong answer returned", async () => {
    const w = await gate();
    unlock.mockResolvedValue({ draft: { locked: true, payload: null, revision: 2 } });
    await typeDate(w);
    expect(memory.keep).not.toHaveBeenCalled();
    expect(w.emitted("unlocked")).toBeUndefined();
  });

  it("asks a right code to remember the phone too", async () => {
    const w = await gate();
    unlock.mockResolvedValue({ draft: { locked: true, payload: null, revision: 2 } });
    await typeDate(w);
    code.request.mockResolvedValue({ outcome: "sent", channel: "email", to: "s•••@example.test", expiresInMinutes: 10 });
    await w.findAll("button").find((b) => b.text().includes(APPLY_COPY.unlock.codeByEmail))!.trigger("click");
    await flushPromises();
    await w.find("input[autocomplete='one-time-code']").setValue("123456");
    code.verify.mockResolvedValue({ draft: { ...RELEASED, deviceToken: "code-token" } });
    await w.findAll("button").find((b) => b.text().includes(APPLY_COPY.unlock.codeAction))!.trigger("click");
    await flushPromises();
    expect(code.verify).toHaveBeenLastCalledWith("t", "123456", true);
    expect(memory.keep).toHaveBeenCalledWith(SPEC, "code-token");
  });
});

