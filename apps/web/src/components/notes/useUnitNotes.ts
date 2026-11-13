import { computed, onScopeDispose, watch, type Ref } from "vue";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/vue-query";
import {
  canReachSurface,
  formatUnitNoteCursor,
  formatUnitNoteSubjects,
  surfaceAllowed,
  SURFACES,
  UNIT_NOTE_REFRESH_MS,
  UNIT_NOTE_SUMMARY_REFRESH_MS,
  type UnitNote,
  type UnitNoteCreate,
  type UnitNoteCreateResponse,
  type UnitNoteEditResponse,
  type UnitNoteUnitRef,
  type UnitNoteUnitsResponse,
  type UnitNoteKind,
  type UnitNoteListResponse,
  type UnitNotePeopleResponse,
  type UnitNotePinResponse,
  type UnitNoteSearchHit,
  type UnitNoteSubject,
  type UnitNoteSubjectSummary,
  type UnitNoteSummary,
} from "@silvicom/shared";
import { apiFetch, type ApiResult } from "@/lib/api";
import { useSessionStore } from "@/stores/session";
import { useModulesQuery } from "@/composables/useModules";

/**
 * The web's whole conversation with `/api/notes` (UNIT-NOTES-PLAN §4.3–4.4, D-UN10).
 *
 * ── WHO SEES NOTES ─────────────────────────────────────────────────────────────────────────────
 * The `notes` surface's own answer, asked the way the sidebar asks it (`lib/nav.ts`): the gate and
 * modules (`canReachSurface`), then the carrier's and the role's screen answer (`surfaceAllowed`).
 * Every route of the API asks `requireSurface("notes")` (D-UN4), so a column or button shown on any
 * other rule would be an offer the API refuses. While the surface shipped dark (D-UN14,
 * `startsOnFor: []`) that was admins only; UN9 turned it on for every office role with no change here.
 */
const NOTES_SURFACE = SURFACES.find((s) => s.key === "notes")!;

export function useNotesAccess() {
  const session = useSessionStore();
  const modules = useModulesQuery();
  return computed(
    () =>
      session.isAuthenticated &&
      canReachSurface(NOTES_SURFACE, session.role, modules.data.value ?? null, session.sections) &&
      surfaceAllowed(NOTES_SURFACE, session.role, session.sections, session.surfaces),
  );
}

/** Every notes read sits under this key, so a note written refreshes the lists AND the column counts. */
export const NOTES_KEY = ["unit-notes"] as const;

async function read<T>(p: Promise<ApiResult<T>>, fallback: string): Promise<T> {
  const res = await p;
  if (!res.ok || res.data === undefined || res.data === null) throw new Error(res.error?.message ?? fallback);
  return res.data;
}

// ── the Notes column (D-UN12) ─────────────────────────────────────────────────────────────────────

/**
 * Each unit's count and newest note, for the kinds a table shows — ONE jsonb from the API (M12), so a
 * carrier of 600 trucks is one small request, a unit with no notes is simply absent, and the Dispatch
 * Board's three kinds are one call (§6 UN6), not three.
 *
 * D-UN10: every 60 s, on window focus (vue-query's default), after a note is written (`NOTES_KEY`),
 * and — given `listUpdatedAt`, the table's own query stamp — whenever the table's list refreshes, so
 * a reload of the rows never shows counts older than the rows. The first stamp is the list's first
 * load, which this query is already making, so only a CHANGE of stamp asks again.
 *
 * ⚠ Called once per table, never per cell: every observer of a query with `refetchInterval` keeps its
 * own timer, and twenty cells would have asked twenty times a minute.
 */
export function useUnitNoteSummaries(kinds: readonly UnitNoteKind[], listUpdatedAt?: Ref<number>) {
  const on = useNotesAccess();
  const q = useQuery({
    queryKey: [...NOTES_KEY, "summary", kinds.join(",")],
    enabled: on,
    refetchInterval: UNIT_NOTE_SUMMARY_REFRESH_MS,
    queryFn: async (): Promise<UnitNoteSummary["kinds"]> =>
      (await read(apiFetch<UnitNoteSummary>(`/api/notes/summary?kinds=${kinds.join(",")}`), "Could not load the note counts.")).kinds,
  });
  if (listUpdatedAt) {
    watch(listUpdatedAt, (now, before) => {
      if (before && now !== before && on.value) void q.refetch();
    });
  }
  return { on, summaries: computed(() => q.data.value ?? {}) };
}

/** One kind's counts by unit id — the Vehicles, Trailers and Drivers tables and a detail page's button. */
export function useUnitNoteSummary(kind: UnitNoteKind, listUpdatedAt?: Ref<number>) {
  const { on, summaries } = useUnitNoteSummaries([kind], listUpdatedAt);
  return { on, summary: computed<Record<string, UnitNoteSubjectSummary>>(() => summaries.value[kind] ?? {}) };
}

// ── the list, its search, and the wall ────────────────────────────────────────────────────────────

/** What a list asks for. `subjects: []` is the wall — every note of the carrier (D-UN13). */
export interface UnitNoteFeedParams {
  subjects: UnitNoteSubject[];
  q?: string;
  kind?: UnitNoteKind;
  author?: string;
  from?: string;
  to?: string;
}

export function feedQueryString(p: UnitNoteFeedParams, page: { before?: string; after?: string } = {}): string {
  const s = new URLSearchParams();
  if (p.subjects.length) s.set("subjects", formatUnitNoteSubjects(p.subjects));
  for (const k of ["q", "kind", "author", "from", "to"] as const) if (p[k]) s.set(k, p[k]!);
  if (page.before) s.set("before", page.before);
  if (page.after) s.set("after", page.after);
  const out = s.toString();
  return out ? `?${out}` : "";
}

const newestFirst = (a: Pick<UnitNote, "createdAt" | "id">, b: Pick<UnitNote, "createdAt" | "id">) =>
  Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * A list of notes, newest first, older pages on demand (`before`), and D-UN10's live refresh: every
 * `UNIT_NOTE_REFRESH_MS` while the tab is visible it asks only for notes AFTER the newest it holds —
 * one small indexed read for an idle drawer — and lays them on top. Focus refetches the whole list
 * (vue-query's default), which is also how somebody else's pin reaches an open drawer.
 *
 * Close matches (`fuzzy`) are not a feed and are not refreshed: "newer than the newest close match"
 * asks a question nobody did.
 */
export function useUnitNotesFeed(params: Ref<UnitNoteFeedParams | null>) {
  const on = useNotesAccess();
  const qc = useQueryClient();
  const key = computed(() => [...NOTES_KEY, "list", params.value ? feedQueryString(params.value) : "closed"] as const);
  const enabled = computed(() => on.value && params.value !== null);

  const list = useInfiniteQuery({
    queryKey: key,
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      read(apiFetch<UnitNoteListResponse>(`/api/notes${feedQueryString(params.value!, { before: pageParam })}`), "Could not load the notes."),
    getNextPageParam: (last) => last.next ?? undefined,
  });

  const notes = computed<UnitNoteSearchHit[]>(() => {
    const seen = new Set<string>();
    return (list.data.value?.pages ?? []).flatMap((p) => p.notes).filter((n) => !seen.has(n.id) && !!seen.add(n.id));
  });
  const fuzzy = computed(() => list.data.value?.pages[0]?.fuzzy ?? false);

  async function pollNewer(): Promise<void> {
    if (!enabled.value || !list.data.value || fuzzy.value || list.isFetching.value) return;
    const newest = [...notes.value].sort(newestFirst)[0];
    if (!newest) {
      await list.refetch();
      return;
    }
    const after = formatUnitNoteCursor({ at: newest.createdAt, id: newest.id });
    const res = await apiFetch<UnitNoteListResponse>(`/api/notes${feedQueryString(params.value!, { after })}`);
    if (!res.ok || !res.data?.notes.length) return;
    const fresh = [...res.data.notes].sort(newestFirst);
    qc.setQueryData<InfiniteData<UnitNoteListResponse, string | undefined>>(key.value, (old) => {
      if (!old?.pages.length) return old;
      const held = new Set(old.pages.flatMap((p) => p.notes.map((n) => n.id)));
      const add = fresh.filter((n) => !held.has(n.id));
      const [first, ...rest] = old.pages;
      return { ...old, pages: [{ ...first!, notes: [...add, ...first!.notes] }, ...rest] };
    });
  }
  const timer = setInterval(() => {
    if (typeof document === "undefined" || !document.hidden) void pollNewer();
  }, UNIT_NOTE_REFRESH_MS);
  onScopeDispose(() => clearInterval(timer));

  return { list, notes, fuzzy, pollNewer };
}

// ── the two writes: add and pin (D-UN3, D-UN6) ────────────────────────────────────────────────────

export function useAddUnitNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: UnitNoteCreate): Promise<UnitNote> =>
      (await read(apiFetch<UnitNoteCreateResponse>("/api/notes", { method: "POST", body: v }), "Could not save the note.")).note,
    onSuccess: () => void qc.invalidateQueries({ queryKey: NOTES_KEY }),
  });
}

/** Pin one note (the server unpins the unit's other, `set_unit_note_pinned`) or unpin it. */
export function usePinUnitNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; pinned: boolean }): Promise<boolean> =>
      (await read(apiFetch<UnitNotePinResponse>(`/api/notes/${v.id}/pin`, { method: "POST", body: { pinned: v.pinned } }), "Could not pin the note.")).pinned,
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...NOTES_KEY, "list"] }),
  });
}

// ── v3 (plan §9): edit, remove, resolve, and the units the `@` list offers ─────────────────────────

/**
 * New words for a note (D-UN15). Every notes read is refreshed — the list, the counts, and a board chip
 * the edit may have added or taken out — so nothing on screen holds the old words.
 */
export function useEditUnitNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; body: string }): Promise<UnitNote> =>
      (await read(apiFetch<UnitNoteEditResponse>(`/api/notes/${v.id}`, { method: "PATCH", body: { body: v.body } }), "Could not save the note.")).note,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NOTES_KEY });
      void qc.invalidateQueries({ queryKey: ["dispatch", "board"] });
    },
  });
}

/** Remove (hide) a note (D-UN16): it leaves every list, count and board chip. */
export function useRemoveUnitNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await read(apiFetch<{ removed: boolean }>(`/api/notes/${id}`, { method: "DELETE" }), "Could not remove the note.");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NOTES_KEY });
      void qc.invalidateQueries({ queryKey: ["dispatch", "board"] });
    },
  });
}

/**
 * Take one unit's chip for one note off the Dispatch Board, for everybody (D-UN18). The board is asked
 * again at once: the server reads the chips past its row cache, so the answer is already current.
 */
export function useResolveNoteMention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { noteId: string; kind: UnitNoteKind; subjectId: string }): Promise<void> => {
      await read(
        apiFetch<{ resolved: boolean }>(`/api/notes/${v.noteId}/units/resolve`, { method: "POST", body: { kind: v.kind, subjectId: v.subjectId } }),
        "Could not resolve the note.",
      );
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["dispatch", "board"] }),
  });
}

/**
 * The trucks, trailers and drivers whose number or name starts with what follows the `@` (D-UN17), for
 * the composer's list. Asked only once something is typed, and cached a minute per query, so moving the
 * caret back and forth asks nothing new.
 */
export function useUnitNoteUnits(query: Ref<string | null>) {
  const on = useNotesAccess();
  return useQuery({
    queryKey: computed(() => [...NOTES_KEY, "units", query.value ?? ""] as const),
    enabled: computed(() => on.value && !!query.value?.trim()),
    staleTime: 60_000,
    queryFn: async (): Promise<UnitNoteUnitRef[]> =>
      (await read(apiFetch<UnitNoteUnitsResponse>(`/api/notes/units?q=${encodeURIComponent(query.value!.trim())}`), "Could not load the units.")).units,
  });
}

/**
 * The carrier's office members (D-UN8) — the author filter's names now, the `@` list in UN7. An
 * answer that fails leaves the filter out rather than offering a list of nobody.
 */
export function useUnitNotePeople(enabled: Ref<boolean>) {
  const on = useNotesAccess();
  return useQuery({
    queryKey: [...NOTES_KEY, "people"],
    enabled: computed(() => on.value && enabled.value),
    staleTime: 5 * 60_000,
    queryFn: async () => (await read(apiFetch<UnitNotePeopleResponse>("/api/notes/people"), "Could not load the people.")).people,
  });
}
