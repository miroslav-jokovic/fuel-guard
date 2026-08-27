import { useQuery } from "@tanstack/vue-query";
import { computed, type Ref } from "vue";
import type { CardCapabilities, EfsLocation } from "@silvicom/shared";
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

export class EfsCardQueryError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EfsCardQueryError";
  }
}

/** Keep the normal query retry budget, except a 429: retrying it only extends the vendor lockout. */
export function shouldRetryEfsCardQuery(failureCount: number, error: unknown): boolean {
  return !(error instanceof EfsCardQueryError && error.status === 429) && failureCount < 3;
}

/** `apiFetch` never throws; vue-query needs it to, so errors surface instead of caching as data. */
async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await apiFetch<T>(path, { method, ...(body === undefined ? {} : { body }) });
  if (!res.ok) {
    throw new EfsCardQueryError(
      res.status,
      res.error?.code ?? "error",
      res.status === 429
        ? "Too many requests just now — try again in a minute"
        : res.error?.message ?? "That did not work",
    );
  }
  return res.data as T;
}

/**
 * `capabilities` as the API actually sends it.
 *
 * `CardControlAccess` extends the shared contract with the approver `scopes` this user holds, and
 * the drawer reads them as a second line behind `capabilityStates` — which already folds them in
 * server-side. Optional because an older API sends neither, and in that case the drawer refuses
 * rather than opening every operation at once.
 */
export type CardCapabilitiesWithScopes = CardCapabilities & { scopes?: string[] };

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
  /** Step 7.7 linking evidence. Absent on an older API, which is why every field is optional. */
  linkStatus?: "linked" | "ambiguous" | "unconfirmed" | "no_candidate" | "unidentifiable" | null;
  linkMethod?: string | null;
  linkCandidates?: number;
  syncedAt: string;
  /**
   * The DETAIL pass's clock (Step 7.8). `syncedAt` moves every sweep because the roster pass touches
   * every row; this moves only when the card's document was re-read, and it is what the override
   * state hangs off. Null = the roster has seen this card and nothing has ever read it.
   */
  detailSyncedAt?: string | null;
  /** Set when EFS stopped listing the card (audit P2). Optional — an older API sends neither. */
  absentSince?: string | null;
  syncError: string | null;
  /** Which mirror pass failed (Step 7.5 / migration 0198). `roster` and `detail` fail differently. */
  syncErrorSource?: "roster" | "detail" | null;
  syncErrorAt?: string | null;
}

export interface EfsCardListResponse {
  cards: EfsCardRow[];
  total: number;
  capabilities: CardCapabilitiesWithScopes;
  /** The sweep cadence plus a grace margin — see freshness(). Absent on an older API. */
  staleAfterMinutes?: number;
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
  staleAfterMinutes?: number;
  effective: {
    infos: EffectiveSection<{ infoId: string; validationType: string | null; matchValue: string | null; reportValue: string | null }>[];
    limits: EffectiveSection<{
      limitId: string; limit: number; hours: number | null; minHours: number | null;
      /** Step 7.4 — sent all along, declared nowhere, so nothing rendered them. */
      autoRollMap?: number | null; autoRollMax?: number | null;
    }>[];
    timeRestrictions: EffectiveSection<{ day: number; beginTime: string | null; endTime: string | null }>[];
    /** All FOUR (Step 7.4). `locationSource` was the dropped one. */
    sources: {
      infoSource: string | null; limitSource: string | null;
      locationSource?: string | null; timeSource: string | null;
    };
    /** Allowlist of groups. Optional — an older API sends neither this nor the blocklist. */
    locationGroups?: string[];
    /** A BLOCKLIST: locations this card is REFUSED at (guide p36), not where it works. */
    blockedLocations?: string[];
    /** Step 7.3's payroll capability flags. */
    payroll?: {
      status: string | null; use: string | null; atm: string | null;
      check: string | null; ach: string | null; wire: string | null; debit: string | null;
    };
    policyDescription: string | null;
    /** The policy read is best-effort: a slow vendor must not blank a page of card-level truth. */
    policyError: string | null;
  };
  capabilities: CardCapabilitiesWithScopes;
}

/**
 * Card views refresh THEMSELVES (audit B6). No manual "Refresh from EFS" button: the list and detail
 * poll while their tab is visible, and refetch on focus, so the operator always sees near-current
 * vendor truth without pressing anything. The polling hits OUR mirror (a cheap Postgres read), not
 * EFS — the mirror's own roster cadence keeps the mirror fresh against the vendor. `POLL_MS` is
 * generous because card configuration changes when a human changes it, not continuously.
 */
const POLL_MS = 60_000;

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
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false, // pause while the tab is hidden — no point polling unseen
    refetchOnWindowFocus: true,
  });
}

export function useEfsCard(id: Ref<string>) {
  return useQuery<EfsCardDetailResponse, EfsCardQueryError>({
    queryKey: computed(() => [...cardsKey, "detail", id.value] as const),
    queryFn: (): Promise<EfsCardDetailResponse> => call(`/api/fuel-cards/${id.value}`),
    retry: shouldRetryEfsCardQuery,
    enabled: computed(() => !!id.value),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
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
