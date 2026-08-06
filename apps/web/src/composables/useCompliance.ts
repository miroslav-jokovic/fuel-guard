import { computed, type Ref } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { CertificationCreateRequest, CertificationRow } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";

/**
 * Compliance (certifications) data layer. Writes go through /api/compliance (insert_certification
 * auto-supersede, role-gated + audited); the roster read goes direct via PostgREST (RLS-scoped),
 * matching useDrivers. Everything is keyed under ["compliance"] so a write refreshes both the
 * per-subject drawer and the roster status.
 */
const CERTS_KEY = ["compliance", "certs"] as const;

/** Current certifications for one subject (driver or carrier) — reactive to the selection. */
export function useCertificationsQuery(subjectType: Ref<string>, subjectId: Ref<string | null>) {
  return useQuery({
    queryKey: [...CERTS_KEY, subjectType, subjectId] as const,
    enabled: computed(() => !!subjectId.value),
    queryFn: async (): Promise<CertificationRow[]> => {
      const id = subjectId.value;
      if (!id) return [];
      const res = await apiFetch<{ certifications: CertificationRow[] }>(
        `/api/compliance/certifications?subjectType=${subjectType.value}&subjectId=${id}`,
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Failed to load certifications.");
      return res.data?.certifications ?? [];
    },
  });
}

export interface DriverCertRow {
  subject_id: string;
  kind: string;
  qualifier: string | null;
  training_type: string | null;
  issued_at: string | null;
  expires_at: string | null;
}

/** Every current driver certification for the org, in one read — powers the roster status column. */
export function useAllDriverCertsQuery() {
  return useQuery({
    queryKey: ["compliance", "driver-certs"] as const,
    queryFn: async (): Promise<DriverCertRow[]> => {
      const { data, error } = await supabase
        .from("certifications")
        .select("subject_id, kind, qualifier, training_type, issued_at, expires_at")
        .eq("subject_type", "driver")
        .is("superseded_by", null);
      if (error) throw new Error(error.message);
      return (data ?? []) as DriverCertRow[];
    },
  });
}

export function useCreateCertification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CertificationCreateRequest): Promise<{ id: string; supersededId: string | null }> => {
      const res = await apiFetch<{ id: string; supersededId: string | null }>(
        "/api/compliance/certifications",
        { method: "POST", body: input },
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Failed to save the certification.");
      return res.data as { id: string; supersededId: string | null };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["compliance"] }),
  });
}
