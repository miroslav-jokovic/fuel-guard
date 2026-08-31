import { computed, type Ref } from "vue";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import type {
  InspectionItemDto,
  InspectionIssue,
  InspectionSubjectType,
} from "@silvicom/shared";

/**
 * The §396.17 annual inspection, client side (plan step A7).
 *
 * ── EVERY WRITE ANSWERS WITH THE WHOLE REPORT, AND THAT IS THE POINT ───────────────────────────
 * `PATCH` returns the report as the DATABASE now holds it, so the cache is replaced with server
 * truth on every save rather than optimistically patched. A form that believes it saved something
 * the database never took is the failure this shape removes, and on a compliance record that is
 * worth more than the round trip it costs (see the API's `patchInspection`).
 */

export interface InspectionSummary {
  id: string;
  subject_type: InspectionSubjectType;
  subject_id: string;
  inspected_on: string;
  status: "draft" | "final";
  outcome: "pass" | "fail" | null;
  next_due_on: string | null;
  decal_serial: string | null;
  inspector_id: string;
  document_id: string | null;
}

export interface InspectionDetail extends InspectionSummary {
  vehicle_identification_method: "vin" | "plate" | "other";
  vehicle_identification_value: string | null;
  inspection_agency_location: string | null;
  other_conditions: string | null;
  catalogue_version: string;
}

export interface Inspector {
  id: string;
  full_name: string;
  qualification_basis: "state_federal_program" | "training_and_experience";
  brake_qualified: boolean;
  effective_from: string;
  effective_to: string | null;
  qualified: boolean;
}

export interface InspectionFilter {
  subjectType: InspectionSubjectType;
  status?: "draft" | "final";
  page: number;
}

const PER_PAGE = 50;

export function useInspectionsQuery(filter: Ref<InspectionFilter>) {
  return useQuery({
    queryKey: ["maintenance", "inspections", filter] as const,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ inspections: InspectionSummary[]; total: number }> => {
      const f = filter.value;
      const params = new URLSearchParams({
        subjectType: f.subjectType,
        limit: String(PER_PAGE),
        offset: String((f.page - 1) * PER_PAGE),
      });
      if (f.status) params.set("status", f.status);
      const r = await apiFetch<{ inspections: InspectionSummary[]; total: number }>(
        `/api/maintenance/inspections?${params}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load inspections");
      return r.data;
    },
  });
}

export function useInspectionQuery(id: Ref<string>) {
  return useQuery({
    queryKey: ["maintenance", "inspection", id] as const,
    enabled: computed(() => Boolean(id.value)),
    queryFn: async (): Promise<{ inspection: InspectionDetail; items: InspectionItemDto[] }> => {
      const r = await apiFetch<{ inspection: InspectionDetail; items: InspectionItemDto[] }>(
        `/api/maintenance/inspections/${id.value}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the inspection");
      return r.data;
    },
  });
}

export function useInspectorsQuery() {
  return useQuery({
    queryKey: ["maintenance", "inspectors"] as const,
    queryFn: async (): Promise<Inspector[]> => {
      const r = await apiFetch<{ inspectors: Inspector[] }>("/api/maintenance/inspectors");
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load inspectors");
      return r.data.inspectors;
    },
  });
}

export interface PatchPayload {
  inspectorId?: string;
  inspectedOn?: string;
  decalSerial?: string | null;
  inspectionAgencyLocation?: string | null;
  vehicleIdentificationValue?: string | null;
  otherConditions?: string | null;
  items?: Array<{ key: string; result: string; repairedAt?: string | null; note?: string | null }>;
}

export function usePatchInspection(id: Ref<string>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: PatchPayload) => {
      const r = await apiFetch<{ inspection: InspectionDetail; items: InspectionItemDto[] }>(
        `/api/maintenance/inspections/${id.value}`,
        { method: "PATCH", body: payload },
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not save");
      return r.data;
    },
    // Replace rather than invalidate: the response IS the row, so refetching would ask for something
    // we were just handed.
    onSuccess: (data) => qc.setQueryData(["maintenance", "inspection", id], data),
  });
}

export interface FinalizeFailure {
  code: string;
  message: string;
  issues?: InspectionIssue[];
}

export function useFinalizeInspection(id: Ref<string>) {
  const qc = useQueryClient();
  return useMutation<
    { outcome: "pass" | "fail"; nextDueOn: string; documentId: string },
    FinalizeFailure
  >({
    mutationFn: async () => {
      const r = await apiFetch<{ outcome: "pass" | "fail"; nextDueOn: string; documentId: string }>(
        `/api/maintenance/inspections/${id.value}/finalize`,
        { method: "POST" },
      );
      if (!r.ok || !r.data) {
        // A refusal carries a code and, for an incomplete report, the components responsible.
        // `detail` exists for exactly this: several API refusals carry fields the caller must ACT on
        // rather than merely display, and "this report is incomplete" is not something an inspector
        // can act on where "brake hose has no result" is.
        throw {
          code: r.error?.code ?? "unknown",
          message: r.error?.message ?? "Could not certify this inspection",
          issues: r.detail?.issues as InspectionIssue[] | undefined,
        } satisfies FinalizeFailure;
      }
      return r.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["maintenance", "inspection", id] });
      void qc.invalidateQueries({ queryKey: ["maintenance", "inspections"] });
    },
  });
}
