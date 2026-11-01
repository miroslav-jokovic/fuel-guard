import { z } from "zod";
import { isRecordId, recordId } from "./recordId.js";
import { CHAT_FILES_PER_LINE, chatAttachmentSchema, chatFileRefSchema } from "./chatFilesContract.js";

/**
 * Office chat (docs/plans/messaging/OFFICE-CHAT-PLAN.md, CH1b) — the Teams-style conversations between
 * the people in the office: one per pair (`direct`), named groups (`group`), and channels (CH5).
 *
 * It is the same engine as the driver threads in `messagesContract.ts` (D-CHAT1: one set of tables,
 * a thread `kind`), but a different contract, because the two answer different questions: a driver
 * thread's audience is resolved by the server and never named by a client, while an office
 * conversation is exactly the people somebody chose (D-CHAT4, validated by migration 0512).
 *
 * TWO NUMBERS DO THE WORK (D-CHAT5). `seq` is a message's position in its conversation; unread is
 * `last_seq − read_seq`, computed in the database. `rev` moves on ANY change — a new message, an edit,
 * a retraction — so a client holding rev N asks `/sync?since_rev=N` and gets exactly what changed.
 * Bodies are null once retracted: the message keeps its place and renders as removed.
 */

export const CHAT_KINDS = ["direct", "group", "channel"] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

export const CHAT_MUTE_LEVELS = ["none", "mentions", "all"] as const;
export type ChatMuteLevel = (typeof CHAT_MUTE_LEVELS)[number];

/** The longest message, matching 0096's `messages_body_check`. */
export const CHAT_BODY_MAX = 4000;
/** A group holds at most this many people (0512); a larger audience is a channel. */
export const CHAT_GROUP_MAX = 250;
/** A page of history or of the inbox; the database clamps to 100 whatever is asked. */
export const CHAT_PAGE_SIZE = 50;

// ── Reactions (D-CHAT26) ──────────────────────────────────────────────────────────────────────────

/**
 * The six reactions, fixed (D-CHAT26): 👍 ❤️ 😂 😮 😢 ✅ — the last for "done", which an office says
 * more often than 😡. Stored as these keys, never as the emoji, and in this order everywhere a line's
 * reactions are listed (0523 `chat_line_reactions`). The database's CHECK lists the same six;
 * chatReactionCheck.test.ts holds the two together, so a seventh is one list here and one migration.
 */
export const CHAT_REACTIONS = ["thumbs_up", "heart", "laugh", "surprised", "sad", "done"] as const;
export type ChatReaction = (typeof CHAT_REACTIONS)[number];

/** What each key is drawn as. */
export const CHAT_REACTION_EMOJI: Record<ChatReaction, string> = {
  thumbs_up: "👍",
  heart: "❤️",
  laugh: "😂",
  surprised: "😮",
  sad: "😢",
  done: "✅",
};

/**
 * A line's reactions as the readers return them (0523 `chat_line_reactions`): each kind present, in
 * CHAT_REACTIONS' order, with the people who chose it in the order they did. A kind nobody chose is
 * absent rather than empty; a retracted line has none.
 */
export const chatLineReactionSchema = z.object({
  reaction: z.enum(CHAT_REACTIONS),
  users: z.array(recordId()),
});
export type ChatLineReaction = z.infer<typeof chatLineReactionSchema>;

// ── read shapes ───────────────────────────────────────────────────────────────────────────────────

export const chatPersonSchema = z.object({
  user_id: recordId(),
  name: z.string().nullable(),
});
export type ChatPerson = z.infer<typeof chatPersonSchema>;

/** Somebody a conversation may name — the people picker's row (`chat_people`). */
export const chatDirectoryEntrySchema = chatPersonSchema.extend({ role: z.string() });
export type ChatDirectoryEntry = z.infer<typeof chatDirectoryEntrySchema>;

export const chatLastMessageSchema = z.object({
  id: recordId(),
  seq: z.number().int(),
  sender_user_id: recordId().nullable(),
  sender_name: z.string().nullable(),
  body: z.string().nullable(),
  created_at: z.string(),
  deleted: z.boolean(),
});

/** One row of the inbox, and the header of an open conversation (the same query, D-CHAT5). */
export const chatConversationSchema = z.object({
  thread_id: recordId(),
  kind: z.enum(CHAT_KINDS),
  subject: z.string().nullable(),
  load_id: recordId().nullable(),
  created_at: z.string(),
  last_message_at: z.string(),
  last_seq: z.number().int().nonnegative(),
  rev: z.number().int().nonnegative(),
  read_seq: z.number().int().nonnegative(),
  unread: z.number().int().nonnegative(),
  muted: z.enum(CHAT_MUTE_LEVELS),
  member_role: z.enum(["owner", "member"]),
  member_count: z.number().int().nonnegative(),
  /** Up to four other people, for the row's title; the full list is the conversation's members. */
  title_members: z.array(chatPersonSchema),
  last_message: chatLastMessageSchema.nullable(),
});
export type ChatConversation = z.infer<typeof chatConversationSchema>;

export const chatMessageSchema = z.object({
  id: recordId(),
  thread_id: recordId(),
  seq: z.number().int().positive(),
  rev: z.number().int().positive(),
  sender_user_id: recordId().nullable(),
  sender_name: z.string().nullable(),
  /** Null once retracted. */
  body: z.string().nullable(),
  created_at: z.string(),
  edited_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  /**
   * Where the line sits in a channel's one-level reply shape (0519, D-CHAT19): the post it answers, or
   * null for a top-level line; and, on a post, its reply counters. History and sync carry them so a
   * client places every change in a channel's one ordered log. The defaults are a direct or group
   * conversation's true values (no parent, no replies) — what a row from before 0519 means.
   */
  parent_id: recordId().nullable().default(null),
  reply_count: z.number().int().nonnegative().default(0),
  last_reply_at: z.string().nullable().default(null),
  /**
   * CH6c (0523, D-CHAT24): the line's reactions, when it was pinned (null = not pinned), and whether
   * the CALLER saved it — a save is one person's bookmark and is never anybody else's to see. The
   * defaults are a line's true values before 0523, so a reader older than the schema parses.
   */
  reactions: z.array(chatLineReactionSchema).default([]),
  pinned_at: z.string().nullable().default(null),
  saved: z.boolean().default(false),
  /** CH7 (0539): the line's files, in the order sent; none once it is retracted. Default = before 0539. */
  attachments: z.array(chatAttachmentSchema).default([]),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatMemberSchema = chatPersonSchema.extend({
  member_role: z.enum(["owner", "member"]),
  read_seq: z.number().int().nonnegative(),
  last_read_at: z.string().nullable(),
  joined_at: z.string(),
});
export type ChatMember = z.infer<typeof chatMemberSchema>;

export const chatInboxResponseSchema = z.object({
  conversations: z.array(chatConversationSchema),
  /** Present when another page exists: pass both back as `before_at` / `before_id`. */
  next: z.object({ before_at: z.string(), before_id: recordId() }).nullable(),
  unread_total: z.number().int().nonnegative(),
});
export type ChatInboxResponse = z.infer<typeof chatInboxResponseSchema>;

export const chatConversationResponseSchema = z.object({
  conversation: chatConversationSchema,
  members: z.array(chatMemberSchema),
  /** The newest page, oldest first for rendering. */
  messages: z.array(chatMessageSchema),
  /** Pass as `before_seq` for the page above; null at the start of the conversation. */
  before_seq: z.number().int().positive().nullable(),
});
export type ChatConversationResponse = z.infer<typeof chatConversationResponseSchema>;

export const chatHistoryResponseSchema = z.object({
  messages: z.array(chatMessageSchema),
  before_seq: z.number().int().positive().nullable(),
});
export type ChatHistoryResponse = z.infer<typeof chatHistoryResponseSchema>;

export const chatSyncResponseSchema = z.object({
  /** Every message whose rev is above the one asked for, oldest change first. */
  changes: z.array(chatMessageSchema),
  /** The conversation's rev after these changes; the next `since_rev`. */
  rev: z.number().int().nonnegative(),
  /** True when more changes exist past this batch — ask again from `rev`. */
  more: z.boolean(),
});
export type ChatSyncResponse = z.infer<typeof chatSyncResponseSchema>;

export const chatSendResponseSchema = z.object({
  message_id: recordId(),
  seq: z.number().int().positive(),
  rev: z.number().int().positive(),
  created_at: z.string(),
  /** True when this id had already been delivered (a retried send). */
  duplicate: z.boolean(),
});
export type ChatSendResponse = z.infer<typeof chatSendResponseSchema>;

// ── write shapes ──────────────────────────────────────────────────────────────────────────────────

const body = z.string().refine((s) => s.trim().length > 0, "Write something first").pipe(z.string().max(CHAT_BODY_MAX));

/** Open (or find) the one conversation with this person. `thread_id` is used only if none exists yet. */
export const chatOpenDirectRequestSchema = z.object({
  thread_id: recordId(),
  user_id: recordId(),
});
export type ChatOpenDirectRequest = z.infer<typeof chatOpenDirectRequestSchema>;

export const chatCreateGroupRequestSchema = z.object({
  /** Client UUID: a retried create returns the same group. */
  thread_id: recordId(),
  subject: z.string().max(200).nullish(),
  member_ids: z.array(recordId()).min(1).max(CHAT_GROUP_MAX - 1),
});
export type ChatCreateGroupRequest = z.infer<typeof chatCreateGroupRequestSchema>;

/**
 * A line's words and, from CH7, its files. A line may be only files (0539, D-CHAT29) — the words may then
 * be empty — but never neither. Shared by a conversation's send and a channel reply's.
 */
export const chatLineFields = {
  body: z.string().max(CHAT_BODY_MAX).default(""),
  files: z.array(chatFileRefSchema).max(CHAT_FILES_PER_LINE).default([]),
};
export const wordsOrFiles = (l: { body: string; files: unknown[] }) => l.body.trim().length > 0 || l.files.length > 0;

export const chatSendRequestSchema = z.object({
  /** Client UUID and the row's primary key: a retried send is recognised, never doubled. */
  message_id: recordId(),
  ...chatLineFields,
}).refine(wordsOrFiles, { message: "Write something first", path: ["body"] });
export type ChatSendRequest = z.infer<typeof chatSendRequestSchema>;

export const chatEditRequestSchema = z.object({ body });
export type ChatEditRequest = z.infer<typeof chatEditRequestSchema>;

export const chatReadRequestSchema = z.object({
  /** Read up to here; omitted = everything. The database never moves the boundary back. */
  seq: z.number().int().nonnegative().optional(),
});
export type ChatReadRequest = z.infer<typeof chatReadRequestSchema>;

export const chatRenameRequestSchema = z.object({ subject: z.string().max(200).nullable() });
export type ChatRenameRequest = z.infer<typeof chatRenameRequestSchema>;

export const chatAddMembersRequestSchema = z.object({
  user_ids: z.array(recordId()).min(1).max(100),
});
export type ChatAddMembersRequest = z.infer<typeof chatAddMembersRequestSchema>;

/** Quieten a conversation for yourself (D-CHAT23): `mentions` lets only a mention through. */
export const chatMuteRequestSchema = z.object({ muted: z.enum(CHAT_MUTE_LEVELS) });
export type ChatMuteRequest = z.infer<typeof chatMuteRequestSchema>;

// ── Activity (D-CHAT25) ───────────────────────────────────────────────────────────────────────────

/**
 * Why a line is in your Activity. `reaction` (CH6c-2, D-CHAT25's third reason) is accepted here a merge
 * BEFORE any function emits it: the API parses `reason` strictly, so a `chat_activity` that sent
 * `reaction` to an API that did not know the word would fail every Activity request for the deploy
 * minutes (MIGRATION-DISCIPLINE §the-deploy-window). The function follows in its own migration.
 */
export const CHAT_ACTIVITY_REASONS = ["mention", "reply", "reaction"] as const;
export type ChatActivityReason = (typeof CHAT_ACTIVITY_REASONS)[number];

/**
 * One Activity line (0521 `chat_activity`): a line that named you, or a reply to a channel post you
 * wrote or answered. Derived on every read — there is no feed table — so a retracted line, or one in a
 * conversation you have left, is simply not listed any more. `at` is the instant the item arrived and,
 * with `message_id`, the keyset cursor; `unread` is `at` past your Activity read instant.
 */
export const chatActivityItemSchema = z.object({
  message_id: recordId(),
  reason: z.enum(CHAT_ACTIVITY_REASONS),
  at: z.string(),
  unread: z.boolean(),
  thread_id: recordId(),
  kind: z.enum(CHAT_KINDS),
  subject: z.string().nullable(),
  /** The channel's team; null for a direct or group conversation. */
  space_id: recordId().nullable(),
  /** The post a reply answers — where the reply panel opens. */
  parent_id: recordId().nullable(),
  seq: z.number().int().positive(),
  sender_user_id: recordId().nullable(),
  sender_name: z.string().nullable(),
  body: z.string().nullable(),
  created_at: z.string(),
  /**
   * A `reaction` item's who and what: somebody reacted to YOUR line, so `sender_*` is you and these say
   * who reacted and with which. Null for a mention or a reply, and absent from a function older than
   * the one that emits reactions — hence the defaults.
   */
  reaction: z.enum(CHAT_REACTIONS).nullable().default(null),
  reactor_user_id: recordId().nullable().default(null),
  reactor_name: z.string().nullable().default(null),
});
export type ChatActivityItem = z.infer<typeof chatActivityItemSchema>;

export const chatActivityResponseSchema = z.object({
  items: z.array(chatActivityItemSchema),
  /** Present when another page exists: pass both back as `before_at` / `before_id`. */
  next: z.object({ before_at: z.string(), before_id: recordId() }).nullable(),
  /** Every unread item, not this page's: the Activity tab's badge. */
  unread: z.number().int().nonnegative(),
});
export type ChatActivityResponse = z.infer<typeof chatActivityResponseSchema>;

export const chatActivityReadRequestSchema = z.object({
  /** Read up to here; omitted = now. The database never moves it back, nor past now. */
  at: z.iso.datetime({ offset: true }).optional(),
});
export type ChatActivityReadRequest = z.infer<typeof chatActivityReadRequestSchema>;

// ── mentions (D-CHAT22) ───────────────────────────────────────────────────────────────────────────

/**
 * A mention is a token in the body, `<@user-id>` — the one record of what was written, so the ledger's
 * hash, the export and the console all carry it in place. It reads the tokens 0521's `chat_mention_ids`
 * reads: `<@`, an id, `>`. The shape is taken loosely here and the id is judged by `isRecordId`, the one
 * definition of an id (D-US13, `lint:record-id`); for a whole token the two accept the same set, since
 * 36 characters of hex and hyphens between `<@` and `>` are an id exactly when they are 8-4-4-4-12.
 */
const MENTION_SHAPE = /<@([0-9a-fA-F-]{36})>/g;

export function chatMentionToken(userId: string): string {
  return `<@${userId.toLowerCase()}>`;
}

/** The people a body names, each once, lower-cased as the database stores them. */
export function chatMentionIds(body: string | null | undefined): string[] {
  if (!body) return [];
  return [...new Set([...body.matchAll(MENTION_SHAPE)].filter((m) => isRecordId(m[1])).map((m) => m[1]!.toLowerCase()))];
}

/**
 * A body as words: every token becomes `@Name`. A token whose person `nameOf` cannot name reads
 * `@someone` — never the raw id, which means nothing to a reader.
 */
export function chatBodyText(body: string, nameOf: (userId: string) => string | null | undefined): string {
  return body.replace(MENTION_SHAPE, (token, raw: string) =>
    isRecordId(raw) ? `@${nameOf(raw.toLowerCase())?.trim() || "someone"}` : token);
}

export type ChatBodyPart = { text: string } | { mention: string };

/** A body cut at its tokens, for a reader that draws a mention as something other than words (a chip). */
export function chatBodyParts(body: string): ChatBodyPart[] {
  const parts: ChatBodyPart[] = [];
  let at = 0;
  for (const m of body.matchAll(MENTION_SHAPE)) {
    if (!isRecordId(m[1])) continue;
    if (m.index > at) parts.push({ text: body.slice(at, m.index) });
    parts.push({ mention: m[1]!.toLowerCase() });
    at = m.index + m[0].length;
  }
  if (at < body.length) parts.push({ text: body.slice(at) });
  return parts;
}

// ── derivations the inbox and the conversation share ────────────────────────────────────────────

/**
 * What a conversation is called. A group's own name; otherwise the people in it — never "Conversation"
 * when there is anybody to name.
 */
export function chatTitle(c: Pick<ChatConversation, "kind" | "subject" | "title_members" | "member_count">): string {
  if (c.kind !== "direct" && c.subject?.trim()) return c.subject.trim();
  const names = c.title_members.map((m) => m.name).filter((n): n is string => !!n);
  if (names.length === 0) return c.kind === "direct" ? "Conversation" : "Group";
  // member_count includes the viewer; title_members does not.
  const others = Math.max(c.member_count - 1, names.length);
  if (others <= names.length) return names.join(", ");
  return `${names.join(", ")} +${others - names.length}`;
}

/** A one-line preview for the inbox row; a mention reads as `@Name` (`nameOf`), never as its token. */
export function chatPreview(
  m: ChatConversation["last_message"], max = 90, nameOf: (userId: string) => string | null | undefined = () => null,
): string {
  if (!m) return "No messages yet";
  if (m.deleted || m.body === null) return "Message removed";
  const text = chatBodyText(m.body, nameOf).replace(/\s+/g, " ").trim();
  // A line with no words carries a file — the database refuses one with neither (0539, D-CHAT29).
  if (!text) return "Sent a file";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// ── Reactions, pins and saved lines (CH6c-2) ─────────────────────────────────────────────────────

/** Add (`on: true`) or take back one of your reactions. Idempotent both ways (0523 `chat_react`). */
export const chatReactRequestSchema = z.object({ reaction: z.enum(CHAT_REACTIONS), on: z.boolean() });
export type ChatReactRequest = z.infer<typeof chatReactRequestSchema>;

/** Pin or unpin a line (anybody in the conversation), or save or unsave it (for yourself). */
export const chatToggleRequestSchema = z.object({ on: z.boolean() });
export type ChatToggleRequest = z.infer<typeof chatToggleRequestSchema>;

/** One pinned line of a conversation (0523 `chat_pins`), the latest pin first. */
export const chatPinnedLineSchema = z.object({
  id: recordId(),
  thread_id: recordId(),
  seq: z.number().int().positive(),
  rev: z.number().int().positive(),
  sender_user_id: recordId().nullable(),
  sender_name: z.string().nullable(),
  body: z.string().nullable(),
  created_at: z.string(),
  edited_at: z.string().nullable(),
  parent_id: recordId().nullable(),
  pinned_at: z.string(),
  pinned_by: recordId().nullable(),
  pinned_by_name: z.string().nullable(),
});
export type ChatPinnedLine = z.infer<typeof chatPinnedLineSchema>;
export const chatPinsResponseSchema = z.object({ pins: z.array(chatPinnedLineSchema) });
export type ChatPinsResponse = z.infer<typeof chatPinsResponseSchema>;

/** One of the caller's saved lines (0523 `chat_saved`), with where it lives so it can be opened. */
export const chatSavedLineSchema = z.object({
  message_id: recordId(),
  saved_at: z.string(),
  thread_id: recordId(),
  kind: z.enum(CHAT_KINDS),
  subject: z.string().nullable(),
  space_id: recordId().nullable(),
  parent_id: recordId().nullable(),
  seq: z.number().int().positive(),
  sender_user_id: recordId().nullable(),
  sender_name: z.string().nullable(),
  body: z.string().nullable(),
  created_at: z.string(),
});
export type ChatSavedLine = z.infer<typeof chatSavedLineSchema>;
export const chatSavedResponseSchema = z.object({
  items: z.array(chatSavedLineSchema),
  /** Present when another page exists: pass both back as `before_at` / `before_id`. */
  next: z.object({ before_at: z.string(), before_id: recordId() }).nullable(),
});
export type ChatSavedResponse = z.infer<typeof chatSavedResponseSchema>;
