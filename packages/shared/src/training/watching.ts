/**
 * What a driver has watched of a training film, and what that unlocks
 * (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS-2026-11-24.md §9, D-TR7/D-TR8). Pure; the API stores the results
 * in `training_progress` (0648) and the page shows them.
 *
 * ── RANGES, NOT A HIGH-WATER MARK ──────────────────────────────────────────────────────────────
 * "Watched to 3:20" says nothing about a driver who dragged the bar from 0:10 to 3:20. A film is
 * watched as a set of merged [startMs, endMs] spans, and "watched" means those spans cover enough of
 * the film or chapter (the July plan's R7, kept). The page reports each span it actually played; the
 * API refuses a span longer than the wall-clock time since the last report (`acceptableSpanMs`).
 *
 * ── WHAT UNLOCKS THE QUIZ (D-TR8) ──────────────────────────────────────────────────────────────
 *   · No quiz taken yet → the film watched to WATCH_SHARE.
 *   · Last quiz failed → every chapter it missed watched to WATCH_SHARE SINCE that quiz. Only those
 *     chapters; the rest of the film is not asked again (owner, 2026-11-24, loosening July R2/R3).
 *   · Last quiz passed → the film is done.
 */

/** A merged, sorted list of [startMs, endMs] spans, each end > start. */
export type WatchedRanges = Array<[number, number]>;

/** The share of a film (or a chapter) that counts as watched. */
export const WATCH_SHARE = 0.9;

/** Two spans closer than this are one span: a heartbeat boundary or a buffering stall is not a gap. */
export const RANGE_JOIN_MS = 1500;

/** One chapter as stored on a version (`training_versions.chapters`). */
export interface TrainingChapter {
  title: string;
  startMs: number;
}

/** A chapter with its end, which is the next chapter's start or the film's end. */
export interface ChapterSpan extends TrainingChapter {
  index: number;
  endMs: number;
}

/** Add one played span to the merged set. Clamped to [0, durationMs]; an empty span changes nothing. */
export function addWatched(ranges: WatchedRanges, span: [number, number], durationMs: number): WatchedRanges {
  const start = Math.max(0, Math.min(span[0], durationMs));
  const end = Math.max(0, Math.min(span[1], durationMs));
  const all: WatchedRanges = end > start ? [...ranges, [start, end]] : [...ranges];
  all.sort((a, b) => a[0] - b[0]);
  const out: WatchedRanges = [];
  for (const [s, e] of all) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + RANGE_JOIN_MS) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Milliseconds of [fromMs, toMs) the ranges cover. */
export function coveredMs(ranges: WatchedRanges, fromMs: number, toMs: number): number {
  let total = 0;
  for (const [s, e] of ranges) {
    const a = Math.max(s, fromMs);
    const b = Math.min(e, toMs);
    if (b > a) total += b - a;
  }
  return total;
}

/** Is [fromMs, toMs) watched to WATCH_SHARE? A zero-length window is trivially watched. */
export function isWatched(ranges: WatchedRanges, fromMs: number, toMs: number): boolean {
  const len = toMs - fromMs;
  return len <= 0 || coveredMs(ranges, fromMs, toMs) >= len * WATCH_SHARE;
}

/**
 * The chapters with their ends. Chapters are kept in time order by `checkChapters`; a film with no
 * chapters is one chapter, "Whole video", so a question tagged chapter 0 always has somewhere to send
 * the driver back to.
 */
export function chapterSpans(chapters: readonly TrainingChapter[], durationMs: number): ChapterSpan[] {
  if (chapters.length === 0) return [{ index: 0, title: "Whole video", startMs: 0, endMs: durationMs }];
  return chapters.map((c, i) => ({ ...c, index: i, endMs: chapters[i + 1]?.startMs ?? durationMs }));
}

/**
 * What is wrong with a chapter list, or null. In time order, at least 5 s apart, inside the film, at
 * most 20 — a chapter is something a driver is sent back to, and a 2-second one is not.
 */
export function checkChapters(chapters: readonly TrainingChapter[], durationMs: number): string | null {
  if (chapters.length > 20) return "A video can have at most 20 chapters.";
  let prev: TrainingChapter | null = null;
  for (const [i, c] of chapters.entries()) {
    if (!c.title.trim()) return `Chapter ${i + 1} needs a title.`;
    if (c.startMs < 0 || c.startMs >= durationMs) return `Chapter ${i + 1} starts outside the video.`;
    if (prev && c.startMs - prev.startMs < 5000) return `Chapter ${i + 1} starts less than 5 seconds after chapter ${i}.`;
    prev = c;
  }
  return null;
}

/** The last quiz on a film, as the unlock rule needs it. */
export interface LastQuiz {
  passed: boolean;
  missedChapters: readonly number[];
}

export type FilmState =
  /** Nothing watched enough yet. */
  | { kind: "watch" }
  /** Failed: these chapters must be watched again. */
  | { kind: "rewatch"; chapters: number[] }
  /** The quiz may be taken. */
  | { kind: "quiz" }
  | { kind: "passed" };

export interface FilmProgress {
  durationMs: number;
  chapters: readonly TrainingChapter[];
  watched: WatchedRanges;
  /** Watched since the last FAILED quiz; empty after a pass or before any quiz. */
  watchedSince: WatchedRanges;
  lastQuiz: LastQuiz | null;
}

/** Where a driver stands on one film (D-TR8). */
export function filmState(p: FilmProgress): FilmState {
  if (p.lastQuiz?.passed) return { kind: "passed" };
  if (p.lastQuiz) {
    const spans = chapterSpans(p.chapters, p.durationMs);
    const left = p.lastQuiz.missedChapters.filter((i) => {
      // A chapter index the version no longer has (it cannot: a published version is frozen) reads as the last.
      const s = spans[i] ?? spans[spans.length - 1];
      return s ? !isWatched(p.watchedSince, s.startMs, s.endMs) : false;
    });
    return left.length ? { kind: "rewatch", chapters: left } : { kind: "quiz" };
  }
  return isWatched(p.watched, 0, p.durationMs) ? { kind: "quiz" } : { kind: "watch" };
}

/**
 * The longest span the API accepts in one report: the wall-clock time since the previous report, with
 * a margin for a slow network, never more than two minutes. Playback speed is locked to 1× on the page,
 * so a longer span is a dragged bar, not watching. The first report of a session has no previous one;
 * it is held to the heartbeat interval plus the margin.
 */
export const HEARTBEAT_MS = 10_000;
export function acceptableSpanMs(sinceLastReportMs: number | null): number {
  const basis = sinceLastReportMs === null ? HEARTBEAT_MS : sinceLastReportMs;
  return Math.min(120_000, Math.max(0, basis) * 1.25 + 3000);
}
