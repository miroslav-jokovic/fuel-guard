import { z } from "zod";

/**
 * `POST /api/ai/ask`'s body (F21 R3a, 2026-11-10): the question, and the conversation so far.
 *
 * ── WHY HISTORY, AND WHY ONLY THE TEXT ───────────────────────────────────────────────────────────
 * Until R3a the endpoint took `{ question }` alone (AUDIT W1), so "and last month?" reached the model
 * with no subject. The composer warned "each question is answered on its own". Follow-ups need the
 * earlier turns. What goes back is each turn's QUESTION and ANSWER TEXT, never its tool results:
 * replaying figures would let a stale number from an hour ago stand in for a fresh read, and it would
 * re-send data to the model provider for no reason (D-AI7's spirit). The system prompt tells the model
 * to call a tool again for any figure it states.
 *
 * ── THE BUDGET ───────────────────────────────────────────────────────────────────────────────────
 * At most `ASSISTANT_HISTORY_TURNS` turns, newest kept, and at most `ASSISTANT_HISTORY_CHARS` of
 * answer text in all, oldest dropped first. A 25-row table answer is ~3,000 characters, so the
 * budget holds three or four table answers. At Haiku 5.5's $0.10 per MTok, a full history adds about
 * $0.0004 per round. `assistantHistoryForRequest` is the ONE trim, used by the web (what it sends) and
 * the API (what it accepts), so both apply the same rule.
 *
 * ── WHO CAN WRITE IT ─────────────────────────────────────────────────────────────────────────────
 * The browser, so it is untrusted text, exactly like the question: a forged "assistant" turn can put
 * words in the model's mouth, but no further than typing them into the question could. Access is
 * not decided by the conversation: the tool list and the per-call check are the caller's
 * (`assistantToolsFor`), every result is stripped (D-AI7), and every figure comes from a tool.
 */

/** The question's own cap, the composer's `QUESTION_MAX`. */
export const ASSISTANT_QUESTION_MAX = 500;
/** One earlier answer, as the audit row keeps it (`routes/ai.ts`). */
export const ASSISTANT_ANSWER_MAX = 4000;
export const ASSISTANT_HISTORY_TURNS = 6;
export const ASSISTANT_HISTORY_CHARS = 12_000;

// Cut to the caps rather than refused: an answer one character over is still the answer.
const turnSchema = z.object({
  question: z.string().trim().min(1).transform((s) => s.slice(0, ASSISTANT_QUESTION_MAX)),
  answer: z.string().trim().min(1).transform((s) => s.slice(0, ASSISTANT_ANSWER_MAX)),
});
export type AssistantHistoryTurn = z.infer<typeof turnSchema>;

export const assistantAskRequestSchema = z.object({
  question: z.string(),
  // Optional, so the web that sends `{ question }` alone keeps working while the two deploy apart.
  // Anything beyond the budget is cut, never refused: an over-long tab should still get its answer.
  history: z.array(z.unknown()).optional(),
});

/**
 * The turns a request carries: well-formed ones only, the newest `ASSISTANT_HISTORY_TURNS`, then
 * oldest-first dropped until the answers fit `ASSISTANT_HISTORY_CHARS`. Pure, order preserved
 * (oldest first, as the conversation ran).
 */
export function assistantHistoryForRequest(turns: readonly unknown[] | undefined): AssistantHistoryTurn[] {
  // Only the newest few can survive, so look at no more than a generous tail of a long tab.
  const valid = (turns ?? []).slice(-ASSISTANT_HISTORY_TURNS * 4).flatMap((t) => {
    const parsed = turnSchema.safeParse(t);
    return parsed.success ? [parsed.data] : [];
  });
  const kept = valid.slice(-ASSISTANT_HISTORY_TURNS);
  let chars = kept.reduce((n, t) => n + t.answer.length, 0);
  while (kept.length > 0 && chars > ASSISTANT_HISTORY_CHARS) chars -= kept.shift()!.answer.length;
  return kept;
}
