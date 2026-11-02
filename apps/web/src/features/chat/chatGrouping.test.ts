import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@silvicom/shared";
import { firstUnreadSeqOf, groupLines, RUN_WINDOW_MS, type MergedLine } from "./chatGrouping";
import type { PendingLine } from "./useChat";

/**
 * The rules a log is read by (CHAT-REDESIGN-PLAN D-CHATUI4, D-CHATUI6): one sender within five minutes on
 * one day is one run, and only its first line carries the name; a day change or a failed send breaks a
 * run; the "New" line goes above the first unread seq and starts a run of its own.
 */
const ME = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-26T15:00:00Z");
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const server = (seq: number, sender: string, minutesAgo: number): MergedLine => ({
  kind: "server",
  message: {
    id: `m${seq}`, thread_id: "t", seq, rev: seq, sender_user_id: sender, sender_name: sender === ME ? "Ana" : "Ben",
    body: `line ${seq}`, created_at: at(minutesAgo), edited_at: null, deleted_at: null, parent_id: null, reply_count: 0, last_reply_at: null,
  } as ChatMessage,
});
const local = (id: string, state: PendingLine["state"]): MergedLine => ({
  kind: "local",
  line: { message_id: id, thread_id: "t", parent_id: null, body: id, files: [], state, error: state === "failed" ? "down" : null },
});
const rows = (lines: MergedLine[], firstUnread: number | null = null) => groupLines(lines, ME, firstUnread, NOW).flatMap((d) => d.rows);

describe("groupLines", () => {
  it("folds one sender's lines within five minutes into a run whose first line alone carries the name", () => {
    const r = rows([server(1, BEN, 4), server(2, BEN, 2), server(3, BEN, 1)]);
    expect(r.map((x) => x.first)).toEqual([true, false, false]);
  });

  it("starts a new run after the window, or when the sender changes", () => {
    expect(rows([server(1, BEN, 10), server(2, BEN, 10 - RUN_WINDOW_MS / 60_000 - 1)]).map((x) => x.first)).toEqual([true, true]);
    expect(rows([server(1, BEN, 2), server(2, ME, 1)]).map((x) => x.first)).toEqual([true, true]);
  });

  it("puts each day under its own divider — Today, Yesterday, then the house date — and a day change breaks a run", () => {
    const days = groupLines([server(1, BEN, 60 * 24 * 3), server(2, BEN, 60 * 24), server(3, BEN, 60 * 24 - 1), server(4, BEN, 1)], ME, null, NOW);
    expect(days.map((d) => d.label)).toEqual(["10/23/2026", "Yesterday", "Today"]);
    expect(days.map((d) => d.rows.map((r) => r.first))).toEqual([[true], [true, false], [true]]);
  });

  it("breaks a run at midnight even inside the window — the day line belongs above the first line of the new day", () => {
    const midnight = new Date(NOW);
    midnight.setHours(0, 0, 0, 0);
    const minutesBefore = (NOW.getTime() - midnight.getTime()) / 60_000;
    const days = groupLines([server(1, BEN, minutesBefore + 2), server(2, BEN, minutesBefore - 1)], ME, null, NOW);
    expect(days.map((d) => d.label)).toEqual(["Yesterday", "Today"]);
    expect(days.map((d) => d.rows.map((r) => r.first))).toEqual([[true], [true]]);
  });

  it("lets a pending send continue your run, and makes a failed one end it", () => {
    expect(rows([server(1, ME, 1), local("p1", "pending")]).map((x) => x.first)).toEqual([true, false]);
    expect(rows([server(1, ME, 1), local("p1", "failed"), local("p2", "pending")]).map((x) => x.first)).toEqual([true, false, true]);
  });

  it("marks the first unread line as where New starts, and starts a run there whoever wrote it", () => {
    const r = rows([server(5, BEN, 3), server(6, BEN, 2), server(7, BEN, 1)], 6);
    expect(r.map((x) => x.unreadStart)).toEqual([false, true, false]);
    expect(r.map((x) => x.first)).toEqual([true, true, false]);
  });
});

describe("firstUnreadSeqOf", () => {
  it("is the first of the unread lines, or null when nothing is unread", () => {
    expect(firstUnreadSeqOf({ unread: 2, last_seq: 7 })).toBe(6);
    expect(firstUnreadSeqOf({ unread: 0, last_seq: 7 })).toBeNull();
  });
});
