import { formatDisplayDateTime, formatDisplayDayShort } from "@silvicom/shared";

/**
 * The inbox row's time: the clock for today, `MM/DD` before that — the house short date
 * (`formatDisplayDayShort`), never a locale's own spelling. A message's full stamp is
 * `formatDisplayDateTime`, which names message times as one of its uses.
 */
export function chatRowTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (d.toDateString() !== now.toDateString()) return formatDisplayDayShort(d);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export const chatStamp = (iso: string): string => formatDisplayDateTime(iso);
