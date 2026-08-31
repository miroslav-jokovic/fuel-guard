import { computed, type ComputedRef } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { SavedView, SavedViewTable } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * A reader's saved views for one table — a name and a query string each (D-ROS14, R3c-2).
 *
 * ── WHY THESE GO THROUGH THE API AND NOT POSTGREST ──────────────────────────────────────────────
 * Reads may use direct PostgREST where a composable already does (apps/web/CLAUDE.md); writes go
 * through the API. Both halves live here rather than splitting the pair across two transports,
 * because the read and the write are the same three columns and a saved view is not worth two
 * mental models.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────────────────────────
 * It does not interpret the query. Applying a view is a NAVIGATION — the caller pushes the query
 * onto the router and every existing reader normalises what it finds, exactly as it would for a link
 * somebody pasted. That is what keeps a saved view and a link the same thing rather than two
 * mechanisms that agree until they do not.
 */
const key = (table: SavedViewTable) => ["saved-views", table] as const;

export function useSavedViewsQuery(table: SavedViewTable) {
  return useQuery({
    queryKey: key(table),
    queryFn: async (): Promise<SavedView[]> => {
      const res = await apiFetch<{ views: SavedView[] }>(
        `/api/saved-views?table=${encodeURIComponent(table)}`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load your saved views");
      return res.data.views;
    },
    // A person's own bookmarks change only when they change them, and this composable invalidates
    // on every one of those. Refetching on focus would be a request per tab switch for no news.
    staleTime: Infinity,
  });
}

export function useSaveView(table: SavedViewTable) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (view: { name: string; query: string }): Promise<void> => {
      const res = await apiFetch("/api/saved-views", {
        method: "PUT",
        body: { table_id: table, ...view },
      });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not save the view");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(table) }),
  });
}

export function useDeleteView(table: SavedViewTable) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<void> => {
      const res = await apiFetch(
        `/api/saved-views?table=${encodeURIComponent(table)}&name=${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Could not delete the view");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(table) }),
  });
}

export interface SavedViewsState {
  views: ComputedRef<SavedView[]>;
  loading: ComputedRef<boolean>;
  save: (name: string, query: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  saving: ComputedRef<boolean>;
}

/** The three of them together, which is how every caller wants them. */
export function useSavedViews(table: SavedViewTable): SavedViewsState {
  const list = useSavedViewsQuery(table);
  const saveView = useSaveView(table);
  const deleteView = useDeleteView(table);
  return {
    views: computed(() => list.data.value ?? []),
    loading: computed(() => list.isLoading.value),
    saving: computed(() => saveView.isPending.value || deleteView.isPending.value),
    save: (name, query) => saveView.mutateAsync({ name, query }),
    remove: (name) => deleteView.mutateAsync(name),
  };
}
