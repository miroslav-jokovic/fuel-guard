import type { SupabaseClient } from "@supabase/supabase-js";
import {
  UNIT_NOTE_UNITS_LIMIT,
  unitNoteUnitToken,
  unitNoteUnitTokens,
  type DispatchBoardNoteMention,
  type UnitNoteKind,
  type UnitNoteSubject,
  type UnitNoteUnitRef,
} from "@silvicom/shared";

/**
 * The trucks, trailers and drivers a note NAMES (UNIT-NOTES-PLAN §9, D-UN17/D-UN18): the `@` list's
 * units, a typed `@848` turned into its token, the labels a fresh note's units read under, and the
 * Dispatch Board's open mentions.
 *
 * ⚠ The service role bypasses RLS: every query here carries `.eq("org_id", …)` and every RPC is handed
 * the session's org — `routes.test.ts` asserts it with `expectOrgScoped`. 0596's guard (UN016) is the
 * second line: a token naming another carrier's unit never reaches the table.
 */

/** `%` and `_` are ilike's own; a typed "84_" must find "84_", not "840". */
const likeSafe = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * `GET /api/notes/units?q=` — trucks and trailers whose number starts with the words, drivers with a word
 * of the name that does. Trucks first (the board is a list of trucks), then trailers, then drivers, each
 * in number or name order; applicants are never offered (0596's UN016 would refuse them).
 */
export async function listNoteUnits(admin: SupabaseClient, orgId: string, q: string): Promise<UnitNoteUnitRef[] | null> {
  const prefix = `${likeSafe(q.trim())}%`;
  // The name search goes into PostgREST's `or=(…)` grammar, where `,` `(` `)` `.` and `"` are syntax:
  // only the characters a name is made of may reach it.
  const word = likeSafe(q.trim().replace(/[^\p{L}\p{N}' -]/gu, "").trim());
  const [trucks, trailers, drivers] = await Promise.all([
    admin.from("vehicles").select("id, unit_number").eq("org_id", orgId).ilike("unit_number", prefix).order("unit_number").limit(UNIT_NOTE_UNITS_LIMIT),
    admin.from("trailers").select("id, unit_number").eq("org_id", orgId).ilike("unit_number", prefix).order("unit_number").limit(UNIT_NOTE_UNITS_LIMIT),
    word
      ? admin
          .from("drivers")
          .select("id, full_name")
          .eq("org_id", orgId)
          .neq("status", "applicant")
          .or(`full_name.ilike.${word}%,full_name.ilike.% ${word}%`)
          .order("full_name")
          .limit(UNIT_NOTE_UNITS_LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (trucks.error || trailers.error || drivers.error) return null;
  const units: UnitNoteUnitRef[] = [
    ...((trucks.data ?? []) as { id: string; unit_number: string }[]).map((r) => ({ kind: "vehicle" as const, id: r.id, label: r.unit_number })),
    ...((trailers.data ?? []) as { id: string; unit_number: string }[]).map((r) => ({ kind: "trailer" as const, id: r.id, label: r.unit_number })),
    ...((drivers.data ?? []) as { id: string; full_name: string }[]).map((r) => ({ kind: "driver" as const, id: r.id, label: r.full_name })),
  ];
  return units.slice(0, UNIT_NOTE_UNITS_LIMIT);
}

/**
 * A typed `@848` (D-UN17): the writer did not pick from the list, but the words name exactly one truck or
 * trailer of this carrier by its number — so it becomes that unit's token, as the owner's own example
 * reads ("When truck is mentioned in note for example @848"). A number that names both a truck and a
 * trailer, or two units, or none, is left as the words it is: guessing which 848 would put a chip on the
 * wrong row. Drivers are not matched from typed text — a name is neither unique nor one word.
 *
 * Only after a space or the start, so an email address and a `<@id>` token are never read as one.
 */
const TYPED_UNIT = /(^|\s)@([A-Za-z0-9][A-Za-z0-9-]{0,29})(?=$|[\s.,;:!?)])/g;

export async function tokeniseTypedUnits(admin: SupabaseClient, orgId: string, body: string): Promise<string> {
  const typed = [...new Set([...body.matchAll(TYPED_UNIT)].map((m) => m[2]!))].slice(0, 10);
  if (typed.length === 0) return body;
  const [trucks, trailers] = await Promise.all([
    admin.from("vehicles").select("id, unit_number").eq("org_id", orgId).in("unit_number", typed),
    admin.from("trailers").select("id, unit_number").eq("org_id", orgId).in("unit_number", typed),
  ]);
  // A failed read leaves the words as typed: the note is worth more than its chip.
  if (trucks.error || trailers.error) return body;
  const found = new Map<string, UnitNoteSubject[]>();
  for (const [kind, rows] of [["vehicle", trucks.data], ["trailer", trailers.data]] as const) {
    for (const r of (rows ?? []) as { id: string; unit_number: string }[]) {
      found.set(r.unit_number, [...(found.get(r.unit_number) ?? []), { kind, id: r.id }]);
    }
  }
  return body.replace(TYPED_UNIT, (whole, lead: string, number: string) => {
    const units = found.get(number);
    return units?.length === 1 ? `${lead}${unitNoteUnitToken(units[0]!.kind, units[0]!.id)}` : whole;
  });
}

/**
 * What each unit a body names is called, for a note the search function did not return (a fresh insert,
 * an edit, a bell's one note). A handful of ids at most, one read per kind; a unit that has gone reads
 * `label: null` ("a driver").
 */
export async function labelBodyUnits(admin: SupabaseClient, orgId: string, body: string): Promise<UnitNoteUnitRef[]> {
  const units = unitNoteUnitTokens(body);
  if (units.length === 0) return [];
  const ids = (kind: UnitNoteKind) => units.filter((u) => u.kind === kind).map((u) => u.id);
  const none = Promise.resolve({ data: [] as Record<string, string>[], error: null });
  const [v, t, d] = await Promise.all([
    ids("vehicle").length ? admin.from("vehicles").select("id, unit_number").eq("org_id", orgId).in("id", ids("vehicle")) : none,
    ids("trailer").length ? admin.from("trailers").select("id, unit_number").eq("org_id", orgId).in("id", ids("trailer")) : none,
    ids("driver").length ? admin.from("drivers").select("id, full_name").eq("org_id", orgId).in("id", ids("driver")) : none,
  ]);
  const label = new Map<string, string>();
  for (const r of (v.data ?? []) as Record<string, string>[]) label.set(`vehicle:${r.id}`, r.unit_number!);
  for (const r of (t.data ?? []) as Record<string, string>[]) label.set(`trailer:${r.id}`, r.unit_number!);
  for (const r of (d.data ?? []) as Record<string, string>[]) label.set(`driver:${r.id}`, r.full_name!);
  return units.map((u) => ({ ...u, label: label.get(`${u.kind}:${u.id}`) ?? null }));
}

interface OpenMentionRow {
  note_id: string;
  at: string;
  author_name: string;
  note_kind: UnitNoteKind;
  note_subject_id: string;
  note_label: string | null;
}

/** The board's open mentions, keyed `kind:subjectId` → newest first. */
export type OpenUnitMentions = Map<string, DispatchBoardNoteMention[]>;

/**
 * Every open mention of the carrier, for the Dispatch Board (D-UN18): ONE jsonb value from 0596's
 * `unit_note_open_unit_mentions` (M12), resolved mentions and removed notes already absent, five per unit.
 * A failed read is an empty map — the board without its note chips, never a board that fails to load.
 */
export async function readOpenUnitMentions(admin: SupabaseClient, orgId: string): Promise<OpenUnitMentions> {
  const out: OpenUnitMentions = new Map();
  const { data, error } = await admin.rpc("unit_note_open_unit_mentions", { p_org: orgId });
  if (error || !data || typeof data !== "object") return out;
  for (const [kind, units] of Object.entries(data as Record<string, Record<string, OpenMentionRow[]>>)) {
    if (kind !== "vehicle" && kind !== "driver" && kind !== "trailer") continue;
    for (const [subjectId, rows] of Object.entries(units ?? {})) {
      out.set(
        `${kind}:${subjectId}`,
        (rows ?? []).map((r) => ({
          noteId: r.note_id,
          kind,
          subjectId,
          at: r.at,
          authorName: r.author_name,
          noteKind: r.note_kind,
          noteSubjectId: r.note_subject_id,
          noteLabel: r.note_label ?? null,
        })),
      );
    }
  }
  return out;
}
