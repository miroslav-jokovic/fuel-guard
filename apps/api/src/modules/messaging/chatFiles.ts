import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHAT_FILE_TYPES,
  CHAT_PAGE_SIZE,
  chatFileListItemSchema,
  type ChatFileDeclaration,
  type ChatFileLink,
  type ChatFileMime,
  type ChatFileRef,
  type ChatFilesResponse,
  type ChatFileUploadResponse,
  type ChatSendResponse,
} from "@silvicom/shared";
import { rpc, type ChatResult } from "./chat.js";

/**
 * Office chat's files (OFFICE-CHAT-PLAN CH7; migration 0539, D-CHAT27–D-CHAT30). The bytes never pass
 * through this process on the way IN — the browser PUTs them to a signed URL — and are read back exactly
 * once, at send, to be checked: the SHA-256 the ledger will record is computed HERE from what is stored,
 * never taken from the browser (D-CHAT28), and the first bytes must be the kind the file claims to be.
 *
 * Who may do what is the database's, as everywhere in chat (chat.ts): `chat_file_can_upload` before a
 * URL is signed, `chat_send_files` for the line and its files in one transaction, `chat_file_for` before
 * a file is served. Every call carries the org and user from the verified token.
 */
export const CHAT_FILES_BUCKET = "chat-files";
/** A download link lives this long: enough to open it, too short to be worth forwarding. */
const LINK_SECONDS = 300;

const objectKey = (orgId: string, threadId: string, fileId: string) => `${orgId}/${threadId}/${fileId}`;

/** May this person put a file here? Then a file id and a signed URL its bytes go to. */
export async function chatFileUpload(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string, _file: ChatFileDeclaration,
  newId: () => string = randomUUID,
): Promise<ChatResult<ChatFileUploadResponse>> {
  const may = await rpc<boolean>(admin, "chat_file_can_upload", { p_org: orgId, p_user: userId, p_thread: threadId });
  if (!may.ok) return may;
  const fileId = newId();
  const { data, error } = await admin.storage.from(CHAT_FILES_BUCKET).createSignedUploadUrl(objectKey(orgId, threadId, fileId));
  if (error || !data) throw new Error(`chat-files upload URL: ${error?.message ?? "no URL"}`);
  return { ok: true, value: { file_id: fileId, upload_url: data.signedUrl } };
}

/**
 * Does `bytes` begin the way a file of `mime` does? The magic numbers of each kind we take; a text kind
 * has no magic number, so it must simply not look binary (no NUL in its first 8 KB). A file whose bytes
 * contradict its name is refused — a ".pdf" that is an executable never reaches anybody's screen.
 */
export function bytesAreKind(bytes: Uint8Array, mime: ChatFileMime): boolean {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  const ascii = (at: number, s: string) => [...s].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  switch (mime) {
    case "image/jpeg": return starts(0xff, 0xd8, 0xff);
    case "image/png": return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/gif": return ascii(0, "GIF87a") || ascii(0, "GIF89a");
    case "image/webp": return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "application/pdf": return ascii(0, "%PDF-");
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return starts(0x50, 0x4b, 0x03, 0x04); // a zip, as every OOXML file is
    case "application/msword":
    case "application/vnd.ms-excel":
      return starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1); // the OLE compound file
    case "text/plain":
    case "text/csv":
      return !bytes.subarray(0, 8192).includes(0);
  }
}

type Refusal = { ok: false; status: 422; code: string; message: string };
const refuse = (code: string, message: string): Refusal => ({ ok: false, status: 422, code, message });

/**
 * Read each stored file back and hold it to its declaration: there, the size declared, the hash declared,
 * and bytes of the kind declared. One file at a time, so at most one 25 MB buffer is held.
 */
export async function verifyChatFiles(
  admin: SupabaseClient, orgId: string, threadId: string, files: readonly ChatFileRef[],
): Promise<Refusal | null> {
  for (const f of files) {
    const { data, error } = await admin.storage.from(CHAT_FILES_BUCKET).download(objectKey(orgId, threadId, f.id));
    if (error || !data) return refuse("file_not_uploaded", `${f.file_name} did not finish uploading. Remove it and attach it again.`);
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.length !== f.byte_size || createHash("sha256").update(bytes).digest("hex") !== f.sha256) {
      return refuse("file_changed", `${f.file_name} arrived different from the file that was picked. Attach it again.`);
    }
    if (!bytesAreKind(bytes, f.mime)) {
      return refuse("file_not_its_kind", `${f.file_name} is not a ${CHAT_FILE_TYPES[f.mime].label} file inside, whatever its name says.`);
    }
  }
  return null;
}

/**
 * What a bell item says of a line: its words, or — for a line that is only files (D-CHAT29) — which files.
 * The words, when there are any, are still the whole preview; files are not listed beside them.
 */
export function filesForBell(body: string, files: readonly Pick<ChatFileRef, "file_name">[]): string {
  if (body.trim() || files.length === 0) return body;
  return files.length === 1 ? `Sent ${files[0]!.file_name}` : `Sent ${files.length} files`;
}

/** The line and its files, in one transaction (0539). `parentId` makes it a reply to that channel post. */
export async function chatSendFiles(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string,
  input: { message_id: string; parent_id: string | null; body: string; files: readonly ChatFileRef[] },
): Promise<ChatResult<ChatSendResponse>> {
  const res = await rpc<unknown[]>(admin, "chat_send_files", {
    p_org: orgId, p_actor: userId, p_thread: threadId, p_message_id: input.message_id, p_parent: input.parent_id,
    p_body: input.body, p_files: input.files.map((f) => ({ id: f.id, file_name: f.file_name, mime: f.mime, byte_size: f.byte_size, sha256: f.sha256 })),
  });
  if (!res.ok) return res;
  const row = (res.value ?? [])[0] as ChatSendResponse | undefined;
  if (!row) throw new Error("chat_send_files returned no row");
  return { ok: true, value: row };
}

/**
 * A short-lived link to one file, for somebody in its conversation. An image opens in the browser; every
 * other kind is offered as a download under its own name, so a document never renders on a page.
 */
export async function chatFileLink(
  admin: SupabaseClient, orgId: string, userId: string, fileId: string,
): Promise<ChatResult<ChatFileLink>> {
  const res = await rpc<Array<{ storage_path: string; file_name: string; mime: string; byte_size: number | string }>>(
    admin, "chat_file_for", { p_org: orgId, p_user: userId, p_file: fileId },
  );
  if (!res.ok) return res;
  const f = (res.value ?? [])[0];
  if (!f) throw new Error("chat_file_for returned no row");
  const inline = (CHAT_FILE_TYPES as Record<string, { inline: boolean }>)[f.mime]?.inline ?? false;
  const { data, error } = await admin.storage.from(CHAT_FILES_BUCKET)
    .createSignedUrl(f.storage_path, LINK_SECONDS, inline ? undefined : { download: f.file_name });
  if (error || !data) throw new Error(`chat-files link: ${error?.message ?? "no URL"}`);
  return { ok: true, value: { url: data.signedUrl, file_name: f.file_name, mime: f.mime, byte_size: Number(f.byte_size) } };
}

/** A conversation's files, newest first, one page; `before_at` + `before_id` page back. */
export async function chatFilesList(
  admin: SupabaseClient, orgId: string, userId: string, threadId: string,
  page: { before_at?: string | null; before_id?: string | null; limit?: number },
): Promise<ChatResult<ChatFilesResponse>> {
  const limit = Math.min(Math.max(page.limit ?? CHAT_PAGE_SIZE, 1), 100);
  const res = await rpc<unknown[]>(admin, "chat_files", {
    p_org: orgId, p_user: userId, p_thread: threadId, p_before_at: page.before_at ?? null, p_before_id: page.before_id ?? null, p_limit: limit,
  });
  if (!res.ok) return res;
  const files = (res.value ?? []).map((r) => chatFileListItemSchema.parse(r));
  const last = files[files.length - 1];
  return { ok: true, value: { files, next: files.length === limit && last ? { before_at: last.created_at, before_id: last.id } : null } };
}
