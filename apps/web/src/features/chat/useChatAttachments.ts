import { computed, onScopeDispose, ref, type Ref } from "vue";
import {
  CHAT_FILE_MAX_BYTES,
  CHAT_FILE_TYPES,
  CHAT_FILES_PER_LINE,
  chatFileMimeOf,
  chatFileSize,
  type ChatFileMime,
  type ChatFileRef,
  type ChatFileUploadResponse,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { sha256Hex } from "@/composables/useCompliance";

/**
 * The files waiting in a composer (OFFICE-CHAT-PLAN CH7). Picking, dropping or pasting a file starts its
 * upload at once — hash it, ask for a URL, PUT the bytes — so by the time the person has typed a word it
 * is usually there, and Send carries only references (`ChatFileRef`). The API reads each file back and
 * checks it against the hash computed here before the line is written (D-CHAT28).
 *
 * What a person relies on:
 *  · a file we do not take, or one over 25 MB, or an eleventh, is refused here with the reason, before a
 *    byte moves (the API refuses them too; this only spares the wait);
 *  · each file shows its own state — uploading, ready, failed with Retry — and can be removed;
 *  · Send is held while any file is still uploading, and a failed one must be retried or removed;
 *  · an image previews from the person's own copy (an object URL), freed when it leaves the composer.
 */
export interface PendingFile {
  key: string;
  file: File;
  name: string;
  mime: ChatFileMime;
  size: number;
  state: "uploading" | "ready" | "failed";
  error: string | null;
  /** A local preview for an image; null for every other kind. */
  preview: string | null;
  ref: ChatFileRef | null;
}

export interface PutBytes { (url: string, file: File, mime: string): Promise<void> }
const putBytes: PutBytes = async (url, file, mime) => {
  const res = await fetch(url, { method: "PUT", headers: { "content-type": mime }, body: file });
  if (!res.ok) throw new Error("The file did not finish uploading.");
};

export function useChatAttachments(threadId: Ref<string | null>, put: PutBytes = putBytes) {
  const files = ref<PendingFile[]>([]);
  const refusal = ref<string | null>(null);
  let n = 0;

  const set = (key: string, patch: Partial<PendingFile>) => {
    files.value = files.value.map((f) => (f.key === key ? { ...f, ...patch } : f));
  };

  async function upload(p: PendingFile) {
    set(p.key, { state: "uploading", error: null });
    try {
      if (!threadId.value) throw new Error("Open a conversation first.");
      const sha256 = await sha256Hex(await p.file.arrayBuffer());
      const declared = { file_name: p.name, mime: p.mime, byte_size: p.size, sha256 };
      const res = await apiFetch<ChatFileUploadResponse>(`/api/chat/${threadId.value}/files`, { method: "POST", body: declared });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "The file could not be started.");
      await put(res.data.upload_url, p.file, p.mime);
      set(p.key, { state: "ready", ref: { id: res.data.file_id, ...declared } });
    } catch (e) {
      set(p.key, { state: "failed", error: e instanceof Error ? e.message : "The file did not finish uploading." });
    }
  }

  /** Take what was picked, dropped or pasted; refuse what we cannot send, with the first reason. */
  function add(picked: readonly File[]) {
    refusal.value = null;
    const room = CHAT_FILES_PER_LINE - files.value.length;
    const taken: PendingFile[] = [];
    for (const file of picked) {
      const mime = chatFileMimeOf(file.name);
      if (!mime) { refusal.value ??= `${file.name} is not a kind of file chat takes: photos, PDFs, Office documents, text and CSV.`; continue; }
      if (file.size === 0) { refusal.value ??= `${file.name} is empty.`; continue; }
      if (file.size > CHAT_FILE_MAX_BYTES) { refusal.value ??= `${file.name} is ${chatFileSize(file.size)}; the most a file can be is ${chatFileSize(CHAT_FILE_MAX_BYTES)}.`; continue; }
      if (taken.length >= room) { refusal.value ??= `A message can carry ${CHAT_FILES_PER_LINE} files at most.`; break; }
      taken.push({
        key: `f${++n}`, file, name: file.name, mime, size: file.size, state: "uploading", error: null, ref: null,
        preview: CHAT_FILE_TYPES[mime].inline && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null,
      });
    }
    files.value = [...files.value, ...taken];
    for (const p of taken) void upload(p);
  }

  const free = (p: PendingFile) => { if (p.preview) URL.revokeObjectURL(p.preview); };
  function remove(key: string) {
    const p = files.value.find((f) => f.key === key);
    if (p) free(p);
    files.value = files.value.filter((f) => f.key !== key);
  }
  function retry(key: string) {
    const p = files.value.find((f) => f.key === key);
    if (p) void upload(p);
  }
  /** After a send: the composer starts empty again. */
  function clear() {
    files.value.forEach(free);
    files.value = [];
    refusal.value = null;
  }
  onScopeDispose(() => files.value.forEach(free));

  const uploading = computed(() => files.value.some((f) => f.state === "uploading"));
  const failed = computed(() => files.value.some((f) => f.state === "failed"));
  const ready = computed(() => files.value.flatMap((f) => (f.ref ? [f.ref] : [])));
  return { files, refusal, add, remove, retry, clear, uploading, failed, ready };
}
