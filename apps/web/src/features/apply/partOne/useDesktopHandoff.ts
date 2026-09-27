import { onScopeDispose, ref, watch, type Ref } from "vue";

/**
 * The desktop half of §6.6.6 (C3b2b2): is this a computer, and — while a photo screen waits on the
 * phone — has the photo arrived yet?
 *
 * ── "DESKTOP" IS A POINTER, NOT A USER AGENT ──────────────────────────────────────────────────
 * `(hover: hover) and (pointer: fine)`: the primary input is a mouse or a trackpad. A user-agent string
 * is a claim a browser makes about itself and every browser lies in it; the media query is what the
 * device actually has. A tablet with a keyboard case still reads as touch (coarse) and keeps the
 * camera; a touchscreen laptop reads as its trackpad, which is right — its webcam is no licence scanner.
 * No `matchMedia` (jsdom, a very old browser) reads as a phone, which offers the camera: the fallback
 * that works everywhere.
 */
export const DESKTOP_QUERY = "(hover: hover) and (pointer: fine)";

export function useIsDesktop(): Ref<boolean> {
  const mql = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DESKTOP_QUERY)
    : null;
  const desktop = ref(mql?.matches ?? false);
  if (mql) {
    const update = (e: MediaQueryListEvent): void => {
      desktop.value = e.matches;
    };
    mql.addEventListener("change", update);
    onScopeDispose(() => mql.removeEventListener("change", update));
  }
  return desktop;
}

/**
 * Ten seconds, and the budget is why: the intake's limiter is 20 requests a minute per address
 * (`applicationLimits.ts`), and this page's other requests share it. Six a minute leaves the rest; a
 * photo that took ten seconds longer to be noticed costs nobody anything.
 */
export const HANDOFF_POLL_MS = 10_000;

/**
 * While `waiting` is true, ask `check` every `HANDOFF_POLL_MS` whether the photo has arrived, and call
 * `arrived` once when it has. No new realtime channel (the plan's rule): the bundle already lists the
 * link's captures, so the poll is the page's own read, repeated.
 *
 * ⚠ Skipped while the tab is hidden — the driver is on their phone, and a background tab re-reading the
 * bundle for twenty minutes spends the budget above for nothing. The first visible tick catches up.
 */
export function useHandoffPoll(
  waiting: Ref<boolean>,
  check: () => Promise<boolean>,
  arrived: () => void,
): void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  const stop = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const tick = async (): Promise<void> => {
    if (inFlight || (typeof document !== "undefined" && document.hidden)) return;
    inFlight = true;
    try {
      if (waiting.value && (await check()) && waiting.value) {
        stop();
        arrived();
      }
    } catch {
      // A failed read is the next tick's to retry; the page says nothing, because nothing is wrong yet.
    } finally {
      inFlight = false;
    }
  };

  watch(
    waiting,
    (on) => {
      stop();
      if (on) timer = setInterval(() => void tick(), HANDOFF_POLL_MS);
    },
    { immediate: true },
  );
  onScopeDispose(stop);
}
