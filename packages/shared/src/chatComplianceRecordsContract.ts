import { z } from "zod";
import { recordId } from "./recordId.js";
import { chatComplianceMemberSchema, chatComplianceReasonSchema } from "./chatComplianceContract.js";

/**
 * Legal holds and exports in the office chat compliance console (OFFICE-CHAT-PLAN CHA3, D-CHAT15,
 * D-CHAT20; migration 0517).
 *
 * A HOLD is on a person or on a conversation, names its matter, and carries a reason; it is released
 * once, with a reason of its own, and never deleted. An EXPORT is one conversation or one messages
 * search, whole, written as three files: the JSONL (the evidence), the PDF (the readable copy) and
 * `manifest.json`, which ties the copy to the chat ledger. Every one of these acts is a ledger row,
 * written by the database in the same transaction, and an `audit_logs` row beside it.
 */

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Not a date");

// ── holds ─────────────────────────────────────────────────────────────────────────────────────────

export const CHAT_HOLD_SCOPES = ["person", "conversation"] as const;
export type ChatHoldScope = (typeof CHAT_HOLD_SCOPES)[number];

/** The database checks the same bounds (0517 `chat_hold_set`, CH010). */
export const CHAT_HOLD_MATTER_MIN = 3;
export const CHAT_HOLD_MATTER_MAX = 120;

export const chatHoldSetRequestSchema = z.object({
  reason: chatComplianceReasonSchema,
  scope: z.enum(CHAT_HOLD_SCOPES),
  target: recordId(),
  matter: z.string().trim().min(CHAT_HOLD_MATTER_MIN).max(CHAT_HOLD_MATTER_MAX),
});
export type ChatHoldSetRequest = z.infer<typeof chatHoldSetRequestSchema>;

export const chatHoldReleaseRequestSchema = z.object({ reason: chatComplianceReasonSchema });
export type ChatHoldReleaseRequest = z.infer<typeof chatHoldReleaseRequestSchema>;

export const chatHoldSchema = z.object({
  id: recordId(),
  scope: z.enum(CHAT_HOLD_SCOPES),
  user_id: recordId().nullable(),
  user_name: z.string().nullable(),
  thread_id: recordId().nullable(),
  thread_kind: z.string().nullable(),
  thread_subject: z.string().nullable(),
  matter: z.string(),
  reason: chatComplianceReasonSchema,
  set_by: recordId(),
  set_by_name: z.string().nullable(),
  set_at: z.string(),
  released_at: z.string().nullable(),
  released_by: recordId().nullable(),
  released_by_name: z.string().nullable(),
  release_reason: chatComplianceReasonSchema.nullable(),
});
export type ChatHold = z.infer<typeof chatHoldSchema>;

export const chatHoldsResponseSchema = z.object({ holds: z.array(chatHoldSchema) });
export type ChatHoldsResponse = z.infer<typeof chatHoldsResponseSchema>;

// ── exports ───────────────────────────────────────────────────────────────────────────────────────

export const CHAT_EXPORT_SCOPES = ["conversation", "search"] as const;
export type ChatExportScope = (typeof CHAT_EXPORT_SCOPES)[number];

/** The ceiling of one export (0517, CH010): past it the holder narrows by date. */
export const CHAT_EXPORT_MAX_LINES = 10_000;

/** How long an export's files stay in the bucket; the record stays for good (D-BD4's rule, D-CHAT20). */
export const CHAT_EXPORT_FILE_DAYS = 7;

/**
 * A conversation export names its conversation and nothing else; a search export takes the Messages
 * tab's filters, unpaged.
 */
export const chatExportRequestSchema = z
  .object({
    reason: chatComplianceReasonSchema,
    scope: z.enum(CHAT_EXPORT_SCOPES),
    thread: recordId().optional(),
    person: recordId().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    q: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.scope === "search" || (v.thread !== undefined && v.person === undefined && v.from === undefined && v.to === undefined && !v.q), {
    message: "A conversation export names its conversation and no other filter",
  });
export type ChatExportRequest = z.infer<typeof chatExportRequestSchema>;

export const CHAT_EXPORT_STATUSES = ["building", "ready", "failed"] as const;

export const chatExportSchema = z.object({
  id: recordId(),
  scope: z.enum(CHAT_EXPORT_SCOPES),
  thread_id: recordId().nullable(),
  thread_subject: z.string().nullable(),
  filters: z.record(z.string(), z.unknown()),
  reason: chatComplianceReasonSchema,
  requested_by: recordId(),
  requested_by_name: z.string().nullable(),
  created_at: z.string(),
  message_count: z.number().int().nonnegative(),
  ledger_seq: z.number().int().positive(),
  content_sha256: z.string(),
  status: z.enum(CHAT_EXPORT_STATUSES),
  bytes: z.number().int().positive().nullable(),
  expires_at: z.string().nullable(),
  purged_at: z.string().nullable(),
});
export type ChatExport = z.infer<typeof chatExportSchema>;

export const chatExportsResponseSchema = z.object({
  exports: z.array(chatExportSchema),
  /** The `created_at` to pass as `before_at` for the older page; null at the end. */
  before_at: z.string().nullable(),
});
export type ChatExportsResponse = z.infer<typeof chatExportsResponseSchema>;

export const CHAT_EXPORT_FILES = ["jsonl", "pdf", "manifest"] as const;
export type ChatExportFile = (typeof CHAT_EXPORT_FILES)[number];

/** Five-minute signed links to the three files, while they last. */
export const chatExportLinksResponseSchema = z.object({
  links: z.record(z.enum(CHAT_EXPORT_FILES), z.string()),
  expires_at: z.string(),
});
export type ChatExportLinksResponse = z.infer<typeof chatExportLinksResponseSchema>;

// ── the export's own rows (what 0517 `chat_compliance_export_rows` returns) ──────────────────────

export const chatExportVersionSchema = z.object({
  version: z.number().int(),
  body: z.string(),
  body_sha256: z.string(),
  replaced_at: z.string(),
  replaced_by: recordId().nullable(),
});

export const chatExportLineSchema = z.object({
  id: recordId(),
  thread_id: recordId(),
  seq: z.number().int().positive(),
  sender_user_id: recordId().nullable(),
  sender_name: z.string().nullable(),
  body: z.string(),
  body_sha256: z.string(),
  created_at: z.string(),
  edited_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  versions: z.array(chatExportVersionSchema),
});
export type ChatExportLine = z.infer<typeof chatExportLineSchema>;

export const chatExportConversationSchema = z.object({
  thread_id: recordId(),
  kind: z.string(),
  subject: z.string().nullable(),
  load_id: recordId().nullable(),
  created_at: z.string(),
  archived_at: z.string().nullable(),
  members: z.array(chatComplianceMemberSchema),
});
export type ChatExportConversation = z.infer<typeof chatExportConversationSchema>;

export const chatExportHeaderSchema = z.object({
  id: recordId(),
  scope: z.enum(CHAT_EXPORT_SCOPES),
  filters: z.record(z.string(), z.unknown()),
  reason: chatComplianceReasonSchema,
  requested_by: recordId(),
  requested_by_name: z.string().nullable(),
  created_at: z.string(),
  message_count: z.number().int().nonnegative(),
  ledger_seq: z.number().int().positive(),
  ledger_hash: z.string(),
  content_sha256: z.string(),
});
export type ChatExportHeader = z.infer<typeof chatExportHeaderSchema>;

export const chatExportRowsSchema = z.object({
  export: chatExportHeaderSchema,
  conversations: z.array(chatExportConversationSchema),
  lines: z.array(chatExportLineSchema),
});
export type ChatExportRows = z.infer<typeof chatExportRowsSchema>;

/**
 * How `content_sha256` is computed — the same words as 0517's header, because a court-side check
 * reads this and recomputes it from the JSONL.
 */
export const CHAT_EXPORT_FOLD =
  "For the lines in export order (conversation, then seq): sha256 of the lines' `id + ':' + sha256(body)` joined by '\\n', UTF-8, lower-case hex.";
