import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged, orderApplicantNotes, type ApplicantNote } from "@silvicom/shared";
import { displayNameFor } from "../../lib/memberLabels.js";
import { readLiveInvitation } from "./applicantChecklist.js";

/**
 * The office's notes on an applicant — 0535's only API reader and writer (HIRING-WORKFLOW-AUDIT-2026-10-31
 * §9 P10; the table is §9 P7).
 *
 * ── WHAT A NOTE IS ─────────────────────────────────────────────────────────────────────────────
 * Working papers: "called 10/30, sends the SSN card Monday". Not evidence (0535's header: not in
 * `RETENTION_FORBIDDEN`, removed by the applicant purge), but APPEND-ONLY all the same, because the
 * record of what the office knew, and when, is only worth reading if nobody could have rewritten it.
 * So this file has two writes and they are the only two 0535 allows: an INSERT, and the pin through
 * `set_applicant_note_pinned` (which unpins the applicant's other note — one note at the top).
 *
 * ── THE SERVICE ROLE BYPASSES RLS ─────────────────────────────────────────────────────────────
 * ⚠ 0535 has RLS on and no client policies, so the browser cannot read a note at all and the API reads
 * every one with the service role. Every query below therefore carries its own `.eq("org_id", …)`, and
 * the insert names the org in its row — asserted through `expectOrgScoped` in `routes/notes.test.ts`.
 * 0535's insert trigger refuses a driver of another org (AN012) as a second line, not the first.
 */

const COLS = "id, driver_id, invitation_id, body, author_id, author_name, pinned, created_at";

export interface NoteAuthor {
  userId: string;
  role: string | null;
  email: string | null;
}

export type NoteRefusal = { code: "not_found" | "db_error"; message: string };
export const isNoteRefusal = (v: unknown): v is NoteRefusal =>
  typeof v === "object" && v !== null && "code" in v && "message" in v && !("id" in v);

/** Is this driver one of this org's? A 404 rather than a 403 — another carrier's id reads as no id. */
async function driverInOrg(admin: SupabaseClient, orgId: string, driverId: string): Promise<boolean> {
  const { data } = await admin.from("drivers").select("id").eq("org_id", orgId).eq("id", driverId).maybeSingle();
  return data !== null;
}

/**
 * One applicant's notes, pinned first and then newest first. Paged (`fetchAllPaged`): PostgREST answers
 * at most 1,000 rows, and a list that silently stopped at the thousandth note would read as complete.
 */
export async function listApplicantNotes(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<ApplicantNote[] | NoteRefusal> {
  try {
    const rows = await fetchAllPaged<ApplicantNote>((from, to) =>
      admin
        .from("applicant_notes")
        .select(COLS)
        .eq("org_id", orgId)
        .eq("driver_id", driverId)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: ApplicantNote[] | null; error: { message: string } | null }>,
    );
    return orderApplicantNotes(rows);
  } catch {
    return { code: "db_error", message: "Could not load the notes" };
  }
}

/**
 * Add one note. The author is the SESSION's — by id and by the name the shell shows them under
 * (`displayNameFor`, falling back to their email) — never the client's: a client that could name the
 * author could sign a note as somebody else. The invitation is the applicant's live one, when there is
 * one, so a rehire's notes stay with the application they were written during.
 */
export async function addApplicantNote(
  admin: SupabaseClient,
  orgId: string,
  author: NoteAuthor,
  driverId: string,
  body: string,
): Promise<ApplicantNote | NoteRefusal> {
  if (!(await driverInOrg(admin, orgId, driverId))) return { code: "not_found", message: "Applicant not found" };
  const [invitation, name] = await Promise.all([
    readLiveInvitation(admin, orgId, driverId),
    displayNameFor(admin, author.userId, orgId, author.role),
  ]);
  const { data, error } = await admin
    .from("applicant_notes")
    .insert({
      org_id: orgId,
      driver_id: driverId,
      invitation_id: invitation?.id ?? null,
      body,
      author_id: author.userId,
      // 0535 refuses a blank author; "An office user" is what every other actor fallback in recruiting says.
      author_name: (name ?? author.email ?? "An office user").trim().slice(0, 200) || "An office user",
    })
    .select(COLS)
    .maybeSingle();
  if (error || !data) return { code: "db_error", message: "Could not save the note" };
  return data as ApplicantNote;
}

/**
 * Pin one note to the top (unpinning the applicant's other) or unpin it, through 0535's RPC — the one
 * UPDATE the table's guard lets through. The note must be THIS applicant's in THIS org: the RPC checks
 * the org (AN020), and the read before it checks the applicant, so a note id from one record cannot be
 * pinned from another's page.
 */
export async function pinApplicantNote(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  noteId: string,
  pinned: boolean,
): Promise<{ pinned: boolean } | NoteRefusal> {
  const { data: note } = await admin
    .from("applicant_notes")
    .select("id")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .eq("id", noteId)
    .maybeSingle();
  if (!note) return { code: "not_found", message: "Note not found" };
  const { data, error } = await admin.rpc("set_applicant_note_pinned", { p_org: orgId, p_note: noteId, p_pinned: pinned });
  if (error) {
    return error.code === "AN020"
      ? { code: "not_found", message: "Note not found" }
      : { code: "db_error", message: "Could not pin the note" };
  }
  return { pinned: data === true };
}
