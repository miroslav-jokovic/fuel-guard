import type { SupabaseClient } from "@supabase/supabase-js";
import type { UnitNote, UnitNoteKind } from "@silvicom/shared";
import { displayNameFor } from "../../../lib/memberLabels.js";
import { getUnitNote, type NoteAuthor, type NoteRefusal } from "./unitNotes.js";
import { tokeniseTypedUnits } from "./noteUnits.js";

/**
 * Editing and removing a note, and resolving a unit's chip on the Dispatch Board (UNIT-NOTES-PLAN §9,
 * D-UN15, D-UN16, D-UN18). Each is ONE call to 0596's function, which does the work in one transaction:
 * the old words into `unit_note_versions`, the mentions re-derived, the removal signed.
 *
 * ── WHO MAY ─────────────────────────────────────────────────────────────────────────────────────
 * The author, always; anybody else only with `notes.manage_all` (D-UN19). The route asks the named
 * permission and passes the answer as `any`; the database then refuses a stranger's note when it is
 * false (UN025), so a route that forgot to ask fails closed rather than open. The actor's name is the
 * session's (`displayNameFor`), never the client's, exactly as an author's is on add.
 */

export type NoteChangeRefusal = NoteRefusal | { code: "forbidden"; message: string };

/** 0596's refusals, as answers the routes can turn into a status. */
function refusalOf(code: string | undefined, act: string): NoteChangeRefusal {
  if (code === "UN020") return { code: "not_found", message: "Note not found" };
  if (code === "UN025") return { code: "forbidden", message: `Only the person who wrote this note can ${act} it.` };
  if (code === "UN015") return { code: "invalid_mention", message: "A person mentioned in the note is not in this company." };
  if (code === "UN016") return { code: "invalid_mention", message: "A unit mentioned in the note is not on the roster." };
  return { code: "db_error", message: `Could not ${act} the note` };
}

const actorName = async (admin: SupabaseClient, orgId: string, actor: NoteAuthor) =>
  ((await displayNameFor(admin, actor.userId, orgId, actor.role)) ?? actor.email ?? "An office user").trim().slice(0, 200) || "An office user";

/** What an audit row names: the note's unit and whether its author made the change. Never the words. */
export interface NoteChangeFacts {
  kind: UnitNoteKind;
  subjectId: string;
  byAuthor: boolean;
}

/** New words for a live note. A typed `@848` becomes its token first, as on add (D-UN17). */
export async function editUnitNote(
  admin: SupabaseClient,
  orgId: string,
  actor: NoteAuthor,
  noteId: string,
  body: string,
  any: boolean,
): Promise<{ note: UnitNote; facts: NoteChangeFacts } | NoteChangeRefusal> {
  const words = await tokeniseTypedUnits(admin, orgId, body);
  const { data, error } = await admin.rpc("edit_unit_note", {
    p_org: orgId,
    p_note: noteId,
    p_body: words,
    p_actor: actor.userId,
    p_actor_name: await actorName(admin, orgId, actor),
    p_any: any,
  });
  if (error) return refusalOf((error as { code?: string }).code, "edit");
  const row = (data ?? {}) as { kind?: UnitNoteKind; subject_id?: string; author_id?: string | null };
  const note = await getUnitNote(admin, orgId, noteId);
  if (!note || "code" in note) return { code: "db_error", message: "Could not load the edited note" };
  return { note, facts: { kind: row.kind ?? note.kind, subjectId: row.subject_id ?? note.subjectId, byAuthor: row.author_id === actor.userId } };
}

/** Hide a live note from every list, count, pin and board chip (D-UN16). */
export async function removeUnitNote(
  admin: SupabaseClient,
  orgId: string,
  actor: NoteAuthor,
  noteId: string,
  any: boolean,
): Promise<NoteChangeFacts | NoteChangeRefusal> {
  const { data, error } = await admin.rpc("remove_unit_note", {
    p_org: orgId,
    p_note: noteId,
    p_actor: actor.userId,
    p_actor_name: await actorName(admin, orgId, actor),
    p_any: any,
  });
  if (error) return refusalOf((error as { code?: string }).code, "remove");
  const row = (data ?? {}) as { kind: UnitNoteKind; subject_id: string; author_id: string | null };
  return { kind: row.kind, subjectId: row.subject_id, byAuthor: row.author_id === actor.userId };
}

/** Take one unit's chip for one note off the Dispatch Board, for everybody (D-UN18). Anyone who reads notes may. */
export async function resolveUnitMention(
  admin: SupabaseClient,
  orgId: string,
  actor: NoteAuthor,
  noteId: string,
  kind: UnitNoteKind,
  subjectId: string,
): Promise<true | NoteChangeRefusal> {
  const { error } = await admin.rpc("resolve_unit_note_unit_mention", {
    p_org: orgId,
    p_note: noteId,
    p_kind: kind,
    p_subject: subjectId,
    p_actor: actor.userId,
    p_actor_name: await actorName(admin, orgId, actor),
  });
  if (error) return refusalOf((error as { code?: string }).code, "resolve");
  return true;
}
