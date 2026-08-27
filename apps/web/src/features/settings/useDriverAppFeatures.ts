import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  DriverAppOverrideRow,
  OrgFeatureRow,
  SetDriverAppFeatureRequest,
  SetDriverAppOverrideRequest,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Driver-app control-plane data layer (hardening plan Phase 5). Everything goes through
 * /api/driver-app — 0134 ships the tables RLS-on with zero policies, so there is deliberately no
 * PostgREST path here (unlike most settings composables). The API validates config against the
 * shared catalog and audits every write.
 */
const FEATURES_KEY = ["driver_app", "features"] as const;
const OVERRIDES_KEY = ["driver_app", "overrides"] as const;

/** The org's stored feature rows (absent row = catalog default; the page merges with the catalog). */
export function useDriverAppFeaturesQuery() {
  return useQuery({
    queryKey: FEATURES_KEY,
    queryFn: async (): Promise<OrgFeatureRow[]> => {
      const res = await apiFetch<{ features: OrgFeatureRow[] }>("/api/driver-app/settings");
      if (!res.ok) throw new Error(res.error?.message ?? "Failed to load driver-app settings.");
      return res.data?.features ?? [];
    },
  });
}

export function useSaveDriverAppFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { featureKey: string } & SetDriverAppFeatureRequest): Promise<void> => {
      const res = await apiFetch(`/api/driver-app/settings/${encodeURIComponent(input.featureKey)}`, {
        method: "PUT",
        body: { enabled: input.enabled, ...(input.config ? { config: input.config } : {}) },
      });
      if (!res.ok) throw new Error(res.error?.message ?? "Failed to save the setting.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: FEATURES_KEY }),
  });
}

/** One driver's exceptions — reactive to the picker. */
export function useDriverOverridesQuery(driverId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => [...OVERRIDES_KEY, driverId.value] as const),
    enabled: computed(() => !!driverId.value),
    queryFn: async (): Promise<DriverAppOverrideRow[]> => {
      const id = driverId.value;
      if (!id) return [];
      const res = await apiFetch<{ overrides: DriverAppOverrideRow[] }>(
        `/api/driver-app/drivers/${encodeURIComponent(id)}/overrides`,
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Failed to load the driver's overrides.");
      return res.data?.overrides ?? [];
    },
  });
}

export function useSaveDriverOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: { driverId: string; featureKey: string } & SetDriverAppOverrideRequest,
    ): Promise<void> => {
      const res = await apiFetch(
        `/api/driver-app/drivers/${encodeURIComponent(input.driverId)}/overrides/${encodeURIComponent(input.featureKey)}`,
        { method: "PUT", body: { enabled: input.enabled, note: input.note ?? null } },
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Failed to save the override.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: OVERRIDES_KEY }),
  });
}

export function useClearDriverOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { driverId: string; featureKey: string }): Promise<void> => {
      const res = await apiFetch(
        `/api/driver-app/drivers/${encodeURIComponent(input.driverId)}/overrides/${encodeURIComponent(input.featureKey)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Failed to remove the override.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: OVERRIDES_KEY }),
  });
}
