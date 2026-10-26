import type { ChatMessage } from "@silvicom/shared";
import type { PendingLine } from "./useChat";
import { chatDayLabel } from "./chatTime";

/**
 * How a log of lines is read (CHAT-REDESIGN-PLAN D-CHATUI4, D-CHATUI6): every line is a row, the rows
 * are gathered into runs — one sender, one day, five minutes apart at most — and the runs into days.
 * The first line of a run carries the avatar, the name and the time; the lines after it carry only
 * their words. A day divider carries the date, so no line repeats it.
 *
 * Pure, so `chatGrouping.test.ts` holds the rules and the three panes (a conversation, a
 * channel, a thread) read one shape. A pending line (sent, not yet confirmed) is the viewer's own and
 * continues their run; a failed one ends it, because a line that did not arrive should not read as
 * part of what did.
 */
export type MergedLine = { kind: "server"; message: ChatMessage } | { kind: "local"; line: PendingLine };

export interface ChatRow {
  key: string;
  line: MergedLine;
  /** The first line of a run: draw the avatar, the name and the time. */
  first: boolean;
  /** The "New" line sits above this row (D-CHATUI6). */
  unreadStart: boolean;
}

export interface ChatDay {
  key: string;
  label: string;
  rows: ChatRow[];
}

/** Slack's and MUI's default: the same person within five minutes reads as one turn. */
export const RUN_WINDOW_MS = 5 * 60_000;

const senderOf = (l: MergedLine, viewerId: string) => (l.kind === "server" ? l.message.sender_user_id : viewerId);
const stampOf = (l: MergedLine, now: Date) => (l.kind === "server" ? new Date(l.message.created_at) : now);
const keyOf = (l: MergedLine) => (l.kind === "server" ? l.message.id : l.line.message_id);
const endsRun = (l: MergedLine) => l.kind === "local" && l.line.state === "failed";

/**
 * `firstUnreadSeq` is the seq the "New" line goes above: the conversation's `read_seq + 1` the moment it
 * opened, before reading moved it (D-CHATUI6). Null means nothing is marked.
 */
export function groupLines(lines: readonly MergedLine[], viewerId: string, firstUnreadSeq: number | null, now: Date = new Date()): ChatDay[] {
  const days: ChatDay[] = [];
  let prev: { sender: string | null; at: Date; dayKey: string; failed: boolean } | null = null;
  for (const line of lines) {
    const at = stampOf(line, now);
    const dayKey = Number.isNaN(at.getTime()) ? "unknown" : at.toDateString();
    const sender = senderOf(line, viewerId);
    const continues =
      prev !== null && !prev.failed && prev.dayKey === dayKey && prev.sender === sender && at.getTime() - prev.at.getTime() <= RUN_WINDOW_MS;
    let day = days.at(-1);
    if (!day || day.key !== dayKey) {
      day = { key: dayKey, label: chatDayLabel(at, now), rows: [] };
      days.push(day);
    }
    const unreadStart = line.kind === "server" && firstUnreadSeq !== null && line.message.seq === firstUnreadSeq;
    // A "New" line starts a run too: the name belongs beside the first thing you have not read.
    day.rows.push({ key: keyOf(line), line, first: !continues || unreadStart, unreadStart });
    prev = { sender, at, dayKey, failed: endsRun(line) };
  }
  return days;
}

/** Where the "New" line goes for a conversation opened with `unread` lines of `lastSeq`: the first of them. */
export function firstUnreadSeqOf(c: { unread: number; last_seq: number }): number | null {
  return c.unread > 0 ? c.last_seq - c.unread + 1 : null;
}
