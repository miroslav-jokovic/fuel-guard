import { describe, expect, it } from "vitest";
import type { ChatActivityItem } from "@silvicom/shared";
import { activityLine, activityTarget } from "./chatActivity";

/** What an Activity line says and where it opens (D-CHAT25). */
const T = "33333333-3333-4333-8333-333333333333";
const POST = "88888888-8888-4888-8888-888888888888";
const item = (over: Partial<ChatActivityItem>): ChatActivityItem => ({
  message_id: "99999999-9999-4999-8999-999999999999", reason: "mention", at: "2026-10-27T15:00:00Z", unread: true,
  thread_id: T, kind: "channel", subject: "Loads", space_id: null, parent_id: null, seq: 3,
  sender_user_id: null, sender_name: "Ben", body: "x", created_at: "2026-10-27T15:00:00Z",
  reaction: null, reactor_user_id: null, reactor_name: null, ...over,
});
const none = () => null;

describe("activityLine", () => {
  it("says who, what and where: a channel with its #, a named group, a direct line with no place", () => {
    expect(activityLine(item({}), none)).toBe("Ben mentioned you in # Loads");
    expect(activityLine(item({ reason: "reply" }), none)).toBe("Ben replied in # Loads");
    expect(activityLine(item({ kind: "group", subject: "Night dispatch" }), none)).toBe("Ben mentioned you in Night dispatch");
    expect(activityLine(item({ kind: "direct", subject: null }), none)).toBe("Ben mentioned you");
  });

  it("calls a group with no name what the rail calls it, and 'a group' when the rail has not got it", () => {
    expect(activityLine(item({ kind: "group", subject: null }), () => "Ana, Cara")).toBe("Ben mentioned you in Ana, Cara");
    expect(activityLine(item({ kind: "group", subject: null }), none)).toBe("Ben mentioned you in a group");
  });

  it("names a sender it does not know as Someone", () => {
    expect(activityLine(item({ sender_name: null }), none)).toBe("Someone mentioned you in # Loads");
  });
});

describe("activityLine for a reaction (CH6c-2)", () => {
  it("names who reacted and with what — not the line's sender, who is the reader", () => {
    const r = item({ reason: "reaction", sender_name: "Me", reaction: "thumbs_up", reactor_name: "Cara" });
    expect(activityLine(r, none)).toBe("Cara reacted 👍 in # Loads");
    expect(activityLine({ ...r, kind: "direct", subject: null }, none)).toBe("Cara reacted 👍");
    expect(activityLine({ ...r, reactor_name: null }, none)).toBe("Someone reacted 👍 in # Loads");
  });
});

describe("activityTarget", () => {
  it("opens a conversation's line in it, a channel post in its channel, and a reply in its post's thread", () => {
    expect(activityTarget(item({ kind: "direct" }))).toEqual({ c: T });
    expect(activityTarget(item({ kind: "group" }))).toEqual({ c: T });
    expect(activityTarget(item({}))).toEqual({ ch: T });
    expect(activityTarget(item({ parent_id: POST }))).toEqual({ ch: T, post: POST });
  });
});
