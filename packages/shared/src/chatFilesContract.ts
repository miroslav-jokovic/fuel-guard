import { z } from "zod";
import { recordId } from "./recordId.js";

/**
 * Office chat files (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH7; migration 0539, D-CHAT27–D-CHAT30).
 *
 * A file travels in three steps, so its bytes never pass through the API process (the reason
 * `document-intake` and `inventory/photos.ts` give — it also runs the schedulers):
 *   1. `POST /api/chat/:id/files` with what the file is → a file id and a signed upload URL, once the
 *      database says the person may write in that conversation (0539 `chat_file_can_upload`);
 *   2. the browser PUTs the bytes to that URL;
 *   3. the line is sent with `files: [...]`. The API reads the stored bytes back, checks their SHA-256,
 *      size and kind against what was declared, and only then writes the line and its files in one
 *      transaction (0539 `chat_send_files`). An upload no line claims is swept after 24 h.
 *
 * WHICH KINDS (D-CHAT30): what an office sends — photos, PDFs, the Office documents, plain text and CSV.
 * Nothing that runs: no executables, scripts, HTML or archives, which a work chat has no need for and
 * which are how a file becomes an attack. Each kind names its extensions (the picker's `accept`, and a
 * second check of the name) and whether a browser draws it inline (an image) or offers it to download.
 */
export const CHAT_FILE_MAX_BYTES = 25 * 1024 * 1024; // = 0539's bucket and CHECK; chatFilesContract.test.ts
export const CHAT_FILES_PER_LINE = 10; // = 0539's position CHECK

export const CHAT_FILE_TYPES = {
  "image/jpeg": { extensions: [".jpg", ".jpeg"], label: "Photo", inline: true },
  "image/png": { extensions: [".png"], label: "Image", inline: true },
  "image/webp": { extensions: [".webp"], label: "Image", inline: true },
  "image/gif": { extensions: [".gif"], label: "Image", inline: true },
  "application/pdf": { extensions: [".pdf"], label: "PDF", inline: false },
  "text/plain": { extensions: [".txt"], label: "Text", inline: false },
  "text/csv": { extensions: [".csv"], label: "CSV", inline: false },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { extensions: [".docx"], label: "Word", inline: false },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { extensions: [".xlsx"], label: "Excel", inline: false },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { extensions: [".pptx"], label: "PowerPoint", inline: false },
  "application/msword": { extensions: [".doc"], label: "Word", inline: false },
  "application/vnd.ms-excel": { extensions: [".xls"], label: "Excel", inline: false },
} as const satisfies Record<string, { extensions: readonly string[]; label: string; inline: boolean }>;
export type ChatFileMime = keyof typeof CHAT_FILE_TYPES;
export const CHAT_FILE_MIMES = Object.keys(CHAT_FILE_TYPES) as [ChatFileMime, ...ChatFileMime[]];

/** The picker's `accept`: every allowed extension. */
export const CHAT_FILE_ACCEPT = [...new Set(Object.values(CHAT_FILE_TYPES).flatMap((t) => t.extensions))].join(",");

/**
 * The kind a file is, judged by its NAME — what the browser's `File.type` often leaves blank (a CSV on
 * Windows, an .xlsx on some Linux desktops). Null when the extension is not one we take.
 */
export function chatFileMimeOf(fileName: string): ChatFileMime | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = fileName.slice(dot).toLowerCase();
  return CHAT_FILE_MIMES.find((m) => (CHAT_FILE_TYPES[m].extensions as readonly string[]).includes(ext)) ?? null;
}

/** "2.4 MB", "830 KB", "512 B" — the size a person reads on a file card. */
export function chatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const fileName = z.string().trim().min(1).max(200).refine((s) => !/[/\\]/.test(s), "A file name cannot contain a folder");

/** What a file is, declared before its upload and again with the line that carries it. */
export const chatFileDeclarationSchema = z.object({
  file_name: fileName,
  mime: z.enum(CHAT_FILE_MIMES),
  byte_size: z.number().int().min(1).max(CHAT_FILE_MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/).transform((s) => s.toLowerCase()),
}).refine((f) => chatFileMimeOf(f.file_name) === f.mime, { message: "The file's name and its kind do not match", path: ["file_name"] });
export type ChatFileDeclaration = z.infer<typeof chatFileDeclarationSchema>;

export const chatFileUploadResponseSchema = z.object({ file_id: recordId(), upload_url: z.string() });
export type ChatFileUploadResponse = z.infer<typeof chatFileUploadResponseSchema>;

/** A file named on a line being sent: its upload's id and the declaration it was uploaded with. */
export const chatFileRefSchema = z.object({ id: recordId() }).and(chatFileDeclarationSchema);
export type ChatFileRef = z.infer<typeof chatFileRefSchema>;

/** A line's file, as the readers return it (0539 `chat_line_files`) — never its storage key. */
export const chatAttachmentSchema = z.object({
  id: recordId(),
  file_name: z.string(),
  mime: z.string(),
  byte_size: z.number().int().nonnegative(),
});
export type ChatAttachment = z.infer<typeof chatAttachmentSchema>;

/** Where one file's bytes can be read for the next few minutes. */
export const chatFileLinkSchema = z.object({
  url: z.string(),
  file_name: z.string(),
  mime: z.string(),
  byte_size: z.number().int().nonnegative(),
});
export type ChatFileLink = z.infer<typeof chatFileLinkSchema>;

/** A conversation's files (0539 `chat_files`), newest first. */
export const chatFileListItemSchema = z.object({
  id: recordId(),
  message_id: recordId(),
  parent_id: recordId().nullable(),
  seq: z.number().int().positive(),
  file_name: z.string(),
  mime: z.string(),
  byte_size: z.number().int().nonnegative(),
  uploaded_by: recordId().nullable(),
  uploaded_by_name: z.string().nullable(),
  created_at: z.string(),
});
export type ChatFileListItem = z.infer<typeof chatFileListItemSchema>;
export const chatFilesResponseSchema = z.object({
  files: z.array(chatFileListItemSchema),
  next: z.object({ before_at: z.string(), before_id: recordId() }).nullable(),
});
export type ChatFilesResponse = z.infer<typeof chatFilesResponseSchema>;
