import { computed } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
  id: string;
  kind: string;
  status: JobStatus;
  progress: number;
  total: number | null;
  error: string | null;
  stats: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

interface JobResponse {
  latest: Job | null;
  lastDone: Job | null;
}

/** Relative "x min ago" label for a timestamp (coarse; good enough for a freshness chip). */
function agoLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/**
 * Track a background job kind (rebuild, backfill, sync_vehicles, …) for the current org. Polls while a
 * run is active so progress and freshness update live without a page reload. Exposes everything a button
 * + chip needs: is it running, how far along, when did it last succeed, did the last run fail.
 */
export function useJob(kind: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["job", kind],
    queryFn: async (): Promise<JobResponse> => {
      const res = await apiFetch<JobResponse>(`/api/jobs/latest?kind=${encodeURIComponent(kind)}`);
      return res.ok && res.data ? res.data : { latest: null, lastDone: null };
    },
    // Poll every 4s while a run is active; otherwise don't poll (freshness is refreshed on demand).
    refetchInterval: (q) => {
      const data = q.state.data as JobResponse | undefined;
      const s = data?.latest?.status;
      return s === "running" || s === "queued" ? 4000 : false;
    },
  });

  const latest = computed(() => query.data.value?.latest ?? null);
  const lastDone = computed(() => query.data.value?.lastDone ?? null);
  const isRunning = computed(() => latest.value?.status === "running" || latest.value?.status === "queued");
  const failed = computed(() => latest.value?.status === "failed");

  const progressPct = computed(() => {
    const j = latest.value;
    if (!j || !j.total || j.total <= 0) return null;
    return Math.min(100, Math.round((j.progress / j.total) * 100));
  });

  const progressLabel = computed(() => {
    const j = latest.value;
    if (!j || !isRunning.value) return null;
    return j.total ? `${j.progress.toLocaleString()}/${j.total.toLocaleString()}` : "working…";
  });

  const freshnessLabel = computed(() => {
    if (isRunning.value) return "running…";
    if (failed.value) return `last run failed ${agoLabel(latest.value?.finished_at) ?? ""}`.trim();
    const done = lastDone.value ?? (latest.value?.status === "done" ? latest.value : null);
    const ago = agoLabel(done?.finished_at);
    return ago ? `updated ${ago}` : "never run";
  });

  /** Force an immediate refetch (e.g. right after enqueuing a run). */
  const refresh = () => qc.invalidateQueries({ queryKey: ["job", kind] });

  return { latest, lastDone, isRunning, failed, progressPct, progressLabel, freshnessLabel, refresh, isLoading: query.isLoading };
}
