import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import type { Ref } from "vue";
import type { AdsHealthView, AdsOverviewView } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The Ads workspace's two reads: the Overview (`GET /api/ads/overview`, V6) and the health read the Automation tab
 * draws (`GET /api/ads/health`, V8). Both are reads of rows we hold; nothing here writes.
 *
 * The Overview's ledger pages by cursor, both ways (`?before=` / `?after=`, D-US12), so the position is part of the
 * key and the page on screen stays there while the next one loads.
 */
export const ADS_OVERVIEW_KEY = ["ads", "overview"] as const;
export const ADS_HEALTH_KEY = ["ads", "health"] as const;

export type AdsLedgerPosition = { before?: string; after?: string };

export function useAdsOverview(position: Ref<AdsLedgerPosition>) {
  return useQuery({
    queryKey: [...ADS_OVERVIEW_KEY, position] as const,
    queryFn: async (): Promise<AdsOverviewView> => {
      const p = position.value;
      const q = p.before ? `?before=${encodeURIComponent(p.before)}` : p.after ? `?after=${encodeURIComponent(p.after)}` : "";
      const res = await apiFetch<AdsOverviewView>(`/api/ads/overview${q}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the ads overview");
      return res.data;
    },
    placeholderData: keepPreviousData,
  });
}

export function useAdsHealth() {
  return useQuery({
    queryKey: ADS_HEALTH_KEY,
    queryFn: async (): Promise<AdsHealthView> => {
      const res = await apiFetch<AdsHealthView>("/api/ads/health");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the ads health");
      return res.data;
    },
  });
}
