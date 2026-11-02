import { z } from "zod";

/**
 * "Catch me up" (OFFICE-CHAT-PLAN CH12, §9.5; D-CHAT16, D-CHAT37, D-CHAT38): a summary of the lines
 * in one conversation that the asker has not read yet, written by a model when they ask and never in the
 * background. Migration 0549 holds the rules; these two numbers are its, restated here because the API
 * and the web need to say them, and held equal to the SQL by `chatCatchupCheck.test.ts`.
 */

/** Catch-ups one person may ask for in any 24 hours (0549 `chat_catchup_left`). */
export const CHAT_CATCHUP_DAILY_CAP = 20;
/** The most unread lines one catch-up reads, the newest ones (0549 `chat_catchup_lines`). */
export const CHAT_CATCHUP_MAX_LINES = 200;

/**
 * The answer. `summary` is null when nothing is unread ("You're up to date"); then no model was asked,
 * nothing was ledgered and `left` is unchanged. `lines` is how many lines the summary was written from.
 */
export const chatCatchupResponseSchema = z.object({
  summary: z.string().nullable(),
  lines: z.number().int().min(0),
  left: z.number().int().min(0),
});
export type ChatCatchupResponse = z.infer<typeof chatCatchupResponseSchema>;
