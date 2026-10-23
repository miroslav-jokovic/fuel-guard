import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/vue-query";
import type { ChatConversationResponse, ChatMessage, ChatSyncResponse } from "@silvicom/shared";

const api = vi.hoisted(() => ({ answers: [] as unknown[], asked: [] as string[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    api.asked.push(path);
    const next = api.answers.shift();
    return next === "fail" ? { ok: false, error: { message: "down" } } : { ok: true, data: next };
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {}, DEV_BYPASS: false }));

import { applySync, syncConversation } from "./chatRealtime";
import { conversationKey } from "./useChat";

/**
 * What a signal does to the cached conversation (CH3b): new lines and edits are merged from one
 * `/sync`, a merge that would leave a hole is refused for a refetch (D-CHAT5), and nothing moves the
 * page backwards.
 */
const T = "22222222-2222-4222-8222-222222222222";
const ME = "11111111-1111-4111-8111-111111111111";
const YOU = "33333333-3333-4333-8333-333333333333";

function msg(seq: number, rev = seq, patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    thread_id: T, seq, rev, sender_user_id: YOU, sender_name: "Ana", body: `line ${seq}`,
    created_at: `2026-10-23T12:00:${String(seq).padStart(2, "0")}Z`, edited_at: null, deleted_at: null,
    ...patch,
  };
}

function page(messages: ChatMessage[], extra: Partial<ChatConversationResponse["conversation"]> = {}): ChatConversationResponse {
  const last = messages.at(-1);
  return {
    conversation: {
      thread_id: T, kind: "direct", subject: null, load_id: null, created_at: "2026-10-23T12:00:00Z",
      last_message_at: last?.created_at ?? "2026-10-23T12:00:00Z", last_seq: last?.seq ?? 0,
      rev: Math.max(0, ...messages.map((m) => m.rev)), read_seq: last?.seq ?? 0, unread: 0, muted: "none",
      member_role: "member", member_count: 2, title_members: [], last_message: null,
      ...extra,
    },
    members: [],
    messages,
    before_seq: messages[0] && messages[0].seq > 1 ? messages[0].seq : null,
  };
}

const sync = (changes: ChatMessage[], rev: number, more = false): ChatSyncResponse => ({ changes, rev, more });

describe("applySync", () => {
  it("appends new lines in order and counts them unread by the database's rule", () => {
    const next = applySync(page([msg(1), msg(2)]), sync([msg(3), msg(4)], 4))!;
    expect(next.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(next.conversation).toMatchObject({ last_seq: 4, rev: 4, unread: 2 });
    expect(next.conversation.last_message).toMatchObject({ seq: 4, body: "line 4", deleted: false });
  });

  it("replaces an edited or retracted line in place", () => {
    const next = applySync(page([msg(1), msg(2)]), sync([msg(2, 3, { body: null, deleted_at: "2026-10-23T12:01:00Z" })], 3))!;
    expect(next.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(next.messages[1]).toMatchObject({ body: null, rev: 3 });
    expect(next.conversation).toMatchObject({ rev: 3, last_seq: 2, unread: 0 });
    expect(next.conversation.last_message).toMatchObject({ deleted: true });
  });

  it("refuses a merge that would leave a hole, so the caller refetches", () => {
    expect(applySync(page([msg(1), msg(2)]), sync([msg(4)], 4))).toBeNull();
    // An empty conversation holds from seq 1.
    expect(applySync(page([]), sync([msg(2)], 2))).toBeNull();
    expect(applySync(page([]), sync([msg(1)], 1))!.messages).toHaveLength(1);
  });

  it("leaves an edit above the page to the history, without calling it a hole", () => {
    const next = applySync(page([msg(10), msg(11)]), sync([msg(3, 12, { body: "edited" })], 12))!;
    expect(next.messages.map((m) => m.seq)).toEqual([10, 11]);
    expect(next.conversation.rev).toBe(12);
  });

  it("never moves the page backwards when an older answer lands after a newer fetch", () => {
    const fresh = page([msg(1), msg(2, 5, { body: "second edit" })]);
    const next = applySync(fresh, sync([msg(2, 4, { body: "first edit" })], 4))!;
    expect(next.messages[1]!.body).toBe("second edit");
    expect(next.conversation.rev).toBe(5);
  });
});

describe("syncConversation", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient();
    api.answers = [];
    api.asked = [];
  });

  it("asks for what changed since the rev it holds, and merges it", async () => {
    qc.setQueryData(conversationKey(T), page([msg(1), msg(2)]));
    api.answers = [sync([msg(3)], 3)];
    await syncConversation(qc, T, 3);
    expect(api.asked).toEqual([`/api/chat/${T}/sync?since_rev=2`]);
    expect(qc.getQueryData<ChatConversationResponse>(conversationKey(T))!.messages).toHaveLength(3);
  });

  it("follows `more` from the rev each page returns", async () => {
    qc.setQueryData(conversationKey(T), page([msg(1)]));
    api.answers = [sync([msg(2)], 2, true), sync([msg(3)], 3)];
    await syncConversation(qc, T);
    expect(api.asked).toEqual([`/api/chat/${T}/sync?since_rev=1`, `/api/chat/${T}/sync?since_rev=2`]);
  });

  it("asks nothing for a signal it already holds, or a conversation it does not hold", async () => {
    qc.setQueryData(conversationKey(T), page([msg(1), msg(2)]));
    await syncConversation(qc, T, 2);
    await syncConversation(qc, YOU, 9);
    expect(api.asked).toEqual([]);
  });

  it("refetches the page on a hole or a failed sync", async () => {
    qc.setQueryData(conversationKey(T), page([msg(1)]));
    const refetch = vi.spyOn(qc, "invalidateQueries");
    api.answers = [sync([msg(3)], 3)];
    await syncConversation(qc, T);
    api.answers = ["fail"];
    await syncConversation(qc, T);
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(refetch).toHaveBeenCalledWith({ queryKey: conversationKey(T) });
  });

  it("runs one sync per conversation, and one more round for a signal heard during it", async () => {
    qc.setQueryData(conversationKey(T), page([msg(1)]));
    api.answers = [sync([msg(2)], 2), sync([msg(3)], 3)];
    const first = syncConversation(qc, T, 2);
    const second = syncConversation(qc, T, 3);
    await Promise.all([first, second]);
    expect(api.asked).toEqual([`/api/chat/${T}/sync?since_rev=1`, `/api/chat/${T}/sync?since_rev=2`]);
    expect(qc.getQueryData<ChatConversationResponse>(conversationKey(T))!.conversation.last_seq).toBe(3);
  });

  it("counts my own new line as the database does, so the page reads it as any other", async () => {
    qc.setQueryData(conversationKey(T), page([msg(1)]));
    api.answers = [sync([msg(2, 2, { sender_user_id: ME })], 2)];
    await syncConversation(qc, T, 2);
    expect(qc.getQueryData<ChatConversationResponse>(conversationKey(T))!.conversation.unread).toBe(1);
  });
});
