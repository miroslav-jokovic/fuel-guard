import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { AdPresetSave, AdPresetView } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/** Concept presets (E2 over C1's doors, `routes/brandKits.ts`): read as the brand kits are, saved by an admin. */
export const ADS_PRESETS_KEY = ["ads", "presets"] as const;

export function useAdsPresets() {
  return useQuery({
    queryKey: ADS_PRESETS_KEY,
    queryFn: async (): Promise<AdPresetView[]> => {
      const res = await apiFetch<{ presets: AdPresetView[] }>("/api/ads/presets");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the presets");
      return res.data.presets;
    },
  });
}

export function useSavePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (save: AdPresetSave): Promise<void> => {
      const res = await apiFetch("/api/ads/presets", { method: "POST", body: save });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not save the preset");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ADS_PRESETS_KEY }),
  });
}

/** What the adopt answers (`POST /api/ads/presets/adopt`, Q-AD77): the starter keys written, and those already held. */
export interface AdoptAnswer { adopted: string[]; skipped: string[] }

export function useAdoptStarterPresets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<AdoptAnswer> => {
      const res = await apiFetch<AdoptAnswer>("/api/ads/presets/adopt", { method: "POST", body: {} });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not add the ready-made presets");
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ADS_PRESETS_KEY }),
  });
}
