import { computed, reactive } from "vue";
import { useRoute, useRouter, type LocationQuery } from "vue-router";
import { formatNotesParam, parseNotesParam, type UnitNoteSubject } from "@silvicom/shared";

/**
 * The notes drawer's state is the URL (D-UN12): `?notes=<kind>:<id>[,…]&note=<id>`, spelled only by
 * the contract's `parseNotesParam` / `formatNotesParam`. So the bell (UN7), a pasted link and Back all
 * open the same drawer, and a page mounts ONE `NotesDrawer` that answers to this rather than one per row.
 *
 * Opening PUSHES (Back closes the drawer, as a reader expects of something that slid in); closing
 * REPLACES, so closing does not leave a history entry that reopens it.
 */
export interface NotesTarget extends UnitNoteSubject {
  /** What the unit is called — the drawer's title before any note has named it. */
  label?: string;
}

/**
 * The names the opener knew, by `kind:id`. A pasted link carries no name; the drawer then reads it off
 * the unit's notes (`subjectLabel`), and with none says what kind of unit it is.
 */
const labels = reactive(new Map<string, string>());
const keyOf = (s: UnitNoteSubject) => `${s.kind}:${s.id.toLowerCase()}`;

const first = (v: LocationQuery[string] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export function useNotesDrawer() {
  const route = useRoute();
  const router = useRouter();

  const state = computed(() => parseNotesParam(first(route.query.notes), first(route.query.note)));

  function open(targets: NotesTarget[], noteId: string | null = null): void {
    for (const t of targets) if (t.label) labels.set(keyOf(t), t.label);
    const { notes, note } = formatNotesParam({ subjects: targets.map(({ kind, id }) => ({ kind, id })), noteId });
    void router.push({ query: { ...route.query, notes, note } });
  }

  function close(): void {
    const { notes: _n, note: _o, ...rest } = route.query;
    void router.replace({ query: rest });
  }

  /** The opener's name for a unit, else the one its notes carry; null when neither has one yet. */
  function labelOf(s: UnitNoteSubject, fromNotes?: string | null): string | null {
    return labels.get(keyOf(s)) ?? fromNotes ?? null;
  }

  return { state, open, close, labelOf };
}
