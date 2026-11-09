import { z } from "zod";
import { LEAD_REQUIREMENTS, type LeadRequirement } from "./leadMatch.js";
import type { LeadStatus } from "./leadContract.js";

/**
 * How a recruiter closes, qualifies or reopens a lead (ADS-LEAD-INTAKE-PLAN LQ5; Q-AD64 ruled 2026-11-09: a
 * FIXED reason list, no free text in the reason; `qualified` is the recruiter's act after the call). One row of
 * `recruiting_lead_closures` (0578) per act; the lead's `status` is the projection of its newest row.
 *
 * ── WHY A FIXED LIST ─────────────────────────────────────────────────────────────────────────────
 * The recruiter's verdict is the only VERIFIED quality signal a Meta lead ever gets (the form may not ask age,
 * licence number or any disqualifier — ADS-AGENT-PLAN §1). A reason that can be counted per campaign across
 * recruiters and weeks is what makes the lead-quality alert (LQ3) and the outcome feed (B6) say something; a
 * typed sentence cannot be counted. The optional note stays in the drawer and never reaches the audit log.
 *
 * ── THE LIST, AND WHAT EACH ONE NEEDS ON RECORD ──────────────────────────────────────────────────
 * `not_qualified:<requirement>` names one of `LEAD_REQUIREMENTS` — the same vocabulary the rules judge, so a
 * close ALSO writes a `lead_match_verdicts` row (`does_not_meet`, evidence `verified`): the person's verdict
 * and the rules' verdict become one ledger, and LQ3's "hard does-not-meet share" starts counting real cases.
 * The other reasons close the lead as `lost`. Three of them need evidence the database checks, never a
 * typed count: `not_interested` a `reached` contact row, `wrong_number` a `wrong_number` one, `unreachable`
 * at least `UNREACHABLE_MIN_ATTEMPTS` outbound `no_answer`/`voicemail` rows; `duplicate` needs another lead
 * of the same person (phone or e-mail, `recruiting_lead_matches`). `out_of_area` and `spam` need nothing.
 *
 * `home_time` is NOT a reason yet: it becomes a requirement in LQ7 (`HiringRequirements.home_time`), and the
 * reason list follows `LEAD_REQUIREMENTS` by derivation — when LQ7 adds it there, the list grows here and the
 * database CHECK is widened in that step's migration. The PGlite matrix `recruiting-lead-closures.test.mjs`
 * holds this list and the CHECK together.
 */

export const UNREACHABLE_MIN_ATTEMPTS = 3;

/** The reasons that close a lead as `lost`. */
export const LEAD_LOST_REASONS = ["not_interested", "unreachable", "wrong_number", "duplicate", "out_of_area", "spam"] as const;
export type LeadLostReason = (typeof LEAD_LOST_REASONS)[number];

export type LeadNotQualifiedReason = `not_qualified:${LeadRequirement}`;
export const LEAD_NOT_QUALIFIED_REASONS: readonly LeadNotQualifiedReason[] = LEAD_REQUIREMENTS.map(
  (r): LeadNotQualifiedReason => `not_qualified:${r}`,
);

export type LeadCloseReason = LeadNotQualifiedReason | LeadLostReason;
/** Every reason the database accepts, in one order: the matrix inserts each and refuses anything else. */
export const LEAD_CLOSE_REASONS: readonly LeadCloseReason[] = [...LEAD_NOT_QUALIFIED_REASONS, ...LEAD_LOST_REASONS];

export const isLeadCloseReason = (v: unknown): v is LeadCloseReason =>
  typeof v === "string" && (LEAD_CLOSE_REASONS as readonly string[]).includes(v);

/** The status a close reason leaves the lead in. */
export function statusAfterClose(reason: LeadCloseReason): Extract<LeadStatus, "not_qualified" | "lost"> {
  return reason.startsWith("not_qualified:") ? "not_qualified" : "lost";
}

/** The requirement a `not_qualified:*` reason names; null for the others. */
export function requirementOfReason(reason: LeadCloseReason): LeadRequirement | null {
  const key = reason.startsWith("not_qualified:") ? reason.slice("not_qualified:".length) : null;
  return key && (LEAD_REQUIREMENTS as readonly string[]).includes(key) ? (key as LeadRequirement) : null;
}

export const LEAD_CLOSURE_KINDS = ["closed", "qualified", "reopened"] as const;
export type LeadClosureKind = (typeof LEAD_CLOSURE_KINDS)[number];

const note = z.string().trim().max(2000).nullable().default(null).transform((v) => v || null);

/** `POST /recruitment/leads/:id/close` */
export const leadCloseSchema = z.object({
  reason: z.custom<LeadCloseReason>(isLeadCloseReason, { message: "Unknown close reason." }),
  note,
});
export type LeadCloseInput = z.infer<typeof leadCloseSchema>;

/** `POST /recruitment/leads/:id/qualify` and `/reopen` */
export const leadNoteSchema = z.object({ note });
export type LeadNoteInput = z.infer<typeof leadNoteSchema>;

/** One act, as the drawer's activity list reads it (`GET /recruitment/leads/:id/closures`). */
export interface LeadClosureRecord {
  id: string;
  kind: LeadClosureKind;
  reason: LeadCloseReason | null;
  status_after: LeadStatus;
  note: string | null;
  /** True on a purged lead whose note was emptied (`purge_lead`), so the drawer can say so. */
  note_withheld: boolean;
  actor_name: string;
  recorded_at: string;
}

/**
 * Office words for each reason, one home. The suffixed `not_qualified:*` labels are built from the requirement's
 * own label, so a requirement added to `LEAD_REQUIREMENTS` must be added here too — the type makes that a
 * compile error rather than an unlabelled picker row.
 */
const REQUIREMENT_WORDS: Record<LeadRequirement, string> = {
  age: "Under the minimum age",
  class_a: "No Class A CDL",
  class_a_experience: "Not enough Class A experience",
  hazmat: "No hazmat endorsement",
  dui: "DUI",
  preventable_accident: "Preventable accident",
  clearinghouse: "Clearinghouse prohibited",
  drug_alcohol: "Drug or alcohol result unresolved",
};
const LOST_WORDS: Record<LeadLostReason, string> = {
  not_interested: "Not interested",
  unreachable: `Unreachable after ${UNREACHABLE_MIN_ATTEMPTS} attempts`,
  wrong_number: "Wrong number",
  duplicate: "Duplicate of another lead",
  out_of_area: "Outside the hiring area",
  spam: "Spam",
};
export function leadCloseReasonLabel(reason: LeadCloseReason): string {
  const req = requirementOfReason(reason);
  return req ? REQUIREMENT_WORDS[req] : LOST_WORDS[reason as LeadLostReason];
}

export const LEAD_CLOSURE_KIND_LABELS: Record<LeadClosureKind, string> = {
  closed: "Closed",
  qualified: "Qualified",
  reopened: "Reopened",
};

/**
 * What a lead has on record, as the drawer counts it from the contacts list and the same-person matches — the
 * evidence 0578's functions read for themselves (`close_lead` RL055–RL057, `qualify_lead` RL055). Counted the
 * SAME way: outbound `no_answer`/`voicemail` rows are attempts; any `reached` row (either direction) is a reached
 * call; any `wrong_number` row is a wrong number; another lead of the person is a duplicate.
 */
export interface LeadEvidence {
  reached: number;
  wrong_number: number;
  /** Outbound `no_answer` + `voicemail` contact rows. */
  attempts: number;
  /** Other leads of the same person (phone or e-mail), `LeadRecord.also`. */
  same_person: number;
}

export function leadEvidenceFrom(
  contacts: ReadonlyArray<{ direction: "outbound" | "inbound"; outcome: string | null }>,
  samePersonLeads: number,
): LeadEvidence {
  return {
    reached: contacts.filter((c) => c.outcome === "reached").length,
    wrong_number: contacts.filter((c) => c.outcome === "wrong_number").length,
    attempts: contacts.filter((c) => c.direction === "outbound" && (c.outcome === "no_answer" || c.outcome === "voicemail")).length,
    same_person: samePersonLeads,
  };
}

/**
 * Why a reason cannot be used yet, in the words the database would refuse with (0578) — or null when it can.
 * The drawer greys a reason out with this sentence instead of letting the press travel to a 409; the rule is the
 * SAME rule, kept here so a test can hold the two together, and the database still decides.
 */
export function closeReasonUnavailable(reason: LeadCloseReason, e: LeadEvidence): string | null {
  switch (reason) {
    case "not_interested": return e.reached > 0 ? null : "Needs a call with outcome Reached on record — log the call first.";
    case "wrong_number": return e.wrong_number > 0 ? null : "Needs a call with outcome Wrong number on record — log the call first.";
    case "unreachable": return e.attempts >= UNREACHABLE_MIN_ATTEMPTS ? null
      : `Needs ${UNREACHABLE_MIN_ATTEMPTS} outbound attempts with no answer on record; ${e.attempts} recorded.`;
    case "duplicate": return e.same_person > 0 ? null : "Needs another lead of the same person; none shares this phone or e-mail.";
    default: return null;
  }
}

/** `qualify_lead` needs a reached call (RL055). */
export function qualifyUnavailable(e: LeadEvidence): string | null {
  return e.reached > 0 ? null : "Needs a call with outcome Reached on record — log the call first.";
}
