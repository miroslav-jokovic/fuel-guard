/**
 * How a follow-up line reads (WARNING-DESK-PLAN §4, D-WD6/D-WD15). Pure, so the words are tested once
 * and the page and the drawer cannot disagree about them.
 */
import {
  displayDayOf,
  formatDisplayDate,
  FOLLOW_UP_DRIVER_SOURCE_LABELS,
  FOLLOW_UP_STATUS_LABELS,
  followUpTimesLabel,
  type FollowUpLine,
  type FollowUpSeverity,
} from "@silvicom/shared";
import type { SortState } from "@silvicom/ui";
import type { BadgeTone } from "@/lib/badges";

export interface StateBadge {
  tone: BadgeTone;
  text: string;
}

/**
 * The State column. The two derived states outrank the status because each asks for an act: a warning
 * after the call means the call did not fix it; "looks fixed" asks a person to confirm and close.
 */
export function stateBadge(line: Pick<FollowUpLine, "status" | "outcome" | "warnedAgain" | "looksFixed">): StateBadge {
  if (line.status === "closed") return { tone: "neutral", text: line.outcome === "not_a_problem" ? "Closed — not a problem" : "Closed — fixed" };
  if (line.warnedAgain) return { tone: "danger", text: "Warned again after the call" };
  if (line.looksFixed) return { tone: "success", text: "Looks fixed — confirm" };
  if (line.status === "new") return { tone: "info", text: FOLLOW_UP_STATUS_LABELS.new };
  return { tone: "neutral", text: FOLLOW_UP_STATUS_LABELS[line.status] };
}

export const SEVERITY_BADGE: Record<FollowUpSeverity, StateBadge | null> = {
  urgent: { tone: "danger", text: "Urgent" },
  high: { tone: "caution", text: "High" },
  normal: null,
};

/** "Trailer tire losing air (ATIS lamp) · 5 times in 3 days". */
export function problemDetail(line: Pick<FollowUpLine, "warningCount" | "firstAt" | "lastAt">): string {
  return followUpTimesLabel(line.warningCount, line.firstAt, line.lastAt);
}

/** "Trailer R535973 · truck 847", "Truck 847", or the Samsara name with "not in roster". */
export function unitLabel(line: Pick<FollowUpLine, "subjectKind" | "subjectName" | "truck" | "trailer" | "inRoster">): string {
  if (line.subjectKind === "driver") return line.truck ? `Truck ${line.truck.number}` : "";
  const parts: string[] = [];
  if (line.trailer) parts.push(`Trailer ${line.trailer.number}`);
  if (line.truck) parts.push(`${line.trailer ? "truck" : "Truck"} ${line.truck.number}`);
  if (parts.length === 0) parts.push(line.subjectName ?? (line.subjectKind === "trailer" ? "Trailer" : "Truck"));
  const label = parts.join(" · ");
  return line.inRoster ? label : `${label} (not in roster)`;
}

/** "Angel Perez (trailer pairing)" — which record named the driver, so a guess never reads as a fact. */
export function driverLabel(line: Pick<FollowUpLine, "driver" | "subjectKind" | "inRoster">): string | null {
  if (!line.driver) return null;
  const notInRoster = line.driver.id === null ? ", not in roster" : "";
  return `${line.driver.name} (${FOLLOW_UP_DRIVER_SOURCE_LABELS[line.driver.source]}${notInRoster})`;
}

/** "2 h ago", "3 days ago" — the Last time column. */
export function agoLabel(iso: string, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** Search across the words a person types: unit, driver, problem. */
export function matchesFollowUpSearch(line: FollowUpLine, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return [line.ruleLabel, line.subjectName, line.truck?.number, line.trailer?.number, line.driver?.name]
    .some((v) => typeof v === "string" && v.toLowerCase().includes(q));
}

/** Samsara's coaching state in words (D-WD8: shown as Samsara holds it, never changed from here). */
const COACHING: Record<string, string> = {
  needsReview: "needs review",
  needsCoaching: "needs coaching",
  coached: "coached",
  reviewed: "reviewed",
  dismissed: "dismissed",
  needsRecognition: "needs recognition",
  recognized: "recognized",
};
export function coachingLabel(state: string): string {
  return COACHING[state] ?? state;
}

function hoursText(h: number): string {
  return h % 24 === 0 ? `${h / 24} ${h === 24 ? "day" : "days"}` : `${h} hours`;
}

/** What a rule's numbers mean, in one sentence: "3 times in 7 days", "The first time", "Not cleared after 3 days". */
export function ruleCountText(r: { thresholdCount: number; windowDays: number; minActiveHours: number }): string {
  if (r.minActiveHours > 0 && r.thresholdCount === 1) return `Not cleared after ${hoursText(r.minActiveHours)}`;
  const base = r.thresholdCount === 1 ? "The first time" : `${r.thresholdCount} times in ${r.windowDays} ${r.windowDays === 1 ? "day" : "days"}`;
  return r.minActiveHours > 0 ? `${base}, each on ${hoursText(r.minActiveHours)}` : base;
}

// ── the list's order (D-WD18; design contract §5.3) ─────────────────────────────────────────────
/**
 * The order the list OPENS in, until a header is clicked: open lines by their newest warning, closed ones
 * by their close — each the row's own event time, newest first, as every list of records does. The key
 * `closedAt` is not a column; a header click writes its own key to the URL and this steps aside.
 */
export function followUpListSort(url: SortState, closed: boolean): SortState {
  if (url.key) return url;
  return closed ? { key: "closedAt", dir: "desc" } : { key: "lastAt", dir: "desc" };
}

/** What each sortable column sorts by — the words the cell prints, or the instant behind "2 h ago". */
export function followUpSortValue(line: FollowUpLine, key: string): unknown {
  if (key === "problem") return line.ruleLabel;
  if (key === "unit") return unitLabel(line) || line.subjectName;
  if (key === "lastAt") return Date.parse(line.lastAt);
  if (key === "closedAt") return line.closedAt ? Date.parse(line.closedAt) : null;
  return null;
}

export interface WarningDay<T> {
  /** `YYYY-MM-DD` on the reader's clock — the group's key. */
  day: string;
  /** `MM/DD/YYYY`, the heading. */
  label: string;
  warnings: T[];
}

/**
 * The drawer's warnings, one group per calendar day on the reader's clock, in the order given (the API
 * sends them newest first). A line can carry 70 warnings over a week; a day heading lets the eye find
 * "today" without reading every date.
 */
export function warningsByDay<T extends { happenedAt: string }>(warnings: readonly T[]): WarningDay<T>[] {
  const out: WarningDay<T>[] = [];
  for (const w of warnings) {
    const day = displayDayOf(new Date(w.happenedAt));
    const last = out[out.length - 1];
    if (last && last.day === day) last.warnings.push(w);
    else out.push({ day, label: formatDisplayDate(new Date(w.happenedAt)), warnings: [w] });
  }
  return out;
}
