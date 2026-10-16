import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  CalendarDay,
  DocumentRegisterResponse,
  DocumentRow,
  RoadsideAttributionDecision,
  RoadsideDocumentRegisterRequest,
  RoadsideInspectionDetailDto,
  RoadsideInspectionDto,
  RoadsideRepairCertificationDto,
  RoadsideRepairCertifyRequest,
  RoadsideRepairDecision,
  RoadsideRepairDto,
  RoadsideSummary,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { recordOrThrow } from "@silvicom/ui";
import { uploadDocumentFile } from "@/composables/useCompliance";

/**
 * Our FMCSA roadside inspections (INSPECTION-CHALLENGE-PLAN §6's first slice; FLEET-MANAGER-HOME-PLAN
 * FM5, Q-FM7 (a)): the Roadside card's figures and the list they open. Each figure is that list's
 * length on the server (`summarizeRoadside`), so the card and the page cannot disagree.
 *
 * The feed refreshes once a day (`FMCSA_FEED_HOURS`), so neither read needs to be fresher than that.
 */
async function read<T>(path: string, what: string): Promise<T> {
  // A 404 is `NotFoundError` (F21) — only the one-inspection read can meet one.
  return recordOrThrow(await apiFetch<{ data: T }>(path), `Could not load ${what}`).data;
}

export function useRoadsideSummaryQuery() {
  return useQuery({
    queryKey: ["roadside-inspections", "summary"] as const,
    staleTime: 10 * 60_000,
    queryFn: () => read<RoadsideSummary>("/api/roadside-inspections/summary", "the roadside inspections"),
  });
}

/** The list from `from` (the whole record when null). Whole, never a page: the page counts it. */
export function useRoadsideInspectionsQuery(from: Ref<CalendarDay | null>) {
  return useQuery({
    queryKey: computed(() => ["roadside-inspections", "list", from.value] as const),
    staleTime: 10 * 60_000,
    queryFn: () =>
      read<RoadsideInspectionDto[]>(
        from.value ? `/api/roadside-inspections?from=${from.value}` : "/api/roadside-inspections",
        "the roadside inspections",
      ),
  });
}

/** One inspection with its units and violations — the row the list opens. */
export function useRoadsideInspectionQuery(id: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ["roadside-inspections", "one", id.value] as const),
    staleTime: 10 * 60_000,
    queryFn: () => read<RoadsideInspectionDetailDto>(`/api/roadside-inspections/${encodeURIComponent(id.value)}`, "the roadside inspection"),
  });
}

/** The API's refusal, kept whole: `changed` means the page is behind and must reload before deciding again. */
export class AttributionDecisionError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
  }
}

/**
 * A person confirming or correcting who was driving (IC5, plan §6). Settled either way, the inspection
 * is read again: after a success to show the decision, after `changed` to show what someone else did.
 */
export function useDecideAttribution(id: Ref<string>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (decision: RoadsideAttributionDecision): Promise<void> => {
      const res = await apiFetch(`/api/roadside-inspections/${encodeURIComponent(id.value)}/attribution`, { method: "POST", body: decision });
      if (!res.ok) throw new AttributionDecisionError(res.error?.message ?? "The decision could not be saved.", res.error?.code ?? null);
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["roadside-inspections", "one", id.value] }),
  });
}

/**
 * The inspection's paper (IC2). Its own query, never part of the inspection's: each row carries a signed
 * URL that lives five minutes, so it is read fresh on every visit and not kept for the inspection's ten.
 */
export function useInspectionDocumentsQuery(id: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ["roadside-inspections", "documents", id.value] as const),
    staleTime: 0,
    queryFn: () => read<DocumentRow[]>(`/api/roadside-inspections/${encodeURIComponent(id.value)}/documents`, "the inspection's documents"),
  });
}

/** File one ticket, court result or officer's copy: register with the inspection, then PUT the bytes. */
export function useUploadInspectionDocument(id: Ref<string>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: RoadsideDocumentRegisterRequest["kind"]; file: File }) =>
      uploadDocumentFile(input.file, async (fields) => {
        const body: RoadsideDocumentRegisterRequest = { ...fields, kind: input.kind };
        const res = await apiFetch<{ data: DocumentRegisterResponse }>(
          `/api/roadside-inspections/${encodeURIComponent(id.value)}/documents`,
          { method: "POST", body },
        );
        if (!res.ok || !res.data) throw new Error(res.error?.message ?? "The document could not be filed.");
        return res.data.data;
      }),
    onSettled: () => client.invalidateQueries({ queryKey: ["roadside-inspections", "documents", id.value] }),
  });
}

/**
 * The repair record of the inspection's vehicle violations (IC11). Its own query: the engine re-reads it
 * hourly as FleetPal work orders open, and a decision must reload it without reloading the inspection.
 */
export function useInspectionRepairsQuery(id: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ["roadside-inspections", "repairs", id.value] as const),
    staleTime: 60_000,
    queryFn: () => read<RoadsideRepairDto[]>(`/api/roadside-inspections/${encodeURIComponent(id.value)}/repairs`, "the repair record"),
  });
}

/** The repair decision's refusal, kept whole like the driver's: `changed` means reload before deciding again. */
export class RepairDecisionError extends AttributionDecisionError {}

/** Maintenance names the repair (Q-IC13). Settled either way the record is read again, as for the driver. */
export function useDecideRepair(id: Ref<string>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (decision: RoadsideRepairDecision): Promise<void> => {
      const res = await apiFetch(`/api/roadside-inspections/${encodeURIComponent(id.value)}/repairs`, { method: "POST", body: decision });
      if (!res.ok) throw new RepairDecisionError(res.error?.message ?? "The repair could not be saved.", res.error?.code ?? null);
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["roadside-inspections", "repairs", id.value] }),
  });
}

/**
 * Safety's certification (IC11 B2, 396.9(d)(3)(i)). Keyed UNDER the repair record, so every decision that
 * invalidates the record also re-asks whether the certification still stands over it (`current`).
 */
export function useRepairCertificationQuery(id: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ["roadside-inspections", "repairs", id.value, "certification"] as const),
    staleTime: 60_000,
    queryFn: () => read<RoadsideRepairCertificationDto | null>(`/api/roadside-inspections/${encodeURIComponent(id.value)}/repairs/certification`, "the certification"),
  });
}

/** Safety certifies (Q-IC13). The record and the Documents card are read again: the rendered record is filed there. */
export function useCertifyRepairs(id: Ref<string>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: RoadsideRepairCertifyRequest): Promise<void> => {
      const res = await apiFetch(`/api/roadside-inspections/${encodeURIComponent(id.value)}/repairs/certify`, { method: "POST", body: input });
      if (!res.ok) throw new RepairDecisionError(res.error?.message ?? "The certification could not be saved.", res.error?.code ?? null);
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["roadside-inspections", "repairs", id.value] }),
        client.invalidateQueries({ queryKey: ["roadside-inspections", "documents", id.value] }),
      ]),
  });
}
