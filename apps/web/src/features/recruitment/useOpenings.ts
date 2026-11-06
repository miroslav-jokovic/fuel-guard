import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { HiringProfileList, HiringProfileSave, OpeningSave, OpeningStatus, OpeningView, PlaceSuggestion } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Openings and the hiring profiles they name (Q-AD43 (b)), over recruiting's doors (`routes/hiringSetup.ts`):
 * `recruitment: view` reads, `recruitment: manage` saves. Every key sits under `["recruitment", "openings"]` or
 * `["recruitment", "hiring-profiles"]`, so a save also refreshes the campaign and lead pickers
 * (`useOpenOpeningsQuery`, same prefix).
 */
const OPENINGS = ["recruitment", "openings"] as const;
const PROFILES = ["recruitment", "hiring-profiles"] as const;

export function useOpeningsQuery() {
  return useQuery({
    queryKey: [...OPENINGS, "all"],
    queryFn: async (): Promise<OpeningView[]> => {
      const res = await apiFetch<{ openings: OpeningView[] }>("/api/recruitment/openings");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the openings.");
      return res.data.openings;
    },
  });
}

export function useSaveOpening() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (save: OpeningSave): Promise<{ opening_id: string; version: number }> => {
      const res = await apiFetch<{ opening_id: string; version: number }>("/api/recruitment/openings", { method: "POST", body: save });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not save the opening.");
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: OPENINGS }),
  });
}

export function useSetOpeningStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: OpeningStatus }): Promise<void> => {
      const res = await apiFetch(`/api/recruitment/openings/${encodeURIComponent(id)}/status`, { method: "POST", body: { status } });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not change the opening.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: OPENINGS }),
  });
}

export function useHiringProfilesQuery() {
  return useQuery({
    queryKey: PROFILES,
    queryFn: async (): Promise<HiringProfileList> => {
      const res = await apiFetch<HiringProfileList>("/api/recruitment/hiring-profiles");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the hiring profiles.");
      return res.data;
    },
  });
}

export function useSaveHiringProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (save: HiringProfileSave): Promise<{ profile_id: string; version_id: string; version: number }> => {
      const res = await apiFetch<{ profile_id: string; version_id: string; version: number }>("/api/recruitment/hiring-profiles", { method: "POST", body: save });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not save the hiring profile.");
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PROFILES }),
  });
}

/** Recruiting's place search (Q-AD44 (a)); under three letters it is not asked, as the API would answer none. */
export function usePlaceSuggestQuery(q: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ["recruitment", "place-suggest", q.value.trim()] as const),
    enabled: computed(() => q.value.trim().length >= 3),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PlaceSuggestion[]> => {
      const res = await apiFetch<{ suggestions: PlaceSuggestion[] }>(`/api/recruitment/place-suggest?q=${encodeURIComponent(q.value.trim())}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not search for the place.");
      return res.data.suggestions;
    },
  });
}
