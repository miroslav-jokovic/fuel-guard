import { describe, expect, it } from "vitest";
import type { ChatActivityItem, ChatConversation } from "@silvicom/shared";
import { ALERT_TEXT_MAX, activityAlerts, alertText, inboxAlerts } from "./chatDesktopAlerts";

/**
 * CH6d's rules (Q-CHAT18 (a)), as a person meets them: a new direct or group line from somebody else
 * rings; a channel rings only for a mention or a reply; a mute means what it means on the bell; the
 * conversation on screen in a visible tab never rings; nothing rings for what was there when the page
 * loaded; and an alert says who, where and the first 80 characters, mentions as names.
 */
const ME = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const T = "33333333-3333-4333-8333-333333333333";
const CH = "55555555-5555-4555-8555-555555555555";
const away = { visible: false, threadId: null };
const names = (id: string) => (id === BEN ? "Ben Admin" : null);

const conv = (seq: number, over: Partial<ChatConversation> = {}, from = BEN): ChatConversation => ({
  thread_id: T, kind: "direct", subject: null, load_id: null, created_at: "2026-10-30T09:00:00Z",
  last_message_at: "2026-10-30T09:00:00Z", last_seq: seq, rev: seq, read_seq: seq - 1, unread: 1, muted: "none",
  member_role: "member", member_count: 2, title_members: [{ user_id: BEN, name: "Ben Admin" }],
  last_message: { id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, seq, sender_user_id: from, sender_name: from === BEN ? "Ben Admin" : "Me", body: "Gate code 4411", created_at: "2026-10-30T09:00:00Z", deleted: false },
  ...over,
});

const item = (over: Partial<ChatActivityItem> = {}): ChatActivityItem => ({
  message_id: "99999999-9999-4999-8999-999999999999", reason: "mention", at: "2026-10-30T09:00:00Z", unread: true,
  thread_id: CH, kind: "channel", subject: "Loads", space_id: null, parent_id: null, seq: 4, sender_user_id: BEN,
  sender_name: "Ben Admin", body: `<@${ME}> can you call 611?`, created_at: "2026-10-30T09:00:00Z",
  reaction: null, reactor_user_id: null, reactor_name: null, ...over,
});

describe("inboxAlerts — direct and group lines", () => {
  it("rings for a new line from somebody else, titled by them alone in a direct conversation", () => {
    expect(inboxAlerts([conv(3)], [conv(4)], ME, away, names)).toEqual([
      { messageId: conv(4).last_message!.id, threadId: T, title: "Ben Admin", body: "Gate code 4411", query: { c: T } },
    ]);
  });

  it("titles a group line by its sender and the group", () => {
    const g = (seq: number) => conv(seq, { kind: "group", subject: "Night dispatch" });
    expect(inboxAlerts([g(3)], [g(4)], ME, away, names)[0]!.title).toBe("Ben Admin in Night dispatch");
  });

  it("rings for nothing on the first snapshot — what was there when the page loaded is not news", () => {
    expect(inboxAlerts(null, [conv(4)], ME, away, names)).toEqual([]);
  });

  it("rings for nothing that is not newer, not from somebody else, removed, or already read", () => {
    expect(inboxAlerts([conv(4)], [conv(4)], ME, away, names)).toEqual([]);
    expect(inboxAlerts([conv(3)], [conv(4, {}, ME)], ME, away, names)).toEqual([]);
    expect(inboxAlerts([conv(3)], [conv(4, { last_message: { ...conv(4).last_message!, deleted: true } })], ME, away, names)).toEqual([]);
    expect(inboxAlerts([conv(3)], [conv(4, { unread: 0 })], ME, away, names)).toEqual([]);
  });

  it("leaves a channel, and a conversation muted either way, to Activity's rules", () => {
    expect(inboxAlerts([conv(3, { kind: "channel" })], [conv(4, { kind: "channel" })], ME, away, names)).toEqual([]);
    expect(inboxAlerts([conv(3)], [conv(4, { muted: "mentions" })], ME, away, names)).toEqual([]);
    expect(inboxAlerts([conv(3)], [conv(4, { muted: "all" })], ME, away, names)).toEqual([]);
  });

  it("never rings for the conversation on screen in a visible tab — but does when the tab is hidden", () => {
    expect(inboxAlerts([conv(3)], [conv(4)], ME, { visible: true, threadId: T }, names)).toEqual([]);
    expect(inboxAlerts([conv(3)], [conv(4)], ME, { visible: false, threadId: T }, names)).toHaveLength(1);
    expect(inboxAlerts([conv(3)], [conv(4)], ME, { visible: true, threadId: CH }, names)).toHaveLength(1);
  });

  it("does not ring for a conversation it has never seen — its first appearance is a baseline too", () => {
    expect(inboxAlerts([], [conv(4)], ME, away, names)).toEqual([]);
  });
});

describe("activityAlerts — mentions and replies", () => {
  const muted = (m: ChatConversation["muted"] | undefined) => () => m;

  it("rings for a channel mention, with # and the words, the mention read as a name", () => {
    const [a] = activityAlerts([item()], new Set(), muted("none"), away, (id) => (id === ME ? "Miki" : null));
    expect(a).toEqual({ messageId: item().message_id, threadId: CH, title: "Ben Admin in # Loads", body: "@Miki can you call 611?", query: { ch: CH } });
  });

  it("opens a reply in its post's thread", () => {
    const [a] = activityAlerts([item({ reason: "reply", parent_id: T })], new Set(), muted("none"), away, names);
    expect(a!.query).toEqual({ ch: CH, post: T });
  });

  it("rings for a direct or group mention only when that conversation is muted to mentions — else the inbox did", () => {
    const d = item({ kind: "direct", thread_id: T, subject: null });
    expect(activityAlerts([d], new Set(), muted("none"), away, names)).toEqual([]);
    expect(activityAlerts([d], new Set(), muted("mentions"), away, names)).toHaveLength(1);
  });

  it("never rings for a conversation muted all, a reaction, a read item, one already seen, or the one on screen", () => {
    expect(activityAlerts([item()], new Set(), muted("all"), away, names)).toEqual([]);
    expect(activityAlerts([item({ reason: "reaction" })], new Set(), muted("none"), away, names)).toEqual([]);
    expect(activityAlerts([item({ unread: false })], new Set(), muted("none"), away, names)).toEqual([]);
    expect(activityAlerts([item()], new Set([item().message_id]), muted("none"), away, names)).toEqual([]);
    expect(activityAlerts([item()], new Set(), muted("none"), { visible: true, threadId: CH }, names)).toEqual([]);
  });
});

describe("alertText", () => {
  it("keeps the first 80 characters on one line, with an ellipsis only when it cut", () => {
    const long = "word ".repeat(40);
    const text = alertText(long, names);
    expect(text.length).toBe(ALERT_TEXT_MAX);
    expect(text.endsWith("…")).toBe(true);
    expect(alertText("two\n\nlines", names)).toBe("two lines");
    expect(alertText(null, names)).toBe("");
  });
});
