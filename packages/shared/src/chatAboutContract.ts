import { z } from "zod";
import { recordId } from "./recordId.js";
import type { AppSection } from "./auth.js";
import { CHAT_GROUP_MAX } from "./chatContract.js";

/**
 * "Chat about this" (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH11, §9.4; migration 0543; D-CHAT31–34).
 *
 * A group conversation may be about ONE load, driver or truck, fixed when it is made. Its record's page
 * lists the conversations about it that the viewer is in — nobody else's (Q-CHAT6 (a)) — and the
 * conversation's header says what it is about, as a link back to that page.
 */

/** The kinds of record a conversation may be about — 0543's `chat_create_about` takes exactly these. */
export const CHAT_ABOUT_KINDS = ["load", "driver", "vehicle"] as const;
export type ChatAboutKind = (typeof CHAT_ABOUT_KINDS)[number];

/**
 * Who may start or list conversations about a record (D-CHAT33): whoever may read that record. A load and
 * a truck are readable by every office member of the organisation — `loads_select` and `vehicles_select`
 * check the organisation only, and office chat is office roles already — so they need no section here. A
 * driver's profile is read through `GET /api/drivers/:id`, which requires `roster` view, so a
 * conversation about a driver requires it too. When one of those gates changes, this changes with it:
 * `apps/api/src/modules/messaging/routes/chatAbout.test.ts` reads the roster route and fails if its gate moves.
 */
export const CHAT_ABOUT_READ_SECTION: Record<ChatAboutKind, AppSection | null> = {
  load: null,
  driver: "roster",
  vehicle: null,
};

/** Start a group about one record. `thread_id` is the client's, so a retried create returns the same group. */
export const chatCreateAboutRequestSchema = z.object({
  thread_id: recordId(),
  kind: z.enum(CHAT_ABOUT_KINDS),
  record_id: recordId(),
  subject: z.string().max(200).nullish(),
  member_ids: z.array(recordId()).min(1).max(CHAT_GROUP_MAX - 1),
});
export type ChatCreateAboutRequest = z.infer<typeof chatCreateAboutRequestSchema>;

/** One conversation about a record that the viewer is in (0543 `chat_about`). */
export const chatAboutConversationSchema = z.object({
  thread_id: recordId(),
  subject: z.string().nullable(),
  created_at: z.string(),
  last_message_at: z.string(),
  unread: z.coerce.number().int().nonnegative(),
  member_count: z.coerce.number().int().positive(),
  /** Up to four other people, for the row's title when it has no subject. */
  title_members: z.array(z.object({ user_id: recordId(), name: z.string().nullable() })),
});
export type ChatAboutConversation = z.infer<typeof chatAboutConversationSchema>;
export const chatAboutListResponseSchema = z.object({ conversations: z.array(chatAboutConversationSchema) });
export type ChatAboutListResponse = z.infer<typeof chatAboutListResponseSchema>;

/** What one conversation is about (0543 `chat_thread_about`): null for most conversations. */
export const chatThreadAboutSchema = z.object({
  kind: z.enum(CHAT_ABOUT_KINDS),
  record_id: recordId(),
  /** The load's ref, the driver's name, the truck's unit number. */
  label: z.string(),
});
export type ChatThreadAbout = z.infer<typeof chatThreadAboutSchema>;
export const chatThreadAboutResponseSchema = z.object({ about: chatThreadAboutSchema.nullable() });
export type ChatThreadAboutResponse = z.infer<typeof chatThreadAboutResponseSchema>;

/** "Load L-20481", "Driver Marcus Reyes", "Truck 702" — the header's words and a new conversation's subject. */
export function chatAboutTitle(kind: ChatAboutKind, label: string): string {
  const what = kind === "load" ? "Load" : kind === "driver" ? "Driver" : "Truck";
  return `${what} ${label.trim()}`;
}
