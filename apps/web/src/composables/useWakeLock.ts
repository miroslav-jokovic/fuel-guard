import { onBeforeUnmount, onMounted, ref } from "vue";

/**
 * Keep the screen awake while a walk is in progress (INVENTORY-PLAN.md I5, D-INV17).
 *
 * A shelf count is minutes of reading and typing with pauses in between, and a phone that sleeps
 * mid-count costs the technician a passcode and their place. `navigator.wakeLock` is the API for
 * exactly that, and it has two properties that decide the shape of this file:
 *
 *   1. **It must be requested from a user gesture.** A request on mount, before anybody has touched
 *      anything, is rejected by Safari — so `request()` is exported for the caller to invoke inside
 *      the tap handler that starts the walk, and nothing is requested automatically.
 *   2. **The lock is RELEASED when the page is hidden**, by the browser, silently. Switching to
 *      another app to read a part number and switching back leaves a page that believes it holds a
 *      lock and does not. So it is re-requested on `visibilitychange`, which is the half that is
 *      easy to leave out and impossible to notice in a desk browser.
 *
 * ⚠ Every path here is best-effort. The API does not exist in Firefox or in an older iOS, and a
 * request can be refused for reasons the page cannot see (low battery is the documented one). A
 * count must not fail because the screen might dim, so nothing throws and nothing blocks: `active`
 * reports what actually happened, for a caller that wants to say so.
 */
export function useWakeLock() {
  const active = ref(false);
  let sentinel: WakeLockSentinel | null = null;
  /**
   * Whether the CALLER has asked for a lock at all.
   *
   * ⚠ Without this, the visibility handler below re-requests on the first tab switch for a page that
   * never wanted a lock — its initial state (`active: false`, no sentinel) is indistinguishable from
   * "the browser took ours away". A screen that quietly holds a wake lock nobody asked for is a
   * battery complaint nobody can trace.
   */
  let wanted = false;

  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator;

  async function request(): Promise<void> {
    wanted = true;
    if (!supported || sentinel) return;
    try {
      sentinel = await navigator.wakeLock.request("screen");
      active.value = true;
      // The browser releases on hide as well as on our own call; keep `active` honest either way.
      sentinel.addEventListener("release", () => {
        active.value = false;
        sentinel = null;
      });
    } catch {
      active.value = false;
    }
  }

  async function release(): Promise<void> {
    wanted = false;
    try {
      await sentinel?.release();
    } catch {
      // Already gone. Nothing to report — the sentinel's own listener has cleared the flag.
    }
    sentinel = null;
    active.value = false;
  }

  /**
   * The half that only matters on a real phone: a page that was hidden has already lost its lock,
   * so coming back has to ask again. Requesting from here is allowed because the visibility change
   * is itself user-initiated.
   */
  const onVisible = () => {
    if (wanted && document.visibilityState === "visible" && sentinel === null) void request();
  };

  onMounted(() => document.addEventListener("visibilitychange", onVisible));
  onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", onVisible);
    void release();
  });

  return { active, supported, request, release };
}
