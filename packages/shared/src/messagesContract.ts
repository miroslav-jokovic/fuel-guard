import { z } from "zod";

/**
 * Messages (Phase 5M, decision D54) — office↔driver, optionally bound to a load.
 *
 * The binding is what makes this useful rather than a second inbox nobody reads: a thread that
 * carries `load_id` proves both sides are talking about the same run, and surfaces on the load
 * detail for dispatch and driver alike.
 *
 * Outbound rides the Phase-2 outbox (client-UUID PK, so a replayed drain no-ops); inbound is
 * Supabase Realtime with a cache-backed fallback poll — the first inbound path in a stack whose
 * offline model has been write-only until now.
 */

export const THREAD_STATUSES = ["open", "closed"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export const PARTICIPANT_ROLES = ["driver", "office"] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

// ── read shapes ───────────────────────────────────────────────────────────────
export const messageSchema = z.object({
  id: z.uuid(),
  thread_id: z.uuid(),
  sender_user_id: z.uuid().nullable(),
  sender_name: z.string().nullable().default(null),
  body: z.string(),
  created_at: z.string(),
  edited_at: z.string().nullable().default(null),
  deleted_at: z.string().nullable().default(null),
});
export type Message = z.infer<typeof messageSchema>;

export const threadParticipantSchema = z.object({
  user_id: z.uuid(),
  name: z.string().nullable().default(null),
  role: z.enum(PARTICIPANT_ROLES),
  last_read_at: z.string().nullable(),
});
export type ThreadParticipant = z.infer<typeof threadParticipantSchema>;

export const threadSchema = z.object({
  id: z.uuid(),
  subject: z.string().nullable(),
  load_id: z.uuid().nullable(),
  load_ref: z.string().nullable().default(null),
  status: z.enum(THREAD_STATUSES),
  last_message_at: z.string(),
  created_at: z.string(),
  participants: z.array(threadParticipantSchema).default([]),
  /** The most recent message, for the list row — the full thread is fetched on open. */
  last_message: messageSchema.nullable().default(null),
  unread: z.number().int().nonnegative().default(0),
});
export type Thread = z.infer<typeof threadSchema>;

export const threadsResponseSchema = z.object({
  threads: z.array(threadSchema),
  unread_total: z.number().int().nonnegative(),
});
export type ThreadsResponse = z.infer<typeof threadsResponseSchema>;

export const threadDetailResponseSchema = z.object({
  thread: threadSchema,
  messages: z.array(messageSchema),
});
export type ThreadDetailResponse = z.infer<typeof threadDetailResponseSchema>;

// ── write shapes ──────────────────────────────────────────────────────────────
/**
 * Start a conversation. The client does NOT choose participants — the server resolves the audience
 * (the driver plus the org's dispatch-capable users), because letting a client name participants is
 * how someone ends up in a thread they should never have seen.
 */
export const createThreadRequestSchema = z.object({
  /** Client UUID: the thread and its first message are one queued unit. */
  thread_id: z.uuid(),
  message_id: z.uuid(),
  subject: z.string().max(200).optional(),
  /** Bind it to a load whenever there is one — see the note at the top of this file. */
  load_id: z.uuid().nullish(),
  /** Office-side only: which driver this is with. A driver's own thread targets dispatch. */
  driver_id: z.uuid().nullish(),
  body: z.string().min(1).max(4000),
});
export type CreateThreadRequest = z.infer<typeof createThreadRequestSchema>;

export const sendMessageRequestSchema = z.object({
  /** Client UUID and the row PK — a replayed outbox drain collides and no-ops. */
  message_id: z.uuid(),
  body: z.string().min(1).max(4000),
  occurred_at: z.string().optional(),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const MESSAGE_REPORT_REASONS = ["abusive", "inappropriate", "spam", "other"] as const;
export type MessageReportReason = (typeof MESSAGE_REPORT_REASONS)[number];

export const MESSAGE_REPORT_LABELS: Record<MessageReportReason, string> = {
  abusive: "Abusive or threatening",
  inappropriate: "Inappropriate content",
  spam: "Spam",
  other: "Something else",
};

/** The report affordance Apple 1.2 expects of in-app user-generated content, even internal-only. */
export const reportMessageRequestSchema = z.object({
  reason: z.enum(MESSAGE_REPORT_REASONS),
  note: z.string().max(500).optional(),
});
export type ReportMessageRequest = z.infer<typeof reportMessageRequestSchema>;

// ── derivations shared by the app and the dispatch inbox ──────────────────────
/**
 * How many messages this user has not seen. A message you sent yourself is never unread, which
 * sounds obvious and is the single most common bug in a thread list.
 */
export function unreadFor(
  messages: readonly Pick<Message, "created_at" | "sender_user_id" | "deleted_at">[],
  userId: string,
  lastReadAt: string | null,
): number {
  const boundary = lastReadAt ? Date.parse(lastReadAt) : Number.NEGATIVE_INFINITY;
  return messages.filter(
    (m) =>
      m.deleted_at === null &&
      m.sender_user_id !== userId &&
      Date.parse(m.created_at) > boundary,
  ).length;
}

/**
 * What to call a thread in a list. Prefer the explicit subject, then the load it is about, then the
 * other people in it — a row reading "Thread" helps nobody.
 */
export function threadTitle(
  thread: Pick<Thread, "subject" | "load_ref" | "participants">,
  viewerId: string,
): string {
  if (thread.subject?.trim()) return thread.subject.trim();
  if (thread.load_ref) return `Load ${thread.load_ref}`;
  const others = thread.participants.filter((p) => p.user_id !== viewerId && p.name);
  if (others.length === 1) return others[0]!.name!;
  if (others.length > 1) return `${others[0]!.name} +${others.length - 1}`;
  return "Conversation";
}

/** A retracted message still occupies its place in the conversation — silently vanishing reads as a bug. */
export function messageBody(message: Pick<Message, "body" | "deleted_at">): string {
  return message.deleted_at ? "Message removed" : message.body;
}

/** Has the other side seen it? The column dispatch actually asked for. */
export function seenByOthers(
  thread: Pick<Thread, "participants">,
  messageAt: string,
  senderId: string,
): boolean {
  const sent = Date.parse(messageAt);
  const others = thread.participants.filter((p) => p.user_id !== senderId);
  if (others.length === 0) return false;
  return others.some((p) => p.last_read_at !== null && Date.parse(p.last_read_at) >= sent);
}

/** Threads a driver sees first: unread, then most recent. */
export function sortThreads(threads: readonly Thread[]): Thread[] {
  return [...threads].sort((a, b) => {
    if ((a.unread > 0) !== (b.unread > 0)) return a.unread > 0 ? -1 : 1;
    return b.last_message_at.localeCompare(a.last_message_at);
  });
}

/** A one-line preview for the list row, collapsed and clipped. */
export function messagePreview(message: Message | null, max = 90): string {
  if (!message) return "No messages yet";
  const text = messageBody(message).replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
