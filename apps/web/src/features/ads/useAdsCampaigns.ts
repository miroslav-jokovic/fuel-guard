import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { Ref } from "vue";
import { adsLaunchMissingSchema, type AdsCampaignCreate, type AdsCampaignLaunch, type AdsCampaignMove, type AdsCampaignSummary, type AdsCampaignView, type AdsCopyChoice, type AdsCreativeDecision, type AdsLaunchMissing, type CampaignConcepts } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { apiRefusal } from "@/composables/useStepUpRetry";
import { isWorking } from "./adsCampaignFlow";

/**
 * The campaign doors (`routes/campaigns.ts`, `routes/guard.ts`). Reading is anyone who can view recruiting; a
 * move, a create and an ad's decision are whoever manages it. Refusals keep the API's `code` (`apiRefusal`), so a
 * door that later asks for a fresh sign-in (E3b-2's spend approval and Launch) is answered the same way.
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

/**
 * What each concept of the campaign did (CQ3's reader, D-AD22): read on demand, refreshed hourly like the pull that
 * fills it. Asked only for a campaign that reached the platform (`AdsCampaignConcepts` decides), so a draft never
 * shows a table of zeros.
 */
export function useCampaignConcepts(id: Ref<string>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: [...ADS_CAMPAIGNS_KEY, id, "concepts"],
    enabled: () => id.value !== "" && enabled.value,
    queryFn: async (): Promise<CampaignConcepts> => {
      const res = await apiFetch<CampaignConcepts>(`/api/ads/campaigns/${id.value}/concepts`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the concepts");
      return res.data;
    },
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * Every write reads the campaigns again when it settles, refused or not: a refusal can move the campaign too (the
 * launch gate writes its `last_error`; a move another person made first changed the state the button came from).
 */
function useCampaignWrite<V>(send: (v: V) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: send, onSettled: () => qc.invalidateQueries({ queryKey: ADS_CAMPAIGNS_KEY }) });
}

async function post(path: string, body: object, fallback: string): Promise<void> {
  const res = await apiFetch(path, { method: "POST", body });
  if (!res.ok) throw Object.assign(apiRefusal(res.error, fallback), { detail: res.detail });
}

/**
 * The launch gate's list (G-launch-gate, 409 `not_certified`): which parts of the agent have not passed their test
 * run yet. Null for any other refusal, or a list the screen cannot read.
 */
export function launchMissingFrom(e: unknown): AdsLaunchMissing | null {
  const r = e as { code?: string; detail?: { missing?: unknown } };
  if (r?.code !== "not_certified") return null;
  const parsed = adsLaunchMissingSchema.safeParse(r.detail?.missing);
  return parsed.success && parsed.data.length > 0 ? parsed.data : null;
}

export const useCreateCampaign = () => useCampaignWrite<AdsCampaignCreate>((ask) => post("/api/ads/campaigns", ask, "Could not create the campaign"));

export const useCampaignMove = () => useCampaignWrite<{ id: string; move: AdsCampaignMove }>(({ id, move }) => post(`/api/ads/campaigns/${id}/moves`, move, "Could not do that"));

/**
 * Approve the spend at these amounts, then launch at them (E3b-2): the launch door refuses without a covering
 * approval. Both are `ads.spend` with a fresh sign-in, so a refusal keeps its `code` for `useStepUpRetry`.
 */
export const useApproveAndLaunch = () =>
  useCampaignWrite<{ id: string; launch: AdsCampaignLaunch }>(async ({ id, launch }) => {
    await post(`/api/ads/campaigns/${id}/approvals`, { kind: "launch", ...launch }, "Could not approve the spend");
    await post(`/api/ads/campaigns/${id}/launch`, launch, "Could not launch");
  });

export const useCreativeDecision = () =>
  useCampaignWrite<{ id: string; creativeId: string; decision: AdsCreativeDecision }>(({ id, creativeId, decision }) =>
    post(`/api/ads/campaigns/${id}/creatives/${creativeId}/decision`, decision, "Could not record the decision"));

/**
 * A person chooses an ad's words (Q-ADL7): the ad is remade with them on the same picture. A 422 `words_refused`
 * keeps the API's findings on the error's `detail` (`copy`, `overlay`), so the editor marks the lines they name.
 */
export const useChooseWords = () =>
  useCampaignWrite<{ id: string; creativeId: string; choice: AdsCopyChoice }>(({ id, creativeId, choice }) =>
    post(`/api/ads/campaigns/${id}/creatives/${creativeId}/words`, choice, "Could not use these words"));

