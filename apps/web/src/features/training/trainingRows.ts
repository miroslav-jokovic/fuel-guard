import type {
  LessonStatus,
  TrainingAssignmentRow,
  TrainingChapter,
  TrainingLessonSummary,
  TrainingReach,
  TrainingSendVia,
  TrainingVersionState,
  TrainingVersionSummary,
} from "@silvicom/shared";
import type { BadgeTone } from "@/lib/badges";

/**
 * The Training page's words and tones, pure so each is tested without a page
 * (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS §8–§9). Office words, not the database's: a version is
 * "Being prepared for phones", never `processing`.
 */

/** "3:24" from milliseconds; "—" for a length not known yet. */
export function clock(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "3:24" → 204000; null for anything that is not m:ss. For typing a chapter's start. */
export function parseClock(text: string): number | null {
  const m = /^\s*(\d{1,3}):([0-5]\d)\s*$/.exec(text);
  return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : null;
}

export const VERSION_STATE: Record<TrainingVersionState, { label: string; tone: BadgeTone }> = {
  draft: { label: "Uploading", tone: "neutral" },
  processing: { label: "Being prepared for phones", tone: "info" },
  failed: { label: "Could not be prepared", tone: "danger" },
  ready: { label: "Ready to publish", tone: "warning" },
  published: { label: "Published", tone: "success" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

/**
 * The version the office works on: the newest one still being edited, else the published one, else the
 * newest. A new upload is the newest, so "edit" always lands on it; with none, the live cut.
 */
export function workingVersion(lesson: TrainingLessonSummary): TrainingVersionSummary | null {
  const editing = lesson.versions.find((v) => v.state !== "published" && v.state !== "withdrawn");
  return editing ?? lesson.versions.find((v) => v.state === "published") ?? lesson.versions[0] ?? null;
}

export const publishedVersion = (lesson: TrainingLessonSummary): TrainingVersionSummary | null => lesson.versions.find((v) => v.state === "published") ?? null;

/** The chapter a time falls in, for a question's "From chapter …" — index into `chapters`. */
export function chapterAt(chapters: readonly TrainingChapter[], ms: number): number {
  let at = 0;
  chapters.forEach((c, i) => {
    if (c.startMs <= ms) at = i;
  });
  return at;
}

/** Chapters with a new mark put in its place by time, a mark on an existing start replacing it. */
export function withChapter(chapters: readonly TrainingChapter[], mark: TrainingChapter): TrainingChapter[] {
  return [...chapters.filter((c) => Math.abs(c.startMs - mark.startMs) >= 1000), mark].sort((a, b) => a.startMs - b.startMs);
}

// ── sending ────────────────────────────────────────────────────────────────────────────────────

export const VIA_LABEL: Record<TrainingSendVia, string> = { sms: "Text", email: "Email", copy: "You send the link" };

/** How a picked driver will get the link, as the Send tab's "Can we text?" cell says it (D-TR11). */
export function reachLabel(r: TrainingReach | undefined): { via: TrainingSendVia | null; label: string; detail: string | null } {
  if (!r) return { via: null, label: "Checking…", detail: null };
  if (r.sms) return { via: "sms", label: "Text", detail: null };
  if (r.email) return { via: "email", label: "Email", detail: r.smsReason };
  return { via: "copy", label: "You send the link", detail: r.smsReason ?? "No phone we may text and no email on file." };
}

// ── progress ───────────────────────────────────────────────────────────────────────────────────

export const LESSON_STATUS: Record<LessonStatus, { label: string; tone: BadgeTone }> = {
  locked: { label: "Not started", tone: "neutral" },
  watch: { label: "Watching", tone: "info" },
  rewatch: { label: "Watching again", tone: "warning" },
  quiz: { label: "Quiz open", tone: "info" },
  passed: { label: "Passed", tone: "success" },
};

export type AssignmentStanding = "cancelled" | "finished" | "overdue" | "in_progress" | "not_opened";

export const STANDING: Record<AssignmentStanding, { label: string; tone: BadgeTone }> = {
  finished: { label: "Finished", tone: "success" },
  in_progress: { label: "In progress", tone: "info" },
  not_opened: { label: "Not opened", tone: "neutral" },
  overdue: { label: "Overdue", tone: "danger" },
  cancelled: { label: "Link cancelled", tone: "neutral" },
};

/** Where one sent training stands. `today` is the office's calendar day (YYYY-MM-DD), not an instant. */
export function standing(a: TrainingAssignmentRow, today: string): AssignmentStanding {
  if (a.revokedAt) return "cancelled";
  if (a.completedAt) return "finished";
  if (a.dueOn && a.dueOn < today) return "overdue";
  return a.firstOpenedAt ? "in_progress" : "not_opened";
}

/** One film's cell on the Progress tab: its status, and the best quiz score when there is one. */
export function lessonCell(l: TrainingAssignmentRow["lessons"][number]): string {
  const base = LESSON_STATUS[l.status].label;
  return l.best ? `${base} · ${l.best.correct}/${l.best.total}` : base;
}
