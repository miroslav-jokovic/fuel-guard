import type { FilmState } from "./watching.js";

/**
 * A driver's way through a course (D-TR7): films in order, each opening when the one before it in
 * the assignment is passed. An assignment of single films (retraining after an event) opens them in
 * the course's order the same way. Pure.
 */

export type LessonStatus = "locked" | "watch" | "rewatch" | "quiz" | "passed";

export interface CourseLesson {
  lessonId: string;
  /** The film's state for this driver, or null when the film has no published version (skipped). */
  film: FilmState | null;
}

/** Each lesson's status, in order. A lesson with no published version is left out. */
export function lessonStatuses(lessons: readonly CourseLesson[]): Array<{ lessonId: string; status: LessonStatus }> {
  const out: Array<{ lessonId: string; status: LessonStatus }> = [];
  let open = true;
  for (const l of lessons) {
    if (!l.film) continue;
    const status: LessonStatus = !open ? "locked" : l.film.kind;
    out.push({ lessonId: l.lessonId, status });
    if (status !== "passed") open = false;
  }
  return out;
}

/** Is the assignment finished — every film in it passed? An assignment with no film is not. */
export const assignmentComplete = (statuses: ReadonlyArray<{ status: LessonStatus }>): boolean =>
  statuses.length > 0 && statuses.every((s) => s.status === "passed");

/** The lessons an assignment covers, in the course's order: all of them, or the ones it names. */
export function assignedLessons<T extends { id: string }>(courseLessons: readonly T[], lessonIds: readonly string[] | null): T[] {
  if (!lessonIds) return [...courseLessons];
  const want = new Set(lessonIds);
  return courseLessons.filter((l) => want.has(l.id));
}
