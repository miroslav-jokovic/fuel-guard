import { ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

export interface DriverMergePair {
  sourceId: string;
  sourceName: string | null;
  canonicalId: string;
  canonicalName: string | null;
  matchedBy: "phone" | "name";
  key: string;
}
export interface DriverReconcileReport {
  dryRun: boolean;
  unmatched: number;
  planned: number;
  merged: number;
  pairs: DriverMergePair[];
}

/** Drives the "Reconcile with Samsara" flow: preview (dry-run) the confident merges, apply them, or link one
 *  driver manually. Refreshes the drivers list after any change. */
export function useDriverReconcile() {
  const qc = useQueryClient();
  const loading = ref(false);
  const applying = ref(false);
  const report = ref<DriverReconcileReport | null>(null);
  const error = ref<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["drivers"] });

  async function preview() {
    loading.value = true;
    error.value = null;
    try {
      const res = await apiFetch<DriverReconcileReport>("/api/roster/drivers/reconcile", { method: "POST", body: { apply: false } });
      if (res.ok && res.data) report.value = res.data;
      else error.value = res.error?.message ?? "Could not preview";
    } finally {
      loading.value = false;
    }
  }

  async function apply(): Promise<number> {
    applying.value = true;
    error.value = null;
    try {
      const res = await apiFetch<DriverReconcileReport>("/api/roster/drivers/reconcile", { method: "POST", body: { apply: true } });
      if (res.ok && res.data) {
        report.value = res.data;
        invalidate();
        return res.data.merged;
      }
      error.value = res.error?.message ?? "Could not apply";
      return 0;
    } finally {
      applying.value = false;
    }
  }

  async function linkOne(sourceId: string, canonicalId: string): Promise<boolean> {
    error.value = null;
    const res = await apiFetch(`/api/roster/drivers/${sourceId}/merge`, { method: "POST", body: { canonicalId } });
    if (res.ok) {
      invalidate();
      return true;
    }
    error.value = res.error?.message ?? "Could not link";
    return false;
  }

  return { loading, applying, report, error, preview, apply, linkOne };
}
