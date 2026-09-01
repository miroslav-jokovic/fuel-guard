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
  /** Resolved by the API — `subject_id` is a uuid and nobody reads those. */
  unit_number: string | null;
  inspector_name: string | null;
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
  outcome?: "pass" | "fail";
  q?: string;
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
      if (f.outcome) params.set("outcome", f.outcome);
      if (f.q) params.set("q", f.q);
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

export function useInspectorsQuery(includeRetired?: Ref<boolean>) {
  return useQuery({
    queryKey: ["maintenance", "inspectors", includeRetired ?? false] as const,
    queryFn: async (): Promise<Inspector[]> => {
      const params = includeRetired?.value ? "?includeRetired=true" : "";
      const r = await apiFetch<{ inspectors: Inspector[] }>(`/api/maintenance/inspectors${params}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load inspectors");
      return r.data.inspectors;
    },
  });
}

export interface NewInspector {
  fullName: string;
  address?: string | null;
  qualificationBasis: "state_federal_program" | "training_and_experience";
  brakeQualified: boolean;
  effectiveFrom: string;
  notes?: string | null;
}

export function useCreateInspector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewInspector): Promise<string> => {
      const r = await apiFetch<{ id: string }>("/api/maintenance/inspectors", { method: "POST", body: input });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not add the inspector");
      return r.data.id;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["maintenance", "inspectors"] }),
  });
}

/**
 * Retire an inspector, or bring one back.
 *
 * Never a delete — somebody who has signed a report cannot be removed, because the report has to
 * name who performed it. Closing the period only stops them being chosen for a NEW inspection.
 */
export function useSetInspectorPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; effectiveTo: string | null }): Promise<void> => {
      const r = await apiFetch(`/api/maintenance/inspectors/${input.id}`, {
        method: "PATCH",
        body: { effectiveTo: input.effectiveTo },
      });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not update the inspector");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["maintenance", "inspectors"] }),
  });
}

/**
 * Take somebody off the register.
 *
 * The counterpart to `useSetInspectorPeriod`, not a replacement for it: this one only ever succeeds
 * for a row no report points at. Anyone who has inspected anything is refused by the API with a 409
 * whose message names Retire as the answer, and that message is what the caller shows — the
 * boundary is the database's foreign key, so restating it here would be a second, staler copy.
 */
export function useDeleteInspector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const r = await apiFetch(`/api/maintenance/inspectors/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not remove the inspector");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["maintenance", "inspectors"] }),
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

export interface NewInspection {
  subjectType: InspectionSubjectType;
  subjectId: string;
  inspectorId: string;
  inspectedOn: string;
}

/**
 * Start a draft.
 *
 * The id is generated HERE and sent with the request: the API keys its idempotency on it, so a
 * double-click or a retried request lands on the same report instead of starting a second one.
 */
export function useCreateInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewInspection): Promise<string> => {
      const id = crypto.randomUUID();
      const r = await apiFetch<{ id: string }>("/api/maintenance/inspections", {
        method: "POST",
        body: { id, ...input },
      });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not start the inspection");
      return r.data.id;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["maintenance", "inspections"] }),
  });
}

export interface PrintProfile {
  id: string;
  name: string;
  offset_x_pt: number;
  offset_y_pt: number;
  notes: string | null;
}

export function usePrintProfilesQuery() {
  return useQuery({
    queryKey: ["maintenance", "print-profiles"] as const,
    queryFn: async (): Promise<PrintProfile[]> => {
      const r = await apiFetch<{ profiles: PrintProfile[] }>("/api/maintenance/print-profiles");
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load printer setups");
      return r.data.profiles;
    },
  });
}

export interface PrintProfileInput {
  name: string;
  offsetXPt: number;
  offsetYPt: number;
  notes?: string | null;
}

export function useSavePrintProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PrintProfileInput & { id?: string }): Promise<void> => {
      const { id, ...body } = input;
      const r = await apiFetch(id ? `/api/maintenance/print-profiles/${id}` : "/api/maintenance/print-profiles", {
        method: id ? "PATCH" : "POST",
        body,
      });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not save the printer setup");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["maintenance", "print-profiles"] }),
  });
}

/**
 * Start the report that supersedes a completed one (D-AVI4).
 *
 * The id is generated here and sent, so a double-click lands on the same correction instead of
 * starting two.
 */
export function useCorrectInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (supersedesId: string): Promise<string> => {
      const id = crypto.randomUUID();
      const r = await apiFetch<{ id: string }>(`/api/maintenance/inspections/${supersedesId}/correct`, {
        method: "POST",
        body: { id },
      });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not start the correction");
      return r.data.id;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["maintenance", "inspections"] }),
  });
}

/** Discard a draft. A completed inspection is refused by the API, by name. */
export function useDiscardInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const r = await apiFetch(`/api/maintenance/inspections/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not discard the inspection");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["maintenance", "inspections"] }),
  });
}
