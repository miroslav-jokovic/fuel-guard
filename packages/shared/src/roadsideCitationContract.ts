import { z } from "zod";
import { recordId } from "./recordId.js";
import { isCalendarDay, shiftDay, type CalendarDay } from "./calendarDay.js";

/**
 * A roadside ticket and its court result (INSPECTION-CHALLENGE-PLAN IC4, R-ADJ1/R-ADJ3; Q-IC2 (a): the safety
 * office obtains the dispositions). Table `inspection_citation_actions` (0489).
 *
 * ── WHY A RESULT MATTERS, AND WHEN IT STOPS MATTERING ──────────────────────────────────────────
 * FMCSA's job aid (AdjudicatedCitations2025.pdf) counts only a CONTESTED citation: "not guilty / dismissed"
 * removes the violation from SMS, "a different charge" cuts it to severity 1, and a paid fine keeps it whole
 * for its 24 months. SMS reads 24 months of inspections, so a result for an older one moves nothing. Measured
 * 2026-10-19: 165 tickets, 144 with no result on the feed; 8 under 60 days, 45 at 60 days – 1 year, 45 at
 * 1–2 years, 46 older.
 */

/**
 * The officer writes "WARNING", "VERBAL", "VW", "W" or "N/A" in the citation field for a warning (measured
 * 2026-10-19: 45 of 211 filled fields). A warning has no court and no result to obtain.
 */
const NOT_A_TICKET = /^(WARN(ING)?|VERBAL( WARNING)?|VW|W|N\/?A|NONE)$/;
export function isTicket(citationNumber: string | null): boolean {
  const c = citationNumber?.trim().toUpperCase();
  return !!c && !NOT_A_TICKET.test(c);
}

/** R-ADJ1: the court is given 60 days before the office is asked to chase it. */
export const COURT_RESULT_AFTER_DAYS = 60;
/** Past SMS's 24 months a result moves no score, so the office is not asked. */
export const COURT_RESULT_WITHIN_DAYS = 730;
/** A request to the court comes back after this long with nothing filed — the default the person may move. */
export const COURT_FOLLOW_UP_DAYS = 30;

export const CITATION_ACTIONS = ["requested_from_court", "not_contested"] as const;
export type CitationAction = (typeof CITATION_ACTIONS)[number];

/** `GET /api/roadside-inspections/:id/citations` — each ticket on the inspection and where it stands. */
export interface RoadsideCitationDto {
  violationId: string;
  code: string | null;
  description: string | null;
  citationNumber: string;
  /** The court's results as FMCSA's feed carries them; empty when it carries none. */
  courtResults: string[];
  /** The office's newest act on the ticket, when there is one. */
  action: { id: string; kind: CitationAction; followUpOn: CalendarDay | null; note: string | null; actedBy: string | null; actedAt: string } | null;
}

/**
 * Where a ticket stands for the Next steps rule. `courtResultFiled` is whether a court result document is
 * filed on the inspection: a document is the INSPECTION's (IC2 — 5 inspections hold two tickets), so it closes
 * every ticket on it until the disposition is read against each violation (R-ADJ2's read, a later step).
 */
export type CitationStanding =
  | { kind: "decided"; text: string }
  | { kind: "result_filed" }
  | { kind: "not_contested" }
  | { kind: "too_old" }
  | { kind: "too_soon"; askOn: CalendarDay }
  | { kind: "requested"; followUpOn: CalendarDay }
  | { kind: "follow_up"; requestedOn: string }
  | { kind: "ask" };

export function citationStanding(
  t: Pick<RoadsideCitationDto, "courtResults" | "action">,
  courtResultFiled: boolean,
  inspectionDate: CalendarDay | null,
  today: CalendarDay,
): CitationStanding {
  if (t.courtResults.length) return { kind: "decided", text: t.courtResults.at(-1)! };
  if (courtResultFiled) return { kind: "result_filed" };
  if (t.action?.kind === "not_contested") return { kind: "not_contested" };
  if (!inspectionDate || inspectionDate < shiftDay(today, -COURT_RESULT_WITHIN_DAYS)) return { kind: "too_old" };
  if (t.action?.kind === "requested_from_court") {
    return t.action.followUpOn && t.action.followUpOn > today
      ? { kind: "requested", followUpOn: t.action.followUpOn }
      : { kind: "follow_up", requestedOn: t.action.actedAt };
  }
  const askOn = shiftDay(inspectionDate, COURT_RESULT_AFTER_DAYS);
  return today < askOn ? { kind: "too_soon", askOn } : { kind: "ask" };
}

/**
 * `POST /api/roadside-inspections/:id/citations` — the office's act on one ticket. A request carries the day to
 * look again (default: today + 30, set by the page); "not contested" carries none. `basedOn` is the newest act
 * the page showed (null when none): an act over a newer one is refused, so two people never overwrite each other.
 */
export const roadsideCitationActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("requested_from_court"),
    violationId: recordId(),
    basedOn: recordId().nullable(),
    followUpOn: z.string().refine((d) => isCalendarDay(d) && shiftDay(d, 0) === d, "Give the day to follow up as YYYY-MM-DD."),
    note: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.literal("not_contested"),
    violationId: recordId(),
    basedOn: recordId().nullable(),
    note: z.string().trim().max(1000).optional(),
  }),
]);
export type RoadsideCitationAction = z.infer<typeof roadsideCitationActionSchema>;
