import { z } from "zod";
import { recordId } from "./recordId.js";

/**
 * The office chat compliance console (docs/plans/messaging/OFFICE-CHAT-PLAN.md CHA2, D-CHAT14).
 *
 * "Admin to be able to audit messages" — through ONE door: the `chat.compliance` permission on the
 * Permissions page, step-up re-authentication, and a REASON on every request that returns another
 * person's words. The reason travels in the body (never a query string, which lands in access logs
 * by its own name) and is written into the org's chat ledger by the database function before any
 * content comes back, so the Access log can show who looked, when, at what and why.
 *
 * Every read is a POST for that reason: a search that leaves a record is an act, not a GET.
 */

export const CHAT_COMPLIANCE_REASONS = ["hr", "legal", "safety_incident", "customer_dispute", "security"] as const;
export type ChatComplianceReasonCategory = (typeof CHAT_COMPLIANCE_REASONS)[number];

export const CHAT_COMPLIANCE_REASON_LABELS: Record<ChatComplianceReasonCategory, string> = {
  hr: "HR matter",
  legal: "Legal matter",
  safety_incident: "Safety incident",
  customer_dispute: "Customer dispute",
  security: "Security",
};

/** The database checks the same bounds (0516 `chat_compliance_reason`, CH009). */
export const CHAT_COMPLIANCE_REASON_MIN = 10;
export const CHAT_COMPLIANCE_REASON_MAX = 500;

export const chatComplianceReasonSchema = z.object({
  category: z.enum(CHAT_COMPLIANCE_REASONS),
  text: z.string().trim().min(CHAT_COMPLIANCE_REASON_MIN).max(CHAT_COMPLIANCE_REASON_MAX),
});
export type ChatComplianceReason = z.infer<typeof chatComplianceReasonSchema>;

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Not a date");
const pageSize = z.number().int().min(1).max(100).optional();
/** Keyset cursor: both halves or neither. */
const cursor = {
  before_at: isoDate.optional(),
  before_id: recordId().optional(),
};
const bothOrNeither = (v: { before_at?: string; before_id?: string }) => (v.before_at === undefined) === (v.before_id === undefined);
const CURSOR_MESSAGE = "before_at and before_id go together";

// ── requests ──────────────────────────────────────────────────────────────────────────────────────

export const chatComplianceConversationsRequestSchema = z
  .object({
    reason: chatComplianceReasonSchema,
    person: recordId().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit: pageSize,
    ...cursor,
  })
  .refine(bothOrNeither, CURSOR_MESSAGE);
export type ChatComplianceConversationsRequest = z.infer<typeof chatComplianceConversationsRequestSchema>;

export const chatComplianceMessagesRequestSchema = z
  .object({
    reason: chatComplianceReasonSchema,
    thread: recordId().optional(),
    person: recordId().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    q: z.string().trim().max(200).optional(),
    limit: pageSize,
    ...cursor,
  })
  .refine(bothOrNeither, CURSOR_MESSAGE);
export type ChatComplianceMessagesRequest = z.infer<typeof chatComplianceMessagesRequestSchema>;

export const chatComplianceThreadRequestSchema = z.object({
  reason: chatComplianceReasonSchema,
  before_seq: z.number().int().positive().optional(),
  limit: pageSize,
});
export type ChatComplianceThreadRequest = z.infer<typeof chatComplianceThreadRequestSchema>;

// ── read shapes ───────────────────────────────────────────────────────────────────────────────────

export const chatComplianceMemberSchema = z.object({
  user_id: recordId(),
  name: z.string().nullable(),
  role: z.string(),
  member_role: z.string(),
  joined_at: z.string(),
  left_at: z.string().nullable(),
});
export type ChatComplianceMember = z.infer<typeof chatComplianceMemberSchema>;

export const chatComplianceVersionSchema = z.object({
  version: z.number().int(),
  body: z.string(),
  replaced_at: z.string(),
  replaced_by: recordId().nullable(),
});
export type ChatComplianceVersion = z.infer<typeof chatComplianceVersionSchema>;

export const chatComplianceConversationSchema = z.object({
  thread_id: recordId(),
  kind: z.string(),
  subject: z.string().nullable(),
  load_id: recordId().nullable(),
  created_at: z.string(),
  archived_at: z.string().nullable(),
  last_message_at: z.string(),
  message_count: z.number().int().nonnegative(),
  members: z.array(chatComplianceMemberSchema),
});
export type ChatComplianceConversation = z.infer<typeof chatComplianceConversationSchema>;

/** A message as the console sees it: its words even when retracted, and what an edit replaced. */
export const chatComplianceMessageSchema = z.object({
  id: recordId(),
  thread_id: recordId(),
  thread_kind: z.string().optional(),
  thread_subject: z.string().nullable().optional(),
  seq: z.number().int().positive(),
  sender_user_id: recordId().nullable(),
  sender_name: z.string().nullable(),
  body: z.string(),
  created_at: z.string(),
  edited_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  versions: z.array(chatComplianceVersionSchema),
});
export type ChatComplianceMessage = z.infer<typeof chatComplianceMessageSchema>;

export const chatComplianceConversationsResponseSchema = z.object({
  conversations: z.array(chatComplianceConversationSchema),
  next: z.object({ before_at: z.string(), before_id: recordId() }).nullable(),
});
export type ChatComplianceConversationsResponse = z.infer<typeof chatComplianceConversationsResponseSchema>;

export const chatComplianceMessagesResponseSchema = z.object({
  messages: z.array(chatComplianceMessageSchema),
  next: z.object({ before_at: z.string(), before_id: recordId() }).nullable(),
});
export type ChatComplianceMessagesResponse = z.infer<typeof chatComplianceMessagesResponseSchema>;

export const chatComplianceThreadResponseSchema = z.object({
  conversation: z.object({
    thread_id: recordId(),
    kind: z.string(),
    subject: z.string().nullable(),
    load_id: recordId().nullable(),
    created_at: z.string(),
    created_by: recordId().nullable(),
    archived_at: z.string().nullable(),
    last_message_at: z.string(),
    last_seq: z.number().int().nonnegative(),
    members: z.array(chatComplianceMemberSchema),
  }),
  /** Oldest first, for reading. */
  messages: z.array(chatComplianceMessageSchema),
  /** The page above, or null at the start. */
  before_seq: z.number().int().positive().nullable(),
});
export type ChatComplianceThreadResponse = z.infer<typeof chatComplianceThreadResponseSchema>;

export const chatComplianceAccessRowSchema = z.object({
  seq: z.number().int().positive(),
  occurred_at: z.string(),
  actor_user_id: recordId().nullable(),
  actor_name: z.string().nullable(),
  action: z.string(),
  thread_id: recordId().nullable(),
  subject_user_id: recordId().nullable(),
  subject_name: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()),
});
export type ChatComplianceAccessRow = z.infer<typeof chatComplianceAccessRowSchema>;

export const chatComplianceAccessLogResponseSchema = z.object({
  rows: z.array(chatComplianceAccessRowSchema),
  /** The seq to pass as `before_seq` for the older page; null at the end. */
  before_seq: z.number().int().positive().nullable(),
});
export type ChatComplianceAccessLogResponse = z.infer<typeof chatComplianceAccessLogResponseSchema>;

/** Somebody the console can filter by: every member of the org, driver logins and suspended people included. */
export const chatCompliancePersonSchema = z.object({
  user_id: recordId(),
  name: z.string().nullable(),
  role: z.string(),
  suspended: z.boolean(),
});
export type ChatCompliancePerson = z.infer<typeof chatCompliancePersonSchema>;

// ── words the console shares with the Access log ────────────────────────────────────────────────

export const CHAT_COMPLIANCE_ACTION_LABELS: Record<string, string> = {
  compliance_search: "Searched",
  compliance_view: "Opened a conversation",
  compliance_export: "Exported",
  hold_set: "Set a hold",
  hold_released: "Released a hold",
  retention_changed: "Changed retention",
  retention_purged: "Purged under retention",
};

/** The one line the Access log shows for an act's reason: "HR matter — the text they gave". */
export function chatComplianceReasonLine(detail: Record<string, unknown>): string {
  const r = detail.reason as { category?: unknown; text?: unknown } | undefined;
  if (!r || typeof r.category !== "string") return "";
  const label = CHAT_COMPLIANCE_REASON_LABELS[r.category as ChatComplianceReasonCategory] ?? r.category;
  return typeof r.text === "string" && r.text ? `${label} — ${r.text}` : label;
}
