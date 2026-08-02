import { ref, watch } from "vue";
import { useQueryClient, type QueryKey } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/stores/toast";
import { useJob, type Job } from "./useJob";

export interface BackgroundSyncOpts {
  /** The job ledger kind this button drives (also the useJob poll key). */
  kind: string;
  /** POST endpoint that enqueues the job (returns 202 { jobId } or 409). */
  endpoint: string;
  /** Human label for the start/error toasts, e.g. "Samsara sync". */
  label: string;
  /** Build the success toast from the completed job's stats (the handler's return, read off the ledger). */
  done: (stats: Record<string, unknown>) => { title: string; body?: string };
  /** Query keys to refresh when the job completes (the lists the sync updated). */
  invalidate?: QueryKey[];
}

/**
 * Drive a background sync button off the jobs ledger (WQ1c). The endpoint now enqueues and returns
 * immediately, so — exactly like the DataSync cards — we fire it, mark the job running for instant
 * feedback, and let useJob's 4s poll carry the run. When the watched job reaches a terminal state we toast
 * the REAL outcome (counts pulled from the ledger `stats`) and refresh the affected lists. This keeps the
 * "you get the counts" UX while the work runs safely off the request path.
 */
export function useBackgroundSync(opts: BackgroundSyncOpts) {
  const job = useJob(opts.kind);
  const qc = useQueryClient();
  const toast = useToastStore();
  // Only report on a run WE started — a pre-existing done/failed row must not fire a phantom toast on mount.
  const watching = ref(false);

  watch(
    () => job.latest.value,
    (cur: Job | null) => {
      if (!watching.value || !cur || cur.id === "pending") return;
      if (cur.status === "done") {
        watching.value = false;
        const stats = cur.stats ?? {};
        const skipped = typeof stats.skipped === "string" ? stats.skipped : null;
        if (skipped) {
          toast.info(
            `${opts.label} skipped`,
            skipped === "no_samsara_token" ? "No Samsara token is configured for this org." : skipped,
          );
        } else {
          const t = opts.done(stats);
          toast.success(t.title, t.body);
        }
        opts.invalidate?.forEach((key) => void qc.invalidateQueries({ queryKey: key }));
      } else if (cur.status === "failed") {
        watching.value = false;
        toast.error(`${opts.label} failed`, cur.error ?? undefined);
      }
    },
  );

  async function trigger(): Promise<void> {
    job.markRunning(); // instant running state + engages the poll
    watching.value = true;
    try {
      const res = await apiFetch(opts.endpoint, { method: "POST" });
      if (res.status === 409) {
        watching.value = false;
        toast.info("Already running", "A sync of this kind is already in progress — watch its progress here.");
      } else if (!res.ok) {
        watching.value = false;
        toast.error(`Could not start ${opts.label.toLowerCase()}`, res.error?.message);
      } else {
        toast.success(`${opts.label} started`, "Running in the background — this updates automatically when it finishes.");
      }
    } catch {
      // Enqueue is a fast request; a transient failure shouldn't strand the watcher on a run that never began.
      watching.value = false;
      toast.error(`Could not start ${opts.label.toLowerCase()}`);
    } finally {
      job.refresh();
    }
  }

  return { trigger, ...job };
}
