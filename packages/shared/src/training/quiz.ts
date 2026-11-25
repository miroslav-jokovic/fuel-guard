/**
 * Drawing one stop's questions from a film's bank and grading them (SEGMENT-QUIZ D-TR14/D-TR15; the
 * July plan's R5/R6). Pure; the API persists what was served (`training_attempts.served`) so a record
 * can be rebuilt, and grades on the server — the answer never reaches the driver's page before they
 * have answered, and after a miss it does not reach it at all (D-TR15).
 */

export const CHOICE_IDS = ["a", "b", "c", "d", "e"] as const;
export type ChoiceId = (typeof CHOICE_IDS)[number];

/** A question as stored (`training_questions`). */
export interface PoolQuestion {
  id: string;
  chapter: number;
  /** Which of its segment's points it tests; two questions with one point are two versions of it (0650). */
  point: number;
  prompt: string;
  choices: ReadonlyArray<{ id: string; text: string }>;
  answer: string;
  why: string;
}

/** One served question: which, and the order its choices were shown in. */
export interface ServedQuestion {
  questionId: string;
  order: string[];
}

/** A random source in [0, 1). The API passes `crypto`-backed randomness; tests pass a seeded one. */
export type Random = () => number;

function shuffled<T>(xs: readonly T[], rnd: Random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i] as T;
    a[i] = a[j] as T;
    a[j] = t;
  }
  return a;
}

/**
 * One stop's questions: one per point asked, each the version of that point served LEAST so far to
 * this driver (`served`: question id → times served), a tie broken at random. So a retry after a miss
 * asks the other version (D-TR15), and the first try on a film is a random version. Choice order is
 * shuffled each time. A point with no question in the bank is skipped — `publishBlockers` keeps that
 * from being published.
 */
export function drawSegment(
  pool: readonly PoolQuestion[],
  chapter: number,
  points: readonly number[],
  served: ReadonlyMap<string, number>,
  rnd: Random,
): ServedQuestion[] {
  return points.flatMap((point) => {
    const versions = pool.filter((q) => q.chapter === chapter && q.point === point);
    if (!versions.length) return [];
    const least = Math.min(...versions.map((v) => served.get(v.id) ?? 0));
    const pick = shuffled(versions.filter((v) => (served.get(v.id) ?? 0) === least), rnd)[0]!;
    return [{ questionId: pick.id, order: shuffled(pick.choices.map((c) => c.id), rnd) }];
  });
}

export interface GradedQuiz {
  correct: number;
  total: number;
  passed: boolean;
  /** Chapters of the missed questions, ascending, once each — what D-TR8 sends the driver back to. */
  missedChapters: number[];
}

/** Grade one stop's attempt. An unanswered question is wrong. A stop passes only with every answer right (D-TR14). */
export function gradeQuiz(
  served: readonly ServedQuestion[],
  pool: readonly PoolQuestion[],
  answers: Readonly<Record<string, string>>,
): GradedQuiz {
  const byId = new Map(pool.map((q) => [q.id, q]));
  let correct = 0;
  const missed = new Set<number>();
  for (const s of served) {
    const q = byId.get(s.questionId);
    if (!q) continue;
    if (answers[s.questionId] === q.answer) correct++;
    else missed.add(q.chapter);
  }
  return { correct, total: served.length, passed: correct === served.length, missedChapters: [...missed].sort((a, b) => a - b) };
}

/**
 * What is wrong with a question, or null: 2–5 non-empty choices, the answer one of them, the chapter
 * one the film has. Stated once for the office's form and the API.
 */
export function checkQuestion(q: { chapter: number; prompt: string; choices: readonly string[]; answerIndex: number; why: string }, chapterCount: number): string | null {
  if (q.prompt.trim().length < 3) return "Write the question.";
  if (q.choices.length < 2 || q.choices.length > 5) return "A question has 2 to 5 answers.";
  if (q.choices.some((c) => !c.trim())) return "An answer is empty.";
  if (new Set(q.choices.map((c) => c.trim().toLowerCase())).size !== q.choices.length) return "Two answers are the same.";
  if (q.answerIndex < 0 || q.answerIndex >= q.choices.length) return "Pick the right answer.";
  if (q.why.trim().length < 3) return "Say in one line why it is right — the driver reads it after answering.";
  if (q.chapter < 0 || q.chapter >= Math.max(1, chapterCount)) return "Pick the chapter this question comes from.";
  return null;
}
