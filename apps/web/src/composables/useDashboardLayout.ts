import { computed, type ComputedRef } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { StoredDashboardLayout } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The caller's own Dashboard arrangement (LM10, D-DW3).
 *
 * ⚠ **`undefined` and `null` are different answers here and the difference is load-bearing.**
 * `undefined` is "not loaded yet"; `null` is the server saying "this person has no row", which means
 * inherit the role default. Flattening either into an empty layout renders an empty dashboard — and
 * for the loading case it would render one for a moment on every page load, which reads as a bug in
 * the dashboard rather than in this file.
 *
 * Through the API rather than PostgREST, which is D-LM11's direction for the newer surfaces, and
 * here it is not a preference: the write path validates widget keys against the catalogue and
 * PostgREST has no catalogue to validate against. 0343 gives the table no write policy at all.
 */
const KEY = ["dashboard-layout"] as const;

export function useDashboardLayoutQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<StoredDashboardLayout | null> => {
      const res = await apiFetch<{ layout: StoredDashboardLayout | null }>("/api/dashboard-layout");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load your dashboard layout");
      return res.data.layout;
    },
    // A person's own arrangement changes only when they change it, and the mutations below
    // invalidate on every one of those. Refetching on focus would be a request per tab switch for
    // no news — the same bargain `useSavedViews` strikes, for the same reason.
    staleTime: Infinity,
  });
}

export function useSaveDashboardLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (layout: StoredDashboardLayout): Promise<void> => {
      const res = await apiFetch("/api/dashboard-layout", {
        method: "PUT",
        // ⚠ Never `JSON.stringify` into `body` — `apiFetch` serialises it, and a double-encoded body
        // is refused by express and surfaces as a generic 500 with no audit row.
        body: { widgetKeys: [...layout.widgetKeys], hiddenKeys: [...layout.hiddenKeys] },
      });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not save your dashboard layout");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Restore the role default, which D-DW3 spells "delete the row" rather than "store an empty one". */
export function useResetDashboardLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const res = await apiFetch("/api/dashboard-layout", { method: "DELETE" });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not restore the default layout");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export interface DashboardLayoutState {
  /** `undefined` while loading, `null` for "no row — inherit the default". */
  layout: ComputedRef<StoredDashboardLayout | null | undefined>;
  loading: ComputedRef<boolean>;
  saving: ComputedRef<boolean>;
  save: (layout: StoredDashboardLayout) => Promise<void>;
  reset: () => Promise<void>;
}

/** The three of them together, which is how the page and the editor both want them. */
export function useDashboardLayout(): DashboardLayoutState {
  const query = useDashboardLayoutQuery();
  const saveLayout = useSaveDashboardLayout();
  const resetLayout = useResetDashboardLayout();
  return {
    layout: computed(() => query.data.value),
    loading: computed(() => query.isLoading.value),
    saving: computed(() => saveLayout.isPending.value || resetLayout.isPending.value),
    save: (layout) => saveLayout.mutateAsync(layout),
    reset: () => resetLayout.mutateAsync(),
  };
}
