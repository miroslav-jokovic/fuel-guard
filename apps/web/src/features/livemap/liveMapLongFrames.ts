/**
 * The long-frame counter in the vector trial's basemap menu (D-DR39 follow-up, HANDOFF-2026-11-10
 * §10.4 gap 2).
 *
 * ── WHY A COUNTER IN THE MENU ────────────────────────────────────────────────────────────────────
 * The owner's ruling on the vector map (D-DR33) is taken on the slowest office PC, by looking. A look
 * returns a feeling, and two feelings a week apart cannot be compared. The staging rig
 * (`docs/plans/livemap/tools/staging-map-frames.mjs`) returns numbers, but a headless Chrome on a
 * developer Mac is not the office PC: its GPU is a ceiling and its software renderer a floor, and
 * the office PC sits somewhere between, unmeasured. So the page counts its OWN long frames and shows
 * the count where the owner is already looking, the menu that switches the maps, and the ruling
 * comes back as "N long frames on this map, M on that one" from the PC that decides.
 *
 * ── WHAT IS COUNTED ──────────────────────────────────────────────────────────────────────────────
 * The browser's `longtask` entries: any main-thread task over 50 ms, the same observer the staging
 * rig uses, so the office figure and the rig figure are the same quantity. A long task is a frame
 * the reader felt: at 50 ms the map has skipped three frames at 60 Hz. The count restarts when the
 * basemap changes, so each figure belongs to one map, and the worst task is kept because one 800 ms
 * stall reads very differently from sixteen 50 ms ones with the same count.
 *
 * ⚠ Only Chromium browsers report `longtask` (Chrome, Edge). Firefox and Safari do not, and the
 * menu says so rather than showing a zero that would read as "no long frames". The office PCs run
 * Chrome; a reader on anything else is told the counter is not available in that browser.
 *
 * ⚠ Shown only where the vector trial is offered (`vectorTrialOffered`, the labelled workaround in
 * `vectorBasemap.ts`). A production dispatcher never sees it; it goes when the trial goes.
 *
 * The tally is pure so a test can feed it durations; the composable owns the observer.
 */
import { onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";

/** Tasks over `LONG_TASK_MS` are what the browser reports; the threshold is the platform's, not ours. */
export const LONG_TASK_MS = 50;

export interface LongFrameTally {
  /** Long tasks since the tally started (the last basemap change). */
  count: number;
  /** Their total main-thread time, ms. */
  totalMs: number;
  /** The longest single task, ms; 0 until one lands. */
  worstMs: number;
  /** `performance.now()` when the tally started, so the menu can say "in N s". */
  sinceMs: number;
}

export function emptyTally(sinceMs: number): LongFrameTally {
  return { count: 0, totalMs: 0, worstMs: 0, sinceMs };
}

/** The tally after `durations` (ms each) landed. Pure: returns a new tally, never mutates. */
export function tallyLongFrames(tally: LongFrameTally, durations: readonly number[]): LongFrameTally {
  let { count, totalMs, worstMs } = tally;
  for (const d of durations) {
    count += 1;
    totalMs += d;
    if (d > worstMs) worstMs = d;
  }
  return { count, totalMs, worstMs, sinceMs: tally.sinceMs };
}

/**
 * The one line the menu shows. Count first because that is the figure the owner writes down; the
 * worst task second because it tells a stall from a stutter; the elapsed time so two readings of
 * different lengths can be compared as a rate.
 */
export function longFrameSummary(tally: LongFrameTally, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - tally.sinceMs) / 1000));
  if (tally.count === 0) return `Long frames: 0 in ${seconds} s`;
  return `Long frames: ${tally.count} in ${seconds} s, worst ${Math.round(tally.worstMs)} ms`;
}

/** Whether this browser reports long tasks at all (Chromium does; Firefox and Safari do not). */
export function longTasksObservable(): boolean {
  const supported = (globalThis as { PerformanceObserver?: { supportedEntryTypes?: readonly string[] } }).PerformanceObserver?.supportedEntryTypes;
  return Array.isArray(supported) && supported.includes("longtask");
}

/**
 * Counts long tasks while mounted, restarting whenever `basemap` changes so each figure belongs to
 * one map. `summary` is the line to show; `available` is false where the browser cannot count.
 */
export function useLongFrames(basemap: Ref<string>, clock: () => number = () => performance.now()) {
  const available = longTasksObservable();
  const tally = ref<LongFrameTally>(emptyTally(clock()));
  const now = ref(clock());
  let observer: PerformanceObserver | null = null;
  // The elapsed seconds move even when no task lands, so the line is re-read once a second while the
  // menu could be open; one timer, cleared with the observer.
  let ticker: ReturnType<typeof setInterval> | null = null;

  const reset = () => {
    tally.value = emptyTally(clock());
    now.value = tally.value.sinceMs;
  };

  onMounted(() => {
    if (!available) return;
    observer = new PerformanceObserver((list) => {
      tally.value = tallyLongFrames(
        tally.value,
        list.getEntries().map((e) => e.duration),
      );
    });
    observer.observe({ type: "longtask" });
    ticker = setInterval(() => {
      now.value = clock();
    }, 1000);
    reset();
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
  });

  watch(basemap, reset);

  return { available, tally, now, reset };
}
