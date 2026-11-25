import { chapterSpans, isWatched, type TrainingChapter, type WatchedRanges } from "./watching.js";

/**
 * Questions after each SEGMENT of a training film (SEGMENT-QUIZ-2026-11-25.md, D-TR13–D-TR17). Pure:
 * the API decides with these where a driver stands, the driver's page asks the API, and the office page
 * says before a publish what the API would refuse.
 *
 * ── THE RULE (D-TR14) ──────────────────────────────────────────────────────────────────────────
 * A segment is a chapter that has questions. Its questions test SEGMENT_POINTS points, one asked per
 * point. The film pauses at the segment's end and asks them; ALL must be right to go on. A miss replays
 * the segment (watched again, since the miss), then asks only the points missed, each as the version
 * of that point asked least so far (D-TR15). A chapter with no questions — the intro, the closing card
 * — never pauses.
 *
 * ⚠ The rule lives here, not in `training_versions.serve_count / pass_count`. Those columns described
 * the one-quiz-per-film rule (D-TR7) and are no longer read: the owner ruled one rule for every film,
 * and a version made before the ruling (5 asked, 4 to pass) would otherwise sit unpublishable, since the
 * office page has no field for either number. 0650 sets their defaults to 3/3 so a new row is truthful.
 */

/** Points one segment tests and asks (D-TR14). */
export const SEGMENT_POINTS = 3;
/** Versions each point needs, so a retry asks something different (D-TR15). */
export const POINT_VERSIONS = 2;

/** A question as the segment rules need it: where it belongs, never what it says. */
export interface SegmentQuestion {
  chapter: number;
  point: number;
}

export interface Segment {
  chapter: number;
  title: string;
  startMs: number;
  endMs: number;
  /** The points its questions test, ascending. */
  points: number[];
}

/** The film's segments in time order: the chapters that have questions. */
export function segmentsOf(chapters: readonly TrainingChapter[], durationMs: number, questions: readonly SegmentQuestion[]): Segment[] {
  return chapterSpans(chapters, durationMs).flatMap((c) => {
    const points = [...new Set(questions.filter((q) => q.chapter === c.index).map((q) => q.point))].sort((a, b) => a - b);
    return points.length ? [{ chapter: c.index, title: c.title, startMs: c.startMs, endMs: c.endMs, points }] : [];
  });
}

/** One answered question of a submitted attempt, as the rules need it. */
export interface PointResult {
  chapter: number;
  point: number;
  right: boolean;
}

export type FilmState =
  /** Keep watching; the next stop is at the end of chapter `stop` (null: the film has no questions). */
  | { kind: "watch"; stop: number | null }
  /** Missed at this stop: watch the segment again first. */
  | { kind: "rewatch"; chapters: number[] }
  /** Ask these points of this stop now. */
  | { kind: "quiz"; stop: number; points: number[] }
  | { kind: "passed" };

export interface FilmProgress {
  durationMs: number;
  chapters: readonly TrainingChapter[];
  questions: readonly SegmentQuestion[];
  watched: WatchedRanges;
  /** Watched since the last missed stop; the API empties it at each miss. */
  watchedSince: WatchedRanges;
  /** Every answer of every SUBMITTED attempt on this cut. */
  results: readonly PointResult[];
}

/**
 * Where a driver stands on one film. Stops are taken in order: a later segment's questions never open
 * before every earlier one is passed, so a driver cannot answer stop 2 having skipped stop 1. A point
 * once answered right stays right. A film with no questions is done once watched (it cannot be
 * published that way — `publishBlockers` — but an old cut may exist).
 */
export function filmState(p: FilmProgress): FilmState {
  const segments = segmentsOf(p.chapters, p.durationMs, p.questions);
  if (!segments.length) return isWatched(p.watched, 0, p.durationMs) ? { kind: "passed" } : { kind: "watch", stop: null };
  for (const s of segments) {
    const asked = p.results.filter((r) => r.chapter === s.chapter);
    const right = new Set(asked.filter((r) => r.right).map((r) => r.point));
    const missing = s.points.filter((x) => !right.has(x));
    if (!missing.length) continue;
    if (asked.length) {
      return isWatched(p.watchedSince, s.startMs, s.endMs) ? { kind: "quiz", stop: s.chapter, points: missing } : { kind: "rewatch", chapters: [s.chapter] };
    }
    return isWatched(p.watched, s.startMs, s.endMs) ? { kind: "quiz", stop: s.chapter, points: missing } : { kind: "watch", stop: s.chapter };
  }
  return { kind: "passed" };
}

/**
 * What stands between a version and publishing, in the office's words; empty when it may be published.
 * Read by the API, which refuses the publish, and by the office page, which says it before the click.
 */
export function publishBlockers(v: { state: string; chapters: readonly TrainingChapter[]; questions: readonly SegmentQuestion[] }): string[] {
  const out: string[] = [];
  if (v.state !== "ready") out.push(v.state === "published" ? "It is already published." : "The video is not ready for phones yet.");
  if (!v.questions.length) {
    out.push("Write the questions for at least one segment.");
    return out;
  }
  const titleOf = (i: number) => v.chapters[i]?.title ?? "Whole video";
  const chapters = [...new Set(v.questions.map((q) => q.chapter))].sort((a, b) => a - b);
  for (const c of chapters) {
    const mine = v.questions.filter((q) => q.chapter === c);
    const points = [...new Set(mine.map((q) => q.point))].sort((a, b) => a - b);
    if (points.length !== SEGMENT_POINTS) {
      out.push(`"${titleOf(c)}" tests ${points.length} ${points.length === 1 ? "point" : "points"}: each stop asks exactly ${SEGMENT_POINTS}.`);
    }
    for (const p of points) {
      const n = mine.filter((q) => q.point === p).length;
      if (n < POINT_VERSIONS) out.push(`"${titleOf(c)}", point ${p + 1} has one version: write a second, so a retry asks something different.`);
    }
  }
  return out;
}
