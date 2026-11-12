import type { SupabaseClient } from "@supabase/supabase-js";
import {
  UNIT_NOTE_PAGE_LIMIT,
  chatMentionIds,
  dayRangeInstants,
  formatUnitNoteCursor,
  isUnitNoteKind,
  organizationTimezone,
  type UnitNote,
  type UnitNoteKind,
  type UnitNoteListQuery,
  type UnitNoteListResponse,
  type UnitNoteSearchHit,
  type UnitNoteSummary,
  type UnitNoteSubjectSummary,
} from "@silvicom/shared";
import { displayNameFor } from "../../../lib/memberLabels.js";

/**
 * The office's notes on a driver, a truck or a trailer — `unit_notes`' only API reader and writer
 * (`docs/plans/notes/UNIT-NOTES-PLAN.md` §4.3, step UN2). Roster owns the table because the three
 * subjects are roster's (D-UN2).
 *
 * ── WHAT A NOTE IS ─────────────────────────────────────────────────────────────────────────────
 * Permanent and signed (D-UN3): two writes exist and they are the only two UN1's guard lets through —
 * an INSERT, and the pin through `set_unit_note_pinned` (which unpins the unit's other note, D-UN6).
 * There is no edit and no removal on purpose (D-UN5, owner 2026-11-11: "we will see how it works and
 * add it later"); a wrong note is answered by a new note.
 *
 * ── THE SERVICE ROLE BYPASSES RLS ─────────────────────────────────────────────────────────────
 * ⚠ UN1's table has RLS on and no client policies, so the browser cannot read a note at all and every
 * read here is the service role's. Every table query therefore carries its own `.eq("org_id", …)`, the
 * insert names the org in its row, and every RPC is handed the session's org as `p_org` — asserted
 * through `expectOrgScoped` and the recorded RPC arguments in `routes.test.ts`. UN1's insert guard
 * (subject exists in this org, in the table the kind names) is the second line, not the first.
 *
 * ── WHY THE LISTS ARE RPCs ────────────────────────────────────────────────────────────────────
 * PostgREST caps every response at 1,000 rows and a long `.in()` id list overflows Node 22's header
 * limit (plan M12). The Notes column's counts therefore come back as ONE jsonb value
 * (`unit_note_summary`), and the list, the search and the wall are one keyset-paged function
 * (`unit_notes_search`, clamped to `UNIT_NOTE_PAGE_LIMIT` rows) — never a row read by an id list.
 */

export interface NoteAuthor {
  userId: string;
  role: string | null;
  email: string | null;
}

export type NoteRefusal = {
  code: "not_found" | "invalid_mention" | "db_error";
  message: string;
};
export const isNoteRefusal = (v: unknown): v is NoteRefusal =>
  typeof v === "object" && v !== null && "code" in v && "message" in v && !("id" in v) && !("notes" in v);

/**
 * What the office calls each kind of unit: a truck's or trailer's unit number, a driver's name. These
 * are the same columns UN1's `unit_notes_search` reads for `subject_label`. The API reads them itself
 * only for a single add, because §4.1 has no one-note read, and the route test pins both.
 */
const SUBJECT_LABEL: Record<UnitNoteKind, string> = {
  vehicle: "unit_number",
  driver: "full_name",
  trailer: "unit_number",
};

/** One row of `unit_notes_search` (UN1, §4.1): the note, the unit's label, and which pass found it. */
interface SearchRow {
  id: string;
  subject_kind: string;
  subject_id: string;
  subject_label: string | null;
  body: string;
  author_id: string | null;
  author_name: string;
  pinned: boolean;
  created_at: string;
  /** From `unit_note_mentions` (0592's search returns it; the insert's own select does not). */
  mentions?: string[] | null;
  fuzzy?: boolean | null;
}

/**
 * The people a note mentions: `unit_note_mentions` as 0592's search returns it. A freshly inserted row
 * has no such column, so for it the body's `<@id>` tokens are read with chat's one parser (D-CHAT22,
 * `chatMentionIds`), which is exactly what 0592's insert trigger indexes. A token naming a non-member
 * never reaches the table (UN015), so the two answers are the same set.
 */
function toNote(row: SearchRow, labelOverride?: string): UnitNote {
  return {
    id: row.id,
    kind: row.subject_kind as UnitNoteKind,
    subjectId: row.subject_id,
    subjectLabel: labelOverride ?? row.subject_label ?? "",
    body: row.body,
    authorId: row.author_id,
    authorName: row.author_name,
    pinned: row.pinned === true,
    createdAt: row.created_at,
    mentions: Array.isArray(row.mentions) ? row.mentions : chatMentionIds(row.body),
  };
}

/** The carrier's zone, for turning picked calendar days into instants (`calendarDay.ts`). */
async function orgZone(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
  return organizationTimezone((data as { operating_hours?: object | null } | null)?.operating_hours);
}

/**
 * `GET /api/notes` — a unit's notes (or several units', the board's merged drawer), the drawer's search
 * and the Notes page's wall, all one function (D-UN7, D-UN13). `from`/`to` are calendar days in the
 * carrier's zone and become the half-open instant interval `created_at` needs (`dayRangeInstants`):
 * `p_from` inclusive, `p_to` exclusive.
 *
 * `next` is offered only on an older-or-first page that came back full. A refresh (`after`, D-UN10)
 * answers every newer note it is given and offers no `next`: the client already holds what is older.
 */
export async function listUnitNotes(
  admin: SupabaseClient,
  orgId: string,
  q: UnitNoteListQuery,
): Promise<UnitNoteListResponse | NoteRefusal> {
  try {
    let from: string | null = null;
    let to: string | null = null;
    if (q.from || q.to) {
      const zone = await orgZone(admin, orgId);
      if (q.from) from = dayRangeInstants(q.from, q.from, zone).start;
      if (q.to) to = dayRangeInstants(q.to, q.to, zone).endExclusive;
    }
    const named = q.subjects.length > 0;
    const { data, error } = await admin.rpc("unit_notes_search", {
      p_org: orgId,
      // The wall's kind filter; a drawer names its units and the kind is theirs (contract: "ignored").
      p_kinds: named ? null : q.kind ? [q.kind] : null,
      p_subjects: named ? q.subjects.map((s) => ({ kind: s.kind, id: s.id })) : null,
      p_q: q.q ?? null,
      p_author: q.author ?? null,
      p_from: from,
      p_to: to,
      p_before_at: q.before?.at ?? null,
      p_before_id: q.before?.id ?? null,
      p_after_at: q.after?.at ?? null,
      p_after_id: q.after?.id ?? null,
      p_limit: UNIT_NOTE_PAGE_LIMIT,
    });
    if (error) return { code: "db_error", message: "Could not load the notes" };
    const rows = ((data ?? []) as SearchRow[]).filter((r) => isUnitNoteKind(r.subject_kind));
    const notes: UnitNoteSearchHit[] = rows.map((r) => ({ ...toNote(r), fuzzy: r.fuzzy === true }));
    const last = rows[rows.length - 1];
    return {
      notes,
      // The trigram pass runs only when the word pass found nothing (D-UN7), so a page is all one or the other.
      fuzzy: notes.length > 0 && notes.every((n) => n.fuzzy),
      next: !q.after && last && rows.length >= UNIT_NOTE_PAGE_LIMIT ? formatUnitNoteCursor({ at: last.created_at, id: last.id }) : null,
    };
  } catch {
    return { code: "db_error", message: "Could not load the notes" };
  }
}

/**
 * `GET /api/notes/summary` — the Notes column's count and latest-note age per unit (D-UN12), as the
 * one jsonb value `unit_note_summary` answers (`{ kind: { subject_id: { count, last_at } } }`). A unit
 * with no notes is absent; a kind nobody asked for is never sent.
 */
export async function summariseUnitNotes(
  admin: SupabaseClient,
  orgId: string,
  kinds: UnitNoteKind[],
): Promise<UnitNoteSummary | NoteRefusal> {
  const { data, error } = await admin.rpc("unit_note_summary", { p_org: orgId, p_kinds: kinds });
  if (error) return { code: "db_error", message: "Could not count the notes" };
  const raw = (data ?? {}) as Record<string, Record<string, { count?: number; last_at?: string }> | null>;
  const out: UnitNoteSummary = { kinds: {} };
  for (const kind of kinds) {
    const units: Record<string, UnitNoteSubjectSummary> = {};
    for (const [id, s] of Object.entries(raw[kind] ?? {})) {
      if (s && typeof s.count === "number" && typeof s.last_at === "string") units[id] = { count: s.count, lastAt: s.last_at };
    }
    out.kinds[kind] = units;
  }
  return out;
}

/**
 * Is this unit one of this carrier's, and what is it called? A 404 rather than a 403 for another
 * carrier's id — it reads as no id, the applicant-notes rule (`applicantNotes.ts`).
 */
async function subjectLabel(admin: SupabaseClient, orgId: string, kind: UnitNoteKind, id: string): Promise<string | null> {
  // One literal `.from()` per kind, not `.from(table)`: `lint:boundaries`' table-access check cannot see a
  // table named by an expression, and every table gate reads these call sites.
  const read =
    kind === "driver"
      ? admin.from("drivers").select("id, full_name").eq("org_id", orgId).eq("id", id).maybeSingle()
      : kind === "vehicle"
        ? admin.from("vehicles").select("id, unit_number").eq("org_id", orgId).eq("id", id).maybeSingle()
        : admin.from("trailers").select("id, unit_number").eq("org_id", orgId).eq("id", id).maybeSingle();
  const { data } = await read;
  if (!data) return null;
  return String((data as unknown as Record<string, unknown>)[SUBJECT_LABEL[kind]] ?? "");
}

/**
 * 0592's refusals, as answers. UN012: no such unit in this carrier (the read above already said so;
 * this is the race where it went between the two); UN013: a driver still an applicant, whose notes
 * stay on the applicant record (D-UN11); UN015: a `<@id>` names somebody who is not an office member
 * of this carrier.
 */
function refusalOf(code: string | undefined): NoteRefusal {
  if (code === "UN012" || code === "UN013") return { code: "not_found", message: "That unit is not on the roster." };
  if (code === "UN015") return { code: "invalid_mention", message: "A person mentioned in the note is not in this company." };
  return { code: "db_error", message: "Could not save the note" };
}

/**
 * Add one note. The author is the SESSION's — by id and by the name the shell shows them under
 * (`displayNameFor`, else their email) — never the client's: a client that could name the author could
 * sign a note as somebody else (D-UN3: "permanent and signed").
 */
export async function addUnitNote(
  admin: SupabaseClient,
  orgId: string,
  author: NoteAuthor,
  kind: UnitNoteKind,
  subjectId: string,
  body: string,
): Promise<UnitNote | NoteRefusal> {
  const label = await subjectLabel(admin, orgId, kind, subjectId);
  if (label === null) return { code: "not_found", message: "That unit is not on the roster." };
  const name = await displayNameFor(admin, author.userId, orgId, author.role);
  const { data, error } = await admin
    .from("unit_notes")
    .insert({
      org_id: orgId,
      subject_kind: kind,
      subject_id: subjectId,
      body,
      author_id: author.userId,
      // UN1 refuses a blank author; "An office user" is what every other actor fallback says.
      author_name: (name ?? author.email ?? "An office user").trim().slice(0, 200) || "An office user",
    })
    .select("id, subject_kind, subject_id, body, author_id, author_name, pinned, created_at")
    .maybeSingle();
  if (error) return refusalOf((error as { code?: string }).code);
  if (!data) return { code: "db_error", message: "Could not save the note" };
  return toNote(data as SearchRow, label);
}

/**
 * One note, by its id: what the bell's entity resolves to (UN3, see `noteMentions.ts`). The web needs
 * the note's unit to open the drawer on it (`?notes=<kind>:<id>&note=<id>`, D-UN12), and the note's id is
 * all a notification row can carry. Another carrier's id, or no such note, is `null` → 404.
 */
export async function getUnitNote(admin: SupabaseClient, orgId: string, noteId: string): Promise<UnitNote | null | NoteRefusal> {
  const { data, error } = await admin
    .from("unit_notes")
    .select("id, subject_kind, subject_id, body, author_id, author_name, pinned, created_at")
    .eq("org_id", orgId)
    .eq("id", noteId)
    .maybeSingle();
  if (error) return { code: "db_error", message: "Could not load the note" };
  const row = data as SearchRow | null;
  if (!row || !isUnitNoteKind(row.subject_kind)) return null;
  const label = await subjectLabel(admin, orgId, row.subject_kind, row.subject_id);
  return toNote(row, label ?? "");
}

/**
 * Pin one note above the unit's list (unpinning its other, D-UN6) or unpin it, through UN1's RPC — the
 * one UPDATE the table's guard lets through besides the driver merge. The read first answers "is this
 * note this carrier's", so a note id from elsewhere is a 404 and the RPC is never asked.
 */
export async function pinUnitNote(
  admin: SupabaseClient,
  orgId: string,
  noteId: string,
  pinned: boolean,
): Promise<{ pinned: boolean; kind: UnitNoteKind; subjectId: string } | NoteRefusal> {
  const { data: note } = await admin
    .from("unit_notes")
    .select("id, subject_kind, subject_id")
    .eq("org_id", orgId)
    .eq("id", noteId)
    .maybeSingle();
  if (!note) return { code: "not_found", message: "Note not found" };
  const { data, error } = await admin.rpc("set_unit_note_pinned", { p_org: orgId, p_note: noteId, p_pinned: pinned });
  if (error) {
    // UN020: 0592's own "not this carrier's note" — the read above answers first; this is the second line.
    return (error as { code?: string }).code === "UN020"
      ? { code: "not_found", message: "Note not found" }
      : { code: "db_error", message: "Could not pin the note" };
  }
  const row = note as { subject_kind: UnitNoteKind; subject_id: string };
  return { pinned: data === true, kind: row.subject_kind, subjectId: row.subject_id };
}
