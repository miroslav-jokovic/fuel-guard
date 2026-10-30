import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  CreateScannerRequest,
  ScannerDto,
  ScannerStatus,
  ScannerWaitResponse,
  StationPortsDto,
  TakeScannerResponse,
  UpdateScannerRequest,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Scanners on a print station, used from any device (SCANNER-RELAY-PLAN.md SR4;
 * `/api/maintenance/scanners`).
 *
 * In `@/composables` for `usePrinting.ts`'s reason: Settings manages scanners, the Scan page and the
 * relay store use them, and `lint:boundaries` keeps features out of each other.
 */

const BASE = "/api/maintenance/scanners";
export const SCANNERS_KEY = ["scanners"] as const;

async function call<T>(path: string, init: { method?: string; body?: object } = {}, fallback = "Something went wrong"): Promise<T> {
  const r = await apiFetch<T>(`${BASE}${path}`, init);
  if (!r.ok || !r.data) throw Object.assign(new Error(r.error?.message ?? fallback), { code: r.error?.code, status: r.status });
  return r.data;
}

export function useScannersQuery() {
  return useQuery({
    queryKey: SCANNERS_KEY,
    // Ready / waiting / who holds it is the point of the list; a station reports once a minute.
    refetchInterval: 15_000,
    queryFn: async () => (await call<{ scanners: ScannerDto[] }>("", {}, "Could not load the scanners")).scanners,
  });
}

export function useStationPortsQuery() {
  return useQuery({
    queryKey: [...SCANNERS_KEY, "ports"] as const,
    refetchInterval: 15_000,
    queryFn: async () => (await call<{ stations: StationPortsDto[] }>("/ports", {}, "Could not load the stations' ports")).stations,
  });
}

function useWrite<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => client.invalidateQueries({ queryKey: SCANNERS_KEY }) });
}

export const useCreateScanner = () =>
  useWrite((body: CreateScannerRequest) => call<{ id: string }>("", { method: "POST", body }, "Could not add the scanner"));

export const useUpdateScanner = () =>
  useWrite(({ id, patch }: { id: string; patch: UpdateScannerRequest }) =>
    call<{ id: string }>(`/${id}`, { method: "PATCH", body: patch }, "Could not save the scanner"),
  );

/** The relay store's three calls. Plain functions: the store owns their timing, not vue-query. */
export const scannerApi = {
  take: (id: string, session: string, force: boolean) =>
    call<TakeScannerResponse>(`/${id}/take`, { method: "POST", body: { session, force } }, "Could not use the scanner"),
  release: (id: string, session: string) =>
    call<{ ok: true }>(`/${id}/release`, { method: "POST", body: { session } }, "Could not stop using the scanner"),
  wait: (id: string, session: string, after: number) =>
    call<ScannerWaitResponse>(`/${id}/reads?session=${encodeURIComponent(session)}&after=${after}`, {}, "Lost touch with the scanner"),
};

/** What Settings and the Scan page say about a scanner's status, in the shop's words. */
export const SCANNER_STATUS_TEXT: Record<ScannerStatus, { label: string; tone: "success" | "caution" | "danger" | "neutral"; help: string }> = {
  ready: { label: "Ready", tone: "success", help: "The station has the scanner's port open." },
  waiting: {
    label: "Not found",
    tone: "caution",
    help: "The station cannot see this scanner. Check its USB cable or receiver is plugged into the station, and that the scanner is in USB-COM mode (Settings → Printers & scanners → How to set up a scanner).",
  },
  failed: { label: "Cannot open", tone: "danger", help: "The station sees the scanner but could not open it. Another program on that computer may be using it." },
  station_too_old: {
    label: "Update station",
    tone: "caution",
    help: "The program on that computer is older than scanner support. Install the new version from tools/print-station.",
  },
  station_offline: { label: "Station offline", tone: "danger", help: "The computer the scanner is plugged into is off, asleep or not connected." },
};
