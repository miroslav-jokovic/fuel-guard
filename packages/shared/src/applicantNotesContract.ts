import { z } from "zod";

/**
 * The human layer on an applicant's record — the office's notes (0535) and the activity list derived
 * from what is already on file (HIRING-WORKFLOW-AUDIT-2026-10-31 §8.2, §9 P10).
 *
 * ── NOTES ──────────────────────────────────────────────────────────────────────────────────────
 * 0535's table is append-only: a note is never edited and never deleted, a correction is a new note,
 * and one note at a time may be pinned to the top. So the write surface is exactly two acts — add and
 * pin — and there is no update schema here on purpose: a schema for an edit would be the first half of
 * the endpoint 0535's AN011 refuses.
 *
 * ⚠ The length is the TABLE's (`check (length(btrim(body)) between 1 and 4000)`) and is restated here
 * only so the browser can say so before a round trip; the database stays the authority. The body is
 * trimmed here, before it is measured, for the same reason the CHECK trims it — a note of spaces is no
 * note.
 */

/** 0535's CHECK on `applicant_notes.body`, after trimming. */
export const APPLICANT_NOTE_MAX_LENGTH = 4000;

export const applicantNoteCreateSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write the note first.")
    .max(APPLICANT_NOTE_MAX_LENGTH, `A note can be at most ${APPLICANT_NOTE_MAX_LENGTH} characters.`),
});
export type ApplicantNoteCreate = z.infer<typeof applicantNoteCreateSchema>;

/** Pin (unpinning the applicant's other note, `set_applicant_note_pinned`) or unpin one note. */
export const applicantNotePinSchema = z.object({ pinned: z.boolean() });
export type ApplicantNotePin = z.infer<typeof applicantNotePinSchema>;

/** One note as the API returns it — 0535's row. */
export interface ApplicantNote {
  id: string;
  driver_id: string;
  /** The application it was written during; null for a note about the person between applications. */
  invitation_id: string | null;
  body: string;
  author_id: string | null;
  /** Stamped at the write, so a note outlives its author's account. */
  author_name: string;
  pinned: boolean;
  created_at: string;
}

/** The board's "last note" — when, and who (§9 P10). Null on a row with no notes. */
export interface ApplicantLastNote {
  created_at: string;
  author_name: string;
}

/**
 * Pinned first, then newest first — the one order the record shows. A pure function rather than an
 * `ORDER BY pinned desc, created_at desc` alone so the browser can re-order an optimistic list the same
 * way; the API orders the query identically.
 */
export function orderApplicantNotes<T extends Pick<ApplicantNote, "pinned" | "created_at">>(notes: readonly T[]): T[] {
  return [...notes].sort((a, b) =>
    a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  );
}

// ── ACTIVITY ───────────────────────────────────────────────────────────────────────────────────

/**
 * Everything the activity list can say happened. ⚠ Every kind is DERIVED at read time from a row that
 * already exists for its own reason (an invitation's stamp, a signed permission, a filed record, an
 * outbox row, an edit-log row, a trip, a decision, a note) — nothing here is stored, so the list cannot
 * disagree with the records it summarises (§8.2: "derived from the evidence rows that already exist").
 */
export const APPLICANT_ACTIVITY_KINDS = [
  "invited",
  "part_one_finished",
  "application_sent",
  "application_finished",
  "application_approved",
  "application_signed",
  "invitation_withdrawn",
  "permission_signed",
  "permission_withdrawn",
  "record_filed",
  "psp_ordered",
  "text_out",
  "texts_agreed",
  "texts_stopped",
  "answer_edited",
  "travel_booked",
  "travel_cancelled",
  "decision",
  "note_added",
] as const;
export type ApplicantActivityKind = (typeof APPLICANT_ACTIVITY_KINDS)[number];

/**
 * An office correction to an applicant's answer (`application_edits`, 0337). Carried as the contract
 * PATH rather than as words because the words for a field live with the form that prints them
 * (`fieldLabels.ts`, the applicant's own screen) — a second label table here would drift from the
 * one the applicant reads.
 */
export interface ApplicantActivityEdit {
  path: Array<string | number>;
  /** `filled` a blank, `changed` an answer, `cleared` one; a whole job `added` or `removed`. */
  change: "filled" | "changed" | "cleared" | "added" | "removed";
  /** The job the answer belongs to, by its name on the application — null off the employer list. */
  employer: string | null;
}

export interface ApplicantActivityItem {
  /** The instant it happened — the row's own stamp. */
  at: string;
  kind: ApplicantActivityKind;
  /** What happened, in a sentence without its actor ("Signed the PSP permission"). */
  text: string;
  /** Who did it, when an office user did — their name, else their email. Null for the applicant. */
  actor: string | null;
  /** Only on `answer_edited`. */
  edit?: ApplicantActivityEdit;
}

/** Newest first; a tie keeps the order the reader built it in (a stable sort). */
export function orderApplicantActivity<T extends Pick<ApplicantActivityItem, "at">>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
