import { z } from "zod";
import { isCalendarDay, shiftDay } from "./calendarDay.js";
import { isRecordId, recordId } from "./recordId.js";
import { chatBodyParts } from "./chatContract.js";

/**
 * Notes on a driver, a truck or a trailer — the office's notes on the units it runs
 * (`docs/plans/notes/UNIT-NOTES-PLAN.md`). FROZEN at UN0 (§7.1): the database (UN1), the API
 * (UN2/UN3) and the web (UN5–UN8) are built in separate chats against this file at the same time,
 * so a change here is the orchestrator's own PR and every track rebases on it.
 *
 * ── WHAT THE FILE HOLDS, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────────────────────
 * The write surface was two acts — add and pin — until the owner's v3 rulings of 2026-11-12 (plan §9):
 * an author now edits and removes their own note, a holder of `notes.manage_all` does both for every
 * note (D-UN15, D-UN16, D-UN19), and a note may name a truck, trailer or driver by token, which shows on
 * the Dispatch Board until somebody resolves it (D-UN17, D-UN18). Those schemas are at the end of this
 * file; the frozen-contract rule above still holds — this is the orchestrator's change.
 *
 * The `<@user-id>` mention token is NOT restated here. Chat already keeps the one parser in shared
 * (`chatMentionIds`, `chatBodyParts`, `chatBodyText`, `chatMentionToken` in `chatContract.ts`,
 * D-CHAT22), and a note uses the same token (D-UN8), so every reader of a note's body calls those.
 * §4.2 asked UN0 to move the parser if it were web-only; measured on 2026-11-11, it is not.
 *
 * ⚠ The length is the TABLE's (`check (length(btrim(body)) between 1 and 4000)`, UN1) restated here
 * only so the browser can say so before a round trip; the database stays the authority. The body is
 * trimmed before it is measured for the same reason the CHECK trims: a note of spaces is no note.
 */

// ── the subjects ──────────────────────────────────────────────────────────────────────────────────

/** What a note is about (D-UN1): one table, `subject_kind` + `subject_id`. The order is the board's. */
export const UNIT_NOTE_KINDS = ["vehicle", "driver", "trailer"] as const;
export type UnitNoteKind = (typeof UNIT_NOTE_KINDS)[number];

export const isUnitNoteKind = (v: unknown): v is UnitNoteKind =>
  typeof v === "string" && (UNIT_NOTE_KINDS as readonly string[]).includes(v);

/** The words an office reader sees for a kind, singular — a chip, a filter, a column. */
export const UNIT_NOTE_KIND_LABELS: Record<UnitNoteKind, string> = {
  vehicle: "Truck",
  driver: "Driver",
  trailer: "Trailer",
};

export interface UnitNoteSubject {
  kind: UnitNoteKind;
  id: string;
}

/**
 * The most units one drawer (and one `GET /api/notes?subjects=`) may hold. The Dispatch Board's
 * merged drawer is the largest asker (D-UN12): a truck, both seats of a team (D-LA2) and a trailer is
 * four; eight leaves room for doubles and bounds the query string, which a long id list would
 * otherwise overflow (the Node 22 header limit, measured 2026).
 */
export const UNIT_NOTE_MAX_SUBJECTS = 8;

/**
 * `kind:id,kind:id` — the one spelling of a list of units, in the page URL (`?notes=`, D-UN12) and in
 * the API's `?subjects=`. Lenient on the way in: a malformed, unknown or repeated entry is dropped,
 * never a 400 for a pasted link, and ids are lower-cased as Postgres prints them. More than
 * `UNIT_NOTE_MAX_SUBJECTS` keeps the first that many. Returns `[]` for nothing usable.
 */
export function parseUnitNoteSubjects(raw: string | null | undefined): UnitNoteSubject[] {
  if (!raw) return [];
  const out: UnitNoteSubject[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const [kind, id, ...rest] = part.trim().split(":");
    if (rest.length > 0 || !isUnitNoteKind(kind) || !isRecordId(id)) continue;
    const key = `${kind}:${id!.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, id: id!.toLowerCase() });
    if (out.length === UNIT_NOTE_MAX_SUBJECTS) break;
  }
  return out;
}

export function formatUnitNoteSubjects(subjects: readonly UnitNoteSubject[]): string {
  return subjects.map((s) => `${s.kind}:${s.id.toLowerCase()}`).join(",");
}

/**
 * The drawer's state in the URL (D-UN12): `?notes=<kind>:<id>[,…]&note=<id>`, so the bell and a pasted
 * link open it on the right unit(s) and, with `note`, on that note. `null` = the drawer is closed.
 */
export interface NotesDrawerState {
  subjects: UnitNoteSubject[];
  /** The note to scroll to and mark — a mention's bell entry names it. */
  noteId: string | null;
}

export function parseNotesParam(
  notes: string | null | undefined,
  note?: string | null,
): NotesDrawerState | null {
  const subjects = parseUnitNoteSubjects(notes);
  if (subjects.length === 0) return null;
  return { subjects, noteId: isRecordId(note) ? note!.toLowerCase() : null };
}

/** The two query values for a drawer state; `note` is `undefined` (absent) when no note is named. */
export function formatNotesParam(state: NotesDrawerState): { notes: string; note: string | undefined } {
  return { notes: formatUnitNoteSubjects(state.subjects), note: state.noteId ?? undefined };
}

// ── limits, refresh, wording ──────────────────────────────────────────────────────────────────────

/** UN1's CHECK on `unit_notes.body`, after trimming (D-UN3). */
export const UNIT_NOTE_MAX_LENGTH = 4000;

/** Rows per page; `unit_notes_search` clamps its own `p_limit` to the same number (§4.1). */
export const UNIT_NOTE_PAGE_LIMIT = 50;

/**
 * D-UN10 — live by refresh, not by socket. An open drawer and the Notes page ask "anything after the
 * newest I hold" this often and on window focus; 10 s is chat's own fallback interval.
 */
export const UNIT_NOTE_REFRESH_MS = 10_000;

/** D-UN10 — the Notes column's counts on the four tables refresh this often and with their list. */
export const UNIT_NOTE_SUMMARY_REFRESH_MS = 60_000;

/** Q-UN3 (owner, 2026-11-11): the one line the composer carries, in the owner's words. */
export const UNIT_NOTE_AUDIENCE_LINE = "Visible to the whole office. No medical or test results.";

// ── the write surface: add and pin ────────────────────────────────────────────────────────────────

export const unitNoteCreateSchema = z.object({
  kind: z.enum(UNIT_NOTE_KINDS),
  subjectId: recordId("Choose the unit the note is about."),
  body: z
    .string()
    .trim()
    .min(1, "Write the note first.")
    .max(UNIT_NOTE_MAX_LENGTH, `A note can be at most ${UNIT_NOTE_MAX_LENGTH} characters.`),
});
export type UnitNoteCreate = z.infer<typeof unitNoteCreateSchema>;

/** Pin (unpinning the unit's other note, `set_unit_note_pinned`, D-UN6) or unpin one note. */
export const unitNotePinSchema = z.object({ pinned: z.boolean() });
export type UnitNotePin = z.infer<typeof unitNotePinSchema>;

// ── reading: the list, the search and the wall ────────────────────────────────────────────────────

/**
 * A keyset position: a note's `created_at` and `id`, the order the index holds (§4.1). Spelled
 * `<created_at>~<id>` in a query value; `~` because neither half can contain it, where `,` `:` `+` and
 * `.` all occur in an ISO instant.
 */
export interface UnitNoteCursor {
  at: string;
  id: string;
}

const CURSOR_AT = z.iso.datetime({ offset: true });

export function formatUnitNoteCursor(c: UnitNoteCursor): string {
  return `${c.at}~${c.id.toLowerCase()}`;
}

export function parseUnitNoteCursor(raw: string | null | undefined): UnitNoteCursor | null {
  if (!raw) return null;
  const [at, id, ...rest] = raw.split("~");
  if (rest.length > 0 || !CURSOR_AT.safeParse(at).success || !isRecordId(id)) return null;
  return { at: at!, id: id!.toLowerCase() };
}

const optionalText = z.string().trim().max(200).optional().transform((v) => (v ? v : undefined));
const calendarDay = (what: string) =>
  z
    .string()
    .refine((d) => isCalendarDay(d) && shiftDay(d, 0) === d, `Give the ${what} day as YYYY-MM-DD.`)
    .optional();
const cursor = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === "") return undefined;
    const c = parseUnitNoteCursor(v);
    if (!c) ctx.addIssue({ code: "custom", message: "That page position is not one this list gave." });
    return c ?? undefined;
  });

/**
 * `GET /api/notes` — one query for the drawer, the drawer's search and the Notes page (§4.3, D-UN7,
 * D-UN13). With no `subjects` it is the wall, every note of the carrier. With no `q` it is a plain
 * newest-first list. `from`/`to` are CALENDAR DAYS in the carrier's zone, because `created_at` is a
 * `timestamptz` (`calendarDay.ts`: the column decides what a day is; the API turns them into a
 * half-open interval with `dayRangeInstants`). `before` pages older, `after` asks for newer (the
 * D-UN10 refresh); both at once is refused.
 */
export const unitNoteListQuerySchema = z
  .object({
    subjects: z
      .string()
      .optional()
      .transform((v) => parseUnitNoteSubjects(v)),
    q: optionalText,
    /** The wall's unit-kind filter; ignored when `subjects` names units. */
    kind: z.enum(UNIT_NOTE_KINDS).optional(),
    author: recordId().optional(),
    from: calendarDay("first"),
    to: calendarDay("last"),
    before: cursor,
    after: cursor,
  })
  .refine((q) => !(q.before && q.after), { message: "Ask for older or newer notes, not both.", path: ["after"] })
  .refine((q) => !(q.from && q.to && q.from > q.to), { message: "The first day is after the last.", path: ["to"] });
export type UnitNoteListQuery = z.infer<typeof unitNoteListQuerySchema>;

/** One note as the API returns it — UN1's row, plus the unit's name and the people it mentions. */
export interface UnitNote {
  id: string;
  kind: UnitNoteKind;
  subjectId: string;
  /** What the unit is called where the office reads it: a truck's or trailer's number, a driver's name. */
  subjectLabel: string;
  body: string;
  /** Null once the author's login is gone; `authorName` was stored at writing and stays. */
  authorId: string | null;
  authorName: string;
  pinned: boolean;
  createdAt: string;
  /** The people the body's `<@id>` tokens name, from `unit_note_mentions` (D-UN8). */
  mentions: string[];
  /** When the words last changed (D-UN15); null for a note never edited. */
  editedAt: string | null;
  /** The trucks, trailers and drivers the body's `<#kind:id>` tokens name, with what each is called (D-UN17). */
  units: UnitNoteUnitRef[];
}

/** A row of the list or the search. `fuzzy` = found by the trigram pass, not the word pass (D-UN7). */
export interface UnitNoteSearchHit extends UnitNote {
  fuzzy: boolean;
}

export interface UnitNoteListResponse {
  notes: UnitNoteSearchHit[];
  /** The word search found nothing and these are close matches — "No exact match. Close matches:". */
  fuzzy: boolean;
  /** The `before` value for the next older page; null at the end. */
  next: string | null;
}

export interface UnitNoteCreateResponse {
  note: UnitNote;
}

export interface UnitNotePinResponse {
  pinned: boolean;
}

/**
 * `GET /api/notes/summary?kinds=vehicle,driver` — the Notes column (D-UN12). One jsonb value from
 * `unit_note_summary` (M12: PostgREST caps rows at 1,000 and an id list overflows headers), so a
 * unit with no notes is simply absent.
 */
export interface UnitNoteSubjectSummary {
  count: number;
  lastAt: string;
}
export interface UnitNoteSummary {
  kinds: Partial<Record<UnitNoteKind, Record<string, UnitNoteSubjectSummary>>>;
}

export const unitNoteSummaryQuerySchema = z.object({
  kinds: z
    .string()
    .transform((v) => [...new Set(v.split(",").map((k) => k.trim()))])
    .pipe(z.array(z.enum(UNIT_NOTE_KINDS)).min(1, "Name at least one kind of unit.")),
});
export type UnitNoteSummaryQuery = z.infer<typeof unitNoteSummaryQuerySchema>;

/** `GET /api/notes/people` — the carrier's office members, the `@` list (D-UN8). */
export interface UnitNotePerson {
  id: string;
  name: string;
}
export interface UnitNotePeopleResponse {
  people: UnitNotePerson[];
}

// ── ordering ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The one order a unit's notes are shown in: the pinned note first, then newest, ties by id
 * descending — the index's own `(created_at desc, id)` order, so an optimistic list and the API's
 * page agree on where a new note goes.
 */
export function orderUnitNotes<T extends Pick<UnitNote, "pinned" | "createdAt" | "id">>(notes: readonly T[]): T[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    // By the instant, not the text: an optimistic note carries the browser's `…Z` and the API's carry
    // Postgres's `…+00:00`, which sort wrongly as strings. Postgres keeps microseconds that
    // `Date.parse` drops, so equal milliseconds fall back to the text (same spelling from one source).
    const ms = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (ms !== 0) return ms;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

// ── v3 (plan §9): edit, remove, and the units a note names ─────────────────────────────────────────

/**
 * A unit a note names (D-UN17): its token's kind and id and what the office calls it — a truck's or
 * trailer's number, a driver's name. `label` is null for a token whose unit the carrier no longer has
 * (a merged-away driver keeps its token in the author's words), which reads "a driver".
 */
export interface UnitNoteUnitRef {
  kind: UnitNoteKind;
  id: string;
  label: string | null;
}

/**
 * `<#vehicle:id>` · `<#trailer:id>` · `<#driver:id>` — the people token's shape (`<@id>`, D-CHAT22) with
 * its kind, so a renumbered truck or a married name never breaks the link. 0596's
 * `unit_note_unit_tokens` reads exactly this shape.
 */
const UNIT_TOKEN_SHAPE = /<#(vehicle|trailer|driver):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;

export const unitNoteUnitToken = (kind: UnitNoteKind, id: string): string => `<#${kind}:${id.toLowerCase()}>`;

/** The units a body names, each once, in the order they first appear. */
export function unitNoteUnitTokens(body: string | null | undefined): UnitNoteSubject[] {
  const out: UnitNoteSubject[] = [];
  for (const m of (body ?? "").matchAll(UNIT_TOKEN_SHAPE)) {
    const kind = m[1]!.toLowerCase() as UnitNoteKind;
    const id = m[2]!.toLowerCase();
    if (!out.some((u) => u.kind === kind && u.id === id)) out.push({ kind, id });
  }
  return out;
}

export type UnitNoteBodyPart = { text: string } | { mention: string } | { unit: UnitNoteSubject };

/** A note's body cut into words, people (`<@id>`, chat's own parser) and units (`<#kind:id>`). */
export function unitNoteBodyParts(body: string): UnitNoteBodyPart[] {
  const parts: UnitNoteBodyPart[] = [];
  let at = 0;
  const words = (text: string) => parts.push(...chatBodyParts(text));
  for (const m of body.matchAll(UNIT_TOKEN_SHAPE)) {
    if (m.index > at) words(body.slice(at, m.index));
    parts.push({ unit: { kind: m[1]!.toLowerCase() as UnitNoteKind, id: m[2]!.toLowerCase() } });
    at = m.index + m[0].length;
  }
  if (at < body.length) words(body.slice(at));
  return parts;
}

/**
 * How a named unit reads in a line of text: `@848`, `@5310`, `@Marcus Hill` — what the writer typed.
 * A unit nobody can name any more reads as its kind ("@a driver"), never as its id.
 */
export function unitNoteUnitText(unit: UnitNoteSubject, label: string | null | undefined): string {
  const name = label?.trim();
  return name ? `@${name}` : `@a ${UNIT_NOTE_KIND_LABELS[unit.kind].toLowerCase()}`;
}

/** A body as one line of plain text (the bell's preview, the board chip's tooltip): units by `unitNoteUnitText`. */
export function unitNoteBodyText(
  body: string,
  personOf: (userId: string) => string | null | undefined,
  unitOf: (unit: UnitNoteSubject) => string | null | undefined,
): string {
  return unitNoteBodyParts(body)
    .map((p) => ("text" in p ? p.text : "mention" in p ? `@${personOf(p.mention)?.trim() || "someone"}` : unitNoteUnitText(p.unit, unitOf(p.unit))))
    .join("");
}

/** `PATCH /api/notes/:id` — new words for a live note (D-UN15). The body rules are the add's. */
export const unitNoteEditSchema = unitNoteCreateSchema.pick({ body: true });
export type UnitNoteEdit = z.infer<typeof unitNoteEditSchema>;

export interface UnitNoteEditResponse {
  note: UnitNote;
}

/** `POST /api/notes/:id/units/resolve` — take one unit's chip for this note off the Dispatch Board (D-UN18). */
export const unitNoteResolveSchema = z.object({
  kind: z.enum(UNIT_NOTE_KINDS),
  subjectId: recordId("Choose the unit."),
});
export type UnitNoteResolve = z.infer<typeof unitNoteResolveSchema>;

/**
 * `GET /api/notes/units?q=848` — the `@` list's trucks, trailers and drivers (D-UN17): units whose number
 * starts with the words, drivers whose name has a word that does. Applicants are never offered (UN016).
 */
export const unitNoteUnitsQuerySchema = z.object({ q: z.string().trim().min(1).max(40) });
export const UNIT_NOTE_UNITS_LIMIT = 8;
export interface UnitNoteUnitsResponse {
  units: UnitNoteUnitRef[];
}
