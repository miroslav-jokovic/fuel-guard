import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, effectScope, h, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { CHAT_FILE_MAX_BYTES, type ChatAttachment, type ChatFileRef, type ChatMessage } from "@silvicom/shared";

/**
 * Office chat files on the web (OFFICE-CHAT-PLAN CH7). What a person relies on:
 *  · a file chat does not take — a kind it refuses, an empty one, one over 25 MB, an eleventh — is refused
 *    in the composer with the reason, before a byte moves;
 *  · a taken file uploads at once (declared, then PUT to the signed URL), shows when it failed, and Retry
 *    uploads it again;
 *  · Send waits for every upload, and a line may be files alone;
 *  · the paperclip appears only where the stage named the conversation the files belong to;
 *  · a line's images and documents are drawn under its words — and not on a removed line;
 *  · a document's Download asks for its link then, and says so when it cannot;
 *  · a line sent with files sends their references, and says how many while it is on its way;
 *  · the Files list shows each file and who sent it.
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
const followDownload = vi.hoisted(() => vi.fn());
vi.mock("./useChatFileLink", async (importOriginal) => ({ ...(await importOriginal<object>()), followDownload }));

import { useChatAttachments, type PutBytes } from "./useChatAttachments";
import ChatComposer from "./ChatComposer.vue";
import ChatMessageRow from "./ChatMessageRow.vue";
import ChatPendingRow from "./ChatPendingRow.vue";
import ChatFilesDialog from "./ChatFilesDialog.vue";
import ChatAttachmentImage from "./ChatAttachmentImage.vue";
import FilePickButton from "@/components/ui/FilePickButton.vue";
import { useChatSend, type PendingLine } from "./useChat";
import { provideChatNames } from "./chatNames";

const ME = "11111111-1111-4111-8111-111111111111";
const ANA = "22222222-2222-4222-8222-222222222222";
const T1 = "33333333-3333-4333-8333-333333333333";
const FILE_ID = "44444444-4444-4444-8444-444444444444";
const MSG = "55555555-5555-4555-8555-555555555555";

const ok = <T>(data: T) => ({ ok: true, status: 200, data, error: null });
const refused = (message: string) => ({ ok: false, status: 400, data: null, error: { message } });
const file = (name: string, size = 3, type = "") => {
  const f = new File([new Uint8Array(Math.min(size, 16))], name, { type });
  if (size > 16) Object.defineProperty(f, "size", { value: size });
  return f;
};

afterEach(() => {
  apiFetch.mockReset();
  followDownload.mockReset();
  document.body.innerHTML = "";
});

function attachments(put: PutBytes = vi.fn(async () => {})) {
  const scope = effectScope();
  const a = scope.run(() => useChatAttachments(ref<string | null>(T1), put))!;
  return { a, put, stop: () => scope.stop() };
}

describe("useChatAttachments", () => {
  it("refuses a kind chat does not take, an empty file and one over 25 MB, each with its reason, and uploads nothing", () => {
    const { a } = attachments();
    a.add([file("run.exe")]);
    expect(a.refusal.value).toBe("run.exe is not a kind of file chat takes: photos, PDFs, Office documents, text and CSV.");
    a.add([file("blank.pdf", 0)]);
    expect(a.refusal.value).toBe("blank.pdf is empty.");
    a.add([file("big.pdf", CHAT_FILE_MAX_BYTES + 1)]);
    expect(a.refusal.value).toBe("big.pdf is 25 MB; the most a file can be is 25 MB.");
    expect(a.files.value).toHaveLength(0);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("takes ten files to a line and refuses the eleventh", async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const { a } = attachments();
    a.add(Array.from({ length: 11 }, (_, i) => file(`p${i}.pdf`)));
    expect(a.files.value).toHaveLength(10);
    expect(a.refusal.value).toBe("A message can carry 10 files at most.");
    // Let the ten hashes finish here, so their declarations are not counted in the next test.
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(10));
  });

  it("declares the file, PUTs its bytes to the signed URL, and is ready with the reference Send carries", async () => {
    apiFetch.mockResolvedValue(ok({ file_id: FILE_ID, upload_url: "https://store.test/put" }));
    const { a, put } = attachments();
    const pdf = file("rate con.pdf", 3);
    a.add([pdf]);
    expect(a.uploading.value).toBe(true);
    await flushPromises();
    await vi.waitFor(() => expect(a.uploading.value).toBe(false));

    const [path, init] = apiFetch.mock.calls[0]!;
    expect(path).toBe(`/api/chat/${T1}/files`);
    expect(init.method).toBe("POST");
    expect(init.body).toMatchObject({ file_name: "rate con.pdf", mime: "application/pdf", byte_size: 3 });
    expect(init.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(put).toHaveBeenCalledWith("https://store.test/put", pdf, "application/pdf");
    expect(a.ready.value).toEqual([{ id: FILE_ID, ...init.body }]);
  });

  it("marks a file whose upload failed, holds it out of Send, and Retry uploads it again", async () => {
    apiFetch.mockResolvedValue(ok({ file_id: FILE_ID, upload_url: "https://store.test/put" }));
    const put = vi.fn<PutBytes>().mockRejectedValueOnce(new Error("The file did not finish uploading.")).mockResolvedValue();
    const { a } = attachments(put);
    a.add([file("a.csv")]);
    await vi.waitFor(() => expect(a.failed.value).toBe(true));
    expect(a.files.value[0]!.error).toBe("The file did not finish uploading.");
    expect(a.ready.value).toEqual([]);

    a.retry(a.files.value[0]!.key);
    await vi.waitFor(() => expect(a.ready.value).toHaveLength(1));
    expect(put).toHaveBeenCalledTimes(2);
    expect(a.failed.value).toBe(false);
  });

  it("says the API's words when the upload is refused before it starts", async () => {
    apiFetch.mockResolvedValue(refused("You are not in this conversation."));
    const { a } = attachments();
    a.add([file("a.txt")]);
    await vi.waitFor(() => expect(a.failed.value).toBe(true));
    expect(a.files.value[0]!.error).toBe("You are not in this conversation.");
  });

  it("remove and clear empty the strip", async () => {
    apiFetch.mockResolvedValue(ok({ file_id: FILE_ID, upload_url: "u" }));
    const { a } = attachments();
    a.add([file("a.pdf"), file("b.pdf")]);
    a.remove(a.files.value[0]!.key);
    expect(a.files.value.map((f) => f.name)).toEqual(["b.pdf"]);
    a.add([file("c.exe")]);
    a.clear();
    expect(a.files.value).toEqual([]);
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2)); // its own uploads, not the next test's
    expect(a.refusal.value).toBeNull();
  });
});

/** Mounts what `setup` returns a render for, under a fresh query client; `setup` runs once, in setup. */
function withQuery(setup: () => () => ReturnType<typeof h>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(defineComponent({ setup }), { global: { plugins: [[VueQueryPlugin, { queryClient: qc }]] }, attachTo: document.body });
}

describe("ChatComposer with files", () => {
  it("shows the paperclip only where the stage named the conversation the files belong to", () => {
    expect(withQuery(() => () => h(ChatComposer, { threadKey: "t" })).findComponent(FilePickButton).exists()).toBe(false);
    expect(withQuery(() => () => h(ChatComposer, { threadKey: "t", uploadTo: T1 })).findComponent(FilePickButton).exists()).toBe(true);
  });

  it("holds Send while a file uploads, then sends a line of files alone as an empty body and its references", async () => {
    let finish!: (v: unknown) => void;
    apiFetch.mockReturnValue(new Promise((r) => { finish = r; }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const w = withQuery(() => () => h(ChatComposer, { threadKey: "t", uploadTo: T1 }));
    const send = () => w.find('button[type="submit"]');

    w.findComponent(FilePickButton).vm.$emit("files", [file("bol.pdf")]);
    await flushPromises();
    expect(w.text()).toContain("Uploading…");
    expect(send().attributes("disabled")).toBeDefined();
    await w.find("form").trigger("submit");
    expect(w.findComponent(ChatComposer).emitted("send")).toBeUndefined();

    finish(ok({ file_id: FILE_ID, upload_url: "https://store.test/put" }));
    await vi.waitFor(() => expect(w.text()).toContain("PDF · 3 B"));
    expect(send().attributes("disabled")).toBeUndefined();
    await w.find("form").trigger("submit");
    const [[body, refs]] = w.findComponent(ChatComposer).emitted("send") as [[string, ChatFileRef[]]];
    expect(body).toBe("");
    expect(refs.map((r) => [r.id, r.file_name])).toEqual([[FILE_ID, "bol.pdf"]]);
    await nextTick();
    expect(w.text()).not.toContain("bol.pdf");
    fetchMock.mockRestore();
  });
});

describe("ChatComposer with words and a file still uploading", () => {
  it("holds Send even though the words alone could go", async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    const w = withQuery(() => () => h(ChatComposer, { threadKey: "t", uploadTo: T1 }));
    await w.find("textarea").setValue("BOL attached");
    expect(w.find('button[type="submit"]').attributes("disabled")).toBeUndefined();
    w.findComponent(FilePickButton).vm.$emit("files", [file("bol.pdf")]);
    await flushPromises();
    expect(w.find('button[type="submit"]').attributes("disabled")).toBeDefined();
    await w.find("textarea").trigger("keydown", { key: "Enter" });
    expect(w.findComponent(ChatComposer).emitted("send")).toBeUndefined();
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1)); // its own upload, not the next test's
  });
});

const PDF: ChatAttachment = { id: FILE_ID, file_name: "BOL 20481.pdf", mime: "application/pdf", byte_size: 2_516_582 };
const IMG: ChatAttachment = { id: "66666666-6666-4666-8666-666666666666", file_name: "dent.jpg", mime: "image/jpeg", byte_size: 9000 };

function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: MSG, thread_id: T1, seq: 1, sender_user_id: ANA, sender_name: "Ana Ruiz", body: "Here is the BOL",
    created_at: "2026-11-01T15:00:00Z", edited_at: null, deleted_at: null, parent_id: null, reply_count: 0, last_reply_at: null,
    reactions: [], pinned_at: null, saved: false, attachments: [IMG, PDF], ...over,
  } as ChatMessage;
}
function row(m: ChatMessage) {
  return withQuery(() => {
    provideChatNames(ref([]));
    return () => h(ChatMessageRow, { message: m, viewerId: ME, first: true });
  });
}

describe("a line's files", () => {
  it("draws the images as thumbnails and the documents as cards, under the words", async () => {
    apiFetch.mockResolvedValue(ok({ url: "https://store.test/dent.jpg", file_name: "dent.jpg", mime: "image/jpeg", byte_size: 9000 }));
    const w = row(message());
    expect(w.findAllComponents(ChatAttachmentImage)).toHaveLength(1);
    const card = w.find("[data-chat-file]");
    expect(card.text()).toContain("BOL 20481.pdf");
    expect(card.text()).toContain("PDF · 2.4 MB");
    await vi.waitFor(() => expect(w.find('img[alt="dent.jpg"]').attributes("src")).toBe("https://store.test/dent.jpg"));
    // The thumbnail asked for its own link; the document asked for none.
    expect(apiFetch.mock.calls.map((c) => c[0])).toEqual([`/api/chat/files/${IMG.id}`]);
  });

  it("a line of files alone draws no empty words paragraph, and its small print reads on its own after the files", () => {
    const w = withQuery(() => {
      provideChatNames(ref([]));
      return () => h(ChatMessageRow, { message: message({ body: "", attachments: [PDF] }), viewerId: ME, first: true },
        { stamp: ({ alone }: { alone: boolean }) => h("span", { "data-stamp": "" }, alone ? "Seen" : "· Seen") });
    });
    expect(w.find("p.whitespace-pre-wrap").exists()).toBe(false);
    const stamp = w.find("[data-stamp]");
    expect(stamp.text()).toBe("Seen");
    // After the card, not before it.
    expect(w.find("[data-chat-attachments]").element.compareDocumentPosition(stamp.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws no files on a removed line", () => {
    const w = row(message({ deleted_at: "2026-11-01T15:05:00Z", body: null }));
    expect(w.text()).toContain("Message removed");
    expect(w.find("[data-chat-attachments]").exists()).toBe(false);
  });

  it("a document's Download asks for its link then and follows it", async () => {
    apiFetch.mockResolvedValue(ok({ url: "https://store.test/bol.pdf?download", file_name: PDF.file_name, mime: PDF.mime, byte_size: PDF.byte_size }));
    const w = row(message({ attachments: [PDF] }));
    expect(apiFetch).not.toHaveBeenCalled();
    await w.find(`button[aria-label="Download ${PDF.file_name}"]`).trigger("click");
    await flushPromises();
    expect(apiFetch).toHaveBeenCalledWith(`/api/chat/files/${PDF.id}`);
    expect(followDownload).toHaveBeenCalledWith("https://store.test/bol.pdf?download");
  });

  it("says so on the card when the link cannot be had", async () => {
    apiFetch.mockResolvedValue(refused("No such file."));
    const w = row(message({ attachments: [PDF] }));
    await w.find(`button[aria-label="Download ${PDF.file_name}"]`).trigger("click");
    await flushPromises();
    expect(followDownload).not.toHaveBeenCalled();
    expect(w.find('[role="alert"]').text()).toBe("Could not get the download link. Try again.");
  });
});

describe("sending a line with files", () => {
  const pendingLine = (files: number): PendingLine => ({
    message_id: MSG, thread_id: T1, parent_id: null, body: "", state: "pending", error: null,
    files: Array.from({ length: files }, (_, i) => ({ id: FILE_ID, file_name: `f${i}.pdf`, mime: "application/pdf", byte_size: 1, sha256: "a".repeat(64) })),
  });

  it("says how many files a pending line carries", () => {
    const say = (n: number) => mount(ChatPendingRow, { props: { line: pendingLine(n), first: true, viewerName: "Me", viewerId: ME } }).text();
    expect(say(0)).toContain("Sending…");
    expect(say(1)).toContain("Sending 1 file…");
    expect(say(3)).toContain("Sending 3 files…");
  });

  it("sends the files' references with the line, and no files key when there are none", async () => {
    apiFetch.mockResolvedValue(ok({ message_id: MSG, seq: 1 }));
    const pending = ref<PendingLine[]>([]);
    let send!: ReturnType<typeof useChatSend>;
    withQuery(() => { send = useChatSend(pending); return () => h("div"); });
    const refs = pendingLine(2).files;
    await send.mutateAsync({ threadId: T1, body: "", files: refs });
    expect(apiFetch.mock.calls[0]![1].body).toEqual({ message_id: expect.any(String), body: "", files: refs });
    await send.mutateAsync({ threadId: T1, body: "hi" });
    expect(apiFetch.mock.calls.at(-1)![1].body).not.toHaveProperty("files");
  });
});

describe("the Files list", () => {
  it("lists each file with who sent it", async () => {
    apiFetch.mockImplementation(async (path: string) => path.endsWith("/files")
      ? ok({ files: [
        { ...PDF, message_id: MSG, parent_id: null, seq: 2, uploaded_by: ANA, uploaded_by_name: "Ana Ruiz", created_at: "2026-11-01T15:00:00Z" },
        { ...PDF, id: IMG.id, file_name: "notes.txt", mime: "text/plain", message_id: MSG, parent_id: null, seq: 1, uploaded_by: ME, uploaded_by_name: "Me", created_at: "2026-11-01T14:00:00Z" },
      ], next: null })
      : refused("unexpected"));
    withQuery(() => () => h(ChatFilesDialog, { threadId: T1, open: true, viewerId: ME }));
    await vi.waitFor(() => expect(document.body.textContent).toContain("notes.txt"));
    expect(apiFetch.mock.calls[0]![0]).toBe(`/api/chat/${T1}/files`);
    const text = document.body.textContent ?? "";
    expect(text).toContain("BOL 20481.pdf");
    expect(text).toContain("Sent by Ana Ruiz");
    expect(text).toContain("Sent by you");
  });
});
