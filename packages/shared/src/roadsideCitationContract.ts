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

/**
 * What a court can decide, as FMCSA codes it (job aid AdjudicatedCitations2025.pdf; 0 "not applicable" is a
 * citation with no court — a warning, never a ticket here). A paid fine is code 1.
 */
export const COURT_OUTCOME_CODES = [3, 2, 1] as const;
export type CourtOutcomeCode = (typeof COURT_OUTCOME_CODES)[number];
export const COURT_OUTCOME_TEXT: Record<CourtOutcomeCode, string> = {
  3: "Not guilty or dismissed",
  2: "Convicted of a different charge",
  1: "Convicted of the charge",
};
/** What the outcome does to the inspection's CSA record once FMCSA has it. */
export const COURT_OUTCOME_EFFECT: Record<CourtOutcomeCode, string> = {
  3: "the violation leaves CSA and PSP",
  2: "the violation stays, at severity 1",
  1: "nothing changes; a paid fine is a conviction of the charge",
};
/** R-ADJ2 / R-ADJ3: only a dismissal or a different charge changes FMCSA's record, so only those are filed. */
export const courtOutcomeFileable = (code: CourtOutcomeCode): boolean => code === 3 || code === 2;

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
  /** What the court decided, as a person read it from the filed paper (0495); the newest record. */
  disposition: RoadsideCitationDispositionDto | null;
  /** The DataQs request over it, once someone attested to one (0495); the newest record. */
  dataqsCase: RoadsideDataqsCaseDto | null;
}

export interface RoadsideCitationDispositionDto {
  id: string;
  outcomeCode: CourtOutcomeCode;
  amendedCharge: string | null;
  courtName: string;
  decidedOn: CalendarDay;
  /** The court paper it was read from — a `court_disposition` document on this inspection. */
  documentId: string;
  note: string | null;
  recordedBy: string | null;
  recordedAt: string;
}

export interface RoadsideDataqsCaseDto {
  id: string;
  state: "approved" | "filed";
  /** The disposition it was attested over; a newer one means it must be drafted again. */
  dispositionId: string;
  narrative: string;
  attestedBy: string | null;
  attestedAt: string;
  rdrNumber: string | null;
  filedOn: CalendarDay | null;
}

/**
 * Where a ticket stands for the Next steps rule. `courtPaperFiledAt` is when the newest court result was filed
 * on the inspection (null when none is). A paper is the INSPECTION's (IC2 — 5 inspections hold two tickets), so
 * it no longer closes a ticket: it asks a person to record what it says about each one (`record_result`).
 * An act on the ticket after the paper was filed (asking the court again) says the paper was not this ticket's.
 *
 * Once a disposition is recorded (R-ADJ2/R-ADJ3): a conviction, or an inspection past SMS's 24 months, has
 * nothing to file (`court_decided`); a dismissal or different charge FMCSA does not show is a request to
 * prepare (`file_ready`), then to file (`file_approved`), then `filed`. FMCSA's own result outranks all of it.
 */
export type CitationStanding =
  | { kind: "decided"; text: string }
  | { kind: "court_decided"; disposition: RoadsideCitationDispositionDto; why: "no_change" | "too_old" }
  | { kind: "file_ready"; disposition: RoadsideCitationDispositionDto; redraft: boolean }
  | { kind: "file_approved"; disposition: RoadsideCitationDispositionDto; dataqs: RoadsideDataqsCaseDto }
  | { kind: "filed"; dataqs: RoadsideDataqsCaseDto }
  | { kind: "record_result" }
  | { kind: "not_contested" }
  | { kind: "too_old" }
  | { kind: "too_soon"; askOn: CalendarDay }
  | { kind: "requested"; followUpOn: CalendarDay }
  | { kind: "follow_up"; requestedOn: string }
  | { kind: "ask" };

export function citationStanding(
  t: Pick<RoadsideCitationDto, "courtResults" | "action" | "disposition" | "dataqsCase">,
  courtPaperFiledAt: string | null,
  inspectionDate: CalendarDay | null,
  today: CalendarDay,
): CitationStanding {
  if (t.courtResults.length) return { kind: "decided", text: t.courtResults.at(-1)! };
  const tooOld = !inspectionDate || inspectionDate < shiftDay(today, -COURT_RESULT_WITHIN_DAYS);
  const d = t.disposition;
  if (d) {
    // A request DataQs holds is a fact whatever was recorded since; it waits on FMCSA's feed.
    if (t.dataqsCase?.state === "filed") return { kind: "filed", dataqs: t.dataqsCase };
    if (!courtOutcomeFileable(d.outcomeCode)) return { kind: "court_decided", disposition: d, why: "no_change" };
    if (tooOld) return { kind: "court_decided", disposition: d, why: "too_old" };
    const c = t.dataqsCase;
    if (c?.state === "approved" && c.dispositionId === d.id) return { kind: "file_approved", disposition: d, dataqs: c };
    return { kind: "file_ready", disposition: d, redraft: c?.state === "approved" };
  }
  const paperUnread = !!courtPaperFiledAt && (!t.action || t.action.actedAt < courtPaperFiledAt);
  if (!paperUnread && t.action?.kind === "not_contested") return { kind: "not_contested" };
  if (tooOld) return { kind: "too_old" };
  if (paperUnread) return { kind: "record_result" };
  if (t.action?.kind === "requested_from_court") {
    return t.action.followUpOn && t.action.followUpOn > today
      ? { kind: "requested", followUpOn: t.action.followUpOn }
      : { kind: "follow_up", requestedOn: t.action.actedAt };
  }
  const askOn = shiftDay(inspectionDate, COURT_RESULT_AFTER_DAYS);
  return today < askOn ? { kind: "too_soon", askOn } : { kind: "ask" };
}

/** When the newest court paper was filed — `courtPaperFiledAt` — from the papers, oldest first. */
export const courtPaperFiledAt = (papers: readonly { filedAt: string }[]): string | null =>
  papers.reduce<string | null>((n, p) => (!n || p.filedAt > n ? p.filedAt : n), null);

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

/**
 * `POST /api/roadside-inspections/:id/citations/dispositions` — what the court decided on one ticket, read from a
 * court paper filed on the inspection. `basedOn` is the newest disposition the page showed (null when none).
 */
export const roadsideCitationDispositionSchema = z
  .object({
    violationId: recordId(),
    basedOn: recordId().nullable(),
    documentId: recordId(),
    outcomeCode: z.union([z.literal(3), z.literal(2), z.literal(1)]),
    amendedCharge: z.string().trim().max(200).optional(),
    courtName: z.string().trim().min(1, "Name the court.").max(200),
    decidedOn: z.string().refine((d) => isCalendarDay(d) && shiftDay(d, 0) === d, "Give the day the court decided as YYYY-MM-DD."),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((b) => (b.outcomeCode === 2) === !!b.amendedCharge, { message: "Name the charge the driver was convicted of instead.", path: ["amendedCharge"] });
export type RoadsideCitationDisposition = z.infer<typeof roadsideCitationDispositionSchema>;
