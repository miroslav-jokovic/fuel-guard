import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import type { Ref } from "vue";
import type { AdsHealthView, AdsLeadCostView, AdsOverviewView } from "@silvicom/shared";
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

export const ADS_LEAD_COST_KEY = ["ads", "report", "leads"] as const;

/** V7d's report for the days picked (`GET /api/ads/report/leads`), inclusive, as the carrier's calendar days. */
export function useAdsLeadCost(range: Ref<{ from: string; to: string }>) {
  return useQuery({
    queryKey: [...ADS_LEAD_COST_KEY, range] as const,
    queryFn: async (): Promise<AdsLeadCostView> => {
      const { from, to } = range.value;
      const res = await apiFetch<AdsLeadCostView>(`/api/ads/report/leads?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the lead cost report");
      return res.data;
    },
    placeholderData: keepPreviousData,
  });
}
