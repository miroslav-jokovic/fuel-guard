import { useQuery } from "@tanstack/vue-query";
import type { ConversionLeadsView } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/** V7e: how near the carrier is to Meta's qualified-lead goal (`GET /api/ads/conversion-leads`). A read only. */
export const ADS_CONVERSION_LEADS_KEY = ["ads", "conversion-leads"] as const;

export function useAdsConversionLeads() {
  return useQuery({
    queryKey: ADS_CONVERSION_LEADS_KEY,
    queryFn: async (): Promise<ConversionLeadsView> => {
      const res = await apiFetch<ConversionLeadsView>("/api/ads/conversion-leads");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the qualified-lead readiness");
      return res.data;
    },
  });
}
