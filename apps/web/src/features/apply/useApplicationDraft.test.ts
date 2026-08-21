import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { effectScope, reactive, ref } from "vue";
import { emptyDraft, type ApplicationDraft } from "./draft";
import { useApplicationDraft } from "./useApplicationDraft";

/**
 * Autosave's two timers (A2).
 *
 * The debounce is the obvious half. The floor is the half that matters: the public application
 * surface allows 20 requests a minute (`app.ts:147`, with `/api/public`'s 60 stacked on top, so the
 * budget is the intersection), and a driver who pauses every two seconds — which is what typing an
 * address looks like — would produce up to 30 saves a minute on the debounce alone and start
 * collecting 429s in the middle of their own application.
 */

const saved = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("./useApplication", () => ({ saveApplicationDraft: saved.fn }));

const run = (draft: ApplicationDraft, enabled = ref(true)) => {
  const scope = effectScope();
  const api = scope.run(() => useApplicationDraft(ref("t".repeat(43)), draft, { enabled }))!;
  return { ...api, stop: () => scope.stop() };
};

describe("autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saved.fn.mockReset();
    saved.fn.mockResolvedValue({ updatedAt: "2026-08-21T09:00:00Z" });
  });
  afterEach(() => vi.useRealTimers());

  it("saves once, two seconds after the driver stops typing", async () => {
    const draft = reactive(emptyDraft());
    const handle = run(draft);

    draft.first_name = "Susan";
    await vi.advanceTimersByTimeAsync(1_900);
    expect(saved.fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(saved.fn).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it("coalesces a burst of edits into one save", async () => {
    const draft = reactive(emptyDraft());
    const handle = run(draft);

    for (const value of ["S", "Su", "Sus", "Susa", "Susan"]) {
      draft.first_name = value;
      await vi.advanceTimersByTimeAsync(300);
    }
    await vi.advanceTimersByTimeAsync(2_000);
    expect(saved.fn).toHaveBeenCalledTimes(1);
    // The whole current form goes every time, so coalescing loses nothing.
    expect((saved.fn.mock.calls[0]![1] as Record<string, unknown>).first_name).toBe("Susan");
    handle.stop();
  });

  /** The rate budget, in one test: a driver pausing every two seconds cannot outrun the floor. */
  it("never exceeds one save per five seconds, however the driver types", async () => {
    const draft = reactive(emptyDraft());
    const handle = run(draft);

    for (let i = 0; i < 12; i++) {
      draft.first_name = `Susan ${i}`;
      await vi.advanceTimersByTimeAsync(2_100);
    }
    // 25 seconds of two-second pauses. On the debounce alone that would be 12 requests; the floor
    // holds it to what fits inside 20/minute with room for the driver's own reads and the submit.
    expect(saved.fn.mock.calls.length).toBeLessThanOrEqual(6);
    expect(saved.fn.mock.calls.length).toBeGreaterThan(0);
    handle.stop();
  });

  it("tells the driver where it got to", async () => {
    const draft = reactive(emptyDraft());
    const handle = run(draft);
    expect(handle.state.value).toBe("idle");

    draft.first_name = "Susan";
    await vi.advanceTimersByTimeAsync(2_100);
    expect(handle.state.value).toBe("saved");

    saved.fn.mockRejectedValueOnce(new Error("offline"));
    draft.last_name = "Godfrey";
    await vi.advanceTimersByTimeAsync(6_000);
    // Named, not swallowed: a form that silently fails to save is worse than one that never
    // offered to, because the driver keeps typing into it.
    expect(handle.state.value).toBe("failed");
    handle.stop();
  });

  it("does not save while it is switched off", async () => {
    const draft = reactive(emptyDraft());
    const handle = run(draft, ref(false));
    draft.first_name = "Susan";
    await vi.advanceTimersByTimeAsync(10_000);
    expect(saved.fn).not.toHaveBeenCalled();
    handle.stop();
  });

  it("stops when the page goes away", async () => {
    const draft = reactive(emptyDraft());
    const handle = run(draft);
    draft.first_name = "Susan";
    handle.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(saved.fn).not.toHaveBeenCalled();
  });
});
