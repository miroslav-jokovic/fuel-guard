import { computed, reactive, watch, type Ref } from "vue";
import { useRoute, useRouter, type LocationQuery } from "vue-router";
import { formatNotesParam, isRecordId, parseNotesParam, type UnitNoteCreateResponse, type UnitNoteSubject } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/stores/toast";

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

/**
 * A link that names only the note — `?note=<id>`, no `notes` — becomes the drawer's full address.
 *
 * B3, ruled (a) by the orchestrator 2026-11-12 (`progress/2026-11-12-1230-E-UN7.md`): a mention's
 * bell entry carries the NOTE as its entity (UN3 rings with `entity_type: "unit_note"`, because the
 * note id is the one id a driver merge never changes), but the drawer's address also needs the unit
 * (`?notes=<kind>:<subjectId>&note=<noteId>`, D-UN12), and `notificationRoute` is synchronous and
 * sees only the notification row. So the bell goes to `/notes?note=<id>`, and the page that lands
 * there asks `GET /api/notes/:id` once and REPLACES the URL: Back then leaves the page instead of
 * returning to an address that would resolve again. A pasted note-only link opens the same way.
 *
 * A note the API will not give — another carrier's, or no such note (both 404, by design: the route
 * says neither which) — is closed quietly: `note` leaves the URL and the reader is on the wall. Any
 * other failure closes the same way and says it could not open the note, because there a retry can
 * help. The answer is used only if the URL still asks for that note, so a reader who moved on while
 * it was in flight is not dragged back.
 *
 * `enabled` is the viewer's `notes` surface (`useNotesAccess`): somebody without it asks nothing.
 */
export function useNoteOnlyLink(enabled: Ref<boolean>): void {
  const route = useRoute();
  const router = useRouter();
  const toast = useToastStore();
  const pending = () => {
    const note = first(route.query.note);
    return note && !first(route.query.notes) ? note : null;
  };

  watch(
    [pending, enabled],
    async ([note, on]) => {
      if (!note || !on) return;
      const drop = () => {
        const { note: _o, ...rest } = route.query;
        void router.replace({ query: rest });
      };
      if (!isRecordId(note)) return drop();
      // UN3's `GET /:id` answers `{ note }`, the shape the frozen contract names for a written note;
      // it has no separate read type, and a copy of the shape here would be a second definition.
      const res = await apiFetch<UnitNoteCreateResponse>(`/api/notes/${note.toLowerCase()}`);
      if (pending() !== note) return;
      if (res.ok && res.data?.note) {
        const n = res.data.note;
        labels.set(keyOf({ kind: n.kind, id: n.subjectId }), n.subjectLabel);
        const params = formatNotesParam({ subjects: [{ kind: n.kind, id: n.subjectId }], noteId: n.id });
        void router.replace({ query: { ...route.query, ...params } });
        return;
      }
      drop();
      if (res.status !== 404) toast.error("Could not open the note", res.error?.message);
    },
    { immediate: true },
  );
}
