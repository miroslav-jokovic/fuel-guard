import { z } from "zod";
import { recordId } from "./recordId.js";
import { CHAT_MUTE_LEVELS, chatLineFields, chatMessageSchema, wordsOrFiles } from "./chatContract.js";

/**
 * Office chat teams, channels and replies (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH5b; D-CHAT17–19,
 * D-CHAT21) — the shapes of `/api/chat/teams…`, `/api/chat/channels…` and the reply routes.
 *
 * A TEAM is a set of people with a General channel everyone in it is in. A CHANNEL is a conversation
 * (`kind = 'channel'`) in a team, so everything `chatContract.ts` says about a conversation — `seq`,
 * `rev`, `last_seq − read_seq`, sync — holds for one unchanged (D-CHAT18). A REPLY is a message whose
 * `parent_id` names a top-level post of the same channel, one level deep (D-CHAT19).
 *
 * Who may make a team is the `chat.teams` permission (Settings → Permissions, admins by default); the
 * same answer lets its holder manage any team of the organisation without being in it, and never read
 * one (0520, D-CHAT21). Every other rule is the database's (0519, 0520), and arrives as an error code.
 */

/** 0518's checks: a team's name 1–80 characters, its description up to 500; a channel's name 1–80. */
export const CHAT_TEAM_NAME_MAX = 80;
export const CHAT_TEAM_DESCRIPTION_MAX = 500;
export const CHAT_CHANNEL_NAME_MAX = 80;
/** How many people one add names. The database has no team cap; this bounds one request's loop. */
export const CHAT_TEAM_ADD_MAX = 500;

export const CHAT_SPACE_ROLES = ["owner", "member"] as const;
export type ChatSpaceRole = (typeof CHAT_SPACE_ROLES)[number];
export const CHAT_CHANNEL_VISIBILITIES = ["public", "private"] as const;
export type ChatChannelVisibility = (typeof CHAT_CHANNEL_VISIBILITIES)[number];

// ── read shapes ───────────────────────────────────────────────────────────────────────────────────

/** A channel as the Teams rail lists it: every public one of the team, and the private ones you are in. */
export const chatTeamChannelSchema = z.object({
  thread_id: recordId(),
  name: z.string(),
  visibility: z.enum(CHAT_CHANNEL_VISIBILITIES),
  general: z.boolean(),
  /** Whether you are in it. A public channel you are not in is listed so you can join it. */
  joined: z.boolean(),
  last_message_at: z.string(),
  last_seq: z.number().int().nonnegative(),
  /** Null when you are not in it: there is no read boundary to report. */
  read_seq: z.number().int().nonnegative().nullable(),
  /** `last_seq − read_seq` (D-CHAT5); 0 for a channel you are not in. */
  unread: z.number().int().nonnegative(),
  muted: z.enum(CHAT_MUTE_LEVELS).nullable(),
});
export type ChatTeamChannel = z.infer<typeof chatTeamChannelSchema>;

/** One team on your Teams rail. */
export const chatTeamSchema = z.object({
  space_id: recordId(),
  name: z.string(),
  description: z.string().nullable(),
  space_role: z.enum(CHAT_SPACE_ROLES),
  member_count: z.coerce.number().int().nonnegative(),
  created_at: z.string(),
  channels: z.array(chatTeamChannelSchema),
});
export type ChatTeam = z.infer<typeof chatTeamSchema>;

export const chatTeamsResponseSchema = z.object({
  teams: z.array(chatTeamSchema),
  /** Whether you hold `chat.teams`: the "New team" button reads this, the API asks it again on every act. */
  can_manage: z.boolean(),
});
export type ChatTeamsResponse = z.infer<typeof chatTeamsResponseSchema>;

export const chatTeamMemberSchema = z.object({
  user_id: recordId(),
  name: z.string().nullable(),
  role: z.string().nullable(),
  space_role: z.enum(CHAT_SPACE_ROLES),
  joined_at: z.string(),
});
export type ChatTeamMember = z.infer<typeof chatTeamMemberSchema>;

/** Settings → Chat teams: every team of the organisation, for a holder of `chat.teams` (0520). */
export const chatTeamDirectoryEntrySchema = z.object({
  space_id: recordId(),
  name: z.string(),
  description: z.string().nullable(),
  created_at: z.string(),
  created_by_name: z.string().nullable(),
  archived_at: z.string().nullable(),
  member_count: z.coerce.number().int().nonnegative(),
  channel_count: z.coerce.number().int().nonnegative(),
  owners: z.array(z.object({ user_id: recordId(), name: z.string().nullable() })),
  /** Whether the holder is in it. A holder outside a team manages it and reads none of its channels. */
  is_member: z.boolean(),
});
export type ChatTeamDirectoryEntry = z.infer<typeof chatTeamDirectoryEntrySchema>;

/**
 * A channel post or a reply. The same row as a conversation's message — `parent_id`, `reply_count` and
 * `last_reply_at` are on every message since 0519 — named for what the channel view shows.
 */
export const chatPostSchema = chatMessageSchema;
export type ChatPost = z.infer<typeof chatPostSchema>;

/** A page of posts or of one post's replies, oldest first; `before_seq` asks the page before it. */
export const chatPostPageSchema = z.object({
  posts: z.array(chatPostSchema),
  before_seq: z.number().int().positive().nullable(),
});
export type ChatPostPage = z.infer<typeof chatPostPageSchema>;

// ── write shapes ──────────────────────────────────────────────────────────────────────────────────

const name = (max: number) =>
  z.string().refine((s) => s.trim().length > 0, "Give it a name").pipe(z.string().max(max));

export const chatCreateTeamRequestSchema = z.object({
  /** Client UUIDs: a retried create returns the same team (0519 is idempotent on the team's id). */
  space_id: recordId(),
  general_id: recordId(),
  name: name(CHAT_TEAM_NAME_MAX),
  description: z.string().max(CHAT_TEAM_DESCRIPTION_MAX).nullish(),
  /** The others; the creator is in it and owns it. */
  member_ids: z.array(recordId()).max(CHAT_TEAM_ADD_MAX).default([]),
});
export type ChatCreateTeamRequest = z.infer<typeof chatCreateTeamRequestSchema>;

/** Rename or describe a team. An omitted field stays as it is; an empty description clears it. */
export const chatUpdateTeamRequestSchema = z
  .object({
    name: name(CHAT_TEAM_NAME_MAX).optional(),
    description: z.string().max(CHAT_TEAM_DESCRIPTION_MAX).optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, "Nothing to change");
export type ChatUpdateTeamRequest = z.infer<typeof chatUpdateTeamRequestSchema>;

export const chatTeamAddMembersRequestSchema = z.object({
  user_ids: z.array(recordId()).min(1).max(CHAT_TEAM_ADD_MAX),
});
export type ChatTeamAddMembersRequest = z.infer<typeof chatTeamAddMembersRequestSchema>;

export const chatTeamSetRoleRequestSchema = z.object({ space_role: z.enum(CHAT_SPACE_ROLES) });
export type ChatTeamSetRoleRequest = z.infer<typeof chatTeamSetRoleRequestSchema>;

export const chatCreateChannelRequestSchema = z.object({
  /** Client UUID: a retried create returns the same channel. */
  thread_id: recordId(),
  name: name(CHAT_CHANNEL_NAME_MAX),
  visibility: z.enum(CHAT_CHANNEL_VISIBILITIES),
  /** A private channel's people besides you, each in the team. Ignored for a public channel. */
  member_ids: z.array(recordId()).max(CHAT_TEAM_ADD_MAX).default([]),
});
export type ChatCreateChannelRequest = z.infer<typeof chatCreateChannelRequestSchema>;

export const chatRenameChannelRequestSchema = z.object({ name: name(CHAT_CHANNEL_NAME_MAX) });
export type ChatRenameChannelRequest = z.infer<typeof chatRenameChannelRequestSchema>;

export const chatSendReplyRequestSchema = z.object({
  /** Client UUID: a retried reply is recognised, never doubled. */
  message_id: recordId(),
  ...chatLineFields, // words and/or files (CH7)
}).refine(wordsOrFiles, { message: "Write something first", path: ["body"] });
export type ChatSendReplyRequest = z.infer<typeof chatSendReplyRequestSchema>;
