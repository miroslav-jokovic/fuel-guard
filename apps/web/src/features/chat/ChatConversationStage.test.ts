import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { ChatConversationResponse, ChatMessage } from "@silvicom/shared";
import { AppAvatar } from "@silvicom/ui";

const link = vi.hoisted(() => ({ set: (_: string) => {} }));
vi.mock("./transport", async () => {
  const { ref } = await import("vue");
  const state = ref("off");
  link.set = (v) => (state.value = v);
  return { chatLinkState: state };
});

import ChatConversationStage from "./ChatConversationStage.vue";
import { mergeLines, type PendingLine } from "./useChat";

/**
 * The open conversation (CH2; CHAT-REDESIGN-PLAN D-CHATUI4–8). What a person relies on without
 * thinking: every line is a row with its sender on the first line of a run, a send that failed keeps
 * its words with Retry, "Seen" only when the other person has actually read that far, "New" above the
 * first line they had not read, Enter sending and Shift+Enter not, and a removed line keeping its place.
 */
const ME = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const T = "33333333-3333-4333-8333-333333333333";
const NOW = Date.now();
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const msg = (seq: number, sender: string, over: Partial<ChatMessage> = {}, minutesAgo = 10 - seq): ChatMessage => ({
  id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, thread_id: T, seq, rev: seq,
  sender_user_id: sender, sender_name: sender === ME ? "Ana" : "Ben Admin", body: `line ${seq}`,
  created_at: at(minutesAgo), edited_at: null, deleted_at: null, parent_id: null, reply_count: 0, last_reply_at: null, reactions: [], pinned_at: null, saved: false, attachments: [], ...over,
});
const data = (messages: ChatMessage[], benReadSeq = 0, kind: "direct" | "group" = "direct"): ChatConversationResponse => ({
  conversation: {
    thread_id: T, kind, subject: kind === "group" ? "Night dispatch" : null, load_id: null,
    created_at: at(600), last_message_at: at(1),
    last_seq: messages.length, rev: messages.length, read_seq: messages.length, unread: 0, muted: "none",
    member_role: "member", member_count: 2, title_members: [{ user_id: BEN, name: "Ben Admin" }], last_message: null,
  },
  members: [
    { user_id: ME, name: "Ana", member_role: "member", read_seq: messages.length, last_read_at: null, joined_at: at(600) },
    { user_id: BEN, name: "Ben Admin", member_role: "member", read_seq: benReadSeq, last_read_at: null, joined_at: at(600) },
  ],
  messages,
  before_seq: null,
});
const render = (d: ChatConversationResponse, pending: PendingLine[] = [], extra: { earlierFailed?: boolean; firstUnreadSeq?: number | null } = {}) =>
  mount(ChatConversationStage, { props: { data: d, viewerId: ME, pending, sending: false, ...extra } });
const buttons = (w: ReturnType<typeof render>, label: string) => w.findAll(`button[aria-label="${label}"]`);

describe("ChatConversationStage", () => {
  it("titles a direct conversation by the other person, and a group by its members", () => {
    expect(render(data([])).find("h2").text()).toBe("Ben Admin");
    expect(render(data([], 0, "group")).text()).toContain("Ben Admin");
  });

  it("names the sender on the first line of a run only, yours and theirs alike, on the same side", () => {
    const w = render(data([msg(1, BEN, {}, 4), msg(2, BEN, {}, 3), msg(3, ME, {}, 2)]));
    // The header's avatar, Ben's run, Ana's run.
    expect(w.findAllComponents(AppAvatar)).toHaveLength(3);
    expect(w.findAll(".ml-auto.max-w-\\[75\\%\\]")).toHaveLength(0);
    expect(w.text()).toContain("Ana");
  });

  it("puts every line under its day, with Today for the ones from today", () => {
    const w = render(data([msg(1, BEN)]));
    expect(w.find('[role="separator"][aria-label="Today"]').exists()).toBe(true);
  });

  it("draws the New line above the first line you had not read, and nowhere without one", () => {
    const w = render(data([msg(1, BEN), msg(2, BEN, {}, 1)]), [], { firstUnreadSeq: 2 });
    const separator = w.find('[role="separator"][aria-label="New messages"]');
    expect(separator.exists()).toBe(true);
    expect(separator.element.nextElementSibling?.textContent).toContain("line 2");
    expect(render(data([msg(1, BEN)])).find('[aria-label="New messages"]').exists()).toBe(false);
  });

  it("says Seen after your newest line only once the other person has read that far", () => {
    expect(render(data([msg(1, BEN), msg(2, ME)], 1)).text()).not.toContain("Seen");
    expect(render(data([msg(1, BEN), msg(2, ME)], 2)).text()).toContain("Seen");
  });

  it("offers the page above only while there is one, and says why it failed (CH6a)", async () => {
    expect(render(data([msg(1, BEN)])).text()).not.toContain("Show earlier messages");
    const w = render({ ...data([msg(51, BEN)]), before_seq: 51 }, [], { earlierFailed: true });
    const button = w.findAll("button").find((b) => b.text() === "Show earlier messages")!;
    await button.trigger("click");
    expect(w.emitted("earlier")).toHaveLength(1);
    expect(w.find('[role="alert"]').text()).toBe("Could not load the earlier messages. Try again.");
  });

  it("keeps a removed line in its place, as removed, and marks an edited one", () => {
    expect(render(data([msg(1, BEN, { body: null, deleted_at: at(1) })])).text()).toContain("Message removed");
    expect(render(data([msg(1, BEN, { edited_at: at(1) })])).text()).toContain("(edited)");
  });

  it("shows a pending send as Sending…, and a failed one with its words and Retry", async () => {
    const pending: PendingLine[] = [
      { message_id: "p1", thread_id: T, parent_id: null, body: "on my way", files: [], state: "pending", error: null },
      { message_id: "p2", thread_id: T, parent_id: null, body: "gate code 4411", files: [], state: "failed", error: "Network down" },
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

  it("will not send an empty or over-long message, and counts only near the limit", async () => {
    const w = render(data([]));
    const box = w.find("textarea");
    await box.setValue("   ");
    await box.trigger("keydown", { key: "Enter" });
    expect(w.text()).not.toContain("left");
    await box.setValue("x".repeat(4001));
    await box.trigger("keydown", { key: "Enter" });
    expect(w.emitted("send")).toBeUndefined();
    expect(w.text()).toContain("1 characters too long");
  });

  it("offers Edit and Remove on your own lines only, as buttons a keyboard can reach", () => {
    const w = render(data([msg(1, BEN), msg(2, ME)]));
    expect(buttons(w, "Edit")).toHaveLength(1);
    expect(buttons(w, "Remove")).toHaveLength(1);
    expect(buttons(w, "Edit")[0]!.classes()).not.toContain("hidden");
  });

  it("offers the way back to the rail (a phone shows one or the other)", async () => {
    const w = render(data([]));
    await buttons(w, "Back to conversations")[0]!.trigger("click");
    expect(w.emitted("back")).toHaveLength(1);
  });

  it("says Reconnecting at the top of the log only once the live link has dropped", async () => {
    link.set("reconnecting");
    expect(render(data([])).text()).toContain("Reconnecting");
    link.set("connecting");
    expect(render(data([])).text()).not.toContain("Reconnecting");
    link.set("off");
  });

  it("reads the log as a polite live region named for the conversation", () => {
    const log = render(data([])).find('[role="log"]');
    expect(log.attributes("aria-live")).toBe("polite");
    expect(log.attributes("aria-label")).toBe("Ben Admin");
  });
});

describe("the keyboard in the log (CR2, D-CHATUI16, D-CHATUI17)", () => {
  const attached = (d: ChatConversationResponse) => mount(ChatConversationStage, { props: { data: d, viewerId: ME, pending: [], sending: false }, attachTo: document.body });

  it("Up from an empty box lands on the newest line; Up and Down walk the lines and stop at the top; Down past the newest returns to the box", async () => {
    const w = attached(data([msg(1, BEN), msg(2, ME)]));
    const box = w.find("textarea");
    (box.element as HTMLTextAreaElement).focus();
    await box.trigger("keydown", { key: "ArrowUp" });
    const rows = w.findAll("[data-chat-row]");
    expect(document.activeElement).toBe(rows[1]!.element);
    await rows[1]!.trigger("keydown", { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[0]!.element);
    await rows[0]!.trigger("keydown", { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[0]!.element);
    await rows[0]!.trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]!.element);
    await rows[1]!.trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(box.element);
    // With words in the box, Up is the caret's.
    await box.setValue("hi");
    await box.trigger("keydown", { key: "ArrowUp" });
    expect(document.activeElement).toBe(box.element);
    w.unmount();
  });

  it("E on your own line opens it for editing with the caret in the field, not on somebody else's, and Esc hands focus back to the line", async () => {
    const w = attached(data([msg(1, BEN), msg(2, ME)]));
    const rows = w.findAll("[data-chat-row]");
    await rows[0]!.trigger("keydown", { key: "e" });
    expect(w.find('textarea[aria-label="Edit message"]').exists()).toBe(false);
    await rows[1]!.trigger("keydown", { key: "e" });
    await flushPromises();
    const field = w.find('textarea[aria-label="Edit message"]');
    expect(document.activeElement).toBe(field.element);
    await field.trigger("keydown", { key: "Escape" });
    expect(w.find('textarea[aria-label="Edit message"]').exists()).toBe(false);
    expect(document.activeElement).toBe(rows[1]!.element);
    w.unmount();
  });

  it("offers the way down when lines arrive while the reader is up the log, follows their own line, and otherwise follows", async () => {
    const w = render(data([msg(1, BEN), msg(2, BEN, {}, 3)]));
    await flushPromises(); // the opening scroll to the newest line, before the mocks below see it
    const log = w.find('[role="log"]').element as HTMLElement;
    // jsdom lays nothing out: 100 px a line, and scrollTop kept as set (as `earlierPages.test.ts`).
    let top = 0;
    Object.defineProperty(log, "scrollTop", { configurable: true, get: () => top, set: (v: number) => { top = v; } });
    Object.defineProperty(log, "scrollHeight", { configurable: true, get: () => log.querySelectorAll("[data-chat-row]").length * 100 });
    const four = [msg(1, BEN), msg(2, BEN, {}, 3), msg(3, BEN, {}, 2), msg(4, BEN, {}, 1)];
    await w.setProps({ data: data(four) });
    expect(top).toBe(0);
    const pill = w.findAll("button").find((b) => b.text().startsWith("2 new messages"));
    expect(pill).toBeDefined();
    await pill!.trigger("click");
    expect(top).toBe(400);
    expect(w.text()).not.toContain("new messages");

    top = 0;
    await w.setProps({ data: data([...four, msg(5, ME, {}, 0)]) });
    await flushPromises();
    expect(top).toBe(500);
    expect(w.text()).not.toContain("new message");

    await w.setProps({ data: data([...four, msg(5, ME, {}, 0), msg(6, BEN, {}, 0)]) });
    await flushPromises();
    expect(top).toBe(600);
  });
});

describe("mergeLines", () => {
  it("drops a pending line once the server lists its id — the server's copy wins", () => {
    const server = [msg(1, ME, { id: "p1" as unknown as string })];
    const pending: PendingLine[] = [{ message_id: "p1", thread_id: T, parent_id: null, body: "x", files: [], state: "pending", error: null }];
    expect(mergeLines(server, pending, T).map((l) => l.kind)).toEqual(["server"]);
  });

  it("keeps another conversation's pending lines out of this one", () => {
    const pending: PendingLine[] = [{ message_id: "p9", thread_id: "elsewhere", parent_id: null, body: "x", files: [], state: "pending", error: null }];
    expect(mergeLines([], pending, T)).toEqual([]);
  });
});
