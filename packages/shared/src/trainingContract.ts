import { z } from "zod";
import { recordId } from "./recordId.js";
import type { LessonStatus } from "./training/course.js";
import type { TrainingChapter, WatchedRanges } from "./training/watching.js";

export * from "./training/watching.js";
export * from "./training/quiz.js";
export * from "./training/course.js";
export * from "./training/segments.js";

/**
 * Driver safety training — the API's contract with the office's Training page and the driver's link
 * page (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS-2026-11-24.md §8–§9; tables 0648).
 *
 * ⚠ The lengths below are 0648's CHECKs, restated so a form can say so before a round trip; the
 * database stays the authority (the `orientationVideosContract.ts` rule).
 */

export const TRAINING_TITLE_MAX = 120;
export const TRAINING_MEDIA_MAX_BYTES = 100 * 1024 * 1024;
/** The renditions made from every upload (§8.2): small for weak signal, then normal, then sharp. */
export const TRAINING_RENDITION_HEIGHTS = [360, 540, 720] as const;
/** How long a sent link works. Long enough for a driver out two weeks to get home and watch. */
export const TRAINING_LINK_DAYS = 28;
/** The link page's path; short, because a text message counts characters. */
export const trainingLinkPath = (token: string): string => `/t/${token}`;
/**
 * A link token as it can appear in a URL: 18 random bytes in base64url, so exactly 24 characters of
 * that alphabet (the API's `mintLinkToken`). The portal refuses anything else before a lookup, and the
 * server sends the link page only for a path of this shape — one pattern, read by both.
 */
export const TRAINING_LINK_TOKEN = /^[A-Za-z0-9_-]{24}$/;
/** `trainingLinkPath`'s shape as a route: `/t/<token>`, a trailing slash allowed (a texted link gets one). */
export const TRAINING_LINK_ROUTE = new RegExp(`^/t/${TRAINING_LINK_TOKEN.source.slice(1, -1)}/?$`);

const title = z.string().trim().min(1, "Give it a title.").max(TRAINING_TITLE_MAX, `At most ${TRAINING_TITLE_MAX} characters.`);

// ── the office: catalogue ──────────────────────────────────────────────────────────────────────

export const trainingCourseCreateSchema = z.object({
  title,
  description: z.string().trim().max(600).nullable().optional().default(null),
});
export type TrainingCourseCreate = z.infer<typeof trainingCourseCreateSchema>;

export const trainingCourseUpdateSchema = z
  .object({ title: title.optional(), description: z.string().trim().max(600).nullable().optional(), position: z.number().int().min(0).max(1000).optional(), retire: z.literal(true).optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change." });
export type TrainingCourseUpdate = z.infer<typeof trainingCourseUpdateSchema>;

export const trainingLessonCreateSchema = z.object({ courseId: recordId(), title });
export type TrainingLessonCreate = z.infer<typeof trainingLessonCreateSchema>;

export const trainingLessonUpdateSchema = z
  .object({ title: title.optional(), position: z.number().int().min(0).max(1000).optional(), retire: z.literal(true).optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change." });
export type TrainingLessonUpdate = z.infer<typeof trainingLessonUpdateSchema>;

/** Step 1 of an upload: what the browser is about to send. The API answers with a signed upload URL. */
export const trainingUploadStartSchema = z.object({
  lessonId: recordId(),
  fileName: z.string().trim().min(1).max(200),
  bytes: z.number().int().min(1).max(TRAINING_MEDIA_MAX_BYTES, "The video is larger than 100 MB. Export it smaller first."),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  language: z.enum(["en", "es"]).optional().default("en"),
});
export type TrainingUploadStart = z.infer<typeof trainingUploadStartSchema>;

const chapter = z.object({ title: z.string().trim().min(1).max(80), startMs: z.number().int().min(0) });
export const trainingVersionUpdateSchema = z
  .object({
    chapters: z.array(chapter).max(20).optional(),
    serveCount: z.number().int().min(1).max(20).optional(),
    passCount: z.number().int().min(1).max(20).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change." });
export type TrainingVersionUpdate = z.infer<typeof trainingVersionUpdateSchema>;

export const trainingQuestionSchema = z.object({
  chapter: z.number().int().min(0).max(50),
  /** Which of its segment's points it tests (0650): two questions with one point are two versions (D-TR15). */
  point: z.number().int().min(0).max(9),
  prompt: z.string().trim().min(3, "Write the question.").max(400),
  choices: z.array(z.string().trim().min(1).max(200)).min(2, "A question has at least 2 answers.").max(5, "A question has at most 5 answers."),
  answerIndex: z.number().int().min(0).max(4),
  why: z.string().trim().min(3, "Say why it is right.").max(400),
});
export type TrainingQuestionInput = z.infer<typeof trainingQuestionSchema>;

// ── the office: sending ────────────────────────────────────────────────────────────────────────

export const TRAINING_SEND_VIA = ["sms", "email", "copy"] as const;
export type TrainingSendVia = (typeof TRAINING_SEND_VIA)[number];

export const trainingAssignSchema = z.object({
  driverIds: z.array(recordId()).min(1, "Pick at least one driver.").max(200),
  courseId: recordId(),
  /** Null/absent = the whole course. */
  lessonIds: z.array(recordId()).min(1).max(100).nullable().optional().default(null),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().default(null),
});
export type TrainingAssign = z.infer<typeof trainingAssignSchema>;

/**
 * How one driver can be reached, decided by the API (D-TR11): a text only when a number AND a consent
 * that covers it exist — today that is an applicant with SMS consent; email when there is an address;
 * otherwise the office copies the link.
 */
export interface TrainingReach {
  sms: boolean;
  /** Why not, in the office's words, when `sms` is false. */
  smsReason: string | null;
  email: string | null;
}

/** One driver's outcome of a send. `link` is present only when the office must deliver it (copy). */
export interface TrainingSendOutcome {
  driverId: string;
  assignmentId: string;
  via: TrainingSendVia;
  ok: boolean;
  detail: string | null;
  link: string | null;
}

// ── the office: reading ────────────────────────────────────────────────────────────────────────

export type TrainingVersionState = "draft" | "processing" | "failed" | "ready" | "published" | "withdrawn";

export interface TrainingVersionSummary {
  id: string;
  versionNo: number;
  language: "en" | "es";
  state: TrainingVersionState;
  durationMs: number | null;
  chapters: TrainingChapter[];
  serveCount: number;
  passCount: number;
  questionCount: number;
  /** Where each question belongs, so the office page can say per segment what still blocks a publish. */
  questions: Array<{ chapter: number; point: number }>;
  processError: string | null;
  posterUrl: string | null;
  publishedAt: string | null;
}

export interface TrainingLessonSummary {
  id: string;
  title: string;
  position: number;
  retiredAt: string | null;
  /** Newest first. */
  versions: TrainingVersionSummary[];
}

export interface TrainingCourseSummary {
  id: string;
  title: string;
  description: string | null;
  position: number;
  retiredAt: string | null;
  lessons: TrainingLessonSummary[];
}

/** A question as the office edits it — with its answer, never sent to a driver's page. */
export interface TrainingQuestionView {
  id: string;
  chapter: number;
  point: number;
  prompt: string;
  choices: string[];
  answerIndex: number;
  why: string;
  position: number;
}

/** One row of the Progress tab. */
export interface TrainingAssignmentRow {
  id: string;
  driverId: string;
  driverName: string;
  courseId: string;
  courseTitle: string;
  sentAt: string;
  lastSentVia: TrainingSendVia | null;
  dueOn: string | null;
  firstOpenedAt: string | null;
  completedAt: string | null;
  revokedAt: string | null;
  lessons: Array<{
    lessonId: string;
    title: string;
    status: LessonStatus;
    watchedMs: number;
    durationMs: number;
    /** Right on the first try, out of every stop's questions (D-TR16); null before the first stop is answered. */
    firstTry: { correct: number; total: number } | null;
    /** Tries per stop, in stop order: [1, 3, 1] = stop 2 needed two retries. */
    tries: number[];
    /** Answers that came under 2 s after the one before: a tap-through rather than a read (§3.1). */
    fast: number;
    attempts: number;
  }>;
}

// ── the driver's link page ─────────────────────────────────────────────────────────────────────

export interface TrainingPortalLesson {
  lessonId: string;
  versionId: string;
  title: string;
  durationMs: number;
  posterUrl: string;
  status: LessonStatus;
}

/** `GET /api/public/training/:token` — the list. */
export interface TrainingPortalHome {
  carrier: string;
  firstName: string;
  courseTitle: string;
  dueOn: string | null;
  lessons: TrainingPortalLesson[];
  complete: boolean;
}

/** `GET …/films/:versionId` — one film, ready to play. URLs are signed for minutes. */
export interface TrainingPortalFilm {
  versionId: string;
  title: string;
  durationMs: number;
  chapters: TrainingChapter[];
  renditions: Array<{ height: number; url: string; bytes: number }>;
  posterUrl: string;
  captionsUrl: string | null;
  positionMs: number;
  watched: WatchedRanges;
  status: LessonStatus;
  /** The chapters to watch again after a missed stop. */
  rewatch: number[];
  /**
   * Where the next stop is (D-TR13): the segment whose end pauses the film, or — `status` "quiz" — the
   * segment whose questions are open now, or — "rewatch" — the one to watch again. Null once passed.
   */
  stop: { chapter: number; title: string; startMs: number; endMs: number } | null;
}

/** `POST …/progress` — one span the page played. */
export const trainingProgressSchema = z.object({
  versionId: recordId(),
  fromMs: z.number().int().min(0),
  toMs: z.number().int().min(0),
  positionMs: z.number().int().min(0),
});
export type TrainingProgress = z.infer<typeof trainingProgressSchema>;

/** `POST …/quiz` — start (or resume) the quiz. No answers in it. */
export interface TrainingPortalQuiz {
  attemptId: string;
  /** The stop these questions are about (D-TR13). */
  chapter: number;
  chapterTitle: string;
  questions: Array<{ id: string; prompt: string; choices: Array<{ id: string; text: string }> }>;
  /** Already answered on this attempt (a resumed quiz), with their feedback. */
  answered: Record<string, TrainingAnswerFeedback>;
}

export const trainingAnswerSchema = z.object({
  attemptId: recordId(),
  questionId: recordId(),
  choiceId: z.enum(["a", "b", "c", "d", "e"]),
});
export type TrainingAnswer = z.infer<typeof trainingAnswerSchema>;

/** The answer to one question, after it is given. */
export interface TrainingAnswerFeedback {
  right: boolean;
  /** The right answer and why — sent ONLY after a right answer. After a miss both are null (D-TR15). */
  answer: string | null;
  why: string | null;
  chapter: number;
}

/** `POST …/answer` — the feedback, and the result once the last question is answered. */
export interface TrainingAnswerResult {
  feedback: TrainingAnswerFeedback;
  result: { correct: number; total: number; passed: boolean; missedChapters: number[] } | null;
}
