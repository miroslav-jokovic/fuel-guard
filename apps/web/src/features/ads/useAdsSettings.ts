import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { AdsSettings, AdsSettingsView, AdsSpendView } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { apiRefusal } from "@/composables/useStepUpRetry";

/**
 * Settings › Ads control — wraps `/api/ads/settings` and the kill switch's two doors (routes/guard.ts, A5).
 * Saving and clearing the switch are `ads.spend` with a fresh sign-in: their refusals carry the API's
 * `code`, so the page's `useStepUpRetry` can ask for the password and run the same act again.
 */
export const ADS_SETTINGS_KEY = ["ads", "settings"] as const;

export function useAdsSettings() {
  return useQuery({
    queryKey: ADS_SETTINGS_KEY,
    queryFn: async (): Promise<AdsSettingsView> => {
      const res = await apiFetch<AdsSettingsView>("/api/ads/settings");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the ads settings");
      return res.data;
    },
  });
}

export function useSaveAdsSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: AdsSettings): Promise<{ version: number }> => {
      const res = await apiFetch<{ version: number }>("/api/ads/settings", { method: "PUT", body: { settings } });
      if (!res.ok || !res.data) throw apiRefusal(res.error, "Could not save the ads settings");
      return res.data;
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ADS_SETTINGS_KEY }), qc.invalidateQueries({ queryKey: ADS_SPEND_KEY })]),
  });
}

/** Press (`on`) or clear the kill switch. A reason is required both ways (0537; guardContract). */
export function useSetKillSwitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ on, reason }: { on: boolean; reason: string }): Promise<void> => {
      const res = await apiFetch(on ? "/api/ads/kill-switch" : "/api/ads/kill-switch/clear", { method: "POST", body: { reason } });
      if (!res.ok) throw apiRefusal(res.error, on ? "Could not stop the ads" : "Could not clear the kill switch");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ADS_SETTINGS_KEY }),
  });
}

/**
 * "Spend control live" (E1c): `GET /api/ads/spend`, the guard's own figures. Kept in step with every write
 * on this page that moves them — a save of the caps or budgets changes what each figure is measured against.
 */
export const ADS_SPEND_KEY = ["ads", "spend"] as const;

export function useAdsSpend() {
  return useQuery({
    queryKey: ADS_SPEND_KEY,
    queryFn: async (): Promise<AdsSpendView> => {
      const res = await apiFetch<AdsSpendView>("/api/ads/spend");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the spend so far");
      return res.data;
    },
  });
}
