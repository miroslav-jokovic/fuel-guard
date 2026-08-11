import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, type Ref } from "vue";
import type { CardCapabilities, EfsLocation } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";

/**
 * Reading EFS cards.
 *
 * Everything goes through `apiFetch`, never `supabase.from(...)`. `efs_cards` has RLS enabled with NO
 * policies — deny-all for client roles — because the row carries the sealed card number and the whole
 * card document. The API is the only place masking, capabilities and the card-versus-policy merge are
 * applied, so it is the only sanctioned way in. Same reason `efs_soap_credentials` set that precedent.
 */

const cardsKey = ["efs_cards"] as const;

/** `apiFetch` never throws; vue-query needs it to, so errors surface instead of caching as data. */
async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await apiFetch<T>(path, { method, ...(body === undefined ? {} : { body }) });
  if (!res.ok) throw new Error(res.error?.message ?? "That did not work");
  return res.data as T;
}

export interface EfsCardRow {
  id: string;
  last4: string;
  maskedRef: string;
  status: string;
  policyNumber: number | null;
  driverIdPrompt: string | null;
  unitPrompt: string | null;
  driverName: string | null;
  overrideUses: number | null;
  overrideAllLocations: boolean | null;
  locationOverrideId: string | null;
  lastUsedDate: string | null;
  fuelCardId: string | null;
  syncedAt: string;
  syncError: string | null;
}

export interface EfsCardListResponse {
  cards: EfsCardRow[];
  total: number;
  capabilities: CardCapabilities;
}

export interface EffectiveSection<T> {
  value: T;
  origin: "card" | "policy" | "policy-overridden" | "policy-ignored";
}

export interface EfsCardDetailResponse {
  card: EfsCardRow & {
    companyXref: string | null;
    handEnter: string | null;
    payrollStatus: string | null;
    payrollUse: string | null;
    lastTransaction: string | null;
    version: string;
    document: Record<string, unknown>;
  };
  effective: {
    infos: EffectiveSection<{ infoId: string; validationType: string | null; matchValue: string | null; reportValue: string | null }>[];
    limits: EffectiveSection<{ limitId: string; limit: number; hours: number | null; minHours: number | null }>[];
    timeRestrictions: EffectiveSection<{ day: number; beginTime: string | null; endTime: string | null }>[];
    sources: { infoSource: string | null; limitSource: string | null; timeSource: string | null };
    policyDescription: string | null;
    /** The policy read is best-effort: a slow vendor must not blank a page of card-level truth. */
    policyError: string | null;
  };
  capabilities: CardCapabilities;
}

export function useEfsCards(filters: { search: Ref<string>; status: Ref<string> }) {
  return useQuery({
    queryKey: computed(() => [...cardsKey, "list", filters.search.value, filters.status.value] as const),
    queryFn: (): Promise<EfsCardListResponse> => {
      const params = new URLSearchParams();
      if (filters.search.value) params.set("search", filters.search.value);
      if (filters.status.value) params.set("status", filters.status.value);
      const query = params.toString();
      return call<EfsCardListResponse>(`/api/fuel-cards${query ? `?${query}` : ""}`);
    },
  });
}

export function useEfsCard(id: Ref<string>) {
  return useQuery({
    queryKey: computed(() => [...cardsKey, "detail", id.value] as const),
    queryFn: (): Promise<EfsCardDetailResponse> => call(`/api/fuel-cards/${id.value}`),
    enabled: computed(() => !!id.value),
  });
}

/** Re-read ONE card from EFS. Synchronous at the API — one paced call, and a person is waiting. */
export function useRefreshEfsCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => call<{ ok: true; version: string }>(`/api/fuel-cards/${id}/refresh`, "POST"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cardsKey }),
  });
}

/** Queue a full mirror sweep. 202 + jobId; the ledger refuses a second concurrent run per company. */
export function useSyncEfsCards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call<{ ok: true; queued: true; jobId: string }>("/api/fuel-cards/sync", "POST"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cardsKey }),
  });
}

/**
 * EFS location search, for the single-location override picker.
 *
 * Held back until two characters: the API refuses an empty query outright (an unbounded search
 * against a rate-paced vendor is not something to find out about in production), and one character
 * would spend a paced request on a result nobody can use.
 */
export function useEfsLocationSearch(query: Ref<{ state?: string; city?: string; name?: string }>) {
  return useQuery({
    queryKey: computed(() => [...cardsKey, "locations", query.value] as const),
    queryFn: (): Promise<{ locations: EfsLocation[] }> => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query.value)) if (v) params.set(k, v);
      return call(`/api/fuel-cards/locations?${params.toString()}`);
    },
    enabled: computed(() => Object.values(query.value).some((v) => (v ?? "").trim().length >= 2)),
    staleTime: 5 * 60_000,
  });
}
