/**
 * Drawing a quiz from a film's question pool and grading it (D-TR7, D-TR8; the July plan's R5/R6).
 * Pure; the API persists what was served (`training_attempts.served`) so a record can be rebuilt, and
 * grades on the server — the answer never reaches the driver's page before they have answered.
 */

export const CHOICE_IDS = ["a", "b", "c", "d", "e"] as const;
export type ChoiceId = (typeof CHOICE_IDS)[number];

/** A question as stored (`training_questions`). */
export interface PoolQuestion {
  id: string;
  chapter: number;
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
 * Draw `count` questions, spread across chapters: one from each chapter in turn (chapters and the
 * questions inside each in random order) until enough are drawn. A pool of ten that is mostly about
 * chapter 1 still asks about chapter 3. Choice order is shuffled per question.
 *
 * `avoid` is the questions the driver saw on their last attempt: they are drawn last, so a retake gets
 * new questions while the pool allows ("You get new questions", the result screen).
 */
export function drawQuiz(pool: readonly PoolQuestion[], count: number, rnd: Random, avoid: ReadonlySet<string> = new Set()): ServedQuestion[] {
  const fresh = pool.filter((q) => !avoid.has(q.id));
  const seen = pool.filter((q) => avoid.has(q.id));
  const pick = (from: readonly PoolQuestion[], n: number): PoolQuestion[] => {
    const byChapter = new Map<number, PoolQuestion[]>();
    for (const q of shuffled(from, rnd)) byChapter.set(q.chapter, [...(byChapter.get(q.chapter) ?? []), q]);
    const queues = shuffled([...byChapter.values()], rnd);
    const out: PoolQuestion[] = [];
    while (out.length < n && queues.some((q) => q.length)) {
      for (const q of queues) {
        const next = q.shift();
        if (next && out.length < n) out.push(next);
      }
    }
    return out;
  };
  const first = pick(fresh, count);
  const chosen = first.length < count ? [...first, ...pick(seen, count - first.length)] : first;
  return chosen.map((q) => ({ questionId: q.id, order: shuffled(q.choices.map((c) => c.id), rnd) }));
}

export interface GradedQuiz {
  correct: number;
  total: number;
  passed: boolean;
  /** Chapters of the missed questions, ascending, once each — what D-TR8 sends the driver back to. */
  missedChapters: number[];
}

/** Grade a whole attempt. An unanswered question is wrong. */
export function gradeQuiz(
  served: readonly ServedQuestion[],
  pool: readonly PoolQuestion[],
  answers: Readonly<Record<string, string>>,
  passCount: number,
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
  return { correct, total: served.length, passed: correct >= passCount, missedChapters: [...missed].sort((a, b) => a - b) };
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

/**
 * What still stands between a film version and publishing, in the office's words; empty when it may
 * be published. A version needs at least as many questions as each driver is served, or every driver
 * gets a short quiz — and if passing needs more right answers than are asked, nobody can ever pass.
 * Read by the API, which refuses the publish, and by the office page, which says it before the click.
 * (The database's `training_publish_version` checks only that the video is ready; the count of
 * questions is the API's to check, and the frozen-version triggers hold it once published.)
 */
export function publishBlockers(v: { state: string; questionCount: number; serveCount: number; passCount: number }): string[] {
  const out: string[] = [];
  if (v.state !== "ready") out.push(v.state === "published" ? "It is already published." : "The video is not ready for phones yet.");
  if (v.questionCount < v.serveCount) out.push(`Write at least ${v.serveCount} questions: ${v.questionCount} so far. Each driver gets ${v.serveCount} drawn from the list.`);
  if (v.passCount > v.serveCount) out.push(`Passing needs ${v.passCount} right, but only ${v.serveCount} are asked.`);
  return out;
}
