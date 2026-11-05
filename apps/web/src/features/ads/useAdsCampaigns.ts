import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { Ref } from "vue";
import type { AdsCampaignCreate, AdsCampaignLaunch, AdsCampaignMove, AdsCampaignSummary, AdsCampaignView, AdsCreativeDecision } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { apiRefusal } from "@/composables/useStepUpRetry";
import { isWorking } from "./adsCampaignFlow";

/**
 * The campaign doors (`routes/campaigns.ts`, `routes/guard.ts`). Reading is anyone who can view recruiting; a
 * move, a create and an ad's decision are whoever manages it; the spend approval and Launch are `ads.spend` with a
 * fresh sign-in, so their refusals keep the API's `code` for `useStepUpRetry`.
 */
export const ADS_CAMPAIGNS_KEY = ["ads", "campaigns"] as const;
const WORKING_POLL_MS = 5_000;

export function useAdsCampaigns() {
  return useQuery({
    queryKey: ADS_CAMPAIGNS_KEY,
    queryFn: async (): Promise<AdsCampaignSummary[]> => {
      const res = await apiFetch<{ campaigns: AdsCampaignSummary[] }>("/api/ads/campaigns");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the campaigns");
      return res.data.campaigns;
    },
  });
}

export function useAdsCampaign(id: Ref<string>) {
  return useQuery({
    queryKey: [...ADS_CAMPAIGNS_KEY, id],
    enabled: () => id.value !== "",
    queryFn: async (): Promise<AdsCampaignView> => {
      const res = await apiFetch<{ campaign: AdsCampaignView }>(`/api/ads/campaigns/${id.value}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the campaign");
      return res.data.campaign;
    },
    refetchInterval: (q) => (q.state.data && isWorking(q.state.data.state) ? WORKING_POLL_MS : false),
  });
}

function useCampaignWrite<V>(send: (v: V) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: send, onSuccess: () => qc.invalidateQueries({ queryKey: ADS_CAMPAIGNS_KEY }) });
}

async function post(path: string, body: object, fallback: string): Promise<void> {
  const res = await apiFetch(path, { method: "POST", body });
  if (!res.ok) throw apiRefusal(res.error, fallback);
}

export const useCreateCampaign = () => useCampaignWrite<AdsCampaignCreate>((ask) => post("/api/ads/campaigns", ask, "Could not create the campaign"));

export const useCampaignMove = () => useCampaignWrite<{ id: string; move: AdsCampaignMove }>(({ id, move }) => post(`/api/ads/campaigns/${id}/moves`, move, "Could not do that"));

export const useCreativeDecision = () =>
  useCampaignWrite<{ id: string; creativeId: string; decision: AdsCreativeDecision }>(({ id, creativeId, decision }) =>
    post(`/api/ads/campaigns/${id}/creatives/${creativeId}/decision`, decision, "Could not record the decision"));

/** Approve the spend at these amounts, then launch at them: the launch door refuses without a covering approval. */
export const useApproveAndLaunch = () =>
  useCampaignWrite<{ id: string; launch: AdsCampaignLaunch }>(async ({ id, launch }) => {
    await post(`/api/ads/campaigns/${id}/approvals`, { kind: "launch", ...launch }, "Could not approve the spend");
    await post(`/api/ads/campaigns/${id}/launch`, launch, "Could not launch");
  });
