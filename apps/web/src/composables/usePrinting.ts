import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  CreatePrinterRequest,
  LabelTarget,
  PairingCodeDto,
  PrintDefaultsDto,
  PrinterDto,
  PrintJobDto,
  PrintStationDto,
  SetDefaultRequest,
  UpdatePrinterRequest,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Printers chosen once in Settings, and the Print button that never asks
 * (PRINTERS-AND-SCANNERS-PLAN.md PS4; `/api/maintenance/print`).
 *
 * In `@/composables` rather than a feature because two places use it: Settings → Devices manages
 * printers, and the Labels screen (inventory) prints through them — `lint:boundaries` keeps features
 * from reaching into each other, so the shared half lives here.
 *
 * ── A JOB IS WATCHED UNTIL IT LANDS ──────────────────────────────────────────────────────────
 * Pressing Print answers at once with a QUEUED job; the label comes out a second or two later when
 * the station takes it. `usePrintJob` polls that one job every second until it is printed, failed or
 * unknown, so the person sees the outcome where they pressed the button, not on another screen.
 */

const BASE = "/api/maintenance/print";
const KEY = ["printing"] as const;

async function call<T>(path: string, init: { method?: string; body?: object } = {}, fallback = "Something went wrong"): Promise<T> {
  const r = await apiFetch<T>(`${BASE}${path}`, init);
  if (!r.ok || !r.data) throw Object.assign(new Error(r.error?.message ?? fallback), { code: r.error?.code });
  return r.data;
}

export function useStationsQuery() {
  return useQuery({
    queryKey: [...KEY, "stations"] as const,
    // Online/offline is the point of the screen; a station's check-in is a minute apart.
    refetchInterval: 15_000,
    queryFn: async () => (await call<{ stations: PrintStationDto[] }>("/stations", {}, "Could not load the print stations")).stations,
  });
}

export function usePrintersQuery() {
  return useQuery({
    queryKey: [...KEY, "printers"] as const,
    refetchInterval: 15_000,
    queryFn: async () => (await call<{ printers: PrinterDto[] }>("/printers", {}, "Could not load the printers")).printers,
  });
}

export function usePrintDefaultsQuery() {
  return useQuery({
    queryKey: [...KEY, "defaults"] as const,
    queryFn: async () => (await call<{ defaults: PrintDefaultsDto }>("/defaults", {}, "Could not load the default printer")).defaults,
  });
}

export function usePrintJobsQuery() {
  return useQuery({
    queryKey: [...KEY, "jobs"] as const,
    refetchInterval: 5_000,
    queryFn: async () => (await call<{ jobs: PrintJobDto[] }>("/jobs", {}, "Could not load the print jobs")).jobs,
  });
}

/** Every write here changes what the whole Devices screen shows, so each invalidates the lot. */
function useWrite<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });
}

export const useCreateStation = () =>
  useWrite((name: string) => call<PairingCodeDto>("/stations", { method: "POST", body: { name } }, "Could not add the print station"));

export const useRenewPairingCode = () =>
  useWrite((id: string) => call<PairingCodeDto>(`/stations/${id}/pairing-code`, { method: "POST" }, "Could not make a new code"));

export const useRevokeStation = () =>
  useWrite((id: string) => call<{ station: PrintStationDto }>(`/stations/${id}/revoke`, { method: "POST" }, "Could not disconnect the station"));

export const useCreatePrinter = () =>
  useWrite((body: CreatePrinterRequest) => call<{ printer: PrinterDto }>("/printers", { method: "POST", body }, "Could not add the printer"));

export const useUpdatePrinter = () =>
  useWrite(({ id, patch }: { id: string; patch: UpdatePrinterRequest }) =>
    call<{ printer: PrinterDto }>(`/printers/${id}`, { method: "PATCH", body: patch }, "Could not save the printer"),
  );

export const useSetDefaultPrinter = () =>
  useWrite((body: Omit<SetDefaultRequest, "purpose">) =>
    call<{ defaults: PrintDefaultsDto }>("/defaults", { method: "PUT", body: { purpose: "label", ...body } }, "Could not set the default printer"),
  );

export const usePrintTestLabel = () =>
  useWrite((printerId: string) =>
    call<{ job: PrintJobDto }>(`/printers/${printerId}/test`, { method: "POST", body: { id: crypto.randomUUID() } }, "Could not print a test label"),
  );

export const useCancelPrintJob = () =>
  useWrite((id: string) => call<{ job: PrintJobDto }>(`/jobs/${id}/cancel`, { method: "POST" }, "Could not cancel the job"));

/**
 * Print labels on the default printer (or the one named). The job id is made HERE, once per press,
 * so a retried request after a dropped connection is the same job and prints once (D-INV27).
 */
export const usePrintLabels = () =>
  useWrite(({ targets, printerId }: { targets: LabelTarget[]; printerId?: string }) =>
    call<{ job: PrintJobDto; dropped: number }>(
      "/labels",
      { method: "POST", body: { id: crypto.randomUUID(), targets, ...(printerId ? { printerId } : {}) } },
      "Could not print those labels",
    ),
  );

const SETTLED = new Set(["printed", "failed", "unknown", "cancelled"]);

/** One job, polled every second until it settles. */
export function usePrintJob(id: MaybeRefOrGetter<string | null>) {
  return useQuery({
    queryKey: computed(() => [...KEY, "job", toValue(id)] as const),
    enabled: computed(() => Boolean(toValue(id))),
    refetchInterval: (q) => (q.state.data && SETTLED.has(q.state.data.status) ? false : 1_000),
    queryFn: async () => (await call<{ job: PrintJobDto }>(`/jobs/${toValue(id)}`, {}, "Could not read the print job")).job,
  });
}

/** What a person reads about a job, in one place so Settings and the Labels screen say the same. */
export function jobStatusText(job: Pick<PrintJobDto, "status" | "printerName" | "error">): string {
  switch (job.status) {
    case "queued":
      return `Waiting for ${job.printerName}`;
    case "sent":
      return `Printing on ${job.printerName}…`;
    case "printed":
      return `Printed on ${job.printerName}`;
    case "failed":
      return job.error ? `${job.printerName}: ${job.error}` : `${job.printerName} could not print it`;
    case "unknown":
      return `${job.printerName} stopped answering — check whether it printed before trying again`;
    case "cancelled":
      return "Cancelled";
  }
}
