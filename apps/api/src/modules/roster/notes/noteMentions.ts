import type { SupabaseClient } from "@supabase/supabase-js";
import { UNIT_NOTE_KIND_LABELS, chatBodyText, type UnitNote, type UnitNotePerson } from "@silvicom/shared";
import { labelOf, memberLabels } from "../../../lib/memberLabels.js";
import { notify } from "../../messaging/index.js";

/**
 * Mentions in unit notes (UNIT-NOTES-PLAN D-UN8, step UN3): the `@` list, and the bell a mention rings.
 *
 * ── WHO CAN BE NAMED ────────────────────────────────────────────────────────────────────────────
 * Every OFFICE member of the carrier, because every one of them can read notes (D-UN4). A login whose
 * role is `driver` cannot, and neither can a suspended member (Q-SET12). The list answers exactly
 * the people 0590's insert guard accepts (`role <> 'driver' and suspended_at is null`, UN015), so a
 * name picked from it is never refused on save.
 *
 * ── THE BELL ────────────────────────────────────────────────────────────────────────────────────
 * Through messaging's `notify()`, never a row of our own: `emit_notification` applies the carrier's
 * module entitlement, the person's mutes and quiet hours, and the dedupe key. The key is the NOTE, so
 * however often the ring is retried for one note a person hears it once; a second note naming them
 * rings again, which is what a second note is.
 *
 * The author is never told about their own note (D-UN8, and Fleetio's behaviour, plan §2). A person
 * named twice in one note is told once: `mentions` is already a set (`chatMentionIds` dedupes, and
 * 0590 keys `unit_note_mentions` on (note, person)), so nothing here dedupes it again.
 *
 * The entity is the NOTE (`entity_type: "unit_note"`, `entity_id`: its id), not the unit. The note's
 * id is the one fact that never changes: a driver merge moves a note to the surviving driver (0590's
 * guard, `DRIVER_REASSIGNMENTS`), and a bell that named the unit would then open a driver who no longer
 * exists. The web turns the id into the drawer through `GET /api/notes/:id` (UN7's).
 *
 * ⚠ A ring never fails the note. The note is saved and audited before this runs, `notify()` already
 * logs and swallows its own failure, and the name lookup below fails open to "someone". Telling
 * somebody is worth less than keeping what was written.
 */

interface DirectoryRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  suspended_at: string | null;
}

/** A body's mention preview length: chat's (Q-CHAT18 (a)), so the two bells read alike. */
const PREVIEW_MAX = 80;

/**
 * `GET /api/notes/people`, the `@` list, sorted by name. `org_member_directory` (0393) answers one
 * carrier's members in one round trip and is handed the session's org; a failed read is an error, not
 * an empty list, because an empty `@` list reads as "nobody can be named".
 */
export async function listNotePeople(admin: SupabaseClient, orgId: string): Promise<UnitNotePerson[] | null> {
  const { data, error } = await admin.rpc("org_member_directory", { p_org_id: orgId });
  if (error) return null;
  return ((data ?? []) as DirectoryRow[])
    .filter((m) => m.role !== "driver" && !m.suspended_at)
    .map((m) => ({ id: m.user_id, name: (m.full_name ?? m.email ?? "").trim() || "An office user" }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * Ring every person the note names, except its author. Returns how many bells rang, deduped or muted
 * ones not counted (`notify()` answers null for those).
 */
export async function ringNoteMentions(admin: SupabaseClient, orgId: string, authorId: string, note: UnitNote): Promise<number> {
  const targets = note.mentions.filter((id) => id !== authorId);
  if (targets.length === 0) return 0;
  let names = new Map<string, string>();
  try {
    const labels = await memberLabels(admin, orgId, note.mentions);
    names = new Map([...labels].flatMap(([id, l]) => (labelOf(l) ? [[id, labelOf(l)!]] : [])));
  } catch {
    // Fail open: an unnamed token reads "@someone" (`chatBodyText`), and the bell still rings.
  }
  const text = chatBodyText(note.body, (id) => names.get(id)).replace(/\s+/g, " ").trim();
  const preview = text.length <= PREVIEW_MAX ? text : `${text.slice(0, PREVIEW_MAX - 1)}…`;
  const unit = `${UNIT_NOTE_KIND_LABELS[note.kind]} ${note.subjectLabel}`.trim();

  let rang = 0;
  for (const userId of targets) {
    const id = await notify(admin, {
      orgId,
      userId,
      category: "unit_note_mention",
      title: `${note.authorName} mentioned you on ${unit}`,
      body: preview,
      entityType: "unit_note",
      entityId: note.id,
      dedupeKey: `unit_note_mention:${note.id}`,
    });
    if (id) rang += 1;
  }
  return rang;
}
