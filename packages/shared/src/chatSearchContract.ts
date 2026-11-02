import { z } from "zod";
import { recordId } from "./recordId.js";
import { CHAT_KINDS } from "./chatContract.js";

/**
 * Office chat search (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH8; migration 0542 `chat_search`).
 *
 * A person searches the lines of the conversations they are in now — every word must match, each as the
 * beginning of a word, so "load" finds "loaded" and "2048" finds "L-20481" — across all of them, or
 * inside one (`thread`). The database decides what is readable and how words match; this is the shape
 * of the question and the answer, shared by the API and the web.
 */

/** The database reads the search to its 200th character (0542 `chat_search_query`); the API refuses a longer one. */
export const CHAT_SEARCH_MAX = 200;
/** One page of results, as 0542 defaults; it serves 50 at most. */
export const CHAT_SEARCH_PAGE = 25;

/** One line that matched — where it lives, who said it and what it says now. */
export const chatSearchLineSchema = z.object({
  id: recordId(),
  thread_id: recordId(),
  kind: z.enum(CHAT_KINDS),
  subject: z.string().nullable(),
  /** The channel's team; null for a direct or group conversation. */
  space_id: recordId().nullable(),
  /** The post a reply answers — where its thread opens. */
  parent_id: recordId().nullable(),
  seq: z.number().int().positive(),
  sender_user_id: recordId().nullable(),
  sender_name: z.string().nullable(),
  body: z.string(),
  created_at: z.string(),
});
export type ChatSearchLine = z.infer<typeof chatSearchLineSchema>;

export const chatSearchResponseSchema = z.object({
  items: z.array(chatSearchLineSchema),
  /** Present when another page exists: pass both back as `before_at` / `before_id`. */
  next: z.object({ before_at: z.string(), before_id: recordId() }).nullable(),
});
export type ChatSearchResponse = z.infer<typeof chatSearchResponseSchema>;
