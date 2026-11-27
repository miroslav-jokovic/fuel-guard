import type { BadgeTone } from "@/lib/badges";
import type { BrokerMailRow } from "@silvicom/shared";

/**
 * Pure helpers for the Broker mail page (BROKER-MAIL-READER-PLAN P2), kept out of the component so the
 * rules are tested without mounting it.
 */

/** Whole minutes since the email arrived, never negative (a clock a minute ahead is not "in the future"). */
export function waitedMinutes(receivedAt: string, nowMs: number): number {
  const at = Date.parse(receivedAt);
  return Number.isFinite(at) ? Math.max(0, Math.floor((nowMs - at) / 60_000)) : 0;
}

/** "4 min", "1 h 05 min", "2 d 3 h" — how long a broker has waited, as a dispatcher says it. */
export function waitLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h} h ${String(minutes % 60).padStart(2, "0")} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/**
 * The wait's colour against the company's answer-by time (Settings › Broker mail): neutral while there
 * is time, warning in its last five minutes, danger past it — the mockup's green / amber / red dot, as
 * a badge from the one badge vocabulary.
 */
export function waitTone(minutes: number, answerWithin: number): BadgeTone {
  if (minutes >= answerWithin) return "danger";
  if (minutes >= answerWithin - 5) return "warning";
  return "neutral";
}

/** Why a row in "Needs a load" has none: no reference matched, or one matched several loads. */
export function matchNote(row: Pick<BrokerMailRow, "matchState" | "matchedRefs">): string {
  if (row.matchState === "several") return row.matchedRefs.length ? `${row.matchedRefs.join(", ")} fits more than one load` : "Fits more than one load";
  if (row.matchState === "none") return "No load has this reference";
  return "No load reference found";
}

/** Who answered, for the Answered queue — or how the owner closed it (0656). */
export function answeredBy(row: Pick<BrokerMailRow, "threadState">, seesAll: boolean): string {
  if (row.threadState === "answered_by_colleague") return "A colleague replied";
  if (row.threadState === "closed_by_phone") return "Handled by phone";
  if (row.threadState === "closed_not_for_us") return "Not for us";
  return seesAll ? "The dispatcher replied" : "You replied";
}

/** Search over what a dispatcher would type: sender, subject, load reference. */
export function matchesBrokerMailSearch(row: BrokerMailRow, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return [row.fromAddress, row.subject, row.load?.ref, row.ownerName, ...row.matchedRefs].some((v) => v?.toLowerCase().includes(t));
}

/** The ask kinds in a dispatcher's words, for the panel. */
export const ASK_WORDS: Record<string, string> = {
  eta: "ETA", location: "Where the truck is", tracking_link: "Tracking request", appointment: "Appointment",
  pod: "POD / signed BOL", delay_reason: "Why it is late", other: "Something else",
};
