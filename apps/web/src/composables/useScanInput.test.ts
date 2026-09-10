import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, ref, type Ref } from "vue";
import { useScanInput } from "@/composables/useScanInput";

/**
 * Reading a Bluetooth HID scanner (INVENTORY-PLAN.md I6).
 *
 * ── WHAT THIS SUITE EXISTS TO PIN ─────────────────────────────────────────────────────────────
 * The entire integration is one judgement — these keystrokes came from a machine, those came from a
 * thumb — and it is made from timing alone, because a HID scanner is indistinguishable from a
 * keyboard by every other means available to a page. Every failure mode of that judgement is silent
 * on a shop floor: accept a fast typist and a stray resolve call appears from nowhere; reject a real
 * scan and a technician stands in a bay pulling the trigger at a label that works. Neither shows up
 * in a type check, a lint run or a smoke test, and neither is reproducible at a desk without
 * controlling the clock — which is what this file does.
 *
 * The gap threshold, the minimum length, the idle flush and the same-symbol window are all in
 * `useScanInput.ts` with their reasons; what is asserted here is that each of them actually governs.
 */

/** A component whose only job is to be alive so the composable's lifecycle hooks run. */
function harness(enabled: Ref<boolean>, onScan: (code: string) => void) {
  let api: ReturnType<typeof useScanInput> | null = null;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useScanInput({ enabled, onScan });
        return () => null;
      },
    }),
  );
  return { wrapper, api: api! };
}

/**
 * The clock the composable reads. `performance.now` is spied rather than faked wholesale, because
 * the burst rule and the idle timer are two different mechanisms and the test has to be able to
 * advance one without the other — a burst that is fast by the gap rule but never gets its Enter is
 * precisely the case `IDLE_FLUSH_MS` exists for.
 */
let clock = 0;

/** Type one character at `gap` milliseconds after the previous one. */
function key(char: string, gap = 5, target: EventTarget = document) {
  clock += gap;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
}

/** Type a whole string at a given per-character gap. */
function type(text: string, gap = 5, target: EventTarget = document) {
  for (const char of text) key(char, gap, target);
}

function enter(target: EventTarget = document) {
  clock += 5;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

const TAG = "SIL1:BIN:7K3M9P";

describe("useScanInput", () => {
  beforeEach(() => {
    clock = 0;
    // ⚠ ORDER MATTERS, and getting it wrong makes this suite lie rather than fail. `useFakeTimers`
    // installs its own `performance`, so a spy taken before it is silently replaced — every gap then
    // measures as zero, every burst reads as machine speed, and the "ignores a person typing" case
    // below passes the whole tag through while reporting green. Fake the timers first, then take the
    // clock. (Both failed exactly that way on the first run of this file.)
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => clock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("reads a machine-speed burst terminated by Enter", () => {
    const onScan = vi.fn();
    harness(ref(true), onScan);

    type(TAG);
    enter();

    expect(onScan).toHaveBeenCalledExactlyOnceWith(TAG);
  });

  /**
   * ⚠ THE ASSERTION THE WHOLE FILE IS FOR. Without the gap rule this passes the typed characters
   * through as a scan, and nothing else in the repo notices: the resolve endpoint answers, the card
   * renders, and a technician gets a verb sheet for a bin they were not looking at.
   */
  it("ignores a person typing, however long they type for", () => {
    const onScan = vi.fn();
    harness(ref(true), onScan);

    // 150 ms per character — brisk human typing, well inside what a practised person sustains.
    type(TAG, 150);
    enter();

    expect(onScan).not.toHaveBeenCalled();
  });

  it("emits a burst that never got its Enter, once the stream goes quiet", () => {
    const onScan = vi.fn();
    harness(ref(true), onScan);

    type(TAG);
    expect(onScan).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(onScan).toHaveBeenCalledExactlyOnceWith(TAG);
  });

  /**
   * A scanner in continuous or auto-sense mode pointed at one label fires repeatedly. Zebra calls
   * the fix Same Symbol Timeout; without it a single carton opens the verb sheet five times.
   */
  it("treats the same label read twice in quick succession as one scan", () => {
    const onScan = vi.fn();
    harness(ref(true), onScan);

    type(TAG);
    enter();
    clock += 100;
    type(TAG);
    enter();

    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("lets the same label through when it is deliberately scanned again", () => {
    const onScan = vi.fn();
    harness(ref(true), onScan);

    type(TAG);
    enter();
    clock += 900;
    type(TAG);
    enter();

    expect(onScan).toHaveBeenCalledTimes(2);
  });

  /**
   * A scanner presses Shift for `:` and for every upper-case character. Treating a non-printable key
   * as the end of a burst would truncate every one of our own tags at `SIL`.
   */
  it("keeps the burst across the modifier keys a scanner sends", () => {
    const onScan = vi.fn();
    harness(ref(true), onScan);

    type("SIL1");
    key("Shift");
    type(":BIN:7K3M9P");
    enter();

    expect(onScan).toHaveBeenCalledExactlyOnceWith(TAG);
  });

  it("leaves keystrokes aimed at a form field alone", () => {
    const onScan = vi.fn();
    harness(ref(true), onScan);
    const input = document.createElement("input");
    document.body.appendChild(input);

    type(TAG, 5, input);
    enter(input);

    expect(onScan).not.toHaveBeenCalled();
  });

  /** A scan landing while a drawer is open would replace the item under a half-completed form. */
  it("hears nothing while it is disabled", () => {
    const onScan = vi.fn();
    const enabled = ref(false);
    harness(enabled, onScan);

    type(TAG);
    enter();
    expect(onScan).not.toHaveBeenCalled();

    enabled.value = true;
    type(TAG);
    enter();
    expect(onScan).toHaveBeenCalledExactlyOnceWith(TAG);
  });

  /**
   * The typed-entry field's path. It bypasses the timing rule on purpose: that rule is about the
   * input STREAM, and a person who has just pressed Find has declared their intent by other means.
   */
  it("accepts a typed code through submit(), at any speed", () => {
    const onScan = vi.fn();
    const { api } = harness(ref(true), onScan);

    api.submit("  sil1:bin:7k3m9p  ");

    expect(onScan).toHaveBeenCalledExactlyOnceWith("sil1:bin:7k3m9p");
  });

  it("stops listening once the screen is gone", () => {
    const onScan = vi.fn();
    const { wrapper } = harness(ref(true), onScan);

    wrapper.unmount();
    type(TAG);
    enter();

    expect(onScan).not.toHaveBeenCalled();
  });
});
