import { computed, ref, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  CalendarDay,
  DocumentRegisterResponse,
  DocumentRow,
  RoadsideAttributionDecision,
  RoadsideCitationAction,
  RoadsideCitationDto,
  RoadsideDocumentRegisterRequest,
  RoadsideInspectionDetailDto,
  RoadsideInspectionDto,
  RoadsideInspectionWorkDto,
  RoadsideRepairCertificationDto,
  RoadsideRepairCertifyRequest,
  RoadsideRepairDecision,
  RoadsideRepairDto,
  RoadsideRepairDueDto,
  RoadsideSummary,
  RoadsideFeed,
  DayWindow,
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

/** The Roadside card's statistics over the Operations tab's range (IC16). Keyed by the range. */
export function useRoadsideSummaryQuery(range: Ref<DayWindow>) {
  return useQuery({
    queryKey: computed(() => ["roadside-inspections", "summary", range.value.from, range.value.to] as const),
    staleTime: 10 * 60_000,
    queryFn: () =>
      read<RoadsideSummary>(`/api/roadside-inspections/summary?from=${range.value.from}&to=${range.value.to}`, "the roadside inspections"),
  });
}

/** How current our copy of FMCSA's record is (IC1c) — the list's own line, apart from the card's figures. */
export function useRoadsideFeedQuery() {
  return useQuery({
    queryKey: ["roadside-inspections", "feed"] as const,
    staleTime: 10 * 60_000,
    queryFn: () => read<RoadsideFeed>("/api/roadside-inspections/feed", "how current the record is"),
  });
}

/** A range whose ends may each be open (the whole record when both are). */
export type OpenDayRange = { from: CalendarDay | null; to: CalendarDay | null };
const withRange = (path: string, r: OpenDayRange) => {
  const q = [r.from ? `from=${r.from}` : "", r.to ? `to=${r.to}` : ""].filter(Boolean).join("&");
  return q ? `${path}?${q}` : path;
};

/** The list over a range. Whole, never a page: the page counts it. */
export function useRoadsideInspectionsQuery(range: Ref<OpenDayRange>) {
  return useQuery({
    queryKey: computed(() => ["roadside-inspections", "list", range.value.from, range.value.to] as const),
    staleTime: 10 * 60_000,
    queryFn: () => read<RoadsideInspectionDto[]>(withRange("/api/roadside-inspections", range.value), "the roadside inspections"),
  });
}

/**
 * One line of work per inspection over the range — the inbox's Needs action tab and its Next step, Driver and
 * CSA points columns (Q-IC17). Its own read: the list draws first, and the columns fill in when this lands.
 */
export function useRoadsideWorkQuery(range: Ref<OpenDayRange>) {
  return useQuery({
    queryKey: computed(() => ["roadside-inspections", "work", range.value.from, range.value.to] as const),
    staleTime: 60_000,
    queryFn: () => read<RoadsideInspectionWorkDto[]>(withRange("/api/roadside-inspections/work", range.value), "what is left on the roadside inspections"),
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
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["roadside-inspections", "one", id.value] }),
        client.invalidateQueries({ queryKey: ["roadside-inspections", "work"] }),
      ]),
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
    // The inspection too: a filed officer's report appears on the driver card (`attribution.reports`) and
    // closes the Next steps strip's "Upload the officer's report" — without this both waited ten minutes.
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["roadside-inspections", "documents", id.value] }),
        client.invalidateQueries({ queryKey: ["roadside-inspections", "one", id.value] }),
        client.invalidateQueries({ queryKey: ["roadside-inspections", "citations", id.value] }),
        client.invalidateQueries({ queryKey: ["roadside-inspections", "work"] }),
      ]),
  });
}

/**
 * Officer's reports dropped on the inbox, each filed on the inspection a person confirmed (IC15's bulk upload).
 * One file at a time through the same register-then-PUT as the Documents card, so a bulk upload is N ordinary
 * uploads and nothing else. Each inspection's own reads are refreshed as its file lands.
 */
export function useUploadReportTo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { inspectionId: string; file: File }) =>
      uploadDocumentFile(input.file, async (fields) => {
        const body: RoadsideDocumentRegisterRequest = { ...fields, kind: "roadside_inspection_report" };
        const res = await apiFetch<{ data: DocumentRegisterResponse }>(
          `/api/roadside-inspections/${encodeURIComponent(input.inspectionId)}/documents`,
          { method: "POST", body },
        );
        if (!res.ok || !res.data) throw new Error(res.error?.message ?? "The report could not be filed.");
        return res.data.data;
      }),
    onSettled: (_d, _e, input) =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["roadside-inspections", "documents", input.inspectionId] }),
        client.invalidateQueries({ queryKey: ["roadside-inspections", "one", input.inspectionId] }),
        client.invalidateQueries({ queryKey: ["roadside-inspections", "work"] }),
      ]),
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

/**
 * Every violated unit of the last year with its inspection — the Shop's "Roadside repairs due" (Q-IC16 (a)),
 * read on the maintenance section. The engine re-reads hourly, so a minute's staleness is the card's own.
 */
export function useRoadsideRepairsDueQuery(enabled: Ref<boolean> = ref(true)) {
  return useQuery({
    queryKey: ["roadside-inspections", "repairs-due"] as const,
    staleTime: 60_000,
    enabled,
    queryFn: () => read<RoadsideRepairDueDto[]>("/api/roadside-inspections/repairs-due", "the roadside repairs"),
  });
}

/** The inspection's tickets and where each stands (IC4, R-ADJ1). Its own query, refreshed by an act or a filed court result. */
export function useInspectionCitationsQuery(id: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ["roadside-inspections", "citations", id.value] as const),
    staleTime: 60_000,
    queryFn: () =>
      read<{ tickets: RoadsideCitationDto[]; courtResultFiled: boolean }>(`/api/roadside-inspections/${encodeURIComponent(id.value)}/citations`, "the tickets"),
  });
}

/** The office's act on one ticket. Refused with `changed` when someone acted first; the record is read again either way. */
export function useActOnCitation(id: Ref<string>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: RoadsideCitationAction): Promise<void> => {
      const res = await apiFetch(`/api/roadside-inspections/${encodeURIComponent(id.value)}/citations`, { method: "POST", body: input });
      if (!res.ok) throw new RepairDecisionError(res.error?.message ?? "It could not be recorded.", res.error?.code ?? null);
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["roadside-inspections", "citations", id.value] }),
        client.invalidateQueries({ queryKey: ["roadside-inspections", "work"] }),
      ]),
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
    // The Shop's list too (Q-IC16 (a)): the same decision is made from either page.
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["roadside-inspections", "repairs", id.value] }),
        client.invalidateQueries({ queryKey: ["roadside-inspections", "repairs-due"] }),
        client.invalidateQueries({ queryKey: ["roadside-inspections", "work"] }),
      ]),
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
        client.invalidateQueries({ queryKey: ["roadside-inspections", "work"] }),
      ]),
  });
}
