import type {
  TrainingAnswerResult,
  TrainingPortalFilm,
  TrainingPortalHome,
  TrainingPortalQuiz,
} from "@silvicom/shared";
import { mergeQueued, type QueuedSpan } from "./signal";

/**
 * The driver's page talking to `/api/public/training/:token` (D-TR2). Only TYPES come from
 * `@silvicom/shared` — no runtime code — so the page stays small (D-TR12).
 *
 * ── NO SIGNAL DOES NOT LOSE WORK (§8.2 rule 5) ─────────────────────────────────────────────────
 * Watched spans that fail to send wait in localStorage and go when the connection returns. An answer
 * that fails to send waits too: the page says it is saved and moves on, and the feedback arrives with
 * the signal. Nothing is graded on the phone, so nothing waits that the server has not seen.
 */

export class LinkError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** True for a failure that is the network's, not the server's answer. */
export const isOffline = (e: unknown): boolean => !(e instanceof LinkError);

export function createApi(token: string, store: Storage = localStorage) {
  const base = `/api/public/training/${token}`;
  const spanKey = `training:${token}:spans`;
  const answerKey = `training:${token}:answers`;

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json" }, cache: "no-store" });
    const body = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
    if (!res.ok) throw new LinkError(body?.error?.message ?? "Something went wrong. Try again.", body?.error?.code ?? "error", res.status);
    return body as T;
  }

  const read = <T>(key: string): T[] => {
    try {
      return JSON.parse(store.getItem(key) ?? "[]") as T[];
    } catch {
      return [];
    }
  };
  const write = (key: string, v: unknown[]) => (v.length ? store.setItem(key, JSON.stringify(v)) : store.removeItem(key));

  /** Send every waiting span, oldest first; stop at the first that cannot go. */
  async function flushSpans(): Promise<void> {
    const waiting = mergeQueued(read<QueuedSpan>(spanKey));
    while (waiting.length) {
      try {
        await call("/progress", { method: "POST", body: JSON.stringify(waiting[0]) });
      } catch (e) {
        if (isOffline(e)) break; // try again when the signal is back; a refusal is dropped
      }
      waiting.shift();
    }
    write(spanKey, waiting);
  }

  return {
    home: () => call<TrainingPortalHome>(""),
    film: (versionId: string) => call<TrainingPortalFilm>(`/films/${versionId}`),
    quiz: (versionId: string) => call<TrainingPortalQuiz>(`/films/${versionId}/quiz`, { method: "POST" }),

    /** Report one played span; on no signal, keep it for later. Returns the film's status when sent. */
    async progress(span: QueuedSpan): Promise<string | null> {
      write(spanKey, [...read<QueuedSpan>(spanKey), span]);
      await flushSpans();
      return read<QueuedSpan>(spanKey).length ? null : "sent";
    },

    /** Answer one question. `null` = no signal; the answer waits and goes with `flushAnswers`. */
    async answer(attemptId: string, questionId: string, choiceId: string): Promise<TrainingAnswerResult | null> {
      try {
        return await call<TrainingAnswerResult>("/answers", { method: "POST", body: JSON.stringify({ attemptId, questionId, choiceId }) });
      } catch (e) {
        if (!isOffline(e)) throw e;
        write(answerKey, [...read(answerKey), { attemptId, questionId, choiceId }]);
        return null;
      }
    },

    /** Send waiting answers; returns each one's result, in order, for those that went. */
    async flushAnswers(): Promise<Array<{ questionId: string; result: TrainingAnswerResult }>> {
      const waiting = read<{ attemptId: string; questionId: string; choiceId: string }>(answerKey);
      const done: Array<{ questionId: string; result: TrainingAnswerResult }> = [];
      while (waiting.length) {
        const a = waiting[0]!;
        try {
          done.push({ questionId: a.questionId, result: await call<TrainingAnswerResult>("/answers", { method: "POST", body: JSON.stringify(a) }) });
        } catch (e) {
          if (isOffline(e)) break;
        }
        waiting.shift();
      }
      write(answerKey, waiting);
      return done;
    },

    flushSpans,
    pending: () => read(spanKey).length + read(answerKey).length,
  };
}

export type PortalApi = ReturnType<typeof createApi>;
