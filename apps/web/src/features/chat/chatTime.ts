import { formatDisplayDate, formatDisplayDateTime, formatDisplayDayShort } from "@silvicom/shared";

/**
 * The inbox row's time: the clock for today, `MM/DD` before that — the house short date
 * (`formatDisplayDayShort`), never a locale's own spelling. A message's full stamp is
 * `formatDisplayDateTime`, which names message times as one of its uses.
 */
export function chatRowTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (d.toDateString() !== now.toDateString()) return formatDisplayDayShort(d);
  return chatClock(d);
}

export const chatStamp = (iso: string): string => formatDisplayDateTime(iso);

/** The clock a row shows beside a name (CHAT-REDESIGN-PLAN D-CHATUI4); the day divider carries the date. */
export function chatClock(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** A day divider's words: Today, Yesterday, else the house date (D-DS18). */
export function chatDayLabel(d: Date, now: Date = new Date()): string {
  if (Number.isNaN(d.getTime())) return "";
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return formatDisplayDate(d);
}
