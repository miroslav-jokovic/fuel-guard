import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { ChatConversationResponse, ChatMessage } from "@silvicom/shared";
import ChatConversationPane from "./ChatConversationPane.vue";
import { mergeLines, type PendingLine } from "./useChat";
import { chatRowTime } from "./chatTime";

/**
 * The open conversation (CH2). What it must get right is what a person relies on without thinking:
 * their own lines on the right, a send that failed keeping its words with Retry, "Seen" only when the
 * other person has actually read that far, Enter sending and Shift+Enter not, and a removed line
 * keeping its place rather than vanishing.
 */
const ME = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const T = "33333333-3333-4333-8333-333333333333";

const msg = (seq: number, sender: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, thread_id: T, seq, rev: seq,
  sender_user_id: sender, sender_name: sender === ME ? "Ana" : "Ben Admin", body: `line ${seq}`,
  created_at: "2026-10-23T15:00:00Z", edited_at: null, deleted_at: null, parent_id: null, reply_count: 0, last_reply_at: null, ...over,
});
const data = (messages: ChatMessage[], benReadSeq = 0, kind: "direct" | "group" = "direct"): ChatConversationResponse => ({
  conversation: {
    thread_id: T, kind, subject: kind === "group" ? "Night dispatch" : null, load_id: null,
    created_at: "2026-10-23T14:00:00Z", last_message_at: "2026-10-23T15:00:00Z",
    last_seq: messages.length, rev: messages.length, read_seq: messages.length, unread: 0, muted: "none",
    member_role: "member", member_count: 2, title_members: [{ user_id: BEN, name: "Ben Admin" }], last_message: null,
  },
  members: [
    { user_id: ME, name: "Ana", member_role: "member", read_seq: messages.length, last_read_at: null, joined_at: "2026-10-23T14:00:00Z" },
    { user_id: BEN, name: "Ben Admin", member_role: "member", read_seq: benReadSeq, last_read_at: null, joined_at: "2026-10-23T14:00:00Z" },
  ],
  messages,
  before_seq: null,
});
const render = (d: ChatConversationResponse, pending: PendingLine[] = []) =>
  mount(ChatConversationPane, { props: { data: d, viewerId: ME, pending, sending: false } });

describe("ChatConversationPane", () => {
  it("titles a direct conversation by the other person", () => {
    expect(render(data([])).find("h2").text()).toBe("Ben Admin");
  });

  it("puts your own lines on the right and the other person's on the left", () => {
    const w = render(data([msg(1, BEN), msg(2, ME)]));
    const bubbles = w.findAll(".rounded-surface");
    expect(bubbles[0]!.classes()).not.toContain("ml-auto");
    expect(bubbles[1]!.classes()).toContain("ml-auto");
  });

  it("says Seen under your newest line only once the other person has read that far", () => {
    expect(render(data([msg(1, BEN), msg(2, ME)], 1)).text()).not.toContain("Seen");
    expect(render(data([msg(1, BEN), msg(2, ME)], 2)).text()).toContain("Seen");
  });

  it("keeps a removed line in its place, as removed", () => {
    const w = render(data([msg(1, BEN, { body: null, deleted_at: "2026-10-23T15:05:00Z" })]));
    expect(w.text()).toContain("Message removed");
  });

  it("marks an edited line as edited", () => {
    expect(render(data([msg(1, BEN, { edited_at: "2026-10-23T15:02:00Z" })])).text()).toContain("edited");
  });

  it("shows a pending send as Sending…, and a failed one with its words and Retry", async () => {
    const pending: PendingLine[] = [
      { message_id: "p1", thread_id: T, body: "on my way", state: "pending", error: null },
      { message_id: "p2", thread_id: T, body: "gate code 4411", state: "failed", error: "Network down" },
    ];
    const w = render(data([]), pending);
    expect(w.text()).toContain("Sending…");
    expect(w.text()).toContain("gate code 4411");
    const retry = w.findAll("button").find((b) => b.text() === "Retry")!;
    await retry.trigger("click");
    expect(w.emitted("retry")?.[0]?.[0]).toMatchObject({ message_id: "p2" });
  });

  it("sends on Enter and not on Shift+Enter, trimmed, and clears the box", async () => {
    const w = render(data([]));
    const box = w.find("textarea");
    await box.setValue("  hello  ");
    await box.trigger("keydown", { key: "Enter", shiftKey: true });
    expect(w.emitted("send")).toBeUndefined();
    await box.trigger("keydown", { key: "Enter" });
    expect(w.emitted("send")).toEqual([["hello"]]);
    expect((box.element as HTMLTextAreaElement).value).toBe("");
  });

  it("will not send an empty or over-long message", async () => {
    const w = render(data([]));
    const box = w.find("textarea");
    await box.setValue("   ");
    await box.trigger("keydown", { key: "Enter" });
    await box.setValue("x".repeat(4001));
    await box.trigger("keydown", { key: "Enter" });
    expect(w.emitted("send")).toBeUndefined();
    expect(w.text()).toContain("1 characters too long");
  });

  it("offers Edit and Remove on your own lines only", () => {
    const w = render(data([msg(1, BEN), msg(2, ME)]));
    expect(w.findAll("button").filter((b) => b.text() === "Edit")).toHaveLength(1);
    expect(w.findAll("button").filter((b) => b.text() === "Remove")).toHaveLength(1);
  });

  it("offers Back to the list (a phone shows one or the other)", async () => {
    const w = render(data([]));
    await w.findAll("button").find((b) => b.text() === "Back")!.trigger("click");
    expect(w.emitted("back")).toHaveLength(1);
  });

  it("names the sender in a group but not in a direct conversation", () => {
    expect(render(data([msg(1, BEN)], 0, "group")).text()).toContain("Ben Admin");
    const direct = render(data([msg(1, BEN)]));
    expect(direct.findAll(".font-semibold.opacity-80")).toHaveLength(0);
  });
});

describe("mergeLines", () => {
  it("drops a pending line once the server lists its id — the server's copy wins", () => {
    const server = [msg(1, ME, { id: "p1" as unknown as string })];
    const pending: PendingLine[] = [{ message_id: "p1", thread_id: T, body: "x", state: "pending", error: null }];
    expect(mergeLines(server, pending, T).map((l) => l.kind)).toEqual(["server"]);
  });

  it("keeps another conversation's pending lines out of this one", () => {
    const pending: PendingLine[] = [{ message_id: "p9", thread_id: "elsewhere", body: "x", state: "pending", error: null }];
    expect(mergeLines([], pending, T)).toEqual([]);
  });
});

describe("chatRowTime", () => {
  const now = new Date("2026-10-23T18:00:00");
  it("is the clock for today", () => {
    expect(chatRowTime(new Date("2026-10-23T09:05:00").toISOString(), now)).toBe("9:05 AM");
  });
  it("is MM/DD before today", () => {
    expect(chatRowTime(new Date("2026-10-20T09:05:00").toISOString(), now)).toBe("10/20");
  });
});
